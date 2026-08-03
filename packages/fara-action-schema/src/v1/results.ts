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

export const ActionResultV1Schema = z.object({
  actionId: ActionIdSchema,
  stepId: StepIdSchema,
  observationId: ObservationIdSchema,
  sequence: SequenceSchema,
  status: ActionResultStatusV1Schema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  target: SemanticTargetSchema.optional(),
  navigation: NavigationEffectV1Schema.optional(),
  dialog: DialogEffectV1Schema.optional(),
  error: ActionErrorV1Schema.optional(),
  postObservation: ObservationV1Schema.optional(),
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

export { ActionResultStatusV1Schema, ActionErrorV1Schema, DialogEffectV1Schema, NavigationEffectV1Schema };
export type ActionResultStatusV1 = z.infer<typeof ActionResultStatusV1Schema>;
export type ActionErrorV1 = z.infer<typeof ActionErrorV1Schema>;
export type NavigationEffectV1 = z.infer<typeof NavigationEffectV1Schema>;
export type DialogEffectV1 = z.infer<typeof DialogEffectV1Schema>;
export type ActionResultV1 = z.infer<typeof ActionResultV1Schema>;
