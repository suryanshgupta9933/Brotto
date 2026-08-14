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
export { initTelemetry, createNoOpTelemetry, createBasicTelemetry, DEFAULT_EXPORTERS, TelemetryInstance, ServiceContext, } from './telemetry.js';
export { SessionState, ActionType, PolicyResult, FARA_SPAN_ATTRIBUTES, AuditRecord, SessionSpanData, ActionSpanData, ApprovalSpanData, createFaraTracer, getCurrentSpan, isTracing, SPAN_KINDS, SPAN_STATUS, } from './traces.js';
export { METRIC_NAMES, METRIC_LABELS, UNITS, HISTOGRAM_BUCKETS, TEMPORALITY, createFaraMeter, ObservableGaugeCallbacks, } from './metrics.js';
export { LogLevel, LogEntry, CorrelationIds, getCorrelationIds, formatTraceId, formatSpanId, createLogEntry, logWithCorrelation, logger, createLogger, logError, SensitiveAgentTrace, AgentActionRecord, ScreenshotRecord, ApprovalRecord, logSensitiveAgentTrace, } from './logs.js';
export { ExporterType, ExporterConfig, OtlpConfig, PrometheusConfig, ConsoleConfig, JaegerConfig, NoneConfig, TelemetryConfig, createOtlpTraceExporter, createOtlpMetricExporter, createPrometheusExporter, getSpanProcessor, getMetricReader, createResource, getInstrumentations, validateExporterConfig, getDefaultConfig, } from './export.js';
export { MiddlewareOptions, RequestHandlerOptions, ResponseHandlerOptions, createFastifyRequestHook, createFastifyResponseHook, createExpressMiddleware, extractTraceContext, withSpan, createHealthCheckMiddleware, createReadinessMiddleware, createSessionContextMiddleware, } from './middleware.js';
//# sourceMappingURL=index.d.ts.map