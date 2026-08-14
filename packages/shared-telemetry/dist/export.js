/**
 * Export configurations for Brotto Browser Automation Platform
 *
 * Supports OTLP, Prometheus, and Jaeger exporters.
 * Per ARCHITECTURE.md section 11, publish OpenTelemetry dashboards.
 */
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { BatchSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { PeriodicExportingMetricReader, ConsoleMetricExporter } from '@opentelemetry/sdk-metrics';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
/**
 * Create an OTLP trace exporter with configuration
 */
export function createOtlpTraceExporter(config) {
    return new OTLPTraceExporter({
        url: `${config.endpoint}/v1/traces`,
        headers: config.headers,
        timeoutMillis: config.timeout ?? 30000,
    });
}
/**
 * Create an OTLP metric exporter with configuration
 */
export function createOtlpMetricExporter(config) {
    return new OTLPMetricExporter({
        url: `${config.endpoint}/v1/metrics`,
        headers: config.headers,
        timeoutMillis: config.timeout ?? 30000,
    });
}
/**
 * Create a Prometheus exporter
 */
export function createPrometheusExporter(config) {
    return new PrometheusExporter({
        port: config.port,
        endpoint: config.endpoint ?? '/metrics',
    });
}
/**
 * Get span processor based on exporter type
 */
export function getSpanProcessor(traceExporter) {
    switch (traceExporter.type) {
        case 'otlp':
            return new BatchSpanProcessor(createOtlpTraceExporter(traceExporter));
        case 'console':
            return new BatchSpanProcessor(new ConsoleSpanExporter());
        case 'none':
            return undefined;
        default:
            return new BatchSpanProcessor(new ConsoleSpanExporter());
    }
}
/**
 * Get metric reader based on exporter type
 * Note: PrometheusExporter is a pull-based exporter and doesn't work with PeriodicExportingMetricReader
 */
export function getMetricReader(metricExporter) {
    switch (metricExporter.type) {
        case 'otlp':
            return new PeriodicExportingMetricReader({
                exporter: createOtlpMetricExporter(metricExporter),
                exportIntervalMillis: 10000,
            });
        case 'prometheus':
            // PrometheusExporter is its own reader (pull-based)
            return new PrometheusExporter({
                port: metricExporter.port,
                endpoint: metricExporter.endpoint ?? '/metrics',
            });
        case 'console':
            return new PeriodicExportingMetricReader({
                exporter: new ConsoleMetricExporter(),
                exportIntervalMillis: 60000,
            });
        case 'none':
            return undefined;
        default:
            return undefined;
    }
}
/**
 * Create a Resource with standard attributes
 */
export function createResource(serviceName, serviceVersion, customAttributes) {
    const attributes = {
        [ATTR_SERVICE_NAME]: serviceName,
        ...(serviceVersion && { [ATTR_SERVICE_VERSION]: serviceVersion }),
        ...customAttributes,
    };
    return new Resource(attributes);
}
/**
 * Build instrumentations array
 */
export function getInstrumentations(enabled = true) {
    if (!enabled) {
        return [];
    }
    return [
        new FastifyInstrumentation(),
        new ExpressInstrumentation(),
    ];
}
/**
 * Validate exporter configuration
 */
export function validateExporterConfig(config) {
    switch (config.type) {
        case 'otlp':
            return !!config.endpoint && config.endpoint.startsWith('http');
        case 'prometheus':
            return config.port > 0 && config.port < 65536;
        case 'console':
            return true;
        case 'jaeger':
            return !!config.endpoint;
        case 'none':
            return true;
        default:
            return false;
    }
}
/**
 * Get default configuration for each environment
 */
export function getDefaultConfig(environment) {
    switch (environment) {
        case 'development':
            return {
                serviceName: 'fara',
                traceExporter: { type: 'console' },
                metricExporter: { type: 'console' },
                enabledInstrumentations: true,
            };
        case 'production':
            return {
                serviceName: 'fara',
                traceExporter: {
                    type: 'otlp',
                    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
                },
                metricExporter: {
                    type: 'otlp',
                    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
                },
                enabledInstrumentations: true,
            };
        case 'testing':
            return {
                serviceName: 'brotto-test',
                traceExporter: { type: 'none' },
                metricExporter: { type: 'none' },
                enabledInstrumentations: false,
            };
    }
}
//# sourceMappingURL=export.js.map