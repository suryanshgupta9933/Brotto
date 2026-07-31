/**
 * Jest tests for coordinate transformation library.
 */

import {
  LetterboxType,
  computeLetterbox,
  isCoordinateInContentArea,
  contentToCanvas,
  canvasToContent,
} from '../letterbox';

import {
  InMemoryTransformStore,
  createTransformData,
  isTransformExpired,
  getDefaultStore,
  setDefaultStore,
  resetDefaultStore,
} from '../transform';

import {
  translateCoordinate,
  translateCoordinateFromStore,
  translateCoordinates,
  viewportToCanvas,
  translateToScreenPixels,
} from '../translate';

import {
  validateDimensions,
  validateDpr,
  validateZoomNot100,
  validateZoomChanged,
  validateTab,
  validateUrl,
  validateCoordinateInBounds,
  validateTransformExists,
  validateTransformIntegrity,
  validateTransformExpiration,
  validateAction,
} from '../validate';

import {
  normalizeScreenshot,
  denormalizeToViewport,
  validateScreenshotMetadata,
} from '../normalize';

describe('Letterbox', () => {
  describe('computeLetterbox', () => {
    it('should return NONE type for exact aspect ratio match', () => {
      const result = computeLetterbox(1024, 768, 1024, 768);
      expect(result.type).toBe(LetterboxType.NONE);
      expect(result.scale).toBeCloseTo(1);
      expect(result.barLeft).toBe(0);
      expect(result.barRight).toBe(0);
      expect(result.barTop).toBe(0);
      expect(result.barBottom).toBe(0);
    });

    it('should compute letterbox for wider viewport', () => {
      // Canvas 1024x768, viewport 1920x1080
      // Aspect canvas = 1.333, aspect viewport = 1.778
      // Viewport is wider, so letterbox with horizontal bars (top/bottom)
      const result = computeLetterbox(1024, 768, 1920, 1080);
      expect(result.type).toBe(LetterboxType.LETTERBOX);
      expect(result.scale).toBeLessThan(1);
      expect(result.barTop + result.barBottom).toBeGreaterThan(0);
      expect(result.barLeft).toBe(0);
      expect(result.barRight).toBe(0);
    });

    it('should compute pillarbox for taller viewport', () => {
      // Canvas 1024x768, viewport 800x1000
      // Aspect canvas = 1.333, aspect viewport = 0.8
      // Viewport is taller, so pillarbox with vertical bars (left/right)
      const result = computeLetterbox(1024, 768, 800, 1000);
      expect(result.type).toBe(LetterboxType.PILLARBOX);
      expect(result.scale).toBeLessThan(1);
      expect(result.barLeft + result.barRight).toBeGreaterThan(0);
      expect(result.barTop).toBe(0);
      expect(result.barBottom).toBe(0);
    });
  });

  describe('isCoordinateInContentArea', () => {
    it('should return true for coordinate in content area', () => {
      const letterbox = computeLetterbox(1024, 768, 1920, 1080);
      // Center of canvas
      expect(isCoordinateInContentArea(512, 384, letterbox, 1024, 768)).toBe(true);
    });

    it('should return false for coordinate in letterbox bars', () => {
      const letterbox = computeLetterbox(1024, 768, 1920, 1080);
      // Top bar area (letterbox has horizontal bars at top/bottom)
      expect(isCoordinateInContentArea(512, 10, letterbox, 1024, 768)).toBe(false);
    });

    it('should return false for coordinate in pillarbox bars', () => {
      const letterbox = computeLetterbox(1024, 768, 800, 1000);
      // Left bar area (pillarbox has vertical bars at left/right)
      expect(isCoordinateInContentArea(10, 384, letterbox, 1024, 768)).toBe(false);
    });
  });

  describe('contentToCanvas and canvasToContent', () => {
    it('should correctly convert between content and canvas coordinates', () => {
      const letterbox = computeLetterbox(1024, 768, 1920, 1080);

      // Content center (512, 384) should map to canvas (512 + barLeft, 384)
      const canvas = contentToCanvas(512, 384, letterbox);
      const backToContent = canvasToContent(canvas.x, canvas.y, letterbox);

      expect(backToContent.x).toBeCloseTo(512);
      expect(backToContent.y).toBeCloseTo(384);
    });
  });
});

describe('TransformStore', () => {
  let store: InMemoryTransformStore;

  beforeEach(() => {
    store = new InMemoryTransformStore();
    resetDefaultStore();
    setDefaultStore(store);
  });

  describe('store and get', () => {
    it('should store and retrieve transform data', () => {
      const letterbox = computeLetterbox(1024, 768, 1920, 1080);
      const transform = createTransformData(
        1, 1024, 768, 1920, 1080, 2, 100, 'tab-1', 'https://example.com', letterbox
      );

      store.store(1, transform);
      const retrieved = store.get(1);

      expect(retrieved).toBeDefined();
      expect(retrieved?.observationId).toBe(1);
      expect(retrieved?.canvasWidth).toBe(1024);
      expect(retrieved?.devicePixelRatio).toBe(2);
    });

    it('should return undefined for non-existent observation ID', () => {
      expect(store.get(999)).toBeUndefined();
    });
  });

  describe('getLatestObservationId', () => {
    it('should return latest observation ID', () => {
      const letterbox = computeLetterbox(1024, 768, 1920, 1080);

      store.store(1, createTransformData(1, 1024, 768, 1920, 1080, 2, 100, 'tab-1', 'https://a.com', letterbox));
      store.store(5, createTransformData(5, 1024, 768, 1920, 1080, 2, 100, 'tab-1', 'https://b.com', letterbox));
      store.store(3, createTransformData(3, 1024, 768, 1920, 1080, 2, 100, 'tab-1', 'https://c.com', letterbox));

      expect(store.getLatestObservationId()).toBe(5);
    });

    it('should return null for empty store', () => {
      expect(store.getLatestObservationId()).toBeNull();
    });
  });

  describe('prune', () => {
    it('should remove transforms older than threshold', () => {
      const letterbox = computeLetterbox(1024, 768, 1920, 1080);

      store.store(1, createTransformData(1, 1024, 768, 1920, 1080, 2, 100, 'tab-1', 'https://a.com', letterbox));
      store.store(2, createTransformData(2, 1024, 768, 1920, 1080, 2, 100, 'tab-1', 'https://b.com', letterbox));
      store.store(5, createTransformData(5, 1024, 768, 1920, 1080, 2, 100, 'tab-1', 'https://c.com', letterbox));

      store.prune(3);

      expect(store.has(1)).toBe(false);
      expect(store.has(2)).toBe(false);
      expect(store.has(5)).toBe(true);
    });
  });

  describe('isTransformExpired', () => {
    it('should return false for transform without TTL', () => {
      const letterbox = computeLetterbox(1024, 768, 1920, 1080);
      const transform = createTransformData(1, 1024, 768, 1920, 1080, 2, 100, 'tab-1', 'https://a.com', letterbox);

      expect(isTransformExpired(transform)).toBe(false);
    });

    it('should return true for expired transform', () => {
      const letterbox = computeLetterbox(1024, 768, 1920, 1080);
      const transform = createTransformData(1, 1024, 768, 1920, 1080, 2, 100, 'tab-1', 'https://a.com', letterbox, 100);

      // Wait and check
      expect(isTransformExpired(transform, Date.now() + 200)).toBe(true);
    });

    it('should return false for non-expired transform', () => {
      const letterbox = computeLetterbox(1024, 768, 1920, 1080);
      const transform = createTransformData(1, 1024, 768, 1920, 1080, 2, 100, 'tab-1', 'https://a.com', letterbox, 10000);

      expect(isTransformExpired(transform, Date.now() + 100)).toBe(false);
    });
  });
});

describe('Normalize', () => {
  describe('normalizeScreenshot', () => {
    it('should create transform data for exact fit', () => {
      const result = normalizeScreenshot(1,
        { width: 1024, height: 768, devicePixelRatio: 1, browserZoom: 100 },
        { width: 1024, height: 768, devicePixelRatio: 1, browserZoom: 100, tabId: 'tab-1', url: 'https://example.com' }
      );

      expect(result.transform.observationId).toBe(1);
      expect(result.canvasWidth).toBe(1024);
      expect(result.canvasHeight).toBe(768);
      expect(result.letterbox.type).toBe(LetterboxType.NONE);
      expect(result.scale).toBeCloseTo(1);
    });

    it('should create transform data for letterbox case', () => {
      const result = normalizeScreenshot(2,
        { width: 1920, height: 1080, devicePixelRatio: 2, browserZoom: 100 },
        { width: 1920, height: 1080, devicePixelRatio: 2, browserZoom: 100, tabId: 'tab-1', url: 'https://example.com' }
      );

      expect(result.transform.observationId).toBe(2);
      expect(result.letterbox.type).toBe(LetterboxType.LETTERBOX);
      expect(result.scale).toBeLessThan(1);
    });
  });

  describe('denormalizeToViewport', () => {
    it('should reverse normalization for exact fit', () => {
      const result = normalizeScreenshot(1,
        { width: 1024, height: 768, devicePixelRatio: 1, browserZoom: 100 },
        { width: 1024, height: 768, devicePixelRatio: 1, browserZoom: 100, tabId: 'tab-1', url: 'https://example.com' }
      );

      const viewport = denormalizeToViewport(512, 384, result.letterbox, 1024, 768);
      expect(viewport.x).toBeCloseTo(512);
      expect(viewport.y).toBeCloseTo(384);
    });
  });

  describe('validateScreenshotMetadata', () => {
    it('should return valid for correct metadata', () => {
      const result = validateScreenshotMetadata(
        { width: 1920, height: 1080, devicePixelRatio: 2, browserZoom: 100 },
        { width: 1920, height: 1080, devicePixelRatio: 2, browserZoom: 100, tabId: 'tab-1', url: 'https://example.com' }
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors for invalid DPR mismatch', () => {
      const result = validateScreenshotMetadata(
        { width: 1920, height: 1080, devicePixelRatio: 2, browserZoom: 100 },
        { width: 1920, height: 1080, devicePixelRatio: 1, browserZoom: 100, tabId: 'tab-1', url: 'https://example.com' }
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('DPR'));
    });

    it('should return error for zoom not at 100%', () => {
      const result = validateScreenshotMetadata(
        { width: 1920, height: 1080, devicePixelRatio: 2, browserZoom: 150 },
        { width: 1920, height: 1080, devicePixelRatio: 2, browserZoom: 150, tabId: 'tab-1', url: 'https://example.com' }
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('zoom'));
    });
  });
});

describe('Translate', () => {
  let store: InMemoryTransformStore;
  let transform: ReturnType<typeof normalizeScreenshot>['transform'];

  beforeEach(() => {
    store = new InMemoryTransformStore();
    const result = normalizeScreenshot(1,
      { width: 1920, height: 1080, devicePixelRatio: 2, browserZoom: 100 },
      { width: 1920, height: 1080, devicePixelRatio: 2, browserZoom: 100, tabId: 'tab-1', url: 'https://example.com' }
    );
    transform = result.transform;
    store.store(1, transform);
  });

  describe('translateCoordinate', () => {
    it('should translate canvas center to viewport center', () => {
      // Canvas center with letterbox
      const result = translateCoordinate(512, 384, transform);

      expect(result.observationId).toBe(1);
      expect(result.hasLetterbox).toBe(true);
      // The viewport center should be (960, 540) for 1920x1080
      // But due to letterbox scaling, coordinates shift
      expect(result.viewportX).toBeGreaterThan(0);
      expect(result.viewportY).toBeGreaterThan(0);
    });

    it('should respect clampToViewport option', () => {
      // Coordinate way outside
      const result = translateCoordinate(5000, 5000, transform, { clampToViewport: true });
      expect(result.viewportX).toBeLessThanOrEqual(transform.viewportWidth);
      expect(result.viewportY).toBeLessThanOrEqual(transform.viewportHeight);
    });
  });

  describe('translateCoordinateFromStore', () => {
    it('should translate using store lookup', () => {
      const result = translateCoordinateFromStore(512, 384, 1, store);
      expect(result).toBeDefined();
      expect(result?.observationId).toBe(1);
    });

    it('should return undefined for missing observation', () => {
      const result = translateCoordinateFromStore(512, 384, 999, store);
      expect(result).toBeUndefined();
    });
  });

  describe('translateCoordinates', () => {
    it('should translate multiple coordinates', () => {
      const coords: Array<[number, number]> = [[100, 100], [200, 200], [300, 300]];
      const results = translateCoordinates(coords, transform);

      expect(results).toHaveLength(3);
      expect(results[0].viewportX).toBeDefined();
      expect(results[1].viewportY).toBeDefined();
      expect(results[2].viewportX).toBeDefined();
    });
  });

  describe('viewportToCanvas', () => {
    it('should reverse the translation', () => {
      const canvasX = 512;
      const canvasY = 384;

      const viewport = translateCoordinate(canvasX, canvasY, transform);
      const backToCanvas = viewportToCanvas(viewport.viewportX, viewport.viewportY, transform);

      expect(backToCanvas.canvasX).toBeCloseTo(canvasX, 1);
      expect(backToCanvas.canvasY).toBeCloseTo(canvasY, 1);
    });
  });

  describe('translateToScreenPixels', () => {
    it('should apply DPR scaling', () => {
      const canvasX = 512;
      const canvasY = 384;

      // DPR is 2, so screen pixels should be doubled
      const result = translateCoordinate(canvasX, canvasY, transform);
      const screen = translateToScreenPixels(canvasX, canvasY, transform);

      expect(screen.screenX).toBeCloseTo(result.viewportX * 2);
      expect(screen.screenY).toBeCloseTo(result.viewportY * 2);
    });
  });
});

describe('Validate', () => {
  let store: InMemoryTransformStore;
  let transform: ReturnType<typeof normalizeScreenshot>['transform'];

  const validBrowserState = {
    viewportWidth: 1920,
    viewportHeight: 1080,
    devicePixelRatio: 2,
    browserZoom: 100,
    tabId: 'tab-1',
    url: 'https://example.com',
  };

  beforeEach(() => {
    store = new InMemoryTransformStore();
    const result = normalizeScreenshot(1,
      { width: 1920, height: 1080, devicePixelRatio: 2, browserZoom: 100 },
      { width: 1920, height: 1080, devicePixelRatio: 2, browserZoom: 100, tabId: 'tab-1', url: 'https://example.com' }
    );
    transform = result.transform;
    store.store(1, transform);
  });

  describe('validateDimensions', () => {
    it('should return null for matching dimensions', () => {
      const rejection = validateDimensions(1920, 1080, transform);
      expect(rejection).toBeNull();
    });

    it('should return rejection for mismatched dimensions', () => {
      const rejection = validateDimensions(1280, 720, transform);
      expect(rejection).not.toBeNull();
      expect(rejection?.reason).toBe('DIMENSION_MISMATCH');
    });
  });

  describe('validateDpr', () => {
    it('should return null for matching DPR', () => {
      const rejection = validateDpr(2, transform);
      expect(rejection).toBeNull();
    });

    it('should return rejection for changed DPR', () => {
      const rejection = validateDpr(3, transform);
      expect(rejection).not.toBeNull();
      expect(rejection?.reason).toBe('DPR_CHANGED');
    });
  });

  describe('validateZoomNot100', () => {
    it('should return null for zoom at 100%', () => {
      const rejection = validateZoomNot100(100, transform);
      expect(rejection).toBeNull();
    });

    it('should return rejection for zoom not at 100%', () => {
      const rejection = validateZoomNot100(150, transform);
      expect(rejection).not.toBeNull();
      expect(rejection?.reason).toBe('ZOOM_NOT_100');
    });

    it('should allow zoom not 100% when explicitly permitted', () => {
      const rejection = validateZoomNot100(150, transform, true);
      expect(rejection).toBeNull();
    });
  });

  describe('validateTab', () => {
    it('should return null for matching tab', () => {
      const rejection = validateTab('tab-1', transform);
      expect(rejection).toBeNull();
    });

    it('should return rejection for changed tab', () => {
      const rejection = validateTab('tab-2', transform);
      expect(rejection).not.toBeNull();
      expect(rejection?.reason).toBe('TAB_CHANGED');
    });
  });

  describe('validateUrl', () => {
    it('should return null for matching URL', () => {
      const rejection = validateUrl('https://example.com', transform);
      expect(rejection).toBeNull();
    });

    it('should return rejection for different URL', () => {
      const rejection = validateUrl('https://other.com', transform);
      expect(rejection).not.toBeNull();
      expect(rejection?.reason).toBe('PAGE_NAVIGATED');
    });
  });

  describe('validateCoordinateInBounds', () => {
    it('should return null for coordinate in bounds', () => {
      // Center of canvas (accounting for letterbox)
      const rejection = validateCoordinateInBounds(512, 384, transform);
      expect(rejection).toBeNull();
    });

    it('should return rejection for coordinate outside canvas', () => {
      const rejection = validateCoordinateInBounds(2000, 2000, transform);
      expect(rejection).not.toBeNull();
      expect(rejection?.reason).toBe('COORDINATE_OUT_OF_BOUNDS');
    });

    it('should return rejection for coordinate in letterbox bar', () => {
      // For letterbox (viewport wider), bars are at top/bottom, so y=10 is in top bar
      const rejection = validateCoordinateInBounds(512, 10, transform);
      expect(rejection).not.toBeNull();
      expect(rejection?.reason).toBe('COORDINATE_OUT_OF_BOUNDS');
    });
  });

  describe('validateTransformExists', () => {
    it('should return null for existing transform', () => {
      const rejection = validateTransformExists(1, store);
      expect(rejection).toBeNull();
    });

    it('should return rejection for non-existent transform', () => {
      const rejection = validateTransformExists(999, store);
      expect(rejection).not.toBeNull();
      expect(rejection?.reason).toBe('TRANSFORM_NOT_FOUND');
    });
  });

  describe('validateTransformIntegrity', () => {
    it('should return null for valid transform', () => {
      const rejection = validateTransformIntegrity(transform);
      expect(rejection).toBeNull();
    });

    it('should return rejection for corrupted transform', () => {
      const corrupted = { ...transform, canvasWidth: -1 };
      const rejection = validateTransformIntegrity(corrupted as typeof transform);
      expect(rejection).not.toBeNull();
      expect(rejection?.reason).toBe('TRANSFORM_CORRUPTED');
    });
  });

  describe('validateAction', () => {
    it('should pass full validation for valid action', () => {
      const result = validateAction(
        1, 512, 384,
        validBrowserState,
        { width: 1920, height: 1080 },
        store
      );

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.transform.observationId).toBe(1);
      }
    });

    it('should fail for non-existent observation', () => {
      const result = validateAction(
        999, 512, 384,
        validBrowserState,
        { width: 1920, height: 1080 },
        store
      );

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.rejection.reason).toBe('TRANSFORM_NOT_FOUND');
      }
    });

    it('should fail for DPR change', () => {
      const result = validateAction(
        1, 512, 384,
        { ...validBrowserState, devicePixelRatio: 3 },
        { width: 1920, height: 1080 },
        store
      );

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.rejection.reason).toBe('DPR_CHANGED');
      }
    });

    it('should fail for coordinate out of bounds', () => {
      const result = validateAction(
        1, 9999, 9999,
        validBrowserState,
        { width: 1920, height: 1080 },
        store
      );

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.rejection.reason).toBe('COORDINATE_OUT_OF_BOUNDS');
      }
    });

    it('should fail for page navigation', () => {
      const result = validateAction(
        1, 512, 384,
        { ...validBrowserState, url: 'https://different.com' },
        { width: 1920, height: 1080 },
        store
      );

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.rejection.reason).toBe('PAGE_NAVIGATED');
      }
    });
  });
});
