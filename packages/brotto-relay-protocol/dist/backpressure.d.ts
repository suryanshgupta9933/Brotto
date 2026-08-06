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
import { BackpressurePayload, BackpressureState, ProtocolOptions, RelayMessage } from './types.js';
/**
 * Backpressure reasons
 */
export type BackpressureReason = 'bandwidth' | 'memory' | 'rate_limit' | 'queue_full';
/**
 * Backpressure manager for tracking and handling backpressure states
 */
export declare class BackpressureManager {
    private states;
    private listeners;
    /**
     * Get or create backpressure state for a session/channel
     */
    getState(sessionId: string, channelId: string): BackpressureState;
    /**
     * Signal the beginning of backpressure
     */
    beginBackpressure(sessionId: string, channelId: string, reason: BackpressureReason, windowSize?: number): BackpressureState;
    /**
     * Signal the end of backpressure
     */
    endBackpressure(sessionId: string, channelId: string): BackpressureState;
    /**
     * Check if a session/channel is in backpressure state
     */
    isBackpressured(sessionId: string, channelId: string): boolean;
    /**
     * Get current backpressure state
     */
    getBackpressureState(sessionId: string, channelId: string): BackpressureState;
    /**
     * Register a listener for backpressure changes
     */
    addListener(sessionId: string, channelId: string, callback: (state: BackpressureState) => void): () => void;
    /**
     * Get duration of current backpressure (if any)
     */
    getBackpressureDuration(sessionId: string, channelId: string): number | null;
    /**
     * Clear all backpressure states
     */
    clear(): void;
    /**
     * Clear backpressure state for a specific session
     */
    clearSession(sessionId: string): void;
    /**
     * Get all sessions in backpressure state
     */
    getBackpressuredSessions(): Array<{
        sessionId: string;
        channelId: string;
        state: BackpressureState;
    }>;
    /**
     * Get key for session/channel combination
     */
    private getKey;
    /**
     * Notify listeners of state change
     */
    private notifyListeners;
}
/**
 * Create a backpressure begin payload
 */
export declare function createBackpressureBeginPayload(sessionId: string, channelId: string, reason: BackpressureReason, windowSize?: number): BackpressurePayload;
/**
 * Create a backpressure end payload
 */
export declare function createBackpressureEndPayload(sessionId: string, channelId: string): {
    sessionId: string;
    channelId: string;
};
/**
 * Create a backpressure begin message
 */
export declare function createBackpressureBeginMessage(options: ProtocolOptions, reason: BackpressureReason, windowSize?: number): RelayMessage;
/**
 * Create a backpressure end message
 */
export declare function createBackpressureEndMessage(options: ProtocolOptions): RelayMessage;
/**
 * Validate backpressure payload
 */
export declare function validateBackpressurePayload(payload: unknown): payload is BackpressurePayload;
/**
 * Calculate recommended window size based on current conditions
 */
export declare function calculateRecommendedWindow(currentQueueSize: number, maxQueueSize: number, currentProcessingRate: number): number;
/**
 * Backpressure thresholds configuration
 */
export interface BackpressureThresholds {
    bandwidthPercentHigh: number;
    bandwidthPercentLow: number;
    memoryPercentHigh: number;
    memoryPercentLow: number;
    queueSizeHigh: number;
    queueSizeLow: number;
}
/**
 * Default backpressure thresholds
 */
export declare const DEFAULT_BACKPRESSURE_THRESHOLDS: BackpressureThresholds;
//# sourceMappingURL=backpressure.d.ts.map