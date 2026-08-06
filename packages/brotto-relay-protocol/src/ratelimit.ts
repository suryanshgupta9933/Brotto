/**
 * Rate limiting types and implementation
 *
 * Implements token bucket rate limiting per session/channel.
 * Used for per-session bandwidth limits.
 */

import {
  RateLimiterConfig,
  RateLimitState,
  RateLimitPayload,
  MessageType,
  ProtocolErrorCode,
  ProtocolOptions,
  RelayMessage,
  ValidationResult,
  ValidationError,
} from './types.js';
import { createMessage } from './serialization.js';

/**
 * Default rate limiter configuration
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimiterConfig = {
  tokensPerSecond: 1000, // 1000 messages per second
  burstSize: 100, // Allow burst of 100 messages
  windowSizeMs: 1000, // 1 second window
};

/**
 * Token bucket rate limiter
 */
export class RateLimiter {
  private config: RateLimiterConfig;
  private states: Map<string, RateLimitState> = new Map();

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_RATE_LIMIT_CONFIG, ...config };
  }

  /**
   * Get or create rate limit state for a session/channel
   */
  private getState(key: string): RateLimitState {
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
  private refillTokens(state: RateLimitState): void {
    const now = Date.now();
    const elapsed = now - state.lastRefill;

    if (elapsed >= this.config.windowSizeMs) {
      // Calculate tokens to add
      const windows = Math.floor(elapsed / this.config.windowSizeMs);
      const tokensToAdd = windows * this.config.tokensPerSecond * (this.config.windowSizeMs / 1000);

      state.tokensAvailable = Math.min(
        this.config.burstSize,
        state.tokensAvailable + tokensToAdd
      );
      state.lastRefill = now;
      state.currentBurst = 0;
    }
  }

  /**
   * Check if a message is allowed and consume a token if so
   */
  check(key: string): ValidationResult {
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
  tryConsume(key: string, tokens: number = 1): boolean {
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
  getAvailable(key: string): number {
    const state = this.getState(key);
    this.refillTokens(state);
    return state.tokensAvailable;
  }

  /**
   * Get rate limit state for a key
   */
  getStateInfo(key: string): RateLimitState {
    const state = this.getState(key);
    this.refillTokens(state);
    return { ...state };
  }

  /**
   * Reset rate limit state for a key
   */
  reset(key: string): void {
    this.states.delete(key);
  }

  /**
   * Reset all rate limit states
   */
  resetAll(): void {
    this.states.clear();
  }

  /**
   * Update rate limit configuration
   */
  updateConfig(config: Partial<RateLimiterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): RateLimiterConfig {
    return { ...this.config };
  }

  /**
   * Get statistics for a key
   */
  getStats(key: string): {
    tokensAvailable: number;
    currentBurst: number;
    lastRefill: number;
    refillRate: number;
  } {
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
  getWaitTime(key: string, tokens: number = 1): number {
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
  private limiter: RateLimiter;

  constructor(config?: Partial<RateLimiterConfig>) {
    this.limiter = new RateLimiter(config);
  }

  /**
   * Check if a message is allowed for a session/channel
   */
  check(sessionId: string, channelId: string): ValidationResult {
    const key = `${sessionId}:${channelId}`;
    return this.limiter.check(key);
  }

  /**
   * Get available tokens
   */
  getAvailable(sessionId: string, channelId: string): number {
    const key = `${sessionId}:${channelId}`;
    return this.limiter.getAvailable(key);
  }

  /**
   * Reset limits for a session
   */
  resetSession(sessionId: string): void {
    // Reset all channels for this session
    const keysToDelete: string[] = [];
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
  resetChannel(sessionId: string, channelId: string): void {
    const key = `${sessionId}:${channelId}`;
    this.limiter.reset(key);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RateLimiterConfig>): void {
    this.limiter.updateConfig(config);
  }

  /**
   * Get configuration
   */
  getConfig(): RateLimiterConfig {
    return this.limiter.getConfig();
  }
}

/**
 * Create a rate limit payload for sending to peers
 */
export function createRateLimitPayload(
  sessionId: string,
  tokensPerSecond: number,
  burstSize: number,
  channelId?: string
): RateLimitPayload {
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
export function createRateLimitMessage(
  options: ProtocolOptions,
  tokensPerSecond: number,
  burstSize: number
): RelayMessage {
  const payload = createRateLimitPayload(
    options.sessionId,
    tokensPerSecond,
    burstSize,
    options.channelId
  );

  return createMessage({
    ...options,
    messageType: MessageType.RATE_LIMIT_UPDATE,
    payload,
  });
}

/**
 * Calculate recommended rate limit based on message sizes
 */
export function calculateRateLimit(
  avgMessageSizeBytes: number,
  maxBandwidthBytesPerSecond: number
): RateLimiterConfig {
  const messagesPerSecond = Math.floor(maxBandwidthBytesPerSecond / avgMessageSizeBytes);
  const burstSize = Math.min(100, Math.floor(messagesPerSecond * 0.1)); // 10% of rate, max 100

  return {
    tokensPerSecond: Math.max(1, messagesPerSecond),
    burstSize: Math.max(1, burstSize),
    windowSizeMs: 1000,
  };
}
