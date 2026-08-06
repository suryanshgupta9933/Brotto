/**
 * Metrics definitions for Brotto Browser Automation Platform
 *
 * Defines standard metrics for session count, action count, latency, and error rates.
 * Per ARCHITECTURE.md section 11, OpenTelemetry dashboards should be published.
 */

import { Meter, metrics } from '@opentelemetry/api';

/**
 * Metric names for Brotto platform
 */
export const METRIC_NAMES = {
  // Session metrics
  SESSION_COUNT: 'fara.session.count',
  SESSION_DURATION_SECONDS: 'fara.session.duration_seconds',
  SESSION_ACTIVE: 'fara.session.active',

  // Action metrics
  ACTION_COUNT: 'fara.action.count',
  ACTION_LATENCY_SECONDS: 'fara.action.latency_seconds',
  ACTION_SUCCESS_COUNT: 'fara.action.success_count',
  ACTION_FAILURE_COUNT: 'fara.action.failure_count',
  ACTION_RETRY_COUNT: 'fara.action.retry_count',

  // Approval metrics
  APPROVAL_REQUEST_COUNT: 'fara.approval.request_count',
  APPROVAL_APPROVED_COUNT: 'fara.approval.approved_count',
  APPROVAL_DENIED_COUNT: 'fara.approval.denied_count',
  APPROVAL_LATENCY_SECONDS: 'fara.approval.latency_seconds',

  // Model metrics
  MODEL_INFERENCE_COUNT: 'fara.model.inference_count',
  MODEL_INFERENCE_LATENCY_SECONDS: 'fara.model.inference_latency_seconds',
  MODEL_TOKEN_COUNT: 'fara.model.token_count',

  // Browser metrics
  BROWSER_SCREENSHOT_COUNT: 'fara.browser.screenshot_count',
  BROWSER_SCREENSHOT_SIZE_BYTES: 'fara.browser.screenshot_size_bytes',
  BROWSER_NAVIGATION_COUNT: 'fara.browser.navigation_count',
  BROWSER_ERROR_COUNT: 'fara.browser.error_count',

  // Policy metrics
  POLICY_EVALUATION_COUNT: 'fara.policy.evaluation_count',
  POLICY_APPROVED_COUNT: 'fara.policy.approved_count',
  POLICY_DENIED_COUNT: 'fara.policy.denied_count',

  // Error metrics
  ERROR_COUNT: 'fara.error.count',
  ERROR_RATE: 'fara.error.rate',
} as const;

/**
 * Metric labels/dimensions
 */
export const METRIC_LABELS = {
  ACTION_TYPE: 'action_type',
  SESSION_STATE: 'session_state',
  POLICY_RESULT: 'policy_result',
  MODEL_NAME: 'model_name',
  ERROR_TYPE: 'error_type',
  TENANT_ID: 'tenant_id',
  DEVICE_TYPE: 'device_type',
} as const;

/**
 * Create a meter instance for the Brotto platform
 */
export function createFaraMeter(name: string, version = '0.1.0'): Meter {
  return metrics.getMeter(name, version);
}

/**
 * Pre-configured observable gauges for real-time metrics
 */
export interface ObservableGaugeCallbacks {
  /**
   * Callback to get current active session count
   */
  getActiveSessionCount: () => number;

  /**
   * Callback to get session counts by state
   */
  getSessionCountByState: () => Map<string, number>;

  /**
   * Callback to get action counts by type
   */
  getActionCountByType: () => Map<string, number>;
}

/**
 * Metrics bucket configuration for histograms
 */
export const HISTOGRAM_BUCKETS = {
  // Latency buckets (in seconds)
  ACTION_LATENCY: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  APPROVAL_LATENCY: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  INFERENCE_LATENCY: [0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32],
  SESSION_DURATION: [60, 300, 600, 1800, 3600, 7200, 14400], // 1min to 4hr

  // Size buckets (in bytes)
  SCREENSHOT_SIZE: [100000, 250000, 500000, 1000000, 2000000, 4000000],
} as const;

/**
 * Unit constants for metrics
 */
export const UNITS = {
  SECONDS: 's',
  MILLISECONDS: 'ms',
  BYTES: 'By',
  KILOBYTES: 'kBy',
  COUNT: '{count}',
  SESSION: '{session}',
  ACTION: '{action}',
  APPROVAL: '{approval}',
} as const;

/**
 * Metric aggregation temporality
 */
export const TEMPORALITY = {
  CUMULATIVE: 'cumulative',
  DELTA: 'delta',
  LAST_VALUE: 'last_value',
} as const;
