/**
 * Main OpenTelemetry setup for Brotto Browser Automation Platform
 *
 * Provides centralized telemetry configuration and initialization.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { trace, metrics } from '@opentelemetry/api';
import { createResource, getSpanProcessor, getMetricReader, getInstrumentations, } from './export.js';
import { logger } from './logs.js';
export { FARA_SPAN_ATTRIBUTES, SessionState, ActionType, PolicyResult } from './traces.js';
export { METRIC_NAMES, METRIC_LABELS, UNITS, HISTOGRAM_BUCKETS, TEMPORALITY, } from './metrics.js';
export { logger, createLogger, logError, logSensitiveAgentTrace } from './logs.js';
/**
 * Create and initialize OpenTelemetry SDK
 */
export async function initTelemetry(config) {
    const { serviceName, serviceVersion, traceExporter, metricExporter, enabledInstrumentations, resourceAttributes, } = config;
    logger.info('Initializing telemetry', {
        serviceName,
        traceExporterType: traceExporter?.type ?? 'none',
        metricExporterType: metricExporter?.type ?? 'none',
    });
    // Create resource
    const resource = createResource(serviceName, serviceVersion, resourceAttributes);
    // Get span processor and metric reader
    const spanProcessor = traceExporter ? getSpanProcessor(traceExporter) : undefined;
    const metricReader = metricExporter ? getMetricReader(metricExporter) : undefined;
    // Create SDK configuration object
    const sdkConfig = {
        resource,
        instrumentations: getInstrumentations(enabledInstrumentations),
    };
    // Only add spanProcessor if defined
    if (spanProcessor) {
        sdkConfig.spanProcessor = spanProcessor;
    }
    // Only add metricReader if defined
    if (metricReader) {
        sdkConfig.metricReader = metricReader;
    }
    // Create SDK instance with partial config
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdk = new NodeSDK(sdkConfig);
    // Start SDK
    try {
        sdk.start();
        logger.info('Telemetry SDK started successfully');
    }
    catch (error) {
        logger.error('Failed to start telemetry SDK', { error: String(error) });
    }
    // Create tracer and meter using OpenTelemetry API
    const tracer = trace.getTracer(serviceName, serviceVersion ?? '0.1.0');
    const meter = metrics.getMeter(serviceName, serviceVersion ?? '0.1.0');
    return {
        sdk,
        tracer,
        meter,
        shutdown: async () => {
            logger.info('Shutting down telemetry SDK');
            if (sdk) {
                await sdk.shutdown();
            }
        },
    };
}
/**
 * Create a simple telemetry setup without full SDK initialization
 * Useful for libraries that just need tracer/meter access
 */
export function createBasicTelemetry(serviceName) {
    const tracer = trace.getTracer(serviceName);
    const meter = metrics.getMeter(serviceName);
    return { tracer, meter };
}
/**
 * Create a no-op telemetry instance for testing
 */
export function createNoOpTelemetry() {
    return {
        sdk: null,
        tracer: {
            startSpan: () => ({
                setAttribute: () => { },
                setAttributes: () => { },
                addEvent: () => { },
                setStatus: () => { },
                end: () => { },
                recordException: () => { },
                spanContext: () => ({ traceId: '', spanId: '', traceFlags: 0 }),
                isRecording: () => false,
            }),
            startActiveSpan: () => {
                return {
                    setAttribute: () => { },
                    setAttributes: () => { },
                    addEvent: () => { },
                    setStatus: () => { },
                    end: () => { },
                    recordException: () => { },
                    spanContext: () => ({ traceId: '', spanId: '', traceFlags: 0 }),
                    isRecording: () => false,
                };
            },
        },
        meter: {
            createCounter: () => ({ add: () => { } }),
            createHistogram: () => ({ record: () => { } }),
            createObservableGauge: () => { },
        },
        shutdown: async () => { },
    };
}
/**
 * Default exporters for common setups
 */
export const DEFAULT_EXPORTERS = {
    /**
     * Console exporter for local development
     */
    console: {
        traceExporter: { type: 'console' },
        metricExporter: { type: 'console' },
    },
    /**
     * OTLP exporter for production with standard endpoint
     */
    otlp: {
        traceExporter: {
            type: 'otlp',
            endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
        },
        metricExporter: {
            type: 'otlp',
            endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
        },
    },
    /**
     * Prometheus exporter for Kubernetes/metrics-focused setups
     */
    prometheus: (port = 9464) => ({
        traceExporter: { type: 'none' },
        metricExporter: { type: 'prometheus', port },
    }),
    /**
     * No exporter for testing
     */
    none: {
        traceExporter: { type: 'none' },
        metricExporter: { type: 'none' },
    },
};
//# sourceMappingURL=telemetry.js.map