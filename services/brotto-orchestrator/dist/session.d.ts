/**
 * Session State Machine
 *
 * Manages the lifecycle of a browser automation session through states:
 * CREATED → WAITING_FOR_CLIENT → CONNECTED → OBSERVING → PLANNING →
 * POLICY_CHECK → WAITING_FOR_APPROVAL → EXECUTING → VERIFYING →
 * COMPLETED / FAILED / CANCELLED
 *
 * Per ARCHITECTURE.md section 3.2
 */
import { EventEmitter } from 'events';
import type { ObservationId } from '@brotto/brotto-action-schema';
/**
 * Session states as defined in ARCHITECTURE.md section 3.2
 */
export declare enum SessionState {
    CREATED = "CREATED",
    WAITING_FOR_CLIENT = "WAITING_FOR_CLIENT",
    CONNECTED = "CONNECTED",
    OBSERVING = "OBSERVING",
    PLANNING = "PLANNING",
    POLICY_CHECK = "POLICY_CHECK",
    WAITING_FOR_APPROVAL = "WAITING_FOR_APPROVAL",
    EXECUTING = "EXECUTING",
    VERIFYING = "VERIFYING",
    COMPLETED = "COMPLETED",
    FAILED = "FAILED",
    CANCELLED = "CANCELLED"
}
/**
 * Session configuration
 */
export interface SessionConfig {
    sessionId: string;
    goal: string;
    tenantId: string;
    userId: string;
    maxHistorySize?: number;
    maxScreenshotHistorySize?: number;
}
/**
 * Session context passed through the state machine
 */
export interface SessionContext {
    sessionId: string;
    goal: string;
    tenantId: string;
    userId: string;
    currentState: SessionState;
    lastObservationId: ObservationId | null;
    currentScreenshot: Buffer | null;
    currentUrl: string | null;
    currentDomain: string | null;
    lastActionResult: ActionResult | null;
    pendingApprovalId: string | null;
    failureReason: string | null;
    startedAt: Date | null;
    connectedAt: Date | null;
}
/**
 * Action result for tracking
 */
export interface ActionResult {
    actionId: string;
    success: boolean;
    error?: string;
    observationId: ObservationId;
}
/**
 * Session events
 */
export interface SessionEvents {
    stateChanged: (oldState: SessionState, newState: SessionState) => void;
    error: (error: Error) => void;
    completed: (reason: string) => void;
    failed: (reason: string) => void;
    cancelled: (reason: string) => void;
}
/**
 * Session state machine
 *
 * Manages the complete lifecycle of a browser automation session per
 * ARCHITECTURE.md section 3.2
 */
export declare class SessionStateMachine extends EventEmitter {
    private config;
    private state;
    private context;
    private history;
    constructor(config: SessionConfig);
    /**
     * Create initial session context
     */
    private createInitialContext;
    /**
     * Get current session state
     */
    getState(): SessionState;
    /**
     * Get session context
     */
    getContext(): Readonly<SessionContext>;
    /**
     * Get session ID
     */
    getSessionId(): string;
    /**
     * Get session goal
     */
    getGoal(): string;
    /**
     * Check if session is in a terminal state
     */
    isTerminal(): boolean;
    /**
     * Check if session is in an active state
     */
    isActive(): boolean;
    /**
     * Check if transition to a new state is valid
     */
    canTransition(newState: SessionState): boolean;
    /**
     * Transition to a new state
     */
    transition(newState: SessionState, reason?: string): void;
    /**
     * Transition to WAITING_FOR_CLIENT state
     */
    waitForClient(): void;
    /**
     * Transition to CONNECTED state (client has connected)
     */
    clientConnected(): void;
    /**
     * Transition to OBSERVING state (capturing browser state)
     */
    startObserving(): void;
    /**
     * Transition to PLANNING state (requesting inference)
     */
    startPlanning(): void;
    /**
     * Transition to POLICY_CHECK state
     */
    checkPolicy(): void;
    /**
     * Transition to WAITING_FOR_APPROVAL state
     */
    requestApproval(approvalId: string): void;
    /**
     * Transition to EXECUTING state (policy approved or not needed)
     */
    startExecuting(): void;
    /**
     * Transition to VERIFYING state (action executed, verifying result)
     */
    startVerifying(): void;
    /**
     * Complete the session successfully
     */
    complete(reason?: string): void;
    /**
     * Fail the session
     */
    fail(reason: string): void;
    /**
     * Cancel the session
     */
    cancel(reason?: string): void;
    /**
     * Update browser state after observation
     */
    updateBrowserState(state: {
        screenshot?: Buffer;
        url?: string;
        domain?: string;
        observationId?: ObservationId;
    }): void;
    /**
     * Record action result
     */
    recordActionResult(result: ActionResult): void;
    /**
     * Get session history
     */
    getHistory(): ReadonlyArray<SessionHistoryEntry>;
    /**
     * Reset to initial state (for testing)
     */
    reset(): void;
    /**
     * Register event listeners
     */
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    /**
     * Remove event listeners
     */
    off(event: string | symbol, listener: (...args: any[]) => void): this;
}
/**
 * History entry for state transitions
 */
export interface SessionHistoryEntry {
    timestamp: Date;
    fromState: SessionState;
    toState: SessionState;
    reason?: string;
}
/**
 * Invalid state transition error
 */
export declare class InvalidStateTransitionError extends Error {
    readonly fromState: SessionState;
    readonly toState: SessionState;
    constructor(message: string, fromState: SessionState, toState: SessionState);
}
/**
 * Check if an error is an InvalidStateTransitionError
 */
export declare function isInvalidStateTransitionError(error: unknown): error is InvalidStateTransitionError;
//# sourceMappingURL=session.d.ts.map