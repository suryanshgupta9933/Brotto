/**
 * Server middleware for Brotto Browser Automation Platform
 *
 * Provides easy integration with Fastify and Express servers.
 * Automatically propagates trace context and adds standard headers.
 */
import { Context } from '@opentelemetry/api';
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
export declare function createFastifyRequestHook(options: MiddlewareOptions): (request: {
    method: string;
    url: string;
    headers: Record<string, string>;
}, reply: {
    header: (name: string, value: string) => void;
}) => Promise<void>;
/**
 * Create a Fastify response hook that records response metrics
 */
export declare function createFastifyResponseHook(options: MiddlewareOptions): (request: {
    method: string;
    url: string;
    span?: Span;
}, reply: {
    statusCode: number;
    getHeader: (name: string) => string;
}) => Promise<void>;
/**
 * Extract trace context from request headers
 */
export declare function extractTraceContext(headers: Record<string, string | string[] | undefined>): Context;
/**
 * Create an Express middleware that propagates trace context
 */
export declare function createExpressMiddleware(options: MiddlewareOptions): (req: {
    method: string;
    path: () => string;
    headers: Record<string, string>;
    span?: Span;
}, res: {
    header: (name: string, value: string) => void;
    on: (event: string, cb: () => void) => void;
}, next: () => void) => void;
/**
 * Create a wrapper for route handlers that automatically handles trace context
 */
export declare function withSpan<T extends (...args: unknown[]) => unknown>(tracer: Tracer, spanName: string, fn: T, attributes?: Record<string, string>): T;
/**
 * Health check middleware that excludes from tracing
 */
export declare function createHealthCheckMiddleware(): (_req: unknown, res: {
    json: (data: {
        status: string;
        timestamp: string;
    }) => void;
}) => Promise<void>;
/**
 * Readiness check middleware
 */
export declare function createReadinessMiddleware(isReady: () => boolean): (_req: unknown, res: {
    json: (data: {
        status: string;
        ready: boolean;
    }) => void;
}) => Promise<void>;
/**
 * Middleware for adding session context to requests
 */
export declare function createSessionContextMiddleware(tracer: Tracer, extractSessionId: (request: RequestHandlerOptions) => string | undefined, extractTenantId: (request: RequestHandlerOptions) => string | undefined): (request: RequestHandlerOptions, next: () => void) => void;
export type { Tracer, Span };
//# sourceMappingURL=middleware.d.ts.map