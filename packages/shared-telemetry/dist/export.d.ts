/**
 * Export configurations for Brotto Browser Automation Platform
 *
 * Supports OTLP, Prometheus, and Jaeger exporters.
 * Per ARCHITECTURE.md section 11, publish OpenTelemetry dashboards.
 */
import { Resource } from '@opentelemetry/resources';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
/**
 * Exporter type options
 */
export type ExporterType = 'otlp' | 'prometheus' | 'console' | 'jaeger' | 'none';
/**
 * OTLP endpoint configuration
 */
export interface OtlpConfig {
    type: 'otlp';
    endpoint: string;
    headers?: Record<string, string>;
    timeout?: number;
}
/**
 * Prometheus exporter configuration
 */
export interface PrometheusConfig {
    type: 'prometheus';
    port: number;
    endpoint?: string;
}
/**
 * Console exporter configuration (for development)
 */
export interface ConsoleConfig {
    type: 'console';
}
/**
 * Jaeger exporter configuration (legacy support)
 */
export interface JaegerConfig {
    type: 'jaeger';
    endpoint: string;
    tags?: Record<string, string>;
}
/**
 * No exporter configuration (disable telemetry)
 */
export interface NoneConfig {
    type: 'none';
}
/**
 * Exporter configuration union type
 */
export type ExporterConfig = OtlpConfig | PrometheusConfig | ConsoleConfig | JaegerConfig | NoneConfig;
/**
 * Telemetry SDK configuration
 */
export interface TelemetryConfig {
    serviceName: string;
    serviceVersion?: string;
    traceExporter?: ExporterConfig;
    metricExporter?: ExporterConfig;
    enabledInstrumentations?: boolean;
    prometheusPort?: number;
    resourceAttributes?: Record<string, string>;
}
/**
 * Create an OTLP trace exporter with configuration
 */
export declare function createOtlpTraceExporter(config: OtlpConfig): OTLPTraceExporter;
/**
 * Create an OTLP metric exporter with configuration
 */
export declare function createOtlpMetricExporter(config: OtlpConfig): OTLPMetricExporter;
/**
 * Create a Prometheus exporter
 */
export declare function createPrometheusExporter(config: PrometheusConfig): PrometheusExporter;
/**
 * Get span processor based on exporter type
 */
export declare function getSpanProcessor(traceExporter: ExporterConfig): BatchSpanProcessor | undefined;
/**
 * Get metric reader based on exporter type
 * Note: PrometheusExporter is a pull-based exporter and doesn't work with PeriodicExportingMetricReader
 */
export declare function getMetricReader(metricExporter: ExporterConfig): PeriodicExportingMetricReader | PrometheusExporter | undefined;
/**
 * Create a Resource with standard attributes
 */
export declare function createResource(serviceName: string, serviceVersion?: string, customAttributes?: Record<string, string>): Resource;
/**
 * Build instrumentations array
 */
export declare function getInstrumentations(enabled?: boolean): (FastifyInstrumentation | ExpressInstrumentation)[];
/**
 * Validate exporter configuration
 */
export declare function validateExporterConfig(config: ExporterConfig): boolean;
/**
 * Get default configuration for each environment
 */
export declare function getDefaultConfig(environment: 'development' | 'production' | 'testing'): TelemetryConfig;
//# sourceMappingURL=export.d.ts.map