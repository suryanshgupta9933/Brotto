/**
 * Tests for metrics definitions
 */

import {
  METRIC_NAMES,
  METRIC_LABELS,
  UNITS,
  HISTOGRAM_BUCKETS,
  TEMPORALITY,
  createFaraMeter,
} from '../metrics';

describe('metrics', () => {
  describe('METRIC_NAMES', () => {
    it('should have session metrics', () => {
      expect(METRIC_NAMES.SESSION_COUNT).toBe('fara.session.count');
      expect(METRIC_NAMES.SESSION_DURATION_SECONDS).toBe('fara.session.duration_seconds');
      expect(METRIC_NAMES.SESSION_ACTIVE).toBe('fara.session.active');
    });

    it('should have action metrics', () => {
      expect(METRIC_NAMES.ACTION_COUNT).toBe('fara.action.count');
      expect(METRIC_NAMES.ACTION_LATENCY_SECONDS).toBe('fara.action.latency_seconds');
      expect(METRIC_NAMES.ACTION_SUCCESS_COUNT).toBe('fara.action.success_count');
      expect(METRIC_NAMES.ACTION_FAILURE_COUNT).toBe('fara.action.failure_count');
      expect(METRIC_NAMES.ACTION_RETRY_COUNT).toBe('fara.action.retry_count');
    });

    it('should have approval metrics', () => {
      expect(METRIC_NAMES.APPROVAL_REQUEST_COUNT).toBe('fara.approval.request_count');
      expect(METRIC_NAMES.APPROVAL_APPROVED_COUNT).toBe('fara.approval.approved_count');
      expect(METRIC_NAMES.APPROVAL_DENIED_COUNT).toBe('fara.approval.denied_count');
      expect(METRIC_NAMES.APPROVAL_LATENCY_SECONDS).toBe('fara.approval.latency_seconds');
    });

    it('should have model metrics', () => {
      expect(METRIC_NAMES.MODEL_INFERENCE_COUNT).toBe('fara.model.inference_count');
      expect(METRIC_NAMES.MODEL_INFERENCE_LATENCY_SECONDS).toBe('fara.model.inference_latency_seconds');
      expect(METRIC_NAMES.MODEL_TOKEN_COUNT).toBe('fara.model.token_count');
    });

    it('should have browser metrics', () => {
      expect(METRIC_NAMES.BROWSER_SCREENSHOT_COUNT).toBe('fara.browser.screenshot_count');
      expect(METRIC_NAMES.BROWSER_SCREENSHOT_SIZE_BYTES).toBe('fara.browser.screenshot_size_bytes');
      expect(METRIC_NAMES.BROWSER_NAVIGATION_COUNT).toBe('fara.browser.navigation_count');
      expect(METRIC_NAMES.BROWSER_ERROR_COUNT).toBe('fara.browser.error_count');
    });

    it('should have policy metrics', () => {
      expect(METRIC_NAMES.POLICY_EVALUATION_COUNT).toBe('fara.policy.evaluation_count');
      expect(METRIC_NAMES.POLICY_APPROVED_COUNT).toBe('fara.policy.approved_count');
      expect(METRIC_NAMES.POLICY_DENIED_COUNT).toBe('fara.policy.denied_count');
    });

    it('should have error metrics', () => {
      expect(METRIC_NAMES.ERROR_COUNT).toBe('fara.error.count');
      expect(METRIC_NAMES.ERROR_RATE).toBe('fara.error.rate');
    });
  });

  describe('METRIC_LABELS', () => {
    it('should have expected label names', () => {
      expect(METRIC_LABELS.ACTION_TYPE).toBe('action_type');
      expect(METRIC_LABELS.SESSION_STATE).toBe('session_state');
      expect(METRIC_LABELS.POLICY_RESULT).toBe('policy_result');
      expect(METRIC_LABELS.MODEL_NAME).toBe('model_name');
      expect(METRIC_LABELS.ERROR_TYPE).toBe('error_type');
      expect(METRIC_LABELS.TENANT_ID).toBe('tenant_id');
      expect(METRIC_LABELS.DEVICE_TYPE).toBe('device_type');
    });
  });

  describe('UNITS', () => {
    it('should have time units', () => {
      expect(UNITS.SECONDS).toBe('s');
      expect(UNITS.MILLISECONDS).toBe('ms');
    });

    it('should have size units', () => {
      expect(UNITS.BYTES).toBe('By');
      expect(UNITS.KILOBYTES).toBe('kBy');
    });

    it('should have count units', () => {
      expect(UNITS.COUNT).toBe('{count}');
      expect(UNITS.SESSION).toBe('{session}');
      expect(UNITS.ACTION).toBe('{action}');
      expect(UNITS.APPROVAL).toBe('{approval}');
    });
  });

  describe('HISTOGRAM_BUCKETS', () => {
    it('should have action latency buckets', () => {
      expect(HISTOGRAM_BUCKETS.ACTION_LATENCY).toBeDefined();
      expect(HISTOGRAM_BUCKETS.ACTION_LATENCY.length).toBeGreaterThan(0);
      expect(HISTOGRAM_BUCKETS.ACTION_LATENCY[0]).toBeLessThan(HISTOGRAM_BUCKETS.ACTION_LATENCY[1]);
    });

    it('should have approval latency buckets', () => {
      expect(HISTOGRAM_BUCKETS.APPROVAL_LATENCY).toBeDefined();
      expect(HISTOGRAM_BUCKETS.APPROVAL_LATENCY.length).toBeGreaterThan(0);
    });

    it('should have inference latency buckets', () => {
      expect(HISTOGRAM_BUCKETS.INFERENCE_LATENCY).toBeDefined();
      expect(HISTOGRAM_BUCKETS.INFERENCE_LATENCY.length).toBeGreaterThan(0);
    });

    it('should have session duration buckets', () => {
      expect(HISTOGRAM_BUCKETS.SESSION_DURATION).toBeDefined();
      expect(HISTOGRAM_BUCKETS.SESSION_DURATION.length).toBeGreaterThan(0);
    });

    it('should have screenshot size buckets', () => {
      expect(HISTOGRAM_BUCKETS.SCREENSHOT_SIZE).toBeDefined();
      expect(HISTOGRAM_BUCKETS.SCREENSHOT_SIZE.length).toBeGreaterThan(0);
    });
  });

  describe('TEMPORALITY', () => {
    it('should have expected temporality values', () => {
      expect(TEMPORALITY.CUMULATIVE).toBe('cumulative');
      expect(TEMPORALITY.DELTA).toBe('delta');
      expect(TEMPORALITY.LAST_VALUE).toBe('last_value');
    });
  });

  describe('createFaraMeter', () => {
    it('should create a meter with the given name', () => {
      const meter = createFaraMeter('test-service');
      expect(meter).toBeDefined();
    });

    it('should create a meter with version', () => {
      const meter = createFaraMeter('test-service', '1.0.0');
      expect(meter).toBeDefined();
    });
  });
});
