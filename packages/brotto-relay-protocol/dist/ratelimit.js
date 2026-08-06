/**
 * Rate limiting types and implementation
 *
 * Implements token bucket rate limiting per session/channel.
 * Used for per-session bandwidth limits.
 */
import { MessageType, ProtocolErrorCode, } from './types.js';
import { createMessage } from './serialization.js';
/**
 * Default rate limiter configuration
 */
export const DEFAULT_RATE_LIMIT_CONFIG = {
    tokensPerSecond: 1000, // 1000 messages per second
    burstSize: 100, // Allow burst of 100 messages
    windowSizeMs: 1000, // 1 second window
};
/**
 * Token bucket rate limiter
 */
export class RateLimiter {
    config;
    states = new Map();
    constructor(config = {}) {
        this.config = { ...DEFAULT_RATE_LIMIT_CONFIG, ...config };
    }
    /**
     * Get or create rate limit state for a session/channel
     */
    getState(key) {
        let state = this.states.get(key);
        if (!state) {
            state = {
                tokensAvailable: this.config.burstSize,
                lastRefill: Date.now(),
                currentBurst: 0,
            };
            this.states.set(key, state);
        }
        return state;
    }
    /**
     * Refill tokens based on elapsed time
     */
    refillTokens(state) {
        const now = Date.now();
        const elapsed = now - state.lastRefill;
        if (elapsed >= this.config.windowSizeMs) {
            // Calculate tokens to add
            const windows = Math.floor(elapsed / this.config.windowSizeMs);
            const tokensToAdd = windows * this.config.tokensPerSecond * (this.config.windowSizeMs / 1000);
            state.tokensAvailable = Math.min(this.config.burstSize, state.tokensAvailable + tokensToAdd);
            state.lastRefill = now;
            state.currentBurst = 0;
        }
    }
    /**
     * Check if a message is allowed and consume a token if so
     */
    check(key) {
        const state = this.getState(key);
        // Refill tokens
        this.refillTokens(state);
        // Check if we have tokens available
        if (state.tokensAvailable < 1) {
            return {
                isValid: false,
                errors: [
                    {
                        field: 'rateLimit',
                        message: `Rate limit exceeded. Tokens available: ${state.tokensAvailable.toFixed(2)}`,
                        code: ProtocolErrorCode.RATE_LIMIT_EXCEEDED,
                    },
                ],
            };
        }
        // Consume a token
        state.tokensAvailable -= 1;
        state.currentBurst += 1;
        return { isValid: true, errors: [] };
    }
    /**
     * Try to consume tokens without failing
     */
    tryConsume(key, tokens = 1) {
        const state = this.getState(key);
        this.refillTokens(state);
        if (state.tokensAvailable >= tokens) {
            state.tokensAvailable -= tokens;
            state.currentBurst += tokens;
            return true;
        }
        return false;
    }
    /**
     * Get current tokens available
     */
    getAvailable(key) {
        const state = this.getState(key);
        this.refillTokens(state);
        return state.tokensAvailable;
    }
    /**
     * Get rate limit state for a key
     */
    getStateInfo(key) {
        const state = this.getState(key);
        this.refillTokens(state);
        return { ...state };
    }
    /**
     * Reset rate limit state for a key
     */
    reset(key) {
        this.states.delete(key);
    }
    /**
     * Reset all rate limit states
     */
    resetAll() {
        this.states.clear();
    }
    /**
     * Update rate limit configuration
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Get statistics for a key
     */
    getStats(key) {
        const state = this.getState(key);
        return {
            tokensAvailable: state.tokensAvailable,
            currentBurst: state.currentBurst,
            lastRefill: state.lastRefill,
            refillRate: this.config.tokensPerSecond,
        };
    }
    /**
     * Calculate time until a certain number of tokens are available
     */
    getWaitTime(key, tokens = 1) {
        const state = this.getState(key);
        this.refillTokens(state);
        if (state.tokensAvailable >= tokens) {
            return 0;
        }
        const tokensNeeded = tokens - state.tokensAvailable;
        const tokensPerWindow = this.config.tokensPerSecond * (this.config.windowSizeMs / 1000);
        const windowsNeeded = Math.ceil(tokensNeeded / tokensPerWindow);
        const windowSizeMs = this.config.windowSizeMs;
        return windowsNeeded * windowSizeMs;
    }
}
/**
 * Session-based rate limiter that automatically uses sessionId + channelId
 */
export class SessionRateLimiter {
    limiter;
    constructor(config) {
        this.limiter = new RateLimiter(config);
    }
    /**
     * Check if a message is allowed for a session/channel
     */
    check(sessionId, channelId) {
        const key = `${sessionId}:${channelId}`;
        return this.limiter.check(key);
    }
    /**
     * Get available tokens
     */
    getAvailable(sessionId, channelId) {
        const key = `${sessionId}:${channelId}`;
        return this.limiter.getAvailable(key);
    }
    /**
     * Reset limits for a session
     */
    resetSession(sessionId) {
        // Reset all channels for this session
        const keysToDelete = [];
        for (const key of this.limiter['states'].keys()) {
            if (key.startsWith(`${sessionId}:`)) {
                keysToDelete.push(key);
            }
        }
        for (const key of keysToDelete) {
            this.limiter.reset(key);
        }
    }
    /**
     * Reset a specific channel
     */
    resetChannel(sessionId, channelId) {
        const key = `${sessionId}:${channelId}`;
        this.limiter.reset(key);
    }
    /**
     * Update configuration
     */
    updateConfig(config) {
        this.limiter.updateConfig(config);
    }
    /**
     * Get configuration
     */
    getConfig() {
        return this.limiter.getConfig();
    }
}
/**
 * Create a rate limit payload for sending to peers
 */
export function createRateLimitPayload(sessionId, tokensPerSecond, burstSize, channelId) {
    return {
        sessionId,
        channelId,
        tokensPerSecond,
        burstSize,
        windowSizeMs: 1000,
    };
}
/**
 * Create a rate limit update message
 */
export function createRateLimitMessage(options, tokensPerSecond, burstSize) {
    const payload = createRateLimitPayload(options.sessionId, tokensPerSecond, burstSize, options.channelId);
    return createMessage({
        ...options,
        messageType: MessageType.RATE_LIMIT_UPDATE,
        payload,
    });
}
/**
 * Calculate recommended rate limit based on message sizes
 */
export function calculateRateLimit(avgMessageSizeBytes, maxBandwidthBytesPerSecond) {
    const messagesPerSecond = Math.floor(maxBandwidthBytesPerSecond / avgMessageSizeBytes);
    const burstSize = Math.min(100, Math.floor(messagesPerSecond * 0.1)); // 10% of rate, max 100
    return {
        tokensPerSecond: Math.max(1, messagesPerSecond),
        burstSize: Math.max(1, burstSize),
        windowSizeMs: 1000,
    };
}
//# sourceMappingURL=ratelimit.js.map