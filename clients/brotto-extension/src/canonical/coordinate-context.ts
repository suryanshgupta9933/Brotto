export interface CapturedCoordinateContext {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly devicePixelRatio: number;
  readonly zoom: number;
}

export type CoordinateTransformResult =
  | { readonly x: number; readonly y: number }
  | { readonly ok: false; readonly error: { readonly code: "MISSING_ACTION_PARAMETER" | "INVALID_ACTION_PARAMETER" | "COORDINATE_OUT_OF_BOUNDS"; readonly message: string; readonly retryable: boolean } };

export function transformCapturedPoint(rawX: unknown, rawY: unknown, capture: CapturedCoordinateContext): CoordinateTransformResult {
  if (typeof rawX !== "number" || !Number.isFinite(rawX) || typeof rawY !== "number" || !Number.isFinite(rawY)) {
    return { ok: false, error: { code: "MISSING_ACTION_PARAMETER", message: "Pointer actions require finite coordinates", retryable: false } };
  }
  const scale = capture.devicePixelRatio * capture.zoom;
  if (!Number.isFinite(scale) || scale <= 0 || capture.viewportWidth <= 0 || capture.viewportHeight <= 0) {
    return { ok: false, error: { code: "INVALID_ACTION_PARAMETER", message: "Captured viewport transform is invalid", retryable: false } };
  }
  if (rawX < 0 || rawY < 0 || rawX > capture.viewportWidth * scale || rawY > capture.viewportHeight * scale) {
    return { ok: false, error: { code: "COORDINATE_OUT_OF_BOUNDS", message: "Pointer coordinate is outside the captured viewport", retryable: true } };
  }
  return { x: rawX / scale, y: rawY / scale };
}
