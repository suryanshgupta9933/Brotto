/**
 * Tool Call Parser Tests
 */

import { ToolCallParser, ParseErrorCode } from '../parser';
import { ActionType } from '@brotto/brotto-action-schema';

describe('ToolCallParser', () => {
  let parser: ToolCallParser;

  beforeEach(() => {
    parser = new ToolCallParser();
    parser.setViewportBounds({ width: 1920, height: 1080 });
    parser.setCurrentObservationId(1);
  });

  describe('basic tool parsing', () => {
    it('should parse left_click action', () => {
      const result = parser.parse([
        { name: 'left_click', arguments: { x: 100, y: 200, viewportWidth: 1920, viewportHeight: 1080 } },
      ]);

      expect(result.errors).toHaveLength(0);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].action.type).toBe(ActionType.LEFT_CLICK);
    });

    it('should parse double_click action', () => {
      const result = parser.parse([
        { name: 'double_click', arguments: { x: 100, y: 200, viewportWidth: 1920, viewportHeight: 1080 } },
      ]);

      expect(result.errors).toHaveLength(0);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].action.type).toBe(ActionType.DOUBLE_CLICK);
    });

    it('should parse right_click action', () => {
      const result = parser.parse([
        { name: 'right_click', arguments: { x: 100, y: 200, viewportWidth: 1920, viewportHeight: 1080 } },
      ]);

      expect(result.errors).toHaveLength(0);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].action.type).toBe(ActionType.RIGHT_CLICK);
    });

    it('should parse mouse_move action', () => {
      const result = parser.parse([
        { name: 'mouse_move', arguments: { x: 100, y: 200, viewportWidth: 1920, viewportHeight: 1080 } },
      ]);

      expect(result.errors).toHaveLength(0);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].action.type).toBe(ActionType.MOUSE_MOVE);
    });

    it('should parse scroll action', () => {
      const result = parser.parse([
        {
          name: 'scroll',
          arguments: { x: 100, y: 200, deltaX: 0, deltaY: 100, viewportWidth: 1920, viewportHeight: 1080 },
        },
      ]);

      expect(result.errors).toHaveLength(0);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].action.type).toBe(ActionType.SCROLL);
    });

    it('should parse drag action', () => {
      const result = parser.parse([
        {
          name: 'drag',
          arguments: {
            startX: 100,
            startY: 200,
            endX: 300,
            endY: 400,
            viewportWidth: 1920,
            viewportHeight: 1080,
          },
        },
      ]);

      expect(result.errors).toHaveLength(0);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].action.type).toBe(ActionType.DRAG);
    });

    it('should parse key action', () => {
      const result = parser.parse([
        { name: 'key', arguments: { key: 'Enter' } },
      ]);

      expect(result.errors).toHaveLength(0);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].action.type).toBe(ActionType.KEY);
    });

    it('should parse visit_url action', () => {
      const result = parser.parse([
        { name: 'visit_url', arguments: { url: 'https://example.com' } },
      ]);

      expect(result.errors).toHaveLength(0);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].action.type).toBe(ActionType.VISIT_URL);
    });

    it('should parse screenshot action', () => {
      const result = parser.parse([
        { name: 'screenshot', arguments: {} },
      ]);

      expect(result.errors).toHaveLength(0);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].action.type).toBe(ActionType.SCREENSHOT);
    });

    it('should parse wait action', () => {
      const result = parser.parse([
        { name: 'wait', arguments: { duration: 1000 } },
      ]);

      expect(result.errors).toHaveLength(0);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].action.type).toBe(ActionType.WAIT);
    });

    it('should parse terminate action', () => {
      const result = parser.parse([
        { name: 'terminate', arguments: { reason: 'Done' } },
      ]);

      expect(result.errors).toHaveLength(0);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].action.type).toBe(ActionType.TERMINATE);
    });
  });

  describe('blocked tools', () => {
    it('should reject browser_run_code_unsafe', () => {
      const result = parser.parse([
        { name: 'browser_run_code_unsafe', arguments: { code: 'alert(1)' } },
      ]);

      expect(result.actions).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe(ParseErrorCode.BLOCKED_TOOL);
    });

    it('should reject shell execution', () => {
      const result = parser.parse([
        { name: 'shell', arguments: { command: 'rm -rf /' } },
      ]);

      expect(result.actions).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe(ParseErrorCode.BLOCKED_TOOL);
    });

    it('should reject execute_script', () => {
      const result = parser.parse([
        { name: 'execute_script', arguments: { script: 'document.cookie' } },
      ]);

      expect(result.actions).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe(ParseErrorCode.BLOCKED_TOOL);
    });
  });

  describe('coordinate validation', () => {
    it('should reject coordinates out of bounds', () => {
      const result = parser.parse([
        { name: 'left_click', arguments: { x: 2000, y: 2000, viewportWidth: 1920, viewportHeight: 1080 } },
      ]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe(ParseErrorCode.COORDINATES_OUT_OF_BOUNDS);
    });

    it('should accept coordinates within bounds', () => {
      const result = parser.parse([
        { name: 'left_click', arguments: { x: 500, y: 500, viewportWidth: 1920, viewportHeight: 1080 } },
      ]);

      expect(result.errors).toHaveLength(0);
    });

    it('should reject drag with out-of-bounds start', () => {
      const result = parser.parse([
        {
          name: 'drag',
          arguments: {
            startX: 3000,
            startY: 200,
            endX: 300,
            endY: 400,
            viewportWidth: 1920,
            viewportHeight: 1080,
          },
        },
      ]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe(ParseErrorCode.COORDINATES_OUT_OF_BOUNDS);
    });

    it('should reject drag with out-of-bounds end', () => {
      const result = parser.parse([
        {
          name: 'drag',
          arguments: {
            startX: 100,
            startY: 200,
            endX: 3000,
            endY: 4000,
            viewportWidth: 1920,
            viewportHeight: 1080,
          },
        },
      ]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe(ParseErrorCode.COORDINATES_OUT_OF_BOUNDS);
    });
  });

  describe('URL validation', () => {
    it('should reject invalid URL format', () => {
      const result = parser.parse([
        { name: 'visit_url', arguments: { url: 'not-a-url' } },
      ]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe(ParseErrorCode.INVALID_URL);
    });

    it('should reject javascript URL', () => {
      const result = parser.parse([
        { name: 'visit_url', arguments: { url: 'javascript:alert(1)' } },
      ]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe(ParseErrorCode.INVALID_URL);
    });

    it('should reject data URL', () => {
      const result = parser.parse([
        { name: 'visit_url', arguments: { url: 'data:text/html,<script>alert(1)</script>' } },
      ]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe(ParseErrorCode.INVALID_URL);
    });

    it('should accept valid HTTPS URL', () => {
      const result = parser.parse([
        { name: 'visit_url', arguments: { url: 'https://example.com/page' } },
      ]);

      expect(result.errors).toHaveLength(0);
    });

    it('should accept valid HTTP URL', () => {
      const result = parser.parse([
        { name: 'visit_url', arguments: { url: 'http://example.com' } },
      ]);

      expect(result.errors).toHaveLength(0);
    });
  });

  describe('unknown tools', () => {
    it('should reject unknown tool names', () => {
      const result = parser.parse([
        { name: 'unknown_tool', arguments: {} },
      ]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe(ParseErrorCode.UNKNOWN_TOOL);
    });
  });

  describe('isBlockedTool', () => {
    it('should return true for blocked tools', () => {
      expect(parser.isBlockedTool('browser_run_code_unsafe')).toBe(true);
      expect(parser.isBlockedTool('shell')).toBe(true);
      expect(parser.isBlockedTool('execute_script')).toBe(true);
    });

    it('should return false for allowed tools', () => {
      expect(parser.isBlockedTool('left_click')).toBe(false);
      expect(parser.isBlockedTool('visit_url')).toBe(false);
      expect(parser.isBlockedTool('screenshot')).toBe(false);
    });
  });

  describe('getAvailableTools', () => {
    it('should return list of available tools', () => {
      const tools = parser.getAvailableTools();

      expect(tools).toContain('left_click');
      expect(tools).toContain('double_click');
      expect(tools).toContain('visit_url');
      expect(tools).toContain('screenshot');
      expect(tools).not.toContain('browser_run_code_unsafe');
    });
  });
});
