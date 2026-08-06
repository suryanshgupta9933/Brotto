/**
 * MCP tool mapping definitions for Fara actions.
 * Maps Fara actions to their corresponding Playwright MCP tools.
 */

import { ActionType } from './actions';
import type { FaraAction } from './actions';

/**
 * MCP tool names supported by the browser gateway.
 */
export enum McpToolName {
  BROWSER_MOUSE_CLICK_XY = 'browser_mouse_click_xy',
  BROWSER_MOUSE_DRAG_XY = 'browser_mouse_drag_xy',
  BROWSER_MOUSE_MOVE_XY = 'browser_mouse_move_xy',
  BROWSER_MOUSE_WHEEL = 'browser_mouse_wheel',
  BROWSER_PRESS_KEY = 'browser_press_key',
  BROWSER_NAVIGATE = 'browser_navigate',
  BROWSER_NAVIGATE_BACK = 'browser_navigate_back',
  BROWSER_TAKE_SCREENSHOT = 'browser_take_screenshot',
}

/**
 * Parameters for browser_mouse_click_xy tool.
 */
export interface MouseClickParams {
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
}

/**
 * Parameters for browser_mouse_drag_xy tool.
 */
export interface MouseDragParams {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

/**
 * Parameters for browser_mouse_move_xy tool.
 */
export interface MouseMoveParams {
  x: number;
  y: number;
}

/**
 * Parameters for browser_mouse_wheel tool.
 */
export interface MouseWheelParams {
  x: number;
  y: number;
  deltaX?: number;
  deltaY?: number;
}

/**
 * Parameters for browser_press_key tool.
 */
export interface PressKeyParams {
  key: string;
  modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  };
}

/**
 * Parameters for browser_navigate tool.
 */
export interface NavigateParams {
  url: string;
  timeout?: number;
}

/**
 * Parameters for browser_navigate_back tool.
 */
export interface NavigateBackParams {
  steps?: number;
}

/**
 * Parameters for browser_take_screenshot tool.
 */
export interface TakeScreenshotParams {
  fullPage?: boolean;
}

/**
 * Union type of all MCP tool parameters.
 */
export type McpToolParams =
  | MouseClickParams
  | MouseDragParams
  | MouseMoveParams
  | MouseWheelParams
  | PressKeyParams
  | NavigateParams
  | NavigateBackParams
  | TakeScreenshotParams;

/**
 * Mapping from Fara action type to MCP tool name.
 */
export const FARA_ACTION_TO_MCP_TOOL: Record<ActionType, McpToolName | null> = {
  [ActionType.LEFT_CLICK]: McpToolName.BROWSER_MOUSE_CLICK_XY,
  [ActionType.DOUBLE_CLICK]: McpToolName.BROWSER_MOUSE_CLICK_XY,
  [ActionType.RIGHT_CLICK]: McpToolName.BROWSER_MOUSE_CLICK_XY,
  [ActionType.DRAG]: McpToolName.BROWSER_MOUSE_DRAG_XY,
  [ActionType.MOUSE_MOVE]: McpToolName.BROWSER_MOUSE_MOVE_XY,
  [ActionType.SCROLL]: McpToolName.BROWSER_MOUSE_WHEEL,
  [ActionType.KEY]: McpToolName.BROWSER_PRESS_KEY,
  [ActionType.INSERT_TEXT]: null, // Handled by client via keyboard.type
  [ActionType.VISIT_URL]: McpToolName.BROWSER_NAVIGATE,
  [ActionType.HISTORY_BACK]: McpToolName.BROWSER_NAVIGATE_BACK,
  [ActionType.SCREENSHOT]: McpToolName.BROWSER_TAKE_SCREENSHOT,
  [ActionType.WAIT]: null, // Handled by bounded orchestrator timer
  [ActionType.ASK_USER_QUESTION]: null, // Control-plane approval request
  [ActionType.TERMINATE]: null, // Orchestrator session completion
  [ActionType.PAUSE_AND_MEMORIZE_FACT]: null, // Server-side session memory
  [ActionType.MEMORIZE_FACT]: null, // Server-side session memory
};

/**
 * Maps a Fara action to its corresponding MCP tool parameters.
 * Returns null if the action is not executed via MCP tool.
 */
export function mapActionToMcpParams(action: FaraAction): McpToolParams | null {
  switch (action.type) {
    case ActionType.LEFT_CLICK:
      return {
        x: action.coordinates.x,
        y: action.coordinates.y,
        button: 'left',
        clickCount: 1,
      };

    case ActionType.DOUBLE_CLICK:
      return {
        x: action.coordinates.x,
        y: action.coordinates.y,
        button: 'left',
        clickCount: 2,
      };

    case ActionType.RIGHT_CLICK:
      return {
        x: action.coordinates.x,
        y: action.coordinates.y,
        button: 'right',
        clickCount: 1,
      };

    case ActionType.DRAG:
      return {
        startX: action.coordinates.start.x,
        startY: action.coordinates.start.y,
        endX: action.coordinates.end.x,
        endY: action.coordinates.end.y,
      };

    case ActionType.MOUSE_MOVE:
      return {
        x: action.coordinates.x,
        y: action.coordinates.y,
      };

    case ActionType.SCROLL:
      return {
        x: action.coordinates.x,
        y: action.coordinates.y,
        deltaX: action.delta.deltaX,
        deltaY: action.delta.deltaY,
      };

    case ActionType.KEY:
      return {
        key: action.key,
        modifiers: action.modifiers,
      };

    case ActionType.VISIT_URL:
      return {
        url: action.url,
        timeout: action.timeout,
      };

    case ActionType.HISTORY_BACK:
      return {
        steps: action.steps,
      };

    case ActionType.SCREENSHOT:
      return {
        fullPage: action.fullPage,
      };

    default:
      return null;
  }
}

/**
 * Checks if an action type is executed via MCP tool.
 */
export function isMcpAction(actionType: ActionType): boolean {
  return FARA_ACTION_TO_MCP_TOOL[actionType] !== null;
}

/**
 * Gets the MCP tool name for an action type.
 */
export function getMcpToolName(actionType: ActionType): McpToolName | null {
  return FARA_ACTION_TO_MCP_TOOL[actionType];
}

/**
 * Action execution type classification.
 */
export enum ActionExecutionType {
  /** Action executed via MCP tool call */
  MCP_TOOL = 'mcp_tool',
  /** Action handled by bounded orchestrator timer */
  ORCHESTRATOR_TIMER = 'orchestrator_timer',
  /** Action requiring control-plane approval */
  CONTROL_PLANE_APPROVAL = 'control_plane_approval',
  /** Action marking session completion */
  SESSION_COMPLETION = 'session_completion',
  /** Action updating server-side session memory */
  SESSION_MEMORY = 'session_memory',
}

/**
 * Maps action type to execution type.
 */
export function getActionExecutionType(actionType: ActionType): ActionExecutionType {
  switch (actionType) {
    case ActionType.WAIT:
      return ActionExecutionType.ORCHESTRATOR_TIMER;
    case ActionType.ASK_USER_QUESTION:
      return ActionExecutionType.CONTROL_PLANE_APPROVAL;
    case ActionType.TERMINATE:
      return ActionExecutionType.SESSION_COMPLETION;
    case ActionType.PAUSE_AND_MEMORIZE_FACT:
      return ActionExecutionType.SESSION_MEMORY;
    default:
      return ActionExecutionType.MCP_TOOL;
  }
}
