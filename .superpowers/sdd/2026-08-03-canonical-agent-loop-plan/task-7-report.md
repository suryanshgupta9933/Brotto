# Task 7 Report: Sanitized Deterministic Browser Observations

## Status

Complete for the Task 7 scope. The extension now captures canonical `ObservationV1` values with deterministic opaque IDs and screenshot hashes, allowlisted visible semantic targets, URL/title redaction, strict shared-schema validation, and a final local forbidden-browser-data guard.

## Implemented

- Added `sanitizeSemanticTarget()` with visible/actionable checks, password and hidden-input rejection, strict canonical attribute/control/locator mapping, UUID path validation, deduplication, and schema caps.
- Added `captureObservation(tabId, options)` with visible-tab PNG capture, PNG dimensions, WebCrypto SHA-256, deterministic UUID-shaped observation/tab/frame/target IDs, viewport/DPR/zoom/scroll metadata, lifecycle/visibility normalization, and capped semantic targets.
- Limited page inspection to visible actionable elements and allowlisted reads. It never reads element values, `innerHTML`, cookies, storage, browser profiles, or network/authentication headers; the only CDP method is `Runtime.evaluate`.
- Added HTTP(S) URL sanitization that removes credentials, fragments, and sensitive query/path material, plus whole-field title/text redaction when sensitive content is detected.
- Added the canonical action-schema and relay-protocol workspace runtime dependencies. Tests resolve the live Task 1 schema source; TypeScript/browser bundling resolves the canonical package build.
- Applied `assertNoForbiddenBrowserData()` and `ObservationV1Schema.parse()` to every completed observation before return, wrapping rejection in a local `ObservationSecurityError`.

## TDD Evidence

Initial RED failed because `src/canonical/redaction.ts` and `src/canonical/observation.ts` did not exist. A later focused RED proved that visible non-actionable roles were accepted before the sanitizer was tightened.

Final focused verification:

```text
pnpm --config.verify-deps-before-run=false --dir clients/browser-extension test -- --runInBand redaction observation
2 suites, 17 tests passed

tsc -p clients/browser-extension/tsconfig.task7.json (temporary scoped config)
exit 0

esbuild src/canonical/observation.ts --bundle --write=false (programmatic API)
exit 0

prettier --check <four Task 7 source/test files>
all matched files use Prettier code style
```

The temporary type-check config was removed after verification; the in-memory esbuild verification did not write a generated bundle.

## Self-review

- Confirmed encoded fixtures contain none of `password`, `cookie`, `authorization`, `localStorage`, `sessionStorage`, or the adjacent `super-secret-value`.
- Confirmed the canonical Task 1 schema mismatch was handled without schema drift: `data-testid` maps to `test_id`, input `type` maps to control metadata, and safe `name` is fallback label input only.
- Confirmed no Task 6 transport or Task 8 policy/action/settlement files are included in this commit.
- Confirmed no dependency directory, `.env`, browser state, screenshot, or generated bundle is included.

## Concerns

- The required full extension suite is not globally green because three unrelated legacy suites fail TypeScript compilation: `tests/pairing.test.ts` and `tests/crypto.test.ts` use an impossible narrowed array branch, and `tests/debugger.test.ts` refers to a missing Chrome `Target` type. The run still reported 6 passing suites and 60 passing tests, including all Task 7 and concurrent Task 8 suites.
- Full extension `build:tsc` is blocked by three unrelated errors in the pre-existing dirty `src/background.ts` (`currentTask` missing, nullable `activeSession`, and nullable tab ID). Task 7's two production modules pass isolated strict type-checking.
- The prescribed pnpm command attempts to reconcile the pre-existing dependency directory and aborts in a non-TTY. Verification therefore used `--config.verify-deps-before-run=false`, which runs the existing local binaries without installing, purging, or mutating dependencies.
- The repository build script writes `dist`; because this task explicitly forbids touching generated bundles, bundle validity was checked with esbuild `write:false` instead.
- An independent reviewer subagent could not be started because all concurrency slots were occupied; a scoped self-review and fresh verification were completed instead.

## Review Fix Round — 2026-08-04

Addressed all Task 7 Critical/Important privacy and integrity findings:

- Visible screenshot capture is now fenced to the exact requested active tab and window. Identity is checked initially, immediately before capture, and immediately after capture; inactive, switched, or window-mismatched tabs reject the observation locally.
- Capture is sequential. Strict pre/post page snapshots, zoom, URL, title, viewport/DPR/scroll, lifecycle, visibility, document token, sensitive regions, and semantic metadata must match before an observation can be emitted.
- Visible password, OTP, passcode, token, API-key, bearer, credential, and account regions are detected without reading form values. Sensitive leaf text masks its parent container, opaque canvas/video surfaces are masked, and bounded token/OTP/account-value patterns are treated as sensitive.
- Sensitive PNG regions are painted opaque black through `OffscreenCanvas` before encoding, hashing, schema validation, or return. If masking support, decoding, context creation, bounds, or re-encoding fails, capture fails closed.
- A sensitive-region masker must change the screenshot bytes; a no-op masking result is rejected before hashing or return.
- PNG encoded length, decoded length, dimensions, and total pixels are validated before full base64 decode/allocation/hash. Masked output is revalidated and must retain dimensions related to the stable viewport/DPR/zoom.
- URL serialization now allowlists benign query keys, normalizes key names, removes fragments/credentials/unknown parameters, rejects sensitive values, and enforces a 2,048-character cap. Titles remain capped at 512 characters.
- Numeric capture options, tab IDs, timestamps, zoom, viewport numbers, sensitive rectangles, and snapshot state are strictly validated rather than rounded/clamped/defaulted from malformed values.
- DOM inspection uses a bounded `TreeWalker`. Incomplete scans or sensitive-region overflow reject capture instead of returning a partially privacy-checked observation.
- Child-frame presence rejects capture because `ObservationV1` cannot represent observation completeness. Main-frame targets use an explicit empty `framePath` plus opaque page frame provenance; invalid or overlong frame/shadow paths now reject instead of silently filtering segments.

### Review TDD evidence

Focused RED reproduced missing active-tab/masking APIs, screenshot byte leakage, tab switching, page drift, frame ambiguity, malformed numeric options, oversized PNG allocation, dimension mismatch, allowlist bypasses (`access_token`, `api_key`, `auth`, `bearer`), overlong URLs, and silent invalid path filtering.

Focused GREEN after the review fixes:

```text
pnpm --config.verify-deps-before-run=false --dir clients/browser-extension test --runInBand redaction observation
2 suites, 37 tests passed

tsc -p clients/browser-extension/tsconfig.task7.json (temporary scoped config)
exit 0

esbuild src/canonical/observation.ts --bundle --write=false (programmatic API)
exit 0
```

The complete extension run reaches 7 passing suites and 105 passing tests, then remains blocked by the same three unrelated legacy TypeScript test-compilation failures in `pairing.test.ts`, `crypto.test.ts`, and `debugger.test.ts`. Full `build:tsc` remains blocked only by the same three unrelated pre-existing `background.ts` errors documented above.
