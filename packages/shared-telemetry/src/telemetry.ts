/**
 * Main OpenTelemetry setup for Fara1.5 Browser Automation Platform
 *
 * Provides centralized telemetry configuration and initialization.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { trace, metrics, Tracer, Meter } from '@opentelemetry/api';
import {
  createResource,
  getSpanProcessor,
  getMetricReader,
  getInstrumentations,
  TelemetryConfig,
  ExporterConfig,
} from './export.js';
import { FARA_SPAN_ATTRIBUTES, SessionState, ActionType, PolicyResult } from './traces.js';
import { METRIC_NAMES, METRIC_LABELS, UNITS, createFaraMeter } from './metrics.js';
import { logger } from './logs.js';

export { FARA_SPAN_ATTRIBUTES, SessionState, ActionType, PolicyResult } from './traces.js';
export {
  METRIC_NAMES,
  METRIC_LABELS,
  UNITS,
  HISTOGRAM_BUCKETS,
  TEMPORALITY,
} from './metrics.js';
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
export async function initTelemetry(config: TelemetryConfig): Promise<TelemetryInstance> {
  const {
    serviceName,
    serviceVersion,
    traceExporter,
    metricExporter,
    enabledInstrumentations,
    resourceAttributes,
  } = config;

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
  const sdkConfig: Record<string, unknown> = {
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
  const sdk = new NodeSDK(sdkConfig as any);

  // Start SDK
  try {
    sdk.start();
    logger.info('Telemetry SDK started successfully');
  } catch (error) {
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
export function createBasicTelemetry(serviceName: string): { tracer: Tracer; meter: Meter } {
  const tracer = trace.getTracer(serviceName);
  const meter = metrics.getMeter(serviceName);

  return { tracer, meter };
}

/**
 * Create a no-op telemetry instance for testing
 */
export function createNoOpTelemetry(): TelemetryInstance {
  return {
    sdk: null,
    tracer: {
      startSpan: () => ({
        setAttribute: () => {},
        setAttributes: () => {},
        addEvent: () => {},
        setStatus: () => {},
        end: () => {},
        recordException: () => {},
        spanContext: () => ({ traceId: '', spanId: '', traceFlags: 0 }),
        isRecording: () => false,
      }),
      startActiveSpan: () => {
        return {
          setAttribute: () => {},
          setAttributes: () => {},
          addEvent: () => {},
          setStatus: () => {},
          end: () => {},
          recordException: () => {},
          spanContext: () => ({ traceId: '', spanId: '', traceFlags: 0 }),
          isRecording: () => false,
        };
      },
    } as unknown as Tracer,
    meter: {
      createCounter: () => ({ add: () => {} }),
      createHistogram: () => ({ record: () => {} }),
      createObservableGauge: () => {},
    } as unknown as Meter,
    shutdown: async () => {},
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
    traceExporter: { type: 'console' as const },
    metricExporter: { type: 'console' as const },
  },

  /**
   * OTLP exporter for production with standard endpoint
   */
  otlp: {
    traceExporter: {
      type: 'otlp' as const,
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
    },
    metricExporter: {
      type: 'otlp' as const,
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
    },
  },

  /**
   * Prometheus exporter for Kubernetes/metrics-focused setups
   */
  prometheus: (port: number = 9464) => ({
    traceExporter: { type: 'none' as const },
    metricExporter: { type: 'prometheus' as const, port } as ExporterConfig,
  }),

  /**
   * No exporter for testing
   */
  none: {
    traceExporter: { type: 'none' as const },
    metricExporter: { type: 'none' as const },
  },
} as const;
