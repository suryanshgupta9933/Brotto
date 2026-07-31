/**
 * Export configurations for Fara1.5 Browser Automation Platform
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
export function createOtlpTraceExporter(config: OtlpConfig): OTLPTraceExporter {
  return new OTLPTraceExporter({
    url: `${config.endpoint}/v1/traces`,
    headers: config.headers,
    timeoutMillis: config.timeout ?? 30000,
  });
}

/**
 * Create an OTLP metric exporter with configuration
 */
export function createOtlpMetricExporter(config: OtlpConfig): OTLPMetricExporter {
  return new OTLPMetricExporter({
    url: `${config.endpoint}/v1/metrics`,
    headers: config.headers,
    timeoutMillis: config.timeout ?? 30000,
  });
}

/**
 * Create a Prometheus exporter
 */
export function createPrometheusExporter(config: PrometheusConfig): PrometheusExporter {
  return new PrometheusExporter({
    port: config.port,
    endpoint: config.endpoint ?? '/metrics',
  });
}

/**
 * Get span processor based on exporter type
 */
export function getSpanProcessor(
  traceExporter: ExporterConfig
): BatchSpanProcessor | undefined {
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
export function getMetricReader(
  metricExporter: ExporterConfig
): PeriodicExportingMetricReader | PrometheusExporter | undefined {
  switch (metricExporter.type) {
    case 'otlp':
      return new PeriodicExportingMetricReader({
        exporter: createOtlpMetricExporter(metricExporter),
        exportIntervalMillis: 10000,
      });
    case 'prometheus':
      // PrometheusExporter is its own reader (pull-based)
      return new PrometheusExporter({
        port: (metricExporter as PrometheusConfig).port,
        endpoint: (metricExporter as PrometheusConfig).endpoint ?? '/metrics',
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
export function createResource(
  serviceName: string,
  serviceVersion?: string,
  customAttributes?: Record<string, string>
): Resource {
  const attributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: serviceName,
    ...(serviceVersion && { [ATTR_SERVICE_VERSION]: serviceVersion }),
    ...customAttributes,
  };

  return new Resource(attributes);
}

/**
 * Build instrumentations array
 */
export function getInstrumentations(enabled: boolean = true) {
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
export function validateExporterConfig(config: ExporterConfig): boolean {
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
export function getDefaultConfig(environment: 'development' | 'production' | 'testing'): TelemetryConfig {
  switch (environment) {
    case 'development':
      return {
        serviceName: 'fara-platform',
        traceExporter: { type: 'console' },
        metricExporter: { type: 'console' },
        enabledInstrumentations: true,
      };
    case 'production':
      return {
        serviceName: 'fara-platform',
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
        serviceName: 'fara-platform-test',
        traceExporter: { type: 'none' },
        metricExporter: { type: 'none' },
        enabledInstrumentations: false,
      };
  }
}
