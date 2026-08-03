import { z } from 'zod';
import {
  ActionCommandV1Schema,
  ActionIdSchema,
  ActionResultV1Schema,
  ApprovalIdSchema,
  ApprovalResolutionV1Schema,
  assertNoForbiddenBrowserData,
  ObservationIdSchema,
  ObservationV1Schema,
  PolicyDecisionIdSchema,
  SequenceSchema,
  StepIdSchema,
  TaskIdSchema,
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

const TaskTerminalPayloadSchema = z.object({
  taskId: TaskIdSchema,
  occurredAt: TimestampSchema,
  summary: z.string().min(1).max(4_000),
  findings: z.array(z.object({
    fact: z.string().min(1).max(2_000),
    observationIds: z.array(ObservationIdSchema).min(1).max(20),
  }).strict()).max(100).optional(),
  unmetCriteria: z.array(z.string().min(1).max(1_000)).max(100).optional(),
  reason: z.string().min(1).max(2_000).optional(),
}).strict();

const TaskCompletedSchema = z.object({
  type: z.literal('task.completed'),
  payload: TaskTerminalPayloadSchema.extend({ status: z.enum(['succeeded', 'partial']) }),
}).strict();

const TaskFailedSchema = z.object({
  type: z.literal('task.failed'),
  payload: TaskTerminalPayloadSchema.extend({ status: z.literal('failed'), reason: z.string().min(1).max(2_000) }),
}).strict();

const TaskCancelledSchema = z.object({
  type: z.literal('task.cancelled'),
  payload: TaskTerminalPayloadSchema.extend({ status: z.literal('cancelled'), reason: z.string().min(1).max(2_000) }),
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
