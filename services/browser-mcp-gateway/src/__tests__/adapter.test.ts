/**
 * Unit tests for Fara Action Adapter
 */

import {
  FaraActionAdapter,
  MCP_TOOLS,
  DISABLED_TOOLS,
  createFaraActionAdapter,
} from '../adapter.js';
import type { ClickAction, VisitUrlAction, ScrollAction } from '../types.js';

// Mock MCP Client for testing
class MockMCPClient {
  private tools: Map<string, { description?: string }> = new Map();
  private callHistory: Array<{ name: string; arguments: Record<string, unknown> }> = [];

  constructor() {
    // Register standard safe tools
    this.tools.set('browser_mouse_click_xy', { description: 'Click at coordinates' });
    this.tools.set('browser_mouse_drag_xy', { description: 'Drag from one point to another' });
    this.tools.set('browser_mouse_move_xy', { description: 'Move mouse to coordinates' });
    this.tools.set('browser_mouse_wheel', { description: 'Scroll the page' });
    this.tools.set('browser_press_key', { description: 'Press a keyboard key' });
    this.tools.set('browser_navigate', { description: 'Navigate to a URL' });
    this.tools.set('browser_navigate_back', { description: 'Go back in browser history' });
    this.tools.set('browser_take_screenshot', { description: 'Take a screenshot' });
    this.tools.set('browser_keyboard_insert_text', { description: 'Insert text at focused element' });
    this.tools.set('browser_take_accessibility_snapshot', { description: 'Get accessibility snapshot' });
    this.tools.set('browser_get_current_url', { description: 'Get current page URL' });
    this.tools.set('browser_list_tabs', { description: 'List open tabs' });
    // Disabled unsafe tools
    this.tools.set('browser_run_code_unsafe', { description: 'UNSAFE - disabled' });
    this.tools.set('shell', { description: 'Shell execution - disabled' });
  }

  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    return Array.from(this.tools.entries()).map(([name, info]) => ({
      name,
      description: info.description,
    }));
  }

  async callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<{ content: Array<{ type: string; text: string }> }> {
    this.callHistory.push(input);
    return {
      content: [{ type: 'text', text: `Executed ${input.name}` }],
    };
  }

  getCallHistory(): Array<{ name: string; arguments: Record<string, unknown> }> {
    return this.callHistory;
  }

  clearHistory(): void {
    this.callHistory = [];
  }
}

describe('FaraActionAdapter', () => {
  let mockClient: MockMCPClient;
  let adapter: FaraActionAdapter;

  beforeEach(() => {
    mockClient = new MockMCPClient();
    adapter = createFaraActionAdapter(mockClient, 'test-session');
  });

  describe('isToolAllowed', () => {
    it('should allow standard tools', () => {
      expect(adapter.isToolAllowed('browser_mouse_click_xy')).toBe(true);
      expect(adapter.isToolAllowed('browser_navigate')).toBe(true);
      expect(adapter.isToolAllowed('browser_take_screenshot')).toBe(true);
    });

    it('should block unsafe tools', () => {
      expect(adapter.isToolAllowed('browser_run_code_unsafe')).toBe(false);
      expect(adapter.isToolAllowed('shell')).toBe(false);
      expect(adapter.isToolAllowed('exec')).toBe(false);
    });
  });

  describe('getAllowedTools', () => {
    it('should return only allowed tools', async () => {
      const tools = await adapter.getAllowedTools();
      expect(tools).toContain('browser_mouse_click_xy');
      expect(tools).not.toContain('browser_run_code_unsafe');
    });
  });

  describe('executeAction - left_click', () => {
    it('should execute left click at coordinates', async () => {
      const action: ClickAction = {
        type: 'left_click',
        x: 100,
        y: 200,
        observation_id: 'obs-1',
      };

      const result = await adapter.executeAction(action);

      expect(result.success).toBe(true);
      expect(result.observation_id).toBe('obs-1');
      const calls = mockClient.getCallHistory();
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('browser_mouse_click_xy');
      expect(calls[0].arguments).toEqual({
        x: 100,
        y: 200,
        clickCount: 1,
        button: 'left',
      });
    });
  });

  describe('executeAction - double_click', () => {
    it('should execute double click with clickCount=2', async () => {
      const action: ClickAction = {
        type: 'double_click',
        x: 150,
        y: 250,
      };

      const result = await adapter.executeAction(action);

      expect(result.success).toBe(true);
      const calls = mockClient.getCallHistory();
      expect(calls[0].arguments).toEqual({
        x: 150,
        y: 250,
        clickCount: 2,
        button: 'left',
      });
    });
  });

  describe('executeAction - right_click', () => {
    it('should execute right click with right button', async () => {
      const action: ClickAction = {
        type: 'right_click',
        x: 300,
        y: 400,
      };

      const result = await adapter.executeAction(action);

      expect(result.success).toBe(true);
      const calls = mockClient.getCallHistory();
      expect(calls[0].arguments).toEqual({
        x: 300,
        y: 400,
        clickCount: 1,
        button: 'right',
      });
    });
  });

  describe('executeAction - visit_url', () => {
    it('should validate and navigate to valid HTTP URL', async () => {
      const action: VisitUrlAction = {
        type: 'visit_url',
        url: 'https://example.com',
        observation_id: 'obs-2',
      };

      const result = await adapter.executeAction(action);

      expect(result.success).toBe(true);
      const calls = mockClient.getCallHistory();
      expect(calls[0].name).toBe('browser_navigate');
      expect(calls[0].arguments).toEqual({ url: 'https://example.com' });
    });

    it('should reject invalid URL schemes', async () => {
      const action: VisitUrlAction = {
        type: 'visit_url',
        url: 'javascript:alert(1)',
      };

      const result = await adapter.executeAction(action);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL scheme');
    });

    it('should reject file:// URLs', async () => {
      const action: VisitUrlAction = {
        type: 'visit_url',
        url: 'file:///etc/passwd',
      };

      const result = await adapter.executeAction(action);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL scheme');
    });
  });

  describe('executeAction - scroll', () => {
    it('should execute scroll with delta values', async () => {
      const action: ScrollAction = {
        type: 'scroll',
        x: 0,
        y: 100,
        delta_x: 0,
        delta_y: -500,
      };

      const result = await adapter.executeAction(action);

      expect(result.success).toBe(true);
      const calls = mockClient.getCallHistory();
      expect(calls[0].name).toBe('browser_mouse_wheel');
      expect(calls[0].arguments).toEqual({
        x: 0,
        y: 100,
        delta_x: 0,
        delta_y: -500,
      });
    });
  });

  describe('executeAction - key', () => {
    it('should execute key press', async () => {
      const action = {
        type: 'key' as const,
        key: 'Enter',
      };

      const result = await adapter.executeAction(action);

      expect(result.success).toBe(true);
      const calls = mockClient.getCallHistory();
      expect(calls[0].name).toBe('browser_press_key');
      expect(calls[0].arguments).toEqual({ key: 'Enter' });
    });
  });

  describe('executeAction - history_back', () => {
    it('should navigate back', async () => {
      const action = {
        type: 'history_back' as const,
      };

      const result = await adapter.executeAction(action);

      expect(result.success).toBe(true);
      const calls = mockClient.getCallHistory();
      expect(calls[0].name).toBe('browser_navigate_back');
    });
  });

  describe('executeAction - screenshot', () => {
    it('should take screenshot', async () => {
      const action = {
        type: 'screenshot' as const,
      };

      const result = await adapter.executeAction(action);

      expect(result.success).toBe(true);
      const calls = mockClient.getCallHistory();
      expect(calls[0].name).toBe('browser_take_screenshot');
    });
  });

  describe('executeAction - wait', () => {
    it('should acknowledge wait action (handled by orchestrator)', async () => {
      const action = {
        type: 'wait' as const,
        duration_ms: 1000,
      };

      const result = await adapter.executeAction(action);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ message: 'Wait action handled by orchestrator' });
    });
  });

  describe('executeAction - ask_user_question', () => {
    it('should acknowledge approval request (handled by control-plane)', async () => {
      const action = {
        type: 'ask_user_question' as const,
        question: 'Is this correct?',
      };

      const result = await adapter.executeAction(action);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ message: 'Approval request sent to control-plane' });
    });
  });

  describe('executeAction - terminate', () => {
    it('should acknowledge termination request', async () => {
      const action = {
        type: 'terminate' as const,
        reason: 'Task completed',
      };

      const result = await adapter.executeAction(action);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ message: 'Termination request acknowledged' });
    });
  });

  describe('executeAction - pause_and_memorize_fact', () => {
    it('should acknowledge memorization request', async () => {
      const action = {
        type: 'pause_and_memorize_fact' as const,
        fact: 'User prefers dark mode',
      };

      const result = await adapter.executeAction(action);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ message: 'Fact memorization acknowledged' });
    });
  });

  describe('insertText', () => {
    it('should insert text at focused element', async () => {
      const result = await adapter.insertText('Hello, World!');

      expect(result.success).toBe(true);
      const calls = mockClient.getCallHistory();
      expect(calls[0].name).toBe('browser_keyboard_insert_text');
      expect(calls[0].arguments).toEqual({ text: 'Hello, World!' });
    });
  });

  describe('getCurrentUrl', () => {
    it('should return current page URL', async () => {
      mockClient.callTool = async () => ({
        content: [{ type: 'text', text: 'Current URL: https://example.com/page' }],
      });

      const url = await adapter.getCurrentUrl();

      expect(url).toBe('https://example.com/page');
    });

    it('should return null when no URL found', async () => {
      mockClient.callTool = async () => ({
        content: [{ type: 'text', text: 'No URL' }],
      });

      const url = await adapter.getCurrentUrl();

      expect(url).toBeNull();
    });
  });
});

describe('DISABLED_TOOLS', () => {
  it('should include browser_run_code_unsafe', () => {
    expect(DISABLED_TOOLS.has('browser_run_code_unsafe')).toBe(true);
  });

  it('should include shell execution tools', () => {
    expect(DISABLED_TOOLS.has('shell')).toBe(true);
    expect(DISABLED_TOOLS.has('exec')).toBe(true);
  });

  it('should include raw CDP commands', () => {
    expect(DISABLED_TOOLS.has('raw_cdp')).toBe(true);
  });
});

describe('MCP_TOOLS', () => {
  it('should have all required tool names defined', () => {
    expect(MCP_TOOLS.MOUSE_CLICK_XY).toBe('browser_mouse_click_xy');
    expect(MCP_TOOLS.MOUSE_DRAG_XY).toBe('browser_mouse_drag_xy');
    expect(MCP_TOOLS.MOUSE_MOVE_XY).toBe('browser_mouse_move_xy');
    expect(MCP_TOOLS.MOUSE_WHEEL).toBe('browser_mouse_wheel');
    expect(MCP_TOOLS.PRESS_KEY).toBe('browser_press_key');
    expect(MCP_TOOLS.NAVIGATE).toBe('browser_navigate');
    expect(MCP_TOOLS.NAVIGATE_BACK).toBe('browser_navigate_back');
    expect(MCP_TOOLS.TAKE_SCREENSHOT).toBe('browser_take_screenshot');
    expect(MCP_TOOLS.KEYBOARD_INSERT_TEXT).toBe('browser_keyboard_insert_text');
    expect(MCP_TOOLS.TAKE_ACCESSIBILITY_SNAPSHOT).toBe('browser_take_accessibility_snapshot');
  });
});
