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
export declare enum CircuitState {
    CLOSED = "closed",// Normal operation
    OPEN = "open",// Failing, reject requests
    HALF_OPEN = "half_open"
}
/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
    failureThreshold: number;
    successThreshold: number;
    timeoutMs: number;
    resetTimeoutMs?: number;
}
/**
 * Circuit breaker events
 */
export declare enum CircuitEvent {
    OPEN = "open",
    CLOSE = "close",
    HALF_OPEN = "half_open",
    STATE_CHANGE = "state_change"
}
/**
 * Circuit breaker event listener
 */
export type CircuitEventListener = (event: {
    type: CircuitEvent;
    state: CircuitState;
}) => void;
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
 * Errors that should trigger retry
 */
export declare enum RetryableError {
    TIMEOUT = "timeout",
    NETWORK_ERROR = "network_error",
    SERVICE_UNAVAILABLE = "service_unavailable",
    RATE_LIMIT = "rate_limit",
    MCP_ERROR = "mcp_error"
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
export declare class CircuitBreaker {
    private config;
    private state;
    private failureCount;
    private successCount;
    private lastFailureTime;
    private listeners;
    constructor(config?: Partial<CircuitBreakerConfig>);
    /**
     * Execute a function with circuit breaker protection
     */
    execute<T>(fn: () => Promise<T>): Promise<T>;
    /**
     * Check if circuit should attempt reset
     */
    private shouldAttemptReset;
    /**
     * Record a failure
     */
    private recordFailure;
    /**
     * Transition to new state
     */
    private transitionTo;
    /**
     * Get current state
     */
    getState(): CircuitState;
    /**
     * Check if circuit is closed (normal operation)
     */
    isClosed(): boolean;
    /**
     * Check if circuit is open (failing)
     */
    isOpen(): boolean;
    /**
     * Check if circuit is half-open (testing)
     */
    isHalfOpen(): boolean;
    /**
     * Add event listener
     */
    addListener(listener: CircuitEventListener): void;
    /**
     * Remove event listener
     */
    removeListener(listener: CircuitEventListener): void;
    /**
     * Emit event
     */
    private emit;
    /**
     * Reset circuit breaker to closed state
     */
    reset(): void;
    /**
     * Get statistics
     */
    getStats(): {
        state: CircuitState;
        failureCount: number;
        successCount: number;
        lastFailureTime: Date | null;
    };
}
/**
 * Circuit breaker open error
 */
export declare class CircuitBreakerOpenError extends Error {
    constructor(message: string);
}
/**
 * Retry handler with exponential backoff
 */
export declare class RetryHandler {
    private config;
    private retryState;
    constructor(config?: Partial<RetryConfig>);
    /**
     * Execute a function with retry logic
     */
    execute<T>(operationId: string, fn: () => Promise<T>, shouldRetry?: (error: unknown) => boolean): Promise<T>;
    /**
     * Check if error is retryable
     */
    private isRetryable;
    /**
     * Calculate delay with exponential backoff
     */
    private calculateDelay;
    /**
     * Update retry state
     */
    private updateRetryState;
    /**
     * Clear retry state
     */
    private clearRetryState;
    /**
     * Sleep for specified duration
     */
    private sleep;
    /**
     * Get retry state for operation
     */
    getRetryState(operationId: string): RetryState | undefined;
    /**
     * Check if operation is being retried
     */
    isRetrying(operationId: string): boolean;
    /**
     * Get retry count for operation
     */
    getRetryCount(operationId: string): number;
}
/**
 * Combined retry and circuit breaker wrapper
 */
export declare class ResilientExecutor {
    private circuitBreaker;
    private retryHandler;
    constructor(circuitConfig?: Partial<CircuitBreakerConfig>, retryConfig?: Partial<RetryConfig>);
    /**
     * Execute with circuit breaker and retry
     */
    execute<T>(operationId: string, fn: () => Promise<T>, options?: {
        skipRetry?: boolean;
        skipCircuitBreaker?: boolean;
        shouldRetry?: (error: unknown) => boolean;
    }): Promise<T>;
    /**
     * Get circuit breaker state
     */
    getCircuitState(): CircuitState;
    /**
     * Check if circuit is healthy
     */
    isHealthy(): boolean;
    /**
     * Get circuit breaker stats
     */
    getCircuitStats(): ReturnType<CircuitBreaker['getStats']>;
    /**
     * Add circuit event listener
     */
    addCircuitListener(listener: CircuitEventListener): void;
    /**
     * Reset circuit breaker
     */
    reset(): void;
}
/**
 * Create a resilient executor with defaults
 */
export declare function createResilientExecutor(circuitConfig?: Partial<CircuitBreakerConfig>, retryConfig?: Partial<RetryConfig>): ResilientExecutor;
export {};
//# sourceMappingURL=retry.d.ts.map