/**
 * Tests for log correlation
 */

import {
  LogLevel,
  getCorrelationIds,
  formatTraceId,
  formatSpanId,
  createLogEntry,
  logWithCorrelation,
  logger,
  createLogger,
  logError,
  logSensitiveAgentTrace,
} from '../logs';

describe('logs', () => {
  describe('LogLevel', () => {
    it('should have all expected log levels', () => {
      expect(LogLevel.DEBUG).toBe('debug');
      expect(LogLevel.INFO).toBe('info');
      expect(LogLevel.WARN).toBe('warn');
      expect(LogLevel.ERROR).toBe('error');
      expect(LogLevel.CRITICAL).toBe('critical');
    });
  });

  describe('getCorrelationIds', () => {
    it('should return empty IDs when no span is active', () => {
      const ids = getCorrelationIds();
      expect(ids.traceId).toBeUndefined();
      expect(ids.spanId).toBeUndefined();
      expect(ids.sessionId).toBeUndefined();
      expect(ids.tenantId).toBeUndefined();
    });
  });

  describe('formatTraceId', () => {
    it('should return placeholder for undefined trace ID', () => {
      const formatted = formatTraceId(undefined);
      expect(formatted).toBe('00000000000000000000000000000000');
    });

    it('should return trace ID without dashes', () => {
      const formatted = formatTraceId('abc123def456789012345678901234ab');
      expect(formatted).toBe('abc123def456789012345678901234ab');
    });

    it('should handle trace ID with dashes', () => {
      const formatted = formatTraceId('abc123de-f456-7890-1234-5678901234ab');
      expect(formatted).toBe('abc123def456789012345678901234ab');
    });
  });

  describe('formatSpanId', () => {
    it('should return placeholder for undefined span ID', () => {
      const formatted = formatSpanId(undefined);
      expect(formatted).toBe('0000000000000000');
    });

    it('should return span ID without dashes', () => {
      const formatted = formatSpanId('abc1234567890ab');
      expect(formatted).toBe('abc1234567890ab');
    });

    it('should handle span ID with dashes', () => {
      const formatted = formatSpanId('abc12345-67890ab');
      expect(formatted).toBe('abc1234567890ab');
    });
  });

  describe('createLogEntry', () => {
    it('should create a log entry with required fields', () => {
      const entry = createLogEntry(LogLevel.INFO, 'Test message');

      expect(entry.timestamp).toBeDefined();
      expect(entry.level).toBe(LogLevel.INFO);
      expect(entry.message).toBe('Test message');
    });

    it('should include correlation IDs when available', () => {
      const entry = createLogEntry(LogLevel.INFO, 'Test message');

      // When no span is active, IDs should be undefined
      expect(entry.trace_id).toBeUndefined();
      expect(entry.span_id).toBeUndefined();
    });

    it('should include additional fields', () => {
      const entry = createLogEntry(LogLevel.INFO, 'Test message', {
        customField: 'value',
        numberField: 42,
      });

      expect(entry.customField).toBe('value');
      expect(entry.numberField).toBe(42);
    });
  });

  describe('logWithCorrelation', () => {
    it('should not throw when logging', () => {
      expect(() => {
        logWithCorrelation(LogLevel.INFO, 'Test log message');
      }).not.toThrow();
    });

    it('should not throw when logging with additional fields', () => {
      expect(() => {
        logWithCorrelation(LogLevel.INFO, 'Test log message', { field: 'value' });
      }).not.toThrow();
    });
  });

  describe('logger', () => {
    it('should have debug method', () => {
      expect(typeof logger.debug).toBe('function');
      expect(() => logger.debug('Debug message')).not.toThrow();
    });

    it('should have info method', () => {
      expect(typeof logger.info).toBe('function');
      expect(() => logger.info('Info message')).not.toThrow();
    });

    it('should have warn method', () => {
      expect(typeof logger.warn).toBe('function');
      expect(() => logger.warn('Warning message')).not.toThrow();
    });

    it('should have error method', () => {
      expect(typeof logger.error).toBe('function');
      expect(() => logger.error('Error message')).not.toThrow();
    });

    it('should have critical method', () => {
      expect(typeof logger.critical).toBe('function');
      expect(() => logger.critical('Critical message')).not.toThrow();
    });
  });

  describe('createLogger', () => {
    it('should create a logger with default fields', () => {
      const customLogger = createLogger({ service: 'test-service', environment: 'test' });

      expect(typeof customLogger.debug).toBe('function');
      expect(typeof customLogger.info).toBe('function');
      expect(typeof customLogger.warn).toBe('function');
      expect(typeof customLogger.error).toBe('function');
      expect(typeof customLogger.critical).toBe('function');
    });

    it('should include default fields in log entries', () => {
      const customLogger = createLogger({ service: 'test-service' });

      // Should not throw
      expect(() => customLogger.info('Test message', { extra: 'field' })).not.toThrow();
    });
  });

  describe('logError', () => {
    it('should handle standard Error objects', () => {
      const error = new Error('Test error');

      expect(() => logError(error, 'An error occurred')).not.toThrow();
    });

    it('should handle errors with additional context', () => {
      const error = new Error('Test error');

      expect(() => {
        logError(error, 'An error occurred', { sessionId: 'test-session' });
      }).not.toThrow();
    });

    it('should handle errors without stack trace', () => {
      const error = new Error('Test error');
      error.stack = undefined;

      expect(() => logError(error, 'An error occurred')).not.toThrow();
    });
  });

  describe('logSensitiveAgentTrace', () => {
    it('should be importable', () => {
      expect(typeof logSensitiveAgentTrace).toBe('function');
    });

    it('should not throw when logging sensitive trace', () => {
      expect(() => {
        logSensitiveAgentTrace({
          sessionId: 'test-session',
          tenantId: 'test-tenant',
          sessionCreator: 'test-creator',
          deviceId: 'test-device',
          modelVersion: '1.0.0',
          promptTemplateVersion: '1.0.0',
          actionSequence: [],
          screenshots: [],
          approvals: [],
        });
      }).not.toThrow();
    });
  });
});
