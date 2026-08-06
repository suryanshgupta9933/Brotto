/**
 * Coordinate and viewport types for Brotto actions.
 * All coordinates are in viewport pixel space (not device pixels).
 */

/**
 * Represents a 2D point in viewport coordinates.
 */
export interface Coordinates {
  x: number;
  y: number;
}

/**
 * Represents a bounding box in viewport coordinates.
 */
export interface BoundingBox {
  /** Top-left x coordinate */
  x: number;
  /** Top-left y coordinate */
  y: number;
  /** Width of the bounding box */
  width: number;
  /** Height of the bounding box */
  height: number;
}

/**
 * Viewport dimensions.
 */
export interface Viewport {
  /** Viewport width in pixels */
  width: number;
  /** Viewport height in pixels */
  height: number;
}

/**
 * Viewport configuration with scale factor.
 * Device pixel ratio for converting between device and CSS pixels.
 */
export interface ViewportConfig extends Viewport {
  /** Device pixel ratio (default: 1.0) */
  devicePixelRatio: number;
}

/**
 * Normalized coordinates used in model observations.
 * These are coordinates normalized to a fixed model canvas size.
 */
export interface NormalizedCoordinates {
  /** X coordinate normalized to [0, 1] range */
  normalizedX: number;
  /** Y coordinate normalized to [0, 1] range */
  normalizedY: number;
}

/**
 * Drag start and end coordinates.
 */
export interface DragCoordinates {
  /** Starting coordinate */
  start: Coordinates;
  /** Ending coordinate */
  end: Coordinates;
}

/**
 * Scroll direction and amount.
 */
export interface ScrollDelta {
  /** Horizontal scroll amount (positive = right, negative = left) */
  deltaX: number;
  /** Vertical scroll amount (positive = down, negative = up) */
  deltaY: number;
}

/**
 * Viewport bounds for coordinate validation.
 * Coordinates must fall within these bounds to be valid.
 */
export interface ViewportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Creates a default empty viewport.
 */
export function createDefaultViewport(): Viewport {
  return { width: 1280, height: 720 };
}

/**
 * Creates a default viewport config.
 */
export function createDefaultViewportConfig(): ViewportConfig {
  return {
    width: 1280,
    height: 720,
    devicePixelRatio: 1.0,
  };
}
