/**
 * Unit tests for relay-protocol package
 *
 * Tests CDP relay wire protocol serialization, session management,
 * heartbeat, backpressure, rate limiting, and sequence tracking.
 */

import {
  serializeMessage,
  deserializeMessage,
  validateMessage,
  createMessage,
  encodePayload,
  decodePayload,
  encodeBase64,
  decodeBase64,
  getSerializedSize,
  isVersionCompatible,
  MessageType,
  PROTOCOL_VERSION,
  MIN_PROTOCOL_VERSION,
  SessionManager,
  generateSessionId,
  generateChannelId,
  generateDeviceId,
  createSessionLease,
  isLeaseValid,
  getLeaseTimeRemaining,
  revokeLease,
  HeartbeatManager,
  createHeartbeatPayload,
  isHeartbeatExpired,
  timeUntilNextHeartbeat,
  determineHeartbeatStatus,
  BackpressureManager,
  calculateRecommendedWindow,
  SequenceTracker,
  RateLimiter,
  DEFAULT_TLS_CONFIG,
  createServerTLSConfig,
  createClientTLSConfig,
  requiresClientCert,
  getSecureCipherSuites,
} from '@brotto/platform/relay-protocol';

describe('Relay Protocol Package', () => {
  describe('Message Serialization', () => {
    it('should serialize and deserialize hello message', () => {
      const message = createMessage(MessageType.HELLO, {
        version: PROTOCOL_VERSION,
        clientId: 'test-client',
        supportedVersions: [PROTOCOL_VERSION],
      });

      const serialized = serializeMessage(message);
      expect(serialized).toBeDefined();
      expect(typeof serialized).toBe('string');

      const deserialized = deserializeMessage(serialized);
      expect(deserialized).toBeDefined();
      expect(deserialized.type).toBe(MessageType.HELLO);
      expect(deserialized.payload.version).toBe(PROTOCOL_VERSION);
    });

    it('should serialize and deserialize session create message', () => {
      const message = createMessage(MessageType.SESSION_CREATE, {
        sessionId: 'session-123',
        channelId: 'channel-456',
        deviceId: 'device-789',
      });

      const serialized = serializeMessage(message);
      const deserialized = deserializeMessage(serialized);

      expect(deserialized.type).toBe(MessageType.SESSION_CREATE);
      expect(deserialized.payload.sessionId).toBe('session-123');
    });

    it('should serialize and deserialize CDP frame', () => {
      const cdpPayload = {
        method: 'Page.enable',
        params: {},
        id: 1,
      };

      const message = createMessage(MessageType.CDP_FRAME, cdpPayload);

      const serialized = serializeMessage(message);
      const deserialized = deserializeMessage(serialized);

      expect(deserialized.type).toBe(MessageType.CDP_FRAME);
      expect(deserialized.payload.method).toBe('Page.enable');
    });

    it('should calculate serialized size', () => {
      const message = createMessage(MessageType.HELLO, {
        version: PROTOCOL_VERSION,
        clientId: 'test-client',
      });

      const size = getSerializedSize(message);
      expect(size).toBeGreaterThan(0);
    });

    it('should validate message structure', () => {
      const validMessage = createMessage(MessageType.HELLO, { version: PROTOCOL_VERSION });

      const result = validateMessage(validMessage);
      expect(result.valid).toBe(true);
    });

    it('should reject malformed message', () => {
      const invalidData = JSON.stringify({ type: 'INVALID' });
      expect(() => {
        deserializeMessage(invalidData);
      }).toThrow();
    });
  });

  describe('Payload Encoding', () => {
    it('should encode and decode base64', () => {
      const data = { test: 'data', value: 123 };
      const encoded = encodeBase64(data);
      expect(typeof encoded).toBe('string');

      const decoded = decodeBase64(encoded);
      expect(decoded).toEqual(data);
    });

    it('should encode and decode payload', () => {
      const payload = { method: 'test', params: { foo: 'bar' } };
      const encoded = encodePayload(payload);
      expect(typeof encoded).toBe('string');

      const decoded = decodePayload(encoded);
      expect(decoded).toEqual(payload);
    });

    it('should handle binary data in payload', () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff]);
      const encoded = encodeBase64(binaryData);
      expect(typeof encoded).toBe('string');

      const decoded = decodeBase64(encoded);
      expect(decoded).toBeInstanceOf(Uint8Array);
    });
  });

  describe('Version Compatibility', () => {
    it('should accept compatible version', () => {
      expect(isVersionCompatible(PROTOCOL_VERSION, MIN_PROTOCOL_VERSION)).toBe(true);
    });

    it('should reject incompatible version', () => {
      expect(isVersionCompatible('0.0.1', MIN_PROTOCOL_VERSION)).toBe(false);
    });

    it('should handle version comparison', () => {
      const higherVersion = '999.999.999';
      expect(isVersionCompatible(higherVersion, MIN_PROTOCOL_VERSION)).toBe(true);
    });
  });

  describe('Session Management', () => {
    let sessionManager: SessionManager;

    beforeEach(() => {
      sessionManager = new SessionManager();
    });

    it('should generate unique session IDs', () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^ses_/);
    });

    it('should generate unique channel IDs', () => {
      const id1 = generateChannelId();
      const id2 = generateChannelId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^ch_/);
    });

    it('should generate unique device IDs', () => {
      const id1 = generateDeviceId();
      const id2 = generateDeviceId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^dev_/);
    });

    it('should create session lease', () => {
      const lease = createSessionLease('session-123', 3600000);
      expect(lease).toBeDefined();
      expect(lease.sessionId).toBe('session-123');
      expect(lease.grantedAt).toBeDefined();
      expect(lease.expiresAt).toBeGreaterThan(lease.grantedAt);
    });

    it('should validate lease', () => {
      const lease = createSessionLease('session-123', 3600000);
      expect(isLeaseValid(lease)).toBe(true);
    });

    it('should detect expired lease', () => {
      const expiredLease = {
        sessionId: 'session-123',
        grantedAt: Date.now() - 7200000,
        expiresAt: Date.now() - 3600000,
        grantedBy: 'test',
      };

      expect(isLeaseValid(expiredLease)).toBe(false);
    });

    it('should get lease time remaining', () => {
      const lease = createSessionLease('session-123', 3600000);
      const remaining = getLeaseTimeRemaining(lease);
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(3600000);
    });

    it('should revoke lease', () => {
      const lease = createSessionLease('session-123', 3600000);
      const revoked = revokeLease(lease);
      expect(revoked).toBeDefined();
      expect(revoked.revokedAt).toBeDefined();
    });
  });

  describe('Heartbeat', () => {
    it('should create heartbeat payload', () => {
      const payload = createHeartbeatPayload('session-123');
      expect(payload).toBeDefined();
      expect(payload.sessionId).toBe('session-123');
      expect(payload.timestamp).toBeDefined();
    });

    it('should detect non-expired heartbeat', () => {
      const recentHeartbeat = {
        timestamp: Date.now(),
        sessionId: 'session-123',
      };

      expect(isHeartbeatExpired(recentHeartbeat, 30000)).toBe(false);
    });

    it('should detect expired heartbeat', () => {
      const oldHeartbeat = {
        timestamp: Date.now() - 60000,
        sessionId: 'session-123',
      };

      expect(isHeartbeatExpired(oldHeartbeat, 30000)).toBe(true);
    });

    it('should calculate time until next heartbeat', () => {
      const interval = 30000;
      const elapsed = 10000;
      const remaining = timeUntilNextHeartbeat(interval, elapsed);
      expect(remaining).toBe(20000);
    });

    it('should determine heartbeat status', () => {
      expect(determineHeartbeatStatus(Date.now(), 30000)).toBe('healthy');
      expect(determineHeartbeatStatus(Date.now() - 25000, 30000)).toBe('healthy');
      expect(determineHeartbeatStatus(Date.now() - 35000, 30000)).toBe('degraded');
      expect(determineHeartbeatStatus(Date.now() - 60000, 30000)).toBe('expired');
    });

    it('should manage heartbeat state', () => {
      const manager = new HeartbeatManager('session-123', 30000);
      expect(manager.getStatus().status).toBe('active');
    });
  });

  describe('Backpressure', () => {
    it('should calculate recommended window', () => {
      const window = calculateRecommendedWindow(1000, 800, 100);
      expect(window).toBeGreaterThan(0);
      expect(window).toBeLessThanOrEqual(1000);
    });

    it('should handle backpressure manager', () => {
      const manager = new BackpressureManager();
      expect(manager.getState().isBackpressured).toBe(false);
    });
  });

  describe('Sequence Tracking', () => {
    it('should create sequence tracker', () => {
      const tracker = new SequenceTracker();
      expect(tracker).toBeDefined();
    });

    it('should track message sequence', () => {
      const tracker = new SequenceTracker();
      const seq1 = tracker.nextSequence();
      const seq2 = tracker.nextSequence();

      expect(seq2).toBe(seq1 + 1);
    });

    it('should detect gaps in sequence', () => {
      const tracker = new SequenceTracker();
      tracker.nextSequence();
      tracker.nextSequence();

      const hasGap = tracker.hasGap(1, 3);
      expect(hasGap).toBe(true);
    });

    it('should reset sequence', () => {
      const tracker = new SequenceTracker();
      tracker.nextSequence();
      tracker.nextSequence();
      tracker.reset();

      expect(tracker.getLastSequence()).toBe(0);
    });
  });

  describe('Rate Limiting', () => {
    it('should create rate limiter', () => {
      const limiter = new RateLimiter({
        maxRequests: 100,
        windowMs: 60000,
      });

      expect(limiter).toBeDefined();
    });

    it('should allow requests under limit', () => {
      const limiter = new RateLimiter({
        maxRequests: 100,
        windowMs: 60000,
      });

      expect(limiter.tryAcquire('client-1')).toBe(true);
    });

    it('should block requests over limit', () => {
      const limiter = new RateLimiter({
        maxRequests: 2,
        windowMs: 60000,
      });

      expect(limiter.tryAcquire('client-1')).toBe(true);
      expect(limiter.tryAcquire('client-1')).toBe(true);
      expect(limiter.tryAcquire('client-1')).toBe(false);
    });

    it('should track rate limit state', () => {
      const limiter = new RateLimiter({
        maxRequests: 100,
        windowMs: 60000,
      });

      const state = limiter.getState();
      expect(state.remaining).toBe(100);
      expect(state.isLimited).toBe(false);
    });
  });

  describe('TLS Configuration', () => {
    it('should have default TLS config', () => {
      expect(DEFAULT_TLS_CONFIG).toBeDefined();
      expect(DEFAULT_TLS_CONFIG.minVersion).toBeDefined();
    });

    it('should create server TLS config', () => {
      const config = createServerTLSConfig({
        certPath: '/path/to/cert',
        keyPath: '/path/to/key',
      });

      expect(config).toBeDefined();
      expect(config.certPath).toBe('/path/to/cert');
    });

    it('should create client TLS config', () => {
      const config = createClientTLSConfig({
        caPath: '/path/to/ca',
      });

      expect(config).toBeDefined();
      expect(config.caPath).toBe('/path/to/ca');
    });

    it('should check if client cert is required', () => {
      const serverConfig = createServerTLSConfig({
        certPath: '/path/to/cert',
        keyPath: '/path/to/key',
        requestCert: true,
      });

      expect(requiresClientCert(serverConfig)).toBe(true);
    });

    it('should get secure cipher suites', () => {
      const ciphers = getSecureCipherSuites();
      expect(ciphers).toBeDefined();
      expect(Array.isArray(ciphers)).toBe(true);
      expect(ciphers.length).toBeGreaterThan(0);
    });
  });
});
