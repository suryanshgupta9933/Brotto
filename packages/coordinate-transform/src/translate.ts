/**
 * Coordinate translation module.
 *
 * Translates coordinates between model canvas space and browser
 * viewport space using stored transform data.
 */

import { TransformData, TransformStore } from './transform.js';
import { LetterboxConfig, LetterboxType } from './letterbox.js';

/**
 * Result of translating a coordinate.
 */
export interface TranslatedCoordinate {
  /** X coordinate in viewport space */
  viewportX: number;
  /** Y coordinate in viewport space */
  viewportY: number;
  /** The observation ID used for translation */
  observationId: number;
  /** Scale factor that was applied */
  scale: number;
  /** Whether letterbox/pillarbox was present */
  hasLetterbox: boolean;
}

/**
 * Options for coordinate translation.
 */
export interface TranslateOptions {
  /** Clamp coordinates to viewport bounds if true (default: false) */
  clampToViewport?: boolean;
}

/**
 * Translates a coordinate from model canvas space to browser viewport space.
 *
 * @param canvasX - X coordinate in model canvas space
 * @param canvasY - Y coordinate in model canvas space
 * @param transform - The transform data from the observation
 * @param options - Translation options
 * @returns TranslatedCoordinate with viewport coordinates
 */
export function translateCoordinate(
  canvasX: number,
  canvasY: number,
  transform: TransformData,
  options: TranslateOptions = {}
): TranslatedCoordinate {
  const { clampToViewport = false } = options;
  const letterbox = transform.letterbox;

  // Adjust for letterbox/pillarbox offset to get content-relative coordinates
  const contentX = canvasX - letterbox.barLeft;
  const contentY = canvasY - letterbox.barTop;

  // Scale from canvas space to viewport space
  // The scale represents canvas_pixels / viewport_pixels
  // So to go from canvas to viewport, we divide by scale
  let viewportX = contentX / letterbox.scale;
  let viewportY = contentY / letterbox.scale;

  // Apply clamping if requested
  if (clampToViewport) {
    viewportX = Math.max(0, Math.min(viewportX, transform.viewportWidth));
    viewportY = Math.max(0, Math.min(viewportY, transform.viewportHeight));
  }

  return {
    viewportX,
    viewportY,
    observationId: transform.observationId,
    scale: letterbox.scale,
    hasLetterbox: letterbox.type !== LetterboxType.NONE,
  };
}

/**
 * Translates a coordinate using a transform from the store.
 *
 * @param canvasX - X coordinate in model canvas space
 * @param canvasY - Y coordinate in model canvas space
 * @param observationId - The observation ID to look up in the store
 * @param store - The transform store
 * @param options - Translation options
 * @returns TranslatedCoordinate or undefined if transform not found
 */
export function translateCoordinateFromStore(
  canvasX: number,
  canvasY: number,
  observationId: number,
  store: TransformStore,
  options: TranslateOptions = {}
): TranslatedCoordinate | undefined {
  const transform = store.get(observationId);
  if (!transform) {
    return undefined;
  }
  return translateCoordinate(canvasX, canvasY, transform, options);
}

/**
 * Translates multiple coordinates at once.
 *
 * @param coordinates - Array of [canvasX, canvasY] tuples
 * @param transform - The transform data
 * @param options - Translation options
 * @returns Array of TranslatedCoordinate
 */
export function translateCoordinates(
  coordinates: Array<[number, number]>,
  transform: TransformData,
  options: TranslateOptions = {}
): TranslatedCoordinate[] {
  return coordinates.map(([x, y]) =>
    translateCoordinate(x, y, transform, options)
  );
}

/**
 * Translates from viewport space back to canvas space.
 * This is the inverse of translateCoordinate.
 *
 * @param viewportX - X coordinate in viewport space
 * @param viewportY - Y coordinate in viewport space
 * @param transform - The transform data
 * @returns Canvas coordinates
 */
export function viewportToCanvas(
  viewportX: number,
  viewportY: number,
  transform: TransformData
): { canvasX: number; canvasY: number } {
  const letterbox = transform.letterbox;

  // Scale from viewport to canvas
  const contentX = viewportX * letterbox.scale;
  const contentY = viewportY * letterbox.scale;

  // Add letterbox offset
  return {
    canvasX: contentX + letterbox.barLeft,
    canvasY: contentY + letterbox.barTop,
  };
}

/**
 * Translates a coordinate from model canvas space to physical screen pixels.
 * This accounts for device pixel ratio.
 *
 * @param canvasX - X coordinate in model canvas space
 * @param canvasY - Y coordinate in model canvas space
 * @param transform - The transform data
 * @param options - Translation options
 * @returns Screen coordinates including DPR scaling
 */
export function translateToScreenPixels(
  canvasX: number,
  canvasY: number,
  transform: TransformData,
  options: TranslateOptions = {}
): { screenX: number; screenY: number } {
  const viewport = translateCoordinate(canvasX, canvasY, transform, options);

  // Apply device pixel ratio to get physical screen pixels
  return {
    screenX: viewport.viewportX * transform.devicePixelRatio,
    screenY: viewport.viewportY * transform.devicePixelRatio,
  };
}

/**
 * Returns a human-readable description of a translation result.
 */
export function describeTranslation(
  canvasX: number,
  canvasY: number,
  result: TranslatedCoordinate
): string {
  return (
    `Translate (${canvasX}, ${canvasY}) → ` +
    `viewport (${result.viewportX.toFixed(1)}, ${result.viewportY.toFixed(1)}) ` +
    `scale:${result.scale.toFixed(3)} ` +
    `obs:${result.observationId}` +
    (result.hasLetterbox ? ' letterbox' : '')
  );
}
