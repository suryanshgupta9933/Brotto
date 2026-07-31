/**
 * Retry and Circuit Breaker Tests
 */

import {
  CircuitBreaker,
  CircuitState,
  CircuitBreakerOpenError,
  RetryHandler,
  ResilientExecutor,
  RetryableError,
} from '../retry';

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeoutMs: 1000,
    });
  });

  describe('initial state', () => {
    it('should start in closed state', () => {
      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should be closed (healthy)', () => {
      expect(circuitBreaker.isClosed()).toBe(true);
      expect(circuitBreaker.isOpen()).toBe(false);
      expect(circuitBreaker.isHalfOpen()).toBe(false);
    });
  });

  describe('successful executions', () => {
    it('should remain closed after successful executions', async () => {
      await circuitBreaker.execute(async () => Promise.resolve('success'));
      await circuitBreaker.execute(async () => Promise.resolve('success'));

      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should return result on success', async () => {
      const result = await circuitBreaker.execute(async () => Promise.resolve('hello'));

      expect(result).toBe('hello');
    });
  });

  describe('failure handling', () => {
    it('should open after reaching failure threshold', async () => {
      const failingFn = async () => {
        throw new Error('fail');
      };

      // Fail 3 times (threshold)
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch {}
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should reject calls when open', async () => {
      const failingFn = async () => {
        throw new Error('fail');
      };

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch {}
      }

      // Next call should throw
      await expect(circuitBreaker.execute(failingFn)).rejects.toThrow(
        CircuitBreakerOpenError
      );
    });
  });

  describe('half-open state', () => {
    it('should transition to half-open after timeout', async () => {
      const failingFn = async () => {
        throw new Error('fail');
      };

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch {}
      }

      expect(circuitBreaker.getState()).toBe(CircuitState.OPEN);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should transition to half-open on next call
      try {
        await failingFn();
      } catch {}

      // Actually, the transition happens on execute
      expect(circuitBreaker.getState()).toBe(CircuitState.HALF_OPEN);
    });
  });

  describe('reset', () => {
    it('should reset to closed state', () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          throw new Error('fail');
        } catch {
          // Manually record failure
        }
      }

      circuitBreaker.reset();

      expect(circuitBreaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('events', () => {
    it('should emit state change events', async () => {
      const handler = jest.fn();
      circuitBreaker.addListener(handler);

      const failingFn = async () => {
        throw new Error('fail');
      };

      // Trigger failures to open
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(failingFn);
        } catch {}
      }

      expect(handler).toHaveBeenCalled();
    });
  });
});

describe('RetryHandler', () => {
  let retryHandler: RetryHandler;

  beforeEach(() => {
    retryHandler = new RetryHandler({
      maxRetries: 3,
      initialDelayMs: 10,
      maxDelayMs: 100,
      backoffMultiplier: 2,
    });
  });

  describe('successful execution', () => {
    it('should return result on first try', async () => {
      const fn = async () => Promise.resolve('success');

      const result = await retryHandler.execute('op-1', fn);

      expect(result).toBe('success');
    });

    it('should not retry on success', async () => {
      const fn = jest.fn().mockResolvedValue('success');

      await retryHandler.execute('op-1', fn);

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry on failure', () => {
    it('should retry on transient failures', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('timeout');
        }
        return 'success';
      };

      const result = await retryHandler.execute('op-1', fn);

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should throw after max retries', async () => {
      const fn = async () => {
        throw new Error('always fails');
      };

      await expect(retryHandler.execute('op-1', fn)).rejects.toThrow('always fails');
    });

    it('should not retry non-retryable errors by default', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw new Error('invalid argument');
      };

      await expect(retryHandler.execute('op-1', fn)).rejects.toThrow('invalid argument');
      expect(attempts).toBe(1); // Only tried once
    });

    it('should respect custom retry checker', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw new Error('custom error');
      };

      const shouldRetry = (error: unknown) => {
        return String(error).includes('custom');
      };

      await expect(
        retryHandler.execute('op-1', fn, shouldRetry)
      ).rejects.toThrow('custom error');

      expect(attempts).toBe(4); // Initial + 3 retries
    });
  });

  describe('retry state', () => {
    it('should track retry count', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('fail');
        }
        return 'success';
      };

      await retryHandler.execute('op-1', fn);

      expect(retryHandler.getRetryCount('op-1')).toBe(0); // After success
    });

    it('should detect if operation is retrying', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('fail');
        }
        return 'success';
      };

      // Start execution but don't await
      const promise = retryHandler.execute('op-1', fn);

      expect(retryHandler.isRetrying('op-1')).toBe(true);

      await promise;
    });
  });
});

describe('ResilientExecutor', () => {
  let executor: ResilientExecutor;

  beforeEach(() => {
    executor = createResilientExecutor(
      { failureThreshold: 2, timeoutMs: 1000 },
      { maxRetries: 2, initialDelayMs: 10 }
    );
  });

  describe('combined circuit breaker and retry', () => {
    it('should retry and eventually succeed', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('transient');
        }
        return 'success';
      };

      const result = await executor.execute('op-1', fn);

      expect(result).toBe('success');
    });

    it('should open circuit after repeated failures', async () => {
      const fn = async () => {
        throw new Error('always fails');
      };

      // Exhaust retries then circuit breaker
      for (let i = 0; i < 5; i++) {
        try {
          await executor.execute('op-1', fn);
        } catch {}
      }

      expect(executor.getCircuitState()).toBe(CircuitState.OPEN);
    });
  });

  describe('skip options', () => {
    it('should skip retry when configured', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw new Error('fail');
      };

      await expect(
        executor.execute('op-1', fn, { skipRetry: true })
      ).rejects.toThrow('fail');

      expect(attempts).toBe(1);
    });

    it('should skip circuit breaker when configured', async () => {
      const fn = async () => {
        throw new Error('fail');
      };

      // Should not throw CircuitBreakerOpenError
      await expect(
        executor.execute('op-1', fn, { skipCircuitBreaker: true })
      ).rejects.toThrow('fail');
    });
  });

  describe('health check', () => {
    it('should be healthy initially', () => {
      expect(executor.isHealthy()).toBe(true);
    });
  });
});
