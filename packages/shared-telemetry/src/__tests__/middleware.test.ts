/**
 * Tests for server middleware
 */

import { extractTraceContext, createHealthCheckMiddleware, createReadinessMiddleware } from '../middleware';

describe('middleware', () => {
  describe('extractTraceContext', () => {
    it('should return empty context for empty headers', () => {
      const context = extractTraceContext({});
      expect(context).toBeDefined();
    });

    it('should return empty context for undefined headers', () => {
      const context = extractTraceContext({
        host: undefined,
      } as Record<string, string | string[] | undefined>);
      expect(context).toBeDefined();
    });

    it('should handle invalid traceparent header gracefully', () => {
      const context = extractTraceContext({
        traceparent: 'invalid-header',
      });
      expect(context).toBeDefined();
    });

    it('should handle missing B3 fields gracefully', () => {
      const context = extractTraceContext({
        b3: 'abc123def456789012345678901234ab',
      });
      expect(context).toBeDefined();
    });
  });

  describe('createHealthCheckMiddleware', () => {
    it('should return a function', () => {
      const middleware = createHealthCheckMiddleware();
      expect(typeof middleware).toBe('function');
    });

    it('should call the response handler with healthy status', () => {
      const middleware = createHealthCheckMiddleware();
      interface CapturedData { status: string; timestamp: string }
      let capturedData: CapturedData | null = null;
      const mockRes = {
        json: (data: CapturedData) => {
          capturedData = data;
        },
      };

      middleware({}, mockRes);

      expect(capturedData).not.toBeNull();
      expect(capturedData!.status).toBe('healthy');
      expect(capturedData!.timestamp).toBeDefined();
    });

    it('should include ISO timestamp', () => {
      const middleware = createHealthCheckMiddleware();
      interface CapturedData { status: string; timestamp: string }
      let capturedData: CapturedData | null = null;
      const mockRes = {
        json: (data: CapturedData) => {
          capturedData = data;
        },
      };

      middleware({}, mockRes);

      expect(capturedData!.timestamp).toBeDefined();
      expect(new Date(capturedData!.timestamp).toISOString()).toBe(capturedData!.timestamp);
    });
  });

  describe('createReadinessMiddleware', () => {
    it('should return a function', () => {
      const middleware = createReadinessMiddleware(() => true);
      expect(typeof middleware).toBe('function');
    });

    it('should report ready when isReady returns true', () => {
      const isReady = () => true;
      const middleware = createReadinessMiddleware(isReady);
      interface CapturedData { status: string; ready: boolean }
      let capturedData: CapturedData | null = null;
      const mockRes = {
        json: (data: CapturedData) => {
          capturedData = data;
        },
      };

      middleware({}, mockRes);

      expect(capturedData).not.toBeNull();
      expect(capturedData!.status).toBe('ready');
      expect(capturedData!.ready).toBe(true);
    });

    it('should report not ready when isReady returns false', () => {
      const isReady = () => false;
      const middleware = createReadinessMiddleware(isReady);
      interface CapturedData { status: string; ready: boolean }
      let capturedData: CapturedData | null = null;
      const mockRes = {
        json: (data: CapturedData) => {
          capturedData = data;
        },
      };

      middleware({}, mockRes);

      expect(capturedData).not.toBeNull();
      expect(capturedData!.status).toBe('not_ready');
      expect(capturedData!.ready).toBe(false);
    });
  });
});
