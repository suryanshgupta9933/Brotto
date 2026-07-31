/**
 * Letterbox and pillarbox detection and handling.
 *
 * Letterbox: viewport is wider than model canvas - bars appear on left/right
 * Pillarbox: viewport is taller than model canvas - bars appear on top/bottom
 *
 * The transform preserves aspect ratio by scaling to fit and adding
 * padding (bars) as needed.
 */

/**
 * Type of letterbox/pillarbox adjustment.
 */
export const LetterboxType = {
  /** No letterbox or pillarbox needed - exact fit */
  NONE: 'NONE',
  /** Viewport is wider than canvas - vertical letterbox (bars left/right) */
  LETTERBOX: 'LETTERBOX',
  /** Viewport is taller than canvas - horizontal pillarbox (bars top/bottom) */
  PILLARBOX: 'PILLARBOX',
} as const;

export type LetterboxType = (typeof LetterboxType)[keyof typeof LetterboxType];

/**
 * Letterbox/pillarbox configuration for a transform.
 */
export interface LetterboxConfig {
  /** Type of letterbox/pillarbox adjustment */
  type: LetterboxType;
  /** Scale factor applied to fit viewport to canvas */
  scale: number;
  /** Horizontal offset in canvas pixels (for letterbox) */
  offsetX: number;
  /** Vertical offset in canvas pixels (for pillarbox) */
  offsetY: number;
  /** Width of the content area (canvas width minus letterbox bars) */
  contentWidth: number;
  /** Height of the content area (canvas height minus pillarbox bars) */
  contentHeight: number;
  /** Width of letterbox/pillarbox bars on left/top side */
  barLeft: number;
  /** Width of letterbox/pillarbox bars on right/bottom side */
  barRight: number;
  /** Height of letterbox/pillarbox bars on top side */
  barTop: number;
  /** Height of letterbox/pillarbox bars on bottom side */
  barBottom: number;
}

/**
 * Computes the letterbox/pillarbox configuration needed to fit
 * a viewport of given dimensions into a model canvas.
 *
 * @param canvasWidth - Fixed model canvas width
 * @param canvasHeight - Fixed model canvas height
 * @param viewportWidth - Current browser viewport width
 * @param viewportHeight - Current browser viewport height
 * @returns LetterboxConfig describing how to normalize
 */
export function computeLetterbox(
  canvasWidth: number,
  canvasHeight: number,
  viewportWidth: number,
  viewportHeight: number
): LetterboxConfig {
  const canvasAspect = canvasWidth / canvasHeight;
  const viewportAspect = viewportWidth / viewportHeight;

  let scale: number;
  let offsetX: number;
  let offsetY: number;
  let contentWidth: number;
  let contentHeight: number;
  let barLeft: number;
  let barRight: number;
  let barTop: number;
  let barBottom: number;
  let type: LetterboxType;

  if (Math.abs(canvasAspect - viewportAspect) < 0.001) {
    // Exact match - no letterbox/pillarbox needed
    type = LetterboxType.NONE;
    scale = canvasWidth / viewportWidth;
    offsetX = 0;
    offsetY = 0;
    contentWidth = canvasWidth;
    contentHeight = canvasHeight;
    barLeft = 0;
    barRight = 0;
    barTop = 0;
    barBottom = 0;
  } else if (canvasAspect > viewportAspect) {
    // Canvas is wider than viewport - pillarbox (vertical bars left/right)
    // Scale to fit height, content will be narrower than canvas
    type = LetterboxType.PILLARBOX;
    scale = canvasHeight / viewportHeight;
    contentHeight = canvasHeight;
    contentWidth = viewportWidth * scale;

    // Content is narrower than canvas, so bars are on left and right
    const totalBarsWidth = canvasWidth - contentWidth;
    barLeft = Math.floor(totalBarsWidth / 2);
    barRight = totalBarsWidth - barLeft;
    barTop = 0;
    barBottom = 0;
    offsetX = barLeft;
    offsetY = 0;
  } else {
    // Viewport is wider than canvas - letterbox (horizontal bars top/bottom)
    // Scale to fit width, content will be shorter than canvas
    type = LetterboxType.LETTERBOX;
    scale = canvasWidth / viewportWidth;
    contentWidth = canvasWidth;
    contentHeight = viewportHeight * scale;

    // Content is shorter than canvas, so bars are at top and bottom
    const totalBarsHeight = canvasHeight - contentHeight;
    barTop = Math.floor(totalBarsHeight / 2);
    barBottom = totalBarsHeight - barTop;
    barLeft = 0;
    barRight = 0;
    offsetX = 0;
    offsetY = barTop;
  }

  return {
    type,
    scale,
    offsetX,
    offsetY,
    contentWidth,
    contentHeight,
    barLeft,
    barRight,
    barTop,
    barBottom,
  };
}

/**
 * Checks if a given coordinate (in model canvas space) falls within
 * the visible content area (i.e., not in the letterbox/pillarbox bars).
 *
 * @param x - X coordinate in model canvas space
 * @param y - Y coordinate in model canvas space
 * @param letterbox - The letterbox configuration
 * @param canvasWidth - Model canvas width
 * @param canvasHeight - Model canvas height
 * @returns true if the coordinate is in the visible content area
 */
export function isCoordinateInContentArea(
  x: number,
  y: number,
  letterbox: LetterboxConfig,
  canvasWidth: number,
  canvasHeight: number
): boolean {
  // Check if coordinate falls within the content bounds
  const minX = letterbox.barLeft;
  const maxX = canvasWidth - letterbox.barRight;
  const minY = letterbox.barTop;
  const maxY = canvasHeight - letterbox.barBottom;

  return x >= minX && x < maxX && y >= minY && y < maxY;
}

/**
 * Converts a coordinate from content-area space to full canvas space.
 * This is useful when you have a coordinate from the normalized view
 * and need to map it back considering the letterbox/pillarbox bars.
 *
 * @param x - X coordinate in content-area space
 * @param y - Y coordinate in content-area space
 * @param letterbox - The letterbox configuration
 * @returns Coordinate in full canvas space
 */
export function contentToCanvas(
  x: number,
  y: number,
  letterbox: LetterboxConfig
): { x: number; y: number } {
  return {
    x: x + letterbox.barLeft,
    y: y + letterbox.barTop,
  };
}

/**
 * Converts a coordinate from full canvas space to content-area space.
 *
 * @param x - X coordinate in full canvas space
 * @param y - Y coordinate in full canvas space
 * @param letterbox - The letterbox configuration
 * @returns Coordinate in content-area space
 */
export function canvasToContent(
  x: number,
  y: number,
  letterbox: LetterboxConfig
): { x: number; y: number } {
  return {
    x: x - letterbox.barLeft,
    y: y - letterbox.barTop,
  };
}

/**
 * Returns a human-readable description of the letterbox configuration.
 */
export function describeLetterbox(config: LetterboxConfig): string {
  switch (config.type) {
    case LetterboxType.NONE:
      return `No letterbox/pillarbox - exact fit at scale ${config.scale.toFixed(3)}`;
    case LetterboxType.LETTERBOX:
      return `Letterbox: ${config.barLeft + config.barRight}px bars (${config.barLeft}px left, ${config.barRight}px right) at scale ${config.scale.toFixed(3)}`;
    case LetterboxType.PILLARBOX:
      return `Pillarbox: ${config.barTop + config.barBottom}px bars (${config.barTop}px top, ${config.barBottom}px bottom) at scale ${config.scale.toFixed(3)}`;
  }
}
