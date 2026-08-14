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
/**
 * Session states as defined in ARCHITECTURE.md section 3.2
 */
export var SessionState;
(function (SessionState) {
    SessionState["CREATED"] = "CREATED";
    SessionState["WAITING_FOR_CLIENT"] = "WAITING_FOR_CLIENT";
    SessionState["CONNECTED"] = "CONNECTED";
    SessionState["OBSERVING"] = "OBSERVING";
    SessionState["PLANNING"] = "PLANNING";
    SessionState["POLICY_CHECK"] = "POLICY_CHECK";
    SessionState["WAITING_FOR_APPROVAL"] = "WAITING_FOR_APPROVAL";
    SessionState["EXECUTING"] = "EXECUTING";
    SessionState["VERIFYING"] = "VERIFYING";
    SessionState["COMPLETED"] = "COMPLETED";
    SessionState["FAILED"] = "FAILED";
    SessionState["CANCELLED"] = "CANCELLED";
})(SessionState || (SessionState = {}));
/**
 * States that are terminal (session has ended)
 */
const TERMINAL_STATES = [
    SessionState.COMPLETED,
    SessionState.FAILED,
    SessionState.CANCELLED,
];
/**
 * States that indicate the session is actively running
 */
const ACTIVE_STATES = [
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
const VALID_TRANSITIONS = {
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
 * Session state machine
 *
 * Manages the complete lifecycle of a browser automation session per
 * ARCHITECTURE.md section 3.2
 */
export class SessionStateMachine extends EventEmitter {
    config;
    state;
    context;
    history = [];
    constructor(config) {
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
    createInitialContext() {
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
    getState() {
        return this.state;
    }
    /**
     * Get session context
     */
    getContext() {
        return { ...this.context };
    }
    /**
     * Get session ID
     */
    getSessionId() {
        return this.config.sessionId;
    }
    /**
     * Get session goal
     */
    getGoal() {
        return this.config.goal;
    }
    /**
     * Check if session is in a terminal state
     */
    isTerminal() {
        return TERMINAL_STATES.includes(this.state);
    }
    /**
     * Check if session is in an active state
     */
    isActive() {
        return ACTIVE_STATES.includes(this.state);
    }
    /**
     * Check if transition to a new state is valid
     */
    canTransition(newState) {
        return VALID_TRANSITIONS[this.state]?.includes(newState) ?? false;
    }
    /**
     * Transition to a new state
     */
    transition(newState, reason) {
        if (!this.canTransition(newState)) {
            throw new InvalidStateTransitionError(`Cannot transition from ${this.state} to ${newState}`, this.state, newState);
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
        }
        else if (newState === SessionState.FAILED) {
            this.context.failureReason = reason || 'Session failed';
            this.emit('failed', reason || 'Session failed');
        }
        else if (newState === SessionState.CANCELLED) {
            this.emit('cancelled', reason || 'Session cancelled');
        }
    }
    /**
     * Transition to WAITING_FOR_CLIENT state
     */
    waitForClient() {
        this.transition(SessionState.WAITING_FOR_CLIENT);
    }
    /**
     * Transition to CONNECTED state (client has connected)
     */
    clientConnected() {
        if (this.state === SessionState.WAITING_FOR_CLIENT) {
            this.context.connectedAt = new Date();
            this.context.startedAt = new Date();
            this.transition(SessionState.CONNECTED);
        }
    }
    /**
     * Transition to OBSERVING state (capturing browser state)
     */
    startObserving() {
        this.transition(SessionState.OBSERVING);
    }
    /**
     * Transition to PLANNING state (requesting inference)
     */
    startPlanning() {
        this.transition(SessionState.PLANNING);
    }
    /**
     * Transition to POLICY_CHECK state
     */
    checkPolicy() {
        if (this.state === SessionState.PLANNING) {
            this.transition(SessionState.POLICY_CHECK);
        }
    }
    /**
     * Transition to WAITING_FOR_APPROVAL state
     */
    requestApproval(approvalId) {
        this.context.pendingApprovalId = approvalId;
        this.transition(SessionState.WAITING_FOR_APPROVAL);
    }
    /**
     * Transition to EXECUTING state (policy approved or not needed)
     */
    startExecuting() {
        this.context.pendingApprovalId = null;
        if (this.state === SessionState.POLICY_CHECK || this.state === SessionState.WAITING_FOR_APPROVAL) {
            this.transition(SessionState.EXECUTING);
        }
    }
    /**
     * Transition to VERIFYING state (action executed, verifying result)
     */
    startVerifying() {
        this.transition(SessionState.VERIFYING);
    }
    /**
     * Complete the session successfully
     */
    complete(reason) {
        this.transition(SessionState.COMPLETED, reason);
    }
    /**
     * Fail the session
     */
    fail(reason) {
        this.transition(SessionState.FAILED, reason);
    }
    /**
     * Cancel the session
     */
    cancel(reason) {
        this.transition(SessionState.CANCELLED, reason);
    }
    /**
     * Update browser state after observation
     */
    updateBrowserState(state) {
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
    recordActionResult(result) {
        this.context.lastActionResult = result;
    }
    /**
     * Get session history
     */
    getHistory() {
        return [...this.history];
    }
    /**
     * Reset to initial state (for testing)
     */
    reset() {
        this.state = SessionState.CREATED;
        this.context = this.createInitialContext();
        this.history = [];
    }
    /**
     * Register event listeners
     */
    on(event, listener) {
        return super.on(event, listener);
    }
    /**
     * Remove event listeners
     */
    off(event, listener) {
        return super.off(event, listener);
    }
}
/**
 * Invalid state transition error
 */
export class InvalidStateTransitionError extends Error {
    fromState;
    toState;
    constructor(message, fromState, toState) {
        super(message);
        this.fromState = fromState;
        this.toState = toState;
        this.name = 'InvalidStateTransitionError';
    }
}
/**
 * Check if an error is an InvalidStateTransitionError
 */
export function isInvalidStateTransitionError(error) {
    return error instanceof InvalidStateTransitionError;
}
//# sourceMappingURL=session.js.map