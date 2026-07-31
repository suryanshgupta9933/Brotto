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
import type { ObservationId } from '@fara/fara-action-schema';

/**
 * Session states as defined in ARCHITECTURE.md section 3.2
 */
export enum SessionState {
  CREATED = 'CREATED',
  WAITING_FOR_CLIENT = 'WAITING_FOR_CLIENT',
  CONNECTED = 'CONNECTED',
  OBSERVING = 'OBSERVING',
  PLANNING = 'PLANNING',
  POLICY_CHECK = 'POLICY_CHECK',
  WAITING_FOR_APPROVAL = 'WAITING_FOR_APPROVAL',
  EXECUTING = 'EXECUTING',
  VERIFYING = 'VERIFYING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/**
 * States that are terminal (session has ended)
 */
const TERMINAL_STATES: SessionState[] = [
  SessionState.COMPLETED,
  SessionState.FAILED,
  SessionState.CANCELLED,
];

/**
 * States that indicate the session is actively running
 */
const ACTIVE_STATES: SessionState[] = [
  SessionState.WAITING_FOR_CLIENT,
  SessionState.CONNECTED,
  SessionState.OBSERVING,
  SessionState.PLANNING,
  SessionState.POLICY_CHECK,
  SessionState.WAITING_FOR_APPROVAL,
  SessionState.EXECUTING,
  SessionState.VERIFYING,
];

/**
 * Valid state transitions
 */
const VALID_TRANSITIONS: Record<SessionState, SessionState[]> = {
  [SessionState.CREATED]: [SessionState.WAITING_FOR_CLIENT, SessionState.CANCELLED],
  [SessionState.WAITING_FOR_CLIENT]: [SessionState.CONNECTED, SessionState.CANCELLED],
  [SessionState.CONNECTED]: [SessionState.OBSERVING, SessionState.CANCELLED],
  [SessionState.OBSERVING]: [SessionState.PLANNING, SessionState.FAILED, SessionState.CANCELLED],
  [SessionState.PLANNING]: [SessionState.POLICY_CHECK, SessionState.FAILED, SessionState.CANCELLED],
  [SessionState.POLICY_CHECK]: [
    SessionState.WAITING_FOR_APPROVAL,
    SessionState.EXECUTING,
    SessionState.OBSERVING,
    SessionState.FAILED,
    SessionState.CANCELLED,
  ],
  [SessionState.WAITING_FOR_APPROVAL]: [
    SessionState.EXECUTING,
    SessionState.OBSERVING,
    SessionState.FAILED,
    SessionState.CANCELLED,
  ],
  [SessionState.EXECUTING]: [SessionState.VERIFYING, SessionState.FAILED, SessionState.CANCELLED],
  [SessionState.VERIFYING]: [
    SessionState.OBSERVING,
    SessionState.PLANNING,
    SessionState.COMPLETED,
    SessionState.FAILED,
    SessionState.CANCELLED,
  ],
  [SessionState.COMPLETED]: [],
  [SessionState.FAILED]: [],
  [SessionState.CANCELLED]: [],
};

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
export class SessionStateMachine extends EventEmitter {
  private config: SessionConfig;
  private state: SessionState;
  private context: SessionContext;
  private history: SessionHistoryEntry[] = [];
  private listeners: Partial<SessionEvents> = {};

  constructor(config: SessionConfig) {
    super();
    this.config = {
      maxHistorySize: 100,
      maxScreenshotHistorySize: 10,
      ...config,
    };
    this.state = SessionState.CREATED;
    this.context = this.createInitialContext();
  }

  /**
   * Create initial session context
   */
  private createInitialContext(): SessionContext {
    return {
      sessionId: this.config.sessionId,
      goal: this.config.goal,
      tenantId: this.config.tenantId,
      userId: this.config.userId,
      currentState: SessionState.CREATED,
      lastObservationId: null,
      currentScreenshot: null,
      currentUrl: null,
      currentDomain: null,
      lastActionResult: null,
      pendingApprovalId: null,
      failureReason: null,
      startedAt: null,
      connectedAt: null,
    };
  }

  /**
   * Get current session state
   */
  getState(): SessionState {
    return this.state;
  }

  /**
   * Get session context
   */
  getContext(): Readonly<SessionContext> {
    return { ...this.context };
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.config.sessionId;
  }

  /**
   * Get session goal
   */
  getGoal(): string {
    return this.config.goal;
  }

  /**
   * Check if session is in a terminal state
   */
  isTerminal(): boolean {
    return TERMINAL_STATES.includes(this.state);
  }

  /**
   * Check if session is in an active state
   */
  isActive(): boolean {
    return ACTIVE_STATES.includes(this.state);
  }

  /**
   * Check if transition to a new state is valid
   */
  canTransition(newState: SessionState): boolean {
    return VALID_TRANSITIONS[this.state]?.includes(newState) ?? false;
  }

  /**
   * Transition to a new state
   */
  transition(newState: SessionState, reason?: string): void {
    if (!this.canTransition(newState)) {
      throw new InvalidStateTransitionError(
        `Cannot transition from ${this.state} to ${newState}`,
        this.state,
        newState
      );
    }

    const oldState = this.state;
    this.state = newState;
    this.context.currentState = newState;

    // Record in history
    this.history.push({
      timestamp: new Date(),
      fromState: oldState,
      toState: newState,
      reason,
    });

    // Emit events
    this.emit('stateChanged', oldState, newState);

    // Handle terminal states
    if (newState === SessionState.COMPLETED) {
      this.emit('completed', reason || 'Session completed normally');
    } else if (newState === SessionState.FAILED) {
      this.context.failureReason = reason || 'Session failed';
      this.emit('failed', reason || 'Session failed');
    } else if (newState === SessionState.CANCELLED) {
      this.emit('cancelled', reason || 'Session cancelled');
    }
  }

  /**
   * Transition to WAITING_FOR_CLIENT state
   */
  waitForClient(): void {
    this.transition(SessionState.WAITING_FOR_CLIENT);
  }

  /**
   * Transition to CONNECTED state (client has connected)
   */
  clientConnected(): void {
    if (this.state === SessionState.WAITING_FOR_CLIENT) {
      this.context.connectedAt = new Date();
      this.context.startedAt = new Date();
      this.transition(SessionState.CONNECTED);
    }
  }

  /**
   * Transition to OBSERVING state (capturing browser state)
   */
  startObserving(): void {
    this.transition(SessionState.OBSERVING);
  }

  /**
   * Transition to PLANNING state (requesting inference)
   */
  startPlanning(): void {
    if (this.state === SessionState.OBSERVING) {
      this.transition(SessionState.PLANNING);
    }
  }

  /**
   * Transition to POLICY_CHECK state
   */
  checkPolicy(): void {
    if (this.state === SessionState.PLANNING) {
      this.transition(SessionState.POLICY_CHECK);
    }
  }

  /**
   * Transition to WAITING_FOR_APPROVAL state
   */
  requestApproval(approvalId: string): void {
    this.context.pendingApprovalId = approvalId;
    this.transition(SessionState.WAITING_FOR_APPROVAL);
  }

  /**
   * Transition to EXECUTING state (policy approved or not needed)
   */
  startExecuting(): void {
    this.context.pendingApprovalId = null;
    if (this.state === SessionState.POLICY_CHECK || this.state === SessionState.WAITING_FOR_APPROVAL) {
      this.transition(SessionState.EXECUTING);
    }
  }

  /**
   * Transition to VERIFYING state (action executed, verifying result)
   */
  startVerifying(): void {
    this.transition(SessionState.VERIFYING);
  }

  /**
   * Complete the session successfully
   */
  complete(reason?: string): void {
    this.transition(SessionState.COMPLETED, reason);
  }

  /**
   * Fail the session
   */
  fail(reason: string): void {
    this.transition(SessionState.FAILED, reason);
  }

  /**
   * Cancel the session
   */
  cancel(reason?: string): void {
    this.transition(SessionState.CANCELLED, reason);
  }

  /**
   * Update browser state after observation
   */
  updateBrowserState(state: {
    screenshot?: Buffer;
    url?: string;
    domain?: string;
    observationId?: ObservationId;
  }): void {
    if (state.screenshot !== undefined) {
      this.context.currentScreenshot = state.screenshot;
    }
    if (state.url !== undefined) {
      this.context.currentUrl = state.url;
    }
    if (state.domain !== undefined) {
      this.context.currentDomain = state.domain;
    }
    if (state.observationId !== undefined) {
      this.context.lastObservationId = state.observationId;
    }
  }

  /**
   * Record action result
   */
  recordActionResult(result: ActionResult): void {
    this.context.lastActionResult = result;
  }

  /**
   * Get session history
   */
  getHistory(): ReadonlyArray<SessionHistoryEntry> {
    return [...this.history];
  }

  /**
   * Reset to initial state (for testing)
   */
  reset(): void {
    this.state = SessionState.CREATED;
    this.context = this.createInitialContext();
    this.history = [];
  }

  /**
   * Register event listeners
   */
  on<K extends keyof SessionEvents>(event: K, listener: SessionEvents[K]): void {
    this.listeners[event] = listener;
    super.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Remove event listeners
   */
  off<K extends keyof SessionEvents>(event: K, listener: SessionEvents[K]): void {
    delete this.listeners[event];
    super.off(event, listener as (...args: unknown[]) => void);
  }
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
export class InvalidStateTransitionError extends Error {
  constructor(
    message: string,
    public readonly fromState: SessionState,
    public readonly toState: SessionState
  ) {
    super(message);
    this.name = 'InvalidStateTransitionError';
  }
}

/**
 * Check if an error is an InvalidStateTransitionError
 */
export function isInvalidStateTransitionError(error: unknown): error is InvalidStateTransitionError {
  return error instanceof InvalidStateTransitionError;
}
