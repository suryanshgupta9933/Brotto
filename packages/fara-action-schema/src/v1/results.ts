import { z } from 'zod';
import { ActionIdSchema, ObservationIdSchema, SequenceSchema, StepIdSchema } from './ids';
import { assertNoForbiddenBrowserData, ForbiddenBrowserDataError, isHttpUrl, ObservationV1Schema, SemanticTargetSchema } from './observation';

const ActionResultStatusV1Schema = z.enum([
  'succeeded',
  'failed_recoverable',
  'failed_terminal',
  'rejected_stale',
  'rejected_policy',
  'approval_required',
  'cancelled',
]);

const ActionErrorV1Schema = z.object({
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(2_000),
  retryable: z.boolean(),
}).strict();

const NavigationEffectV1Schema = z.object({
  url: z.string().url().refine(isHttpUrl, 'Only HTTP(S) URLs are allowed'),
  title: z.string().max(512).optional(),
}).strict();

const DialogEffectV1Schema = z.object({
  kind: z.enum(['alert', 'confirm', 'prompt', 'beforeunload']),
  present: z.boolean(),
}).strict();

const ActionResultBaseV1Schema = z.object({
  actionId: ActionIdSchema,
  stepId: StepIdSchema,
  observationId: ObservationIdSchema,
  sequence: SequenceSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  target: SemanticTargetSchema.optional(),
  navigation: NavigationEffectV1Schema.optional(),
  dialog: DialogEffectV1Schema.optional(),
});

const SucceededActionResultV1Schema = ActionResultBaseV1Schema.extend({
  status: z.literal('succeeded'),
  postObservation: ObservationV1Schema,
}).strict();

const FailedActionResultV1Schema = ActionResultBaseV1Schema.extend({
  status: z.enum(['failed_recoverable', 'failed_terminal']),
  error: ActionErrorV1Schema,
  postObservation: ObservationV1Schema,
}).strict();

const RejectedActionResultV1Schema = ActionResultBaseV1Schema.extend({
  status: z.enum(['rejected_stale', 'rejected_policy', 'approval_required']),
  rejection: ActionErrorV1Schema,
}).strict();

const CancelledActionResultV1Schema = ActionResultBaseV1Schema.extend({
  status: z.literal('cancelled'),
  cancellation: z.object({ reason: z.string().min(1).max(2_000).optional() }).strict(),
  postObservation: ObservationV1Schema,
}).strict();

export const ActionResultV1Schema = z.union([
  SucceededActionResultV1Schema,
  FailedActionResultV1Schema,
  RejectedActionResultV1Schema,
  CancelledActionResultV1Schema,
]).superRefine((value, context) => {
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

export {
  ActionResultStatusV1Schema,
  ActionErrorV1Schema,
  CancelledActionResultV1Schema,
  DialogEffectV1Schema,
  FailedActionResultV1Schema,
  NavigationEffectV1Schema,
  RejectedActionResultV1Schema,
  SucceededActionResultV1Schema,
};
export type ActionResultStatusV1 = z.infer<typeof ActionResultStatusV1Schema>;
export type ActionErrorV1 = z.infer<typeof ActionErrorV1Schema>;
export type NavigationEffectV1 = z.infer<typeof NavigationEffectV1Schema>;
export type DialogEffectV1 = z.infer<typeof DialogEffectV1Schema>;
export type ActionResultV1 = z.infer<typeof ActionResultV1Schema>;
