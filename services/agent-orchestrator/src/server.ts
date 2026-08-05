/**
 * Agent Orchestrator Server
 *
 * Main entry point for the Agent Orchestrator service.
 * Coordinates session state machine, Fara inference, policy enforcement,
 * and MCP action execution as specified in ARCHITECTURE.md section 3.2
 */

import {
  SessionStateMachine,
  SessionState,
  type SessionConfig,
  type ActionResult,
} from './session.js';
import { HistoryManager } from './history.js';
import { FaraInferenceClient, type InferenceConfig } from './inference.js';
import { ToolCallParser, createToolCallParser } from './parser.js';
import { PolicyIntegrator, createPolicyIntegrator } from './policy.js';
import type { McpGatewayClient } from './executor.js';
import { CompletionDetector, createCompletionDetector } from './completion.js';
import { AgentBudgetTracker, createAgentBudgetTracker } from './budget.js';
import {
  ResilientExecutor,
  createResilientExecutor,
  CircuitState,
} from './retry.js';
import {
  type FaraAction,
  type ObservationId,
  createObservationId,
} from '@fara-platform/fara-action-schema';
import { ActionExecutor, createActionExecutor } from './executor.js';

// Default approval timeout in milliseconds (5 minutes)
const APPROVAL_DEFAULT_TIMEOUT_MS = parseInt(process.env.APPROVAL_DEFAULT_TIMEOUT_MS ?? '300000', 10);

/**
 * Orchestrator server configuration
 */
export interface OrchestratorConfig {
  session: {
    sessionId: string;
    goal: string;
    tenantId: string;
    userId: string;
  };
  inference: InferenceConfig;
  mcpGateway: McpGatewayClient;
  budget?: {
    maxSteps?: number;
    maxSessionDurationMs?: number;
    maxConsecutiveFailedActions?: number;
  };
}

/**
 * Orchestrator events
 */
export interface OrchestratorEvents {
  stateChanged: (session: SessionStateMachine, oldState: SessionState, newState: SessionState) => void;
  actionExecuted: (action: FaraAction, result: ActionResult) => void;
  inferenceCompleted: (result: { toolCalls: number; tokens: number }) => void;
  error: (error: Error) => void;
  budgetWarning: (message: string) => void;
  completed: (reason: string) => void;
  failed: (reason: string) => void;
}

/**
 * Orchestrator event listener
 */
export type OrchestratorEventListener = (event: OrchestratorEvents[keyof OrchestratorEvents]) => void;

/**
 * Agent Orchestrator
 *
 * Main orchestrator that coordinates all components per ARCHITECTURE.md section 3.2
 */
export class AgentOrchestrator {
  private session: SessionStateMachine;
  private history: HistoryManager;
  private inference: FaraInferenceClient;
  private parser: ToolCallParser;
  private policy: PolicyIntegrator;
  private completion: CompletionDetector;
  private budget: AgentBudgetTracker;
  private resilient: ResilientExecutor;
  private executor: ActionExecutor;
  private listeners: Map<string, Set<OrchestratorEventListener>>;
  private isRunning = false;
  private shouldStop = false;
  private observationSequence = 0;
  private pendingAction: FaraAction | null = null;

  constructor(config: OrchestratorConfig) {
    this.listeners = new Map();

    // Initialize session
    const sessionConfig: SessionConfig = {
      sessionId: config.session.sessionId,
      goal: config.session.goal,
      tenantId: config.session.tenantId,
      userId: config.session.userId,
    };
    this.session = new SessionStateMachine(sessionConfig);

    // Initialize components
    this.history = new HistoryManager({
      maxActionHistory: 100,
      maxScreenshotHistory: 10,
      maxRecentActionsForPrompt: 5,
    });

    this.inference = new FaraInferenceClient(config.inference);

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

    this.resilient = createResilientExecutor(
      { failureThreshold: 5, timeoutMs: 30000 },
      { maxRetries: 3 }
    );

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
  async start(): Promise<void> {
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
  stop(reason?: string): void {
    this.shouldStop = true;
    this.isRunning = false;
    this.inference.cancel();

    if (this.session.isActive()) {
      this.session.cancel(reason ?? 'Stopped by user');
    }
  }

  /**
   * Main orchestration loop
   */
  private async run(): Promise<void> {
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
      } catch (error) {
        this.handleError(error as Error);
      }
    }
  }

  /**
   * Wait for client connection
   */
  private async waitForClient(): Promise<void> {
    // This would typically wait for an event from the control plane
    // For now, we simulate client connection after a short delay
    await this.sleep(100);
    // In real implementation, this would be event-driven
    this.session.clientConnected();
  }

  /**
   * Observe browser state - capture screenshot
   */
  private async observe(): Promise<void> {
    // Update parser with current observation ID
    const observationId = createObservationId(this.observationSequence++);
    this.parser.setCurrentObservationId(observationId.value);

    // In real implementation, this would take a screenshot via executor
    // For now, we just transition to planning
    this.session.startPlanning();
  }

  /**
   * Request inference from Fara
   */
  private async plan(): Promise<void> {
    const context = this.session.getContext();
    const goal = context.goal;

    // Build prompt context
    const promptContext = this.history.buildPromptContext({
      goal,
      includeActionsCount: 5,
      includeMemories: true,
    });

    // Get current screenshot
    const screenshot = context.currentScreenshot;

    // Build messages for inference
    const systemMessage = this.inference.buildSystemPrompt();
    const userMessage = this.inference.buildUserMessage(promptContext);

    // Request inference
    const result = await this.resilient.execute(
      'inference',
      async () =>
        this.inference.infer(
          [
            { role: 'system', content: systemMessage },
            { role: 'user', content: userMessage },
          ],
          {
            imageBase64: screenshot?.toString('base64'),
          }
        )
    );

    // Record token usage
    this.budget.recordTokens(result.usage.promptTokens, result.usage.completionTokens);

    this.emit('inferenceCompleted', {
      toolCalls: result.toolCalls.length,
      tokens: result.usage.totalTokens,
    });

    // Parse tool calls
    const parseResult = this.parser.parse(result.toolCalls);

    if (parseResult.errors.length > 0) {
      // Log parse errors but continue
      for (const error of parseResult.errors) {
        console.error('Parse error:', error);
      }
    }

    if (parseResult.actions.length === 0) {
      // No valid actions, go back to observing
      this.session.startObserving();
      return;
    }

    // Store the first action for execution
    this.pendingAction = parseResult.actions[0].action;

    // Move to policy check with first action
    this.session.checkPolicy();
  }

  /**
   * Check policy for action
   */
  private async checkPolicy(): Promise<void> {
    // In real implementation, we would evaluate the action against policy
    // For now, we just transition to executing
    this.session.startExecuting();
  }

  /**
   * Wait for approval (for critical actions)
   */
  private async waitForApproval(): Promise<void> {
    const context = this.session.getContext();

    // Check if approval was received
    if (context.pendingApprovalId) {
      const approval = this.policy.checkApproval(context.pendingApprovalId);

      if (approval.approved) {
        this.session.startExecuting();
      } else if (approval.denied || approval.cancelled || approval.expired) {
        this.session.fail(`Approval denied: ${approval.denied ? 'denied' : approval.expired ? 'expired' : 'cancelled'}`);
      }
    }

    await this.sleep(100);
  }

  /**
   * Execute approved action through MCP gateway
   */
  private async execute(): Promise<void> {
    const action = this.pendingAction;
    if (!action) {
      console.error('No pending action to execute');
      this.session.fail('No action to execute');
      return;
    }

    const lastObsId = this.session.getContext().lastObservationId;
    const observationId: ObservationId = lastObsId ?? createObservationId(this.observationSequence++);

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
    } catch (error) {
      console.error('Execution failed:', error);
      this.budget.recordFailedAction();
      this.session.startVerifying();
    }
  }

  /**
   * Verify action result and detect completion/failure
   */
  private async verify(): Promise<void> {
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
  private handleError(error: Error): void {
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
    } else {
      this.session.startObserving();
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Register event listener
   */
  on<K extends keyof OrchestratorEvents>(event: K, listener: OrchestratorEvents[K]): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as unknown as OrchestratorEventListener);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof OrchestratorEvents>(event: K, listener: OrchestratorEvents[K]): void {
    this.listeners.get(event)?.delete(listener as unknown as OrchestratorEventListener);
  }

  /**
   * Emit event
   */
  private emit<K extends keyof OrchestratorEvents>(event: K, ...args: Parameters<OrchestratorEvents[K]>): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          (listener as (...args: unknown[]) => void)(...args);
        } catch (e) {
          console.error('Event listener error:', e);
        }
      }
    }
  }

  /**
   * Get current session state
   */
  getSessionState(): SessionState {
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
  getHistory(): HistoryManager {
    return this.history;
  }

  /**
   * Check if orchestrator is running
   */
  isActive(): boolean {
    return this.isRunning && !this.shouldStop;
  }
}

/**
 * Create an orchestrator with configuration
 */
export function createOrchestrator(config: OrchestratorConfig): AgentOrchestrator {
  return new AgentOrchestrator(config);
}
