import { z } from 'zod';

// Session states as defined in ARCHITECTURE.md
export const SessionStateSchema = z.enum([
  'CREATED',
  'WAITING_FOR_CLIENT',
  'CONNECTED',
  'OBSERVING',
  'PLANNING',
  'POLICY_CHECK',
  'WAITING_FOR_APPROVAL',
  'EXECUTING',
  'VERIFYING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type SessionState = z.infer<typeof SessionStateSchema>;

// Client type (desktop connector or browser extension)
export const ClientTypeSchema = z.enum(['desktop_connector', 'browser_extension']);
export type ClientType = z.infer<typeof ClientTypeSchema>;

// Action types that can be proposed/executed
export const ActionTypeSchema = z.enum([
  'left_click',
  'double_click',
  'right_click',
  'drag',
  'mouse_move',
  'scroll',
  'key',
  'visit_url',
  'history_back',
  'screenshot',
  'wait',
  'ask_user_question',
  'terminate',
  'pause_and_memorize_fact',
  'keyboard_insert_text',
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

// Policy decision types
export const PolicyDecisionSchema = z.enum([
  'ALLOWED',
  'DENIED',
  'REQUIRES_APPROVAL',
  'REQUIRES_CONSENT',
]);
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

// Approval decision types
export const ApprovalDecisionSchema = z.enum([
  'APPROVED',
  'DENIED',
  'SKIPPED',
  'TIMEOUT',
]);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

// Session termination reasons
export const TerminationReasonSchema = z.enum([
  'COMPLETED',
  'USER_CANCELLED',
  'TIMEOUT',
  'ERROR',
  'POLICY_VIOLATION',
  'BUDGET_EXCEEDED',
  'CLIENT_DISCONNECTED',
  'FORCED_TERMINATION',
]);
export type TerminationReason = z.infer<typeof TerminationReasonSchema>;

// Device information schema
export const DeviceInfoSchema = z.object({
  deviceId: z.string().uuid(),
  deviceName: z.string().optional(),
  deviceType: z.string().optional(),
  osPlatform: z.string().optional(),
  osVersion: z.string().optional(),
  clientType: ClientTypeSchema,
  clientVersion: z.string().optional(),
});
export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;

// Browser/tab information schema
export const BrowserInfoSchema = z.object({
  browserName: z.string().optional(),
  browserVersion: z.string().optional(),
  tabIds: z.array(z.string()).optional(),
  viewportWidth: z.number().optional(),
  viewportHeight: z.number().optional(),
  devicePixelRatio: z.number().optional(),
});
export type BrowserInfo = z.infer<typeof BrowserInfoSchema>;

// Screenshot hash record (not the actual screenshot)
export const ScreenshotHashSchema = z.object({
  observationId: z.string(),
  screenshotHash: z.string(), // SHA-256 hash of the screenshot
  screenshotTimestamp: z.string().datetime(),
  width: z.number().optional(),
  height: z.number().optional(),
  truncated: z.boolean().default(false), // Whether full screenshot is retained
});
export type ScreenshotHash = z.infer<typeof ScreenshotHashSchema>;

// Proposed action record
export const ProposedActionSchema = z.object({
  actionId: z.string().uuid(),
  actionType: ActionTypeSchema,
  targetUrl: z.string().url().optional(),
  targetDomain: z.string().optional(),
  coordinates: z.object({
    x: z.number(),
    y: z.number(),
  }).optional(),
  payload: z.record(z.unknown()).optional(), // Additional action-specific data
  reasoning: z.string().optional(), // Model's reasoning for this action
  observationId: z.string(), // Screenshot observation this action was based on
});
export type ProposedAction = z.infer<typeof ProposedActionSchema>;

// Policy result record
export const PolicyResultSchema = z.object({
  policyId: z.string().optional(),
  decision: PolicyDecisionSchema,
  reason: z.string().optional(),
  requiresConsent: z.boolean().default(false),
  consentCategories: z.array(z.string()).optional(),
});
export type PolicyResult = z.infer<typeof PolicyResultSchema>;

// Approval decision record
export const ApprovalDecisionRecordSchema = z.object({
  approvalId: z.string().uuid(),
  decision: ApprovalDecisionSchema,
  approverId: z.string().optional(), // User ID if manual approval
  approverReason: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
});
export type ApprovalDecisionRecord = z.infer<typeof ApprovalDecisionRecordSchema>;

// Executed action record
export const ExecutedActionSchema = z.object({
  executionId: z.string().uuid(),
  actionId: z.string().uuid(), // Reference to proposed action
  actionType: ActionTypeSchema,
  coordinates: z.object({
    x: z.number(),
    y: z.number(),
  }).optional(),
  payload: z.record(z.unknown()).optional(),
  executedAt: z.string().datetime(),
  executionDurationMs: z.number().optional(),
  success: z.boolean(),
  errorMessage: z.string().optional(),
  errorCode: z.string().optional(),
});
export type ExecutedAction = z.infer<typeof ExecutedActionSchema>;

// Error record
export const ErrorRecordSchema = z.object({
  errorId: z.string().uuid(),
  errorCode: z.string(),
  errorMessage: z.string(),
  errorStack: z.string().optional(),
  severity: z.enum(['INFO', 'WARNING', 'ERROR', 'CRITICAL']).default('ERROR'),
  occurredAt: z.string().datetime(),
  sessionId: z.string().uuid(),
  relatedActionId: z.string().uuid().optional(),
});
export type ErrorRecord = z.infer<typeof ErrorRecordSchema>;

// Complete audit event schema
export const AuditEventSchema = z.object({
  // Session context (required for all events)
  sessionId: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),

  // Creator and device info
  creator: z.object({
    userId: z.string().uuid(),
    email: z.string().email().optional(),
    name: z.string().optional(),
  }),
  device: DeviceInfoSchema,
  browser: BrowserInfoSchema.optional(),

  // Model context
  modelVersion: z.string().optional(),
  promptTemplateVersion: z.string().optional(),

  // Session state
  sessionState: SessionStateSchema.optional(),
  currentDomain: z.string().optional(),

  // Screenshot hash (not full screenshot)
  screenshotHash: ScreenshotHashSchema.optional(),

  // Action lifecycle
  proposedAction: ProposedActionSchema.optional(),
  policyResult: PolicyResultSchema.optional(),
  approvalDecision: ApprovalDecisionRecordSchema.optional(),
  executedAction: ExecutedActionSchema.optional(),

  // Error and termination
  error: ErrorRecordSchema.optional(),
  terminationReason: TerminationReasonSchema.optional(),

  // Metadata
  timestamp: z.string().datetime(),
  traceId: z.string().optional(), // For correlation with other services
  spanId: z.string().optional(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

// Organization retention policy
export const RetentionPolicySchema = z.object({
  organizationId: z.string().uuid(),
  screenshotRetentionDays: z.number().min(0).max(365), // 0 = disabled
  auditRetentionDays: z.number().min(1).max(2555), // ~7 years max
  enableFullScreenshotConsent: z.boolean().default(false),
  redactScreenshots: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>;

// Export formats
export const ExportFormatSchema = z.enum(['json', 'csv']);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

// Export filters
export const ExportFiltersSchema = z.object({
  organizationId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  eventTypes: z.array(z.string()).optional(),
  includeErrors: z.boolean().default(true),
  includeActions: z.boolean().default(true),
  includeScreenshots: z.boolean().default(false), // Only hashes are exported
});
export type ExportFilters = z.infer<typeof ExportFiltersSchema>;

// Audit event row in database (denormalized for efficient querying)
export interface AuditEventRow {
  id: string;
  session_id: string;
  organization_id: string;
  user_id: string;
  creator_email: string | null;
  creator_name: string | null;
  device_id: string;
  device_name: string | null;
  device_type: string | null;
  os_platform: string | null;
  os_version: string | null;
  client_type: ClientType | null;
  client_version: string | null;
  browser_name: string | null;
  browser_version: string | null;
  tab_ids: string[] | null;
  viewport_width: number | null;
  viewport_height: number | null;
  device_pixel_ratio: number | null;
  model_version: string | null;
  prompt_template_version: string | null;
  session_state: SessionState | null;
  current_domain: string | null;
  // Screenshot hash fields
  observation_id: string | null;
  screenshot_hash: string | null;
  screenshot_timestamp: Date | null;
  screenshot_width: number | null;
  screenshot_height: number | null;
  screenshot_truncated: boolean;
  // Proposed action fields
  action_id: string | null;
  action_type: ActionType | null;
  target_url: string | null;
  target_domain: string | null;
  action_coordinates_x: number | null;
  action_coordinates_y: number | null;
  action_payload: Record<string, unknown> | null;
  action_reasoning: string | null;
  action_observation_id: string | null;
  // Policy result fields
  policy_id: string | null;
  policy_decision: PolicyDecision | null;
  policy_reason: string | null;
  requires_consent: boolean;
  consent_categories: string[] | null;
  // Approval decision fields
  approval_id: string | null;
  approval_decision: ApprovalDecision | null;
  approver_id: string | null;
  approver_reason: string | null;
  approved_at: Date | null;
  // Executed action fields
  execution_id: string | null;
  execution_action_id: string | null;
  execution_action_type: ActionType | null;
  execution_coordinates_x: number | null;
  execution_coordinates_y: number | null;
  execution_payload: Record<string, unknown> | null;
  executed_at: Date | null;
  execution_duration_ms: number | null;
  execution_success: boolean | null;
  execution_error_message: string | null;
  execution_error_code: string | null;
  // Error fields
  error_id: string | null;
  error_code: string | null;
  error_message: string | null;
  error_stack: string | null;
  error_severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | null;
  error_occurred_at: Date | null;
  error_session_id: string | null;
  error_related_action_id: string | null;
  // Termination
  termination_reason: TerminationReason | null;
  // Metadata
  timestamp: Date;
  trace_id: string | null;
  span_id: string | null;
}

// Database schema version for migrations
export const SCHEMA_VERSION = 1;
