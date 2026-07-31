/**
 * Contract tests for MCP mapping
 *
 * Tests Fara action to MCP tool parameter mapping
 * and version compatibility.
 */

import {
  ActionType,
  mapActionToMcpParams,
  getMcpToolName,
  isMcpAction,
  getActionExecutionType,
  ActionExecutionType,
  McpToolName,
  FARA_ACTION_TO_MCP_TOOL,
} from '@fara-platform/fara-action-schema';

describe('MCP Mapping Contract Tests', () => {
  describe('Action to MCP Tool Mapping', () => {
    it('should map left click to mouse_click tool', () => {
      const action = {
        type: ActionType.LEFT_CLICK,
        args: { x: 100, y: 200 },
      };

      const toolName = getMcpToolName(action.type);
      expect(toolName).toBe(McpToolName.MOUSE_CLICK);

      const params = mapActionToMcpParams(action);
      expect(params.x).toBe(100);
      expect(params.y).toBe(200);
      expect(params.button).toBe('left');
    });

    it('should map double click to mouse_click tool', () => {
      const action = {
        type: ActionType.DOUBLE_CLICK,
        args: { x: 100, y: 200 },
      };

      const toolName = getMcpToolName(action.type);
      expect(toolName).toBe(McpToolName.MOUSE_CLICK);

      const params = mapActionToMcpParams(action);
      expect(params.x).toBe(100);
      expect(params.y).toBe(200);
      expect(params.button).toBe('left');
      expect(params.clickCount).toBe(2);
    });

    it('should map right click to mouse_click tool with right button', () => {
      const action = {
        type: ActionType.RIGHT_CLICK,
        args: { x: 100, y: 200 },
      };

      const params = mapActionToMcpParams(action);
      expect(params.button).toBe('right');
    });

    it('should map drag to mouse_drag tool', () => {
      const action = {
        type: ActionType.DRAG,
        args: {
          startX: 100,
          startY: 100,
          endX: 300,
          endY: 300,
        },
      };

      const toolName = getMcpToolName(action.type);
      expect(toolName).toBe(McpToolName.MOUSE_DRAG);

      const params = mapActionToMcpParams(action);
      expect(params.startX).toBe(100);
      expect(params.startY).toBe(100);
      expect(params.endX).toBe(300);
      expect(params.endY).toBe(300);
    });

    it('should map mouse move to mouse_move tool', () => {
      const action = {
        type: ActionType.MOUSE_MOVE,
        args: { x: 500, y: 400 },
      };

      const toolName = getMcpToolName(action.type);
      expect(toolName).toBe(McpToolName.MOUSE_MOVE);

      const params = mapActionToMcpParams(action);
      expect(params.x).toBe(500);
      expect(params.y).toBe(400);
    });

    it('should map scroll to mouse_wheel tool', () => {
      const action = {
        type: ActionType.SCROLL,
        args: { deltaX: 0, deltaY: -100 },
      };

      const toolName = getMcpToolName(action.type);
      expect(toolName).toBe(McpToolName.MOUSE_WHEEL);

      const params = mapActionToMcpParams(action);
      expect(params.deltaX).toBe(0);
      expect(params.deltaY).toBe(-100);
    });

    it('should map key action to press_key tool', () => {
      const action = {
        type: ActionType.KEY,
        args: { key: 'Enter', modifiers: ['Shift'] },
      };

      const toolName = getMcpToolName(action.type);
      expect(toolName).toBe(McpToolName.PRESS_KEY);

      const params = mapActionToMcpParams(action);
      expect(params.key).toBe('Enter');
      expect(params.modifiers).toContain('Shift');
    });

    it('should map text input via key action', () => {
      const action = {
        type: ActionType.KEY,
        args: { text: 'hello world' },
      };

      const params = mapActionToMcpParams(action);
      expect(params.text).toBe('hello world');
    });

    it('should map visit_url to navigate tool', () => {
      const action = {
        type: ActionType.VISIT_URL,
        args: { url: 'https://example.com/page' },
      };

      const toolName = getMcpToolName(action.type);
      expect(toolName).toBe(McpToolName.NAVIGATE);

      const params = mapActionToMcpParams(action);
      expect(params.url).toBe('https://example.com/page');
    });

    it('should map history_back to navigate_back tool', () => {
      const action = {
        type: ActionType.HISTORY_BACK,
        args: {},
      };

      const toolName = getMcpToolName(action.type);
      expect(toolName).toBe(McpToolName.NAVIGATE_BACK);
    });

    it('should map screenshot to take_screenshot tool', () => {
      const action = {
        type: ActionType.SCREENSHOT,
        args: {},
      };

      const toolName = getMcpToolName(action.type);
      expect(toolName).toBe(McpToolName.TAKE_SCREENSHOT);
    });
  });

  describe('MCP Action Identification', () => {
    it('should identify MCP-executable actions', () => {
      const mcpActions = [
        ActionType.LEFT_CLICK,
        ActionType.DOUBLE_CLICK,
        ActionType.RIGHT_CLICK,
        ActionType.DRAG,
        ActionType.MOUSE_MOVE,
        ActionType.SCROLL,
        ActionType.KEY,
        ActionType.VISIT_URL,
        ActionType.HISTORY_BACK,
        ActionType.SCREENSHOT,
      ];

      mcpActions.forEach((actionType) => {
        expect(isMcpAction(actionType)).toBe(true);
      });
    });

    it('should identify local-only actions', () => {
      const localActions = [
        ActionType.WAIT,
        ActionType.ASK_USER_QUESTION,
        ActionType.TERMINATE,
        ActionType.PAUSE_AND_MEMORIZE_FACT,
      ];

      localActions.forEach((actionType) => {
        expect(isMcpAction(actionType)).toBe(false);
      });
    });
  });

  describe('Execution Type Determination', () => {
    it('should assign MCP execution type to browser actions', () => {
      const browserActions = [
        ActionType.LEFT_CLICK,
        ActionType.VISIT_URL,
        ActionType.SCREENSHOT,
      ];

      browserActions.forEach((actionType) => {
        expect(getActionExecutionType(actionType)).toBe(ActionExecutionType.MCP);
      });
    });

    it('should assign LOCAL execution type to control actions', () => {
      const controlActions = [
        ActionType.TERMINATE,
        ActionType.WAIT,
        ActionType.ASK_USER_QUESTION,
      ];

      controlActions.forEach((actionType) => {
        expect(getActionExecutionType(actionType)).toBe(ActionExecutionType.LOCAL);
      });
    });
  });

  describe('FARA_ACTION_TO_MCP_TOOL Mapping Completeness', () => {
    it('should have mapping for all MCP actions', () => {
      const mcpActionTypes = [
        ActionType.LEFT_CLICK,
        ActionType.DOUBLE_CLICK,
        ActionType.RIGHT_CLICK,
        ActionType.DRAG,
        ActionType.MOUSE_MOVE,
        ActionType.SCROLL,
        ActionType.KEY,
        ActionType.VISIT_URL,
        ActionType.HISTORY_BACK,
        ActionType.SCREENSHOT,
      ];

      mcpActionTypes.forEach((actionType) => {
        expect(FARA_ACTION_TO_MCP_TOOL[actionType]).toBeDefined();
      });
    });

    it('should produce valid MCP tool names', () => {
      const validToolNames = Object.values(McpToolName);

      Object.entries(FARA_ACTION_TO_MCP_TOOL).forEach(([actionType, toolName]) => {
        expect(validToolNames).toContain(toolName);
      });
    });
  });

  describe('Parameter Validation', () => {
    it('should include required parameters for mouse_click', () => {
      const action = {
        type: ActionType.LEFT_CLICK,
        args: { x: 100, y: 100 },
      };

      const params = mapActionToMcpParams(action);

      expect(params.x).toBeDefined();
      expect(params.y).toBeDefined();
      expect(typeof params.x).toBe('number');
      expect(typeof params.y).toBe('number');
    });

    it('should include required parameters for mouse_drag', () => {
      const action = {
        type: ActionType.DRAG,
        args: {
          startX: 0,
          startY: 0,
          endX: 100,
          endY: 100,
        },
      };

      const params = mapActionToMcpParams(action);

      expect(params.startX).toBeDefined();
      expect(params.startY).toBeDefined();
      expect(params.endX).toBeDefined();
      expect(params.endY).toBeDefined();
    });

    it('should include required parameters for navigate', () => {
      const action = {
        type: ActionType.VISIT_URL,
        args: { url: 'https://example.com' },
      };

      const params = mapActionToMcpParams(action);

      expect(params.url).toBeDefined();
      expect(typeof params.url).toBe('string');
    });
  });

  describe('Viewport Context', () => {
    it('should preserve viewport context when provided', () => {
      const action = {
        type: ActionType.LEFT_CLICK,
        args: {
          x: 100,
          y: 100,
          viewportContext: {
            viewportWidth: 1920,
            viewportHeight: 1080,
            scaleFactor: 1,
          },
        },
      };

      const params = mapActionToMcpParams(action);

      expect(params.viewportContext).toBeDefined();
      expect(params.viewportContext?.viewportWidth).toBe(1920);
      expect(params.viewportContext?.viewportHeight).toBe(1080);
    });
  });
});
