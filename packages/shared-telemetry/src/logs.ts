/**
 * Log correlation for Brotto Browser Automation Platform
 *
 * Provides trace_id and span_id injection for correlated logging.
 * Per ARCHITECTURE.md section 8.9, keep normal application logs separate
 * from sensitive agent traces.
 */

import { context, trace, SpanStatusCode } from '@opentelemetry/api';

/**
 * Log severity levels
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  CRITICAL = 'critical',
}

/**
 * Structured log entry fields
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  trace_id?: string;
  span_id?: string;
  service_name?: string;
  session_id?: string;
  tenant_id?: string;
  action_type?: string;
  error_type?: string;
  error_message?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

/**
 * Correlation IDs extracted from current trace context
 */
export interface CorrelationIds {
  traceId: string | undefined;
  spanId: string | undefined;
  sessionId: string | undefined;
  tenantId: string | undefined;
}

/**
 * Get current trace context correlation IDs
 */
export function getCorrelationIds(): CorrelationIds {
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
export function formatTraceId(traceId: string | undefined): string {
  if (!traceId) return '00000000000000000000000000000000';
  // Trace ID is 32 hex characters (16 bytes)
  return traceId.replace(/-/g, '');
}

/**
 * Format a span ID for logging (8 bytes hex -> 16 hex chars)
 */
export function formatSpanId(spanId: string | undefined): string {
  if (!spanId) return '0000000000000000';
  return spanId.replace(/-/g, '');
}

/**
 * Create a structured log entry with correlation IDs
 */
export function createLogEntry(
  level: LogLevel,
  message: string,
  additionalFields?: Record<string, unknown>
): LogEntry {
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
export function logWithCorrelation(
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>
): void {
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
  debug: (message: string, fields?: Record<string, unknown>) =>
    logWithCorrelation(LogLevel.DEBUG, message, fields),

  info: (message: string, fields?: Record<string, unknown>) =>
    logWithCorrelation(LogLevel.INFO, message, fields),

  warn: (message: string, fields?: Record<string, unknown>) =>
    logWithCorrelation(LogLevel.WARN, message, fields),

  error: (message: string, fields?: Record<string, unknown>) =>
    logWithCorrelation(LogLevel.ERROR, message, fields),

  critical: (message: string, fields?: Record<string, unknown>) =>
    logWithCorrelation(LogLevel.CRITICAL, message, fields),
};

/**
 * Create a child logger with pre-set fields
 */
export function createLogger(defaultFields: Record<string, unknown>) {
  return {
    debug: (message: string, fields?: Record<string, unknown>) =>
      logWithCorrelation(LogLevel.DEBUG, message, { ...defaultFields, ...fields }),

    info: (message: string, fields?: Record<string, unknown>) =>
      logWithCorrelation(LogLevel.INFO, message, { ...defaultFields, ...fields }),

    warn: (message: string, fields?: Record<string, unknown>) =>
      logWithCorrelation(LogLevel.WARN, message, { ...defaultFields, ...fields }),

    error: (message: string, fields?: Record<string, unknown>) =>
      logWithCorrelation(LogLevel.ERROR, message, { ...defaultFields, ...fields }),

    critical: (message: string, fields?: Record<string, unknown>) =>
      logWithCorrelation(LogLevel.CRITICAL, message, { ...defaultFields, ...fields }),
  };
}

/**
 * Error logging helper that captures error details
 */
export function logError(
  error: Error,
  message: string,
  additionalContext?: Record<string, unknown>
): void {
  const span = trace.getSpan(context.active());

  const fields: Record<string, unknown> = {
    error_type: error.name || 'Error',
    error_message: error.message,
    error_stack: error.stack,
    ...additionalContext,
  };

  logWithCorrelation(LogLevel.ERROR, message, fields);
}

/**
 * Log sensitive agent trace data separately
 * Per ARCHITECTURE.md section 8.9 - keep sensitive agent traces separate
 * from normal application logs
 */
export interface SensitiveAgentTrace {
  sessionId: string;
  tenantId: string;
  sessionCreator: string;
  deviceId: string;
  modelVersion: string;
  promptTemplateVersion: string;
  actionSequence: AgentActionRecord[];
  screenshots: ScreenshotRecord[];
  approvals: ApprovalRecord[];
}

export interface AgentActionRecord {
  timestamp: string;
  actionType: string;
  proposedAction: string;
  executedAction?: string;
  observationId: string;
  screenshotHash?: string;
  policyResult: string;
  approvalDecision?: string;
  result?: string;
  error?: string;
}

export interface ScreenshotRecord {
  timestamp: string;
  observationId: string;
  hash: string;
  width: number;
  height: number;
  domain: string;
  url: string;
}

export interface ApprovalRecord {
  timestamp: string;
  actionType: string;
  proposedAction: string;
  screenshotHash: string;
  decision: 'approved' | 'denied' | 'stop_session';
  decidedAt: string;
}

/**
 * Log sensitive agent trace data
 * This should be sent to a secure, access-controlled log sink
 */
export function logSensitiveAgentTrace(trace: SensitiveAgentTrace): void {
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
