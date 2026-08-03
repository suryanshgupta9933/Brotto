# Task 4 Report: Authoritative Session Engine and Idempotent Store

## Status

Complete. The orchestrator now has a pure TypeScript canonical session engine, serializable CAS-backed state, processed-message idempotency, single-flight inference/action enforcement, stale result rejection, approval/reconnect/cancellation transitions, typed progress budgets, and trajectory/command ports.

## Implemented

- Added canonical engine contracts and serializable state in `src/engine/types.ts`.
- Added `InMemorySessionStore` with isolated snapshots, revision compare-and-swap, and atomic processed-message indexing.
- Added `SessionEngine.handle(event)` for session open, observation, approval resolution, terminal action result, reconnect reconciliation, and cancellation.
- Persisted active work before command dispatch and append-only trajectory emission.
- Enforced one active inference and one active action, including CAS retry under concurrent observations and state guards around pending policy work.
- Rejected mismatched action/step/observation results with stored idempotent `STALE_ACTION_RESULT` outcomes.
- Added normalized SHA-256 action and URL/screenshot observation signatures.
- Added typed detection for repeated actions, repeated observations, no verified effect, step count, elapsed time, consecutive action failure, and inference repair exhaustion.
- Reconciled stale action-schema and policy-engine workspace imports and added the relay-protocol workspace dependency.
- Restored the Jest command so the brief's pnpm 11 command form still runs the suite despite pnpm forwarding the literal `--` separator.

## TDD Evidence

### Canonical RED

Command:

```text
pnpm --filter @fara/agent-orchestrator test --runInBand canonical-engine canonical-idempotency
```

Observed: both suites failed because `../engine/session-store.js` and `../engine/session-engine.js` did not exist. Workspace packages resolved successfully.

Subsequent RED cycles reproduced:

- approval-required commands dispatching before approval;
- terminal results not advancing from their post-observation;
- cancellation not clearing active work;
- concurrent observation CAS conflicts;
- repeated post-state replanning after budget exhaustion;
- new observations entering while policy evaluation was pending;
- late policy results reviving a cancelled session.

Each regression was re-run green after the minimal state-transition/store change.

## Baseline Versus Final

Initial full-suite baseline after workspace import resolution:

- history failure-message fixture failed;
- parser crashed because the type-only `ParseError` was used with `instanceof`;
- retry tests crashed asynchronously;
- ESM suites lacked explicit Jest globals;
- the build exposed stale policy imports and legacy action-schema API mismatches.

The legacy reconciliation was limited to those failures required by the brief's full-suite/build gate: current workspace names, current result APIs, deterministic retry fixtures/state, EventEmitter signatures, observation ID creation, and compiler cleanup.

Final verification target:

```text
pnpm --filter @fara/agent-orchestrator test -- --runInBand && pnpm --filter @fara/agent-orchestrator build
```

## Self-review

- Confirmed all command dispatches occur only after the `EXECUTING` state and active action are persisted.
- Confirmed duplicate message IDs return the stored outcome without repeating inference, policy, command, or terminal events.
- Confirmed logical duplicate action results cannot create another step.
- Confirmed cancellation and policy evaluation races cannot revive terminal state.
- Confirmed new canonical state contains ISO timestamp strings and plain structured-clone/JSON-compatible values only.
- Confirmed generated `dist`, local `node_modules`, and package-local lockfiles are excluded from the commit.

## Concerns

- The repository uses a root `workspaces` field without `pnpm-workspace.yaml`; pnpm 11 emits warnings on every filtered command. This task preserves that repository-level setup.
- Inference repair attempt accounting is represented in canonical state and covered by pure terminal-reason detection. The real planner error-to-counter integration remains Task 5's adapter responsibility.
- Completion proposals remain model-terminal placeholders here; deterministic evidence verification remains explicitly scoped to Task 5.

## Review Fix Round 1

Addressed all five Task 4 review findings without expanding into adapter or gateway work:

- Added `SessionStore.transition()` so a canonical session revision and its processed-message outcome are validated and indexed in one store operation. Approval now commits the processed approval and pending command together; a cancellation that wins the CAS race leaves no accepted approval and cannot dispatch.
- Persisted the generated proposal/policy request tuple before policy evaluation, including action, step, observation, and policy-decision IDs. Proposal, policy decision, approval, active result, and completed-result duplicates are checked against their authoritative tuple; result sequence must be exactly the command sequence plus one.
- Added a persisted command-delivery outbox (`pending`/`sent`, attempt count, timestamps, last error). Send attempts are persisted before the external call, failures remain replayable, duplicate messages resume pending delivery, and reconcile replays after process loss.
- Added explicit action lineage to trajectory events and a separate persisted monotonic `eventSequence`, including the command-persisted dispatch event.
- Removed the pre-planning post-observation signature write. A physical post-observation is now recorded once by the observation transition.
- Replaced permissive `JSON.stringify` validation with recursive strict JSON-value validation, including rejection of `undefined`, functions, symbols, cycles, non-finite numbers, and non-plain objects. Atomic outcomes must identify the same session revision and state.

### Review RED evidence

The focused engine suite initially reported 12 failures covering persisted delivery metadata, persisted policy intent, approval/cancellation atomicity, send retry/restart replay, unknown-client reconciliation, proposal/policy/result staleness, duplicate full-result correlation, trajectory sequences/lineage, and double-counted post-observations. The strict store suite separately reproduced acceptance of invalid JSON values and mismatched atomic outcomes.

### Review verification target

```text
NODE_OPTIONS='--experimental-vm-modules' node_modules/.bin/jest --runInBand
node_modules/.bin/tsc
```

Local package installation required a temporary untracked pnpm workspace declaration because unrelated shared-worktree manifest changes caused pnpm to purge the service's dependencies. The temporary workspace file, package-local lockfile, `node_modules`, and generated `dist` remain excluded from the Task 4 commit.

Final review-fix verification: 6 suites, 131 tests passed, 0 failures; TypeScript build exited successfully.

## Review Fix Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and execute these steps inline in the existing Task 4 worktree.

**Goal:** Make trajectory delivery durable and causally ordered while allowing duplicate messages and reconnects to resume stranded canonical work.

**Architecture:** `CanonicalSession` owns an ordered trajectory outbox. Business transitions allocate complete `TrajectoryEventV1` records and advance `eventSequence` inside the same CAS that stores state and any processed outcome. A recovery loop appends pending records through an event-ID-idempotent sink, marks delivery with CAS, and only then resumes persisted planning, policy, verification, or command work.

**Global constraints:** Keep changes inside Task 4 and the minimal compiler cleanup required by `noUnusedLocals`/`noUnusedParameters`; add no database, WebSocket, or new runtime dependency.

### Task A: Durable trajectory and recovery state

**Files:** `src/engine/types.ts`, `src/engine/session-engine.ts`, `src/__tests__/canonical-engine.test.ts`.

**Interfaces:** Add `TrajectoryDelivery` and `trajectoryOutbox` to `CanonicalSession`; keep `TrajectorySink.append(event)` but define it as idempotent by `event.eventId`. Add a persisted `pendingPostObservation` continuation for `VERIFYING` recovery.

- [x] Add tests where observation event append fails after the state/outcome CAS, then the identical message and a new engine reconcile both retry the same event IDs and finish one action.
- [x] Add an append-success/mark-conflict test whose idempotent sink observes one logical event per event ID.
- [x] Replace post-CAS `emit()` with transition-local event allocation and an ordered flush/resume loop.
- [x] Verify the focused engine suite passes.

### Task B: Approval causality and receipt reconciliation

**Files:** `src/engine/session-engine.ts`, `src/__tests__/canonical-engine.test.ts`.

- [x] Add an approval test asserting `approval_resolved` precedes `action_acknowledged`, and the command sink sees both durably delivered first.
- [x] Add receipt tests for matching `pendingActionIds`, received command sequence, and neither proof.
- [x] Queue approval resolution and action acknowledgement in the same transition as the approved command, then gate send on outbox flush.
- [x] Implement receipt-proof branches and verify the focused suite.

### Task C: Exact JSON round trips and strict compiler gate

**Files:** `src/engine/session-store.ts`, `src/__tests__/canonical-idempotency.test.ts`, `tsconfig.json`, and only compiler-identified orchestrator sources.

- [x] Add failing tests for sparse arrays, enumerable extra array keys, symbol keys, and non-enumerable own object properties.
- [x] Reject values whose own-key shape would change under JSON round trip.
- [x] Set both unused compiler flags to `true`, remove the compiler-reported unused declarations/parameters, and run the build.

### Task D: Final verification and handoff

- [x] Run focused durability tests, all orchestrator tests, TypeScript build, and scoped diff checks.
- [x] Append RED/GREEN evidence and exact counts to this report.
- [x] Commit only Task 4 files and send the commit hash to the parent.

### Review Fix Round 2 Evidence

The first focused RED run produced nine failures: three durable trajectory/recovery cases, approval causal ordering, sequence-based receipt reconciliation, and four exact JSON round-trip cases. The strict-unused compiler RED independently reported 20 unused declarations or parameters in the orchestrator sources reconciled by Task 4.

The implementation now:

- allocates complete trajectory events and monotonically advances `eventSequence` while appending ordered `pending` outbox entries inside the same session CAS as the causal state/outcome;
- retries the same `eventId` through an idempotent `TrajectorySink`, records append failures, and CAS-marks successful delivery;
- resumes persisted inference, policy, post-observation verification, and command work only after earlier trajectory events are delivered;
- atomically queues `approval_resolved` before `action_acknowledged` with the approved command and prevents command send until both are durably delivered;
- uses either matching `pendingActionIds` or `lastReceivedSequence >= command.sequence` as receipt proof, and replays only when neither is present;
- rejects sparse/extended arrays, symbol keys, and non-enumerable own properties in canonical JSON state; and
- builds with `noUnusedLocals` and `noUnusedParameters` enabled.

Focused GREEN: 2 suites, 49 tests passed. Full pre-commit GREEN: 6 suites, 141 tests passed; strict TypeScript build exited successfully.

## Review Fix Round 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` and execute these steps inline in the existing Task 4 worktree.

**Goal:** Reserve command sequence `0` as the client “nothing received” watermark, make strict JSON array validation round-trip exact, and serialize inference/policy work across engine instances with persisted CAS leases.

**Architecture:** `CanonicalSession` owns one optional `workClaim` because its state machine permits only one external inference or policy operation at a time. Each engine CAS-claims the stable work ID immediately before calling its port; only the current owner may apply a result, and successful transitions or cancellation clear the claim. An active lease blocks other engines, while lease expiry permits another engine to repeat the idempotent port call using the same work ID without a distributed lock.

**Tech stack:** TypeScript, Jest, canonical revision CAS, injected ISO clock and 30-second default claim TTL.

### Task A: Positive command sequence watermark

**Files:** `src/engine/session-engine.ts`, `src/__tests__/canonical-engine.test.ts`, `src/__tests__/canonical-idempotency.test.ts`.

- [x] Add a reconcile test proving command sequence `1` replays when `lastReceivedSequence` is `0`, but not when the watermark is `1` or the action ID is pending.
- [x] Run the focused engine test and confirm the current sequence-`0` behavior fails the new expectation.
- [x] Initialize `nextSequence` to `1` and update only fixtures/results whose command/result sequence contract changes.
- [x] Re-run the focused test green.

### Task B: Exact array own-key validation

**Files:** `src/engine/session-store.ts`, `src/__tests__/canonical-idempotency.test.ts`.

- [x] Add a failing test with a custom non-enumerable string property on an otherwise dense array.
- [x] Run the store test and confirm the current `Object.keys` check incorrectly accepts it.
- [x] Validate array `Reflect.ownKeys` against exactly `length` plus canonical dense indices `0..length-1`, while retaining hole, symbol, and enumerable-extra rejection.
- [x] Re-run the store test green.

### Task C: Cross-instance inference and policy claims

**Files:** `src/engine/types.ts`, `src/engine/session-engine.ts`, `src/__tests__/canonical-engine.test.ts`.

**Interfaces:** Add `WorkClaim`, `CanonicalSession.workClaim`, `PlanningInput.workId`, `PolicyInput.workId`, and `SessionEngineOptions.workClaimTtlMs`/`claimantId`. Use the existing `now()` injection for lease comparisons.

- [x] Add shared-store two-engine tests proving one inference call and one policy call while a non-expired claim is active, with the same persisted work ID reaching the port.
- [x] Run those tests RED because process-local recovery Sets cannot coordinate the engines.
- [x] Add an expiry test proving another engine can CAS-reclaim after 30 seconds, calls with the same work ID, and ignores the stale first owner’s late result.
- [x] Add a cross-engine cancellation test proving the claim is cleared and a late port result cannot leave `CANCELLED`.
- [x] Run the new claim tests RED for the missing persisted claim protocol.
- [x] Implement claim acquisition by revision CAS, active-lease observation, expired takeover, owner/work-ID result guards, atomic claim clearing on result transitions, and cancellation invalidation. Keep the local Sets only as an in-process optimization.
- [x] Re-run all focused claim tests green, then refactor duplicated claim checks without changing behavior.

### Task D: Verification and handoff

- [x] Run both focused canonical suites, all orchestrator tests, and the strict TypeScript build.
- [x] Append exact RED/GREEN evidence and test counts to this report.
- [x] Inspect the scoped diff, commit only Task 4 files, and send the commit hash to the controller.

### Review Fix Round 3 Evidence

The focused RED run produced six expected failures: duplicate inference across two engines, duplicate policy evaluation across two engines, no active-lease suppression before expiry, no persisted claim to clear on cancellation, watermark `0` suppressing replay of command `0`, and acceptance of a non-enumerable custom array property. The remaining 48 focused tests passed.

The implementation now:

- reserves command sequence `0` as “nothing received,” allocates the first command at `1`, replays it for watermark `0`, and treats watermark `1` or greater and a matching pending action ID as receipt proof;
- validates arrays with `Reflect.ownKeys`, allowing only `length` and dense canonical indices while rejecting holes, symbols, and enumerable or non-enumerable custom keys;
- persists an inference or policy `workClaim` with a per-engine claimant, stable port `workId`, and injectable 30-second lease;
- acquires ownership with the existing revision CAS before external calls, blocks other engines while the lease is active, and reclaims expired leases using the same idempotency ID; and
- clears ownership in result/cancellation transitions and rejects late results from an owner displaced by takeover or cancellation.

Focused GREEN: 2 suites, 55 tests passed. Final GREEN: 6 suites, 147 tests passed, 0 failures; strict TypeScript build exited successfully.
