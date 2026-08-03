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
import { assertNoForbiddenBrowserData, ForbiddenBrowserDataError } from './observation';

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

export type TrajectoryEventKindV1 = z.infer<typeof TrajectoryEventKindV1Schema>;
export type TrajectoryEventV1 = z.infer<typeof TrajectoryEventV1Schema>;
