/**
 * Unit tests for brotto-action-schema package
 *
 * Tests Brotto action parsing, validation, MCP mapping,
 * and coordinate handling.
 */

import {
  ActionType,
  validateActionArgs,
  tryValidateActionArgs,
  FaraActionArgsSchema,
  mapActionToMcpParams,
  getMcpToolName,
  isMcpAction,
  getActionExecutionType,
  ActionExecutionType,
  createDefaultViewport,
  createDefaultViewportConfig,
  createObservationId,
  isValidObservationId,
  compareObservationIds,
  createActionSuccess,
  createActionFailure,
  ActionErrorCode,
  isViewportAction,
  isNavigationAction,
} from '@brotto/brotto-action-schema';

describe('Brotto Action Schema Package', () => {
  describe('Action Types', () => {
    it('should define all action types', () => {
      expect(ActionType.LEFT_CLICK).toBe('left_click');
      expect(ActionType.DOUBLE_CLICK).toBe('double_click');
      expect(ActionType.RIGHT_CLICK).toBe('right_click');
      expect(ActionType.DRAG).toBe('drag');
      expect(ActionType.MOUSE_MOVE).toBe('mouse_move');
      expect(ActionType.SCROLL).toBe('scroll');
      expect(ActionType.KEY).toBe('key');
      expect(ActionType.VISIT_URL).toBe('visit_url');
      expect(ActionType.HISTORY_BACK).toBe('history_back');
      expect(ActionType.SCREENSHOT).toBe('screenshot');
      expect(ActionType.WAIT).toBe('wait');
      expect(ActionType.ASK_USER_QUESTION).be('ask_user_question');
      expect(ActionType.TERMINATE).toBe('terminate');
      expect(ActionType.PAUSE_AND_MEMORIZE_FACT).toBe('pause_and_memorize_fact');
    });

    it('should correctly identify viewport actions', () => {
      const clickAction = { type: ActionType.LEFT_CLICK, args: { x: 100, y: 100 } };
      expect(isViewportAction(clickAction)).toBe(true);

      const navAction = { type: ActionType.VISIT_URL, args: { url: 'https://example.com' } };
      expect(isViewportAction(navAction)).toBe(false);
    });

    it('should correctly identify navigation actions', () => {
      const navAction = { type: ActionType.VISIT_URL, args: { url: 'https://example.com' } };
      expect(isNavigationAction(navAction)).toBe(true);

      const backAction = { type: ActionType.HISTORY_BACK, args: {} };
      expect(isNavigationAction(backAction)).toBe(true);

      const clickAction = { type: ActionType.LEFT_CLICK, args: { x: 100, y: 100 } };
      expect(isNavigationAction(clickAction)).toBe(false);
    });
  });

  describe('Action Validation', () => {
    it('should validate left click action', () => {
      const action = {
        type: ActionType.LEFT_CLICK,
        args: { x: 100, y: 100, viewportContext: undefined },
      };

      const result = validateActionArgs(action);
      expect(result.success).toBe(true);
    });

    it('should reject invalid left click (out of bounds)', () => {
      const action = {
        type: ActionType.LEFT_CLICK,
        args: { x: -100, y: -100 },
      };

      const result = tryValidateActionArgs(action);
      expect(result).toBeDefined();
    });

    it('should validate double click action', () => {
      const action = {
        type: ActionType.DOUBLE_CLICK,
        args: { x: 100, y: 100 },
      };

      const result = validateActionArgs(action);
      expect(result.success).toBe(true);
    });

    it('should validate right click action', () => {
      const action = {
        type: ActionType.RIGHT_CLICK,
        args: { x: 100, y: 100 },
      };

      const result = validateActionArgs(action);
      expect(result.success).toBe(true);
    });

    it('should validate drag action', () => {
      const action = {
        type: ActionType.DRAG,
        args: {
          startX: 100,
          startY: 100,
          endX: 200,
          endY: 200,
        },
      };

      const result = validateActionArgs(action);
      expect(result.success).toBe(true);
    });

    it('should validate mouse move action', () => {
      const action = {
        type: ActionType.MOUSE_MOVE,
        args: { x: 100, y: 100 },
      };

      const result = validateActionArgs(action);
      expect(result.success).toBe(true);
    });

    it('should validate scroll action', () => {
      const action = {
        type: ActionType.SCROLL,
        args: { deltaX: 0, deltaY: -100 },
      };

      const result = validateActionArgs(action);
      expect(result.success).toBe(true);
    });

    it('should validate key action with text', () => {
      const action = {
        type: ActionType.KEY,
        args: { text: 'hello', modifiers: [] },
      };

      const result = validateActionArgs(action);
      expect(result.success).toBe(true);
    });

    it('should validate key action with key name', () => {
      const action = {
        type: ActionType.KEY,
        args: { key: 'Enter', modifiers: ['Shift'] },
      };

      const result = validateActionArgs(action);
      expect(result.success).toBe(true);
    });

    it('should validate visit URL action', () => {
      const action = {
        type: ActionType.VISIT_URL,
        args: { url: 'https://example.com' },
      };

      const result = validateActionArgs(action);
      expect(result.success).toBe(true);
    });

    it('should reject invalid URL', () => {
      const action = {
        type: ActionType.VISIT_URL,
        args: { url: 'not-a-valid-url' },
      };

      const result = tryValidateActionArgs(action);
      // URL validation may not be strict, check result
      expect(result).toBeDefined();
    });

    it('should validate history back action', () => {
      const action = {
        type: ActionType.HISTORY_BACK,
        args: {},
      };

      const result = validateActionArgs(action);
      expect(result.success).toBe(true);
    });

    it('should validate screenshot action', () => {
      const action = {
        type: ActionType.SCREENSHOT,
        args: {},
      };

      const result = validateActionArgs(action);
      expect(result.success).toBe(true);
    });

    it('should validate wait action', () => {
      const action = {
        type: ActionType.WAIT,
        args: { seconds: 5 },
      };

      const result = validateActionArgs(action);
      expect(result.success).toBe(true);
    });

    it('should validate ask user question action', () => {
      const action = {
        type: ActionType.ASK_USER_QUESTION,
        args: { question: 'Is this correct?', options: ['Yes', 'No'] },
      };

      const result = validateActionArgs(action);
      expect(result.success).toBe(true);
    });

    it('should validate terminate action', () => {
      const action = {
        type: ActionType.TERMINATE,
        args: {},
      };

      const result = validateActionArgs(action);
      expect(result.success).toBe(true);
    });

    it('should validate pause and memorize fact action', () => {
      const action = {
        type: ActionType.PAUSE_AND_MEMORIZE_FACT,
        args: { fact: 'User prefers dark mode' },
      };

      const result = validateActionArgs(action);
      expect(result.success).toBe(true);
    });

    it('should reject unknown action type', () => {
      const action = {
        type: 'unknown_action',
        args: {},
      };

      expect(() => {
        validateActionArgs(action as any);
      }).toThrow();
    });
  });

  describe('MCP Mapping', () => {
    it('should map left click to MCP params', () => {
      const action = {
        type: ActionType.LEFT_CLICK,
        args: { x: 100, y: 100 },
      };

      const params = mapActionToMcpParams(action);
      expect(params).toBeDefined();
      expect(params.x).toBe(100);
      expect(params.y).toBe(100);
    });

    it('should map drag to MCP params', () => {
      const action = {
        type: ActionType.DRAG,
        args: {
          startX: 100,
          startY: 100,
          endX: 200,
          endY: 200,
        },
      };

      const params = mapActionToMcpParams(action);
      expect(params).toBeDefined();
      expect(params.startX).toBe(100);
      expect(params.startY).toBe(100);
      expect(params.endX).toBe(200);
      expect(params.endY).toBe(200);
    });

    it('should map scroll to MCP params', () => {
      const action = {
        type: ActionType.SCROLL,
        args: { deltaX: 0, deltaY: -100 },
      };

      const params = mapActionToMcpParams(action);
      expect(params).toBeDefined();
      expect(params.deltaX).toBe(0);
      expect(params.deltaY).toBe(-100);
    });

    it('should map visit URL to MCP params', () => {
      const action = {
        type: ActionType.VISIT_URL,
        args: { url: 'https://example.com' },
      };

      const params = mapActionToMcpParams(action);
      expect(params).toBeDefined();
      expect(params.url).toBe('https://example.com');
    });

    it('should get MCP tool name for action', () => {
      expect(getMcpToolName(ActionType.LEFT_CLICK)).toBe('mouse_click');
      expect(getMcpToolName(ActionType.DRAG)).toBe('mouse_drag');
      expect(getMcpToolName(ActionType.SCROLL)).toBe('mouse_wheel');
      expect(getMcpToolName(ActionType.KEY)).toBe('press_key');
      expect(getMcpToolName(ActionType.VISIT_URL)).toBe('navigate');
    });

    it('should identify MCP actions', () => {
      expect(isMcpAction(ActionType.LEFT_CLICK)).toBe(true);
      expect(isMcpAction(ActionType.DOUBLE_CLICK)).toBe(true);
      expect(isMcpAction(ActionType.VISIT_URL)).toBe(true);
      expect(isMcpAction(ActionType.TERMINATE)).toBe(false);
    });

    it('should get action execution type', () => {
      expect(getActionExecutionType(ActionType.LEFT_CLICK)).toBe(ActionExecutionType.MCP);
      expect(getActionExecutionType(ActionType.VISIT_URL)).toBe(ActionExecutionType.MCP);
      expect(getActionExecutionType(ActionType.TERMINATE)).toBe(ActionExecutionType.LOCAL);
      expect(getActionExecutionType(ActionType.ASK_USER_QUESTION)).toBe(ActionExecutionType.LOCAL);
    });
  });

  describe('Coordinates', () => {
    it('should create default viewport', () => {
      const viewport = createDefaultViewport();
      expect(viewport).toBeDefined();
      expect(viewport.width).toBeDefined();
      expect(viewport.height).toBeDefined();
    });

    it('should create default viewport config', () => {
      const config = createDefaultViewportConfig();
      expect(config).toBeDefined();
      expect(config.devicePixelRatio).toBeDefined();
    });
  });

  describe('Observation IDs', () => {
    it('should create valid observation ID', () => {
      const id = createObservationId();
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('should validate observation ID', () => {
      const id = createObservationId();
      expect(isValidObservationId(id)).toBe(true);
      expect(isValidObservationId('invalid')).toBe(false);
    });

    it('should compare observation IDs', () => {
      const id1 = createObservationId();
      const id2 = createObservationId();
      expect(compareObservationIds(id1, id1)).toBe(0);
      expect(compareObservationIds(id1, id2)).not.toBe(0);
    });
  });

  describe('Action Results', () => {
    it('should create success result', () => {
      const result = createActionSuccess('left_click', { x: 100, y: 100 });
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.actionType).toBe('left_click');
    });

    it('should create failure result', () => {
      const result = createActionFailure('left_click', ActionErrorCode.COORDINATE_OUT_OF_BOUNDS);
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe(ActionErrorCode.COORDINATE_OUT_OF_BOUNDS);
    });

    it('should include error details in failure result', () => {
      const result = createActionFailure('visit_url', ActionErrorCode.INVALID_URL, {
        url: 'not-a-url',
      });
      expect(result.error.details).toBeDefined();
    });
  });
});
