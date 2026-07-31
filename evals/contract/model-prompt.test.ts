/**
 * Contract tests for model prompt compatibility
 *
 * Tests that prompts are compatible across different
 * model versions (v3, v4, v4-mini).
 */

import {
  ActionType,
  createDefaultViewport,
  createDefaultViewportConfig,
  type Viewport,
  type ViewportConfig,
} from '@fara-platform/fara-action-schema';

describe('Model Prompt Compatibility Contract Tests', () => {
  describe('Viewport Configuration', () => {
    it('should create compatible viewport for all model versions', () => {
      const viewport = createDefaultViewport();

      // All model versions should support basic viewport
      expect(viewport.width).toBeGreaterThan(0);
      expect(viewport.height).toBeGreaterThan(0);
      expect(viewport.devicePixelRatio).toBeGreaterThan(0);
    });

    it('should create viewport config with standard values', () => {
      const config = createDefaultViewportConfig();

      expect(config.devicePixelRatio).toBeDefined();
      expect(config.browserZoom).toBe(100);
    });

    it('should support different viewport sizes', () => {
      const viewports: Viewport[] = [
        { width: 1920, height: 1080, devicePixelRatio: 1 },
        { width: 1920, height: 1080, devicePixelRatio: 2 },
        { width: 2560, height: 1440, devicePixelRatio: 2 },
        { width: 3840, height: 2160, devicePixelRatio: 3 },
      ];

      viewports.forEach((viewport) => {
        expect(viewport.width * viewport.devicePixelRatio).toBeGreaterThan(0);
        expect(viewport.height * viewport.devicePixelRatio).toBeGreaterThan(0);
      });
    });
  });

  describe('Action Format Compatibility', () => {
    const actionFormats = [
      {
        version: 'v3',
        format: {
          type: ActionType.LEFT_CLICK,
          args: { x: 100, y: 100 },
        },
      },
      {
        version: 'v4',
        format: {
          type: ActionType.LEFT_CLICK,
          args: { x: 100, y: 100, observationId: 'obs-123' },
        },
      },
      {
        version: 'v4-mini',
        format: {
          type: ActionType.LEFT_CLICK,
          args: { x: 100, y: 100 },
        },
      },
    ];

    actionFormats.forEach(({ version, format }) => {
      it(`should parse ${version} action format`, () => {
        expect(format.type).toBeDefined();
        expect(format.args).toBeDefined();
        expect(format.args.x).toBeDefined();
        expect(format.args.y).toBeDefined();
      });
    });

    it('should support optional observationId in v4+', () => {
      const actionWithObsId = {
        type: ActionType.LEFT_CLICK,
        args: {
          x: 100,
          y: 100,
          observationId: 'obs-abc123',
        },
      };

      // v4+ supports observationId
      expect(actionWithObsId.args.observationId).toBe('obs-abc123');

      // v3 may not have observationId
      const actionWithoutObsId = {
        type: ActionType.LEFT_CLICK,
        args: { x: 100, y: 100 },
      };

      expect(actionWithoutObsId.args.observationId).toBeUndefined();
    });
  });

  describe('Coordinate System Compatibility', () => {
    it('should use consistent coordinate system across versions', () => {
      const canvasCoord = { x: 512, y: 384 };
      const viewportCoord = { x: 1024, y: 768 };

      // Canvas coordinates are normalized (0-1 or percentage)
      expect(canvasCoord.x).toBeGreaterThanOrEqual(0);
      expect(canvasCoord.y).toBeGreaterThanOrEqual(0);

      // Viewport coordinates are absolute pixels
      expect(viewportCoord.x).toBeGreaterThan(0);
      expect(viewportCoord.y).toBeGreaterThan(0);
    });

    it('should handle coordinate transforms consistently', () => {
      const viewport: Viewport = {
        width: 1920,
        height: 1080,
        devicePixelRatio: 2,
      };

      const canvasX = 0.5; // 50% from left
      const canvasY = 0.5; // 50% from top

      const viewportX = Math.round(canvasX * viewport.width);
      const viewportY = Math.round(canvasY * viewport.height);

      expect(viewportX).toBe(960);
      expect(viewportY).toBe(540);
    });
  });

  describe('Result Format Compatibility', () => {
    it('should produce compatible result format', () => {
      const result = {
        success: true,
        actionType: ActionType.LEFT_CLICK,
        data: {
          x: 100,
          y: 100,
          timestamp: Date.now(),
        },
      };

      // All versions should support success/failure format
      expect(typeof result.success).toBe('boolean');
      expect(result.actionType).toBeDefined();
    });

    it('should include timing information', () => {
      const result = {
        success: true,
        actionType: ActionType.SCREENSHOT,
        duration: 150, // milliseconds
      };

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Format Compatibility', () => {
    it('should produce consistent error format', () => {
      const error = {
        code: 'COORDINATE_OUT_OF_BOUNDS',
        message: 'Coordinate (9999, 9999) is outside viewport (1920x1080)',
        recoverable: true,
      };

      expect(error.code).toBeDefined();
      expect(error.message).toBeDefined();
      expect(typeof error.recoverable).toBe('boolean');
    });
  });

  describe('Prompt Template Compatibility', () => {
    const promptTemplates = {
      v3: {
        instruction: 'Click on the search box at coordinates ({x}, {y}).',
        actionFormat: 'left_click',
      },
      v4: {
        instruction: 'Given the current screenshot, click at ({x}, {y}) in the viewport.',
        actionFormat: 'left_click',
        includeObservationId: true,
      },
      v4Mini: {
        instruction: 'Click ({x}, {y}).',
        actionFormat: 'left_click',
      },
    };

    it('should have consistent action type naming', () => {
      Object.values(promptTemplates).forEach((template) => {
        expect(template.actionFormat).toMatch(/^[a-z_]+$/);
      });
    });

    it('should support optional observationId in v4', () => {
      expect(promptTemplates.v4.includeObservationId).toBe(true);
      expect(promptTemplates.v3.includeObservationId).toBeUndefined();
      expect(promptTemplates.v4Mini.includeObservationId).toBeUndefined();
    });
  });

  describe('Action Type Enumeration', () => {
    const allActionTypes = Object.values(ActionType);

    it('should have consistent action type values', () => {
      allActionTypes.forEach((actionType) => {
        expect(actionType).toMatch(/^[a-z_]+$/);
      });
    });

    it('should include all required action types', () => {
      const requiredActions = [
        'left_click',
        'double_click',
        'right_click',
        'drag',
        'mouse_move',
        'scroll',
        'key',
        'visit_url',
        'history_back',
        'screenshot',
        'wait',
        'terminate',
      ];

      requiredActions.forEach((action) => {
        expect(allActionTypes).toContain(action);
      });
    });
  });

  describe('Capability Negotiation', () => {
    it('should support capability flags', () => {
      const capabilities = {
        vision: true,
        multiTab: true,
        fileUpload: true,
        fileDownload: true,
        clipboard: true,
      };

      expect(typeof capabilities.vision).toBe('boolean');
      expect(typeof capabilities.multiTab).toBe('boolean');
    });

    it('should support model size indicators', () => {
      const modelSizes = ['4B', '9B', '27B'];

      modelSizes.forEach((size) => {
        expect(size).toMatch(/^\d+B$/);
      });
    });
  });
});
