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
import { MessageType, } from './types.js';
import { createMessage } from './serialization.js';
/**
 * Backpressure manager for tracking and handling backpressure states
 */
export class BackpressureManager {
    states = new Map();
    listeners = new Map();
    /**
     * Get or create backpressure state for a session/channel
     */
    getState(sessionId, channelId) {
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
    beginBackpressure(sessionId, channelId, reason, windowSize) {
        const key = this.getKey(sessionId, channelId);
        const state = {
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
    endBackpressure(sessionId, channelId) {
        const key = this.getKey(sessionId, channelId);
        const state = {
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
    isBackpressured(sessionId, channelId) {
        const state = this.getState(sessionId, channelId);
        return state.isBackpressured;
    }
    /**
     * Get current backpressure state
     */
    getBackpressureState(sessionId, channelId) {
        return { ...this.getState(sessionId, channelId) };
    }
    /**
     * Register a listener for backpressure changes
     */
    addListener(sessionId, channelId, callback) {
        const key = this.getKey(sessionId, channelId);
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }
        this.listeners.get(key).add(callback);
        // Return unsubscribe function
        return () => {
            this.listeners.get(key)?.delete(callback);
        };
    }
    /**
     * Get duration of current backpressure (if any)
     */
    getBackpressureDuration(sessionId, channelId) {
        const state = this.states.get(this.getKey(sessionId, channelId));
        if (!state || !state.isBackpressured || !state.startTime) {
            return null;
        }
        return Date.now() - state.startTime;
    }
    /**
     * Clear all backpressure states
     */
    clear() {
        this.states.clear();
        this.listeners.clear();
    }
    /**
     * Clear backpressure state for a specific session
     */
    clearSession(sessionId) {
        const keysToDelete = [];
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
    getBackpressuredSessions() {
        const result = [];
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
    getKey(sessionId, channelId) {
        return `${sessionId}:${channelId}`;
    }
    /**
     * Notify listeners of state change
     */
    notifyListeners(sessionId, channelId, state) {
        const key = this.getKey(sessionId, channelId);
        const callbacks = this.listeners.get(key);
        if (callbacks) {
            for (const callback of callbacks) {
                try {
                    callback({ ...state });
                }
                catch {
                    // Ignore listener errors
                }
            }
        }
    }
}
/**
 * Create a backpressure begin payload
 */
export function createBackpressureBeginPayload(sessionId, channelId, reason, windowSize) {
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
export function createBackpressureEndPayload(sessionId, channelId) {
    return {
        sessionId,
        channelId,
    };
}
/**
 * Create a backpressure begin message
 */
export function createBackpressureBeginMessage(options, reason, windowSize) {
    const payload = createBackpressureBeginPayload(options.sessionId, options.channelId, reason, windowSize);
    return createMessage({
        ...options,
        messageType: MessageType.BACKPRESSURE_BEGIN,
        payload,
    });
}
/**
 * Create a backpressure end message
 */
export function createBackpressureEndMessage(options) {
    const payload = createBackpressureEndPayload(options.sessionId, options.channelId);
    return createMessage({
        ...options,
        messageType: MessageType.BACKPRESSURE_END,
        payload,
    });
}
/**
 * Validate backpressure payload
 */
export function validateBackpressurePayload(payload) {
    if (!payload || typeof payload !== 'object')
        return false;
    const p = payload;
    return (typeof p.sessionId === 'string' &&
        typeof p.channelId === 'string' &&
        typeof p.reason === 'string' &&
        ['bandwidth', 'memory', 'rate_limit', 'queue_full'].includes(p.reason));
}
/**
 * Calculate recommended window size based on current conditions
 */
export function calculateRecommendedWindow(currentQueueSize, maxQueueSize, currentProcessingRate) {
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
 * Default backpressure thresholds
 */
export const DEFAULT_BACKPRESSURE_THRESHOLDS = {
    bandwidthPercentHigh: 80,
    bandwidthPercentLow: 50,
    memoryPercentHigh: 85,
    memoryPercentLow: 60,
    queueSizeHigh: 100,
    queueSizeLow: 20,
};
//# sourceMappingURL=backpressure.js.map