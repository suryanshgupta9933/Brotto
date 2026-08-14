/**
 * Shared Telemetry Package for Brotto Browser Automation Platform
 *
 * Provides consistent observability across all services with OpenTelemetry integration.
 *
 * @example
 * ```typescript
 * import {
 *   createTelemetry,
 *   trace,
 *   metrics,
 *   logger
 * } from '@brotto/shared-telemetry';
 *
 * const { tracer, meter, shutdown } = await createTelemetry({
 *   serviceName: 'agent-orchestrator',
 *   traceExporter: { type: 'otlp', endpoint: 'http://otel:4318' },
 *   metricExporter: { type: 'prometheus', port: 9464 },
 * });
 * ```
 */
// Main telemetry setup
export { initTelemetry, createNoOpTelemetry, createBasicTelemetry, DEFAULT_EXPORTERS, } from './telemetry.js';
// Trace and span types
export { SessionState, ActionType, PolicyResult, FARA_SPAN_ATTRIBUTES, createFaraTracer, getCurrentSpan, isTracing, SPAN_KINDS, SPAN_STATUS, } from './traces.js';
// Metrics definitions
export { METRIC_NAMES, METRIC_LABELS, UNITS, HISTOGRAM_BUCKETS, TEMPORALITY, createFaraMeter, } from './metrics.js';
// Log correlation
export { LogLevel, getCorrelationIds, formatTraceId, formatSpanId, createLogEntry, logWithCorrelation, logger, createLogger, logError, logSensitiveAgentTrace, } from './logs.js';
// Export configurations
export { createOtlpTraceExporter, createOtlpMetricExporter, createPrometheusExporter, getSpanProcessor, getMetricReader, createResource, getInstrumentations, validateExporterConfig, getDefaultConfig, } from './export.js';
// Server middleware
export { createFastifyRequestHook, createFastifyResponseHook, createExpressMiddleware, extractTraceContext, withSpan, createHealthCheckMiddleware, createReadinessMiddleware, createSessionContextMiddleware, } from './middleware.js';
//# sourceMappingURL=index.js.map