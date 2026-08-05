/**
 * Tool Call Parser and Validator
 *
 * Parses Fara tool calls and validates arguments using fara-action-schema
 * as specified in ARCHITECTURE.md section 3.2 and 3.5
 *
 * Per ARCHITECTURE.md section 3.2, the orchestrator must:
 * - Parse Fara tool calls
 * - Validate all model arguments
 * - NOT let the model directly control dangerous actions
 */

import {
  ActionType,
  type FaraAction,
  type FaraActionArgs,
  validateActionArgs,
  tryValidateActionArgs,
  validateCoordinatesInBounds,
} from '@fara-platform/fara-action-schema';
import type { FaraToolCall } from './inference.js';
export type { FaraToolCall };

/**
 * Action type mapping from tool names
 */
const TOOL_NAME_TO_ACTION_TYPE: Record<string, ActionType> = {
  left_click: ActionType.LEFT_CLICK,
  double_click: ActionType.DOUBLE_CLICK,
  right_click: ActionType.RIGHT_CLICK,
  drag: ActionType.DRAG,
  mouse_move: ActionType.MOUSE_MOVE,
  scroll: ActionType.SCROLL,
  key: ActionType.KEY,
  visit_url: ActionType.VISIT_URL,
  history_back: ActionType.HISTORY_BACK,
  screenshot: ActionType.SCREENSHOT,
  wait: ActionType.WAIT,
  ask_user_question: ActionType.ASK_USER_QUESTION,
  terminate: ActionType.TERMINATE,
  pause_and_memorize_fact: ActionType.PAUSE_AND_MEMORIZE_FACT,
};

/**
 * Actions that are never allowed to be controlled by the model
 * Per ARCHITECTURE.md section 3.2 and 8.6
 */
const BLOCKED_TOOL_NAMES: Set<string> = new Set([
  'browser_run_code_unsafe',
  'shell',
  'exec',
  'run_code',
  'execute_script',
  'system_command',
]);

/**
 * Actions that require coordinate validation
 */
const COORDINATE_REQUIRING_ACTIONS: Set<ActionType> = new Set([
  ActionType.LEFT_CLICK,
  ActionType.DOUBLE_CLICK,
  ActionType.RIGHT_CLICK,
  ActionType.DRAG,
  ActionType.MOUSE_MOVE,
  ActionType.SCROLL,
]);

/**
 * URL validation regex for visit_url action
 */
const URL_REGEX = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

/**
 * Parsed and validated action with metadata
 */
export interface ParsedAction {
  action: FaraAction;
  validationWarnings: string[];
  rawToolCall: FaraToolCall;
}

/**
 * Parser result with all parsed actions
 */
export interface ParseResult {
  actions: ParsedAction[];
  errors: ParseError[];
}

/**
 * Parse error details
 */
export interface ParseError {
  toolCall: FaraToolCall;
  error: string;
  code: ParseErrorCode;
}

/**
 * Parse error codes
 */
export enum ParseErrorCode {
  UNKNOWN_TOOL = 'UNKNOWN_TOOL',
  INVALID_ARGUMENTS = 'INVALID_ARGUMENTS',
  BLOCKED_TOOL = 'BLOCKED_TOOL',
  COORDINATES_OUT_OF_BOUNDS = 'COORDINATES_OUT_OF_BOUNDS',
  INVALID_URL = 'INVALID_URL',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  STALE_OBSERVATION = 'STALE_OBSERVATION',
}

function isParseError(value: FaraActionArgs | ParseError): value is ParseError {
  return 'toolCall' in value && 'error' in value && 'code' in value;
}

/**
 * Coordinate bounds for validation
 */
export interface CoordinateBounds {
  width: number;
  height: number;
}

/**
 * Tool call parser and validator
 */
export class ToolCallParser {
  private coordinateBounds: CoordinateBounds | null = null;
  private currentObservationId: number | null = null;

  /**
   * Set viewport bounds for coordinate validation
   */
  setViewportBounds(bounds: CoordinateBounds): void {
    this.coordinateBounds = bounds;
  }

  /**
   * Set current observation ID for staleness checking
   */
  setCurrentObservationId(id: number): void {
    this.currentObservationId = id;
  }

  /**
   * Clear viewport bounds
   */
  clearBounds(): void {
    this.coordinateBounds = null;
    this.currentObservationId = null;
  }

  /**
   * Parse and validate tool calls from Fara inference
   *
   * Per ARCHITECTURE.md section 3.2:
   * - Parse Fara tool calls
   * - Validate all model arguments
   * - Reject dangerous actions
   */
  parse(toolCalls: FaraToolCall[]): ParseResult {
    const actions: ParsedAction[] = [];
    const errors: ParseError[] = [];

    for (const toolCall of toolCalls) {
      const result = this.parseSingle(toolCall);

      if (result.action) {
        actions.push(result.action);
      } else if (result.error) {
        errors.push(result.error);
      }
    }

    return { actions, errors };
  }

  /**
   * Parse a single tool call
   */
  private parseSingle(toolCall: FaraToolCall): {
    action?: ParsedAction;
    error?: ParseError;
  } {
    const { name, arguments: args } = toolCall;

    // Check for blocked tools
    if (BLOCKED_TOOL_NAMES.has(name.toLowerCase())) {
      return {
        error: {
          toolCall,
          error: `Tool '${name}' is not available. This type of action is not permitted for security reasons.`,
          code: ParseErrorCode.BLOCKED_TOOL,
        },
      };
    }

    // Map tool name to action type
    const actionType = TOOL_NAME_TO_ACTION_TYPE[name.toLowerCase()];
    if (!actionType) {
      return {
        error: {
          toolCall,
          error: `Unknown tool '${name}'. Available tools are: ${Object.keys(TOOL_NAME_TO_ACTION_TYPE).join(', ')}`,
          code: ParseErrorCode.UNKNOWN_TOOL,
        },
      };
    }

    // Build action arguments
    const actionArgs = this.buildActionArgs(actionType, args, toolCall);
    if (isParseError(actionArgs)) {
      return { error: actionArgs };
    }

    // Validate URL if required
    if (actionArgs.type === ActionType.VISIT_URL) {
      const urlValidation = this.validateUrl(actionArgs.url, toolCall);
      if (urlValidation.error) {
        return { error: urlValidation.error };
      }
    }

    // Validate arguments against schema
    const validationResult = tryValidateActionArgs(actionArgs);
    if (!validationResult) {
      try {
        validateActionArgs(actionArgs);
      } catch (e) {
        return {
          error: {
            toolCall,
            error: `Invalid arguments: ${(e as Error).message}`,
            code: ParseErrorCode.INVALID_ARGUMENTS,
          },
        };
      }
    }

    // Validate coordinates if required
    const warnings: string[] = [];
    if (COORDINATE_REQUIRING_ACTIONS.has(actionType) && this.coordinateBounds) {
      const coordValidation = this.validateCoordinates(actionArgs, toolCall);
      if (coordValidation.error) {
        return { error: coordValidation.error };
      }
      if (coordValidation.warning) {
        warnings.push(coordValidation.warning);
      }
    }

    // Create the Fara action object
    const action = this.createFaraAction(actionArgs);

    return {
      action: {
        action,
        validationWarnings: warnings,
        rawToolCall: toolCall,
      },
    };
  }

  /**
   * Build action arguments from tool call args
   */
  private buildActionArgs(
    actionType: ActionType,
    args: Record<string, unknown>,
    toolCall: FaraToolCall
  ): FaraActionArgs | ParseError {
    const baseArgs = {
      id: this.generateActionId(),
      observationId: this.currentObservationId ?? 0,
      timestamp: Date.now(),
    };

    switch (actionType) {
      case ActionType.LEFT_CLICK:
      case ActionType.DOUBLE_CLICK:
      case ActionType.RIGHT_CLICK:
      case ActionType.MOUSE_MOVE:
        return {
          ...baseArgs,
          type: actionType,
          coordinates: {
            x: this.numberArg(args.x, 'x', toolCall),
            y: this.numberArg(args.y, 'y', toolCall),
          },
          viewport: {
            viewportWidth: this.numberArg(args.viewportWidth || args.viewport_width, 'viewportWidth', toolCall, 1920),
            viewportHeight: this.numberArg(args.viewportHeight || args.viewport_height, 'viewportHeight', toolCall, 1080),
          },
        };

      case ActionType.DRAG:
        return {
          ...baseArgs,
          type: ActionType.DRAG,
          coordinates: {
            start: {
              x: this.numberArg(args.startX || args.start_x, 'startX', toolCall),
              y: this.numberArg(args.startY || args.start_y, 'startY', toolCall),
            },
            end: {
              x: this.numberArg(args.endX || args.end_x, 'endX', toolCall),
              y: this.numberArg(args.endY || args.end_y, 'endY', toolCall),
            },
          },
          viewport: {
            viewportWidth: this.numberArg(args.viewportWidth || 1920, 'viewportWidth', toolCall, 1920),
            viewportHeight: this.numberArg(args.viewportHeight || 1080, 'viewportHeight', toolCall, 1080),
          },
        };

      case ActionType.SCROLL:
        return {
          ...baseArgs,
          type: ActionType.SCROLL,
          coordinates: {
            x: this.numberArg(args.x, 'x', toolCall),
            y: this.numberArg(args.y, 'y', toolCall),
          },
          delta: {
            deltaX: this.numberArg(args.deltaX || args.delta_x || 0, 'deltaX', toolCall),
            deltaY: this.numberArg(args.deltaY || args.delta_y || 100, 'deltaY', toolCall),
          },
          viewport: {
            viewportWidth: this.numberArg(args.viewportWidth || 1920, 'viewportWidth', toolCall, 1920),
            viewportHeight: this.numberArg(args.viewportHeight || 1080, 'viewportHeight', toolCall, 1080),
          },
        };

      case ActionType.KEY:
        return {
          ...baseArgs,
          type: ActionType.KEY,
          key: this.stringArg(args.key, 'key', toolCall),
          modifiers: args.modifiers as { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } | undefined,
        };

      case ActionType.VISIT_URL:
        return {
          ...baseArgs,
          type: ActionType.VISIT_URL,
          url: this.stringArg(args.url, 'url', toolCall),
          timeout: args.timeout ? this.numberArg(args.timeout, 'timeout', toolCall) : undefined,
        };

      case ActionType.HISTORY_BACK:
        return {
          ...baseArgs,
          type: ActionType.HISTORY_BACK,
          steps: args.steps ? this.numberArg(args.steps, 'steps', toolCall) : undefined,
        };

      case ActionType.SCREENSHOT:
        return {
          ...baseArgs,
          type: ActionType.SCREENSHOT,
          fullPage: args.fullPage as boolean | undefined,
        };

      case ActionType.WAIT:
        return {
          ...baseArgs,
          type: ActionType.WAIT,
          duration: this.numberArg(args.duration, 'duration', toolCall),
        };

      case ActionType.ASK_USER_QUESTION:
        return {
          ...baseArgs,
          type: ActionType.ASK_USER_QUESTION,
          question: this.stringArg(args.question, 'question', toolCall),
          context: args.context as string | undefined,
          choices: args.choices as string[] | undefined,
        };

      case ActionType.TERMINATE:
        return {
          ...baseArgs,
          type: ActionType.TERMINATE,
          reason: args.reason as string | undefined,
        };

      case ActionType.PAUSE_AND_MEMORIZE_FACT:
        return {
          ...baseArgs,
          type: ActionType.PAUSE_AND_MEMORIZE_FACT,
          fact: this.stringArg(args.fact, 'fact', toolCall),
          category: args.category as string | undefined,
        };

      default:
        return {
          toolCall,
          error: `Unhandled action type: ${actionType}`,
          code: ParseErrorCode.UNKNOWN_TOOL,
        };
    }
  }

  /**
   * Get a string argument
   */
  private stringArg(value: unknown, fieldName: string, toolCall: FaraToolCall): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw {
        toolCall,
        error: `Missing or invalid required field: ${fieldName}`,
        code: ParseErrorCode.MISSING_REQUIRED_FIELD,
      };
    }
    return value;
  }

  /**
   * Get a number argument
   */
  private numberArg(value: unknown, fieldName: string, toolCall: FaraToolCall, defaultValue?: number): number {
    if (value === undefined && defaultValue !== undefined) {
      return defaultValue;
    }
    if (typeof value !== 'number' || isNaN(value)) {
      throw {
        toolCall,
        error: `Missing or invalid required field: ${fieldName} (expected number)`,
        code: ParseErrorCode.MISSING_REQUIRED_FIELD,
      };
    }
    return value;
  }

  /**
   * Validate coordinates are within bounds
   */
  private validateCoordinates(
    args: FaraActionArgs,
    toolCall: FaraToolCall
  ): { error?: ParseError; warning?: string } {
    if (!this.coordinateBounds) {
      return {};
    }

    const { width, height } = this.coordinateBounds;

    switch (args.type) {
      case ActionType.LEFT_CLICK:
      case ActionType.DOUBLE_CLICK:
      case ActionType.RIGHT_CLICK:
      case ActionType.MOUSE_MOVE:
        if (!validateCoordinatesInBounds(args.coordinates.x, args.coordinates.y, width, height)) {
          return {
            error: {
              toolCall,
              error: `Coordinates (${args.coordinates.x}, ${args.coordinates.y}) are out of bounds for viewport ${width}x${height}`,
              code: ParseErrorCode.COORDINATES_OUT_OF_BOUNDS,
            },
          };
        }
        break;

      case ActionType.DRAG:
        if (!validateCoordinatesInBounds(args.coordinates.start.x, args.coordinates.start.y, width, height)) {
          return {
            error: {
              toolCall,
              error: `Start coordinates out of bounds`,
              code: ParseErrorCode.COORDINATES_OUT_OF_BOUNDS,
            },
          };
        }
        if (!validateCoordinatesInBounds(args.coordinates.end.x, args.coordinates.end.y, width, height)) {
          return {
            error: {
              toolCall,
              error: `End coordinates out of bounds`,
              code: ParseErrorCode.COORDINATES_OUT_OF_BOUNDS,
            },
          };
        }
        break;

      case ActionType.SCROLL:
        // Scroll coordinates don't strictly need to be in bounds
        break;
    }

    return {};
  }

  /**
   * Validate URL
   */
  private validateUrl(url: string, toolCall: FaraToolCall): { error?: ParseError } {
    if (!URL_REGEX.test(url)) {
      return {
        error: {
          toolCall,
          error: `Invalid URL format: ${url}. Only http and https URLs are allowed.`,
          code: ParseErrorCode.INVALID_URL,
        },
      };
    }

    // Check for dangerous URL schemes
    const dangerousSchemes = ['javascript:', 'data:', 'file:', 'ftp:'];
    for (const scheme of dangerousSchemes) {
      if (url.toLowerCase().startsWith(scheme)) {
        return {
          error: {
            toolCall,
            error: `URL scheme '${scheme}' is not permitted for security reasons.`,
            code: ParseErrorCode.INVALID_URL,
          },
        };
      }
    }

    return {};
  }

  /**
   * Create Fara action from validated args
   */
  private createFaraAction(args: FaraActionArgs): FaraAction {
    // This is a simplified version - in practice we'd use the schema to create proper typed objects
    return args as unknown as FaraAction;
  }

  /**
   * Generate a unique action ID
   */
  private generateActionId(): string {
    return `act_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Check if a tool name is blocked
   */
  isBlockedTool(toolName: string): boolean {
    return BLOCKED_TOOL_NAMES.has(toolName.toLowerCase());
  }

  /**
   * Get list of available tool names
   */
  getAvailableTools(): string[] {
    return Object.keys(TOOL_NAME_TO_ACTION_TYPE);
  }
}

/**
 * Create a default parser instance
 */
export function createToolCallParser(): ToolCallParser {
  return new ToolCallParser();
}
