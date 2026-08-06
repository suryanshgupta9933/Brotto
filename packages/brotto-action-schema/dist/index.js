"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AXTupleSchema: () => AXTupleSchema,
  AccessibilityNodeSchema: () => AccessibilityNodeSchema,
  ActionCommandV1Schema: () => ActionCommandV1Schema,
  ActionErrorCode: () => ActionErrorCode,
  ActionErrorV1Schema: () => ActionErrorV1Schema,
  ActionExecutionType: () => ActionExecutionType,
  ActionIdSchema: () => ActionIdSchema,
  ActionProposalV1Schema: () => ActionProposalV1Schema,
  ActionResultStatusV1Schema: () => ActionResultStatusV1Schema,
  ActionResultV1Schema: () => ActionResultV1Schema,
  ActionType: () => ActionType,
  AgentProposalV1Schema: () => AgentProposalV1Schema,
  ApprovalIdSchema: () => ApprovalIdSchema,
  ApprovalResolutionV1Schema: () => ApprovalResolutionV1Schema,
  ArtifactIdSchema: () => ArtifactIdSchema,
  AskUserQuestionArgsSchema: () => AskUserQuestionArgsSchema,
  BoundingBoxSchema: () => BoundingBoxSchema,
  CancelledActionResultV1Schema: () => CancelledActionResultV1Schema,
  CompletionFindingV1Schema: () => CompletionFindingV1Schema,
  CompletionProposalV1Schema: () => CompletionProposalV1Schema,
  ControlMetadataSchema: () => ControlMetadataSchema,
  CoordinatesSchema: () => CoordinatesSchema,
  DialogEffectV1Schema: () => DialogEffectV1Schema,
  DoubleClickArgsSchema: () => DoubleClickArgsSchema,
  DragArgsSchema: () => DragArgsSchema,
  DragCoordinatesSchema: () => DragCoordinatesSchema,
  EventIdSchema: () => EventIdSchema,
  ExecutableActionV1Schema: () => ExecutableActionV1Schema,
  FARA_ACTION_TO_MCP_TOOL: () => FARA_ACTION_TO_MCP_TOOL,
  FORBIDDEN_BROWSER_DATA_KEYS: () => FORBIDDEN_BROWSER_DATA_KEYS,
  FailedActionResultV1Schema: () => FailedActionResultV1Schema,
  FaraActionArgsSchema: () => FaraActionArgsSchema,
  ForbiddenBrowserDataError: () => ForbiddenBrowserDataError,
  FrameIdSchema: () => FrameIdSchema,
  FramePathSegmentIdSchema: () => FramePathSegmentIdSchema,
  HistoryBackArgsSchema: () => HistoryBackArgsSchema,
  IdempotencyKeySchema: () => IdempotencyKeySchema,
  KeyArgsSchema: () => KeyArgsSchema,
  KeyModifiersSchema: () => KeyModifiersSchema2,
  LeftClickArgsSchema: () => LeftClickArgsSchema,
  LocatorCandidateV1Schema: () => LocatorCandidateV1Schema,
  McpToolName: () => McpToolName,
  MessageIdSchema: () => MessageIdSchema,
  MouseMoveArgsSchema: () => MouseMoveArgsSchema,
  NavigationEffectV1Schema: () => NavigationEffectV1Schema,
  ObservationIdCounter: () => ObservationIdCounter,
  ObservationIdSchema: () => ObservationIdSchema,
  ObservationV1Schema: () => ObservationV1Schema,
  PageStateSchema: () => PageStateSchema,
  PauseAndMemorizeFactArgsSchema: () => PauseAndMemorizeFactArgsSchema,
  PolicyContextV1Schema: () => PolicyContextV1Schema,
  PolicyDecisionIdSchema: () => PolicyDecisionIdSchema,
  PolicyDecisionV1Schema: () => PolicyDecisionV1Schema,
  RejectedActionResultV1Schema: () => RejectedActionResultV1Schema,
  RightClickArgsSchema: () => RightClickArgsSchema,
  RunIdSchema: () => RunIdSchema,
  SanitizedAccessibleNameSchema: () => SanitizedAccessibleNameSchema,
  ScreenshotArgsSchema: () => ScreenshotArgsSchema,
  ScreenshotSchema: () => ScreenshotSchema,
  ScrollArgsSchema: () => ScrollArgsSchema,
  ScrollDeltaSchema: () => ScrollDeltaSchema,
  SemanticTargetIdSchema: () => SemanticTargetIdSchema,
  SemanticTargetSchema: () => SemanticTargetSchema,
  SequenceSchema: () => SequenceSchema,
  SessionIdSchema: () => SessionIdSchema,
  ShadowPathSegmentIdSchema: () => ShadowPathSegmentIdSchema,
  StepIdSchema: () => StepIdSchema,
  SucceededActionResultV1Schema: () => SucceededActionResultV1Schema,
  TabIdSchema: () => TabIdSchema,
  TaskIdSchema: () => TaskIdSchema,
  TerminateArgsSchema: () => TerminateArgsSchema,
  TrajectoryEventKindV1Schema: () => TrajectoryEventKindV1Schema,
  TrajectoryEventV1Schema: () => TrajectoryEventV1Schema,
  TrajectoryLinkageV1Schema: () => TrajectoryLinkageV1Schema,
  ViewportContextSchema: () => ViewportContextSchema,
  ViewportSchema: () => ViewportSchema,
  VisitUrlArgsSchema: () => VisitUrlArgsSchema,
  WaitArgsSchema: () => WaitArgsSchema,
  assertCoordinatesInBounds: () => assertCoordinatesInBounds,
  assertNoForbiddenBrowserData: () => assertNoForbiddenBrowserData,
  compareObservationIds: () => compareObservationIds,
  createActionFailure: () => createActionFailure,
  createActionSuccess: () => createActionSuccess,
  createDefaultViewport: () => createDefaultViewport,
  createDefaultViewportConfig: () => createDefaultViewportConfig,
  createObservationId: () => createObservationId,
  getActionExecutionType: () => getActionExecutionType,
  getMcpToolName: () => getMcpToolName,
  getNextObservationId: () => getNextObservationId,
  isHttpUrl: () => isHttpUrl,
  isMcpAction: () => isMcpAction,
  isNavigationAction: () => isNavigationAction,
  isValidObservationId: () => isValidObservationId,
  isViewportAction: () => isViewportAction,
  mapActionToMcpParams: () => mapActionToMcpParams,
  tryValidateActionArgs: () => tryValidateActionArgs,
  validateActionArgs: () => validateActionArgs,
  validateCoordinatesInBounds: () => validateCoordinatesInBounds
});
module.exports = __toCommonJS(index_exports);

// src/v1/ids.ts
var import_zod = require("zod");
var SessionIdSchema = import_zod.z.string().uuid().brand();
var RunIdSchema = import_zod.z.string().uuid().brand();
var TaskIdSchema = import_zod.z.string().uuid().brand();
var StepIdSchema = import_zod.z.string().uuid().brand();
var ObservationIdSchema = import_zod.z.string().uuid().brand();
var ActionIdSchema = import_zod.z.string().uuid().brand();
var PolicyDecisionIdSchema = import_zod.z.string().uuid().brand();
var EventIdSchema = import_zod.z.string().uuid().brand();
var MessageIdSchema = import_zod.z.string().uuid().brand();
var ArtifactIdSchema = import_zod.z.string().uuid().brand();
var SemanticTargetIdSchema = import_zod.z.string().uuid().brand();
var TabIdSchema = import_zod.z.string().uuid().brand();
var FrameIdSchema = import_zod.z.string().uuid().brand();
var FramePathSegmentIdSchema = import_zod.z.string().uuid().brand();
var ShadowPathSegmentIdSchema = import_zod.z.string().uuid().brand();
var ApprovalIdSchema = import_zod.z.string().uuid().brand();
var SequenceSchema = import_zod.z.number().int().nonnegative();
var IdempotencyKeySchema = import_zod.z.string().min(1).max(256);

// src/v1/observation.ts
var import_zod2 = require("zod");
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
          code: import_zod2.z.ZodIssueCode.custom,
          message: error.message,
          path: error.keyPath.slice(2).split(".").filter(Boolean)
        });
        return;
      }
      throw error;
    }
  });
}
var Sha256Schema = import_zod2.z.string().regex(/^[a-f0-9]{64}$/i);
var sensitiveSemanticContent = /\b(?:authorization|cookie|credentials?|localstorage|password|passcode|profile|proxy|secret|sessionstorage|token)\b/i;
function isSafeSemanticContent(value) {
  return !sensitiveSemanticContent.test(value);
}
var SafeSemanticTextSchema = import_zod2.z.string().min(1).max(512).refine(
  isSafeSemanticContent,
  "Semantic content may not include sensitive browser data"
);
var SafeSemanticAttributesSchema = import_zod2.z.object({
  "aria-label": SafeSemanticTextSchema.optional(),
  "aria-describedby": SafeSemanticTextSchema.optional(),
  "aria-controls": SafeSemanticTextSchema.optional(),
  "aria-expanded": import_zod2.z.enum(["true", "false"]).optional(),
  "aria-haspopup": import_zod2.z.enum(["true", "false", "menu", "listbox", "tree", "grid", "dialog"]).optional(),
  "aria-current": import_zod2.z.enum(["true", "false", "page", "step", "location", "date", "time"]).optional(),
  "aria-pressed": import_zod2.z.enum(["true", "false", "mixed"]).optional(),
  "aria-selected": import_zod2.z.enum(["true", "false"]).optional()
}).strict();
var SanitizedAccessibleNameSchema = import_zod2.z.object({
  source: import_zod2.z.enum(["aria-label", "aria-labelledby", "visible_text"]),
  text: SafeSemanticTextSchema
}).strict();
var LocatorCandidateV1Schema = import_zod2.z.discriminatedUnion("kind", [
  import_zod2.z.object({
    kind: import_zod2.z.literal("role_name"),
    role: SafeSemanticTextSchema,
    name: SanitizedAccessibleNameSchema
  }).strict(),
  import_zod2.z.object({
    kind: import_zod2.z.literal("label"),
    label: SanitizedAccessibleNameSchema
  }).strict(),
  import_zod2.z.object({
    kind: import_zod2.z.literal("test_id"),
    testId: SafeSemanticTextSchema
  }).strict(),
  import_zod2.z.object({
    kind: import_zod2.z.literal("safe_attribute"),
    attribute: import_zod2.z.enum(["aria-label", "aria-describedby", "aria-controls", "aria-current"]),
    value: SafeSemanticTextSchema
  }).strict()
]);
var ControlMetadataSchema = import_zod2.z.discriminatedUnion("kind", [
  import_zod2.z.object({ kind: import_zod2.z.literal("non_input") }).strict(),
  import_zod2.z.object({
    kind: import_zod2.z.literal("input"),
    inputType: import_zod2.z.enum(["text", "search", "email", "tel", "url", "number", "date", "checkbox", "radio"])
  }).strict()
]);
var ScreenshotSchema = withForbiddenBrowserDataGuard(import_zod2.z.discriminatedUnion("kind", [
  import_zod2.z.object({
    kind: import_zod2.z.literal("inline"),
    encoding: import_zod2.z.enum(["base64", "png", "jpeg", "webp"]),
    // ponytail: data may be empty when the extension captured a chrome://
    // page or other restricted URL that captureVisibleTab refuses to render.
    // width/height default to zero so downstream consumers can detect
    // "no screenshot available" and render a placeholder.
    data: import_zod2.z.string().max(1e7),
    sha256: Sha256Schema,
    width: import_zod2.z.number().int().nonnegative(),
    height: import_zod2.z.number().int().nonnegative()
  }).strict(),
  import_zod2.z.object({
    kind: import_zod2.z.literal("artifact"),
    artifactId: ArtifactIdSchema,
    sha256: Sha256Schema,
    width: import_zod2.z.number().int().positive(),
    height: import_zod2.z.number().int().positive(),
    encoding: import_zod2.z.enum(["png", "jpeg", "webp"])
  }).strict()
]));
var ViewportSchema = import_zod2.z.object({
  width: import_zod2.z.number().int().positive(),
  height: import_zod2.z.number().int().positive(),
  devicePixelRatio: import_zod2.z.number().positive().max(8),
  zoom: import_zod2.z.number().positive().max(8),
  scrollX: import_zod2.z.number().finite(),
  scrollY: import_zod2.z.number().finite()
}).strict();
var PageStateSchema = import_zod2.z.object({
  tabId: TabIdSchema,
  frameId: FrameIdSchema,
  lifecycle: import_zod2.z.enum(["loading", "interactive", "complete", "frozen"]),
  visibility: import_zod2.z.enum(["visible", "hidden", "prerender"])
}).strict();
var BoundingBoxSchema = import_zod2.z.object({
  x: import_zod2.z.number().finite(),
  y: import_zod2.z.number().finite(),
  width: import_zod2.z.number().positive(),
  height: import_zod2.z.number().positive()
}).strict();
var SemanticTargetSchema = withForbiddenBrowserDataGuard(import_zod2.z.object({
  targetId: SemanticTargetIdSchema,
  stableRef: import_zod2.z.string().regex(/^[a-f0-9]{16}$/i).optional(),
  tag: import_zod2.z.string().min(1).max(64),
  role: import_zod2.z.string().min(1).max(128).optional(),
  accessibleName: SanitizedAccessibleNameSchema.optional(),
  attributes: SafeSemanticAttributesSchema.optional(),
  control: ControlMetadataSchema,
  boundingBox: BoundingBoxSchema,
  visible: import_zod2.z.boolean(),
  framePath: import_zod2.z.array(FramePathSegmentIdSchema).max(20),
  shadowPath: import_zod2.z.array(ShadowPathSegmentIdSchema).max(20).optional(),
  locatorCandidates: import_zod2.z.array(LocatorCandidateV1Schema).max(10)
}).strict()).superRefine((target, context) => {
  if (target.tag.toLowerCase() === "input" && target.control.kind !== "input") {
    context.addIssue({ code: import_zod2.z.ZodIssueCode.custom, path: ["control"], message: "Input targets require input control metadata" });
  }
});
var AXTupleSchema = import_zod2.z.object({
  role: import_zod2.z.string(),
  index: import_zod2.z.number().int().nonnegative(),
  name: import_zod2.z.string().optional()
});
var AccessibilityNodeSchema = import_zod2.z.object({
  axNodeId: import_zod2.z.string(),
  role: import_zod2.z.string(),
  name: import_zod2.z.string().optional(),
  description: import_zod2.z.string().optional(),
  value: import_zod2.z.string().optional(),
  attributes: import_zod2.z.record(import_zod2.z.string(), import_zod2.z.string()).optional(),
  bounds: BoundingBoxSchema.optional(),
  axPath: import_zod2.z.array(AXTupleSchema),
  attributeHash: Sha256Schema
});
var ObservationV1Schema = withForbiddenBrowserDataGuard(import_zod2.z.object({
  observationId: ObservationIdSchema,
  capturedAt: import_zod2.z.string().datetime(),
  url: import_zod2.z.string().url().refine(isHttpUrl, "Only HTTP(S) observation URLs are allowed"),
  title: import_zod2.z.string().max(512),
  screenshot: ScreenshotSchema,
  viewport: ViewportSchema,
  page: PageStateSchema,
  semanticTargets: import_zod2.z.array(SemanticTargetSchema).max(200),
  accessibilityNodes: import_zod2.z.array(AccessibilityNodeSchema).optional()
}).strict());

// src/v1/actions.ts
var import_zod3 = require("zod");
function guardedStrictObject(schema) {
  return schema.superRefine((value, context) => {
    try {
      assertNoForbiddenBrowserData(value);
    } catch (error) {
      if (error instanceof ForbiddenBrowserDataError) {
        context.addIssue({ code: import_zod3.z.ZodIssueCode.custom, message: error.message });
        return;
      }
      throw error;
    }
  });
}
var CoordinateSchema = import_zod3.z.number().int().nonnegative();
var KeyModifiersSchema = import_zod3.z.object({
  ctrl: import_zod3.z.boolean().optional(),
  shift: import_zod3.z.boolean().optional(),
  alt: import_zod3.z.boolean().optional(),
  meta: import_zod3.z.boolean().optional()
}).strict();
var ExecutableActionV1Schema = import_zod3.z.discriminatedUnion("type", [
  import_zod3.z.object({ type: import_zod3.z.literal("left_click"), x: CoordinateSchema, y: CoordinateSchema, targetId: SemanticTargetIdSchema.optional() }).strict(),
  import_zod3.z.object({ type: import_zod3.z.literal("double_click"), x: CoordinateSchema, y: CoordinateSchema, targetId: SemanticTargetIdSchema.optional() }).strict(),
  import_zod3.z.object({ type: import_zod3.z.literal("right_click"), x: CoordinateSchema, y: CoordinateSchema, targetId: SemanticTargetIdSchema.optional() }).strict(),
  import_zod3.z.object({ type: import_zod3.z.literal("drag"), startX: CoordinateSchema, startY: CoordinateSchema, endX: CoordinateSchema, endY: CoordinateSchema }).strict(),
  import_zod3.z.object({ type: import_zod3.z.literal("mouse_move"), x: CoordinateSchema, y: CoordinateSchema }).strict(),
  import_zod3.z.object({ type: import_zod3.z.literal("scroll"), deltaX: import_zod3.z.number().int(), deltaY: import_zod3.z.number().int() }).strict(),
  import_zod3.z.object({ type: import_zod3.z.literal("key"), key: import_zod3.z.string().min(1).max(128), modifiers: KeyModifiersSchema.optional() }).strict(),
  import_zod3.z.object({ type: import_zod3.z.literal("insert_text"), text: import_zod3.z.string().min(1).max(1e4), targetId: SemanticTargetIdSchema.optional() }).strict(),
  import_zod3.z.object({ type: import_zod3.z.literal("visit_url"), url: import_zod3.z.string().url().refine(isHttpUrl, "Only HTTP(S) navigation URLs are allowed") }).strict(),
  import_zod3.z.object({ type: import_zod3.z.literal("history_back"), steps: import_zod3.z.number().int().positive().max(20).default(1) }).strict(),
  import_zod3.z.object({ type: import_zod3.z.literal("wait"), durationMs: import_zod3.z.number().int().positive().max(6e4) }).strict(),
  import_zod3.z.object({ type: import_zod3.z.literal("ask_user_question"), question: import_zod3.z.string().min(1).max(2e3), choices: import_zod3.z.array(import_zod3.z.string().min(1).max(256)).max(20).optional() }).strict(),
  import_zod3.z.object({ type: import_zod3.z.literal("memorize_fact"), fact: import_zod3.z.string().min(1).max(2e3), category: import_zod3.z.string().min(1).max(128).optional() }).strict()
]);
var ActionProposalV1Schema = guardedStrictObject(import_zod3.z.object({
  kind: import_zod3.z.literal("action"),
  observationId: ObservationIdSchema,
  proposedAt: import_zod3.z.string().datetime(),
  action: ExecutableActionV1Schema
}).strict());
var CompletionFindingV1Schema = import_zod3.z.object({
  fact: import_zod3.z.string().min(1).max(2e3),
  observationIds: import_zod3.z.array(ObservationIdSchema).min(1).max(20)
}).strict();
var CompletionProposalV1Schema = guardedStrictObject(import_zod3.z.object({
  kind: import_zod3.z.literal("completion"),
  observationId: ObservationIdSchema,
  type: import_zod3.z.literal("terminate"),
  status: import_zod3.z.enum(["succeeded", "partial", "failed"]),
  summary: import_zod3.z.string().min(1).max(4e3),
  findings: import_zod3.z.array(CompletionFindingV1Schema).max(100),
  unmetCriteria: import_zod3.z.array(import_zod3.z.string().min(1).max(1e3)).max(100),
  confidence: import_zod3.z.number().min(0).max(1)
}).strict()).superRefine((value, context) => {
  if (value.status === "succeeded" && value.findings.length === 0) {
    context.addIssue({
      code: import_zod3.z.ZodIssueCode.custom,
      path: ["findings"],
      message: "Successful completion requires findings with observation evidence"
    });
  }
});
var AgentProposalV1Schema = import_zod3.z.union([
  ActionProposalV1Schema,
  CompletionProposalV1Schema
]);
var PolicyContextV1Schema = import_zod3.z.object({
  policyDecisionId: PolicyDecisionIdSchema,
  policyVersion: import_zod3.z.string().min(1).max(128),
  approved: import_zod3.z.boolean(),
  approvalId: ApprovalIdSchema.optional()
}).strict();
var PolicyDecisionV1Schema = guardedStrictObject(import_zod3.z.object({
  policyDecisionId: PolicyDecisionIdSchema,
  actionId: ActionIdSchema,
  observationId: ObservationIdSchema,
  decision: import_zod3.z.enum(["allowed", "denied", "approval_required"]),
  decidedAt: import_zod3.z.string().datetime()
}).strict());
var ApprovalResolutionV1Schema = guardedStrictObject(import_zod3.z.object({
  approvalId: ApprovalIdSchema,
  policyDecisionId: PolicyDecisionIdSchema,
  actionId: ActionIdSchema,
  status: import_zod3.z.enum(["approved", "denied"]),
  resolvedAt: import_zod3.z.string().datetime()
}).strict());
var ActionCommandV1Schema = guardedStrictObject(import_zod3.z.object({
  actionId: ActionIdSchema,
  stepId: StepIdSchema,
  observationId: ObservationIdSchema,
  sequence: SequenceSchema,
  action: ExecutableActionV1Schema,
  policyContext: PolicyContextV1Schema,
  dispatchedAt: import_zod3.z.string().datetime(),
  expiresAt: import_zod3.z.string().datetime(),
  idempotencyKey: IdempotencyKeySchema
}).strict());

// src/v1/results.ts
var import_zod4 = require("zod");
var ActionResultStatusV1Schema = import_zod4.z.enum([
  "succeeded",
  "failed_recoverable",
  "failed_terminal",
  "rejected_stale",
  "rejected_policy",
  "approval_required",
  "cancelled"
]);
var ActionErrorV1Schema = import_zod4.z.object({
  code: import_zod4.z.string().min(1).max(128),
  message: import_zod4.z.string().min(1).max(2e3),
  retryable: import_zod4.z.boolean()
}).strict();
var NavigationEffectV1Schema = import_zod4.z.object({
  url: import_zod4.z.string().url().refine(isHttpUrl, "Only HTTP(S) URLs are allowed"),
  title: import_zod4.z.string().max(512).optional()
}).strict();
var DialogEffectV1Schema = import_zod4.z.object({
  kind: import_zod4.z.enum(["alert", "confirm", "prompt", "beforeunload"]),
  present: import_zod4.z.boolean()
}).strict();
var ActionResultBaseV1Schema = import_zod4.z.object({
  actionId: ActionIdSchema,
  stepId: StepIdSchema,
  observationId: ObservationIdSchema,
  sequence: SequenceSchema,
  startedAt: import_zod4.z.string().datetime(),
  completedAt: import_zod4.z.string().datetime(),
  durationMs: import_zod4.z.number().int().nonnegative(),
  target: SemanticTargetSchema.optional(),
  navigation: NavigationEffectV1Schema.optional(),
  dialog: DialogEffectV1Schema.optional()
});
var SucceededActionResultV1Schema = ActionResultBaseV1Schema.extend({
  status: import_zod4.z.literal("succeeded"),
  postObservation: ObservationV1Schema
}).strict();
var FailedActionResultV1Schema = ActionResultBaseV1Schema.extend({
  status: import_zod4.z.enum(["failed_recoverable", "failed_terminal"]),
  error: ActionErrorV1Schema,
  postObservation: ObservationV1Schema
}).strict();
var RejectedActionResultV1Schema = ActionResultBaseV1Schema.extend({
  status: import_zod4.z.enum(["rejected_stale", "rejected_policy", "approval_required"]),
  rejection: ActionErrorV1Schema
}).strict();
var CancelledActionResultV1Schema = ActionResultBaseV1Schema.extend({
  status: import_zod4.z.literal("cancelled"),
  cancellation: import_zod4.z.object({ reason: import_zod4.z.string().min(1).max(2e3).optional() }).strict(),
  postObservation: ObservationV1Schema
}).strict();
var ActionResultV1Schema = import_zod4.z.union([
  SucceededActionResultV1Schema,
  FailedActionResultV1Schema,
  RejectedActionResultV1Schema,
  CancelledActionResultV1Schema
]).superRefine((value, context) => {
  try {
    assertNoForbiddenBrowserData(value);
  } catch (error) {
    if (error instanceof ForbiddenBrowserDataError) {
      context.addIssue({ code: import_zod4.z.ZodIssueCode.custom, message: error.message });
      return;
    }
    throw error;
  }
});

// src/v1/events.ts
var import_zod5 = require("zod");
var TrajectoryEventKindV1Schema = import_zod5.z.enum([
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
var TrajectoryEventV1Schema = import_zod5.z.object({
  eventId: EventIdSchema,
  sessionId: SessionIdSchema,
  taskId: TaskIdSchema,
  stepId: StepIdSchema.optional(),
  actionId: ActionIdSchema.optional(),
  observationId: ObservationIdSchema.optional(),
  correlationId: import_zod5.z.string().uuid().optional(),
  causationId: EventIdSchema.optional(),
  sequence: SequenceSchema,
  occurredAt: import_zod5.z.string().datetime(),
  kind: TrajectoryEventKindV1Schema,
  summary: import_zod5.z.string().max(2e3).optional()
}).strict().superRefine((value, context) => {
  try {
    assertNoForbiddenBrowserData(value);
  } catch (error) {
    if (error instanceof ForbiddenBrowserDataError) {
      context.addIssue({ code: import_zod5.z.ZodIssueCode.custom, message: error.message });
      return;
    }
    throw error;
  }
});
var TrajectoryLinkageV1Schema = import_zod5.z.object({
  sourceObservation: ObservationV1Schema,
  proposal: ActionProposalV1Schema,
  command: ActionCommandV1Schema,
  policyDecision: PolicyDecisionV1Schema,
  approvalResolution: ApprovalResolutionV1Schema.optional(),
  result: ActionResultV1Schema
}).strict().superRefine((value, context) => {
  const { approvalResolution, command, policyDecision, proposal, result, sourceObservation } = value;
  if (sourceObservation.observationId !== proposal.observationId || proposal.observationId !== command.observationId) {
    context.addIssue({ code: import_zod5.z.ZodIssueCode.custom, path: ["command", "observationId"], message: "Command must reference the proposal observation" });
  }
  if (JSON.stringify(proposal.action) !== JSON.stringify(command.action)) {
    context.addIssue({ code: import_zod5.z.ZodIssueCode.custom, path: ["command", "action"], message: "Command action must match the proposal action" });
  }
  if (policyDecision.policyDecisionId !== command.policyContext.policyDecisionId) {
    context.addIssue({ code: import_zod5.z.ZodIssueCode.custom, path: ["policyDecision", "policyDecisionId"], message: "Policy decision must match the command policy context" });
  }
  if (policyDecision.actionId !== command.actionId || policyDecision.observationId !== command.observationId) {
    context.addIssue({ code: import_zod5.z.ZodIssueCode.custom, path: ["policyDecision"], message: "Policy decision must reference the command action and observation" });
  }
  const hasApprovalProof = command.policyContext.approved && command.policyContext.approvalId !== void 0;
  if (policyDecision.decision === "allowed" && ["rejected_policy", "approval_required"].includes(result.status)) {
    context.addIssue({ code: import_zod5.z.ZodIssueCode.custom, path: ["result", "status"], message: "Allowed policy decisions cannot produce policy rejection or approval-required results" });
  }
  if (policyDecision.decision === "denied" && result.status !== "rejected_policy") {
    context.addIssue({ code: import_zod5.z.ZodIssueCode.custom, path: ["result", "status"], message: "Denied policy decisions require a rejected_policy result" });
  }
  if (policyDecision.decision === "approval_required" && !hasApprovalProof && result.status !== "approval_required") {
    context.addIssue({ code: import_zod5.z.ZodIssueCode.custom, path: ["result", "status"], message: "Unproven approval-required decisions require an approval_required result" });
  }
  if (policyDecision.decision === "approval_required" && hasApprovalProof && ["rejected_policy", "approval_required"].includes(result.status)) {
    context.addIssue({ code: import_zod5.z.ZodIssueCode.custom, path: ["result", "status"], message: "Approved decisions cannot produce policy rejection or approval-required results" });
  }
  if (policyDecision.decision === "approval_required" && hasApprovalProof) {
    if (approvalResolution === void 0 || approvalResolution.status !== "approved" || approvalResolution.approvalId !== command.policyContext.approvalId || approvalResolution.policyDecisionId !== policyDecision.policyDecisionId || approvalResolution.actionId !== command.actionId) {
      context.addIssue({ code: import_zod5.z.ZodIssueCode.custom, path: ["approvalResolution"], message: "Approval-required execution needs a matching approved resolution" });
    }
  }
  if (result.actionId !== command.actionId || result.stepId !== command.stepId || result.observationId !== command.observationId || result.sequence <= command.sequence) {
    context.addIssue({ code: import_zod5.z.ZodIssueCode.custom, path: ["result"], message: "Result must follow the command and preserve its identifiers" });
  }
  const sourceCapturedAt = Date.parse(sourceObservation.capturedAt);
  const proposedAt = Date.parse(proposal.proposedAt);
  const decidedAt = Date.parse(policyDecision.decidedAt);
  const dispatchedAt = Date.parse(command.dispatchedAt);
  const startedAt = Date.parse(result.startedAt);
  const completedAt = Date.parse(result.completedAt);
  const resolvedAt = approvalResolution === void 0 ? void 0 : Date.parse(approvalResolution.resolvedAt);
  if (!(sourceCapturedAt <= proposedAt && proposedAt <= decidedAt && decidedAt <= dispatchedAt && dispatchedAt <= startedAt && startedAt <= completedAt && sourceCapturedAt < dispatchedAt && proposedAt < dispatchedAt)) {
    context.addIssue({ code: import_zod5.z.ZodIssueCode.custom, path: ["result", "startedAt"], message: "Observation, proposal, policy, dispatch, and execution timestamps must be chronological" });
  }
  if (hasApprovalProof && resolvedAt === void 0 || resolvedAt !== void 0 && !(decidedAt < resolvedAt && resolvedAt < dispatchedAt)) {
    context.addIssue({ code: import_zod5.z.ZodIssueCode.custom, path: ["approvalResolution", "resolvedAt"], message: "Approval resolution must occur after policy decision and before dispatch" });
  }
  if (result.status === "succeeded" || result.status === "failed_recoverable" || result.status === "failed_terminal" || result.status === "cancelled") {
    if (result.postObservation.observationId === command.observationId) {
      context.addIssue({ code: import_zod5.z.ZodIssueCode.custom, path: ["result", "postObservation", "observationId"], message: "Executed action requires a distinct post-observation" });
    }
    if (Date.parse(result.postObservation.capturedAt) <= completedAt) {
      context.addIssue({ code: import_zod5.z.ZodIssueCode.custom, path: ["result", "postObservation", "capturedAt"], message: "Executed action post-observation must be captured after completion" });
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
var import_zod6 = require("zod");
var CoordinatesSchema = import_zod6.z.object({
  x: import_zod6.z.number().int().min(0),
  y: import_zod6.z.number().int().min(0)
});
var DragCoordinatesSchema = import_zod6.z.object({
  start: CoordinatesSchema,
  end: CoordinatesSchema
});
var ScrollDeltaSchema = import_zod6.z.object({
  deltaX: import_zod6.z.number().int(),
  deltaY: import_zod6.z.number().int()
});
var ViewportContextSchema = import_zod6.z.object({
  viewportWidth: import_zod6.z.number().int().positive(),
  viewportHeight: import_zod6.z.number().int().positive()
});
var KeyModifiersSchema2 = import_zod6.z.object({
  ctrl: import_zod6.z.boolean().optional(),
  shift: import_zod6.z.boolean().optional(),
  alt: import_zod6.z.boolean().optional(),
  meta: import_zod6.z.boolean().optional()
});
var BaseActionArgsSchema = import_zod6.z.object({
  id: import_zod6.z.string().min(1),
  observationId: import_zod6.z.number().int().min(0),
  timestamp: import_zod6.z.number().int().positive()
});
var LeftClickArgsSchema = BaseActionArgsSchema.extend({
  type: import_zod6.z.literal("left_click" /* LEFT_CLICK */),
  coordinates: CoordinatesSchema,
  viewport: ViewportContextSchema
});
var DoubleClickArgsSchema = BaseActionArgsSchema.extend({
  type: import_zod6.z.literal("double_click" /* DOUBLE_CLICK */),
  coordinates: CoordinatesSchema,
  viewport: ViewportContextSchema
});
var RightClickArgsSchema = BaseActionArgsSchema.extend({
  type: import_zod6.z.literal("right_click" /* RIGHT_CLICK */),
  coordinates: CoordinatesSchema,
  viewport: ViewportContextSchema
});
var DragArgsSchema = BaseActionArgsSchema.extend({
  type: import_zod6.z.literal("drag" /* DRAG */),
  coordinates: DragCoordinatesSchema,
  viewport: ViewportContextSchema
});
var MouseMoveArgsSchema = BaseActionArgsSchema.extend({
  type: import_zod6.z.literal("mouse_move" /* MOUSE_MOVE */),
  coordinates: CoordinatesSchema,
  viewport: ViewportContextSchema
});
var ScrollArgsSchema = BaseActionArgsSchema.extend({
  type: import_zod6.z.literal("scroll" /* SCROLL */),
  coordinates: CoordinatesSchema,
  delta: ScrollDeltaSchema,
  viewport: ViewportContextSchema
});
var KeyArgsSchema = BaseActionArgsSchema.extend({
  type: import_zod6.z.literal("key" /* KEY */),
  key: import_zod6.z.string().min(1),
  modifiers: KeyModifiersSchema2.optional()
});
var VisitUrlArgsSchema = BaseActionArgsSchema.extend({
  type: import_zod6.z.literal("visit_url" /* VISIT_URL */),
  url: import_zod6.z.string().url(),
  timeout: import_zod6.z.number().int().positive().optional()
});
var HistoryBackArgsSchema = BaseActionArgsSchema.extend({
  type: import_zod6.z.literal("history_back" /* HISTORY_BACK */),
  steps: import_zod6.z.number().int().positive().optional()
});
var ScreenshotArgsSchema = BaseActionArgsSchema.extend({
  type: import_zod6.z.literal("screenshot" /* SCREENSHOT */),
  fullPage: import_zod6.z.boolean().optional()
});
var WaitArgsSchema = BaseActionArgsSchema.extend({
  type: import_zod6.z.literal("wait" /* WAIT */),
  durationMs: import_zod6.z.number().int().positive()
});
var AskUserQuestionArgsSchema = BaseActionArgsSchema.extend({
  type: import_zod6.z.literal("ask_user_question" /* ASK_USER_QUESTION */),
  question: import_zod6.z.string().min(1),
  context: import_zod6.z.string().optional(),
  choices: import_zod6.z.array(import_zod6.z.string()).optional()
});
var TerminateArgsSchema = BaseActionArgsSchema.extend({
  type: import_zod6.z.literal("terminate" /* TERMINATE */),
  reason: import_zod6.z.string().optional()
});
var PauseAndMemorizeFactArgsSchema = BaseActionArgsSchema.extend({
  type: import_zod6.z.literal("pause_and_memorize_fact" /* PAUSE_AND_MEMORIZE_FACT */),
  fact: import_zod6.z.string().min(1),
  category: import_zod6.z.string().optional()
});
var InsertTextArgsSchema = BaseActionArgsSchema.extend({
  type: import_zod6.z.literal("insert_text" /* INSERT_TEXT */),
  text: import_zod6.z.string().min(1),
  targetId: import_zod6.z.string().optional()
});
var MemorizeFactArgsSchema = BaseActionArgsSchema.extend({
  type: import_zod6.z.literal("memorize_fact" /* MEMORIZE_FACT */),
  fact: import_zod6.z.string().min(1),
  category: import_zod6.z.string().optional()
});
var FaraActionArgsSchema = import_zod6.z.union([
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
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
  KeyModifiersSchema,
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
  isValidObservationId,
  isViewportAction,
  mapActionToMcpParams,
  tryValidateActionArgs,
  validateActionArgs,
  validateCoordinatesInBounds
});
