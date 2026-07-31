/**
 * Rejection types for stale or invalid coordinate transforms.
 *
 * When a coordinate transform becomes invalid or stale, these types
 * precisely identify the reason for rejection so the system can
 * decide whether to recalibrate or abort.
 */

/**
 * Base rejection type with reason and timestamp.
 */
export interface RejectionBase {
  /** Machine-readable rejection reason code */
  reason: RejectionReason;
  /** Human-readable description of the rejection */
  message: string;
  /** Unix timestamp when the rejection occurred */
  timestamp: number;
  /** The observation ID that was used when rejection occurred */
  observationId: number;
}

/**
 * All possible rejection reason codes.
 */
export const RejectionReason = {
  /** Screenshot dimensions don't match the recorded transform */
  DIMENSION_MISMATCH: 'DIMENSION_MISMATCH',
  /** Device pixel ratio changed since observation */
  DPR_CHANGED: 'DPR_CHANGED',
  /** Browser zoom level is not 100% */
  ZOOM_NOT_100: 'ZOOM_NOT_100',
  /** Browser zoom changed since observation */
  ZOOM_CHANGED: 'ZOOM_CHANGED',
  /** Selected browser tab changed since observation */
  TAB_CHANGED: 'TAB_CHANGED',
  /** Page navigated between observation and action */
  PAGE_NAVIGATED: 'PAGE_NAVIGATED',
  /** Target coordinate is outside the page viewport */
  COORDINATE_OUT_OF_BOUNDS: 'COORDINATE_OUT_OF_BOUNDS',
  /** Transform for the given observation ID was not found */
  TRANSFORM_NOT_FOUND: 'TRANSFORM_NOT_FOUND',
  /** Transform data is corrupted or incomplete */
  TRANSFORM_CORRUPTED: 'TRANSFORM_CORRUPTED',
  /** Action was submitted after the transform expired */
  TRANSFORM_EXPIRED: 'TRANSFORM_EXPIRED',
} as const;

export type RejectionReason =
  (typeof RejectionReason)[keyof typeof RejectionReason];

/**
 * Dimension mismatch rejection - screenshot dimensions do not match recorded transform.
 */
export interface DimensionMismatchRejection extends RejectionBase {
  reason: typeof RejectionReason.DIMENSION_MISMATCH;
  /** Expected width from the transform */
  expectedWidth: number;
  /** Expected height from the transform */
  expectedHeight: number;
  /** Actual width of the screenshot */
  actualWidth: number;
  /** Actual height of the screenshot */
  actualHeight: number;
}

/**
 * DPR change rejection - device pixel ratio changed since observation.
 */
export interface DprChangedRejection extends RejectionBase {
  reason: typeof RejectionReason.DPR_CHANGED;
  /** DPR that was recorded with the transform */
  recordedDpr: number;
  /** Current DPR at action time */
  currentDpr: number;
}

/**
 * Zoom rejection - browser zoom is not at 100%.
 */
export interface ZoomNot100Rejection extends RejectionBase {
  reason: typeof RejectionReason.ZOOM_NOT_100;
  /** Current browser zoom level (as a percentage, e.g., 150 for 150%) */
  currentZoom: number;
}

/**
 * Zoom changed rejection - browser zoom changed since observation.
 */
export interface ZoomChangedRejection extends RejectionBase {
  reason: typeof RejectionReason.ZOOM_CHANGED;
  /** Zoom level recorded with the transform */
  recordedZoom: number;
  /** Current zoom level at action time */
  currentZoom: number;
}

/**
 * Tab changed rejection - selected browser tab changed since observation.
 */
export interface TabChangedRejection extends RejectionBase {
  reason: typeof RejectionReason.TAB_CHANGED;
  /** Tab ID that was recorded with the transform */
  recordedTabId: string;
  /** Current tab ID at action time */
  currentTabId: string;
}

/**
 * Page navigation rejection - page navigated between observation and action.
 */
export interface PageNavigatedRejection extends RejectionBase {
  reason: typeof RejectionReason.PAGE_NAVIGATED;
  /** URL that was recorded with the transform */
  recordedUrl: string;
  /** Current URL at action time */
  currentUrl: string;
}

/**
 * Coordinate out of bounds rejection - target coordinate lies outside page viewport.
 */
export interface CoordinateOutOfBoundsRejection extends RejectionBase {
  reason: typeof RejectionReason.COORDINATE_OUT_OF_BOUNDS;
  /** The x coordinate that was out of bounds */
  coordinateX: number;
  /** The y coordinate that was out of bounds */
  coordinateY: number;
  /** Width of the viewport at observation time */
  viewportWidth: number;
  /** Height of the viewport at observation time */
  viewportHeight: number;
  /** Whether letterbox/pillarbox was present */
  hasLetterbox: boolean;
}

/**
 * Transform not found rejection - no transform exists for the given observation ID.
 */
export interface TransformNotFoundRejection extends RejectionBase {
  reason: typeof RejectionReason.TRANSFORM_NOT_FOUND;
  /** The observation ID that was not found */
  requestedObservationId: number;
  /** The highest observation ID that has a transform */
  latestObservationId: number | null;
}

/**
 * Transform corrupted rejection - transform data is corrupted or incomplete.
 */
export interface TransformCorruptedRejection extends RejectionBase {
  reason: typeof RejectionReason.TRANSFORM_CORRUPTED;
  /** Description of what was corrupted or missing */
  corruptionDetails: string;
}

/**
 * Transform expired rejection - action was submitted after transform expired.
 */
export interface TransformExpiredRejection extends RejectionBase {
  reason: typeof RejectionReason.TRANSFORM_EXPIRED;
  /** When the transform was created */
  transformCreatedAt: number;
  /** When the transform expired */
  transformExpiredAt: number;
  /** How long since expiration */
  expiredByMs: number;
}

/**
 * Union type of all possible rejections.
 */
export type Rejection =
  | DimensionMismatchRejection
  | DprChangedRejection
  | ZoomNot100Rejection
  | ZoomChangedRejection
  | TabChangedRejection
  | PageNavigatedRejection
  | CoordinateOutOfBoundsRejection
  | TransformNotFoundRejection
  | TransformCorruptedRejection
  | TransformExpiredRejection;

/**
 * Creates a base rejection object.
 */
export function createRejectionBase(
  reason: RejectionReason,
  message: string,
  observationId: number
): RejectionBase {
  return {
    reason,
    message,
    timestamp: Date.now(),
    observationId,
  };
}
