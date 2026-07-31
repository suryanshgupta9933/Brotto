/**
 * Observation ID types for Fara actions.
 * Observation IDs are monotonically increasing integers used to track
 * the sequence of observations in a session.
 */

/**
 * A monotonically increasing observation identifier.
 * Each new observation received from the browser increments this value.
 */
export interface ObservationId {
  /** The numeric ID value (monotonically increasing) */
  readonly value: number;
}

/**
 * Creates a new observation ID from a number.
 */
export function createObservationId(value: number): ObservationId {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid observation ID: ${value}. Must be a non-negative integer.`);
  }
  return { value };
}

/**
 * Compares two observation IDs.
 * Returns negative if a < b, zero if a === b, positive if a > b.
 */
export function compareObservationIds(a: ObservationId, b: ObservationId): number {
  return a.value - b.value;
}

/**
 * Checks if an observation ID is validly formed (non-negative integer).
 */
export function isValidObservationId(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * The next observation ID in sequence from a given ID.
 */
export function getNextObservationId(current: ObservationId): ObservationId {
  return createObservationId(current.value + 1);
}

/**
 * Observation ID counter for generating new IDs.
 */
export class ObservationIdCounter {
  private currentValue: number;

  /**
   * Creates a new counter starting at 0 (or a given initial value).
   */
  constructor(initialValue: number = 0) {
    if (!isValidObservationId(initialValue)) {
      throw new Error(`Invalid initial observation ID: ${initialValue}`);
    }
    this.currentValue = initialValue;
  }

  /**
   * Returns the next observation ID and increments the counter.
   */
  next(): ObservationId {
    const id = createObservationId(this.currentValue);
    this.currentValue++;
    return id;
  }

  /**
   * Returns the current ID without incrementing.
   */
  peek(): ObservationId {
    return createObservationId(this.currentValue);
  }

  /**
   * Resets the counter to a specific value.
   */
  reset(value: number = 0): void {
    if (!isValidObservationId(value)) {
      throw new Error(`Invalid reset value: ${value}`);
    }
    this.currentValue = value;
  }

  /**
   * Returns the current raw value.
   */
  getCurrentValue(): number {
    return this.currentValue;
  }
}
