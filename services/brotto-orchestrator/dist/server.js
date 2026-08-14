/**
 * Agent Orchestrator Server
 *
 * Main entry point for the Agent Orchestrator service.
 * Coordinates session state machine, Brotto inference, policy enforcement,
 * and MCP action execution as specified in ARCHITECTURE.md section 3.2
 */
import { SessionStateMachine, SessionState, } from './session.js';
import { HistoryManager } from './history.js';
import { FaraInferenceClient } from './inference.js';
import { buildPlannerConfigFromEnv, createPlanner } from './inference-registry.js';
import { createToolCallParser } from './parser.js';
import { createPolicyIntegrator } from './policy.js';
import { createCompletionDetector } from './completion.js';
import { createAgentBudgetTracker } from './budget.js';
import { createResilientExecutor, CircuitState, } from './retry.js';
import { createObservationId, createActionSuccess, createActionFailure, ActionErrorCode, } from '@brotto/brotto-action-schema';
import { createActionExecutor } from './executor.js';
// ponytail: long-horizon harness wiring. Criteria + scratchpad + gate.
import { extractCriteria } from './criteria/extract.js';
import { createFileScratchpadStore } from './scratchpad/store.js';
import { summarize } from './scratchpad/summarize.js';
import { evaluateTerminationGate } from './policy/gate.js';
import { ActionExecutionType, getActionExecutionType } from '@brotto/brotto-action-schema';
// Default approval timeout in milliseconds (5 minutes)
const APPROVAL_DEFAULT_TIMEOUT_MS = parseInt(process.env.APPROVAL_DEFAULT_TIMEOUT_MS ?? '300000', 10);
/**
 * Agent Orchestrator
 *
 * Main orchestrator that coordinates all components per ARCHITECTURE.md section 3.2
 */
export class AgentOrchestrator {
    session;
    history;
    legacyInference = null;
    parser;
    policy;
    completion;
    budget;
    resilient;
    executor;
    planner;
    listeners;
    isRunning = false;
    shouldStop = false;
    observationSequence = 0;
    pendingAction = null;
    lastPromptTokens = 0;
    lastCompletionTokens = 0;
    abortController = new AbortController();
    lastObservation = null;
    // ponytail: long-horizon state.
    scratchpad;
    criteria = [];
    scratchpadEntries = [];
    constructor(config) {
        this.listeners = new Map();
        // Initialize session
        const sessionConfig = {
            sessionId: config.session.sessionId,
            goal: config.session.goal,
            tenantId: config.session.tenantId,
            userId: config.session.userId,
        };
        this.session = new SessionStateMachine(sessionConfig);
        // ponytail: scratchpad store + goal criteria. dataDir defaults to ./.brotto-scratch
        // so the demo and tests don't need extra config. Production callers can
        // override via OrchestratorConfig.budget.maxSteps style — but since we
        // keep the config surface stable, env wins.
        const dataDir = process.env.BROTTO_DATA_DIR ?? './.brotto-scratch';
        this.scratchpad = createFileScratchpadStore(dataDir);
        this.criteria = extractCriteria(config.session.goal).criteria;
        // Initialize components
        this.history = new HistoryManager({
            maxActionHistory: 100,
            maxScreenshotHistory: 10,
            maxRecentActionsForPrompt: 5,
        });
        if (!config.plannerConfig) {
            // ponytail: default to env-derived config so callers can omit it. Tests
            // pass explicit mocks; production callers either pass plannerConfig or
            // rely on env.
            this.planner = createPlanner(buildPlannerConfigFromEnv());
        }
        else {
            this.planner = createPlanner(config.plannerConfig);
        }
        this.legacyInference = config.inference ? new FaraInferenceClient(config.inference) : null;
        this.parser = createToolCallParser();
        this.policy = createPolicyIntegrator({
            sessionId: config.session.sessionId,
            userId: config.session.userId,
            defaultTimeoutMs: APPROVAL_DEFAULT_TIMEOUT_MS,
        });
        this.completion = createCompletionDetector({
            maxConsecutiveFailures: config.budget?.maxConsecutiveFailedActions ?? 5,
        });
        this.budget = createAgentBudgetTracker('standard', {
            maxSteps: config.budget?.maxSteps ?? 100,
            maxSessionDurationMs: config.budget?.maxSessionDurationMs ?? 3600000,
            maxConsecutiveFailedActions: config.budget?.maxConsecutiveFailedActions ?? 5,
        });
        this.resilient = createResilientExecutor({ failureThreshold: 5, timeoutMs: 30000 }, { maxRetries: 3 });
        // Initialize action executor with MCP gateway
        this.executor = createActionExecutor({
            mcpGateway: config.mcpGateway,
            sessionId: config.session.sessionId,
            maxExecutionTimeMs: 30000,
        });
        // Wire up session events
        this.session.on('stateChanged', (oldState, newState) => {
            this.emit('stateChanged', this.session, oldState, newState);
        });
        this.session.on('failed', (reason) => {
            this.emit('failed', reason);
        });
        this.session.on('completed', (reason) => {
            this.emit('completed', reason);
        });
        // Wire up budget events
        this.budget.addListener((event) => {
            this.emit('budgetWarning', event.message);
        });
    }
    /**
     * Start the orchestrator
     */
    async start() {
        if (this.isRunning) {
            throw new Error('Orchestrator is already running');
        }
        this.isRunning = true;
        this.shouldStop = false;
        // Start session
        this.session.waitForClient();
        // Initialize budget tracking
        this.budget.startSession();
        // Main loop
        await this.run();
    }
    /**
     * Stop the orchestrator
     */
    stop(reason) {
        this.shouldStop = true;
        this.isRunning = false;
        this.abortController.abort();
        this.legacyInference?.cancel();
        if (this.session.isActive()) {
            this.session.cancel(reason ?? 'Stopped by user');
        }
    }
    /**
     * Main orchestration loop
     */
    async run() {
        while (this.isRunning && !this.shouldStop && !this.session.isTerminal()) {
            try {
                // Check budget before proceeding
                if (!this.budget.isWithinBudget()) {
                    const exhausted = this.budget.getExhaustedBudgets();
                    this.session.fail(`Budget exhausted: ${exhausted.join(', ')}`);
                    break;
                }
                // State machine transitions
                const state = this.session.getState();
                switch (state) {
                    case SessionState.WAITING_FOR_CLIENT:
                        // Wait for client connection (handled externally)
                        await this.waitForClient();
                        break;
                    case SessionState.CONNECTED:
                        this.session.startObserving();
                        break;
                    case SessionState.OBSERVING:
                        await this.observe();
                        break;
                    case SessionState.PLANNING:
                        await this.plan();
                        break;
                    case SessionState.POLICY_CHECK:
                        await this.checkPolicy();
                        break;
                    case SessionState.WAITING_FOR_APPROVAL:
                        await this.waitForApproval();
                        break;
                    case SessionState.EXECUTING:
                        await this.execute();
                        break;
                    case SessionState.VERIFYING:
                        await this.verify();
                        break;
                    default:
                        // Unexpected state, break
                        this.session.fail(`Unexpected state: ${state}`);
                        break;
                }
            }
            catch (error) {
                this.handleError(error);
            }
        }
    }
    /**
     * Wait for client connection
     */
    async waitForClient() {
        // This would typically wait for an event from the control plane
        // For now, we simulate client connection after a short delay
        await this.sleep(100);
        // In real implementation, this would be event-driven
        this.session.clientConnected();
    }
    /**
     * Observe browser state - capture screenshot
     */
    async observe() {
        // Update parser with current observation ID
        const observationId = createObservationId(this.observationSequence++);
        this.parser.setCurrentObservationId(observationId.value);
        // In real implementation, this would take a screenshot via executor
        // For now, we just transition to planning
        this.session.startPlanning();
    }
    /**
     * Request inference via InferencePort planner
     */
    async plan() {
        const context = this.session.getContext();
        const goal = context.goal;
        const planningInput = {
            workId: this.session.getSessionId(),
            sessionId: this.session.getSessionId(),
            taskId: this.session.getSessionId(),
            goal,
            completionCriteria: [],
            observation: await this.captureObservation(),
            recentResults: [], // TODO: bridge HistoryEntry[] -> ActionResultV1[] (Task 7)
            trajectory: [], // TODO: bridge FullTrajectoryEntry[] -> TrajectoryEventV1[] (Task 7)
        };
        const outcome = await this.resilient.execute('inference', async () => this.planner.plan(planningInput, this.abortController.signal));
        this.handlePlanningOutcome(outcome);
    }
    handlePlanningOutcome(outcome) {
        if (outcome.kind === 'completion') {
            const completion = outcome;
            this.session.complete(completion.summary);
            this.emit('completed', completion.summary);
            return;
        }
        if (outcome.kind === 'question') {
            // TODO: wire up user question flow (session.askUser not implemented yet)
            console.warn('User question pending implementation:', outcome.question);
            this.session.startObserving();
            return;
        }
        // action_proposal (kind === 'action')
        const actionProposal = outcome;
        this.pendingAction = actionProposal.action;
        this.session.checkPolicy();
    }
    async captureObservation() {
        return this.lastObservation ?? this.buildEmptyObservation();
    }
    buildEmptyObservation() {
        return {
            observationId: crypto.randomUUID(),
            capturedAt: new Date().toISOString(),
            url: '',
            title: '',
            page: { tabId: '00000000-0000-4000-8000-000000000001', frameId: '00000000-0000-4000-8000-000000000002', lifecycle: 'complete', visibility: 'visible' },
            viewport: { width: 1280, height: 720, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
            screenshot: { kind: 'inline', encoding: 'base64', data: '', sha256: 'a'.repeat(64), width: 0, height: 0 },
            semanticTargets: [],
        };
    }
    /**
     * Check policy for action
     */
    async checkPolicy() {
        // ponytail: long-horizon verification gate. Block terminate while any
        // must_have criterion is unsatisfied. Surface the reason via the failure
        // event so the harness can log it; the model sees it in the next
        // observation as a corrective.
        if (this.pendingAction?.type === 'terminate') {
            const summary = summarize(this.scratchpadEntries);
            const gate = evaluateTerminationGate({
                criteria: this.criteria,
                verifications: summary.verifications,
            });
            if (!gate.allowed) {
                this.pendingAction = null;
                this.session.fail(gate.reason);
                return;
            }
        }
        // In real implementation, we would evaluate the action against policy
        // For now, we just transition to executing
        this.session.startExecuting();
    }
    /**
     * Wait for approval (for critical actions)
     */
    async waitForApproval() {
        const context = this.session.getContext();
        // Check if approval was received
        if (context.pendingApprovalId) {
            const approval = this.policy.checkApproval(context.pendingApprovalId);
            if (approval.approved) {
                this.session.startExecuting();
            }
            else if (approval.denied || approval.cancelled || approval.expired) {
                this.session.fail(`Approval denied: ${approval.denied ? 'denied' : approval.expired ? 'expired' : 'cancelled'}`);
            }
        }
        await this.sleep(100);
    }
    /**
     * Execute approved action through MCP gateway
     */
    async execute() {
        const action = this.pendingAction;
        if (!action) {
            console.error('No pending action to execute');
            this.session.fail('No action to execute');
            return;
        }
        // ponytail: long-horizon orchestrator-handled actions (read_scratchpad,
        // verify_completion) bypass MCP. They mutate session state and return
        // success — the model observes the result via the next render.
        if (getActionExecutionType(action.type) === ActionExecutionType.ORCHESTRATOR_HANDLED) {
            await this.handleOrchestratorAction(action);
            return;
        }
        const lastObsId = this.session.getContext().lastObservationId;
        const observationId = lastObsId ?? createObservationId(this.observationSequence++);
        try {
            const result = await this.executor.execute(action, observationId);
            // Record result in history (result is already the correct ActionResult type)
            this.history.recordAction({
                action,
                result,
                observationIdAtExecution: observationId,
                executedAt: new Date(),
                durationMs: 0, // TODO: measure actual duration
            });
            // Emit action executed event (session ActionResult has string actionId)
            this.emit('actionExecuted', action, {
                actionId: String(observationId.value),
                success: result.success,
                error: result.success ? undefined : result.error.message,
                observationId,
            });
            // Update session context with last action result
            if (!result.success) {
                this.budget.recordFailedAction();
            }
            // Move to verifying state
            this.session.startVerifying();
        }
        catch (error) {
            console.error('Execution failed:', error);
            this.budget.recordFailedAction();
            this.session.startVerifying();
        }
    }
    /**
     * Handle long-horizon orchestrator actions (read_scratchpad,
     * verify_completion). These mutate session state and bypass MCP entirely.
     *
     * ponytail: kept inline so the action lifecycle is obvious — record result,
     * emit event, move to verifying. No new state machine states needed; the
     * model sees the result via the next render's WORKING MEMORY / CRITERIA
     * blocks.
     */
    async handleOrchestratorAction(action) {
        const ts = Date.now();
        const lastObsId = this.session.getContext().lastObservationId;
        const observationId = lastObsId ?? createObservationId(this.observationSequence++);
        let result;
        if (action.type === 'read_scratchpad') {
            // ponytail: model already sees the summary in the next prompt; this
            // action is essentially a no-op for the orchestrator. Append a marker
            // so we have a record the model asked for the full log (useful for
            // debugging the model's info-seeking behavior).
            await this.scratchpad.append(this.session.getSessionId(), {
                kind: 'memory',
                ts,
                update: { key: 'read_scratchpad_request', value: 'requested full scratchpad', evidence: '' },
            });
            this.scratchpadEntries.push({
                kind: 'memory',
                ts,
                update: { key: 'read_scratchpad_request', value: 'requested full scratchpad', evidence: '' },
            });
            result = createActionSuccess(action.type);
        }
        else if (action.type === 'verify_completion') {
            // ponytail: type narrowing via `as unknown as` — FaraAction union is
            // discriminated by `type` but TS doesn't narrow across the closure.
            const a = action;
            if (!a.criterionId || typeof a.criterionId !== 'string') {
                result = createActionFailure(action.type, ActionErrorCode.UNKNOWN, 'verify_completion requires criterionId');
            }
            else {
                const entry = {
                    kind: 'verify',
                    ts,
                    criterionId: a.criterionId,
                    satisfied: !!a.satisfied,
                    evidence: a.evidence ?? '',
                };
                await this.scratchpad.append(this.session.getSessionId(), entry);
                this.scratchpadEntries.push(entry);
                result = createActionSuccess(action.type);
            }
        }
        else {
            result = createActionFailure(action.type, ActionErrorCode.NOT_SUPPORTED, `Unknown orchestrator action: ${action.type}`);
        }
        this.history.recordAction({
            action,
            result,
            observationIdAtExecution: observationId,
            executedAt: new Date(),
            durationMs: 0,
        });
        this.emit('actionExecuted', action, {
            actionId: String(observationId.value),
            success: result.success,
            error: result.success ? undefined : result.error.message,
            observationId,
        });
        this.session.startVerifying();
    }
    /**
     * Verify action result and detect completion/failure
     */
    async verify() {
        const context = this.session.getContext();
        const goal = context.goal;
        // Record step in budget
        this.budget.recordStep();
        // Check completion
        const completionResult = this.completion.detectCompletion({
            goal,
            goalAchieved: false, // Would be determined by accessibility snapshot
            goalConfidence: 0.5,
            screenshotAvailable: context.currentScreenshot !== null,
        });
        if (completionResult.isComplete) {
            this.session.complete(completionResult.reason);
            return;
        }
        if (completionResult.isFailed) {
            this.session.fail(completionResult.reason);
            return;
        }
        // Continue to next step
        this.session.startObserving();
    }
    /**
     * Handle errors during orchestration
     */
    handleError(error) {
        console.error('Orchestrator error:', error);
        this.emit('error', error);
        // Check if circuit breaker is open
        if (this.resilient.getCircuitState() === CircuitState.OPEN) {
            this.session.fail(`Service unavailable: Circuit breaker open`);
            return;
        }
        // Record failure in budget
        this.budget.recordFailedAction();
        // Check if too many failures
        const status = this.budget.getStatus();
        if (status.usage.consecutiveFailedActions >= status.config.maxConsecutiveFailedActions) {
            this.session.fail(`Too many consecutive failures: ${status.usage.consecutiveFailedActions}`);
            return;
        }
        // Try to continue
        if (this.session.getState() === SessionState.EXECUTING) {
            this.session.startVerifying();
        }
        else {
            this.session.startObserving();
        }
    }
    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * Register event listener
     */
    on(event, listener) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(listener);
    }
    /**
     * Remove event listener
     */
    off(event, listener) {
        this.listeners.get(event)?.delete(listener);
    }
    /**
     * Emit event
     */
    emit(event, ...args) {
        const listeners = this.listeners.get(event);
        if (listeners) {
            for (const listener of listeners) {
                try {
                    listener(...args);
                }
                catch (e) {
                    console.error('Event listener error:', e);
                }
            }
        }
    }
    /**
     * Get current session state
     */
    getSessionState() {
        return this.session.getState();
    }
    /**
     * Get session context
     */
    getContext() {
        return this.session.getContext();
    }
    /**
     * Get budget status
     */
    getBudgetStatus() {
        return this.budget.getStatus();
    }
    /**
     * Get history manager
     */
    getHistory() {
        return this.history;
    }
    /**
     * Check if orchestrator is running
     */
    isActive() {
        return this.isRunning && !this.shouldStop;
    }
    /**
     * Request inference via the new InferencePort-based planner (multi-model).
     * Coexists with the legacy FaraInferenceClient path.
     */
    async requestInferenceViaPlanner(input, signal) {
        if (!this.planner) {
            throw new Error("InferencePort planner not configured on this orchestrator");
        }
        return this.planner.plan(input, signal);
    }
    hasPlanner() {
        return this.planner !== null;
    }
    // Test-only methods
    setPlannerForTesting(planner) {
        this.planner = planner;
    }
    async triggerPlan() {
        await this.plan();
    }
    sessionIdForTesting() {
        return this.session.getSessionId();
    }
    taskIdForTesting() {
        return this.session.getSessionId();
    }
    lastPromptTokensForTesting() {
        return this.lastPromptTokens;
    }
    lastCompletionTokensForTesting() {
        return this.lastCompletionTokens;
    }
    async runPlannerForTesting(input) {
        return this.planner.plan(input, new AbortController().signal);
    }
}
/**
 * Create an orchestrator with configuration
 */
export function createOrchestrator(config) {
    return new AgentOrchestrator(config);
}
//# sourceMappingURL=server.js.map