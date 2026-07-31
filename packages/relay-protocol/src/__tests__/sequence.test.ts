/**
 * Tests for sequence tracking and replay protection
 */

import { SequenceTracker } from '../sequence';
import { ProtocolErrorCode } from '../types';

describe('SequenceTracker', () => {
  let tracker: SequenceTracker;

  beforeEach(() => {
    tracker = new SequenceTracker();
  });

  describe('validateAndProcess', () => {
    it('should accept the first message with any sequence number', () => {
      const result = tracker.validateAndProcess('session-1', 'channel-1', 0);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept sequential sequence numbers', () => {
      tracker.validateAndProcess('session-1', 'channel-1', 0);
      tracker.validateAndProcess('session-1', 'channel-1', 1);
      const result = tracker.validateAndProcess('session-1', 'channel-1', 2);
      expect(result.isValid).toBe(true);
    });

    it('should accept sequence numbers within the window', () => {
      // Process some initial messages
      for (let i = 0; i < 100; i++) {
        tracker.validateAndProcess('session-1', 'channel-1', i);
      }

      // Should accept sequence 150 (within window of 1000 from last=99)
      const result = tracker.validateAndProcess('session-1', 'channel-1', 150);
      expect(result.isValid).toBe(true);
    });

    it('should reject duplicate sequence numbers (replay attack)', () => {
      tracker.validateAndProcess('session-1', 'channel-1', 5);
      const result = tracker.validateAndProcess('session-1', 'channel-1', 5);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.code).toBe(ProtocolErrorCode.SEQUENCE_NUMBER_REPLAY);
    });

    it('should reject sequence numbers below window start (too old)', () => {
      // First, process many messages to move the window
      for (let i = 0; i < 900; i++) {
        tracker.validateAndProcess('session-1', 'channel-1', i);
      }

      // Now try to replay an old sequence
      const result = tracker.validateAndProcess('session-1', 'channel-1', 5);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.code).toBe(ProtocolErrorCode.SEQUENCE_NUMBER_REPLAY);
    });

    it('should reject sequence numbers that create too large a gap', () => {
      tracker.validateAndProcess('session-1', 'channel-1', 0);

      // Try to skip too many sequence numbers
      const result = tracker.validateAndProcess('session-1', 'channel-1', 1001);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.code).toBe(ProtocolErrorCode.SEQUENCE_NUMBER_INVALID);
    });

    it('should track sequences independently per session', () => {
      tracker.validateAndProcess('session-1', 'channel-1', 0);
      tracker.validateAndProcess('session-2', 'channel-1', 0);
      tracker.validateAndProcess('session-1', 'channel-1', 1);

      // Should not be a replay since different sessions
      const result = tracker.validateAndProcess('session-2', 'channel-1', 1);
      expect(result.isValid).toBe(true);
    });

    it('should track sequences independently per channel', () => {
      tracker.validateAndProcess('session-1', 'channel-1', 0);
      tracker.validateAndProcess('session-1', 'channel-2', 0);
      tracker.validateAndProcess('session-1', 'channel-1', 1);

      // Should not be a replay since different channels
      const result = tracker.validateAndProcess('session-1', 'channel-2', 1);
      expect(result.isValid).toBe(true);
    });
  });

  describe('getNextExpected', () => {
    it('should return 0 for new session/channel', () => {
      const next = tracker.getNextExpected('session-1', 'channel-1');
      expect(next).toBe(0);
    });

    it('should return last + 1 after processing', () => {
      tracker.validateAndProcess('session-1', 'channel-1', 5);
      const next = tracker.getNextExpected('session-1', 'channel-1');
      expect(next).toBe(6);
    });
  });

  describe('hasSeen', () => {
    it('should return false for unseen sequence numbers', () => {
      expect(tracker.hasSeen('session-1', 'channel-1', 5)).toBe(false);
    });

    it('should return true for seen sequence numbers', () => {
      tracker.validateAndProcess('session-1', 'channel-1', 5);
      expect(tracker.hasSeen('session-1', 'channel-1', 5)).toBe(true);
    });
  });

  describe('reset', () => {
    it('should clear sequence state for a session/channel', () => {
      tracker.validateAndProcess('session-1', 'channel-1', 5);
      tracker.reset('session-1', 'channel-1');

      expect(tracker.getNextExpected('session-1', 'channel-1')).toBe(0);
      expect(tracker.hasSeen('session-1', 'channel-1', 5)).toBe(false);
    });
  });

  describe('resetAll', () => {
    it('should clear all sequence state', () => {
      tracker.validateAndProcess('session-1', 'channel-1', 5);
      tracker.validateAndProcess('session-2', 'channel-1', 3);
      tracker.resetAll();

      expect(tracker.getNextExpected('session-1', 'channel-1')).toBe(0);
      expect(tracker.getNextExpected('session-2', 'channel-1')).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      tracker.validateAndProcess('session-1', 'channel-1', 0);
      tracker.validateAndProcess('session-1', 'channel-1', 1);
      tracker.validateAndProcess('session-1', 'channel-1', 2);
      tracker.validateAndProcess('session-1', 'channel-2', 0);

      const stats = tracker.getStats('session-1');
      expect(stats.channelCount).toBe(2);
      expect(stats.totalMessagesReceived).toBe(4);
    });

    it('should return zeros for unknown session', () => {
      const stats = tracker.getStats('unknown-session');
      expect(stats.channelCount).toBe(0);
      expect(stats.totalMessagesReceived).toBe(0);
    });
  });

  describe('replay attack detection', () => {
    it('should detect rapid replay attempts', () => {
      // Legitimate message
      tracker.validateAndProcess('session-1', 'channel-1', 0);

      // Try to replay the same message multiple times
      const result1 = tracker.validateAndProcess('session-1', 'channel-1', 0);
      const result2 = tracker.validateAndProcess('session-1', 'channel-1', 0);
      const result3 = tracker.validateAndProcess('session-1', 'channel-1', 0);

      expect(result1.isValid).toBe(false);
      expect(result2.isValid).toBe(false);
      expect(result3.isValid).toBe(false);
    });

    it('should detect replay after gap', () => {
      // Process messages with a gap
      tracker.validateAndProcess('session-1', 'channel-1', 0);
      tracker.validateAndProcess('session-1', 'channel-1', 1);
      tracker.validateAndProcess('session-1', 'channel-1', 100);

      // Try to replay old message
      const result = tracker.validateAndProcess('session-1', 'channel-1', 1);
      expect(result.isValid).toBe(false);
    });

    it('should allow interleaved sequences from different sessions', () => {
      // Session A
      tracker.validateAndProcess('session-A', 'channel-1', 0);
      tracker.validateAndProcess('session-A', 'channel-1', 1);

      // Session B (should not affect session A)
      tracker.validateAndProcess('session-B', 'channel-1', 0);
      tracker.validateAndProcess('session-B', 'channel-1', 1);

      // Session A continues - should be fine
      const result = tracker.validateAndProcess('session-A', 'channel-1', 2);
      expect(result.isValid).toBe(true);
    });
  });

  describe('window pruning', () => {
    it('should prune old sequence numbers from memory', () => {
      // Process many messages to move the window significantly
      // MAX_SEQUENCE_WINDOW = 1000, so after processing 0-1100,
      // windowStart should be 101 and sequences < 101 should be pruned
      for (let i = 0; i < 1101; i++) {
        tracker.validateAndProcess('session-1', 'channel-1', i);
      }

      // Sequence 0-100 should be pruned (window is [101, 1100])
      expect(tracker.hasSeen('session-1', 'channel-1', 0)).toBe(false);
      expect(tracker.hasSeen('session-1', 'channel-1', 50)).toBe(false);
      expect(tracker.hasSeen('session-1', 'channel-1', 100)).toBe(false);
      // Sequence 101-1100 should still be visible (within window)
      expect(tracker.hasSeen('session-1', 'channel-1', 101)).toBe(true);
      expect(tracker.hasSeen('session-1', 'channel-1', 1000)).toBe(true);
      expect(tracker.hasSeen('session-1', 'channel-1', 1100)).toBe(true);
    });
  });
});
