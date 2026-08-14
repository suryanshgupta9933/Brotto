/**
 * Server middleware for Brotto Browser Automation Platform
 *
 * Provides easy integration with Fastify and Express servers.
 * Automatically propagates trace context and adds standard headers.
 */
import { trace, context, SpanKind, SpanStatusCode } from '@opentelemetry/api';
/**
 * Create a Fastify request hook that propagates trace context
 */
export function createFastifyRequestHook(options) {
    const { tracer, ignorePaths = [] } = options;
    return async function requestHook(request, reply) {
        const { method, url, headers } = request;
        // Check if path should be ignored
        if (ignorePaths.some(path => url.startsWith(path))) {
            return;
        }
        // Extract trace context from headers
        const parentContext = extractTraceContext(headers);
        // Start a new span for the request
        const span = tracer.startSpan(`${method} ${url}`, {
            kind: SpanKind.SERVER,
            attributes: {
                'http.method': method,
                'http.url': url,
                'http.target': url,
                'http.host': headers.host ?? 'unknown',
                'http.user_agent': headers['user-agent'] ?? 'unknown',
                'http.scheme': 'https',
            },
        }, parentContext);
        // Add trace ID to response headers for correlation
        const spanContext = span.spanContext();
        reply.header('x-trace-id', spanContext.traceId);
        reply.header('x-span-id', spanContext.spanId);
        // Store span in request context for later use
        request.span = span;
    };
}
/**
 * Create a Fastify response hook that records response metrics
 */
export function createFastifyResponseHook(options) {
    const { tracer: _tracer } = options;
    return async function responseHook(request, reply) {
        const span = request.span;
        if (span) {
            span.setAttribute('http.status_code', reply.statusCode);
            if (reply.statusCode >= 400) {
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: `HTTP ${reply.statusCode}`,
                });
            }
            else {
                span.setStatus({ code: SpanStatusCode.OK });
            }
            span.end();
        }
    };
}
/**
 * Extract trace context from request headers
 */
export function extractTraceContext(headers) {
    // Try W3C trace context header first
    const traceparent = headers.traceparent;
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
        }
        catch {
            // Invalid traceparent header, continue
        }
    }
    // No valid trace context found, return default context
    return context.active();
}
/**
 * Create an Express middleware that propagates trace context
 */
export function createExpressMiddleware(options) {
    const { tracer, ignorePaths = [] } = options;
    return function expressMiddleware(req, res, next) {
        const method = req.method;
        const path = req.path();
        // Check if path should be ignored
        if (ignorePaths.some(p => path.startsWith(p))) {
            return next();
        }
        // Extract trace context from headers
        const parentContext = extractTraceContext(req.headers);
        // Start a new span for the request
        const span = tracer.startSpan(`${method} ${path}`, {
            kind: SpanKind.SERVER,
            attributes: {
                'http.method': method,
                'http.url': path,
                'http.target': path,
                'http.host': req.headers.host ?? 'unknown',
                'http.user_agent': req.headers['user-agent'] ?? 'unknown',
            },
        }, parentContext);
        // Add trace ID to response headers for correlation
        const spanContext = span.spanContext();
        res.header('x-trace-id', spanContext.traceId);
        res.header('x-span-id', spanContext.spanId);
        // Store span in request
        req.span = span;
        // End span when response finishes
        res.on('finish', () => {
            const statusCode = res.statusCode;
            if (statusCode) {
                span.setAttribute('http.status_code', statusCode);
                if (statusCode >= 400) {
                    span.setStatus({
                        code: SpanStatusCode.ERROR,
                        message: `HTTP ${statusCode}`,
                    });
                }
                else {
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
export function withSpan(tracer, spanName, fn, attributes) {
    return (async (...args) => {
        const span = tracer.startSpan(spanName, {
            kind: SpanKind.INTERNAL,
            attributes,
        });
        try {
            const ctx = trace.setSpan(context.active(), span);
            const result = await context.with(ctx, () => fn(...args));
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        }
        catch (error) {
            span.recordException(error);
            span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error.message,
            });
            throw error;
        }
        finally {
            span.end();
        }
    });
}
/**
 * Health check middleware that excludes from tracing
 */
export function createHealthCheckMiddleware() {
    return async function healthCheck(_req, res) {
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
        });
    };
}
/**
 * Readiness check middleware
 */
export function createReadinessMiddleware(isReady) {
    return async function readiness(_req, res) {
        res.json({
            status: isReady() ? 'ready' : 'not_ready',
            ready: isReady(),
        });
    };
}
/**
 * Middleware for adding session context to requests
 */
export function createSessionContextMiddleware(tracer, extractSessionId, extractTenantId) {
    return function sessionContextMiddleware(request, next) {
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
            request.sessionSpan = span;
        }
        next();
    };
}
//# sourceMappingURL=middleware.js.map