import { describe, it, expect } from 'vitest';
import {
  isTerminalState,
  isActiveState,
  isWaitingState,
  getStateDescription,
  calculateSessionMetrics,
  SessionReplay,
  isApprovalPending,
  formatApprovalSummary,
  SESSION_STATE_DESCRIPTIONS,
} from '../session.js';
import { SessionState, ApprovalStatus, SessionEvent } from '../types.js';

describe('session helpers', () => {
  describe('isTerminalState', () => {
    it('should return true for terminal states', () => {
      expect(isTerminalState(SessionState.COMPLETED)).toBe(true);
      expect(isTerminalState(SessionState.FAILED)).toBe(true);
      expect(isTerminalState(SessionState.CANCELLED)).toBe(true);
    });

    it('should return false for non-terminal states', () => {
      expect(isTerminalState(SessionState.CREATED)).toBe(false);
      expect(isTerminalState(SessionState.EXECUTING)).toBe(false);
      expect(isTerminalState(SessionState.WAITING_FOR_APPROVAL)).toBe(false);
    });
  });

  describe('isActiveState', () => {
    it('should return true for active states', () => {
      expect(isActiveState(SessionState.CONNECTED)).toBe(true);
      expect(isActiveState(SessionState.OBSERVING)).toBe(true);
      expect(isActiveState(SessionState.PLANNING)).toBe(true);
      expect(isActiveState(SessionState.EXECUTING)).toBe(true);
      expect(isActiveState(SessionState.VERIFYING)).toBe(true);
    });

    it('should return false for inactive states', () => {
      expect(isActiveState(SessionState.CREATED)).toBe(false);
      expect(isActiveState(SessionState.WAITING_FOR_CLIENT)).toBe(false);
      expect(isActiveState(SessionState.COMPLETED)).toBe(false);
    });
  });

  describe('isWaitingState', () => {
    it('should return true for waiting states', () => {
      expect(isWaitingState(SessionState.WAITING_FOR_APPROVAL)).toBe(true);
      expect(isWaitingState(SessionState.WAITING_FOR_CLIENT)).toBe(true);
    });

    it('should return false for non-waiting states', () => {
      expect(isWaitingState(SessionState.EXECUTING)).toBe(false);
      expect(isWaitingState(SessionState.PLANNING)).toBe(false);
    });
  });

  describe('getStateDescription', () => {
    it('should return descriptions for all states', () => {
      expect(getStateDescription(SessionState.CREATED)).toBeTruthy();
      expect(getStateDescription(SessionState.WAITING_FOR_APPROVAL)).toBeTruthy();
      expect(getStateDescription(SessionState.COMPLETED)).toBeTruthy();
    });
  });

  describe('SESSION_STATE_DESCRIPTIONS', () => {
    it('should have descriptions for all session states', () => {
      const states = Object.values(SessionState);
      for (const state of states) {
        expect(SESSION_STATE_DESCRIPTIONS[state]).toBeTruthy();
      }
    });
  });

  describe('calculateSessionMetrics', () => {
    it('should calculate metrics from events', () => {
      const sessionId = 'test-session';
      const startedAt = new Date();
      const events: SessionEvent[] = [
        {
          type: 'action_executed',
          payload: { actionId: '1', success: true },
          timestamp: Date.now(),
        },
        {
          type: 'action_executed',
          payload: { actionId: '2', success: true },
          timestamp: Date.now(),
        },
        {
          type: 'approval_required',
          payload: { approvalRequest: {} },
          timestamp: Date.now(),
        },
        {
          type: 'approval_decided',
          payload: { decision: 'denied' },
          timestamp: Date.now(),
        },
      ];

      const metrics = calculateSessionMetrics(sessionId, startedAt, events);

      expect(metrics.session_id).toBe(sessionId);
      expect(metrics.started_at).toBe(startedAt);
      expect(metrics.action_count).toBe(2);
      expect(metrics.approval_count).toBe(1);
      expect(metrics.denied_approval_count).toBe(1);
    });
  });

  describe('SessionReplay', () => {
    it('should replay events in order', () => {
      const events: SessionEvent[] = [
        { type: 'action_executed', payload: { actionId: '1' }, timestamp: 1 },
        { type: 'action_executed', payload: { actionId: '2' }, timestamp: 2 },
        { type: 'state_changed', payload: { newState: 'executing' }, timestamp: 3 },
      ];

      const replay = new SessionReplay(events);

      expect(replay.hasNext()).toBe(true);
      expect(replay.next()).toEqual(events[0]);
      expect(replay.next()).toEqual(events[1]);
      expect(replay.next()).toEqual(events[2]);
      expect(replay.hasNext()).toBe(false);
    });

    it('should peek without advancing', () => {
      const events: SessionEvent[] = [
        { type: 'action_executed', payload: {}, timestamp: 1 },
      ];

      const replay = new SessionReplay(events);

      expect(replay.peek()).toEqual(events[0]);
      expect(replay.peek()).toEqual(events[0]); // Still at same position
    });

    it('should reset to beginning', () => {
      const events: SessionEvent[] = [
        { type: 'action_executed', payload: {}, timestamp: 1 },
      ];

      const replay = new SessionReplay(events);
      replay.next();
      expect(replay.hasNext()).toBe(false);

      replay.reset();
      expect(replay.hasNext()).toBe(true);
    });

    it('should filter events by type', () => {
      const events: SessionEvent[] = [
        { type: 'action_executed', payload: {}, timestamp: 1 },
        { type: 'state_changed', payload: {}, timestamp: 2 },
        { type: 'action_executed', payload: {}, timestamp: 3 },
      ];

      const replay = new SessionReplay(events);
      const actionEvents = replay.getEventsByType('action_executed');

      expect(actionEvents).toHaveLength(2);
    });
  });

  describe('isApprovalPending', () => {
    it('should return true for pending approvals with future expiry', () => {
      const approval = {
        id: 'test',
        status: ApprovalStatus.PENDING,
        expiresAt: new Date(Date.now() + 10000),
      } as any;

      expect(isApprovalPending(approval)).toBe(true);
    });

    it('should return false for non-pending approvals', () => {
      const approval = {
        id: 'test',
        status: ApprovalStatus.APPROVED,
        expiresAt: new Date(Date.now() + 10000),
      } as any;

      expect(isApprovalPending(approval)).toBe(false);
    });
  });

  describe('formatApprovalSummary', () => {
    it('should format approval summary', () => {
      const approval = {
        id: 'approval-123',
        actionType: 'visit_url',
        status: 'pending',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        expiresAt: new Date('2024-01-01T00:05:00Z'),
        screenshotUrl: null,
      } as any;

      const summary = formatApprovalSummary(approval);

      expect(summary).toContain('approval-123');
      expect(summary).toContain('pending');
      expect(summary).toContain('visit_url');
    });
  });
});
