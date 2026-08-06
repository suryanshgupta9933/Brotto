/**
 * Rate limiting types and implementation
 *
 * Implements token bucket rate limiting per session/channel.
 * Used for per-session bandwidth limits.
 */
import { RateLimiterConfig, RateLimitState, RateLimitPayload, ProtocolOptions, RelayMessage, ValidationResult } from './types.js';
/**
 * Default rate limiter configuration
 */
export declare const DEFAULT_RATE_LIMIT_CONFIG: RateLimiterConfig;
/**
 * Token bucket rate limiter
 */
export declare class RateLimiter {
    private config;
    private states;
    constructor(config?: Partial<RateLimiterConfig>);
    /**
     * Get or create rate limit state for a session/channel
     */
    private getState;
    /**
     * Refill tokens based on elapsed time
     */
    private refillTokens;
    /**
     * Check if a message is allowed and consume a token if so
     */
    check(key: string): ValidationResult;
    /**
     * Try to consume tokens without failing
     */
    tryConsume(key: string, tokens?: number): boolean;
    /**
     * Get current tokens available
     */
    getAvailable(key: string): number;
    /**
     * Get rate limit state for a key
     */
    getStateInfo(key: string): RateLimitState;
    /**
     * Reset rate limit state for a key
     */
    reset(key: string): void;
    /**
     * Reset all rate limit states
     */
    resetAll(): void;
    /**
     * Update rate limit configuration
     */
    updateConfig(config: Partial<RateLimiterConfig>): void;
    /**
     * Get current configuration
     */
    getConfig(): RateLimiterConfig;
    /**
     * Get statistics for a key
     */
    getStats(key: string): {
        tokensAvailable: number;
        currentBurst: number;
        lastRefill: number;
        refillRate: number;
    };
    /**
     * Calculate time until a certain number of tokens are available
     */
    getWaitTime(key: string, tokens?: number): number;
}
/**
 * Session-based rate limiter that automatically uses sessionId + channelId
 */
export declare class SessionRateLimiter {
    private limiter;
    constructor(config?: Partial<RateLimiterConfig>);
    /**
     * Check if a message is allowed for a session/channel
     */
    check(sessionId: string, channelId: string): ValidationResult;
    /**
     * Get available tokens
     */
    getAvailable(sessionId: string, channelId: string): number;
    /**
     * Reset limits for a session
     */
    resetSession(sessionId: string): void;
    /**
     * Reset a specific channel
     */
    resetChannel(sessionId: string, channelId: string): void;
    /**
     * Update configuration
     */
    updateConfig(config: Partial<RateLimiterConfig>): void;
    /**
     * Get configuration
     */
    getConfig(): RateLimiterConfig;
}
/**
 * Create a rate limit payload for sending to peers
 */
export declare function createRateLimitPayload(sessionId: string, tokensPerSecond: number, burstSize: number, channelId?: string): RateLimitPayload;
/**
 * Create a rate limit update message
 */
export declare function createRateLimitMessage(options: ProtocolOptions, tokensPerSecond: number, burstSize: number): RelayMessage;
/**
 * Calculate recommended rate limit based on message sizes
 */
export declare function calculateRateLimit(avgMessageSizeBytes: number, maxBandwidthBytesPerSecond: number): RateLimiterConfig;
//# sourceMappingURL=ratelimit.d.ts.map