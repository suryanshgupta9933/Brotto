import { z } from 'zod';
import {
  ActionIdSchema,
  EventIdSchema,
  ObservationIdSchema,
  SequenceSchema,
  SessionIdSchema,
  StepIdSchema,
  TaskIdSchema,
} from './ids';
import { ActionCommandV1Schema, ActionProposalV1Schema, PolicyDecisionV1Schema } from './actions';
import { assertNoForbiddenBrowserData, ForbiddenBrowserDataError, ObservationV1Schema } from './observation';
import { ActionResultV1Schema } from './results';

export const TrajectoryEventKindV1Schema = z.enum([
  'session_lifecycle',
  'observation_captured',
  'model_request',
  'model_response',
  'model_parse_failure',
  'action_proposed',
  'policy_decided',
  'approval_requested',
  'approval_resolved',
  'action_acknowledged',
  'action_completed',
  'verification_result',
  'task_terminal_outcome',
]);

export const TrajectoryEventV1Schema = z.object({
  eventId: EventIdSchema,
  sessionId: SessionIdSchema,
  taskId: TaskIdSchema,
  stepId: StepIdSchema.optional(),
  actionId: ActionIdSchema.optional(),
  observationId: ObservationIdSchema.optional(),
  correlationId: z.string().uuid().optional(),
  causationId: EventIdSchema.optional(),
  sequence: SequenceSchema,
  occurredAt: z.string().datetime(),
  kind: TrajectoryEventKindV1Schema,
  summary: z.string().max(2_000).optional(),
}).strict().superRefine((value, context) => {
  try {
    assertNoForbiddenBrowserData(value);
  } catch (error) {
    if (error instanceof ForbiddenBrowserDataError) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: error.message });
      return;
    }
    throw error;
  }
});

export const TrajectoryLinkageV1Schema = z.object({
  sourceObservation: ObservationV1Schema,
  proposal: ActionProposalV1Schema,
  command: ActionCommandV1Schema,
  policyDecision: PolicyDecisionV1Schema,
  result: ActionResultV1Schema,
}).strict().superRefine((value, context) => {
  const { command, policyDecision, proposal, result, sourceObservation } = value;

  if (sourceObservation.observationId !== proposal.observationId || proposal.observationId !== command.observationId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['command', 'observationId'], message: 'Command must reference the proposal observation' });
  }
  if (JSON.stringify(proposal.action) !== JSON.stringify(command.action)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['command', 'action'], message: 'Command action must match the proposal action' });
  }
  if (policyDecision.policyDecisionId !== command.policyContext.policyDecisionId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['policyDecision', 'policyDecisionId'], message: 'Policy decision must match the command policy context' });
  }
  if (policyDecision.actionId !== command.actionId || policyDecision.observationId !== command.observationId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['policyDecision'], message: 'Policy decision must reference the command action and observation' });
  }
  const hasApprovalProof = command.policyContext.approved && command.policyContext.approvalId !== undefined;
  if (policyDecision.decision === 'allowed' && ['rejected_policy', 'approval_required'].includes(result.status)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['result', 'status'], message: 'Allowed policy decisions cannot produce policy rejection or approval-required results' });
  }
  if (policyDecision.decision === 'denied' && result.status !== 'rejected_policy') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['result', 'status'], message: 'Denied policy decisions require a rejected_policy result' });
  }
  if (policyDecision.decision === 'approval_required' && !hasApprovalProof && result.status !== 'approval_required') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['result', 'status'], message: 'Unproven approval-required decisions require an approval_required result' });
  }
  if (policyDecision.decision === 'approval_required' && hasApprovalProof && ['rejected_policy', 'approval_required'].includes(result.status)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['result', 'status'], message: 'Approved decisions cannot produce policy rejection or approval-required results' });
  }
  if (
    result.actionId !== command.actionId ||
    result.stepId !== command.stepId ||
    result.observationId !== command.observationId ||
    result.sequence <= command.sequence
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['result'], message: 'Result must follow the command and preserve its identifiers' });
  }
  const sourceCapturedAt = Date.parse(sourceObservation.capturedAt);
  const proposedAt = Date.parse(proposal.proposedAt);
  const decidedAt = Date.parse(policyDecision.decidedAt);
  const dispatchedAt = Date.parse(command.dispatchedAt);
  const startedAt = Date.parse(result.startedAt);
  const completedAt = Date.parse(result.completedAt);
  if (!(
    sourceCapturedAt <= proposedAt &&
    proposedAt <= decidedAt &&
    decidedAt <= dispatchedAt &&
    dispatchedAt <= startedAt &&
    startedAt <= completedAt &&
    sourceCapturedAt < dispatchedAt &&
    proposedAt < dispatchedAt
  )) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['result', 'startedAt'], message: 'Observation, proposal, policy, dispatch, and execution timestamps must be chronological' });
  }
  if (result.status === 'succeeded' && result.postObservation.observationId === command.observationId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['result', 'postObservation', 'observationId'], message: 'Successful action requires a newer post-observation' });
  }
  if (result.status === 'succeeded' && Date.parse(result.postObservation.capturedAt) <= completedAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['result', 'postObservation', 'capturedAt'], message: 'Successful action post-observation must be captured after completion' });
  }
});

export type TrajectoryEventKindV1 = z.infer<typeof TrajectoryEventKindV1Schema>;
export type TrajectoryEventV1 = z.infer<typeof TrajectoryEventV1Schema>;
export type TrajectoryLinkageV1 = z.infer<typeof TrajectoryLinkageV1Schema>;
