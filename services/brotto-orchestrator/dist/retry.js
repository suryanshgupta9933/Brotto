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
export var CircuitState;
(function (CircuitState) {
    CircuitState["CLOSED"] = "closed";
    CircuitState["OPEN"] = "open";
    CircuitState["HALF_OPEN"] = "half_open";
})(CircuitState || (CircuitState = {}));
/**
 * Default circuit breaker configuration
 */
const DEFAULT_CIRCUIT_BREAKER_CONFIG = {
    failureThreshold: 5,
    successThreshold: 2,
    timeoutMs: 30000, // 30 seconds
    resetTimeoutMs: 60000, // 1 minute
};
/**
 * Circuit breaker events
 */
export var CircuitEvent;
(function (CircuitEvent) {
    CircuitEvent["OPEN"] = "open";
    CircuitEvent["CLOSE"] = "close";
    CircuitEvent["HALF_OPEN"] = "half_open";
    CircuitEvent["STATE_CHANGE"] = "state_change";
})(CircuitEvent || (CircuitEvent = {}));
/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG = {
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
    ],
};
/**
 * Errors that should trigger retry
 */
export var RetryableError;
(function (RetryableError) {
    RetryableError["TIMEOUT"] = "timeout";
    RetryableError["NETWORK_ERROR"] = "network_error";
    RetryableError["SERVICE_UNAVAILABLE"] = "service_unavailable";
    RetryableError["RATE_LIMIT"] = "rate_limit";
    RetryableError["MCP_ERROR"] = "mcp_error";
})(RetryableError || (RetryableError = {}));
/**
 * Circuit breaker implementation
 */
export class CircuitBreaker {
    config;
    state;
    failureCount;
    successCount;
    lastFailureTime;
    listeners;
    constructor(config = {}) {
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
    async execute(fn) {
        if (this.state === CircuitState.OPEN) {
            // Check if we should transition to half-open
            if (this.shouldAttemptReset()) {
                this.transitionTo(CircuitState.HALF_OPEN);
            }
            else {
                throw new CircuitBreakerOpenError(`Circuit breaker is OPEN. Last failure: ${this.lastFailureTime?.toISOString()}`);
            }
        }
        try {
            const result = await fn();
            if (this.state === CircuitState.HALF_OPEN) {
                this.successCount++;
                if (this.successCount >= this.config.successThreshold) {
                    this.transitionTo(CircuitState.CLOSED);
                }
            }
            else {
                // Reset failure count on success
                this.failureCount = 0;
            }
            return result;
        }
        catch (error) {
            this.recordFailure();
            if (this.state === CircuitState.HALF_OPEN) {
                // Any failure in half-open state opens the circuit again
                this.transitionTo(CircuitState.OPEN);
            }
            else if (this.failureCount >= this.config.failureThreshold) {
                this.transitionTo(CircuitState.OPEN);
            }
            throw error;
        }
    }
    /**
     * Check if circuit should attempt reset
     */
    shouldAttemptReset() {
        if (!this.lastFailureTime) {
            return true;
        }
        return Date.now() - this.lastFailureTime.getTime() >= this.config.timeoutMs;
    }
    /**
     * Record a failure
     */
    recordFailure() {
        this.failureCount++;
        this.lastFailureTime = new Date();
        this.successCount = 0;
    }
    /**
     * Transition to new state
     */
    transitionTo(newState) {
        this.state = newState;
        if (newState === CircuitState.CLOSED) {
            this.failureCount = 0;
            this.successCount = 0;
            this.emit({ type: CircuitEvent.CLOSE, state: newState });
        }
        else if (newState === CircuitState.OPEN) {
            this.emit({ type: CircuitEvent.OPEN, state: newState });
        }
        else if (newState === CircuitState.HALF_OPEN) {
            this.successCount = 0;
            this.emit({ type: CircuitEvent.HALF_OPEN, state: newState });
        }
        this.emit({ type: CircuitEvent.STATE_CHANGE, state: newState });
    }
    /**
     * Get current state
     */
    getState() {
        return this.state;
    }
    /**
     * Check if circuit is closed (normal operation)
     */
    isClosed() {
        return this.state === CircuitState.CLOSED;
    }
    /**
     * Check if circuit is open (failing)
     */
    isOpen() {
        return this.state === CircuitState.OPEN;
    }
    /**
     * Check if circuit is half-open (testing)
     */
    isHalfOpen() {
        return this.state === CircuitState.HALF_OPEN;
    }
    /**
     * Add event listener
     */
    addListener(listener) {
        this.listeners.add(listener);
    }
    /**
     * Remove event listener
     */
    removeListener(listener) {
        this.listeners.delete(listener);
    }
    /**
     * Emit event
     */
    emit(event) {
        for (const listener of this.listeners) {
            try {
                listener(event);
            }
            catch (e) {
                console.error('Circuit breaker event listener error:', e);
            }
        }
    }
    /**
     * Reset circuit breaker to closed state
     */
    reset() {
        this.transitionTo(CircuitState.CLOSED);
    }
    /**
     * Get statistics
     */
    getStats() {
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
    constructor(message) {
        super(message);
        this.name = 'CircuitBreakerOpenError';
    }
}
/**
 * Retry handler with exponential backoff
 */
export class RetryHandler {
    config;
    retryState;
    constructor(config = {}) {
        this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
        this.retryState = new Map();
    }
    /**
     * Execute a function with retry logic
     */
    async execute(operationId, fn, shouldRetry) {
        let lastError;
        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
            try {
                this.updateRetryState(operationId, attempt);
                const result = await fn();
                this.clearRetryState(operationId);
                return result;
            }
            catch (error) {
                lastError = error;
                // Check if we should retry
                if (attempt < this.config.maxRetries && this.isRetryable(error, shouldRetry)) {
                    const delay = this.calculateDelay(attempt);
                    await this.sleep(delay);
                }
                else {
                    break;
                }
            }
        }
        throw lastError;
    }
    /**
     * Check if error is retryable
     */
    isRetryable(error, customChecker) {
        if (customChecker) {
            return customChecker(error);
        }
        const errorStr = String(error).toLowerCase();
        for (const retryable of this.config.retryableErrors || []) {
            switch (retryable) {
                case RetryableError.TIMEOUT:
                    if (errorStr.includes('timeout'))
                        return true;
                    break;
                case RetryableError.NETWORK_ERROR:
                    if (errorStr.includes('network') ||
                        errorStr.includes('econnrefused') ||
                        errorStr.includes('enotfound'))
                        return true;
                    break;
                case RetryableError.SERVICE_UNAVAILABLE:
                    if (errorStr.includes('503') || errorStr.includes('unavailable'))
                        return true;
                    break;
                case RetryableError.RATE_LIMIT:
                    if (errorStr.includes('429') || errorStr.includes('rate limit'))
                        return true;
                    break;
                case RetryableError.MCP_ERROR:
                    if (errorStr.includes('mcp'))
                        return true;
                    break;
            }
        }
        return false;
    }
    /**
     * Calculate delay with exponential backoff
     */
    calculateDelay(attempt) {
        const delay = this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, attempt);
        return Math.min(delay, this.config.maxDelayMs);
    }
    /**
     * Update retry state
     */
    updateRetryState(operationId, attempt) {
        const state = {
            attempts: attempt,
            lastAttempt: new Date(),
            totalDelayMs: 0,
        };
        this.retryState.set(operationId, state);
    }
    /**
     * Clear retry state
     */
    clearRetryState(operationId) {
        this.retryState.delete(operationId);
    }
    /**
     * Sleep for specified duration
     */
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * Get retry state for operation
     */
    getRetryState(operationId) {
        return this.retryState.get(operationId);
    }
    /**
     * Check if operation is being retried
     */
    isRetrying(operationId) {
        const state = this.retryState.get(operationId);
        return state !== undefined;
    }
    /**
     * Get retry count for operation
     */
    getRetryCount(operationId) {
        return this.retryState.get(operationId)?.attempts ?? 0;
    }
}
/**
 * Combined retry and circuit breaker wrapper
 */
export class ResilientExecutor {
    circuitBreaker;
    retryHandler;
    constructor(circuitConfig, retryConfig) {
        this.circuitBreaker = new CircuitBreaker(circuitConfig);
        this.retryHandler = new RetryHandler(retryConfig);
    }
    /**
     * Execute with circuit breaker and retry
     */
    async execute(operationId, fn, options) {
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
    getCircuitState() {
        return this.circuitBreaker.getState();
    }
    /**
     * Check if circuit is healthy
     */
    isHealthy() {
        return this.circuitBreaker.isClosed();
    }
    /**
     * Get circuit breaker stats
     */
    getCircuitStats() {
        return this.circuitBreaker.getStats();
    }
    /**
     * Add circuit event listener
     */
    addCircuitListener(listener) {
        this.circuitBreaker.addListener(listener);
    }
    /**
     * Reset circuit breaker
     */
    reset() {
        this.circuitBreaker.reset();
    }
}
/**
 * Create a resilient executor with defaults
 */
export function createResilientExecutor(circuitConfig, retryConfig) {
    return new ResilientExecutor(circuitConfig, retryConfig);
}
//# sourceMappingURL=retry.js.map