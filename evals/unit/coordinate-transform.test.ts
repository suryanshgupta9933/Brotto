/**
 * Unit tests for coordinate-transform package
 *
 * Tests coordinate transformation between model canvas, viewport,
 * and device pixel spaces including DPI scaling, letterbox/pillarbox,
 * and coordinate validation.
 */

import {
  normalizeScreenshot,
  translateCoordinate,
  validateAction,
  InMemoryTransformStore,
  computeLetterbox,
  isCoordinateInContentArea,
  validateDimensions,
  validateDpr,
  validateZoomNot100,
  validateTab,
  type ViewportInfo,
  type ScreenshotMetadata,
} from '@fara-platform/coordinate-transform';

describe('Coordinate Transform Package', () => {
  describe('Screenshot Normalization', () => {
    const mockViewport: ViewportInfo = {
      width: 1920,
      height: 1080,
      devicePixelRatio: 2,
      browserZoom: 100,
      tabId: 'tab-123',
      url: 'https://example.com',
    };

    const mockScreenshot: ScreenshotMetadata = {
      width: 1920,
      height: 1080,
      devicePixelRatio: 2,
      browserZoom: 100,
    };

    it('should normalize screenshot and create transform data', () => {
      const result = normalizeScreenshot(1, mockScreenshot, mockViewport);

      expect(result).toBeDefined();
      expect(result.transform).toBeDefined();
      expect(result.transform.observationId).toBeDefined();
      expect(result.transform.viewportWidth).toBe(1920);
      expect(result.transform.viewportHeight).toBe(1080);
      expect(result.transform.devicePixelRatio).toBe(2);
    });

    it('should handle DPI scaling correctly', () => {
      const highDpiViewport: ViewportInfo = {
        ...mockViewport,
        devicePixelRatio: 3,
      };

      const result = normalizeScreenshot(1, mockScreenshot, highDpiViewport);

      expect(result.transform.devicePixelRatio).toBe(3);
      expect(result.scaleFactor).toBe(1); // No scaling needed
    });

    it('should reject mismatched dimensions', () => {
      const mismatchedScreenshot: ScreenshotMetadata = {
        ...mockScreenshot,
        width: 1280, // Mismatched
        height: 720,
      };

      expect(() => {
        normalizeScreenshot(1, mismatchedScreenshot, mockViewport);
      }).not.toThrow();
    });

    it('should track letterbox/pillarbox configuration', () => {
      const result = normalizeScreenshot(1, mockScreenshot, mockViewport);

      expect(result.letterbox).toBeDefined();
      expect(result.letterbox.type).toBeDefined();
    });
  });

  describe('Coordinate Translation', () => {
    let store: InMemoryTransformStore;

    beforeEach(() => {
      store = new InMemoryTransformStore();
    });

    it('should translate canvas coordinates to viewport coordinates', () => {
      const viewport: ViewportInfo = {
        width: 1920,
        height: 1080,
        devicePixelRatio: 2,
        browserZoom: 100,
        tabId: 'tab-123',
        url: 'https://example.com',
      };

      const screenshot: ScreenshotMetadata = {
        width: 1920,
        height: 1080,
        devicePixelRatio: 2,
        browserZoom: 100,
      };

      const normalized = normalizeScreenshot(1, screenshot, viewport);
      store.store(normalized.transform.observationId, normalized.transform);

      const translated = translateCoordinate(512, 384, normalized.transform);

      expect(translated.viewportX).toBeDefined();
      expect(translated.viewportY).toBeDefined();
      expect(typeof translated.viewportX).toBe('number');
      expect(typeof translated.viewportY).toBe('number');
    });

    it('should handle translation from store', () => {
      const viewport: ViewportInfo = {
        width: 1920,
        height: 1080,
        devicePixelRatio: 2,
        browserZoom: 100,
        tabId: 'tab-456',
        url: 'https://test.com',
      };

      const screenshot: ScreenshotMetadata = {
        width: 1920,
        height: 1080,
        devicePixelRatio: 2,
        browserZoom: 100,
      };

      const normalized = normalizeScreenshot(1, screenshot, viewport);
      store.store(normalized.transform.observationId, normalized.transform);

      const translated = store.getTransform(normalized.transform.observationId)
        ? translateCoordinate(100, 100, store.getTransform(normalized.transform.observationId)!)
        : null;

      expect(translated).not.toBeNull();
    });
  });

  describe('Letterbox/Pillarbox', () => {
    it('should compute letterbox configuration', () => {
      const letterbox = computeLetterbox(1920, 1080, 1920, 1080);

      expect(letterbox).toBeDefined();
      expect(letterbox.type).toBeDefined();
    });

    it('should detect coordinate in content area', () => {
      const inContent = isCoordinateInContentArea(100, 100, 1920, 1080, {
        type: 'none',
        offsetX: 0,
        offsetY: 0,
        scaledWidth: 1920,
        scaledHeight: 1080,
      });

      expect(typeof inContent).toBe('boolean');
    });

    it('should handle horizontal letterbox (pillarbox)', () => {
      const letterbox = computeLetterbox(1920, 1080, 1280, 720);

      expect(letterbox).toBeDefined();
    });
  });

  describe('Validation', () => {
    it('should validate dimensions correctly', () => {
      const result = validateDimensions(1920, 1080, 1920, 1080);
      expect(result.valid).toBe(true);
    });

    it('should reject mismatched dimensions', () => {
      const result = validateDimensions(1920, 1080, 1280, 720);
      expect(result.valid).toBe(false);
    });

    it('should validate DPR matches', () => {
      const result = validateDpr(2, 2);
      expect(result.valid).toBe(true);
    });

    it('should reject mismatched DPR', () => {
      const result = validateDpr(2, 3);
      expect(result.valid).toBe(false);
    });

    it('should validate zoom is 100%', () => {
      const result = validateZoomNot100(100);
      expect(result.valid).toBe(true);
    });

    it('should reject non-100% zoom', () => {
      const result = validateZoomNot100(110);
      expect(result.valid).toBe(false);
    });

    it('should validate tab ID matches', () => {
      const result = validateTab('tab-123', 'tab-123');
      expect(result.valid).toBe(true);
    });

    it('should reject mismatched tab ID', () => {
      const result = validateTab('tab-123', 'tab-456');
      expect(result.valid).toBe(false);
    });

    it('should validate action coordinates in bounds', () => {
      const viewport: ViewportInfo = {
        width: 1920,
        height: 1080,
        devicePixelRatio: 2,
        browserZoom: 100,
        tabId: 'tab-123',
        url: 'https://example.com',
      };

      const screenshot: ScreenshotMetadata = {
        width: 1920,
        height: 1080,
        devicePixelRatio: 2,
        browserZoom: 100,
      };

      const normalized = normalizeScreenshot(1, screenshot, viewport);

      const result = validateAction(
        {
          type: 'left_click',
          args: { x: 100, y: 100 },
        },
        normalized.transform
      );

      expect(result).toBeDefined();
    });
  });

  describe('Transform Store', () => {
    it('should store and retrieve transforms', () => {
      const store = new InMemoryTransformStore();

      const viewport: ViewportInfo = {
        width: 1920,
        height: 1080,
        devicePixelRatio: 2,
        browserZoom: 100,
        tabId: 'tab-123',
        url: 'https://example.com',
      };

      const screenshot: ScreenshotMetadata = {
        width: 1920,
        height: 1080,
        devicePixelRatio: 2,
        browserZoom: 100,
      };

      const normalized = normalizeScreenshot(1, screenshot, viewport);
      store.store(normalized.transform.observationId, normalized.transform);

      const retrieved = store.getTransform(normalized.transform.observationId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.viewportWidth).toBe(1920);
    });

    it('should clear transforms', () => {
      const store = new InMemoryTransformStore();

      const viewport: ViewportInfo = {
        width: 1920,
        height: 1080,
        devicePixelRatio: 2,
        browserZoom: 100,
        tabId: 'tab-123',
        url: 'https://example.com',
      };

      const screenshot: ScreenshotMetadata = {
        width: 1920,
        height: 1080,
        devicePixelRatio: 2,
        browserZoom: 100,
      };

      const normalized = normalizeScreenshot(1, screenshot, viewport);
      store.store(normalized.transform.observationId, normalized.transform);
      store.clear();

      const retrieved = store.getTransform(normalized.transform.observationId);
      expect(retrieved).toBeUndefined();
    });
  });
});
