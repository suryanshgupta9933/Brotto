/**
 * Action result types for Fara actions.
 * Defines success and failure states for action execution.
 */

import type { ActionType, FaraAction } from './actions';

/**
 * Error codes for action failures.
 */
export enum ActionErrorCode {
  /** Action execution timed out */
  TIMEOUT = 'timeout',
  /** Target element not found */
  ELEMENT_NOT_FOUND = 'element_not_found',
  /** Invalid coordinates (out of bounds) */
  INVALID_COORDINATES = 'invalid_coordinates',
  /** Invalid URL format */
  INVALID_URL = 'invalid_url',
  /** Navigation failed */
  NAVIGATION_FAILED = 'navigation_failed',
  /** Permission denied */
  PERMISSION_DENIED = 'permission_denied',
  /** Action cancelled */
  CANCELLED = 'cancelled',
  /** Action not supported */
  NOT_SUPPORTED = 'not_supported',
  /** Unknown error */
  UNKNOWN = 'unknown',
}

/**
 * Error details for action failures.
 */
export interface ActionError {
  /** Error code */
  code: ActionErrorCode;
  /** Human-readable error message */
  message: string;
  /** Optional additional context */
  details?: Record<string, unknown>;
}

/**
 * Base interface for action results.
 */
export interface BaseActionResult<T extends ActionType> {
  /** The action this result corresponds to */
  readonly actionType: T;
  /** Whether the action succeeded */
  readonly success: boolean;
  /** Timestamp when result was generated (Unix epoch ms) */
  readonly timestamp: number;
}

/**
 * Success result for an action.
 */
export interface ActionSuccessResult<T extends ActionType> extends BaseActionResult<T> {
  /** Always true for success */
  readonly success: true;
  /** Optional data returned by the action */
  readonly data?: ActionSuccessData;
}

/**
 * Data returned by successful action execution.
 */
export interface ActionSuccessData {
  /** Screenshot data if screenshot was taken (base64 encoded) */
  screenshot?: string;
  /** Page title if navigation occurred */
  pageTitle?: string;
  /** URL after navigation */
  url?: string;
  /** Console messages if captured */
  consoleMessages?: string[];
  /** Cookies if captured */
  cookies?: CookieData[];
  /** Local storage if captured */
  localStorage?: Record<string, string>;
}

/**
 * Cookie data structure.
 */
export interface CookieData {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * Failure result for an action.
 */
export interface ActionFailureResult<T extends ActionType> extends BaseActionResult<T> {
  /** Always false for failure */
  readonly success: false;
  /** Error information */
  readonly error: ActionError;
}

/**
 * Union type of all action results.
 */
export type ActionResult =
  | ActionSuccessResult<ActionType>
  | ActionFailureResult<ActionType>;

/**
 * Result for left click action.
 */
export type LeftClickResult = ActionSuccessResult<ActionType.LEFT_CLICK> | ActionFailureResult<ActionType.LEFT_CLICK>;

/**
 * Result for double click action.
 */
export type DoubleClickResult = ActionSuccessResult<ActionType.DOUBLE_CLICK> | ActionFailureResult<ActionType.DOUBLE_CLICK>;

/**
 * Result for right click action.
 */
export type RightClickResult = ActionSuccessResult<ActionType.RIGHT_CLICK> | ActionFailureResult<ActionType.RIGHT_CLICK>;

/**
 * Result for drag action.
 */
export type DragResult = ActionSuccessResult<ActionType.DRAG> | ActionFailureResult<ActionType.DRAG>;

/**
 * Result for mouse move action.
 */
export type MouseMoveResult = ActionSuccessResult<ActionType.MOUSE_MOVE> | ActionFailureResult<ActionType.MOUSE_MOVE>;

/**
 * Result for scroll action.
 */
export type ScrollResult = ActionSuccessResult<ActionType.SCROLL> | ActionFailureResult<ActionType.SCROLL>;

/**
 * Result for key action.
 */
export type KeyResult = ActionSuccessResult<ActionType.KEY> | ActionFailureResult<ActionType.KEY>;

/**
 * Result for visit URL action.
 */
export type VisitUrlResult = ActionSuccessResult<ActionType.VISIT_URL> | ActionFailureResult<ActionType.VISIT_URL>;

/**
 * Result for history back action.
 */
export type HistoryBackResult = ActionSuccessResult<ActionType.HISTORY_BACK> | ActionFailureResult<ActionType.HISTORY_BACK>;

/**
 * Result for screenshot action.
 */
export type ScreenshotResult = ActionSuccessResult<ActionType.SCREENSHOT> | ActionFailureResult<ActionType.SCREENSHOT>;

/**
 * Result for wait action.
 */
export type WaitResult = ActionSuccessResult<ActionType.WAIT> | ActionFailureResult<ActionType.WAIT>;

/**
 * Result for ask user question action.
 */
export type AskUserQuestionResult = ActionSuccessResult<ActionType.ASK_USER_QUESTION> | ActionFailureResult<ActionType.ASK_USER_QUESTION>;

/**
 * Result for terminate action.
 */
export type TerminateResult = ActionSuccessResult<ActionType.TERMINATE> | ActionFailureResult<ActionType.TERMINATE>;

/**
 * Result for pause and memorize fact action.
 */
export type PauseAndMemorizeFactResult = ActionSuccessResult<ActionType.PAUSE_AND_MEMORIZE_FACT> | ActionFailureResult<ActionType.PAUSE_AND_MEMORIZE_FACT>;

/**
 * Creates a success result.
 */
export function createActionSuccess<T extends ActionType>(
  actionType: T,
  data?: ActionSuccessData
): ActionSuccessResult<T> {
  return {
    actionType,
    success: true,
    timestamp: Date.now(),
    data,
  };
}

/**
 * Creates a failure result.
 */
export function createActionFailure<T extends ActionType>(
  actionType: T,
  errorCode: ActionErrorCode,
  message: string,
  details?: Record<string, unknown>
): ActionFailureResult<T> {
  return {
    actionType,
    success: false,
    timestamp: Date.now(),
    error: {
      code: errorCode,
      message,
      details,
    },
  };
}
