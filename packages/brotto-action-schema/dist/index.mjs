// src/v1/ids.ts
import { z } from "zod";
var SessionIdSchema = z.string().uuid().brand();
var RunIdSchema = z.string().uuid().brand();
var TaskIdSchema = z.string().uuid().brand();
var StepIdSchema = z.string().uuid().brand();
var ObservationIdSchema = z.string().uuid().brand();
var ActionIdSchema = z.string().uuid().brand();
var PolicyDecisionIdSchema = z.string().uuid().brand();
var EventIdSchema = z.string().uuid().brand();
var MessageIdSchema = z.string().uuid().brand();
var ArtifactIdSchema = z.string().uuid().brand();
var SemanticTargetIdSchema = z.string().uuid().brand();
var TabIdSchema = z.string().uuid().brand();
var FrameIdSchema = z.string().uuid().brand();
var FramePathSegmentIdSchema = z.string().uuid().brand();
var ShadowPathSegmentIdSchema = z.string().uuid().brand();
var ApprovalIdSchema = z.string().uuid().brand();
var SequenceSchema = z.number().int().nonnegative();
var IdempotencyKeySchema = z.string().min(1).max(256);

// src/v1/observation.ts
import { z as z2 } from "zod";
var FORBIDDEN_BROWSER_DATA_KEYS = /* @__PURE__ */ new Set([
  "cookie",
  "cookies",
  "authorization",
  "proxy-authorization",
  "localstorage",
  "sessionstorage",
  "password",
  "credentials",
  "profile"
]);
var normalizedForbiddenKeys = new Set(
  [...FORBIDDEN_BROWSER_DATA_KEYS].map(normalizeBrowserDataKey)
);
var ForbiddenBrowserDataError = class extends Error {
  constructor(keyPath) {
    super(`Forbidden browser data key at ${keyPath}`);
    this.keyPath = keyPath;
    this.name = "ForbiddenBrowserDataError";
  }
};
function normalizeBrowserDataKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function isForbiddenBrowserDataKey(key) {
  const normalized = normalizeBrowserDataKey(key);
  return [...normalizedForbiddenKeys].some((forbidden) => normalized.includes(forbidden));
}
function isHttpUrl(url) {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
function isObservationUrl(url) {
  if (url === "about:blank" || url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("devtools://")) {
    return true;
  }
  return isHttpUrl(url);
}
function assertNoForbiddenBrowserData(value) {
  const visited = /* @__PURE__ */ new Set();
  const visit = (current, path) => {
    if (current === null || typeof current !== "object") return;
    if (visited.has(current)) return;
    visited.add(current);
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, nestedValue] of Object.entries(current)) {
      const keyPath = `${path}.${key}`;
      if (isForbiddenBrowserDataKey(key)) {
        throw new ForbiddenBrowserDataError(keyPath);
      }
      visit(nestedValue, keyPath);
    }
  };
  visit(value, "$");
}
function withForbiddenBrowserDataGuard(schema) {
  return schema.superRefine((value, context) => {
    try {
      assertNoForbiddenBrowserData(value);
    } catch (error) {
      if (error instanceof ForbiddenBrowserDataError) {
        context.addIssue({
          code: z2.ZodIssueCode.custom,
          message: error.message,
          path: error.keyPath.slice(2).split(".").filter(Boolean)
        });
        return;
      }
      throw error;
    }
  });
}
var Sha256Schema = z2.string().regex(/^[a-f0-9]{64}$/i);
var sensitiveSemanticContent = /\b(?:authorization|cookie|credentials?|localstorage|password|passcode|profile|proxy|secret|sessionstorage|token)\b/i;
function isSafeSemanticContent(value) {
  return !sensitiveSemanticContent.test(value);
}
var SafeSemanticTextSchema = z2.string().min(1).max(512).refine(
  isSafeSemanticContent,
  "Semantic content may not include sensitive browser data"
);
var SafeSemanticAttributesSchema = z2.object({
  "aria-label": SafeSemanticTextSchema.optional(),
  "aria-describedby": SafeSemanticTextSchema.optional(),
  "aria-controls": SafeSemanticTextSchema.optional(),
  "aria-expanded": z2.enum(["true", "false"]).optional(),
  "aria-haspopup": z2.enum(["true", "false", "menu", "listbox", "tree", "grid", "dialog"]).optional(),
  "aria-current": z2.enum(["true", "false", "page", "step", "location", "date", "time"]).optional(),
  "aria-pressed": z2.enum(["true", "false", "mixed"]).optional(),
  "aria-selected": z2.enum(["true", "false"]).optional()
}).strict();
var SanitizedAccessibleNameSchema = z2.object({
  source: z2.enum(["aria-label", "aria-labelledby", "visible_text"]),
  text: SafeSemanticTextSchema
}).strict();
var LocatorCandidateV1Schema = z2.discriminatedUnion("kind", [
  z2.object({
    kind: z2.literal("role_name"),
    role: SafeSemanticTextSchema,
    name: SanitizedAccessibleNameSchema
  }).strict(),
  z2.object({
    kind: z2.literal("label"),
    label: SanitizedAccessibleNameSchema
  }).strict(),
  z2.object({
    kind: z2.literal("test_id"),
    testId: SafeSemanticTextSchema
  }).strict(),
  z2.object({
    kind: z2.literal("safe_attribute"),
    attribute: z2.enum(["aria-label", "aria-describedby", "aria-controls", "aria-current"]),
    value: SafeSemanticTextSchema
  }).strict()
]);
var ControlMetadataSchema = z2.discriminatedUnion("kind", [
  z2.object({ kind: z2.literal("non_input") }).strict(),
  z2.object({
    kind: z2.literal("input"),
    inputType: z2.enum(["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"])
  }).strict()
]);
var ScreenshotSchema = withForbiddenBrowserDataGuard(z2.discriminatedUnion("kind", [
  z2.object({
    kind: z2.literal("inline"),
    encoding: z2.enum(["base64", "png", "jpeg", "webp"]),
    // ponytail: data may be empty when the extension captured a chrome://
    // page or other restricted URL that captureVisibleTab refuses to render.
    // width/height default to zero so downstream consumers can detect
    // "no screenshot available" and render a placeholder.
    data: z2.string().max(1e7),
    sha256: Sha256Schema,
    width: z2.number().int().nonnegative(),
    height: z2.number().int().nonnegative()
  }).strict(),
  z2.object({
    kind: z2.literal("artifact"),
    artifactId: ArtifactIdSchema,
    sha256: Sha256Schema,
    width: z2.number().int().positive(),
    height: z2.number().int().positive(),
    encoding: z2.enum(["png", "jpeg", "webp"])
  }).strict()
]));
var ViewportSchema = z2.object({
  width: z2.number().int().positive(),
  height: z2.number().int().positive(),
  devicePixelRatio: z2.number().positive().max(8),
  zoom: z2.number().positive().max(8),
  scrollX: z2.number().finite(),
  scrollY: z2.number().finite()
}).strict();
var PageStateSchema = z2.object({
  tabId: TabIdSchema,
  frameId: FrameIdSchema,
  lifecycle: z2.enum(["loading", "interactive", "complete", "frozen"]),
  visibility: z2.enum(["visible", "hidden", "prerender"])
}).strict();
var BoundingBoxSchema = z2.object({
  x: z2.number().finite(),
  y: z2.number().finite(),
  width: z2.number().positive(),
  height: z2.number().positive()
}).strict();
var SemanticTargetSchema = withForbiddenBrowserDataGuard(z2.object({
  targetId: SemanticTargetIdSchema,
  stableRef: z2.string().regex(/^[a-f0-9]{16}$/i).optional(),
  tag: z2.string().min(1).max(64),
  role: z2.string().min(1).max(128).optional(),
  accessibleName: SanitizedAccessibleNameSchema.optional(),
  attributes: SafeSemanticAttributesSchema.optional(),
  control: ControlMetadataSchema,
  boundingBox: BoundingBoxSchema,
  visible: z2.boolean(),
  framePath: z2.array(FramePathSegmentIdSchema).max(20),
  shadowPath: z2.array(ShadowPathSegmentIdSchema).max(20).optional(),
  locatorCandidates: z2.array(LocatorCandidateV1Schema).max(10)
}).strict()).superRefine((target, context) => {
  if (target.tag.toLowerCase() === "input" && target.control.kind !== "input") {
    context.addIssue({ code: z2.ZodIssueCode.custom, path: ["control"], message: "Input targets require input control metadata" });
  }
});
var AXTupleSchema = z2.object({
  role: z2.string(),
  index: z2.number().int().nonnegative(),
  name: z2.string().optional()
});
var AccessibilityNodeSchema = z2.object({
  axNodeId: z2.string(),
  role: z2.string(),
  name: z2.string().optional(),
  description: z2.string().optional(),
  value: z2.string().optional(),
  attributes: z2.record(z2.string(), z2.string()).optional(),
  bounds: BoundingBoxSchema.optional(),
  axPath: z2.array(AXTupleSchema),
  attributeHash: Sha256Schema
});
var ObservationV1Schema = withForbiddenBrowserDataGuard(z2.object({
  observationId: ObservationIdSchema,
  capturedAt: z2.string().datetime(),
  url: z2.string().refine(isObservationUrl, "Observation URL must be HTTP(S) or an internal page (about:blank, chrome://)"),
  title: z2.string().max(512),
  screenshot: ScreenshotSchema,
  viewport: ViewportSchema,
  page: PageStateSchema,
  semanticTargets: z2.array(SemanticTargetSchema).max(200),
  accessibilityNodes: z2.array(AccessibilityNodeSchema).optional()
}).strict());

// src/v1/actions.ts
import { z as z3 } from "zod";
function guardedStrictObject(schema) {
  return schema.superRefine((value, context) => {
    try {
      assertNoForbiddenBrowserData(value);
    } catch (error) {
      if (error instanceof ForbiddenBrowserDataError) {
        context.addIssue({ code: z3.ZodIssueCode.custom, message: error.message });
        return;
      }
      throw error;
    }
  });
}
var CoordinateSchema = z3.number().int().nonnegative();
var KeyModifiersSchema = z3.object({
  ctrl: z3.boolean().optional(),
  shift: z3.boolean().optional(),
  alt: z3.boolean().optional(),
  meta: z3.boolean().optional()
}).strict();
var ExecutableActionV1Schema = z3.discriminatedUnion("type", [
  z3.object({ type: z3.literal("left_click"), x: CoordinateSchema, y: CoordinateSchema, targetId: SemanticTargetIdSchema.optional() }).strict(),
  z3.object({ type: z3.literal("double_click"), x: CoordinateSchema, y: CoordinateSchema, targetId: SemanticTargetIdSchema.optional() }).strict(),
  z3.object({ type: z3.literal("right_click"), x: CoordinateSchema, y: CoordinateSchema, targetId: SemanticTargetIdSchema.optional() }).strict(),
  z3.object({ type: z3.literal("drag"), startX: CoordinateSchema, startY: CoordinateSchema, endX: CoordinateSchema, endY: CoordinateSchema }).strict(),
  z3.object({ type: z3.literal("mouse_move"), x: CoordinateSchema, y: CoordinateSchema }).strict(),
  z3.object({ type: z3.literal("scroll"), deltaX: z3.number().int(), deltaY: z3.number().int() }).strict(),
  z3.object({ type: z3.literal("key"), key: z3.string().min(1).max(128), modifiers: KeyModifiersSchema.optional() }).strict(),
  z3.object({ type: z3.literal("insert_text"), text: z3.string().min(1).max(1e4), targetId: SemanticTargetIdSchema.optional() }).strict(),
  z3.object({ type: z3.literal("visit_url"), url: z3.string().url().refine(isHttpUrl, "Only HTTP(S) navigation URLs are allowed") }).strict(),
  z3.object({ type: z3.literal("history_back"), steps: z3.number().int().positive().max(20).default(1) }).strict(),
  z3.object({ type: z3.literal("wait"), durationMs: z3.number().int().positive().max(6e4) }).strict(),
  z3.object({ type: z3.literal("ask_user_question"), question: z3.string().min(1).max(2e3), choices: z3.array(z3.string().min(1).max(256)).max(20).optional() }).strict(),
  z3.object({ type: z3.literal("memorize_fact"), fact: z3.string().min(1).max(2e3), category: z3.string().min(1).max(128).optional() }).strict()
]);
var ActionProposalV1Schema = guardedStrictObject(z3.object({
  kind: z3.literal("action"),
  observationId: ObservationIdSchema,
  proposedAt: z3.string().datetime(),
  action: ExecutableActionV1Schema
}).strict());
var CompletionFindingV1Schema = z3.object({
  fact: z3.string().min(1).max(2e3),
  observationIds: z3.array(ObservationIdSchema).min(1).max(20)
}).strict();
var CompletionProposalV1Schema = guardedStrictObject(z3.object({
  kind: z3.literal("completion"),
  observationId: ObservationIdSchema,
  type: z3.literal("terminate"),
  status: z3.enum(["succeeded", "partial", "failed"]),
  summary: z3.string().min(1).max(4e3),
  findings: z3.array(CompletionFindingV1Schema).max(100),
  unmetCriteria: z3.array(z3.string().min(1).max(1e3)).max(100),
  confidence: z3.number().min(0).max(1)
}).strict()).superRefine((value, context) => {
  if (value.status === "succeeded" && value.findings.length === 0) {
    context.addIssue({
      code: z3.ZodIssueCode.custom,
      path: ["findings"],
      message: "Successful completion requires findings with observation evidence"
    });
  }
});
var AgentProposalV1Schema = z3.union([
  ActionProposalV1Schema,
  CompletionProposalV1Schema
]);
var PolicyContextV1Schema = z3.object({
  policyDecisionId: PolicyDecisionIdSchema,
  policyVersion: z3.string().min(1).max(128),
  approved: z3.boolean(),
  approvalId: ApprovalIdSchema.optional()
}).strict();
var PolicyDecisionV1Schema = guardedStrictObject(z3.object({
  policyDecisionId: PolicyDecisionIdSchema,
  actionId: ActionIdSchema,
  observationId: ObservationIdSchema,
  decision: z3.enum(["allowed", "denied", "approval_required"]),
  decidedAt: z3.string().datetime()
}).strict());
var ApprovalResolutionV1Schema = guardedStrictObject(z3.object({
  approvalId: ApprovalIdSchema,
  policyDecisionId: PolicyDecisionIdSchema,
  actionId: ActionIdSchema,
  status: z3.enum(["approved", "denied"]),
  resolvedAt: z3.string().datetime()
}).strict());
var ActionCommandV1Schema = guardedStrictObject(z3.object({
  actionId: ActionIdSchema,
  stepId: StepIdSchema,
  observationId: ObservationIdSchema,
  sequence: SequenceSchema,
  action: ExecutableActionV1Schema,
  policyContext: PolicyContextV1Schema,
  dispatchedAt: z3.string().datetime(),
  expiresAt: z3.string().datetime(),
  idempotencyKey: IdempotencyKeySchema
}).strict());

// src/v1/results.ts
import { z as z4 } from "zod";
var ActionResultStatusV1Schema = z4.enum([
  "succeeded",
  "failed_recoverable",
  "failed_terminal",
  "rejected_stale",
  "rejected_policy",
  "approval_required",
  "cancelled"
]);
var ActionErrorV1Schema = z4.object({
  code: z4.string().min(1).max(128),
  message: z4.string().min(1).max(2e3),
  retryable: z4.boolean()
}).strict();
var NavigationEffectV1Schema = z4.object({
  url: z4.string().url().refine(isHttpUrl, "Only HTTP(S) URLs are allowed"),
  title: z4.string().max(512).optional()
}).strict();
var DialogEffectV1Schema = z4.object({
  kind: z4.enum(["alert", "confirm", "prompt", "beforeunload"]),
  present: z4.boolean()
}).strict();
var ActionResultBaseV1Schema = z4.object({
  actionId: ActionIdSchema,
  stepId: StepIdSchema,
  observationId: ObservationIdSchema,
  sequence: SequenceSchema,
  startedAt: z4.string().datetime(),
  completedAt: z4.string().datetime(),
  durationMs: z4.number().int().nonnegative(),
  target: SemanticTargetSchema.optional(),
  navigation: NavigationEffectV1Schema.optional(),
  dialog: DialogEffectV1Schema.optional()
});
var SucceededActionResultV1Schema = ActionResultBaseV1Schema.extend({
  status: z4.literal("succeeded"),
  postObservation: ObservationV1Schema
}).strict();
var FailedActionResultV1Schema = ActionResultBaseV1Schema.extend({
  status: z4.enum(["failed_recoverable", "failed_terminal"]),
  error: ActionErrorV1Schema,
  postObservation: ObservationV1Schema
}).strict();
var RejectedActionResultV1Schema = ActionResultBaseV1Schema.extend({
  status: z4.enum(["rejected_stale", "rejected_policy", "approval_required"]),
  rejection: ActionErrorV1Schema
}).strict();
var CancelledActionResultV1Schema = ActionResultBaseV1Schema.extend({
  status: z4.literal("cancelled"),
  cancellation: z4.object({ reason: z4.string().min(1).max(2e3).optional() }).strict(),
  postObservation: ObservationV1Schema
}).strict();
var ActionResultV1Schema = z4.union([
  SucceededActionResultV1Schema,
  FailedActionResultV1Schema,
  RejectedActionResultV1Schema,
  CancelledActionResultV1Schema
]).superRefine((value, context) => {
  try {
    assertNoForbiddenBrowserData(value);
  } catch (error) {
    if (error instanceof ForbiddenBrowserDataError) {
      context.addIssue({ code: z4.ZodIssueCode.custom, message: error.message });
      return;
    }
    throw error;
  }
});

// src/v1/events.ts
import { z as z5 } from "zod";
var TrajectoryEventKindV1Schema = z5.enum([
  "session_lifecycle",
  "observation_captured",
  "model_request",
  "model_response",
  "model_parse_failure",
  "action_proposed",
  "policy_decided",
  "approval_requested",
  "approval_resolved",
  "action_dispatched",
  "action_acknowledged",
  "action_completed",
  "verification_result",
  "task_terminal_outcome"
]);
var TrajectoryEventV1Schema = z5.object({
  eventId: EventIdSchema,
  sessionId: SessionIdSchema,
  taskId: TaskIdSchema,
  stepId: StepIdSchema.optional(),
  actionId: ActionIdSchema.optional(),
  observationId: ObservationIdSchema.optional(),
  correlationId: z5.string().uuid().optional(),
  causationId: EventIdSchema.optional(),
  sequence: SequenceSchema,
  occurredAt: z5.string().datetime(),
  kind: TrajectoryEventKindV1Schema,
  summary: z5.string().max(2e3).optional()
}).strict().superRefine((value, context) => {
  try {
    assertNoForbiddenBrowserData(value);
  } catch (error) {
    if (error instanceof ForbiddenBrowserDataError) {
      context.addIssue({ code: z5.ZodIssueCode.custom, message: error.message });
      return;
    }
    throw error;
  }
});
var TrajectoryLinkageV1Schema = z5.object({
  sourceObservation: ObservationV1Schema,
  proposal: ActionProposalV1Schema,
  command: ActionCommandV1Schema,
  policyDecision: PolicyDecisionV1Schema,
  approvalResolution: ApprovalResolutionV1Schema.optional(),
  result: ActionResultV1Schema
}).strict().superRefine((value, context) => {
  const { approvalResolution, command, policyDecision, proposal, result, sourceObservation } = value;
  if (sourceObservation.observationId !== proposal.observationId || proposal.observationId !== command.observationId) {
    context.addIssue({ code: z5.ZodIssueCode.custom, path: ["command", "observationId"], message: "Command must reference the proposal observation" });
  }
  if (JSON.stringify(proposal.action) !== JSON.stringify(command.action)) {
    context.addIssue({ code: z5.ZodIssueCode.custom, path: ["command", "action"], message: "Command action must match the proposal action" });
  }
  if (policyDecision.policyDecisionId !== command.policyContext.policyDecisionId) {
    context.addIssue({ code: z5.ZodIssueCode.custom, path: ["policyDecision", "policyDecisionId"], message: "Policy decision must match the command policy context" });
  }
  if (policyDecision.actionId !== command.actionId || policyDecision.observationId !== command.observationId) {
    context.addIssue({ code: z5.ZodIssueCode.custom, path: ["policyDecision"], message: "Policy decision must reference the command action and observation" });
  }
  const hasApprovalProof = command.policyContext.approved && command.policyContext.approvalId !== void 0;
  if (policyDecision.decision === "allowed" && ["rejected_policy", "approval_required"].includes(result.status)) {
    context.addIssue({ code: z5.ZodIssueCode.custom, path: ["result", "status"], message: "Allowed policy decisions cannot produce policy rejection or approval-required results" });
  }
  if (policyDecision.decision === "denied" && result.status !== "rejected_policy") {
    context.addIssue({ code: z5.ZodIssueCode.custom, path: ["result", "status"], message: "Denied policy decisions require a rejected_policy result" });
  }
  if (policyDecision.decision === "approval_required" && !hasApprovalProof && result.status !== "approval_required") {
    context.addIssue({ code: z5.ZodIssueCode.custom, path: ["result", "status"], message: "Unproven approval-required decisions require an approval_required result" });
  }
  if (policyDecision.decision === "approval_required" && hasApprovalProof && ["rejected_policy", "approval_required"].includes(result.status)) {
    context.addIssue({ code: z5.ZodIssueCode.custom, path: ["result", "status"], message: "Approved decisions cannot produce policy rejection or approval-required results" });
  }
  if (policyDecision.decision === "approval_required" && hasApprovalProof) {
    if (approvalResolution === void 0 || approvalResolution.status !== "approved" || approvalResolution.approvalId !== command.policyContext.approvalId || approvalResolution.policyDecisionId !== policyDecision.policyDecisionId || approvalResolution.actionId !== command.actionId) {
      context.addIssue({ code: z5.ZodIssueCode.custom, path: ["approvalResolution"], message: "Approval-required execution needs a matching approved resolution" });
    }
  }
  if (result.actionId !== command.actionId || result.stepId !== command.stepId || result.observationId !== command.observationId || result.sequence <= command.sequence) {
    context.addIssue({ code: z5.ZodIssueCode.custom, path: ["result"], message: "Result must follow the command and preserve its identifiers" });
  }
  const sourceCapturedAt = Date.parse(sourceObservation.capturedAt);
  const proposedAt = Date.parse(proposal.proposedAt);
  const decidedAt = Date.parse(policyDecision.decidedAt);
  const dispatchedAt = Date.parse(command.dispatchedAt);
  const startedAt = Date.parse(result.startedAt);
  const completedAt = Date.parse(result.completedAt);
  const resolvedAt = approvalResolution === void 0 ? void 0 : Date.parse(approvalResolution.resolvedAt);
  if (!(sourceCapturedAt <= proposedAt && proposedAt <= decidedAt && decidedAt <= dispatchedAt && dispatchedAt <= startedAt && startedAt <= completedAt && sourceCapturedAt < dispatchedAt && proposedAt < dispatchedAt)) {
    context.addIssue({ code: z5.ZodIssueCode.custom, path: ["result", "startedAt"], message: "Observation, proposal, policy, dispatch, and execution timestamps must be chronological" });
  }
  if (hasApprovalProof && resolvedAt === void 0 || resolvedAt !== void 0 && !(decidedAt < resolvedAt && resolvedAt < dispatchedAt)) {
    context.addIssue({ code: z5.ZodIssueCode.custom, path: ["approvalResolution", "resolvedAt"], message: "Approval resolution must occur after policy decision and before dispatch" });
  }
  if (result.status === "succeeded" || result.status === "failed_recoverable" || result.status === "failed_terminal" || result.status === "cancelled") {
    if (result.postObservation.observationId === command.observationId) {
      context.addIssue({ code: z5.ZodIssueCode.custom, path: ["result", "postObservation", "observationId"], message: "Executed action requires a distinct post-observation" });
    }
    if (Date.parse(result.postObservation.capturedAt) <= completedAt) {
      context.addIssue({ code: z5.ZodIssueCode.custom, path: ["result", "postObservation", "capturedAt"], message: "Executed action post-observation must be captured after completion" });
    }
  }
});

// src/actions.ts
var ActionType = /* @__PURE__ */ ((ActionType2) => {
  ActionType2["LEFT_CLICK"] = "left_click";
  ActionType2["DOUBLE_CLICK"] = "double_click";
  ActionType2["RIGHT_CLICK"] = "right_click";
  ActionType2["DRAG"] = "drag";
  ActionType2["MOUSE_MOVE"] = "mouse_move";
  ActionType2["SCROLL"] = "scroll";
  ActionType2["KEY"] = "key";
  ActionType2["INSERT_TEXT"] = "insert_text";
  ActionType2["VISIT_URL"] = "visit_url";
  ActionType2["HISTORY_BACK"] = "history_back";
  ActionType2["SCREENSHOT"] = "screenshot";
  ActionType2["WAIT"] = "wait";
  ActionType2["ASK_USER_QUESTION"] = "ask_user_question";
  ActionType2["TERMINATE"] = "terminate";
  ActionType2["PAUSE_AND_MEMORIZE_FACT"] = "pause_and_memorize_fact";
  ActionType2["MEMORIZE_FACT"] = "memorize_fact";
  return ActionType2;
})(ActionType || {});
function isViewportAction(action) {
  return [
    "left_click" /* LEFT_CLICK */,
    "double_click" /* DOUBLE_CLICK */,
    "right_click" /* RIGHT_CLICK */,
    "drag" /* DRAG */,
    "mouse_move" /* MOUSE_MOVE */,
    "scroll" /* SCROLL */
  ].includes(action.type);
}
function isNavigationAction(action) {
  return ["visit_url" /* VISIT_URL */, "history_back" /* HISTORY_BACK */].includes(action.type);
}

// src/coordinates.ts
function createDefaultViewport() {
  return { width: 1280, height: 720 };
}
function createDefaultViewportConfig() {
  return {
    width: 1280,
    height: 720,
    devicePixelRatio: 1
  };
}

// src/observation.ts
function createObservationId(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid observation ID: ${value}. Must be a non-negative integer.`);
  }
  return { value };
}
function compareObservationIds(a, b) {
  return a.value - b.value;
}
function isValidObservationId(value) {
  return Number.isInteger(value) && value >= 0;
}
function getNextObservationId(current) {
  return createObservationId(current.value + 1);
}
var ObservationIdCounter = class {
  /**
   * Creates a new counter starting at 0 (or a given initial value).
   */
  constructor(initialValue = 0) {
    if (!isValidObservationId(initialValue)) {
      throw new Error(`Invalid initial observation ID: ${initialValue}`);
    }
    this.currentValue = initialValue;
  }
  /**
   * Returns the next observation ID and increments the counter.
   */
  next() {
    const id = createObservationId(this.currentValue);
    this.currentValue++;
    return id;
  }
  /**
   * Returns the current ID without incrementing.
   */
  peek() {
    return createObservationId(this.currentValue);
  }
  /**
   * Resets the counter to a specific value.
   */
  reset(value = 0) {
    if (!isValidObservationId(value)) {
      throw new Error(`Invalid reset value: ${value}`);
    }
    this.currentValue = value;
  }
  /**
   * Returns the current raw value.
   */
  getCurrentValue() {
    return this.currentValue;
  }
};

// src/results.ts
var ActionErrorCode = /* @__PURE__ */ ((ActionErrorCode2) => {
  ActionErrorCode2["TIMEOUT"] = "timeout";
  ActionErrorCode2["ELEMENT_NOT_FOUND"] = "element_not_found";
  ActionErrorCode2["INVALID_COORDINATES"] = "invalid_coordinates";
  ActionErrorCode2["INVALID_URL"] = "invalid_url";
  ActionErrorCode2["NAVIGATION_FAILED"] = "navigation_failed";
  ActionErrorCode2["PERMISSION_DENIED"] = "permission_denied";
  ActionErrorCode2["CANCELLED"] = "cancelled";
  ActionErrorCode2["NOT_SUPPORTED"] = "not_supported";
  ActionErrorCode2["UNKNOWN"] = "unknown";
  return ActionErrorCode2;
})(ActionErrorCode || {});
function createActionSuccess(actionType, data) {
  return {
    actionType,
    success: true,
    timestamp: Date.now(),
    data
  };
}
function createActionFailure(actionType, errorCode, message, details) {
  return {
    actionType,
    success: false,
    timestamp: Date.now(),
    error: {
      code: errorCode,
      message,
      details
    }
  };
}

// src/mcp-mapping.ts
var McpToolName = /* @__PURE__ */ ((McpToolName2) => {
  McpToolName2["BROWSER_MOUSE_CLICK_XY"] = "browser_mouse_click_xy";
  McpToolName2["BROWSER_MOUSE_DRAG_XY"] = "browser_mouse_drag_xy";
  McpToolName2["BROWSER_MOUSE_MOVE_XY"] = "browser_mouse_move_xy";
  McpToolName2["BROWSER_MOUSE_WHEEL"] = "browser_mouse_wheel";
  McpToolName2["BROWSER_PRESS_KEY"] = "browser_press_key";
  McpToolName2["BROWSER_NAVIGATE"] = "browser_navigate";
  McpToolName2["BROWSER_NAVIGATE_BACK"] = "browser_navigate_back";
  McpToolName2["BROWSER_TAKE_SCREENSHOT"] = "browser_take_screenshot";
  return McpToolName2;
})(McpToolName || {});
var FARA_ACTION_TO_MCP_TOOL = {
  ["left_click" /* LEFT_CLICK */]: "browser_mouse_click_xy" /* BROWSER_MOUSE_CLICK_XY */,
  ["double_click" /* DOUBLE_CLICK */]: "browser_mouse_click_xy" /* BROWSER_MOUSE_CLICK_XY */,
  ["right_click" /* RIGHT_CLICK */]: "browser_mouse_click_xy" /* BROWSER_MOUSE_CLICK_XY */,
  ["drag" /* DRAG */]: "browser_mouse_drag_xy" /* BROWSER_MOUSE_DRAG_XY */,
  ["mouse_move" /* MOUSE_MOVE */]: "browser_mouse_move_xy" /* BROWSER_MOUSE_MOVE_XY */,
  ["scroll" /* SCROLL */]: "browser_mouse_wheel" /* BROWSER_MOUSE_WHEEL */,
  ["key" /* KEY */]: "browser_press_key" /* BROWSER_PRESS_KEY */,
  ["insert_text" /* INSERT_TEXT */]: null,
  // Handled by client via keyboard.type
  ["visit_url" /* VISIT_URL */]: "browser_navigate" /* BROWSER_NAVIGATE */,
  ["history_back" /* HISTORY_BACK */]: "browser_navigate_back" /* BROWSER_NAVIGATE_BACK */,
  ["screenshot" /* SCREENSHOT */]: "browser_take_screenshot" /* BROWSER_TAKE_SCREENSHOT */,
  ["wait" /* WAIT */]: null,
  // Handled by bounded orchestrator timer
  ["ask_user_question" /* ASK_USER_QUESTION */]: null,
  // Control-plane approval request
  ["terminate" /* TERMINATE */]: null,
  // Orchestrator session completion
  ["pause_and_memorize_fact" /* PAUSE_AND_MEMORIZE_FACT */]: null,
  // Server-side session memory
  ["memorize_fact" /* MEMORIZE_FACT */]: null
  // Server-side session memory
};
function mapActionToMcpParams(action) {
  switch (action.type) {
    case "left_click" /* LEFT_CLICK */:
      return {
        x: action.coordinates.x,
        y: action.coordinates.y,
        button: "left",
        clickCount: 1
      };
    case "double_click" /* DOUBLE_CLICK */:
      return {
        x: action.coordinates.x,
        y: action.coordinates.y,
        button: "left",
        clickCount: 2
      };
    case "right_click" /* RIGHT_CLICK */:
      return {
        x: action.coordinates.x,
        y: action.coordinates.y,
        button: "right",
        clickCount: 1
      };
    case "drag" /* DRAG */:
      return {
        startX: action.coordinates.start.x,
        startY: action.coordinates.start.y,
        endX: action.coordinates.end.x,
        endY: action.coordinates.end.y
      };
    case "mouse_move" /* MOUSE_MOVE */:
      return {
        x: action.coordinates.x,
        y: action.coordinates.y
      };
    case "scroll" /* SCROLL */:
      return {
        x: action.coordinates.x,
        y: action.coordinates.y,
        deltaX: action.delta.deltaX,
        deltaY: action.delta.deltaY
      };
    case "key" /* KEY */:
      return {
        key: action.key,
        modifiers: action.modifiers
      };
    case "visit_url" /* VISIT_URL */:
      return {
        url: action.url,
        timeout: action.timeout
      };
    case "history_back" /* HISTORY_BACK */:
      return {
        steps: action.steps
      };
    case "screenshot" /* SCREENSHOT */:
      return {
        fullPage: action.fullPage
      };
    default:
      return null;
  }
}
function isMcpAction(actionType) {
  return FARA_ACTION_TO_MCP_TOOL[actionType] !== null;
}
function getMcpToolName(actionType) {
  return FARA_ACTION_TO_MCP_TOOL[actionType];
}
var ActionExecutionType = /* @__PURE__ */ ((ActionExecutionType2) => {
  ActionExecutionType2["MCP_TOOL"] = "mcp_tool";
  ActionExecutionType2["ORCHESTRATOR_TIMER"] = "orchestrator_timer";
  ActionExecutionType2["CONTROL_PLANE_APPROVAL"] = "control_plane_approval";
  ActionExecutionType2["SESSION_COMPLETION"] = "session_completion";
  ActionExecutionType2["SESSION_MEMORY"] = "session_memory";
  return ActionExecutionType2;
})(ActionExecutionType || {});
function getActionExecutionType(actionType) {
  switch (actionType) {
    case "wait" /* WAIT */:
      return "orchestrator_timer" /* ORCHESTRATOR_TIMER */;
    case "ask_user_question" /* ASK_USER_QUESTION */:
      return "control_plane_approval" /* CONTROL_PLANE_APPROVAL */;
    case "terminate" /* TERMINATE */:
      return "session_completion" /* SESSION_COMPLETION */;
    case "pause_and_memorize_fact" /* PAUSE_AND_MEMORIZE_FACT */:
      return "session_memory" /* SESSION_MEMORY */;
    default:
      return "mcp_tool" /* MCP_TOOL */;
  }
}

// src/validation.ts
import { z as z6 } from "zod";
var CoordinatesSchema = z6.object({
  x: z6.number().int().min(0),
  y: z6.number().int().min(0)
});
var DragCoordinatesSchema = z6.object({
  start: CoordinatesSchema,
  end: CoordinatesSchema
});
var ScrollDeltaSchema = z6.object({
  deltaX: z6.number().int(),
  deltaY: z6.number().int()
});
var ViewportContextSchema = z6.object({
  viewportWidth: z6.number().int().positive(),
  viewportHeight: z6.number().int().positive()
});
var KeyModifiersSchema2 = z6.object({
  ctrl: z6.boolean().optional(),
  shift: z6.boolean().optional(),
  alt: z6.boolean().optional(),
  meta: z6.boolean().optional()
});
var BaseActionArgsSchema = z6.object({
  id: z6.string().min(1),
  observationId: z6.number().int().min(0),
  timestamp: z6.number().int().positive(),
  // ponytail: optional in the schema so older payloads still parse. The model
  // is told to always provide it; the parser falls back to "" when missing.
  reasoning: z6.string().optional()
});
var LeftClickArgsSchema = BaseActionArgsSchema.extend({
  type: z6.literal("left_click" /* LEFT_CLICK */),
  coordinates: CoordinatesSchema,
  viewport: ViewportContextSchema
});
var DoubleClickArgsSchema = BaseActionArgsSchema.extend({
  type: z6.literal("double_click" /* DOUBLE_CLICK */),
  coordinates: CoordinatesSchema,
  viewport: ViewportContextSchema
});
var RightClickArgsSchema = BaseActionArgsSchema.extend({
  type: z6.literal("right_click" /* RIGHT_CLICK */),
  coordinates: CoordinatesSchema,
  viewport: ViewportContextSchema
});
var DragArgsSchema = BaseActionArgsSchema.extend({
  type: z6.literal("drag" /* DRAG */),
  coordinates: DragCoordinatesSchema,
  viewport: ViewportContextSchema
});
var MouseMoveArgsSchema = BaseActionArgsSchema.extend({
  type: z6.literal("mouse_move" /* MOUSE_MOVE */),
  coordinates: CoordinatesSchema,
  viewport: ViewportContextSchema
});
var ScrollArgsSchema = BaseActionArgsSchema.extend({
  type: z6.literal("scroll" /* SCROLL */),
  coordinates: CoordinatesSchema,
  delta: ScrollDeltaSchema,
  viewport: ViewportContextSchema
});
var KeyArgsSchema = BaseActionArgsSchema.extend({
  type: z6.literal("key" /* KEY */),
  key: z6.string().min(1),
  modifiers: KeyModifiersSchema2.optional()
});
var VisitUrlArgsSchema = BaseActionArgsSchema.extend({
  type: z6.literal("visit_url" /* VISIT_URL */),
  url: z6.string().url(),
  timeout: z6.number().int().positive().optional()
});
var HistoryBackArgsSchema = BaseActionArgsSchema.extend({
  type: z6.literal("history_back" /* HISTORY_BACK */),
  steps: z6.number().int().positive().optional()
});
var ScreenshotArgsSchema = BaseActionArgsSchema.extend({
  type: z6.literal("screenshot" /* SCREENSHOT */),
  fullPage: z6.boolean().optional()
});
var WaitArgsSchema = BaseActionArgsSchema.extend({
  type: z6.literal("wait" /* WAIT */),
  durationMs: z6.number().int().positive()
});
var AskUserQuestionArgsSchema = BaseActionArgsSchema.extend({
  type: z6.literal("ask_user_question" /* ASK_USER_QUESTION */),
  question: z6.string().min(1),
  context: z6.string().optional(),
  choices: z6.array(z6.string()).optional()
});
var TerminateArgsSchema = BaseActionArgsSchema.extend({
  type: z6.literal("terminate" /* TERMINATE */),
  finalAnswer: z6.string().optional()
});
var PauseAndMemorizeFactArgsSchema = BaseActionArgsSchema.extend({
  type: z6.literal("pause_and_memorize_fact" /* PAUSE_AND_MEMORIZE_FACT */),
  fact: z6.string().min(1),
  category: z6.string().optional()
});
var InsertTextArgsSchema = BaseActionArgsSchema.extend({
  type: z6.literal("insert_text" /* INSERT_TEXT */),
  text: z6.string().min(1),
  targetId: z6.string().optional()
});
var MemorizeFactArgsSchema = BaseActionArgsSchema.extend({
  type: z6.literal("memorize_fact" /* MEMORIZE_FACT */),
  fact: z6.string().min(1),
  category: z6.string().optional()
});
var FaraActionArgsSchema = z6.union([
  LeftClickArgsSchema,
  DoubleClickArgsSchema,
  RightClickArgsSchema,
  DragArgsSchema,
  MouseMoveArgsSchema,
  ScrollArgsSchema,
  KeyArgsSchema,
  InsertTextArgsSchema,
  VisitUrlArgsSchema,
  HistoryBackArgsSchema,
  ScreenshotArgsSchema,
  WaitArgsSchema,
  AskUserQuestionArgsSchema,
  TerminateArgsSchema,
  PauseAndMemorizeFactArgsSchema,
  MemorizeFactArgsSchema
]);
function validateActionArgs(args) {
  return FaraActionArgsSchema.parse(args);
}
function tryValidateActionArgs(args) {
  return FaraActionArgsSchema.safeParse(args).success ? FaraActionArgsSchema.parse(args) : null;
}
function validateCoordinatesInBounds(x, y, viewportWidth, viewportHeight) {
  return x >= 0 && x < viewportWidth && y >= 0 && y < viewportHeight;
}
function assertCoordinatesInBounds(x, y, viewportWidth, viewportHeight) {
  if (!validateCoordinatesInBounds(x, y, viewportWidth, viewportHeight)) {
    throw new Error(
      `Coordinates (${x}, ${y}) are out of bounds for viewport ${viewportWidth}x${viewportHeight}`
    );
  }
}
export {
  AXTupleSchema,
  AccessibilityNodeSchema,
  ActionCommandV1Schema,
  ActionErrorCode,
  ActionErrorV1Schema,
  ActionExecutionType,
  ActionIdSchema,
  ActionProposalV1Schema,
  ActionResultStatusV1Schema,
  ActionResultV1Schema,
  ActionType,
  AgentProposalV1Schema,
  ApprovalIdSchema,
  ApprovalResolutionV1Schema,
  ArtifactIdSchema,
  AskUserQuestionArgsSchema,
  BoundingBoxSchema,
  CancelledActionResultV1Schema,
  CompletionFindingV1Schema,
  CompletionProposalV1Schema,
  ControlMetadataSchema,
  CoordinatesSchema,
  DialogEffectV1Schema,
  DoubleClickArgsSchema,
  DragArgsSchema,
  DragCoordinatesSchema,
  EventIdSchema,
  ExecutableActionV1Schema,
  FARA_ACTION_TO_MCP_TOOL,
  FORBIDDEN_BROWSER_DATA_KEYS,
  FailedActionResultV1Schema,
  FaraActionArgsSchema,
  ForbiddenBrowserDataError,
  FrameIdSchema,
  FramePathSegmentIdSchema,
  HistoryBackArgsSchema,
  IdempotencyKeySchema,
  KeyArgsSchema,
  KeyModifiersSchema2 as KeyModifiersSchema,
  LeftClickArgsSchema,
  LocatorCandidateV1Schema,
  McpToolName,
  MessageIdSchema,
  MouseMoveArgsSchema,
  NavigationEffectV1Schema,
  ObservationIdCounter,
  ObservationIdSchema,
  ObservationV1Schema,
  PageStateSchema,
  PauseAndMemorizeFactArgsSchema,
  PolicyContextV1Schema,
  PolicyDecisionIdSchema,
  PolicyDecisionV1Schema,
  RejectedActionResultV1Schema,
  RightClickArgsSchema,
  RunIdSchema,
  SanitizedAccessibleNameSchema,
  ScreenshotArgsSchema,
  ScreenshotSchema,
  ScrollArgsSchema,
  ScrollDeltaSchema,
  SemanticTargetIdSchema,
  SemanticTargetSchema,
  SequenceSchema,
  SessionIdSchema,
  ShadowPathSegmentIdSchema,
  StepIdSchema,
  SucceededActionResultV1Schema,
  TabIdSchema,
  TaskIdSchema,
  TerminateArgsSchema,
  TrajectoryEventKindV1Schema,
  TrajectoryEventV1Schema,
  TrajectoryLinkageV1Schema,
  ViewportContextSchema,
  ViewportSchema,
  VisitUrlArgsSchema,
  WaitArgsSchema,
  assertCoordinatesInBounds,
  assertNoForbiddenBrowserData,
  compareObservationIds,
  createActionFailure,
  createActionSuccess,
  createDefaultViewport,
  createDefaultViewportConfig,
  createObservationId,
  getActionExecutionType,
  getMcpToolName,
  getNextObservationId,
  isHttpUrl,
  isMcpAction,
  isNavigationAction,
  isObservationUrl,
  isValidObservationId,
  isViewportAction,
  mapActionToMcpParams,
  tryValidateActionArgs,
  validateActionArgs,
  validateCoordinatesInBounds
};
