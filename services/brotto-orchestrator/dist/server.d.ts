/**
 * Agent Orchestrator Server
 *
 * Main entry point for the Agent Orchestrator service.
 * Coordinates session state machine, Brotto inference, policy enforcement,
 * and MCP action execution as specified in ARCHITECTURE.md section 3.2
 */
import { SessionStateMachine, SessionState, type ActionResult } from './session.js';
import { HistoryManager } from './history.js';
import { type LegacyInferenceConfig } from './inference.js';
import { type InferenceConfig } from './inference-registry.js';
import type { InferencePort, PlanningInput, PlanningOutcome } from './engine/types.js';
import type { McpGatewayClient } from './executor.js';
import { type FaraAction, type ObservationV1 } from '@brotto/brotto-action-schema';
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
    /** @deprecated Legacy FaraInferenceClient path. Use plannerConfig. */
    inference?: LegacyInferenceConfig;
    /** Multi-model planner via InferencePort (Brotto + OpenAI-compatible). */
    plannerConfig: InferenceConfig;
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
    inferenceCompleted: (result: {
        toolCalls: number;
        tokens: number;
    }) => void;
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
export declare class AgentOrchestrator {
    private session;
    private history;
    private legacyInference;
    private parser;
    private policy;
    private completion;
    private budget;
    private resilient;
    private executor;
    private planner;
    private listeners;
    private isRunning;
    private shouldStop;
    private observationSequence;
    private pendingAction;
    private lastPromptTokens;
    private lastCompletionTokens;
    private abortController;
    private lastObservation;
    private scratchpad;
    private criteria;
    private scratchpadEntries;
    constructor(config: OrchestratorConfig);
    /**
     * Start the orchestrator
     */
    start(): Promise<void>;
    /**
     * Stop the orchestrator
     */
    stop(reason?: string): void;
    /**
     * Main orchestration loop
     */
    private run;
    /**
     * Wait for client connection
     */
    private waitForClient;
    /**
     * Observe browser state - capture screenshot
     */
    private observe;
    /**
     * Request inference via InferencePort planner
     */
    private plan;
    private handlePlanningOutcome;
    protected captureObservation(): Promise<ObservationV1>;
    private buildEmptyObservation;
    /**
     * Check policy for action
     */
    private checkPolicy;
    /**
     * Wait for approval (for critical actions)
     */
    private waitForApproval;
    /**
     * Execute approved action through MCP gateway
     */
    private execute;
    /**
     * Handle long-horizon orchestrator actions (read_scratchpad,
     * verify_completion). These mutate session state and bypass MCP entirely.
     *
     * ponytail: kept inline so the action lifecycle is obvious — record result,
     * emit event, move to verifying. No new state machine states needed; the
     * model sees the result via the next render's WORKING MEMORY / CRITERIA
     * blocks.
     */
    private handleOrchestratorAction;
    /**
     * Verify action result and detect completion/failure
     */
    private verify;
    /**
     * Handle errors during orchestration
     */
    private handleError;
    /**
     * Sleep utility
     */
    private sleep;
    /**
     * Register event listener
     */
    on<K extends keyof OrchestratorEvents>(event: K, listener: OrchestratorEvents[K]): void;
    /**
     * Remove event listener
     */
    off<K extends keyof OrchestratorEvents>(event: K, listener: OrchestratorEvents[K]): void;
    /**
     * Emit event
     */
    private emit;
    /**
     * Get current session state
     */
    getSessionState(): SessionState;
    /**
     * Get session context
     */
    getContext(): Readonly<import("./session.js").SessionContext>;
    /**
     * Get budget status
     */
    getBudgetStatus(): {
        exhaustedBudgets: string[];
        warnings: string[];
        isWithinBudget: boolean;
        usage: {
            steps: number;
            consecutiveFailedActions: number;
            repeatedNavigationCount: number;
            navigationHistory: string[];
            totalTokensUsed: number;
            inputTokens: number;
            outputTokens: number;
            totalExternalDomains: number;
            externalDomainsVisited: string[];
            currentTabCount: number;
            totalRetryCount: number;
            totalCostCents: number;
            screenshotBytesTotal: number;
            uploadBytesTotal: number;
            downloadBytesTotal: number;
            sessionStartTime?: Date | undefined;
            lastActionTime?: Date | undefined;
        };
        config: {
            maxSteps: number;
            maxSessionDurationMs: number;
            maxConsecutiveFailedActions: number;
            maxRepeatedNavigationLoops: number;
            maxScreenshotSizeBytes: number;
            maxUploadSizeBytes: number;
            maxDownloadSizeBytes: number;
            maxModelTokens: number;
            maxExternalDomains: number;
            maxTabCount: number;
            maxRetryCount: number;
            maxCostCents: number;
        };
        percentages: Record<string, number>;
    };
    /**
     * Get history manager
     */
    getHistory(): HistoryManager;
    /**
     * Check if orchestrator is running
     */
    isActive(): boolean;
    /**
     * Request inference via the new InferencePort-based planner (multi-model).
     * Coexists with the legacy FaraInferenceClient path.
     */
    requestInferenceViaPlanner(input: PlanningInput, signal: AbortSignal): Promise<PlanningOutcome>;
    hasPlanner(): boolean;
    setPlannerForTesting(planner: InferencePort): void;
    triggerPlan(): Promise<void>;
    sessionIdForTesting(): string;
    taskIdForTesting(): string;
    lastPromptTokensForTesting(): number;
    lastCompletionTokensForTesting(): number;
    runPlannerForTesting(input: PlanningInput): Promise<PlanningOutcome>;
}
/**
 * Create an orchestrator with configuration
 */
export declare function createOrchestrator(config: OrchestratorConfig): AgentOrchestrator;
//# sourceMappingURL=server.d.ts.map