/**
 * Main OpenTelemetry setup for Brotto Browser Automation Platform
 *
 * Provides centralized telemetry configuration and initialization.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Tracer, Meter } from '@opentelemetry/api';
import { TelemetryConfig, ExporterConfig } from './export.js';
export { FARA_SPAN_ATTRIBUTES, SessionState, ActionType, PolicyResult } from './traces.js';
export { METRIC_NAMES, METRIC_LABELS, UNITS, HISTOGRAM_BUCKETS, TEMPORALITY, } from './metrics.js';
export { logger, createLogger, logError, logSensitiveAgentTrace } from './logs.js';
export { ExporterConfig, TelemetryConfig, ExporterType } from './export.js';
/**
 * Initialized telemetry instance
 */
export interface TelemetryInstance {
    sdk: NodeSDK | null;
    tracer: Tracer;
    meter: Meter;
    shutdown: () => Promise<void>;
}
/**
 * Service context for telemetry
 */
export interface ServiceContext {
    serviceName: string;
    serviceVersion?: string;
    tenantId?: string;
}
/**
 * Create and initialize OpenTelemetry SDK
 */
export declare function initTelemetry(config: TelemetryConfig): Promise<TelemetryInstance>;
/**
 * Create a simple telemetry setup without full SDK initialization
 * Useful for libraries that just need tracer/meter access
 */
export declare function createBasicTelemetry(serviceName: string): {
    tracer: Tracer;
    meter: Meter;
};
/**
 * Create a no-op telemetry instance for testing
 */
export declare function createNoOpTelemetry(): TelemetryInstance;
/**
 * Default exporters for common setups
 */
export declare const DEFAULT_EXPORTERS: {
    /**
     * Console exporter for local development
     */
    readonly console: {
        readonly traceExporter: {
            readonly type: "console";
        };
        readonly metricExporter: {
            readonly type: "console";
        };
    };
    /**
     * OTLP exporter for production with standard endpoint
     */
    readonly otlp: {
        readonly traceExporter: {
            readonly type: "otlp";
            readonly endpoint: string;
        };
        readonly metricExporter: {
            readonly type: "otlp";
            readonly endpoint: string;
        };
    };
    /**
     * Prometheus exporter for Kubernetes/metrics-focused setups
     */
    readonly prometheus: (port?: number) => {
        traceExporter: {
            type: "none";
        };
        metricExporter: ExporterConfig;
    };
    /**
     * No exporter for testing
     */
    readonly none: {
        readonly traceExporter: {
            readonly type: "none";
        };
        readonly metricExporter: {
            readonly type: "none";
        };
    };
};
//# sourceMappingURL=telemetry.d.ts.map