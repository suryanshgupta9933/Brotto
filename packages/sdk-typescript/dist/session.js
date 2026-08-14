/**
 * Session management helpers for the Brotto Platform SDK
 */
/**
 * Session state machine helpers
 */
/**
 * Check if a session state is terminal (no further transitions possible)
 */
export function isTerminalState(state) {
    return ['completed', 'failed', 'cancelled'].includes(state);
}
/**
 * Check if a session state indicates the session is active
 */
export function isActiveState(state) {
    return !isTerminalState(state) && state !== 'created' && state !== 'waiting_for_client';
}
/**
 * Check if a session state indicates it's waiting for user input
 */
export function isWaitingState(state) {
    return ['waiting_for_approval', 'waiting_for_client'].includes(state);
}
/**
 * Human-readable description of session states
 */
export const SESSION_STATE_DESCRIPTIONS = {
    created: 'Session has been created but not yet started',
    waiting_for_client: 'Waiting for client device to connect',
    connected: 'Client device connected',
    observing: 'Browser agent is observing the page',
    planning: 'Agent is planning next action',
    policy_check: 'Action is being checked against policies',
    waiting_for_approval: 'Waiting for user approval to proceed',
    executing: 'Action is being executed',
    verifying: 'Verifying action result',
    completed: 'Session completed successfully',
    failed: 'Session failed',
    cancelled: 'Session was cancelled',
};
/**
 * Get a human-readable description of a session state
 */
export function getStateDescription(state) {
    return SESSION_STATE_DESCRIPTIONS[state] || 'Unknown state';
}
/**
 * Calculate session metrics from events
 */
export function calculateSessionMetrics(sessionId, startedAt, events) {
    let actionCount = 0;
    let approvalCount = 0;
    let deniedApprovalCount = 0;
    let lastHeartbeatAt = startedAt;
    let currentState = 'created';
    for (const event of events) {
        if (event.type === 'action_executed') {
            actionCount++;
        }
        else if (event.type === 'approval_required') {
            approvalCount++;
        }
        else if (event.type === 'approval_decided') {
            const payload = event.payload;
            if (payload.decision === 'denied') {
                deniedApprovalCount++;
            }
        }
        else if (event.type === 'state_changed') {
            const payload = event.payload;
            if (payload.newState) {
                currentState = payload.newState;
            }
        }
        else if (event.type === 'heartbeat') {
            lastHeartbeatAt = new Date(event.timestamp);
        }
    }
    return {
        sessionId,
        startedAt,
        lastHeartbeatAt,
        state: currentState,
        actionCount,
        approvalCount,
        deniedApprovalCount,
    };
}
/**
 * Filter events by type
 */
export function filterEventsByType(events, types) {
    const typeSet = new Set(types);
    return events.filter((event) => typeSet.has(event.type));
}
/**
 * Filter events since a timestamp
 */
export function filterEventsSince(events, timestamp) {
    return events.filter((event) => event.timestamp >= timestamp);
}
/**
 * Filter events until a timestamp
 */
export function filterEventsUntil(events, timestamp) {
    return events.filter((event) => event.timestamp <= timestamp);
}
/**
 * Session replay - replay events to reconstruct session history
 */
export class SessionReplay {
    events = [];
    currentIndex = 0;
    constructor(events = []) {
        this.events = events;
        this.currentIndex = 0;
    }
    /**
     * Add an event to the replay
     */
    addEvent(event) {
        this.events.push(event);
    }
    /**
     * Get all events
     */
    getEvents() {
        return [...this.events];
    }
    /**
     * Get events from current position
     */
    getRemainingEvents() {
        return this.events.slice(this.currentIndex);
    }
    /**
     * Advance to next event
     */
    next() {
        if (this.currentIndex >= this.events.length) {
            return null;
        }
        return this.events[this.currentIndex++];
    }
    /**
     * Peek at next event without advancing
     */
    peek() {
        if (this.currentIndex >= this.events.length) {
            return null;
        }
        return this.events[this.currentIndex];
    }
    /**
     * Check if there are more events
     */
    hasNext() {
        return this.currentIndex < this.events.length;
    }
    /**
     * Reset to beginning
     */
    reset() {
        this.currentIndex = 0;
    }
    /**
     * Get events by type
     */
    getEventsByType(type) {
        return filterEventsByType(this.events, [type]);
    }
    /**
     * Calculate metrics from events
     */
    getMetrics(startedAt) {
        return calculateSessionMetrics(this.events[0]?.payload && typeof this.events[0] === 'object' && 'sessionId' in this.events[0]
            ? this.events[0].sessionId
            : 'unknown', startedAt, this.events);
    }
}
/**
 * Approval helpers
 */
/**
 * Check if an approval request is still pending
 */
export function isApprovalPending(approval) {
    if (approval.status !== 'pending') {
        return false;
    }
    return new Date(approval.expiresAt) > new Date();
}
/**
 * Check if an approval request has expired
 */
export function isApprovalExpired(approval) {
    return approval.status === 'expired' || new Date(approval.expiresAt) <= new Date();
}
/**
 * Format approval request for display
 */
export function formatApprovalSummary(approval) {
    const lines = [
        `Approval Request: ${approval.id}`,
        `Status: ${approval.status}`,
        `Action Type: ${approval.actionType}`,
        `Created: ${new Date(approval.createdAt).toISOString()}`,
        `Expires: ${new Date(approval.expiresAt).toISOString()}`,
    ];
    if (approval.screenshotUrl) {
        lines.push(`Screenshot: ${approval.screenshotUrl}`);
    }
    return lines.join('\n');
}
/**
 * Build approval decision options
 */
export function buildApprovalDecision(approvalId, approve, reason) {
    return {
        decision: approve ? 'approved' : 'denied',
        ...(reason && { reason }),
    };
}
//# sourceMappingURL=session.js.map