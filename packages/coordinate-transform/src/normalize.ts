/**
 * Screenshot normalization module.
 *
 * Handles the conversion of variable-size browser viewport screenshots
 * to a fixed-size model canvas with optional letterbox/pillarbox.
 */

import { LetterboxConfig, computeLetterbox, LetterboxType } from './letterbox.js';
import { TransformData, createTransformData } from './transform.js';

/**
 * Screenshot metadata required for normalization.
 */
export interface ScreenshotMetadata {
  /** Width of the screenshot in pixels */
  width: number;
  /** Height of the screenshot in pixels */
  height: number;
  /** Device pixel ratio of the screenshot */
  devicePixelRatio: number;
  /** Browser zoom level (100 = 100%) */
  browserZoom: number;
}

/**
 * Viewport information at screenshot time.
 */
export interface ViewportInfo {
  /** Browser viewport width */
  width: number;
  /** Browser viewport height */
  height: number;
  /** Device pixel ratio */
  devicePixelRatio: number;
  /** Browser zoom level (100 = 100%) */
  browserZoom: number;
  /** Tab ID */
  tabId: string;
  /** Current URL */
  url: string;
}

/**
 * Result of normalizing a screenshot.
 */
export interface NormalizedScreenshot {
  /** The computed transform data */
  transform: TransformData;
  /** The letterbox/pillarbox configuration used */
  letterbox: LetterboxConfig;
  /** The original screenshot dimensions */
  originalWidth: number;
  /** The original screenshot dimensions */
  originalHeight: number;
  /** The fixed model canvas dimensions */
  canvasWidth: number;
  /** The canvas height */
  canvasHeight: number;
  /** Scale factor applied (viewport to canvas) */
  scale: number;
}

/**
 * Options for normalization.
 */
export interface NormalizeOptions {
  /** Fixed model canvas width (default: 1024) */
  canvasWidth?: number;
  /** Fixed model canvas height (default: 768) */
  canvasHeight?: number;
  /** Optional TTL for the transform in milliseconds */
  ttlMs?: number;
}

/**
 * Normalizes a screenshot by computing the transform needed to convert
 * from viewport coordinates to model canvas coordinates.
 *
 * @param observationId - Monotonically increasing observation ID
 * @param metadata - Screenshot metadata (dimensions, DPR, zoom)
 * @param viewport - Viewport information at screenshot time
 * @param options - Normalization options
 * @returns NormalizedScreenshot with transform data
 */
export function normalizeScreenshot(
  observationId: number,
  metadata: ScreenshotMetadata,
  viewport: ViewportInfo,
  options: NormalizeOptions = {}
): NormalizedScreenshot {
  const {
    canvasWidth = 1024,
    canvasHeight = 768,
    ttlMs,
  } = options;

  // Compute letterbox/pillarbox configuration
  const letterbox = computeLetterbox(
    canvasWidth,
    canvasHeight,
    metadata.width,
    metadata.height
  );

  // Create transform data
  const transform = createTransformData(
    observationId,
    canvasWidth,
    canvasHeight,
    viewport.width,
    viewport.height,
    metadata.devicePixelRatio,
    metadata.browserZoom,
    viewport.tabId,
    viewport.url,
    letterbox,
    ttlMs
  );

  return {
    transform,
    letterbox,
    originalWidth: metadata.width,
    originalHeight: metadata.height,
    canvasWidth,
    canvasHeight,
    scale: letterbox.scale,
  };
}

/**
 * Reverses the normalization process - given a canvas coordinate,
 * returns what the viewport coordinate would be.
 *
 * This is useful for understanding where a canvas coordinate
 * maps to in the original viewport space.
 *
 * @param canvasX - X coordinate in canvas space
 * @param canvasY - Y coordinate in canvas space
 * @param letterbox - Letterbox configuration
 * @param originalWidth - Original viewport/screenshot width
 * @param originalHeight - Original viewport/screenshot height
 * @returns Viewport coordinates
 */
export function denormalizeToViewport(
  canvasX: number,
  canvasY: number,
  letterbox: LetterboxConfig,
  originalWidth: number,
  originalHeight: number
): { x: number; y: number } {
  // First, account for letterbox offset
  const contentX = canvasX - letterbox.barLeft;
  const contentY = canvasY - letterbox.barTop;

  // Then reverse the scale
  const viewportX = contentX / letterbox.scale;
  const viewportY = contentY / letterbox.scale;

  return { x: viewportX, y: viewportY };
}

/**
 * Gets a description of the normalization result.
 */
export function describeNormalization(result: NormalizedScreenshot): string {
  const letterboxType =
    result.letterbox.type === LetterboxType.NONE
      ? 'exact fit'
      : result.letterbox.type === LetterboxType.LETTERBOX
      ? `letterbox (${result.letterbox.barLeft + result.letterbox.barRight}px bars)`
      : `pillarbox (${result.letterbox.barTop + result.letterbox.barBottom}px bars)`;

  return (
    `Normalize: ${result.originalWidth}x${result.originalHeight} ` +
    `→ ${result.canvasWidth}x${result.canvasHeight} ` +
    `(${letterboxType}, scale: ${result.scale.toFixed(3)})`
  );
}

/**
 * Validates that screenshot metadata is consistent for normalization.
 * Throws if there are issues that would prevent proper normalization.
 */
export function validateScreenshotMetadata(
  metadata: ScreenshotMetadata,
  viewport: ViewportInfo
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (metadata.width <= 0) {
    errors.push(`Screenshot width must be positive, got ${metadata.width}`);
  }

  if (metadata.height <= 0) {
    errors.push(`Screenshot height must be positive, got ${metadata.height}`);
  }

  if (metadata.devicePixelRatio <= 0) {
    errors.push(
      `Device pixel ratio must be positive, got ${metadata.devicePixelRatio}`
    );
  }

  if (metadata.browserZoom !== 100) {
    errors.push(
      `Browser zoom should be 100%, got ${metadata.browserZoom}%`
    );
  }

  if (viewport.width <= 0) {
    errors.push(`Viewport width must be positive, got ${viewport.width}`);
  }

  if (viewport.height <= 0) {
    errors.push(`Viewport height must be positive, got ${viewport.height}`);
  }

  // DPR should match between metadata and viewport
  if (Math.abs(metadata.devicePixelRatio - viewport.devicePixelRatio) > 0.001) {
    errors.push(
      `Screenshot DPR (${metadata.devicePixelRatio}) doesn't match ` +
      `viewport DPR (${viewport.devicePixelRatio})`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
