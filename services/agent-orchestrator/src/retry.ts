/**
 * Retry Logic and Circuit Breaker
 *
 * Implements retry with exponential backoff and circuit breaker pattern
 * as specified in ARCHITECTURE.md section 8.8
 *
 * Per ARCHITECTURE.md section 8.8:
 * - Maximum retry count
 * - Stop agent when repeatedly attempts same action without state change
 */


/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'closed', // Normal operation
  OPEN = 'open', // Failing, reject requests
  HALF_OPEN = 'half_open', // Testing if service recovered
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening circuit
  successThreshold: number; // Number of successes needed to close circuit
  timeoutMs: number; // Time to wait before trying half-open
  resetTimeoutMs?: number; // Backoff reset time
}

/**
 * Default circuit breaker configuration
 */
const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeoutMs: 30000, // 30 seconds
  resetTimeoutMs: 60000, // 1 minute
};

/**
 * Circuit breaker events
 */
export enum CircuitEvent {
  OPEN = 'open',
  CLOSE = 'close',
  HALF_OPEN = 'half_open',
  STATE_CHANGE = 'state_change',
}

/**
 * Circuit breaker event listener
 */
export type CircuitEventListener = (event: { type: CircuitEvent; state: CircuitState }) => void;

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: RetryableError[];
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    'timeout',
    'network_error',
    'service_unavailable',
    'rate_limit',
    'mcp_error',
  ] as RetryableError[],
};

/**
 * Errors that should trigger retry
 */
export enum RetryableError {
  TIMEOUT = 'timeout',
  NETWORK_ERROR = 'network_error',
  SERVICE_UNAVAILABLE = 'service_unavailable',
  RATE_LIMIT = 'rate_limit',
  MCP_ERROR = 'mcp_error',
}

/**
 * Retry state for a specific operation
 */
interface RetryState {
  attempts: number;
  lastAttempt: Date;
  totalDelayMs: number;
}

/**
 * Circuit breaker implementation
 */
export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitState;
  private failureCount: number;
  private successCount: number;
  private lastFailureTime: Date | null;
  private listeners: Set<CircuitEventListener>;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.listeners = new Set();
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      // Check if we should transition to half-open
      if (this.shouldAttemptReset()) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        throw new CircuitBreakerOpenError(
          `Circuit breaker is OPEN. Last failure: ${this.lastFailureTime?.toISOString()}`
        );
      }
    }

    try {
      const result = await fn();

      if (this.state === CircuitState.HALF_OPEN) {
        this.successCount++;
        if (this.successCount >= this.config.successThreshold) {
          this.transitionTo(CircuitState.CLOSED);
        }
      } else {
        // Reset failure count on success
        this.failureCount = 0;
      }

      return result;
    } catch (error) {
      this.recordFailure();

      if (this.state === CircuitState.HALF_OPEN) {
        // Any failure in half-open state opens the circuit again
        this.transitionTo(CircuitState.OPEN);
      } else if (this.failureCount >= this.config.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
      }

      throw error;
    }
  }

  /**
   * Check if circuit should attempt reset
   */
  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) {
      return true;
    }
    return Date.now() - this.lastFailureTime.getTime() >= this.config.timeoutMs;
  }

  /**
   * Record a failure
   */
  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();
    this.successCount = 0;
  }

  /**
   * Transition to new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    if (newState === CircuitState.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
      this.emit({ type: CircuitEvent.CLOSE, state: newState });
    } else if (newState === CircuitState.OPEN) {
      this.emit({ type: CircuitEvent.OPEN, state: newState });
    } else if (newState === CircuitState.HALF_OPEN) {
      this.successCount = 0;
      this.emit({ type: CircuitEvent.HALF_OPEN, state: newState });
    }

    this.emit({ type: CircuitEvent.STATE_CHANGE, state: newState });
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Check if circuit is closed (normal operation)
   */
  isClosed(): boolean {
    return this.state === CircuitState.CLOSED;
  }

  /**
   * Check if circuit is open (failing)
   */
  isOpen(): boolean {
    return this.state === CircuitState.OPEN;
  }

  /**
   * Check if circuit is half-open (testing)
   */
  isHalfOpen(): boolean {
    return this.state === CircuitState.HALF_OPEN;
  }

  /**
   * Add event listener
   */
  addListener(listener: CircuitEventListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove event listener
   */
  removeListener(listener: CircuitEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit event
   */
  private emit(event: { type: CircuitEvent; state: CircuitState }): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('Circuit breaker event listener error:', e);
      }
    }
  }

  /**
   * Reset circuit breaker to closed state
   */
  reset(): void {
    this.transitionTo(CircuitState.CLOSED);
  }

  /**
   * Get statistics
   */
  getStats(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: Date | null;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

/**
 * Circuit breaker open error
 */
export class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

/**
 * Retry handler with exponential backoff
 */
export class RetryHandler {
  private config: RetryConfig;
  private retryState: Map<string, RetryState>;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
    this.retryState = new Map();
  }

  /**
   * Execute a function with retry logic
   */
  async execute<T>(
    operationId: string,
    fn: () => Promise<T>,
    shouldRetry?: (error: unknown) => boolean
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        this.updateRetryState(operationId, attempt);
        const result = await fn();
        this.clearRetryState(operationId);
        return result;
      } catch (error) {
        lastError = error;

        // Check if we should retry
        if (attempt < this.config.maxRetries && this.isRetryable(error, shouldRetry)) {
          const delay = this.calculateDelay(attempt);
          await this.sleep(delay);
        } else {
          break;
        }
      }
    }

    throw lastError;
  }

  /**
   * Check if error is retryable
   */
  private isRetryable(
    error: unknown,
    customChecker?: (error: unknown) => boolean
  ): boolean {
    if (customChecker) {
      return customChecker(error);
    }

    const errorStr = String(error).toLowerCase();

    for (const retryable of this.config.retryableErrors || []) {
      switch (retryable) {
        case RetryableError.TIMEOUT:
          if (errorStr.includes('timeout')) return true;
          break;
        case RetryableError.NETWORK_ERROR:
          if (
            errorStr.includes('network') ||
            errorStr.includes('econnrefused') ||
            errorStr.includes('enotfound')
          )
            return true;
          break;
        case RetryableError.SERVICE_UNAVAILABLE:
          if (errorStr.includes('503') || errorStr.includes('unavailable')) return true;
          break;
        case RetryableError.RATE_LIMIT:
          if (errorStr.includes('429') || errorStr.includes('rate limit')) return true;
          break;
        case RetryableError.MCP_ERROR:
          if (errorStr.includes('mcp')) return true;
          break;
      }
    }

    return false;
  }

  /**
   * Calculate delay with exponential backoff
   */
  private calculateDelay(attempt: number): number {
    const delay = this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, attempt);
    return Math.min(delay, this.config.maxDelayMs);
  }

  /**
   * Update retry state
   */
  private updateRetryState(operationId: string, attempt: number): void {
    const state: RetryState = {
      attempts: attempt,
      lastAttempt: new Date(),
      totalDelayMs: 0,
    };
    this.retryState.set(operationId, state);
  }

  /**
   * Clear retry state
   */
  private clearRetryState(operationId: string): void {
    this.retryState.delete(operationId);
  }

  /**
   * Sleep for specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get retry state for operation
   */
  getRetryState(operationId: string): RetryState | undefined {
    return this.retryState.get(operationId);
  }

  /**
   * Check if operation is being retried
   */
  isRetrying(operationId: string): boolean {
    const state = this.retryState.get(operationId);
    return state !== undefined;
  }

  /**
   * Get retry count for operation
   */
  getRetryCount(operationId: string): number {
    return this.retryState.get(operationId)?.attempts ?? 0;
  }
}

/**
 * Combined retry and circuit breaker wrapper
 */
export class ResilientExecutor {
  private circuitBreaker: CircuitBreaker;
  private retryHandler: RetryHandler;

  constructor(circuitConfig?: Partial<CircuitBreakerConfig>, retryConfig?: Partial<RetryConfig>) {
    this.circuitBreaker = new CircuitBreaker(circuitConfig);
    this.retryHandler = new RetryHandler(retryConfig);
  }

  /**
   * Execute with circuit breaker and retry
   */
  async execute<T>(
    operationId: string,
    fn: () => Promise<T>,
    options?: {
      skipRetry?: boolean;
      skipCircuitBreaker?: boolean;
      shouldRetry?: (error: unknown) => boolean;
    }
  ): Promise<T> {
    const executeFn = async () => {
      if (options?.skipRetry) {
        return fn();
      }
      return this.retryHandler.execute(operationId, fn, options?.shouldRetry);
    };

    if (options?.skipCircuitBreaker) {
      return executeFn();
    }

    return this.circuitBreaker.execute(executeFn);
  }

  /**
   * Get circuit breaker state
   */
  getCircuitState(): CircuitState {
    return this.circuitBreaker.getState();
  }

  /**
   * Check if circuit is healthy
   */
  isHealthy(): boolean {
    return this.circuitBreaker.isClosed();
  }

  /**
   * Get circuit breaker stats
   */
  getCircuitStats(): ReturnType<CircuitBreaker['getStats']> {
    return this.circuitBreaker.getStats();
  }

  /**
   * Add circuit event listener
   */
  addCircuitListener(listener: CircuitEventListener): void {
    this.circuitBreaker.addListener(listener);
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.circuitBreaker.reset();
  }
}

/**
 * Create a resilient executor with defaults
 */
export function createResilientExecutor(
  circuitConfig?: Partial<CircuitBreakerConfig>,
  retryConfig?: Partial<RetryConfig>
): ResilientExecutor {
  return new ResilientExecutor(circuitConfig, retryConfig);
}
