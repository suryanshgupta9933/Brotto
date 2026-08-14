/**
 * Log correlation for Brotto Browser Automation Platform
 *
 * Provides trace_id and span_id injection for correlated logging.
 * Per ARCHITECTURE.md section 8.9, keep normal application logs separate
 * from sensitive agent traces.
 */
import { context, trace } from '@opentelemetry/api';
/**
 * Log severity levels
 */
export var LogLevel;
(function (LogLevel) {
    LogLevel["DEBUG"] = "debug";
    LogLevel["INFO"] = "info";
    LogLevel["WARN"] = "warn";
    LogLevel["ERROR"] = "error";
    LogLevel["CRITICAL"] = "critical";
})(LogLevel || (LogLevel = {}));
/**
 * Get current trace context correlation IDs
 */
export function getCorrelationIds() {
    const span = trace.getSpan(context.active());
    const spanContext = span?.spanContext();
    // Note: span attributes are set via setAttributes(), we cannot read them back directly
    // Use the spanContext to get trace/span IDs
    return {
        traceId: spanContext?.traceId,
        spanId: spanContext?.spanId,
        sessionId: undefined,
        tenantId: undefined,
    };
}
/**
 * Format a trace ID for logging (16 bytes hex -> 32 hex chars)
 */
export function formatTraceId(traceId) {
    if (!traceId)
        return '00000000000000000000000000000000';
    // Trace ID is 32 hex characters (16 bytes)
    return traceId.replace(/-/g, '');
}
/**
 * Format a span ID for logging (8 bytes hex -> 16 hex chars)
 */
export function formatSpanId(spanId) {
    if (!spanId)
        return '0000000000000000';
    return spanId.replace(/-/g, '');
}
/**
 * Create a structured log entry with correlation IDs
 */
export function createLogEntry(level, message, additionalFields) {
    const ids = getCorrelationIds();
    return {
        timestamp: new Date().toISOString(),
        level,
        message,
        trace_id: ids.traceId,
        span_id: ids.spanId,
        session_id: ids.sessionId,
        tenant_id: ids.tenantId,
        ...additionalFields,
    };
}
/**
 * Log a message with correlation IDs to console
 * In production, this should integrate with your logging framework
 */
export function logWithCorrelation(level, message, fields) {
    const entry = createLogEntry(level, message, fields);
    const logLine = JSON.stringify(entry);
    switch (level) {
        case LogLevel.DEBUG:
        case LogLevel.INFO:
            console.info(logLine);
            break;
        case LogLevel.WARN:
            console.warn(logLine);
            break;
        case LogLevel.ERROR:
        case LogLevel.CRITICAL:
            console.error(logLine);
            break;
    }
}
/**
 * Convenience methods for different log levels
 */
export const logger = {
    debug: (message, fields) => logWithCorrelation(LogLevel.DEBUG, message, fields),
    info: (message, fields) => logWithCorrelation(LogLevel.INFO, message, fields),
    warn: (message, fields) => logWithCorrelation(LogLevel.WARN, message, fields),
    error: (message, fields) => logWithCorrelation(LogLevel.ERROR, message, fields),
    critical: (message, fields) => logWithCorrelation(LogLevel.CRITICAL, message, fields),
};
/**
 * Create a child logger with pre-set fields
 */
export function createLogger(defaultFields) {
    return {
        debug: (message, fields) => logWithCorrelation(LogLevel.DEBUG, message, { ...defaultFields, ...fields }),
        info: (message, fields) => logWithCorrelation(LogLevel.INFO, message, { ...defaultFields, ...fields }),
        warn: (message, fields) => logWithCorrelation(LogLevel.WARN, message, { ...defaultFields, ...fields }),
        error: (message, fields) => logWithCorrelation(LogLevel.ERROR, message, { ...defaultFields, ...fields }),
        critical: (message, fields) => logWithCorrelation(LogLevel.CRITICAL, message, { ...defaultFields, ...fields }),
    };
}
/**
 * Error logging helper that captures error details
 */
export function logError(error, message, additionalContext) {
    const span = trace.getSpan(context.active());
    const fields = {
        error_type: error.name || 'Error',
        error_message: error.message,
        error_stack: error.stack,
        ...additionalContext,
    };
    logWithCorrelation(LogLevel.ERROR, message, fields);
}
/**
 * Log sensitive agent trace data
 * This should be sent to a secure, access-controlled log sink
 */
export function logSensitiveAgentTrace(trace) {
    // In production, this would send to a secure audit log service
    // For now, we use a separate log namespace
    const entry = {
        type: 'sensitive_agent_trace',
        timestamp: new Date().toISOString(),
        trace_id: trace.sessionId, // Use session ID as trace identifier for sensitive logs
        data: trace,
    };
    console.error(JSON.stringify(entry));
}
//# sourceMappingURL=logs.js.map