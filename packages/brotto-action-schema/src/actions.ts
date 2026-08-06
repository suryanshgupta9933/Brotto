/**
 * Brotto action type definitions.
 * Defines all actions the Brotto model can produce for browser automation.
 */

import type { Coordinates, DragCoordinates, ScrollDelta } from './coordinates';
import type { ObservationId } from './observation';

/**
 * Enum of all Brotto action types.
 */
export enum ActionType {
  LEFT_CLICK = 'left_click',
  DOUBLE_CLICK = 'double_click',
  RIGHT_CLICK = 'right_click',
  DRAG = 'drag',
  MOUSE_MOVE = 'mouse_move',
  SCROLL = 'scroll',
  KEY = 'key',
  INSERT_TEXT = 'insert_text',
  VISIT_URL = 'visit_url',
  HISTORY_BACK = 'history_back',
  SCREENSHOT = 'screenshot',
  WAIT = 'wait',
  ASK_USER_QUESTION = 'ask_user_question',
  TERMINATE = 'terminate',
  PAUSE_AND_MEMORIZE_FACT = 'pause_and_memorize_fact',
  MEMORIZE_FACT = 'memorize_fact',
}

/**
 * Base interface for all Brotto actions.
 */
export interface BaseAction<T extends ActionType> {
  /** Unique identifier for this action instance */
  readonly id: string;
  /** The type of action */
  readonly type: T;
  /** Observation ID this action is based on */
  readonly observationId: ObservationId;
  /** Timestamp when action was created (Unix epoch ms) */
  readonly timestamp: number;
  /**
   * One-sentence plain-English description of what the agent is doing and why
   * (e.g. "Navigating to the GitHub profile to find the follower count.").
   * Surfaced to the user as the assistant bubble title. Model-required but
   * parsers fall back gracefully when omitted.
   */
  readonly reasoning: string;
}

/**
 * Action arguments that include viewport context.
 */
export interface ViewportContext {
  /** Viewport width at time of action */
  viewportWidth: number;
  /** Viewport height at time of action */
  viewportHeight: number;
}

/**
 * Left click action - clicks at viewport coordinates.
 */
export interface LeftClickAction extends BaseAction<ActionType.LEFT_CLICK> {
  /** Target coordinates in viewport space */
  coordinates: Coordinates;
  /** Viewport context */
  viewport: ViewportContext;
}

/**
 * Double click action - double-clicks at viewport coordinates.
 */
export interface DoubleClickAction extends BaseAction<ActionType.DOUBLE_CLICK> {
  /** Target coordinates in viewport space */
  coordinates: Coordinates;
  /** Viewport context */
  viewport: ViewportContext;
}

/**
 * Right click action - right-clicks at viewport coordinates.
 */
export interface RightClickAction extends BaseAction<ActionType.RIGHT_CLICK> {
  /** Target coordinates in viewport space */
  coordinates: Coordinates;
  /** Viewport context */
  viewport: ViewportContext;
}

/**
 * Drag action - drags from one coordinate to another.
 */
export interface DragAction extends BaseAction<ActionType.DRAG> {
  /** Start and end coordinates */
  coordinates: DragCoordinates;
  /** Viewport context */
  viewport: ViewportContext;
}

/**
 * Mouse move action - moves cursor to viewport coordinates.
 */
export interface MouseMoveAction extends BaseAction<ActionType.MOUSE_MOVE> {
  /** Target coordinates in viewport space */
  coordinates: Coordinates;
  /** Viewport context */
  viewport: ViewportContext;
}

/**
 * Scroll action - scrolls at viewport coordinates.
 */
export interface ScrollAction extends BaseAction<ActionType.SCROLL> {
  /** Target coordinates in viewport space */
  coordinates: Coordinates;
  /** Scroll delta */
  delta: ScrollDelta;
  /** Viewport context */
  viewport: ViewportContext;
}

/**
 * Key action - presses a keyboard key.
 */
export interface KeyAction extends BaseAction<ActionType.KEY> {
  /** Key identifier (e.g., 'Enter', 'Escape', 'Control+a') */
  key: string;
  /** Optional modifiers (ctrl, shift, alt, meta) */
  modifiers?: KeyModifiers;
}

/**
 * Keyboard modifiers.
 */
export interface KeyModifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

/**
 * Visit URL action - navigates to a URL.
 */
export interface VisitUrlAction extends BaseAction<ActionType.VISIT_URL> {
  /** Target URL */
  url: string;
  /** Optional timeout in milliseconds */
  timeout?: number;
}

/**
 * History back action - navigates back in browser history.
 */
export interface HistoryBackAction extends BaseAction<ActionType.HISTORY_BACK> {
  /** Optional number of pages to go back (default: 1) */
  steps?: number;
}

/**
 * Screenshot action - captures the current viewport.
 */
export interface ScreenshotAction extends BaseAction<ActionType.SCREENSHOT> {
  /** Optional full page screenshot (default: false) */
  fullPage?: boolean;
}

/**
 * Wait action - pauses for a specified duration.
 */
export interface WaitAction extends BaseAction<ActionType.WAIT> {
  /** Duration to wait in milliseconds */
  duration: number;
}

/**
 * Ask user question action - requests user input or approval.
 */
export interface AskUserQuestionAction extends BaseAction<ActionType.ASK_USER_QUESTION> {
  /** The question to ask the user */
  question: string;
  /** Optional context about the current state */
  context?: string;
  /** Optional set of choices if applicable */
  choices?: string[];
}

/**
 * Terminate action - ends the automation session.
 */
export interface TerminateAction extends BaseAction<ActionType.TERMINATE> {
  /**
   * The user's actual answer in plain English. Surfaced as the prominent
   * "final answer" card in the UI. Optional so older payloads still parse.
   */
  finalAnswer?: string;
}

/**
 * Pause and memorize fact action - stores information in session memory.
 */
export interface PauseAndMemorizeFactAction extends BaseAction<ActionType.PAUSE_AND_MEMORIZE_FACT> {
  /** The fact to memorize */
  fact: string;
  /** Optional category or tag for the fact */
  category?: string;
}

/**
 * Union type of all Brotto actions.
 */
export type FaraAction =
  | LeftClickAction
  | DoubleClickAction
  | RightClickAction
  | DragAction
  | MouseMoveAction
  | ScrollAction
  | KeyAction
  | VisitUrlAction
  | HistoryBackAction
  | ScreenshotAction
  | WaitAction
  | AskUserQuestionAction
  | TerminateAction
  | PauseAndMemorizeFactAction;

/**
 * Type guard to check if an action is a viewport-based action.
 */
export function isViewportAction(action: FaraAction): action is
  | LeftClickAction
  | DoubleClickAction
  | RightClickAction
  | DragAction
  | MouseMoveAction
  | ScrollAction {
  return [
    ActionType.LEFT_CLICK,
    ActionType.DOUBLE_CLICK,
    ActionType.RIGHT_CLICK,
    ActionType.DRAG,
    ActionType.MOUSE_MOVE,
    ActionType.SCROLL,
  ].includes(action.type);
}

/**
 * Type guard to check if an action is a navigation action.
 */
export function isNavigationAction(action: FaraAction): action is
  | VisitUrlAction
  | HistoryBackAction {
  return [ActionType.VISIT_URL, ActionType.HISTORY_BACK].includes(action.type);
}
