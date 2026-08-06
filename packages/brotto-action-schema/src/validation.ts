/**
 * Zod validation schemas for Brotto action arguments.
 */

import { z } from 'zod';
import { ActionType } from './actions';

/**
 * Coordinates schema.
 */
export const CoordinatesSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});

/**
 * Drag coordinates schema.
 */
export const DragCoordinatesSchema = z.object({
  start: CoordinatesSchema,
  end: CoordinatesSchema,
});

/**
 * Scroll delta schema.
 */
export const ScrollDeltaSchema = z.object({
  deltaX: z.number().int(),
  deltaY: z.number().int(),
});

/**
 * Viewport context schema.
 */
export const ViewportContextSchema = z.object({
  viewportWidth: z.number().int().positive(),
  viewportHeight: z.number().int().positive(),
});

/**
 * Key modifiers schema.
 */
export const KeyModifiersSchema = z.object({
  ctrl: z.boolean().optional(),
  shift: z.boolean().optional(),
  alt: z.boolean().optional(),
  meta: z.boolean().optional(),
});

/**
 * Base action arguments schema.
 */
const BaseActionArgsSchema = z.object({
  id: z.string().min(1),
  observationId: z.number().int().min(0),
  timestamp: z.number().int().positive(),
});

/**
 * Left click action arguments schema.
 */
export const LeftClickArgsSchema = BaseActionArgsSchema.extend({
  type: z.literal(ActionType.LEFT_CLICK),
  coordinates: CoordinatesSchema,
  viewport: ViewportContextSchema,
});

/**
 * Double click action arguments schema.
 */
export const DoubleClickArgsSchema = BaseActionArgsSchema.extend({
  type: z.literal(ActionType.DOUBLE_CLICK),
  coordinates: CoordinatesSchema,
  viewport: ViewportContextSchema,
});

/**
 * Right click action arguments schema.
 */
export const RightClickArgsSchema = BaseActionArgsSchema.extend({
  type: z.literal(ActionType.RIGHT_CLICK),
  coordinates: CoordinatesSchema,
  viewport: ViewportContextSchema,
});

/**
 * Drag action arguments schema.
 */
export const DragArgsSchema = BaseActionArgsSchema.extend({
  type: z.literal(ActionType.DRAG),
  coordinates: DragCoordinatesSchema,
  viewport: ViewportContextSchema,
});

/**
 * Mouse move action arguments schema.
 */
export const MouseMoveArgsSchema = BaseActionArgsSchema.extend({
  type: z.literal(ActionType.MOUSE_MOVE),
  coordinates: CoordinatesSchema,
  viewport: ViewportContextSchema,
});

/**
 * Scroll action arguments schema.
 */
export const ScrollArgsSchema = BaseActionArgsSchema.extend({
  type: z.literal(ActionType.SCROLL),
  coordinates: CoordinatesSchema,
  delta: ScrollDeltaSchema,
  viewport: ViewportContextSchema,
});

/**
 * Key action arguments schema.
 */
export const KeyArgsSchema = BaseActionArgsSchema.extend({
  type: z.literal(ActionType.KEY),
  key: z.string().min(1),
  modifiers: KeyModifiersSchema.optional(),
});

/**
 * Visit URL action arguments schema.
 */
export const VisitUrlArgsSchema = BaseActionArgsSchema.extend({
  type: z.literal(ActionType.VISIT_URL),
  url: z.string().url(),
  timeout: z.number().int().positive().optional(),
});

/**
 * History back action arguments schema.
 */
export const HistoryBackArgsSchema = BaseActionArgsSchema.extend({
  type: z.literal(ActionType.HISTORY_BACK),
  steps: z.number().int().positive().optional(),
});

/**
 * Screenshot action arguments schema.
 */
export const ScreenshotArgsSchema = BaseActionArgsSchema.extend({
  type: z.literal(ActionType.SCREENSHOT),
  fullPage: z.boolean().optional(),
});

/**
 * Wait action arguments schema.
 */
export const WaitArgsSchema = BaseActionArgsSchema.extend({
  type: z.literal(ActionType.WAIT),
  durationMs: z.number().int().positive(),
});

/**
 * Ask user question action arguments schema.
 */
export const AskUserQuestionArgsSchema = BaseActionArgsSchema.extend({
  type: z.literal(ActionType.ASK_USER_QUESTION),
  question: z.string().min(1),
  context: z.string().optional(),
  choices: z.array(z.string()).optional(),
});

/**
 * Terminate action arguments schema.
 */
export const TerminateArgsSchema = BaseActionArgsSchema.extend({
  type: z.literal(ActionType.TERMINATE),
  reason: z.string().optional(),
});

/**
 * Pause and memorize fact action arguments schema.
 */
export const PauseAndMemorizeFactArgsSchema = BaseActionArgsSchema.extend({
  type: z.literal(ActionType.PAUSE_AND_MEMORIZE_FACT),
  fact: z.string().min(1),
  category: z.string().optional(),
});

/**
 * Insert text action arguments schema.
 */
export const InsertTextArgsSchema = BaseActionArgsSchema.extend({
  type: z.literal(ActionType.INSERT_TEXT),
  text: z.string().min(1),
  targetId: z.string().optional(),
});

/**
 * Memorize fact action arguments schema.
 */
export const MemorizeFactArgsSchema = BaseActionArgsSchema.extend({
  type: z.literal(ActionType.MEMORIZE_FACT),
  fact: z.string().min(1),
  category: z.string().optional(),
});

/**
 * Union of all action argument schemas.
 */
export const FaraActionArgsSchema = z.union([
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
  MemorizeFactArgsSchema,
]);

/**
 * TypeScript type inferred from the action arguments schema.
 */
export type FaraActionArgs = z.infer<typeof FaraActionArgsSchema>;

/**
 * Validates action arguments against the appropriate schema.
 * Returns the validated data or throws a ZodError.
 */
export function validateActionArgs(args: unknown): FaraActionArgs {
  return FaraActionArgsSchema.parse(args);
}

/**
 * Safely validates action arguments.
 * Returns the validated data or null if validation fails.
 */
export function tryValidateActionArgs(args: unknown): FaraActionArgs | null {
  return FaraActionArgsSchema.safeParse(args).success
    ? (FaraActionArgsSchema.parse(args) as FaraActionArgs)
    : null;
}

/**
 * Validates coordinates are within viewport bounds.
 */
export function validateCoordinatesInBounds(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number
): boolean {
  return x >= 0 && x < viewportWidth && y >= 0 && y < viewportHeight;
}

/**
 * Validates that coordinates are within viewport bounds.
 * Throws if validation fails.
 */
export function assertCoordinatesInBounds(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number
): void {
  if (!validateCoordinatesInBounds(x, y, viewportWidth, viewportHeight)) {
    throw new Error(
      `Coordinates (${x}, ${y}) are out of bounds for viewport ${viewportWidth}x${viewportHeight}`
    );
  }
}
