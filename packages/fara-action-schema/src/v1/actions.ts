import { z } from 'zod';
import {
  ActionIdSchema,
  ApprovalIdSchema,
  IdempotencyKeySchema,
  ObservationIdSchema,
  PolicyDecisionIdSchema,
  SemanticTargetIdSchema,
  SequenceSchema,
  StepIdSchema,
} from './ids';
import { assertNoForbiddenBrowserData, ForbiddenBrowserDataError, isHttpUrl } from './observation';

function guardedStrictObject<T extends z.AnyZodObject>(schema: T) {
  return schema.superRefine((value, context) => {
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
}

const CoordinateSchema = z.number().int().nonnegative();
const KeyModifiersSchema = z.object({
  ctrl: z.boolean().optional(),
  shift: z.boolean().optional(),
  alt: z.boolean().optional(),
  meta: z.boolean().optional(),
}).strict();

export const ExecutableActionV1Schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('left_click'), x: CoordinateSchema, y: CoordinateSchema, targetId: SemanticTargetIdSchema.optional() }).strict(),
  z.object({ type: z.literal('double_click'), x: CoordinateSchema, y: CoordinateSchema, targetId: SemanticTargetIdSchema.optional() }).strict(),
  z.object({ type: z.literal('right_click'), x: CoordinateSchema, y: CoordinateSchema, targetId: SemanticTargetIdSchema.optional() }).strict(),
  z.object({ type: z.literal('drag'), startX: CoordinateSchema, startY: CoordinateSchema, endX: CoordinateSchema, endY: CoordinateSchema }).strict(),
  z.object({ type: z.literal('mouse_move'), x: CoordinateSchema, y: CoordinateSchema }).strict(),
  z.object({ type: z.literal('scroll'), deltaX: z.number().int(), deltaY: z.number().int() }).strict(),
  z.object({ type: z.literal('key'), key: z.string().min(1).max(128), modifiers: KeyModifiersSchema.optional() }).strict(),
  z.object({ type: z.literal('insert_text'), text: z.string().min(1).max(10_000), targetId: SemanticTargetIdSchema.optional() }).strict(),
  z.object({ type: z.literal('visit_url'), url: z.string().url().refine(isHttpUrl, 'Only HTTP(S) navigation URLs are allowed') }).strict(),
  z.object({ type: z.literal('history_back'), steps: z.number().int().positive().max(20).default(1) }).strict(),
  z.object({ type: z.literal('wait'), durationMs: z.number().int().positive().max(60_000) }).strict(),
  z.object({ type: z.literal('ask_user_question'), question: z.string().min(1).max(2_000), choices: z.array(z.string().min(1).max(256)).max(20).optional() }).strict(),
  z.object({ type: z.literal('memorize_fact'), fact: z.string().min(1).max(2_000), category: z.string().min(1).max(128).optional() }).strict(),
]);

export const ActionProposalV1Schema = guardedStrictObject(z.object({
  kind: z.literal('action'),
  observationId: ObservationIdSchema,
  proposedAt: z.string().datetime(),
  action: ExecutableActionV1Schema,
}).strict());

export const CompletionFindingV1Schema = z.object({
  fact: z.string().min(1).max(2_000),
  observationIds: z.array(ObservationIdSchema).min(1).max(20),
}).strict();

export const CompletionProposalV1Schema = guardedStrictObject(z.object({
  kind: z.literal('completion'),
  observationId: ObservationIdSchema,
  type: z.literal('terminate'),
  status: z.enum(['succeeded', 'partial', 'failed']),
  summary: z.string().min(1).max(4_000),
  findings: z.array(CompletionFindingV1Schema).max(100),
  unmetCriteria: z.array(z.string().min(1).max(1_000)).max(100),
  confidence: z.number().min(0).max(1),
}).strict()).superRefine((value, context) => {
  if (value.status === 'succeeded' && value.findings.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['findings'],
      message: 'Successful completion requires findings with observation evidence',
    });
  }
});

export const AgentProposalV1Schema = z.union([
  ActionProposalV1Schema,
  CompletionProposalV1Schema,
]);

export const PolicyContextV1Schema = z.object({
  policyDecisionId: PolicyDecisionIdSchema,
  policyVersion: z.string().min(1).max(128),
  approved: z.boolean(),
  approvalId: ApprovalIdSchema.optional(),
}).strict();

export const PolicyDecisionV1Schema = guardedStrictObject(z.object({
  policyDecisionId: PolicyDecisionIdSchema,
  actionId: ActionIdSchema,
  observationId: ObservationIdSchema,
  decision: z.enum(['allowed', 'denied', 'approval_required']),
  decidedAt: z.string().datetime(),
}).strict());

export const ApprovalResolutionV1Schema = guardedStrictObject(z.object({
  approvalId: ApprovalIdSchema,
  policyDecisionId: PolicyDecisionIdSchema,
  actionId: ActionIdSchema,
  status: z.enum(['approved', 'denied']),
  resolvedAt: z.string().datetime(),
}).strict());

export const ActionCommandV1Schema = guardedStrictObject(z.object({
  actionId: ActionIdSchema,
  stepId: StepIdSchema,
  observationId: ObservationIdSchema,
  sequence: SequenceSchema,
  action: ExecutableActionV1Schema,
  policyContext: PolicyContextV1Schema,
  dispatchedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  idempotencyKey: IdempotencyKeySchema,
}).strict());

export type ExecutableActionV1 = z.infer<typeof ExecutableActionV1Schema>;
export type ActionProposalV1 = z.infer<typeof ActionProposalV1Schema>;
export type CompletionFindingV1 = z.infer<typeof CompletionFindingV1Schema>;
export type CompletionProposalV1 = z.infer<typeof CompletionProposalV1Schema>;
export type AgentProposalV1 = z.infer<typeof AgentProposalV1Schema>;
export type PolicyContextV1 = z.infer<typeof PolicyContextV1Schema>;
export type PolicyDecisionV1 = z.infer<typeof PolicyDecisionV1Schema>;
export type ApprovalResolutionV1 = z.infer<typeof ApprovalResolutionV1Schema>;
export type ActionCommandV1 = z.infer<typeof ActionCommandV1Schema>;
