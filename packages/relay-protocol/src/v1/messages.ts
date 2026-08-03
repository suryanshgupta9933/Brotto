import { z } from 'zod';
import {
  ActionCommandV1Schema,
  ActionIdSchema,
  ActionProposalV1Schema,
  ActionResultV1Schema,
  ApprovalIdSchema,
  ApprovalResolutionV1Schema,
  assertNoForbiddenBrowserData,
  ObservationIdSchema,
  ObservationV1Schema,
  PolicyDecisionIdSchema,
  PolicyDecisionV1Schema,
  SequenceSchema,
  StepIdSchema,
  TaskIdSchema,
  CompletionProposalV1Schema,
} from '@fara-platform/fara-action-schema';

const TimestampSchema = z.string().datetime();
const ClientSchema = z.enum(['browser_extension', 'desktop_connector', 'orchestrator']);
const ProtocolErrorDetailsSchema = z.record(z.unknown()).superRefine((value, context) => {
  if (Object.keys(value).length > 20) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Protocol error details may contain at most 20 fields' });
  }
});

export const SessionOpenSchema = z.object({
  type: z.literal('session.open'),
  client: ClientSchema,
}).strict();

export const SessionAcceptedSchema = z.object({
  type: z.literal('session.accepted'),
  acceptedAt: TimestampSchema,
  nextSequence: SequenceSchema,
}).strict();

export const ObservationSubmittedSchema = z.object({
  type: z.literal('observation.submitted'),
  observation: ObservationV1Schema,
}).strict();

export const ActionCommandMessageSchema = z.object({
  type: z.literal('action.command'),
  proposal: ActionProposalV1Schema,
  policyDecision: PolicyDecisionV1Schema,
  command: ActionCommandV1Schema,
}).strict();

export const ActionAcknowledgedSchema = z.object({
  type: z.literal('action.acknowledged'),
  actionId: ActionIdSchema,
  stepId: StepIdSchema,
  observationId: ObservationIdSchema,
  acknowledgedAt: TimestampSchema,
}).strict();

export const ActionCompletedSchema = z.object({
  type: z.literal('action.completed'),
  result: ActionResultV1Schema,
}).strict();

export const ApprovalRequestedSchema = z.object({
  type: z.literal('approval.requested'),
  approvalId: ApprovalIdSchema,
  policyDecisionId: PolicyDecisionIdSchema,
  actionId: ActionIdSchema,
  observationId: ObservationIdSchema,
  requestedAt: TimestampSchema,
  reason: z.string().min(1).max(2_000),
}).strict();

export const ApprovalResolvedSchema = z.object({
  type: z.literal('approval.resolved'),
  resolution: ApprovalResolutionV1Schema,
}).strict();

const SucceededCompletionProposalV1Schema = CompletionProposalV1Schema.superRefine((completion, context) => {
  if (completion.status !== 'succeeded') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'task.completed requires a succeeded completion proposal' });
  }
});

const FailedCompletionProposalV1Schema = CompletionProposalV1Schema.superRefine((completion, context) => {
  if (completion.status !== 'failed') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'task.failed requires a failed completion proposal' });
  }
});

const TaskCompletedSchema = z.object({
  type: z.literal('task.completed'),
  completion: SucceededCompletionProposalV1Schema,
}).strict();

const TaskFailedSchema = z.object({
  type: z.literal('task.failed'),
  completion: FailedCompletionProposalV1Schema,
}).strict();

const TaskCancelledSchema = z.object({
  type: z.literal('task.cancelled'),
  taskId: TaskIdSchema,
  occurredAt: TimestampSchema,
  reason: z.string().min(1).max(2_000),
  observationId: ObservationIdSchema,
  actionId: ActionIdSchema.optional(),
  stepId: StepIdSchema.optional(),
}).strict();

export const TaskTerminalSchema = z.discriminatedUnion('type', [
  TaskCompletedSchema,
  TaskFailedSchema,
  TaskCancelledSchema,
]);

export const ReconcileRequestSchema = z.object({
  type: z.literal('reconcile.request'),
  lastReceivedSequence: SequenceSchema,
  pendingActionIds: z.array(ActionIdSchema).max(100),
  requestedAt: TimestampSchema,
}).strict();

export const ReconcileResponseSchema = z.object({
  type: z.literal('reconcile.response'),
  nextSequence: SequenceSchema,
  pendingActionIds: z.array(ActionIdSchema).max(100),
  respondedAt: TimestampSchema,
}).strict();

export const HeartbeatSchema = z.object({
  type: z.literal('heartbeat'),
  sentAt: TimestampSchema,
}).strict();

export const ProtocolErrorSchema = z.object({
  type: z.literal('protocol.error'),
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(2_000),
  retryable: z.boolean().optional(),
  details: ProtocolErrorDetailsSchema.optional(),
}).strict();

const AgentMessageV1BaseSchema = z.discriminatedUnion('type', [
  SessionOpenSchema,
  SessionAcceptedSchema,
  ObservationSubmittedSchema,
  ActionCommandMessageSchema,
  ActionAcknowledgedSchema,
  ActionCompletedSchema,
  ApprovalRequestedSchema,
  ApprovalResolvedSchema,
  TaskCompletedSchema,
  TaskFailedSchema,
  TaskCancelledSchema,
  ReconcileRequestSchema,
  ReconcileResponseSchema,
  HeartbeatSchema,
  ProtocolErrorSchema,
]);

/** The application message union; raw CDP frames are intentionally not representable. */
export const AgentMessageV1Schema = AgentMessageV1BaseSchema.superRefine((message, context) => {
  try {
    assertNoForbiddenBrowserData(message);
  } catch (error) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : 'Forbidden browser data' });
  }
});

export type AgentMessageV1 = z.infer<typeof AgentMessageV1Schema>;
