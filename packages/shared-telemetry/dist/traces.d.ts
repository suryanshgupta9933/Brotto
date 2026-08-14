/**
 * Trace and Span types for Brotto Browser Automation Platform
 *
 * Defines standard trace/span attributes for session lifecycle monitoring.
 * Per ARCHITECTURE.md section 8.9, keep sensitive agent traces separate from
 * normal application logs.
 */
import { Span, SpanKind, SpanStatusCode } from '@opentelemetry/api';
/**
 * Session state machine states as defined in ARCHITECTURE.md section 3.2
 */
export declare enum SessionState {
    CREATED = "created",
    WAITING_FOR_CLIENT = "waiting_for_client",
    CONNECTED = "connected",
    OBSERVING = "observing",
    PLANNING = "planning",
    POLICY_CHECK = "policy_check",
    WAITING_FOR_APPROVAL = "waiting_for_approval",
    EXECUTING = "executing",
    VERIFYING = "verifying",
    COMPLETED = "completed",
    FAILED = "failed",
    CANCELLED = "cancelled"
}
/**
 * Action types that Brotto can perform
 */
export declare enum ActionType {
    LEFT_CLICK = "left_click",
    DOUBLE_CLICK = "double_click",
    RIGHT_CLICK = "right_click",
    DRAG = "drag",
    MOUSE_MOVE = "mouse_move",
    SCROLL = "scroll",
    KEY_PRESS = "key",
    VISIT_URL = "visit_url",
    HISTORY_BACK = "history_back",
    SCREENSHOT = "screenshot",
    WAIT = "wait",
    ASK_USER_QUESTION = "ask_user_question",
    TERMINATE = "terminate",
    PAUSE_AND_MEMORIZE = "pause_and_memorize_fact",
    KEYBOARD_INSERT_TEXT = "keyboard_insert_text"
}
/**
 * Policy decision results
 */
export declare enum PolicyResult {
    APPROVED = "approved",
    DENIED = "denied",
    APPROVED_WITH_MODIFICATIONS = "approved_with_modifications",
    REQUIRES_APPROVAL = "requires_approval",
    SKIPPED = "skipped"
}
/**
 * Standard span attribute names for Brotto platform
 */
export declare const FARA_SPAN_ATTRIBUTES: {
    readonly SERVICE_NAME: "fara.service.name";
    readonly SERVICE_VERSION: "fara.service.version";
    readonly TENANT_ID: "fara.tenant_id";
    readonly SESSION_ID: "fara.session_id";
    readonly TASK_ID: "fara.task_id";
    readonly DEVICE_ID: "fara.device_id";
    readonly SESSION_STATE: "fara.session.state";
    readonly SESSION_CREATOR: "fara.session.creator";
    readonly SESSION_START_TIME: "fara.session.start_time";
    readonly SESSION_END_TIME: "fara.session.end_time";
    readonly SESSION_TERMINATION_REASON: "fara.session.termination_reason";
    readonly MODEL_VERSION: "fara.model.version";
    readonly MODEL_NAME: "fara.model.name";
    readonly PROMPT_TEMPLATE_VERSION: "fara.prompt_template.version";
    readonly ACTION_TYPE: "fara.action.type";
    readonly ACTION_PROPOSED: "fara.action.proposed";
    readonly ACTION_EXECUTED: "fara.action.executed";
    readonly ACTION_RESULT: "fara.action.result";
    readonly ACTION_OBSERVATION_ID: "fara.action.observation_id";
    readonly SCREENSHOT_HASH: "fara.screenshot.hash";
    readonly SCREENSHOT_WIDTH: "fara.screenshot.width";
    readonly SCREENSHOT_HEIGHT: "fara.screenshot.height";
    readonly SCREENSHOT_TIMESTAMP: "fara.screenshot.timestamp";
    readonly POLICY_RESULT: "fara.policy.result";
    readonly APPROVAL_DECISION: "fara.approval.decision";
    readonly APPROVAL_REQUESTED_AT: "fara.approval.requested_at";
    readonly APPROVAL_DECIDED_AT: "fara.approval.decided_at";
    readonly BROWSER_CURRENT_URL: "fara.browser.current_url";
    readonly BROWSER_CURRENT_DOMAIN: "fara.browser.current_domain";
    readonly BROWSER_VIEWPORT_WIDTH: "fara.browser.viewport_width";
    readonly BROWSER_VIEWPORT_HEIGHT: "fara.browser.viewport_height";
    readonly ERROR_TYPE: "fara.error.type";
    readonly ERROR_MESSAGE: "fara.error.message";
    readonly ERROR_STACK: "fara.error.stack";
    readonly RETRY_COUNT: "fara.retry.count";
    readonly MAX_RETRIES: "fara.retry.max";
};
/**
 * Audit record fields as specified in ARCHITECTURE.md section 8.9
 */
export interface AuditRecord {
    sessionCreator: string;
    sessionId: string;
    deviceId: string;
    modelVersion: string;
    promptTemplateVersion: string;
    proposedAction: string;
    screenshotHash: string;
    policyResult: PolicyResult;
    approvalDecision: 'approved' | 'denied' | 'stop_session' | null;
    executedAction?: string;
    actionResult?: string;
    error?: string;
    terminationReason?: string;
    timestamp: string;
}
/**
 * Session span data for creating telemetry spans
 */
export interface SessionSpanData {
    sessionId: string;
    tenantId: string;
    sessionCreator: string;
    deviceId: string;
    modelVersion: string;
    promptTemplateVersion: string;
    taskGoal?: string;
}
/**
 * Action span data for creating action telemetry spans
 */
export interface ActionSpanData {
    sessionId: string;
    tenantId: string;
    actionType: ActionType;
    observationId: string;
    proposedAction: string;
    screenshotHash?: string;
    currentUrl?: string;
    currentDomain?: string;
}
/**
 * Policy approval span data
 */
export interface ApprovalSpanData {
    sessionId: string;
    tenantId: string;
    proposedAction: string;
    policyResult: PolicyResult;
    approvalDecision: 'approved' | 'denied' | 'stop_session' | null;
    screenshotHash?: string;
}
/**
 * Create a tracer instance for the Brotto platform
 */
export declare function createFaraTracer(name: string): import("@opentelemetry/api").Tracer;
/**
 * Get the current span if one exists
 */
export declare function getCurrentSpan(): Span | undefined;
/**
 * Check if tracing is currently active
 */
export declare function isTracing(): boolean;
/**
 * Common span kinds used in Brotto platform
 */
export declare const SPAN_KINDS: {
    readonly SERVER: SpanKind.SERVER;
    readonly CLIENT: SpanKind.CLIENT;
    readonly PRODUCER: SpanKind.PRODUCER;
    readonly CONSUMER: SpanKind.CONSUMER;
    readonly INTERNAL: SpanKind.INTERNAL;
};
/**
 * Common span status codes
 */
export declare const SPAN_STATUS: {
    readonly OK: {
        readonly code: SpanStatusCode.OK;
        readonly message: "OK";
    };
    readonly ERROR: {
        readonly code: SpanStatusCode.ERROR;
        readonly message: "Error";
    };
    readonly UNSET: {
        readonly code: SpanStatusCode.UNSET;
        readonly message: "Unset";
    };
};
//# sourceMappingURL=traces.d.ts.map