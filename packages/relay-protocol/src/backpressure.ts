/**
 * Backpressure signaling types and handling
 *
 * Backpressure signals are sent when:
 * - Bandwidth limits are approached
 * - Memory pressure is high
 * - Rate limits are exceeded
 * - Queue is full
 *
 * Both client and server can signal backpressure.
 */

import {
  BackpressurePayload,
  BackpressureState,
  MessageType,
  ProtocolOptions,
  RelayMessage,
} from './types.js';
import { createMessage } from './serialization.js';

/**
 * Backpressure reasons
 */
export type BackpressureReason = 'bandwidth' | 'memory' | 'rate_limit' | 'queue_full';

/**
 * Backpressure manager for tracking and handling backpressure states
 */
export class BackpressureManager {
  private states: Map<string, BackpressureState> = new Map();
  private listeners: Map<string, Set<(state: BackpressureState) => void>> = new Map();

  /**
   * Get or create backpressure state for a session/channel
   */
  getState(sessionId: string, channelId: string): BackpressureState {
    const key = this.getKey(sessionId, channelId);
    let state = this.states.get(key);

    if (!state) {
      state = {
        isBackpressured: false,
      };
      this.states.set(key, state);
    }

    return state;
  }

  /**
   * Signal the beginning of backpressure
   */
  beginBackpressure(
    sessionId: string,
    channelId: string,
    reason: BackpressureReason,
    windowSize?: number
  ): BackpressureState {
    const key = this.getKey(sessionId, channelId);
    const state: BackpressureState = {
      isBackpressured: true,
      reason,
      windowSize,
      startTime: Date.now(),
    };

    this.states.set(key, state);
    this.notifyListeners(sessionId, channelId, state);

    return state;
  }

  /**
   * Signal the end of backpressure
   */
  endBackpressure(sessionId: string, channelId: string): BackpressureState {
    const key = this.getKey(sessionId, channelId);
    const state: BackpressureState = {
      isBackpressured: false,
      startTime: this.states.get(key)?.startTime,
    };

    this.states.set(key, state);
    this.notifyListeners(sessionId, channelId, state);

    return state;
  }

  /**
   * Check if a session/channel is in backpressure state
   */
  isBackpressured(sessionId: string, channelId: string): boolean {
    const state = this.getState(sessionId, channelId);
    return state.isBackpressured;
  }

  /**
   * Get current backpressure state
   */
  getBackpressureState(sessionId: string, channelId: string): BackpressureState {
    return { ...this.getState(sessionId, channelId) };
  }

  /**
   * Register a listener for backpressure changes
   */
  addListener(
    sessionId: string,
    channelId: string,
    callback: (state: BackpressureState) => void
  ): () => void {
    const key = this.getKey(sessionId, channelId);

    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }

    this.listeners.get(key)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(key)?.delete(callback);
    };
  }

  /**
   * Get duration of current backpressure (if any)
   */
  getBackpressureDuration(sessionId: string, channelId: string): number | null {
    const state = this.states.get(this.getKey(sessionId, channelId));
    if (!state || !state.isBackpressured || !state.startTime) {
      return null;
    }
    return Date.now() - state.startTime;
  }

  /**
   * Clear all backpressure states
   */
  clear(): void {
    this.states.clear();
    this.listeners.clear();
  }

  /**
   * Clear backpressure state for a specific session
   */
  clearSession(sessionId: string): void {
    const keysToDelete: string[] = [];

    for (const key of this.states.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.states.delete(key);
      this.listeners.delete(key);
    }
  }

  /**
   * Get all sessions in backpressure state
   */
  getBackpressuredSessions(): Array<{ sessionId: string; channelId: string; state: BackpressureState }> {
    const result: Array<{ sessionId: string; channelId: string; state: BackpressureState }> = [];

    for (const [key, state] of this.states.entries()) {
      if (state.isBackpressured) {
        const parts = key.split(':');
        const sessionId = parts[0] ?? '';
        const channelId = parts[1] ?? '';
        result.push({ sessionId, channelId, state: { ...state } });
      }
    }

    return result;
  }

  /**
   * Get key for session/channel combination
   */
  private getKey(sessionId: string, channelId: string): string {
    return `${sessionId}:${channelId}`;
  }

  /**
   * Notify listeners of state change
   */
  private notifyListeners(sessionId: string, channelId: string, state: BackpressureState): void {
    const key = this.getKey(sessionId, channelId);
    const callbacks = this.listeners.get(key);

    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback({ ...state });
        } catch {
          // Ignore listener errors
        }
      }
    }
  }
}

/**
 * Create a backpressure begin payload
 */
export function createBackpressureBeginPayload(
  sessionId: string,
  channelId: string,
  reason: BackpressureReason,
  windowSize?: number
): BackpressurePayload {
  return {
    sessionId,
    channelId,
    reason,
    windowSize,
  };
}

/**
 * Create a backpressure end payload
 */
export function createBackpressureEndPayload(
  sessionId: string,
  channelId: string
): { sessionId: string; channelId: string } {
  return {
    sessionId,
    channelId,
  };
}

/**
 * Create a backpressure begin message
 */
export function createBackpressureBeginMessage(
  options: ProtocolOptions,
  reason: BackpressureReason,
  windowSize?: number
): RelayMessage {
  const payload = createBackpressureBeginPayload(
    options.sessionId,
    options.channelId,
    reason,
    windowSize
  );

  return createMessage({
    ...options,
    messageType: MessageType.BACKPRESSURE_BEGIN,
    payload,
  });
}

/**
 * Create a backpressure end message
 */
export function createBackpressureEndMessage(
  options: ProtocolOptions
): RelayMessage {
  const payload = createBackpressureEndPayload(
    options.sessionId,
    options.channelId
  );

  return createMessage({
    ...options,
    messageType: MessageType.BACKPRESSURE_END,
    payload,
  });
}

/**
 * Validate backpressure payload
 */
export function validateBackpressurePayload(
  payload: unknown
): payload is BackpressurePayload {
  if (!payload || typeof payload !== 'object') return false;

  const p = payload as Record<string, unknown>;

  return (
    typeof p.sessionId === 'string' &&
    typeof p.channelId === 'string' &&
    typeof p.reason === 'string' &&
    ['bandwidth', 'memory', 'rate_limit', 'queue_full'].includes(p.reason)
  );
}

/**
 * Calculate recommended window size based on current conditions
 */
export function calculateRecommendedWindow(
  currentQueueSize: number,
  maxQueueSize: number,
  currentProcessingRate: number
): number {
  // If queue is very full, recommend smaller window
  const queuePressure = currentQueueSize / maxQueueSize;

  if (queuePressure > 0.9) {
    return Math.max(1, Math.floor(currentProcessingRate * 0.1));
  }
  if (queuePressure > 0.7) {
    return Math.max(1, Math.floor(currentProcessingRate * 0.25));
  }
  if (queuePressure > 0.5) {
    return Math.max(1, Math.floor(currentProcessingRate * 0.5));
  }

  // Normal operation
  return currentProcessingRate;
}

/**
 * Backpressure thresholds configuration
 */
export interface BackpressureThresholds {
  bandwidthPercentHigh: number; // Start backpressure at this %
  bandwidthPercentLow: number; // Stop backpressure below this %
  memoryPercentHigh: number;
  memoryPercentLow: number;
  queueSizeHigh: number;
  queueSizeLow: number;
}

/**
 * Default backpressure thresholds
 */
export const DEFAULT_BACKPRESSURE_THRESHOLDS: BackpressureThresholds = {
  bandwidthPercentHigh: 80,
  bandwidthPercentLow: 50,
  memoryPercentHigh: 85,
  memoryPercentLow: 60,
  queueSizeHigh: 100,
  queueSizeLow: 20,
};
