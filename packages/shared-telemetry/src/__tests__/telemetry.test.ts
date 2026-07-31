/**
 * Tests for main telemetry setup
 */

import {
  DEFAULT_EXPORTERS,
  createNoOpTelemetry,
} from '../telemetry';

describe('telemetry', () => {
  describe('DEFAULT_EXPORTERS', () => {
    it('should have console exporter', () => {
      expect(DEFAULT_EXPORTERS.console).toBeDefined();
      expect(DEFAULT_EXPORTERS.console.traceExporter.type).toBe('console');
      expect(DEFAULT_EXPORTERS.console.metricExporter.type).toBe('console');
    });

    it('should have otlp exporter', () => {
      expect(DEFAULT_EXPORTERS.otlp).toBeDefined();
      expect(DEFAULT_EXPORTERS.otlp.traceExporter.type).toBe('otlp');
      expect(DEFAULT_EXPORTERS.otlp.metricExporter.type).toBe('otlp');
    });

    it('should have prometheus exporter factory', () => {
      expect(typeof DEFAULT_EXPORTERS.prometheus).toBe('function');
      const prometheusConfig = DEFAULT_EXPORTERS.prometheus(9464);
      expect(prometheusConfig.metricExporter.type).toBe('prometheus');
    });

    it('should have none exporter', () => {
      expect(DEFAULT_EXPORTERS.none).toBeDefined();
      expect(DEFAULT_EXPORTERS.none.traceExporter.type).toBe('none');
      expect(DEFAULT_EXPORTERS.none.metricExporter.type).toBe('none');
    });
  });

  describe('createNoOpTelemetry', () => {
    it('should create a no-op telemetry instance', () => {
      const telemetry = createNoOpTelemetry();

      expect(telemetry).toBeDefined();
      expect(telemetry.sdk).toBeNull();
      expect(telemetry.tracer).toBeDefined();
      expect(telemetry.meter).toBeDefined();
      expect(typeof telemetry.shutdown).toBe('function');
    });

    it('should return a callable shutdown function', async () => {
      const telemetry = createNoOpTelemetry();

      await expect(telemetry.shutdown()).resolves.not.toThrow();
    });

    it('should have a tracer with startSpan method', () => {
      const telemetry = createNoOpTelemetry();

      expect(typeof telemetry.tracer.startSpan).toBe('function');
    });

    it('should have a tracer with startActiveSpan method', () => {
      const telemetry = createNoOpTelemetry();

      expect(typeof telemetry.tracer.startActiveSpan).toBe('function');
    });

    it('should have a meter with createCounter method', () => {
      const telemetry = createNoOpTelemetry();

      expect(typeof telemetry.meter.createCounter).toBe('function');
    });

    it('should have a meter with createHistogram method', () => {
      const telemetry = createNoOpTelemetry();

      expect(typeof telemetry.meter.createHistogram).toBe('function');
    });
  });

  describe('exports', () => {
    it('should export SessionState from traces', async () => {
      const { SessionState } = await import('../telemetry');
      expect(SessionState).toBeDefined();
    });

    it('should export ActionType from traces', async () => {
      const { ActionType } = await import('../telemetry');
      expect(ActionType).toBeDefined();
    });

    it('should export PolicyResult from traces', async () => {
      const { PolicyResult } = await import('../telemetry');
      expect(PolicyResult).toBeDefined();
    });

    it('should export logger from logs', async () => {
      const { logger } = await import('../telemetry');
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
    });

    it('should export METRIC_NAMES from metrics', async () => {
      const { METRIC_NAMES } = await import('../telemetry');
      expect(METRIC_NAMES.SESSION_COUNT).toBe('fara.session.count');
    });

    it('should export UNITS from metrics', async () => {
      const { UNITS } = await import('../telemetry');
      expect(UNITS.SECONDS).toBe('s');
    });
  });
});
