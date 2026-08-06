/**
 * Session management helpers for the Brotto Platform SDK
 */

import type {
  Session,
  SessionState,
  SessionEvent,
  TypedSessionEvent,
  ApprovalRequest,
  ApprovalDecision,
} from './types.js';

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
export function isTerminalState(state: SessionState): boolean {
  return ['completed', 'failed', 'cancelled'].includes(state);
}

/**
 * Check if a session state indicates the session is active
 */
export function isActiveState(state: SessionState): boolean {
  return !isTerminalState(state) && state !== 'created' && state !== 'waiting_for_client';
}

/**
 * Check if a session state indicates it's waiting for user input
 */
export function isWaitingState(state: SessionState): boolean {
  return ['waiting_for_approval', 'waiting_for_client'].includes(state);
}

/**
 * Human-readable description of session states
 */
export const SESSION_STATE_DESCRIPTIONS: Record<SessionState, string> = {
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
export function getStateDescription(state: SessionState): string {
  return SESSION_STATE_DESCRIPTIONS[state] || 'Unknown state';
}

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
export function calculateSessionMetrics(
  sessionId: string,
  startedAt: Date,
  events: SessionEvent[]
): SessionMetrics {
  let actionCount = 0;
  let approvalCount = 0;
  let deniedApprovalCount = 0;
  let lastHeartbeatAt = startedAt;
  let currentState: SessionState = 'created';

  for (const event of events) {
    if (event.type === 'action_executed') {
      actionCount++;
    } else if (event.type === 'approval_required') {
      approvalCount++;
    } else if (event.type === 'approval_decided') {
      const payload = (event as TypedSessionEvent).payload as { decision?: string };
      if (payload.decision === 'denied') {
        deniedApprovalCount++;
      }
    } else if (event.type === 'state_changed') {
      const payload = (event as TypedSessionEvent).payload as { newState?: SessionState };
      if (payload.newState) {
        currentState = payload.newState;
      }
    } else if (event.type === 'heartbeat') {
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
 * Session event filter
 */
export type SessionEventFilter = (event: SessionEvent) => boolean;

/**
 * Filter events by type
 */
export function filterEventsByType(
  events: SessionEvent[],
  types: SessionEvent['type'][]
): SessionEvent[] {
  const typeSet = new Set(types);
  return events.filter((event) => typeSet.has(event.type));
}

/**
 * Filter events since a timestamp
 */
export function filterEventsSince(events: SessionEvent[], timestamp: number): SessionEvent[] {
  return events.filter((event) => event.timestamp >= timestamp);
}

/**
 * Filter events until a timestamp
 */
export function filterEventsUntil(events: SessionEvent[], timestamp: number): SessionEvent[] {
  return events.filter((event) => event.timestamp <= timestamp);
}

/**
 * Session replay - replay events to reconstruct session history
 */
export class SessionReplay {
  private events: SessionEvent[] = [];
  private currentIndex = 0;

  constructor(events: SessionEvent[] = []) {
    this.events = events;
    this.currentIndex = 0;
  }

  /**
   * Add an event to the replay
   */
  addEvent(event: SessionEvent): void {
    this.events.push(event);
  }

  /**
   * Get all events
   */
  getEvents(): SessionEvent[] {
    return [...this.events];
  }

  /**
   * Get events from current position
   */
  getRemainingEvents(): SessionEvent[] {
    return this.events.slice(this.currentIndex);
  }

  /**
   * Advance to next event
   */
  next(): SessionEvent | null {
    if (this.currentIndex >= this.events.length) {
      return null;
    }
    return this.events[this.currentIndex++];
  }

  /**
   * Peek at next event without advancing
   */
  peek(): SessionEvent | null {
    if (this.currentIndex >= this.events.length) {
      return null;
    }
    return this.events[this.currentIndex];
  }

  /**
   * Check if there are more events
   */
  hasNext(): boolean {
    return this.currentIndex < this.events.length;
  }

  /**
   * Reset to beginning
   */
  reset(): void {
    this.currentIndex = 0;
  }

  /**
   * Get events by type
   */
  getEventsByType(type: SessionEvent['type']): SessionEvent[] {
    return filterEventsByType(this.events, [type]);
  }

  /**
   * Calculate metrics from events
   */
  getMetrics(startedAt: Date): SessionMetrics {
    return calculateSessionMetrics(this.events[0]?.payload && typeof this.events[0] === 'object' && 'sessionId' in this.events[0]
      ? (this.events[0] as unknown as { sessionId: string }).sessionId
      : 'unknown', startedAt, this.events);
  }
}

/**
 * Approval helpers
 */

/**
 * Check if an approval request is still pending
 */
export function isApprovalPending(approval: ApprovalRequest): boolean {
  if (approval.status !== 'pending') {
    return false;
  }
  return new Date(approval.expiresAt) > new Date();
}

/**
 * Check if an approval request has expired
 */
export function isApprovalExpired(approval: ApprovalRequest): boolean {
  return approval.status === 'expired' || new Date(approval.expiresAt) <= new Date();
}

/**
 * Format approval request for display
 */
export function formatApprovalSummary(approval: ApprovalRequest): string {
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
export function buildApprovalDecision(
  approvalId: string,
  approve: boolean,
  reason?: string
): ApprovalDecision & { reason?: string } {
  return {
    decision: approve ? 'approved' : 'denied',
    ...(reason && { reason }),
  };
}
