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
