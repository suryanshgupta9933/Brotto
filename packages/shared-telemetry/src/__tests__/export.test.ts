/**
 * Tests for export configurations
 */

import {
  createOtlpTraceExporter,
  createPrometheusExporter,
  createResource,
  getInstrumentations,
  validateExporterConfig,
  getDefaultConfig,
  ExporterConfig,
} from '../export';

describe('export', () => {
  describe('createOtlpTraceExporter', () => {
    it('should create an OTLP trace exporter', () => {
      const exporter = createOtlpTraceExporter({
        type: 'otlp',
        endpoint: 'http://localhost:4318',
      });

      expect(exporter).toBeDefined();
    });

    it('should create OTLP exporter with custom headers', () => {
      const exporter = createOtlpTraceExporter({
        type: 'otlp',
        endpoint: 'http://localhost:4318',
        headers: { 'x-custom': 'value' },
      });

      expect(exporter).toBeDefined();
    });

    it('should create OTLP exporter with custom timeout', () => {
      const exporter = createOtlpTraceExporter({
        type: 'otlp',
        endpoint: 'http://localhost:4318',
        timeout: 60000,
      });

      expect(exporter).toBeDefined();
    });
  });

  describe('createPrometheusExporter', () => {
    it('should create a Prometheus exporter', () => {
      const exporter = createPrometheusExporter({
        type: 'prometheus',
        port: 9464,
      });

      expect(exporter).toBeDefined();
    });

    it('should create Prometheus exporter with custom endpoint', () => {
      const exporter = createPrometheusExporter({
        type: 'prometheus',
        port: 9464,
        endpoint: '/custom-metrics',
      });

      expect(exporter).toBeDefined();
    });
  });

  describe('createResource', () => {
    it('should create a resource with service name', () => {
      const resource = createResource('test-service');

      expect(resource).toBeDefined();
    });

    it('should create a resource with service version', () => {
      const resource = createResource('test-service', '1.0.0');

      expect(resource).toBeDefined();
    });

    it('should create a resource with custom attributes', () => {
      const resource = createResource('test-service', '1.0.0', {
        'custom.attribute': 'value',
      });

      expect(resource).toBeDefined();
    });
  });

  describe('getInstrumentations', () => {
    it('should return instrumentations when enabled', () => {
      const instrumentations = getInstrumentations(true);

      expect(Array.isArray(instrumentations)).toBe(true);
    });

    it('should return empty array when disabled', () => {
      const instrumentations = getInstrumentations(false);

      expect(instrumentations).toEqual([]);
    });
  });

  describe('validateExporterConfig', () => {
    it('should validate OTLP config with valid endpoint', () => {
      const valid = validateExporterConfig({
        type: 'otlp',
        endpoint: 'http://localhost:4318',
      });

      expect(valid).toBe(true);
    });

    it('should reject OTLP config without endpoint', () => {
      const valid = validateExporterConfig({
        type: 'otlp',
        endpoint: '',
      } as ExporterConfig);

      expect(valid).toBe(false);
    });

    it('should reject OTLP config with non-http endpoint', () => {
      const valid = validateExporterConfig({
        type: 'otlp',
        endpoint: 'invalid-endpoint',
      });

      expect(valid).toBe(false);
    });

    it('should validate Prometheus config with valid port', () => {
      const valid = validateExporterConfig({
        type: 'prometheus',
        port: 9464,
      });

      expect(valid).toBe(true);
    });

    it('should reject Prometheus config with invalid port', () => {
      const valid = validateExporterConfig({
        type: 'prometheus',
        port: -1,
      } as ExporterConfig);

      expect(valid).toBe(false);
    });

    it('should accept console config', () => {
      const valid = validateExporterConfig({
        type: 'console',
      });

      expect(valid).toBe(true);
    });

    it('should accept none config', () => {
      const valid = validateExporterConfig({
        type: 'none',
      });

      expect(valid).toBe(true);
    });

    it('should validate Jaeger config with valid endpoint', () => {
      const valid = validateExporterConfig({
        type: 'jaeger',
        endpoint: 'http://localhost:14268',
      });

      expect(valid).toBe(true);
    });
  });

  describe('getDefaultConfig', () => {
    it('should return development config', () => {
      const config = getDefaultConfig('development');

      expect(config.serviceName).toBe('fara-platform');
      expect(config.traceExporter?.type).toBe('console');
      expect(config.metricExporter?.type).toBe('console');
      expect(config.enabledInstrumentations).toBe(true);
    });

    it('should return production config', () => {
      const config = getDefaultConfig('production');

      expect(config.serviceName).toBe('fara-platform');
      expect(config.traceExporter?.type).toBe('otlp');
      expect(config.metricExporter?.type).toBe('otlp');
      expect(config.enabledInstrumentations).toBe(true);
    });

    it('should return testing config', () => {
      const config = getDefaultConfig('testing');

      expect(config.serviceName).toBe('fara-platform-test');
      expect(config.traceExporter?.type).toBe('none');
      expect(config.metricExporter?.type).toBe('none');
      expect(config.enabledInstrumentations).toBe(false);
    });

    it('should use OTEL_EXPORTER_OTLP_ENDPOINT env var in production', () => {
      const originalEnv = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://custom-otel:4318';

      const config = getDefaultConfig('production');

      expect(
        (config.traceExporter as { endpoint: string })?.endpoint
      ).toBe('http://custom-otel:4318');

      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEnv ?? '';
    });
  });
});
