# Task 5 Report: Inference, Policy, and Verified Completion

## Status

Complete. The canonical orchestrator now calls the strict Python `/v1/plan` contract through `FaraPlanner`, enforces policy categories through `PolicyAdapter`, and accepts terminal success only through deterministic `CompletionVerifier` evidence checks.

## Implemented

- Added `FaraPlanner` with an exact Task 3 request body, bounded trajectory, stable request/work ID, `AbortSignal`, canonical response validation, typed contract and HTTP errors, and retained request/model/usage/finish-reason diagnostics.
- Extended inference and policy ports with required `AbortSignal`; `SessionEngine` owns only ephemeral controllers, aborts local work on cancellation/terminal stop/supersession, and retains Task 4 persisted claim fencing across processes.
- Integrated non-retryable contract errors with the canonical inference-repair terminal reason without synthesizing actions. Transient HTTP failures remain transport failures and do not consume model-contract repair budget.
- Added code-enforced categories for purchases, bookings, external messages, consequential submissions, account changes, uploads/downloads, credential entry, and sensitive disclosure.
- Denied unconfigured unsafe schemes, loopback/private/link-local/metadata targets, including IPv6 loopback/ULA/link-local targets. Explicit administrator host/scheme overrides remain available.
- Added deterministic completion outcomes (`accepted`, `continue`, `failed`) with typed reasons. Successful completion requires structured non-speculative findings, a referenced observation/verified fact, no reported unmet criterion, and referenced post-action evidence newer than the last completed action.
- Integrated verifier decisions into the durable trajectory as `verification_result`; rejected/partial completion waits for a fresh observation, while verified success or reported failure becomes terminal.

## TDD Evidence

Initial focused RED failed because the planner adapter, policy adapter, and completion verifier modules did not exist. Subsequent RED cycles reproduced:

- policy category precedence and unconfigured unsafe target denial;
- explicit administrator scheme override behavior;
- IPv6 loopback, ULA, and link-local navigation bypasses;
- compose-message and raw SSN disclosure classification gaps; and
- transient HTTP failures being incorrectly counted as inference contract failures.

Each behavior was implemented minimally and rerun green. Engine integration tests additionally cover policy denial without replanning, contract repair exhaustion without action synthesis, local inference/policy abort propagation, cross-process late-result fencing, and speculative completion rejection.

## Verification

Required gate:

```text
pnpm --filter @fara/agent-orchestrator test -- --runInBand
pnpm --filter @fara/agent-orchestrator build
```

Final result: 9 suites and 179 tests passed; strict TypeScript build exited successfully.

## Self-review

- Confirmed request bodies contain only Task 3 planning fields; session/task/work identifiers are carried outside the JSON contract.
- Confirmed every dispatched action still follows persisted proposal, policy intent, and Task 4 CAS/outbox transitions.
- Confirmed abort controllers never enter serializable session state and cannot replace persisted claim fencing.
- Confirmed denied policy decisions are terminal and cannot trigger alternative inference.
- Confirmed completion rejection emits deterministic evidence diagnostics without terminal success or command dispatch.
- Confirmed unrelated dirty files and generated artifacts are excluded from the Task 5 commit.

## Concerns

- The Python `/v1/plan` body intentionally remains the strict proposal union; model/usage/finish provenance is retained when the deployment exposes the corresponding response headers.
- The repository's root `workspaces` field still causes pnpm 11 warnings. Running filtered commands from the worktree root succeeds; invoking the same command from the package directory can trigger pnpm's unrelated non-TTY module-purge prompt.

## Fix Round 1 — 2026-08-04

Addressed all Task 5 critical/important review findings:

- Explicit policy `deny`/`block` now wins before all approval paths.
- Navigation uses an injected async resolver, checks every returned address with `ipaddr.js`, rejects empty/failed resolution by default, and rejects private, loopback, link-local, reserved, mixed public/private, and IPv4-mapped IPv6 answers. Only explicit administrator configuration can bypass resolution failure or an allowlisted private host.
- Interaction classification uses the actual semantic target selected by unique coordinate hit testing. Coordinate/target-ID disagreement, overlap, missing targets, localized/unknown controls, and ambiguous text insertion fail closed to approval.
- `verifierFailureCount` and the effective `maxVerifierFailures` threshold are persisted. A restart with different worker configuration still uses the session's stored threshold, which produces `VERIFIER_FAILURE_LIMIT_REACHED`; only accepted verification or a browser action with verified effect resets the counter.
- A speculative completion summary is always rejected. Only concrete findings can satisfy evidence linkage/freshness. Already-satisfied tasks may complete from the current `observation_captured` event when no action exists; after an action, concrete referenced evidence must be a newer post-action observation.
- `/v1/plan` now returns the propagated/generated request ID and actual model, finish reason, and usage from `FaraAdapter.last_inference_metadata` in `X-Request-ID`, `X-Fara-Model`, `X-Fara-Finish-Reason`, and `X-Fara-Usage`. `FaraPlanner` reads exactly those headers without legacy or invented fallbacks.
- A valid Task 3 question is a typed planning outcome persisted as `WAITING_FOR_USER` plus `pendingUserQuestion`; it emits the existing control-plane `approval_requested` trajectory event without consuming repair budget or dispatching a browser action.
- Planner diagnostics are bounded by a configurable access-ordered LRU, with eviction coverage.

### Red/green evidence

Focused RED runs reproduced missing provenance headers, unbounded/fallback diagnostics, target-ID/coordinate approval bypass, verification-only observational completion acceptance, and a non-persisted verifier threshold. Focused GREEN:

```text
NODE_OPTIONS='--experimental-vm-modules' node_modules/.bin/jest --runInBand policy-enforcement completion-verifier canonical-engine canonical-idempotency
4 focused suites passed

NODE_OPTIONS='--experimental-vm-modules' node_modules/.bin/jest --runInBand planner-contract
1 suite, 7 tests passed

python -m pytest tests/test_fara_adapter.py -q
19 tests passed (one Starlette/httpx deprecation warning)
```

### Final verification

```text
NODE_OPTIONS='--experimental-vm-modules' node_modules/.bin/jest --runInBand --testPathPattern='.*'
9 suites, 205 tests passed

node_modules/.bin/tsc
exit 0

ruff check app/api.py tests/test_fara_adapter.py
all checks passed (configuration deprecation warning only)

mypy app/api.py app/fara_adapter.py
success: no issues found in 2 source files

uv build
sdist and wheel built successfully
```

The repository's orchestrator `pnpm lint` script remains non-runnable because ESLint is neither declared nor installed; pnpm attempts an implicit install and hits its non-TTY module-purge guard. The full Python suite remains at 55 passing / 5 pre-existing failures in untouched `app/client.py` and `app/prompts.py`; the affected adapter/API suite is green.
