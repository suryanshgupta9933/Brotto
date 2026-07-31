/**
 * Unit tests for MCP tool mapping.
 */

import {
  McpToolName,
  FARA_ACTION_TO_MCP_TOOL,
  mapActionToMcpParams,
  isMcpAction,
  getMcpToolName,
  ActionExecutionType,
  getActionExecutionType,
} from '../mcp-mapping';
import { ActionType } from '../actions';

describe('McpToolName', () => {
  it('should have correct tool names', () => {
    expect(McpToolName.BROWSER_MOUSE_CLICK_XY).toBe('browser_mouse_click_xy');
    expect(McpToolName.BROWSER_MOUSE_DRAG_XY).toBe('browser_mouse_drag_xy');
    expect(McpToolName.BROWSER_MOUSE_MOVE_XY).toBe('browser_mouse_move_xy');
    expect(McpToolName.BROWSER_MOUSE_WHEEL).toBe('browser_mouse_wheel');
    expect(McpToolName.BROWSER_PRESS_KEY).toBe('browser_press_key');
    expect(McpToolName.BROWSER_NAVIGATE).toBe('browser_navigate');
    expect(McpToolName.BROWSER_NAVIGATE_BACK).toBe('browser_navigate_back');
    expect(McpToolName.BROWSER_TAKE_SCREENSHOT).toBe('browser_take_screenshot');
  });
});

describe('FARA_ACTION_TO_MCP_TOOL', () => {
  it('should map left_click to browser_mouse_click_xy', () => {
    expect(FARA_ACTION_TO_MCP_TOOL[ActionType.LEFT_CLICK]).toBe(
      McpToolName.BROWSER_MOUSE_CLICK_XY
    );
  });

  it('should map double_click to browser_mouse_click_xy', () => {
    expect(FARA_ACTION_TO_MCP_TOOL[ActionType.DOUBLE_CLICK]).toBe(
      McpToolName.BROWSER_MOUSE_CLICK_XY
    );
  });

  it('should map right_click to browser_mouse_click_xy', () => {
    expect(FARA_ACTION_TO_MCP_TOOL[ActionType.RIGHT_CLICK]).toBe(
      McpToolName.BROWSER_MOUSE_CLICK_XY
    );
  });

  it('should map drag to browser_mouse_drag_xy', () => {
    expect(FARA_ACTION_TO_MCP_TOOL[ActionType.DRAG]).toBe(
      McpToolName.BROWSER_MOUSE_DRAG_XY
    );
  });

  it('should map mouse_move to browser_mouse_move_xy', () => {
    expect(FARA_ACTION_TO_MCP_TOOL[ActionType.MOUSE_MOVE]).toBe(
      McpToolName.BROWSER_MOUSE_MOVE_XY
    );
  });

  it('should map scroll to browser_mouse_wheel', () => {
    expect(FARA_ACTION_TO_MCP_TOOL[ActionType.SCROLL]).toBe(
      McpToolName.BROWSER_MOUSE_WHEEL
    );
  });

  it('should map key to browser_press_key', () => {
    expect(FARA_ACTION_TO_MCP_TOOL[ActionType.KEY]).toBe(
      McpToolName.BROWSER_PRESS_KEY
    );
  });

  it('should map visit_url to browser_navigate', () => {
    expect(FARA_ACTION_TO_MCP_TOOL[ActionType.VISIT_URL]).toBe(
      McpToolName.BROWSER_NAVIGATE
    );
  });

  it('should map history_back to browser_navigate_back', () => {
    expect(FARA_ACTION_TO_MCP_TOOL[ActionType.HISTORY_BACK]).toBe(
      McpToolName.BROWSER_NAVIGATE_BACK
    );
  });

  it('should map screenshot to browser_take_screenshot', () => {
    expect(FARA_ACTION_TO_MCP_TOOL[ActionType.SCREENSHOT]).toBe(
      McpToolName.BROWSER_TAKE_SCREENSHOT
    );
  });

  it('should map wait to null (orchestrator timer)', () => {
    expect(FARA_ACTION_TO_MCP_TOOL[ActionType.WAIT]).toBeNull();
  });

  it('should map ask_user_question to null (control-plane)', () => {
    expect(FARA_ACTION_TO_MCP_TOOL[ActionType.ASK_USER_QUESTION]).toBeNull();
  });

  it('should map terminate to null (session completion)', () => {
    expect(FARA_ACTION_TO_MCP_TOOL[ActionType.TERMINATE]).toBeNull();
  });

  it('should map pause_and_memorize_fact to null (session memory)', () => {
    expect(FARA_ACTION_TO_MCP_TOOL[ActionType.PAUSE_AND_MEMORIZE_FACT]).toBeNull();
  });
});

describe('isMcpAction', () => {
  it('should return true for MCP-executed actions', () => {
    expect(isMcpAction(ActionType.LEFT_CLICK)).toBe(true);
    expect(isMcpAction(ActionType.DOUBLE_CLICK)).toBe(true);
    expect(isMcpAction(ActionType.RIGHT_CLICK)).toBe(true);
    expect(isMcpAction(ActionType.DRAG)).toBe(true);
    expect(isMcpAction(ActionType.MOUSE_MOVE)).toBe(true);
    expect(isMcpAction(ActionType.SCROLL)).toBe(true);
    expect(isMcpAction(ActionType.KEY)).toBe(true);
    expect(isMcpAction(ActionType.VISIT_URL)).toBe(true);
    expect(isMcpAction(ActionType.HISTORY_BACK)).toBe(true);
    expect(isMcpAction(ActionType.SCREENSHOT)).toBe(true);
  });

  it('should return false for non-MCP actions', () => {
    expect(isMcpAction(ActionType.WAIT)).toBe(false);
    expect(isMcpAction(ActionType.ASK_USER_QUESTION)).toBe(false);
    expect(isMcpAction(ActionType.TERMINATE)).toBe(false);
    expect(isMcpAction(ActionType.PAUSE_AND_MEMORIZE_FACT)).toBe(false);
  });
});

describe('getMcpToolName', () => {
  it('should return correct tool name for action types', () => {
    expect(getMcpToolName(ActionType.LEFT_CLICK)).toBe(
      McpToolName.BROWSER_MOUSE_CLICK_XY
    );
    expect(getMcpToolName(ActionType.DRAG)).toBe(
      McpToolName.BROWSER_MOUSE_DRAG_XY
    );
    expect(getMcpToolName(ActionType.VISIT_URL)).toBe(
      McpToolName.BROWSER_NAVIGATE
    );
  });

  it('should return null for non-MCP actions', () => {
    expect(getMcpToolName(ActionType.WAIT)).toBeNull();
    expect(getMcpToolName(ActionType.TERMINATE)).toBeNull();
  });
});

describe('ActionExecutionType', () => {
  it('should have correct execution types', () => {
    expect(ActionExecutionType.MCP_TOOL).toBe('mcp_tool');
    expect(ActionExecutionType.ORCHESTRATOR_TIMER).toBe('orchestrator_timer');
    expect(ActionExecutionType.CONTROL_PLANE_APPROVAL).toBe('control_plane_approval');
    expect(ActionExecutionType.SESSION_COMPLETION).toBe('session_completion');
    expect(ActionExecutionType.SESSION_MEMORY).toBe('session_memory');
  });
});

describe('getActionExecutionType', () => {
  it('should return MCP_TOOL for browser actions', () => {
    expect(getActionExecutionType(ActionType.LEFT_CLICK)).toBe(
      ActionExecutionType.MCP_TOOL
    );
    expect(getActionExecutionType(ActionType.DOUBLE_CLICK)).toBe(
      ActionExecutionType.MCP_TOOL
    );
    expect(getActionExecutionType(ActionType.RIGHT_CLICK)).toBe(
      ActionExecutionType.MCP_TOOL
    );
    expect(getActionExecutionType(ActionType.DRAG)).toBe(
      ActionExecutionType.MCP_TOOL
    );
    expect(getActionExecutionType(ActionType.MOUSE_MOVE)).toBe(
      ActionExecutionType.MCP_TOOL
    );
    expect(getActionExecutionType(ActionType.SCROLL)).toBe(
      ActionExecutionType.MCP_TOOL
    );
    expect(getActionExecutionType(ActionType.KEY)).toBe(
      ActionExecutionType.MCP_TOOL
    );
    expect(getActionExecutionType(ActionType.VISIT_URL)).toBe(
      ActionExecutionType.MCP_TOOL
    );
    expect(getActionExecutionType(ActionType.HISTORY_BACK)).toBe(
      ActionExecutionType.MCP_TOOL
    );
    expect(getActionExecutionType(ActionType.SCREENSHOT)).toBe(
      ActionExecutionType.MCP_TOOL
    );
  });

  it('should return ORCHESTRATOR_TIMER for wait', () => {
    expect(getActionExecutionType(ActionType.WAIT)).toBe(
      ActionExecutionType.ORCHESTRATOR_TIMER
    );
  });

  it('should return CONTROL_PLANE_APPROVAL for ask_user_question', () => {
    expect(getActionExecutionType(ActionType.ASK_USER_QUESTION)).toBe(
      ActionExecutionType.CONTROL_PLANE_APPROVAL
    );
  });

  it('should return SESSION_COMPLETION for terminate', () => {
    expect(getActionExecutionType(ActionType.TERMINATE)).toBe(
      ActionExecutionType.SESSION_COMPLETION
    );
  });

  it('should return SESSION_MEMORY for pause_and_memorize_fact', () => {
    expect(getActionExecutionType(ActionType.PAUSE_AND_MEMORIZE_FACT)).toBe(
      ActionExecutionType.SESSION_MEMORY
    );
  });
});
