/**
 * Transform storage and retrieval per observation ID.
 *
 * Every screenshot is accompanied by a monotonically increasing
 * observation ID. This module stores the transformation data
 * for each observation and allows retrieval for validation
 * and coordinate translation.
 */

import { LetterboxConfig } from './letterbox.js';

/**
 * Transform data stored for each observation.
 */
export interface TransformData {
  /** Monotonically increasing observation ID */
  observationId: number;
  /** Fixed model canvas width */
  canvasWidth: number;
  /** Fixed model canvas height */
  canvasHeight: number;
  /** Browser viewport width at observation time */
  viewportWidth: number;
  /** Browser viewport height at observation time */
  viewportHeight: number;
  /** Device pixel ratio at observation time */
  devicePixelRatio: number;
  /** Browser zoom level at observation time (100 = 100%) */
  browserZoom: number;
  /** Tab ID at observation time */
  tabId: string;
  /** URL at observation time */
  url: string;
  /** Letterbox/pillarbox configuration */
  letterbox: LetterboxConfig;
  /** Timestamp when the transform was created */
  createdAt: number;
  /** Optional expiration time in milliseconds */
  ttlMs?: number;
}

/**
 * Transform storage interface for managing transforms per observation.
 */
export interface TransformStore {
  /**
   * Stores a transform for a given observation ID.
   * @param observationId - The observation ID
   * @param transform - The transform data
   */
  store(observationId: number, transform: TransformData): void;

  /**
   * Retrieves a transform by observation ID.
   * @param observationId - The observation ID to look up
   * @returns The transform data or undefined if not found
   */
  get(observationId: number): TransformData | undefined;

  /**
   * Gets the latest stored observation ID.
   * @returns The latest observation ID or null if no transforms stored
   */
  getLatestObservationId(): number | null;

  /**
   * Checks if a transform exists for the given observation ID.
   * @param observationId - The observation ID to check
   * @returns true if a transform exists
   */
  has(observationId: number): boolean;

  /**
   * Removes transforms older than the given observation ID.
   * @param observationId - Delete transforms with ID less than this value
   */
  prune(observationId: number): void;

  /**
   * Clears all stored transforms.
   */
  clear(): void;

  /**
   * Gets all stored transforms as an array sorted by observation ID.
   * @returns Array of all transform data
   */
  getAll(): TransformData[];
}

/**
 * In-memory implementation of TransformStore.
 * Suitable for single-session use. For persistent storage,
 * implement the TransformStore interface.
 */
export class InMemoryTransformStore implements TransformStore {
  private transforms: Map<number, TransformData> = new Map();
  private latestId: number | null = null;

  store(observationId: number, transform: TransformData): void {
    this.transforms.set(observationId, { ...transform, observationId });
    if (this.latestId === null || observationId > this.latestId) {
      this.latestId = observationId;
    }
  }

  get(observationId: number): TransformData | undefined {
    return this.transforms.get(observationId);
  }

  getLatestObservationId(): number | null {
    return this.latestId;
  }

  has(observationId: number): boolean {
    return this.transforms.has(observationId);
  }

  prune(observationId: number): void {
    for (const id of this.transforms.keys()) {
      if (id < observationId) {
        this.transforms.delete(id);
      }
    }
    // Recalculate latest ID if needed
    if (this.latestId !== null && this.latestId < observationId) {
      this.latestId = null;
      for (const id of this.transforms.keys()) {
        if (this.latestId === null || id > this.latestId) {
          this.latestId = id;
        }
      }
    }
  }

  clear(): void {
    this.transforms.clear();
    this.latestId = null;
  }

  getAll(): TransformData[] {
    return Array.from(this.transforms.values()).sort(
      (a, b) => a.observationId - b.observationId
    );
  }
}

/**
 * Global default transform store instance.
 */
let defaultStore: TransformStore | null = null;

/**
 * Gets the default global transform store.
 * Creates one if it doesn't exist.
 */
export function getDefaultStore(): TransformStore {
  if (!defaultStore) {
    defaultStore = new InMemoryTransformStore();
  }
  return defaultStore;
}

/**
 * Sets the default global transform store.
 * Useful for dependency injection or testing.
 */
export function setDefaultStore(store: TransformStore): void {
  defaultStore = store;
}

/**
 * Resets the default store to a fresh InMemoryTransformStore.
 */
export function resetDefaultStore(): void {
  defaultStore = new InMemoryTransformStore();
}

/**
 * Creates a new transform data object.
 * Convenience function for creating properly structured transform data.
 */
export function createTransformData(
  observationId: number,
  canvasWidth: number,
  canvasHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number,
  browserZoom: number,
  tabId: string,
  url: string,
  letterbox: LetterboxConfig,
  ttlMs?: number
): TransformData {
  return {
    observationId,
    canvasWidth,
    canvasHeight,
    viewportWidth,
    viewportHeight,
    devicePixelRatio,
    browserZoom,
    tabId,
    url,
    letterbox,
    createdAt: Date.now(),
    ttlMs,
  };
}

/**
 * Checks if a transform has expired based on its TTL.
 * @param transform - The transform to check
 * @param currentTime - Current timestamp (defaults to Date.now())
 * @returns true if the transform has expired
 */
export function isTransformExpired(
  transform: TransformData,
  currentTime: number = Date.now()
): boolean {
  if (transform.ttlMs === undefined) {
    return false; // No TTL means no expiration
  }
  return transform.createdAt + transform.ttlMs < currentTime;
}
