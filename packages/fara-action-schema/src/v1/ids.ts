import { z } from 'zod';

export const SessionIdSchema = z.string().uuid().brand<'SessionId'>();
export const RunIdSchema = z.string().uuid().brand<'RunId'>();
export const TaskIdSchema = z.string().uuid().brand<'TaskId'>();
export const StepIdSchema = z.string().uuid().brand<'StepId'>();
export const ObservationIdSchema = z.string().uuid().brand<'ObservationId'>();
export const ActionIdSchema = z.string().uuid().brand<'ActionId'>();
export const PolicyDecisionIdSchema = z.string().uuid().brand<'PolicyDecisionId'>();
export const EventIdSchema = z.string().uuid().brand<'EventId'>();
export const MessageIdSchema = z.string().uuid().brand<'MessageId'>();
export const ArtifactIdSchema = z.string().uuid().brand<'ArtifactId'>();
export const SemanticTargetIdSchema = z.string().uuid().brand<'SemanticTargetId'>();
export const TabIdSchema = z.string().uuid().brand<'TabId'>();
export const FrameIdSchema = z.string().uuid().brand<'FrameId'>();
export const FramePathSegmentIdSchema = z.string().uuid().brand<'FramePathSegmentId'>();
export const ShadowPathSegmentIdSchema = z.string().uuid().brand<'ShadowPathSegmentId'>();
export const ApprovalIdSchema = z.string().uuid().brand<'ApprovalId'>();

export const SequenceSchema = z.number().int().nonnegative();
export const IdempotencyKeySchema = z.string().min(1).max(256);

export type SessionId = z.infer<typeof SessionIdSchema>;
export type RunId = z.infer<typeof RunIdSchema>;
export type TaskId = z.infer<typeof TaskIdSchema>;
export type StepId = z.infer<typeof StepIdSchema>;
export type ObservationId = z.infer<typeof ObservationIdSchema>;
export type ActionId = z.infer<typeof ActionIdSchema>;
export type PolicyDecisionId = z.infer<typeof PolicyDecisionIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type MessageId = z.infer<typeof MessageIdSchema>;
export type ArtifactId = z.infer<typeof ArtifactIdSchema>;
export type SemanticTargetId = z.infer<typeof SemanticTargetIdSchema>;
export type TabId = z.infer<typeof TabIdSchema>;
export type FrameId = z.infer<typeof FrameIdSchema>;
export type FramePathSegmentId = z.infer<typeof FramePathSegmentIdSchema>;
export type ShadowPathSegmentId = z.infer<typeof ShadowPathSegmentIdSchema>;
export type ApprovalId = z.infer<typeof ApprovalIdSchema>;
export type Sequence = z.infer<typeof SequenceSchema>;
