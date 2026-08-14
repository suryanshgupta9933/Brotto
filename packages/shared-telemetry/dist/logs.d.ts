/**
 * Log correlation for Brotto Browser Automation Platform
 *
 * Provides trace_id and span_id injection for correlated logging.
 * Per ARCHITECTURE.md section 8.9, keep normal application logs separate
 * from sensitive agent traces.
 */
/**
 * Log severity levels
 */
export declare enum LogLevel {
    DEBUG = "debug",
    INFO = "info",
    WARN = "warn",
    ERROR = "error",
    CRITICAL = "critical"
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
export declare function getCorrelationIds(): CorrelationIds;
/**
 * Format a trace ID for logging (16 bytes hex -> 32 hex chars)
 */
export declare function formatTraceId(traceId: string | undefined): string;
/**
 * Format a span ID for logging (8 bytes hex -> 16 hex chars)
 */
export declare function formatSpanId(spanId: string | undefined): string;
/**
 * Create a structured log entry with correlation IDs
 */
export declare function createLogEntry(level: LogLevel, message: string, additionalFields?: Record<string, unknown>): LogEntry;
/**
 * Log a message with correlation IDs to console
 * In production, this should integrate with your logging framework
 */
export declare function logWithCorrelation(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
/**
 * Convenience methods for different log levels
 */
export declare const logger: {
    debug: (message: string, fields?: Record<string, unknown>) => void;
    info: (message: string, fields?: Record<string, unknown>) => void;
    warn: (message: string, fields?: Record<string, unknown>) => void;
    error: (message: string, fields?: Record<string, unknown>) => void;
    critical: (message: string, fields?: Record<string, unknown>) => void;
};
/**
 * Create a child logger with pre-set fields
 */
export declare function createLogger(defaultFields: Record<string, unknown>): {
    debug: (message: string, fields?: Record<string, unknown>) => void;
    info: (message: string, fields?: Record<string, unknown>) => void;
    warn: (message: string, fields?: Record<string, unknown>) => void;
    error: (message: string, fields?: Record<string, unknown>) => void;
    critical: (message: string, fields?: Record<string, unknown>) => void;
};
/**
 * Error logging helper that captures error details
 */
export declare function logError(error: Error, message: string, additionalContext?: Record<string, unknown>): void;
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
export declare function logSensitiveAgentTrace(trace: SensitiveAgentTrace): void;
//# sourceMappingURL=logs.d.ts.map