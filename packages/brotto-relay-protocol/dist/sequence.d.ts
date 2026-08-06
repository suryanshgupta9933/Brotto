/**
 * Sequence number tracking and replay protection
 *
 * Maintains per-session sequence state with a sliding window.
 * Rejects messages with sequence numbers outside the expected window.
 */
import { SequenceState, ValidationResult } from './types.js';
/**
 * In-memory store for sequence tracking per session/channel
 */
export declare class SequenceTracker {
    private sessions;
    /**
     * Get or create sequence state for a session/channel
     */
    getState(sessionId: string, channelId: string): SequenceState;
    /**
     * Validate and process a sequence number
     *
     * Returns a validation result indicating if the message should be accepted.
     * Messages with duplicate sequence numbers within the window are rejected (replay attack).
     * Messages with sequence numbers outside the expected window are also rejected.
     */
    validateAndProcess(sessionId: string, channelId: string, sequenceNumber: number): ValidationResult;
    /**
     * Remove sequence numbers that are now outside the sliding window
     */
    private pruneWindow;
    /**
     * Get the next expected sequence number for a session/channel
     */
    getNextExpected(sessionId: string, channelId: string): number;
    /**
     * Check if a sequence number has been seen (for debugging)
     */
    hasSeen(sessionId: string, channelId: string, sequenceNumber: number): boolean;
    /**
     * Reset sequence tracking for a session/channel
     */
    reset(sessionId: string, channelId: string): void;
    /**
     * Reset all sequence tracking (use with caution)
     */
    resetAll(): void;
    /**
     * Get statistics for a session
     */
    getStats(sessionId: string): {
        channelCount: number;
        totalMessagesReceived: number;
    };
    /**
     * Clean up expired sessions (call periodically)
     */
    cleanup(maxAgeMs: number): number;
}
export declare const defaultSequenceTracker: SequenceTracker;
//# sourceMappingURL=sequence.d.ts.map