# Task 9 Report: Canonical MV3 extension runtime and recovery

## Outcome

Implemented the authenticated canonical browser-extension runtime and removed the active legacy HTTP/SSE execution path.

- Added a WSS-only `CanonicalTransport` with per-session WebCrypto HMAC signing, strict envelope/binding/direction/expiry/replay/sequence checks, heartbeats, bounded reconnect, reconciliation, and abortable close.
- Added `CanonicalExtensionController` orchestration. It opens a bounded-goal session, acknowledges commands before execution, invokes only the Task 8 canonical pipeline, caches idempotent terminal results, captures post-action observations, reconciles suspension/reconnect state, propagates cancellation, and emits one terminal UI event.
- Added minimal recovery storage. Opaque recovery identifiers and sanitized trajectory summaries are durable; short-lived bootstrap credentials and HMAC material use `chrome.storage.session` only, expire and clear on disconnect, and have a memory-only fallback.
- Replaced the background worker with a canonical composition root using the Task 7 observation boundary and Task 8 execution factory. Bootstrap and DNS resolution omit cookies/credentials and fail closed when authenticated material or administrator trust policy is absent.
- Replaced the popup with canonical task, approval, cancellation, reconnect, status, and full structured terminal-result rendering. Legacy `/connect`, `/task`, SSE, raw action switching, and content-script activation are no longer part of the active extension.
- Made the build run `tsc --noEmit` before esbuild, propagate failures, omit source maps, and copy only the manifest, required HTML/JS, and icons.
- Extended `session.open` with a required bounded `goal`, mapped it to the canonical engine, and added an authenticated per-session envelope signer resolver so the server verifies and signs with the bootstrap session key.

## TDD evidence

Initial focused tests failed because the canonical controller, transport, and recovery modules did not exist. Final focused verification:

```text
pnpm --config.verify-deps-before-run=false --dir clients/browser-extension exec jest --runInBand canonical-transport canonical-controller session-recovery
3 suites, 16 tests passed

pnpm --config.verify-deps-before-run=false --filter @fara-platform/relay-protocol exec jest --runInBand agent-envelope
1 suite, 8 tests passed

pnpm --config.verify-deps-before-run=false --filter @fara/agent-orchestrator test -- --runInBand ws-reconcile ws-auth
11 suites, 231 tests passed
```

The extension coverage proves ACK-before-execute, duplicate suppression and stored-result replay, authenticated WSS signing and validation, reconnect reconciliation, bounded retry, abort/close behavior, secret-free restoration, expiry cleanup, cancellation, and exactly one terminal event.

## Build verification

```text
pnpm --config.verify-deps-before-run=false --dir clients/browser-extension exec tsc --noEmit
exit 0

pnpm --config.verify-deps-before-run=false --dir clients/browser-extension run build
exit 0

pnpm --config.verify-deps-before-run=false --filter @fara-platform/relay-protocol run build
exit 0

pnpm --config.verify-deps-before-run=false --filter @fara/agent-orchestrator run build
exit 0
```

No `.env`, source map, dependency directory, cookie, authorization header, local/session-storage value, password value, visited-site credential, or profile data is copied into the extension bundle or represented by recovery state.

## Concern

The brief's literal command `pnpm --dir clients/browser-extension test -- --runInBand` exits before test execution because the existing `test: jest` script expands to `jest -- --runInBand`, which treats `--runInBand` as a test-name pattern and reports `No tests found`. The equivalent direct Jest command above is green. The full legacy extension suite also retains unrelated pairing/debugger failures documented by Tasks 7 and 8; Task 9's focused suites, type-check, and build are green.
