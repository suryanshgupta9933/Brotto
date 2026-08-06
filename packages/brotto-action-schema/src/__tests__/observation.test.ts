/**
 * Unit tests for observation ID types.
 */

import {
  ObservationId,
  createObservationId,
  compareObservationIds,
  isValidObservationId,
  getNextObservationId,
  ObservationIdCounter,
} from '../observation';

describe('ObservationId', () => {
  it('should create observation ID from valid value', () => {
    const id = createObservationId(0);
    expect(id.value).toBe(0);
  });

  it('should create observation ID from positive value', () => {
    const id = createObservationId(100);
    expect(id.value).toBe(100);
  });

  it('should reject negative value', () => {
    expect(() => createObservationId(-1)).toThrow(
      'Invalid observation ID: -1. Must be a non-negative integer.'
    );
  });

  it('should reject non-integer value', () => {
    expect(() => createObservationId(1.5)).toThrow(
      'Invalid observation ID: 1.5. Must be a non-negative integer.'
    );
  });

  it('should reject NaN', () => {
    expect(() => createObservationId(NaN)).toThrow();
  });
});

describe('compareObservationIds', () => {
  it('should return 0 for equal IDs', () => {
    const id1 = createObservationId(5);
    const id2 = createObservationId(5);
    expect(compareObservationIds(id1, id2)).toBe(0);
  });

  it('should return negative when a < b', () => {
    const id1 = createObservationId(3);
    const id2 = createObservationId(5);
    expect(compareObservationIds(id1, id2)).toBe(-2);
  });

  it('should return positive when a > b', () => {
    const id1 = createObservationId(10);
    const id2 = createObservationId(5);
    expect(compareObservationIds(id1, id2)).toBe(5);
  });
});

describe('isValidObservationId', () => {
  it('should return true for 0', () => {
    expect(isValidObservationId(0)).toBe(true);
  });

  it('should return true for positive integer', () => {
    expect(isValidObservationId(100)).toBe(true);
  });

  it('should return false for negative integer', () => {
    expect(isValidObservationId(-1)).toBe(false);
  });

  it('should return false for non-integer', () => {
    expect(isValidObservationId(1.5)).toBe(false);
  });
});

describe('getNextObservationId', () => {
  it('should return ID with value incremented by 1', () => {
    const current = createObservationId(5);
    const next = getNextObservationId(current);
    expect(next.value).toBe(6);
  });

  it('should not modify original ID', () => {
    const current = createObservationId(5);
    getNextObservationId(current);
    expect(current.value).toBe(5);
  });
});

describe('ObservationIdCounter', () => {
  describe('constructor', () => {
    it('should start at 0 by default', () => {
      const counter = new ObservationIdCounter();
      expect(counter.peek().value).toBe(0);
    });

    it('should start at custom value', () => {
      const counter = new ObservationIdCounter(5);
      expect(counter.peek().value).toBe(5);
    });

    it('should reject negative initial value', () => {
      expect(() => new ObservationIdCounter(-1)).toThrow(
        'Invalid initial observation ID: -1'
      );
    });
  });

  describe('next', () => {
    it('should return next ID and increment counter', () => {
      const counter = new ObservationIdCounter();
      const id1 = counter.next();
      const id2 = counter.next();
      expect(id1.value).toBe(0);
      expect(id2.value).toBe(1);
    });
  });

  describe('peek', () => {
    it('should return current ID without incrementing', () => {
      const counter = new ObservationIdCounter();
      const id1 = counter.peek();
      const id2 = counter.peek();
      expect(id1.value).toBe(0);
      expect(id2.value).toBe(0);
    });
  });

  describe('reset', () => {
    it('should reset to 0 by default', () => {
      const counter = new ObservationIdCounter();
      counter.next();
      counter.next();
      counter.reset();
      expect(counter.peek().value).toBe(0);
    });

    it('should reset to custom value', () => {
      const counter = new ObservationIdCounter();
      counter.next();
      counter.reset(10);
      expect(counter.peek().value).toBe(10);
    });

    it('should reject invalid reset value', () => {
      const counter = new ObservationIdCounter();
      expect(() => counter.reset(-1)).toThrow('Invalid reset value: -1');
    });
  });

  describe('getCurrentValue', () => {
    it('should return current raw value', () => {
      const counter = new ObservationIdCounter();
      counter.next();
      counter.next();
      expect(counter.getCurrentValue()).toBe(2);
    });
  });
});
