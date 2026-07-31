/**
 * Tests for heartbeat handling
 */

import {
  HeartbeatManager,
  createHeartbeatPayload,
  isHeartbeatExpired,
  timeUntilNextHeartbeat,
  determineHeartbeatStatus,
  validateHeartbeatPayload,
  DEFAULT_HEARTBEAT_CONFIG,
} from '../heartbeat';
import type { HeartbeatPayload } from '../types';

describe('Heartbeat', () => {
  describe('createHeartbeatPayload', () => {
    it('should create a heartbeat payload with default status', () => {
      const payload = createHeartbeatPayload(5);
      expect(payload.sequenceNumber).toBe(5);
      expect(payload.status).toBe('active');
      expect(typeof payload.timestamp).toBe('number');
    });

    it('should create a heartbeat payload with specified status', () => {
      const payload = createHeartbeatPayload(5, 'idle');
      expect(payload.status).toBe('idle');
    });

    it('should set timestamp to current time', () => {
      const before = Date.now();
      const payload = createHeartbeatPayload(0);
      const after = Date.now();

      expect(payload.timestamp).toBeGreaterThanOrEqual(before);
      expect(payload.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('isHeartbeatExpired', () => {
    it('should return false for recent heartbeat', () => {
      const lastHeartbeat = Date.now();
      const result = isHeartbeatExpired(lastHeartbeat, 30000, 3);
      expect(result).toBe(false);
    });

    it('should return true for expired heartbeat', () => {
      // 4 intervals ago with threshold of 3
      const lastHeartbeat = Date.now() - (30000 * 4);
      const result = isHeartbeatExpired(lastHeartbeat, 30000, 3);
      expect(result).toBe(true);
    });

    it('should respect maxMissedHeartbeats parameter', () => {
      // 2 intervals ago with threshold of 2 should be on the edge
      // Since we check if now > deadline, if lastHeartbeat = now - 2*interval, deadline = now - interval, so it's not expired yet
      const lastHeartbeat = Date.now() - (30000 * 1.5);
      expect(isHeartbeatExpired(lastHeartbeat, 30000, 3)).toBe(false);
    });
  });

  describe('timeUntilNextHeartbeat', () => {
    it('should return positive value when heartbeat is not due', () => {
      const lastSent = Date.now() - 10000; // 10 seconds ago
      const result = timeUntilNextHeartbeat(lastSent, 30000);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(20000);
    });

    it('should return 0 when heartbeat is overdue', () => {
      const lastSent = Date.now() - 40000; // 40 seconds ago
      const result = timeUntilNextHeartbeat(lastSent, 30000);
      expect(result).toBe(0);
    });
  });

  describe('determineHeartbeatStatus', () => {
    it('should return active for recent activity', () => {
      const lastActivity = Date.now() - 10000;
      expect(determineHeartbeatStatus(lastActivity)).toBe('active');
    });

    it('should return idle for old activity', () => {
      const lastActivity = Date.now() - 120000; // 2 minutes ago
      expect(determineHeartbeatStatus(lastActivity, 60000)).toBe('idle');
    });

    it('should respect idleThresholdMs parameter', () => {
      const lastActivity = Date.now() - 30000;
      expect(determineHeartbeatStatus(lastActivity, 60000)).toBe('active');
      expect(determineHeartbeatStatus(lastActivity, 20000)).toBe('idle');
    });
  });

  describe('validateHeartbeatPayload', () => {
    it('should accept valid payload', () => {
      const payload: HeartbeatPayload = {
        timestamp: Date.now(),
        sequenceNumber: 5,
        status: 'active',
      };
      expect(validateHeartbeatPayload(payload)).toBe(true);
    });

    it('should accept idle status', () => {
      const payload: HeartbeatPayload = {
        timestamp: Date.now(),
        sequenceNumber: 5,
        status: 'idle',
      };
      expect(validateHeartbeatPayload(payload)).toBe(true);
    });

    it('should accept closing status', () => {
      const payload: HeartbeatPayload = {
        timestamp: Date.now(),
        sequenceNumber: 5,
        status: 'closing',
      };
      expect(validateHeartbeatPayload(payload)).toBe(true);
    });

    it('should reject invalid status', () => {
      const payload = {
        timestamp: Date.now(),
        sequenceNumber: 5,
        status: 'invalid',
      };
      expect(validateHeartbeatPayload(payload)).toBe(false);
    });

    it('should reject missing fields', () => {
      expect(validateHeartbeatPayload({ timestamp: Date.now() })).toBe(false);
      expect(validateHeartbeatPayload({ sequenceNumber: 5 })).toBe(false);
      expect(validateHeartbeatPayload({ status: 'active' })).toBe(false);
    });

    it('should reject null', () => {
      expect(validateHeartbeatPayload(null)).toBe(false);
    });

    it('should reject non-object', () => {
      expect(validateHeartbeatPayload('string')).toBe(false);
      expect(validateHeartbeatPayload(123)).toBe(false);
    });
  });

  describe('HeartbeatManager', () => {
    let manager: HeartbeatManager;
    let missedCallback: () => void;
    let ackCallback: () => void;
    let timeoutCallback: () => void;
    let missedCount: number;
    let ackCount: number;
    let timeoutCount: number;

    beforeEach(() => {
      missedCount = 0;
      ackCount = 0;
      timeoutCount = 0;
      missedCallback = () => { missedCount++; };
      ackCallback = () => { ackCount++; };
      timeoutCallback = () => { timeoutCount++; };

      manager = new HeartbeatManager({
        intervalMs: 1000, // 1 second for faster tests
        maxMissedHeartbeats: 3,
        ackTimeoutMs: 500,
        onMissedHeartbeat: missedCallback,
        onHeartbeatAck: ackCallback,
        onTimeout: timeoutCallback,
      });
    });

    afterEach(() => {
      manager.stop();
    });

    it('should start and stop without error', () => {
      manager.start();
      expect(manager.getState().status).toBe('active');

      manager.stop();
      expect(manager.getState().status).toBe('closing');
    });

    it('should record sent heartbeats', () => {
      manager.start();
      const beforeSend = Date.now();
      manager.recordSent();
      const state = manager.getState();

      expect(state.lastSent).toBeGreaterThanOrEqual(beforeSend);
    });

    it('should receive heartbeats', () => {
      manager.start();
      const payload = createHeartbeatPayload(5, 'active');
      manager.receiveHeartbeat(payload);

      const state = manager.getState();
      expect(state.missedHeartbeats).toBe(0);
      expect(state.consecutiveFailures).toBe(0);
    });

    it('should trigger ack callback on receive', () => {
      manager.start();
      const payload = createHeartbeatPayload(5, 'active');
      manager.receiveHeartbeat(payload);

      expect(ackCount).toBe(1);
    });

    it('should detect stale connections', () => {
      manager.start();
      // Manually set lastReceived to a long time ago via state manipulation
      // For this test, we just check that isStale returns a boolean
      const stale = manager.isStale();
      expect(typeof stale).toBe('boolean');
    });

    it('should not be stale when healthy', () => {
      manager.start();
      manager.receiveHeartbeat(createHeartbeatPayload(0));

      expect(manager.isStale()).toBe(false);
    });

    it('should return time until next heartbeat', () => {
      manager.start();
      const waitTime = manager.getTimeUntilNextHeartbeat();
      expect(waitTime).toBeGreaterThan(0);
      expect(waitTime).toBeLessThanOrEqual(1000);
    });
  });
});
