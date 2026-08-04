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

The initial implementation inherited a broken pnpm/Jest argument-forwarding path and legacy pairing/debugger failures. The review-hardening round below fixes those suite-level issues; the only remaining invocation caveat is pnpm 11's shared-worktree pre-run dependency-status check, documented with the final commands.

## Review hardening

- Added a local-storage write-ahead execution journal containing only action ID, idempotency key, observation ID, status, and a schema-validated completed result. A `started` record is never re-executed after suspension; it becomes a typed retryable indeterminate result requiring a fresh observation. A completed record is durably replayed after a crash between browser effect and result transmission.
- Persisted the full canonical structured terminal result and identifier-only approval metadata. Terminal reconciliation now carries the authoritative terminal message, persists it before UI emission, emits once, closes transport, clears bootstrap, and performs bounded debugger detach. Popup reopening restores terminal and approval state.
- Cancellation now owns the lifecycle abort controller from bootstrap start. It does not wait for a non-cooperative action, and startup/terminal/cancel close and detach work is bounded.
- Pipeline and post-observation failures after ACK are contained in exactly one sanitized typed `action.completed`. Transport message-handler failures are surfaced, stored as transport faults, and fail the socket closed instead of disappearing in a promise-tail catch.
- Popup terminal rendering now includes full summary, status, observation ID, confidence, findings, evidence observation IDs, and unmet criteria. Approval, cancellation, and reconnect UI remain available.
- Removed the legacy options page and redundant `activeTab`/icon declarations. Bootstrap configuration is administrator-managed; the active bundle has no legacy HTTP task/SSE/raw executor import path.
- The build requires every declared runtime asset, copies only manifest/popup assets, runs type-check first, and produces no source map. A package-local workspace and frozen lockfile cover the extension plus its two workspace protocol dependencies. The test runner normalizes pnpm's forwarded `-- --runInBand` arguments.
- Repaired the legacy debugger test isolation/mocks and pairing public-key export bug rather than excluding suites.

### Review TDD and final verification

RED regressions reproduced all review failures: started actions executed again, completed results disappeared before send, terminal/approval state was absent after restart, bootstrap cancellation did not abort, non-cooperative detach hung, pipeline errors escaped, controller faults were swallowed, and the manifest/build/popup retained unsafe or incomplete surfaces.

Final clean-dependency verification:

```text
CI=true pnpm --dir clients/browser-extension install --frozen-lockfile
332 packages installed from the frozen three-project workspace; lockfile policy verification passed

pnpm --config.verify-deps-before-run=false --dir clients/browser-extension test -- --runInBand
14 suites, 195 tests passed

pnpm --config.verify-deps-before-run=false --dir clients/browser-extension run build:tsc
exit 0

pnpm --config.verify-deps-before-run=false --dir clients/browser-extension run build
exit 0; no warnings

pnpm --config.verify-deps-before-run=false --filter @fara-platform/relay-protocol exec jest --runInBand agent-envelope
1 suite, 9 tests passed
```

The pnpm 11 pre-run dependency-status check still attempts an interactive module purge when invoked through `--dir` in this shared dirty monorepo. The explicit `--config.verify-deps-before-run=false` runs the already frozen-installed dependency tree; the separate clean frozen install above proves lockfile completeness.
