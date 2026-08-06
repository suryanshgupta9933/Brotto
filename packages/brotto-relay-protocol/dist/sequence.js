/**
 * Sequence number tracking and replay protection
 *
 * Maintains per-session sequence state with a sliding window.
 * Rejects messages with sequence numbers outside the expected window.
 */
import { ProtocolErrorCode, MAX_SEQUENCE_WINDOW, } from './types.js';
/**
 * In-memory store for sequence tracking per session/channel
 */
export class SequenceTracker {
    sessions = new Map();
    /**
     * Get or create sequence state for a session/channel
     */
    getState(sessionId, channelId) {
        let sessionMap = this.sessions.get(sessionId);
        if (!sessionMap) {
            sessionMap = new Map();
            this.sessions.set(sessionId, sessionMap);
        }
        let state = sessionMap.get(channelId);
        if (!state) {
            state = {
                lastSequenceNumber: -1,
                receivedSequences: new Set(),
                windowStart: 0,
            };
            sessionMap.set(channelId, state);
        }
        return state;
    }
    /**
     * Validate and process a sequence number
     *
     * Returns a validation result indicating if the message should be accepted.
     * Messages with duplicate sequence numbers within the window are rejected (replay attack).
     * Messages with sequence numbers outside the expected window are also rejected.
     */
    validateAndProcess(sessionId, channelId, sequenceNumber) {
        const state = this.getState(sessionId, channelId);
        const errors = [];
        // First message - accept any sequence number >= 0
        if (state.lastSequenceNumber === -1) {
            state.lastSequenceNumber = sequenceNumber;
            state.receivedSequences.add(sequenceNumber);
            state.windowStart = sequenceNumber;
            return { isValid: true, errors: [] };
        }
        // Check for replay (duplicate within window)
        if (state.receivedSequences.has(sequenceNumber)) {
            errors.push({
                field: 'sequenceNumber',
                message: `Duplicate sequence number ${sequenceNumber} detected - possible replay attack`,
                code: ProtocolErrorCode.SEQUENCE_NUMBER_REPLAY,
            });
            return { isValid: false, errors };
        }
        // Check if sequence number is within acceptable window
        const windowEnd = state.lastSequenceNumber + MAX_SEQUENCE_WINDOW;
        const windowStart = state.windowStart;
        if (sequenceNumber < windowStart) {
            errors.push({
                field: 'sequenceNumber',
                message: `Sequence number ${sequenceNumber} is below window start ${windowStart} - too old`,
                code: ProtocolErrorCode.SEQUENCE_NUMBER_REPLAY,
            });
            return { isValid: false, errors };
        }
        if (sequenceNumber > windowEnd) {
            errors.push({
                field: 'sequenceNumber',
                message: `Sequence number ${sequenceNumber} exceeds window end ${windowEnd} - gap detected`,
                code: ProtocolErrorCode.SEQUENCE_NUMBER_INVALID,
            });
            return { isValid: false, errors };
        }
        // Accept the sequence number
        state.lastSequenceNumber = sequenceNumber;
        state.receivedSequences.add(sequenceNumber);
        // Clean up old sequences outside the window
        this.pruneWindow(sessionId, channelId);
        return { isValid: true, errors: [] };
    }
    /**
     * Remove sequence numbers that are now outside the sliding window
     */
    pruneWindow(sessionId, channelId) {
        const state = this.getState(sessionId, channelId);
        const newWindowStart = Math.max(0, state.lastSequenceNumber - MAX_SEQUENCE_WINDOW + 1);
        if (newWindowStart > state.windowStart) {
            state.windowStart = newWindowStart;
            // Remove old sequence numbers
            for (const seq of state.receivedSequences) {
                if (seq < state.windowStart) {
                    state.receivedSequences.delete(seq);
                }
            }
        }
    }
    /**
     * Get the next expected sequence number for a session/channel
     */
    getNextExpected(sessionId, channelId) {
        const state = this.getState(sessionId, channelId);
        return state.lastSequenceNumber + 1;
    }
    /**
     * Check if a sequence number has been seen (for debugging)
     */
    hasSeen(sessionId, channelId, sequenceNumber) {
        const state = this.getState(sessionId, channelId);
        return state.receivedSequences.has(sequenceNumber);
    }
    /**
     * Reset sequence tracking for a session/channel
     */
    reset(sessionId, channelId) {
        const sessionMap = this.sessions.get(sessionId);
        if (sessionMap) {
            sessionMap.delete(channelId);
            if (sessionMap.size === 0) {
                this.sessions.delete(sessionId);
            }
        }
    }
    /**
     * Reset all sequence tracking (use with caution)
     */
    resetAll() {
        this.sessions.clear();
    }
    /**
     * Get statistics for a session
     */
    getStats(sessionId) {
        const sessionMap = this.sessions.get(sessionId);
        if (!sessionMap) {
            return { channelCount: 0, totalMessagesReceived: 0 };
        }
        let totalMessages = 0;
        for (const state of sessionMap.values()) {
            totalMessages += state.receivedSequences.size;
        }
        return {
            channelCount: sessionMap.size,
            totalMessagesReceived: totalMessages,
        };
    }
    /**
     * Clean up expired sessions (call periodically)
     */
    cleanup(maxAgeMs) {
        let cleaned = 0;
        const now = Date.now();
        // Note: This is a simplified cleanup. In production, you'd want to track
        // last activity time per session for more precise cleanup.
        // For now, we just clean up empty entries.
        for (const [sessionId, sessionMap] of this.sessions.entries()) {
            for (const [channelId, state] of sessionMap.entries()) {
                if (state.receivedSequences.size === 0) {
                    sessionMap.delete(channelId);
                    cleaned++;
                }
            }
            if (sessionMap.size === 0) {
                this.sessions.delete(sessionId);
                cleaned++;
            }
        }
        return cleaned;
    }
}
// Singleton instance for convenience
export const defaultSequenceTracker = new SequenceTracker();
//# sourceMappingURL=sequence.js.map