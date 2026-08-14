/**
 * Trace and Span types for Brotto Browser Automation Platform
 *
 * Defines standard trace/span attributes for session lifecycle monitoring.
 * Per ARCHITECTURE.md section 8.9, keep sensitive agent traces separate from
 * normal application logs.
 */
import { SpanKind, SpanStatusCode, context, trace } from '@opentelemetry/api';
/**
 * Session state machine states as defined in ARCHITECTURE.md section 3.2
 */
export var SessionState;
(function (SessionState) {
    SessionState["CREATED"] = "created";
    SessionState["WAITING_FOR_CLIENT"] = "waiting_for_client";
    SessionState["CONNECTED"] = "connected";
    SessionState["OBSERVING"] = "observing";
    SessionState["PLANNING"] = "planning";
    SessionState["POLICY_CHECK"] = "policy_check";
    SessionState["WAITING_FOR_APPROVAL"] = "waiting_for_approval";
    SessionState["EXECUTING"] = "executing";
    SessionState["VERIFYING"] = "verifying";
    SessionState["COMPLETED"] = "completed";
    SessionState["FAILED"] = "failed";
    SessionState["CANCELLED"] = "cancelled";
})(SessionState || (SessionState = {}));
/**
 * Action types that Brotto can perform
 */
export var ActionType;
(function (ActionType) {
    ActionType["LEFT_CLICK"] = "left_click";
    ActionType["DOUBLE_CLICK"] = "double_click";
    ActionType["RIGHT_CLICK"] = "right_click";
    ActionType["DRAG"] = "drag";
    ActionType["MOUSE_MOVE"] = "mouse_move";
    ActionType["SCROLL"] = "scroll";
    ActionType["KEY_PRESS"] = "key";
    ActionType["VISIT_URL"] = "visit_url";
    ActionType["HISTORY_BACK"] = "history_back";
    ActionType["SCREENSHOT"] = "screenshot";
    ActionType["WAIT"] = "wait";
    ActionType["ASK_USER_QUESTION"] = "ask_user_question";
    ActionType["TERMINATE"] = "terminate";
    ActionType["PAUSE_AND_MEMORIZE"] = "pause_and_memorize_fact";
    ActionType["KEYBOARD_INSERT_TEXT"] = "keyboard_insert_text";
})(ActionType || (ActionType = {}));
/**
 * Policy decision results
 */
export var PolicyResult;
(function (PolicyResult) {
    PolicyResult["APPROVED"] = "approved";
    PolicyResult["DENIED"] = "denied";
    PolicyResult["APPROVED_WITH_MODIFICATIONS"] = "approved_with_modifications";
    PolicyResult["REQUIRES_APPROVAL"] = "requires_approval";
    PolicyResult["SKIPPED"] = "skipped";
})(PolicyResult || (PolicyResult = {}));
/**
 * Standard span attribute names for Brotto platform
 */
export const FARA_SPAN_ATTRIBUTES = {
    // Service identification
    SERVICE_NAME: 'fara.service.name',
    SERVICE_VERSION: 'fara.service.version',
    // Tenant and session context
    TENANT_ID: 'fara.tenant_id',
    SESSION_ID: 'fara.session_id',
    TASK_ID: 'fara.task_id',
    DEVICE_ID: 'fara.device_id',
    // Session lifecycle
    SESSION_STATE: 'fara.session.state',
    SESSION_CREATOR: 'fara.session.creator',
    SESSION_START_TIME: 'fara.session.start_time',
    SESSION_END_TIME: 'fara.session.end_time',
    SESSION_TERMINATION_REASON: 'fara.session.termination_reason',
    // Model information
    MODEL_VERSION: 'fara.model.version',
    MODEL_NAME: 'fara.model.name',
    PROMPT_TEMPLATE_VERSION: 'fara.prompt_template.version',
    // Action information
    ACTION_TYPE: 'fara.action.type',
    ACTION_PROPOSED: 'fara.action.proposed',
    ACTION_EXECUTED: 'fara.action.executed',
    ACTION_RESULT: 'fara.action.result',
    ACTION_OBSERVATION_ID: 'fara.action.observation_id',
    // Screenshot information
    SCREENSHOT_HASH: 'fara.screenshot.hash',
    SCREENSHOT_WIDTH: 'fara.screenshot.width',
    SCREENSHOT_HEIGHT: 'fara.screenshot.height',
    SCREENSHOT_TIMESTAMP: 'fara.screenshot.timestamp',
    // Policy and approval
    POLICY_RESULT: 'fara.policy.result',
    APPROVAL_DECISION: 'fara.approval.decision',
    APPROVAL_REQUESTED_AT: 'fara.approval.requested_at',
    APPROVAL_DECIDED_AT: 'fara.approval.decided_at',
    // Browser context
    BROWSER_CURRENT_URL: 'fara.browser.current_url',
    BROWSER_CURRENT_DOMAIN: 'fara.browser.current_domain',
    BROWSER_VIEWPORT_WIDTH: 'fara.browser.viewport_width',
    BROWSER_VIEWPORT_HEIGHT: 'fara.browser.viewport_height',
    // Error information
    ERROR_TYPE: 'fara.error.type',
    ERROR_MESSAGE: 'fara.error.message',
    ERROR_STACK: 'fara.error.stack',
    // Retry information
    RETRY_COUNT: 'fara.retry.count',
    MAX_RETRIES: 'fara.retry.max',
};
/**
 * Create a tracer instance for the Brotto platform
 */
export function createFaraTracer(name) {
    return trace.getTracer(name, '0.1.0');
}
/**
 * Get the current span if one exists
 */
export function getCurrentSpan() {
    return trace.getSpan(context.active());
}
/**
 * Check if tracing is currently active
 */
export function isTracing() {
    return trace.getSpan(context.active()) !== undefined;
}
/**
 * Common span kinds used in Brotto platform
 */
export const SPAN_KINDS = {
    SERVER: SpanKind.SERVER,
    CLIENT: SpanKind.CLIENT,
    PRODUCER: SpanKind.PRODUCER,
    CONSUMER: SpanKind.CONSUMER,
    INTERNAL: SpanKind.INTERNAL,
};
/**
 * Common span status codes
 */
export const SPAN_STATUS = {
    OK: { code: SpanStatusCode.OK, message: 'OK' },
    ERROR: { code: SpanStatusCode.ERROR, message: 'Error' },
    UNSET: { code: SpanStatusCode.UNSET, message: 'Unset' },
};
//# sourceMappingURL=traces.js.map