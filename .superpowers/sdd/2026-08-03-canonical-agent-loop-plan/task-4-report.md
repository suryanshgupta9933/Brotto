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
