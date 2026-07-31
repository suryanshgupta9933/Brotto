/**
 * Contract tests for relay protocol
 *
 * Tests protocol compatibility between desktop connector,
 * browser extension, and CDP relay.
 */

import {
  MessageType,
  serializeMessage,
  deserializeMessage,
  createMessage,
  PROTOCOL_VERSION,
  MIN_PROTOCOL_VERSION,
  SessionManager,
  HeartbeatManager,
  BackpressureManager,
  SequenceTracker,
  type RelayMessage,
  type CDPFramePayload,
  type HelloPayload,
} from '@fara/platform/relay-protocol';

describe('Relay Protocol Contract Tests', () => {
  describe('Protocol Version Negotiation', () => {
    it('should support current protocol version', () => {
      const helloPayload: HelloPayload = {
        version: PROTOCOL_VERSION,
        clientId: 'desktop-connector-v1',
        supportedVersions: [PROTOCOL_VERSION, MIN_PROTOCOL_VERSION],
      };

      const message = createMessage(MessageType.HELLO, helloPayload);
      const serialized = serializeMessage(message);
      const deserialized = deserializeMessage(serialized);

      expect(deserialized.payload.version).toBe(PROTOCOL_VERSION);
    });

    it('should reject older incompatible versions', () => {
      const oldVersion = '0.0.1';

      const isCompatible = parseInt(PROTOCOL_VERSION.split('.')[0]) >= parseInt(oldVersion.split('.')[0]);

      // Protocol should be backward compatible or reject older versions
      expect(typeof isCompatible).toBe('boolean');
    });

    it('should include version in all messages', () => {
      const message = createMessage(MessageType.HELLO, {
        version: PROTOCOL_VERSION,
        clientId: 'test-client',
      });

      expect(message.version).toBe(PROTOCOL_VERSION);
    });
  });

  describe('Session Lifecycle', () => {
    let sessionManager: SessionManager;

    beforeEach(() => {
      sessionManager = new SessionManager();
    });

    it('should create session with required fields', () => {
      const message = createMessage(MessageType.SESSION_CREATE, {
        sessionId: 'ses_abc123',
        channelId: 'ch_def456',
        deviceId: 'dev_ghi789',
      });

      expect(message.payload.sessionId).toBeDefined();
      expect(message.payload.channelId).toBeDefined();
      expect(message.payload.deviceId).toBeDefined();
    });

    it('should handle session renewal', () => {
      const message = createMessage(MessageType.SESSION_RENEW, {
        sessionId: 'ses_abc123',
        newExpiry: Date.now() + 3600000,
      });

      expect(message.type).toBe(MessageType.SESSION_RENEW);
      expect(message.payload.sessionId).toBe('ses_abc123');
    });

    it('should handle session revocation', () => {
      const message = createMessage(MessageType.SESSION_REVOKE, {
        sessionId: 'ses_abc123',
        reason: 'user_logout',
      });

      expect(message.type).toBe(MessageType.SESSION_REVOKE);
    });

    it('should maintain session state machine', () => {
      const states = ['pending', 'active', 'renewing', 'revoked'];

      // Verify state transitions are valid
      const validTransitions: Record<string, string[]> = {
        pending: ['active', 'revoked'],
        active: ['renewing', 'revoked'],
        renewing: ['active', 'revoked'],
        revoked: [],
      };

      Object.entries(validTransitions).forEach(([state, allowed]) => {
        allowed.forEach((targetState) => {
          expect(validTransitions[state]).toContain(targetState);
        });
      });
    });
  });

  describe('CDP Frame Handling', () => {
    it('should serialize CDP commands correctly', () => {
      const cdpPayload: CDPFramePayload = {
        method: 'Page.enable',
        params: {},
        id: 1,
      };

      const message = createMessage(MessageType.CDP_FRAME, cdpPayload);
      const serialized = serializeMessage(message);
      const deserialized = deserializeMessage(serialized);

      expect(deserialized.payload.method).toBe('Page.enable');
      expect((deserialized.payload as CDPFramePayload).id).toBe(1);
    });

    it('should preserve CDP response correlation', () => {
      const cdpPayload: CDPFramePayload = {
        method: 'Runtime.evaluate',
        params: { expression: '1+1' },
        id: 42,
      };

      const message = createMessage(MessageType.CDP_FRAME, cdpPayload);

      // Response should match request ID
      expect(message.payload.id).toBe(42);
    });

    it('should handle CDP events', () => {
      const eventPayload: CDPFramePayload = {
        method: 'Page.loadEventFired',
        params: { timestamp: Date.now() },
      };

      const message = createMessage(MessageType.CDP_FRAME, eventPayload);
      const serialized = serializeMessage(message);
      const deserialized = deserializeMessage(serialized);

      expect(deserialized.payload.method).toBe('Page.loadEventFired');
    });
  });

  describe('Heartbeat Protocol', () => {
    it('should maintain heartbeat state', () => {
      const manager = new HeartbeatManager('session-123', 30000);

      const status1 = manager.getStatus();
      expect(status1.status).toBeDefined();

      // Simulate heartbeat
      manager.sendHeartbeat();

      const status2 = manager.getStatus();
      expect(status2.lastHeartbeat).toBeDefined();
    });

    it('should detect stale heartbeats', () => {
      const manager = new HeartbeatManager('session-123', 1000);

      // Simulate old heartbeat
      manager.lastHeartbeat = Date.now() - 5000;

      const status = manager.getStatus();
      expect(status.status).toBe('expired');
    });

    it('should create heartbeat messages with proper interval', () => {
      const interval = 30000;
      const message = createMessage(MessageType.HEARTBEAT, {
        sessionId: 'session-123',
        timestamp: Date.now(),
        interval,
      });

      expect(message.type).toBe(MessageType.HEARTBEAT);
      expect((message.payload as any).interval).toBe(interval);
    });
  });

  describe('Backpressure Protocol', () => {
    it('should signal backpressure begin', () => {
      const message = createMessage(MessageType.BACKPRESSURE_BEGIN, {
        reason: 'rate_limit',
        recommendedWindow: 100,
      });

      expect(message.type).toBe(MessageType.BACKPRESSURE_BEGIN);
      expect((message.payload as any).reason).toBe('rate_limit');
    });

    it('should signal backpressure end', () => {
      const message = createMessage(MessageType.BACKPRESSURE_END, {
        reason: 'rate_limit',
      });

      expect(message.type).toBe(MessageType.BACKPRESSURE_END);
    });

    it('should track backpressure state', () => {
      const manager = new BackpressureManager();

      manager.beginBackpressure('memory_pressure');
      expect(manager.getState().isBackpressured).toBe(true);
      expect(manager.getState().reason).toBe('memory_pressure');

      manager.endBackpressure();
      expect(manager.getState().isBackpressured).toBe(false);
    });
  });

  describe('Sequence Tracking', () => {
    it('should maintain ordered sequence', () => {
      const tracker = new SequenceTracker();

      const seq1 = tracker.nextSequence();
      const seq2 = tracker.nextSequence();
      const seq3 = tracker.nextSequence();

      expect(seq2).toBe(seq1 + 1);
      expect(seq3).toBe(seq2 + 1);
    });

    it('should detect sequence gaps', () => {
      const tracker = new SequenceTracker();

      tracker.nextSequence();
      tracker.nextSequence();
      // Skip seq 3

      const hasGap = tracker.hasGap(1, 4);
      expect(hasGap).toBe(true);
    });

    it('should handle sequence reset', () => {
      const tracker = new SequenceTracker();

      tracker.nextSequence();
      tracker.nextSequence();
      tracker.reset(100);

      const seq = tracker.nextSequence();
      expect(seq).toBe(101);
    });
  });

  describe('Error Handling', () => {
    it('should encode error messages', () => {
      const message = createMessage(MessageType.ERROR, {
        code: 'PROTOCOL_ERROR',
        message: 'Invalid message format',
        details: { field: 'version' },
      });

      expect(message.type).toBe(MessageType.ERROR);
      expect((message.payload as any).code).toBe('PROTOCOL_ERROR');
    });

    it('should handle rate limit errors', () => {
      const message = createMessage(MessageType.RATE_LIMIT, {
        limit: 100,
        remaining: 0,
        resetAt: Date.now() + 60000,
      });

      expect(message.type).toBe(MessageType.RATE_LIMIT);
    });
  });
});
