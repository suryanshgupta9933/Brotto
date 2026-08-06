/**
 * Server middleware for Brotto Browser Automation Platform
 *
 * Provides easy integration with Fastify and Express servers.
 * Automatically propagates trace context and adds standard headers.
 */

import { trace, context, Context, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { Tracer, Span } from '@opentelemetry/api';

/**
 * Middleware configuration options
 */
export interface MiddlewareOptions {
  tracer: Tracer;
  serviceName: string;
  ignorePaths?: string[];
  includeHeaders?: boolean;
}

/**
 * Request handler options for middleware
 */
export interface RequestHandlerOptions {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

/**
 * Response handler options
 */
export interface ResponseHandlerOptions {
  statusCode: number;
  headers?: Record<string, string>;
}

/**
 * Create a Fastify request hook that propagates trace context
 */
export function createFastifyRequestHook(options: MiddlewareOptions) {
  const { tracer, ignorePaths = [] } = options;

  return async function requestHook(
    request: { method: string; url: string; headers: Record<string, string> },
    reply: { header: (name: string, value: string) => void }
  ) {
    const { method, url, headers } = request;

    // Check if path should be ignored
    if (ignorePaths.some(path => url.startsWith(path))) {
      return;
    }

    // Extract trace context from headers
    const parentContext = extractTraceContext(headers);

    // Start a new span for the request
    const span = tracer.startSpan(
      `${method} ${url}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.method': method,
          'http.url': url,
          'http.target': url,
          'http.host': headers.host ?? 'unknown',
          'http.user_agent': headers['user-agent'] ?? 'unknown',
          'http.scheme': 'https',
        },
      },
      parentContext
    );

    // Add trace ID to response headers for correlation
    const spanContext = span.spanContext();
    reply.header('x-trace-id', spanContext.traceId);
    reply.header('x-span-id', spanContext.spanId);

    // Store span in request context for later use
    (request as Record<string, unknown>).span = span;
  };
}

/**
 * Create a Fastify response hook that records response metrics
 */
export function createFastifyResponseHook(options: MiddlewareOptions) {
  const { tracer: _tracer } = options;

  return async function responseHook(
    request: { method: string; url: string; span?: Span },
    reply: { statusCode: number; getHeader: (name: string) => string }
  ) {
    const span = (request as Record<string, unknown>).span as Span | undefined;

    if (span) {
      span.setAttribute('http.status_code', reply.statusCode);

      if (reply.statusCode >= 400) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `HTTP ${reply.statusCode}`,
        });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.end();
    }
  };
}

/**
 * Extract trace context from request headers
 */
export function extractTraceContext(headers: Record<string, string | string[] | undefined>): Context {
  // Try W3C trace context header first
  const traceparent = headers.traceparent as string | undefined;
  if (traceparent) {
    try {
      const [version, traceId, spanId, flags] = traceparent.split('-');
      if (version === '00' && traceId && spanId) {
        const { createContextWithRemoteParent } = require('@opentelemetry/api/build/src/api/context');
        if (createContextWithRemoteParent) {
          return createContextWithRemoteParent({
            traceId,
            spanId,
            traceFlags: parseInt(flags, 10) & 1,
            isRemote: true,
          });
        }
      }
    } catch {
      // Invalid traceparent header, continue
    }
  }

  // No valid trace context found, return default context
  return context.active();
}

/**
 * Create an Express middleware that propagates trace context
 */
export function createExpressMiddleware(options: MiddlewareOptions) {
  const { tracer, ignorePaths = [] } = options;

  return function expressMiddleware(
    req: { method: string; path: () => string; headers: Record<string, string>; span?: Span },
    res: { header: (name: string, value: string) => void; on: (event: string, cb: () => void) => void },
    next: () => void
  ): void {
    const method = req.method;
    const path = req.path();

    // Check if path should be ignored
    if (ignorePaths.some(p => path.startsWith(p))) {
      return next();
    }

    // Extract trace context from headers
    const parentContext = extractTraceContext(req.headers);

    // Start a new span for the request
    const span = tracer.startSpan(
      `${method} ${path}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.method': method,
          'http.url': path,
          'http.target': path,
          'http.host': req.headers.host ?? 'unknown',
          'http.user_agent': req.headers['user-agent'] ?? 'unknown',
        },
      },
      parentContext
    );

    // Add trace ID to response headers for correlation
    const spanContext = span.spanContext();
    res.header('x-trace-id', spanContext.traceId);
    res.header('x-span-id', spanContext.spanId);

    // Store span in request
    req.span = span;

    // End span when response finishes
    res.on('finish', () => {
      const statusCode = (res as unknown as { statusCode?: number }).statusCode;
      if (statusCode) {
        span.setAttribute('http.status_code', statusCode);

        if (statusCode >= 400) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `HTTP ${statusCode}`,
          });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
      }

      span.end();
    });

    next();
  };
}

/**
 * Create a wrapper for route handlers that automatically handles trace context
 */
export function withSpan<T extends (...args: unknown[]) => unknown>(
  tracer: Tracer,
  spanName: string,
  fn: T,
  attributes?: Record<string, string>
): T {
  return (async (...args: Parameters<T>) => {
    const span = tracer.startSpan(spanName, {
      kind: SpanKind.INTERNAL,
      attributes,
    });

    try {
      const ctx = trace.setSpan(context.active(), span);
      const result = await context.with(ctx, () => fn(...args));
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      span.end();
    }
  }) as T;
}

/**
 * Health check middleware that excludes from tracing
 */
export function createHealthCheckMiddleware() {
  return async function healthCheck(
    _req: unknown,
    res: { json: (data: { status: string; timestamp: string }) => void }
  ) {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    });
  };
}

/**
 * Readiness check middleware
 */
export function createReadinessMiddleware(isReady: () => boolean) {
  return async function readiness(
    _req: unknown,
    res: { json: (data: { status: string; ready: boolean }) => void }
  ) {
    res.json({
      status: isReady() ? 'ready' : 'not_ready',
      ready: isReady(),
    });
  };
}

/**
 * Middleware for adding session context to requests
 */
export function createSessionContextMiddleware(
  tracer: Tracer,
  extractSessionId: (request: RequestHandlerOptions) => string | undefined,
  extractTenantId: (request: RequestHandlerOptions) => string | undefined
) {
  return function sessionContextMiddleware(
    request: RequestHandlerOptions,
    next: () => void
  ): void {
    const sessionId = extractSessionId(request);
    const tenantId = extractTenantId(request);

    if (sessionId || tenantId) {
      const span = tracer.startSpan('session.context', {
        kind: SpanKind.INTERNAL,
      });

      if (sessionId) {
        span.setAttribute('fara.session_id', sessionId);
      }
      if (tenantId) {
        span.setAttribute('fara.tenant_id', tenantId);
      }

      (request as unknown as Record<string, unknown>).sessionSpan = span;
    }

    next();
  };
}

export type { Tracer, Span };
