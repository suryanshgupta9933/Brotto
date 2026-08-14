/**
 * Metrics definitions for Brotto Browser Automation Platform
 *
 * Defines standard metrics for session count, action count, latency, and error rates.
 * Per ARCHITECTURE.md section 11, OpenTelemetry dashboards should be published.
 */
import { Meter } from '@opentelemetry/api';
/**
 * Metric names for Brotto platform
 */
export declare const METRIC_NAMES: {
    readonly SESSION_COUNT: "fara.session.count";
    readonly SESSION_DURATION_SECONDS: "fara.session.duration_seconds";
    readonly SESSION_ACTIVE: "fara.session.active";
    readonly ACTION_COUNT: "fara.action.count";
    readonly ACTION_LATENCY_SECONDS: "fara.action.latency_seconds";
    readonly ACTION_SUCCESS_COUNT: "fara.action.success_count";
    readonly ACTION_FAILURE_COUNT: "fara.action.failure_count";
    readonly ACTION_RETRY_COUNT: "fara.action.retry_count";
    readonly APPROVAL_REQUEST_COUNT: "fara.approval.request_count";
    readonly APPROVAL_APPROVED_COUNT: "fara.approval.approved_count";
    readonly APPROVAL_DENIED_COUNT: "fara.approval.denied_count";
    readonly APPROVAL_LATENCY_SECONDS: "fara.approval.latency_seconds";
    readonly MODEL_INFERENCE_COUNT: "fara.model.inference_count";
    readonly MODEL_INFERENCE_LATENCY_SECONDS: "fara.model.inference_latency_seconds";
    readonly MODEL_TOKEN_COUNT: "fara.model.token_count";
    readonly BROWSER_SCREENSHOT_COUNT: "fara.browser.screenshot_count";
    readonly BROWSER_SCREENSHOT_SIZE_BYTES: "fara.browser.screenshot_size_bytes";
    readonly BROWSER_NAVIGATION_COUNT: "fara.browser.navigation_count";
    readonly BROWSER_ERROR_COUNT: "fara.browser.error_count";
    readonly POLICY_EVALUATION_COUNT: "fara.policy.evaluation_count";
    readonly POLICY_APPROVED_COUNT: "fara.policy.approved_count";
    readonly POLICY_DENIED_COUNT: "fara.policy.denied_count";
    readonly ERROR_COUNT: "fara.error.count";
    readonly ERROR_RATE: "fara.error.rate";
};
/**
 * Metric labels/dimensions
 */
export declare const METRIC_LABELS: {
    readonly ACTION_TYPE: "action_type";
    readonly SESSION_STATE: "session_state";
    readonly POLICY_RESULT: "policy_result";
    readonly MODEL_NAME: "model_name";
    readonly ERROR_TYPE: "error_type";
    readonly TENANT_ID: "tenant_id";
    readonly DEVICE_TYPE: "device_type";
};
/**
 * Create a meter instance for the Brotto platform
 */
export declare function createFaraMeter(name: string, version?: string): Meter;
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
export declare const HISTOGRAM_BUCKETS: {
    readonly ACTION_LATENCY: readonly [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
    readonly APPROVAL_LATENCY: readonly [0.5, 1, 2, 5, 10, 30, 60, 120, 300];
    readonly INFERENCE_LATENCY: readonly [0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32];
    readonly SESSION_DURATION: readonly [60, 300, 600, 1800, 3600, 7200, 14400];
    readonly SCREENSHOT_SIZE: readonly [100000, 250000, 500000, 1000000, 2000000, 4000000];
};
/**
 * Unit constants for metrics
 */
export declare const UNITS: {
    readonly SECONDS: "s";
    readonly MILLISECONDS: "ms";
    readonly BYTES: "By";
    readonly KILOBYTES: "kBy";
    readonly COUNT: "{count}";
    readonly SESSION: "{session}";
    readonly ACTION: "{action}";
    readonly APPROVAL: "{approval}";
};
/**
 * Metric aggregation temporality
 */
export declare const TEMPORALITY: {
    readonly CUMULATIVE: "cumulative";
    readonly DELTA: "delta";
    readonly LAST_VALUE: "last_value";
};
//# sourceMappingURL=metrics.d.ts.map