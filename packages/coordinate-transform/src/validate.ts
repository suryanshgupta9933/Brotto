/**
 * Transform validation module.
 *
 * Validates that a transform is still valid and hasn't become stale
 * or invalid due to changes in browser state.
 */

import {
  Rejection,
  RejectionReason,
  DimensionMismatchRejection,
  DprChangedRejection,
  ZoomNot100Rejection,
  ZoomChangedRejection,
  TabChangedRejection,
  PageNavigatedRejection,
  CoordinateOutOfBoundsRejection,
  TransformNotFoundRejection,
  TransformCorruptedRejection,
  TransformExpiredRejection,
  createRejectionBase,
} from './reject.js';
import { TransformData, TransformStore, isTransformExpired } from './transform.js';
import { LetterboxType } from './letterbox.js';

/**
 * Current browser state for validation.
 */
export interface BrowserState {
  /** Current screenshot/viewport width */
  viewportWidth: number;
  /** Current screenshot/viewport height */
  viewportHeight: number;
  /** Current device pixel ratio */
  devicePixelRatio: number;
  /** Current browser zoom level (100 = 100%) */
  browserZoom: number;
  /** Current tab ID */
  tabId: string;
  /** Current URL */
  url: string;
}

/**
 * Options for validation.
 */
export interface ValidateOptions {
  /** Allow zoom other than 100% (default: false) */
  allowZoomNot100?: boolean;
  /** Custom TTL override in milliseconds */
  ttlMs?: number;
}

/**
 * Validation result - either success or a rejection.
 */
export type ValidationResult =
  | { valid: true; transform: TransformData }
  | { valid: false; rejection: Rejection };

/**
 * Checks if screenshot dimensions match the recorded transform.
 */
export function validateDimensions(
  screenshotWidth: number,
  screenshotHeight: number,
  transform: TransformData
): DimensionMismatchRejection | null {
  if (
    screenshotWidth !== transform.viewportWidth ||
    screenshotHeight !== transform.viewportHeight
  ) {
    return {
      ...createRejectionBase(
        RejectionReason.DIMENSION_MISMATCH,
        `Screenshot dimensions ${screenshotWidth}x${screenshotHeight} don't match ` +
          `recorded transform ${transform.viewportWidth}x${transform.viewportHeight}`,
        transform.observationId
      ),
      reason: RejectionReason.DIMENSION_MISMATCH,
      expectedWidth: transform.viewportWidth,
      expectedHeight: transform.viewportHeight,
      actualWidth: screenshotWidth,
      actualHeight: screenshotHeight,
    };
  }
  return null;
}

/**
 * Checks if device pixel ratio has changed.
 */
export function validateDpr(
  currentDpr: number,
  transform: TransformData
): DprChangedRejection | null {
  if (Math.abs(currentDpr - transform.devicePixelRatio) > 0.001) {
    return {
      ...createRejectionBase(
        RejectionReason.DPR_CHANGED,
        `DPR changed from ${transform.devicePixelRatio} to ${currentDpr}`,
        transform.observationId
      ),
      reason: RejectionReason.DPR_CHANGED,
      recordedDpr: transform.devicePixelRatio,
      currentDpr,
    };
  }
  return null;
}

/**
 * Checks if browser zoom is at 100%.
 */
export function validateZoomNot100(
  currentZoom: number,
  transform: TransformData,
  allowZoomNot100: boolean = false
): ZoomNot100Rejection | null {
  if (!allowZoomNot100 && currentZoom !== 100) {
    return {
      ...createRejectionBase(
        RejectionReason.ZOOM_NOT_100,
        `Browser zoom is ${currentZoom}%, expected 100%`,
        transform.observationId
      ),
      reason: RejectionReason.ZOOM_NOT_100,
      currentZoom,
    };
  }
  return null;
}

/**
 * Checks if browser zoom has changed since observation.
 */
export function validateZoomChanged(
  currentZoom: number,
  transform: TransformData
): ZoomChangedRejection | null {
  if (currentZoom !== transform.browserZoom) {
    return {
      ...createRejectionBase(
        RejectionReason.ZOOM_CHANGED,
        `Browser zoom changed from ${transform.browserZoom}% to ${currentZoom}%`,
        transform.observationId
      ),
      reason: RejectionReason.ZOOM_CHANGED,
      recordedZoom: transform.browserZoom,
      currentZoom,
    };
  }
  return null;
}

/**
 * Checks if the selected tab has changed.
 */
export function validateTab(
  currentTabId: string,
  transform: TransformData
): TabChangedRejection | null {
  if (currentTabId !== transform.tabId) {
    return {
      ...createRejectionBase(
        RejectionReason.TAB_CHANGED,
        `Tab changed from ${transform.tabId} to ${currentTabId}`,
        transform.observationId
      ),
      reason: RejectionReason.TAB_CHANGED,
      recordedTabId: transform.tabId,
      currentTabId,
    };
  }
  return null;
}

/**
 * Checks if the page has navigated since observation.
 */
export function validateUrl(
  currentUrl: string,
  transform: TransformData
): PageNavigatedRejection | null {
  if (currentUrl !== transform.url) {
    return {
      ...createRejectionBase(
        RejectionReason.PAGE_NAVIGATED,
        `Page navigated from ${transform.url} to ${currentUrl}`,
        transform.observationId
      ),
      reason: RejectionReason.PAGE_NAVIGATED,
      recordedUrl: transform.url,
      currentUrl,
    };
  }
  return null;
}

/**
 * Checks if a coordinate falls within the viewport bounds.
 */
export function validateCoordinateInBounds(
  canvasX: number,
  canvasY: number,
  transform: TransformData
): CoordinateOutOfBoundsRejection | null {
  const letterbox = transform.letterbox;
  const hasLetterbox = letterbox.type !== LetterboxType.NONE;

  // Calculate the content bounds (excluding letterbox/pillarbox)
  const minX = letterbox.barLeft;
  const maxX = transform.canvasWidth - letterbox.barRight;
  const minY = letterbox.barTop;
  const maxY = transform.canvasHeight - letterbox.barBottom;

  if (canvasX < minX || canvasX >= maxX || canvasY < minY || canvasY >= maxY) {
    return {
      ...createRejectionBase(
        RejectionReason.COORDINATE_OUT_OF_BOUNDS,
        `Coordinate (${canvasX}, ${canvasY}) is outside content bounds ` +
          `(${minX}-${maxX}, ${minY}-${maxY})`,
        transform.observationId
      ),
      reason: RejectionReason.COORDINATE_OUT_OF_BOUNDS,
      coordinateX: canvasX,
      coordinateY: canvasY,
      viewportWidth: transform.viewportWidth,
      viewportHeight: transform.viewportHeight,
      hasLetterbox,
    };
  }
  return null;
}

/**
 * Validates a transform exists for the given observation ID.
 */
export function validateTransformExists(
  observationId: number,
  store: TransformStore
): TransformNotFoundRejection | null {
  const transform = store.get(observationId);

  if (!transform) {
    return {
      ...createRejectionBase(
        RejectionReason.TRANSFORM_NOT_FOUND,
        `No transform found for observation ID ${observationId}`,
        observationId
      ),
      reason: RejectionReason.TRANSFORM_NOT_FOUND,
      requestedObservationId: observationId,
      latestObservationId: store.getLatestObservationId(),
    };
  }
  return null;
}

/**
 * Validates transform data integrity.
 */
export function validateTransformIntegrity(
  transform: TransformData
): TransformCorruptedRejection | null {
  const errors: string[] = [];

  if (transform.observationId < 0) {
    errors.push('Invalid observation ID');
  }

  if (transform.canvasWidth <= 0 || transform.canvasHeight <= 0) {
    errors.push('Invalid canvas dimensions');
  }

  if (transform.viewportWidth <= 0 || transform.viewportHeight <= 0) {
    errors.push('Invalid viewport dimensions');
  }

  if (transform.devicePixelRatio <= 0) {
    errors.push('Invalid DPR');
  }

  if (!transform.tabId) {
    errors.push('Missing tab ID');
  }

  if (!transform.url) {
    errors.push('Missing URL');
  }

  if (!transform.letterbox) {
    errors.push('Missing letterbox configuration');
  }

  if (errors.length > 0) {
    return {
      ...createRejectionBase(
        RejectionReason.TRANSFORM_CORRUPTED,
        `Transform corrupted: ${errors.join(', ')}`,
        transform.observationId
      ),
      reason: RejectionReason.TRANSFORM_CORRUPTED,
      corruptionDetails: errors.join('; '),
    };
  }

  return null;
}

/**
 * Validates if a transform has expired based on TTL.
 */
export function validateTransformExpiration(
  transform: TransformData,
  currentTime: number = Date.now()
): TransformExpiredRejection | null {
  if (transform.ttlMs === undefined) {
    return null; // No TTL means no expiration
  }

  const expirationTime = transform.createdAt + transform.ttlMs;

  if (expirationTime < currentTime) {
    return {
      ...createRejectionBase(
        RejectionReason.TRANSFORM_EXPIRED,
        `Transform expired ${currentTime - expirationTime}ms ago`,
        transform.observationId
      ),
      reason: RejectionReason.TRANSFORM_EXPIRED,
      transformCreatedAt: transform.createdAt,
      transformExpiredAt: expirationTime,
      expiredByMs: currentTime - expirationTime,
    };
  }

  return null;
}

/**
 * Performs full validation of a coordinate action.
 *
 * This validates:
 * 1. Transform exists in the store
 * 2. Transform has not expired
 * 3. Transform data is not corrupted
 * 4. Browser state matches (DPR, zoom, tab, URL)
 * 5. Screenshot dimensions match
 * 6. Target coordinate is within bounds
 *
 * @param observationId - The observation ID from the action
 * @param canvasX - X coordinate in canvas space
 * @param canvasY - Y coordinate in canvas space
 * @param browserState - Current browser state
 * @param screenshotDimensions - Current screenshot dimensions
 * @param store - Transform store
 * @param options - Validation options
 * @returns ValidationResult indicating success or the rejection reason
 */
export function validateAction(
  observationId: number,
  canvasX: number,
  canvasY: number,
  browserState: BrowserState,
  screenshotDimensions: { width: number; height: number },
  store: TransformStore,
  options: ValidateOptions = {}
): ValidationResult {
  // Step 1: Check transform exists
  const notFoundRejection = validateTransformExists(observationId, store);
  if (notFoundRejection) {
    return { valid: false, rejection: notFoundRejection };
  }

  const transform = store.get(observationId)!;

  // Step 2: Check transform integrity
  const integrityRejection = validateTransformIntegrity(transform);
  if (integrityRejection) {
    return { valid: false, rejection: integrityRejection };
  }

  // Step 3: Check transform expiration
  const expirationRejection = validateTransformExpiration(
    transform,
    Date.now()
  );
  if (expirationRejection) {
    return { valid: false, rejection: expirationRejection };
  }

  // Step 4: Validate browser state
  const { allowZoomNot100 = false } = options;

  // Check DPR
  const dprRejection = validateDpr(browserState.devicePixelRatio, transform);
  if (dprRejection) {
    return { valid: false, rejection: dprRejection };
  }

  // Check zoom not 100%
  const zoomNot100Rejection = validateZoomNot100(
    browserState.browserZoom,
    transform,
    allowZoomNot100
  );
  if (zoomNot100Rejection) {
    return { valid: false, rejection: zoomNot100Rejection };
  }

  // Check zoom changed (only if zoom was already not 100%)
  if (!allowZoomNot100) {
    const zoomChangedRejection = validateZoomChanged(
      browserState.browserZoom,
      transform
    );
    if (zoomChangedRejection) {
      return { valid: false, rejection: zoomChangedRejection };
    }
  }

  // Check tab
  const tabRejection = validateTab(browserState.tabId, transform);
  if (tabRejection) {
    return { valid: false, rejection: tabRejection };
  }

  // Check URL
  const urlRejection = validateUrl(browserState.url, transform);
  if (urlRejection) {
    return { valid: false, rejection: urlRejection };
  }

  // Step 5: Check screenshot dimensions
  const dimensionRejection = validateDimensions(
    screenshotDimensions.width,
    screenshotDimensions.height,
    transform
  );
  if (dimensionRejection) {
    return { valid: false, rejection: dimensionRejection };
  }

  // Step 6: Check coordinate is in bounds
  const boundsRejection = validateCoordinateInBounds(canvasX, canvasY, transform);
  if (boundsRejection) {
    return { valid: false, rejection: boundsRejection };
  }

  return { valid: true, transform };
}
