/**
 * Session management helpers for the Brotto Platform SDK
 */
import type { SessionState, SessionEvent, ApprovalRequest, ApprovalDecision } from './types.js';
/**
 * Session lease information
 */
export interface SessionLease {
    sessionId: string;
    expiresAt: Date;
    deviceId: string | null;
}
/**
 * Session monitoring options
 */
export interface WatchSessionOptions {
    /** Session ID to watch */
    sessionId: string;
    /** Called when session state changes */
    onStateChange?: (previous: SessionState, current: SessionState) => void;
    /** Called when an action is requested */
    onActionRequested?: (action: unknown) => void;
    /** Called when an action is executed */
    onActionExecuted?: (actionId: string, success: boolean, error?: string) => void;
    /** Called when approval is required */
    onApprovalRequired?: (approval: ApprovalRequest) => void;
    /** Called when an approval decision is made */
    onApprovalDecided?: (approvalId: string, decision: 'approved' | 'denied') => void;
    /** Called on errors */
    onError?: (error: string) => void;
    /** Called on heartbeat */
    onHeartbeat?: (leaseExpiresAt: number) => void;
    /** Called on any event */
    onEvent?: (event: SessionEvent) => void;
}
/**
 * Session state machine helpers
 */
/**
 * Check if a session state is terminal (no further transitions possible)
 */
export declare function isTerminalState(state: SessionState): boolean;
/**
 * Check if a session state indicates the session is active
 */
export declare function isActiveState(state: SessionState): boolean;
/**
 * Check if a session state indicates it's waiting for user input
 */
export declare function isWaitingState(state: SessionState): boolean;
/**
 * Human-readable description of session states
 */
export declare const SESSION_STATE_DESCRIPTIONS: Record<SessionState, string>;
/**
 * Get a human-readable description of a session state
 */
export declare function getStateDescription(state: SessionState): string;
/**
 * Session metrics
 */
export interface SessionMetrics {
    sessionId: string;
    startedAt: Date;
    lastHeartbeatAt: Date;
    state: SessionState;
    actionCount: number;
    approvalCount: number;
    deniedApprovalCount: number;
}
/**
 * Calculate session metrics from events
 */
export declare function calculateSessionMetrics(sessionId: string, startedAt: Date, events: SessionEvent[]): SessionMetrics;
/**
 * Session event filter
 */
export type SessionEventFilter = (event: SessionEvent) => boolean;
/**
 * Filter events by type
 */
export declare function filterEventsByType(events: SessionEvent[], types: SessionEvent['type'][]): SessionEvent[];
/**
 * Filter events since a timestamp
 */
export declare function filterEventsSince(events: SessionEvent[], timestamp: number): SessionEvent[];
/**
 * Filter events until a timestamp
 */
export declare function filterEventsUntil(events: SessionEvent[], timestamp: number): SessionEvent[];
/**
 * Session replay - replay events to reconstruct session history
 */
export declare class SessionReplay {
    private events;
    private currentIndex;
    constructor(events?: SessionEvent[]);
    /**
     * Add an event to the replay
     */
    addEvent(event: SessionEvent): void;
    /**
     * Get all events
     */
    getEvents(): SessionEvent[];
    /**
     * Get events from current position
     */
    getRemainingEvents(): SessionEvent[];
    /**
     * Advance to next event
     */
    next(): SessionEvent | null;
    /**
     * Peek at next event without advancing
     */
    peek(): SessionEvent | null;
    /**
     * Check if there are more events
     */
    hasNext(): boolean;
    /**
     * Reset to beginning
     */
    reset(): void;
    /**
     * Get events by type
     */
    getEventsByType(type: SessionEvent['type']): SessionEvent[];
    /**
     * Calculate metrics from events
     */
    getMetrics(startedAt: Date): SessionMetrics;
}
/**
 * Approval helpers
 */
/**
 * Check if an approval request is still pending
 */
export declare function isApprovalPending(approval: ApprovalRequest): boolean;
/**
 * Check if an approval request has expired
 */
export declare function isApprovalExpired(approval: ApprovalRequest): boolean;
/**
 * Format approval request for display
 */
export declare function formatApprovalSummary(approval: ApprovalRequest): string;
/**
 * Build approval decision options
 */
export declare function buildApprovalDecision(approvalId: string, approve: boolean, reason?: string): ApprovalDecision & {
    reason?: string;
};
//# sourceMappingURL=session.d.ts.map