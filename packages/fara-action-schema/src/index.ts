/**
 * Fara Action Schema - Public API
 *
 * Shared library containing the Fara action schema and validation logic.
 * Defines the canonical set of actions the Fara model can produce and their validation rules.
 */

export * from './v1';
// The legacy numeric ObservationId remains a top-level export below. Use this
// explicit alias for the canonical v1 branded UUID when importing from root.
export type { ObservationId as ObservationV1Id } from './v1/ids';

// Types and enums
export {
  ActionType,
  type BaseAction,
  type ViewportContext,
  type LeftClickAction,
  type DoubleClickAction,
  type RightClickAction,
  type DragAction,
  type MouseMoveAction,
  type ScrollAction,
  type KeyAction,
  type KeyModifiers,
  type VisitUrlAction,
  type HistoryBackAction,
  type ScreenshotAction,
  type WaitAction,
  type AskUserQuestionAction,
  type TerminateAction,
  type PauseAndMemorizeFactAction,
  type FaraAction,
  isViewportAction,
  isNavigationAction,
} from './actions';

// Coordinate types
export {
  type Coordinates,
  type BoundingBox,
  type Viewport,
  type ViewportConfig,
  type NormalizedCoordinates,
  type DragCoordinates,
  type ScrollDelta,
  type ViewportBounds,
  createDefaultViewport,
  createDefaultViewportConfig,
} from './coordinates';

// Observation ID types
export {
  type ObservationId,
  createObservationId,
  compareObservationIds,
  isValidObservationId,
  getNextObservationId,
  ObservationIdCounter,
} from './observation';

// Action result types
export {
  ActionErrorCode,
  type ActionError,
  type BaseActionResult,
  type ActionSuccessResult,
  type ActionSuccessData,
  type ActionFailureResult,
  type ActionResult,
  type LeftClickResult,
  type DoubleClickResult,
  type RightClickResult,
  type DragResult,
  type MouseMoveResult,
  type ScrollResult,
  type KeyResult,
  type VisitUrlResult,
  type HistoryBackResult,
  type ScreenshotResult,
  type WaitResult,
  type AskUserQuestionResult,
  type TerminateResult,
  type PauseAndMemorizeFactResult,
  createActionSuccess,
  createActionFailure,
} from './results';

// MCP mapping types
export {
  McpToolName,
  type MouseClickParams,
  type MouseDragParams,
  type MouseMoveParams,
  type MouseWheelParams,
  type PressKeyParams,
  type NavigateParams,
  type NavigateBackParams,
  type TakeScreenshotParams,
  type McpToolParams,
  FARA_ACTION_TO_MCP_TOOL,
  mapActionToMcpParams,
  isMcpAction,
  getMcpToolName,
  ActionExecutionType,
  getActionExecutionType,
} from './mcp-mapping';

// Validation schemas and utilities
export {
  CoordinatesSchema,
  DragCoordinatesSchema,
  ScrollDeltaSchema,
  ViewportContextSchema,
  KeyModifiersSchema,
  LeftClickArgsSchema,
  DoubleClickArgsSchema,
  RightClickArgsSchema,
  DragArgsSchema,
  MouseMoveArgsSchema,
  ScrollArgsSchema,
  KeyArgsSchema,
  VisitUrlArgsSchema,
  HistoryBackArgsSchema,
  ScreenshotArgsSchema,
  WaitArgsSchema,
  AskUserQuestionArgsSchema,
  TerminateArgsSchema,
  PauseAndMemorizeFactArgsSchema,
  FaraActionArgsSchema,
  type FaraActionArgs,
  validateActionArgs,
  tryValidateActionArgs,
  validateCoordinatesInBounds,
  assertCoordinatesInBounds,
} from './validation';
