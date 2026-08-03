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
