/**
 * Unit tests for coordinate and viewport types.
 */

import {
  Coordinates,
  BoundingBox,
  Viewport,
  ViewportConfig,
  NormalizedCoordinates,
  DragCoordinates,
  ScrollDelta,
  ViewportBounds,
  createDefaultViewport,
  createDefaultViewportConfig,
} from '../coordinates';

describe('Coordinates', () => {
  it('should create valid coordinates', () => {
    const coords: Coordinates = { x: 100, y: 200 };
    expect(coords.x).toBe(100);
    expect(coords.y).toBe(200);
  });

  it('should allow zero coordinates', () => {
    const coords: Coordinates = { x: 0, y: 0 };
    expect(coords.x).toBe(0);
    expect(coords.y).toBe(0);
  });
});

describe('BoundingBox', () => {
  it('should create valid bounding box', () => {
    const box: BoundingBox = { x: 10, y: 20, width: 100, height: 200 };
    expect(box.x).toBe(10);
    expect(box.y).toBe(20);
    expect(box.width).toBe(100);
    expect(box.height).toBe(200);
  });
});

describe('Viewport', () => {
  it('should create valid viewport', () => {
    const viewport: Viewport = { width: 1280, height: 720 };
    expect(viewport.width).toBe(1280);
    expect(viewport.height).toBe(720);
  });
});

describe('ViewportConfig', () => {
  it('should create viewport config with defaults', () => {
    const config: ViewportConfig = {
      width: 1920,
      height: 1080,
      devicePixelRatio: 2.0,
    };
    expect(config.width).toBe(1920);
    expect(config.height).toBe(1080);
    expect(config.devicePixelRatio).toBe(2.0);
  });
});

describe('NormalizedCoordinates', () => {
  it('should create normalized coordinates', () => {
    const norm: NormalizedCoordinates = { normalizedX: 0.5, normalizedY: 0.5 };
    expect(norm.normalizedX).toBe(0.5);
    expect(norm.normalizedY).toBe(0.5);
  });
});

describe('DragCoordinates', () => {
  it('should create valid drag coordinates', () => {
    const drag: DragCoordinates = {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
    };
    expect(drag.start.x).toBe(0);
    expect(drag.start.y).toBe(0);
    expect(drag.end.x).toBe(100);
    expect(drag.end.y).toBe(100);
  });
});

describe('ScrollDelta', () => {
  it('should create valid scroll delta', () => {
    const delta: ScrollDelta = { deltaX: 0, deltaY: 100 };
    expect(delta.deltaX).toBe(0);
    expect(delta.deltaY).toBe(100);
  });

  it('should allow negative delta for scrolling up', () => {
    const delta: ScrollDelta = { deltaX: 0, deltaY: -100 };
    expect(delta.deltaY).toBe(-100);
  });
});

describe('ViewportBounds', () => {
  it('should create valid viewport bounds', () => {
    const bounds: ViewportBounds = { minX: 0, minY: 0, maxX: 1279, maxY: 719 };
    expect(bounds.minX).toBe(0);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxX).toBe(1279);
    expect(bounds.maxY).toBe(719);
  });
});

describe('createDefaultViewport', () => {
  it('should return standard viewport dimensions', () => {
    const viewport = createDefaultViewport();
    expect(viewport.width).toBe(1280);
    expect(viewport.height).toBe(720);
  });
});

describe('createDefaultViewportConfig', () => {
  it('should return standard viewport config with default DPR', () => {
    const config = createDefaultViewportConfig();
    expect(config.width).toBe(1280);
    expect(config.height).toBe(720);
    expect(config.devicePixelRatio).toBe(1.0);
  });
});
