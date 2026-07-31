/**
 * Session State Machine Tests
 */

import {
  SessionStateMachine,
  SessionState,
  InvalidStateTransitionError,
} from '../session';

describe('SessionStateMachine', () => {
  let session: SessionStateMachine;

  beforeEach(() => {
    session = new SessionStateMachine({
      sessionId: 'test-session-1',
      goal: 'Test goal',
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
  });

  describe('initial state', () => {
    it('should start in CREATED state', () => {
      expect(session.getState()).toBe(SessionState.CREATED);
    });

    it('should have correct session ID', () => {
      expect(session.getSessionId()).toBe('test-session-1');
    });

    it('should have correct goal', () => {
      expect(session.getGoal()).toBe('Test goal');
    });

    it('should not be terminal', () => {
      expect(session.isTerminal()).toBe(false);
    });

    it('should not be active', () => {
      expect(session.isActive()).toBe(false);
    });
  });

  describe('valid transitions', () => {
    it('should transition from CREATED to WAITING_FOR_CLIENT', () => {
      session.waitForClient();
      expect(session.getState()).toBe(SessionState.WAITING_FOR_CLIENT);
    });

    it('should transition from WAITING_FOR_CLIENT to CONNECTED', () => {
      session.waitForClient();
      session.clientConnected();
      expect(session.getState()).toBe(SessionState.CONNECTED);
    });

    it('should transition from CONNECTED to OBSERVING', () => {
      session.waitForClient();
      session.clientConnected();
      session.startObserving();
      expect(session.getState()).toBe(SessionState.OBSERVING);
    });

    it('should transition from OBSERVING to PLANNING', () => {
      session.waitForClient();
      session.clientConnected();
      session.startObserving();
      session.startPlanning();
      expect(session.getState()).toBe(SessionState.PLANNING);
    });

    it('should transition from PLANNING to POLICY_CHECK', () => {
      session.waitForClient();
      session.clientConnected();
      session.startObserving();
      session.startPlanning();
      session.checkPolicy();
      expect(session.getState()).toBe(SessionState.POLICY_CHECK);
    });

    it('should transition from POLICY_CHECK to EXECUTING', () => {
      session.waitForClient();
      session.clientConnected();
      session.startObserving();
      session.startPlanning();
      session.checkPolicy();
      session.startExecuting();
      expect(session.getState()).toBe(SessionState.EXECUTING);
    });

    it('should transition from EXECUTING to VERIFYING', () => {
      session.waitForClient();
      session.clientConnected();
      session.startObserving();
      session.startPlanning();
      session.checkPolicy();
      session.startExecuting();
      session.startVerifying();
      expect(session.getState()).toBe(SessionState.VERIFYING);
    });

    it('should transition from VERIFYING to COMPLETED', () => {
      session.waitForClient();
      session.clientConnected();
      session.startObserving();
      session.startPlanning();
      session.checkPolicy();
      session.startExecuting();
      session.startVerifying();
      session.complete('Task finished');
      expect(session.getState()).toBe(SessionState.COMPLETED);
    });

    it('should transition to FAILED from OBSERVING', () => {
      session.waitForClient();
      session.clientConnected();
      session.startObserving();
      session.fail('Test failure');
      expect(session.getState()).toBe(SessionState.FAILED);
    });

    it('should transition to CANCELLED from CREATED', () => {
      session.cancel('User cancelled');
      expect(session.getState()).toBe(SessionState.CANCELLED);
    });
  });

  describe('invalid transitions', () => {
    it('should throw on invalid transition from CREATED to OBSERVING', () => {
      expect(() => session.startObserving()).toThrow(InvalidStateTransitionError);
    });

    it('should throw on invalid transition from CREATED to COMPLETED', () => {
      expect(() => session.complete()).toThrow(InvalidStateTransitionError);
    });

    it('should throw on invalid transition from COMPLETED', () => {
      session.waitForClient();
      session.clientConnected();
      session.startObserving();
      session.startPlanning();
      session.checkPolicy();
      session.startExecuting();
      session.startVerifying();
      session.complete();

      expect(() => session.startObserving()).toThrow(InvalidStateTransitionError);
    });

    it('should throw on invalid transition from FAILED', () => {
      session.waitForClient();
      session.clientConnected();
      session.startObserving();
      session.fail('Test');

      expect(() => session.startPlanning()).toThrow(InvalidStateTransitionError);
    });
  });

  describe('terminal states', () => {
    it('COMPLETED should be terminal', () => {
      session.waitForClient();
      session.clientConnected();
      session.startObserving();
      session.startPlanning();
      session.checkPolicy();
      session.startExecuting();
      session.startVerifying();
      session.complete();

      expect(session.isTerminal()).toBe(true);
      expect(session.isActive()).toBe(false);
    });

    it('FAILED should be terminal', () => {
      session.waitForClient();
      session.clientConnected();
      session.startObserving();
      session.fail('Test');

      expect(session.isTerminal()).toBe(true);
    });

    it('CANCELLED should be terminal', () => {
      session.cancel();

      expect(session.isTerminal()).toBe(true);
    });
  });

  describe('approval flow', () => {
    it('should set pending approval ID when requesting approval', () => {
      session.waitForClient();
      session.clientConnected();
      session.startObserving();
      session.startPlanning();
      session.checkPolicy();

      const context = session.getContext();
      expect(context.pendingApprovalId).toBeNull();
    });
  });

  describe('history', () => {
    it('should record state transitions in history', () => {
      session.waitForClient();
      session.clientConnected();

      const history = session.getHistory();
      expect(history.length).toBe(2);
      expect(history[0].fromState).toBe(SessionState.CREATED);
      expect(history[0].toState).toBe(SessionState.WAITING_FOR_CLIENT);
      expect(history[1].fromState).toBe(SessionState.WAITING_FOR_CLIENT);
      expect(history[1].toState).toBe(SessionState.CONNECTED);
    });
  });

  describe('browser state updates', () => {
    it('should update browser state', () => {
      session.updateBrowserState({
        url: 'https://example.com',
        domain: 'example.com',
      });

      const context = session.getContext();
      expect(context.currentUrl).toBe('https://example.com');
      expect(context.currentDomain).toBe('example.com');
    });

    it('should record action result', () => {
      const result = {
        actionId: 'act-1',
        success: true,
        observationId: 1,
      };

      session.recordActionResult(result);

      const context = session.getContext();
      expect(context.lastActionResult).toEqual(result);
    });
  });

  describe('events', () => {
    it('should emit stateChanged event', () => {
      const handler = jest.fn();
      session.on('stateChanged', handler);

      session.waitForClient();

      expect(handler).toHaveBeenCalledWith(SessionState.CREATED, SessionState.WAITING_FOR_CLIENT);
    });

    it('should emit failed event', () => {
      const handler = jest.fn();
      session.on('failed', handler);

      session.waitForClient();
      session.clientConnected();
      session.startObserving();
      session.fail('Test failure');

      expect(handler).toHaveBeenCalledWith('Test failure');
    });
  });
});

describe('InvalidStateTransitionError', () => {
  it('should include from and to states', () => {
    const error = new InvalidStateTransitionError(
      'Invalid transition',
      SessionState.CREATED,
      SessionState.COMPLETED
    );

    expect(error.fromState).toBe(SessionState.CREATED);
    expect(error.toState).toBe(SessionState.COMPLETED);
    expect(error.message).toBe('Invalid transition');
  });
});
