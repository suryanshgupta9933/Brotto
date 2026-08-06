/**
 * Coordinate Transform Package
 *
 * Shared library for transforming coordinates between model canvas,
 * viewport, and device pixel spaces. Handles DPI scaling, viewport
 * changes, letterbox/pillarbox, and coordinate validation.
 *
 * @example
 * ```typescript
 * import {
 *   normalizeScreenshot,
 *   translateCoordinate,
 *   validateAction,
 *   getDefaultStore,
 *   InMemoryTransformStore,
 * } from '@brotto/coordinate-transform';
 *
 * // Create a transform store
 * const store = new InMemoryTransformStore();
 *
 * // Normalize a screenshot and store the transform
 * const result = normalizeScreenshot(1, {
 *   width: 1920,
 *   height: 1080,
 *   devicePixelRatio: 2,
 *   browserZoom: 100,
 * }, {
 *   width: 1920,
 *   height: 1080,
 *   devicePixelRatio: 2,
 *   browserZoom: 100,
 *   tabId: 'tab-123',
 *   url: 'https://example.com',
 * });
 *
 * store.store(result.transform.observationId, result.transform);
 *
 * // Translate a canvas coordinate to viewport coordinates
 * const translated = translateCoordinate(512, 384, result.transform);
 * console.log(`Viewport: (${translated.viewportX}, ${translated.viewportY})`);
 * ```
 */

// Rejection types
export {
  RejectionReason,
  type Rejection,
  type RejectionBase,
  type DimensionMismatchRejection,
  type DprChangedRejection,
  type ZoomNot100Rejection,
  type ZoomChangedRejection,
  type TabChangedRejection,
  type PageNavigatedRejection,
  type CoordinateOutOfBoundsRejection,
  type TransformNotFoundRejection,
  type TransformCorruptedRejection,
  type TransformExpiredRejection,
  createRejectionBase,
} from './reject.js';

// Letterbox/pillarbox handling
export {
  LetterboxType,
  type LetterboxConfig,
  computeLetterbox,
  isCoordinateInContentArea,
  contentToCanvas,
  canvasToContent,
  describeLetterbox,
} from './letterbox.js';

// Transform storage
export {
  type TransformData,
  type TransformStore,
  InMemoryTransformStore,
  getDefaultStore,
  setDefaultStore,
  resetDefaultStore,
  createTransformData,
  isTransformExpired,
} from './transform.js';

// Screenshot normalization
export {
  type ScreenshotMetadata,
  type ViewportInfo,
  type NormalizedScreenshot,
  type NormalizeOptions,
  normalizeScreenshot,
  denormalizeToViewport,
  describeNormalization,
  validateScreenshotMetadata,
} from './normalize.js';

// Coordinate translation
export {
  type TranslatedCoordinate,
  type TranslateOptions,
  translateCoordinate,
  translateCoordinateFromStore,
  translateCoordinates,
  viewportToCanvas,
  translateToScreenPixels,
  describeTranslation,
} from './translate.js';

// Validation
export {
  type BrowserState,
  type ValidateOptions,
  type ValidationResult,
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
} from './validate.js';
