# Canonical Agent Loop and Client Protocol Design

**Date:** 2026-08-03
**Status:** Approved for implementation planning
**Scope:** Delivery item 1 of the browser automation MVP

## 1. Objective

Build one secure, versioned, testable execution path from browser observation through Brotto planning to local browser action, action acknowledgement, post-action observation, deterministic verification, and terminal outcome. Replace prompt-driven control decisions with controller-enforced invariants and create the stable identifiers and trajectory events required by later audit and recipe work.

This design does not implement the recipe compiler. It establishes the event and execution foundation the compiler will consume.

## 2. Selected approach

Complete the committed TypeScript agent orchestrator and shared protocol packages, while restricting Python to a narrow Brotto inference API. Migrate the extension from the ad-hoc HTTP/SSE prototype to the canonical authenticated WebSocket protocol. Keep the prototype available as reference until contract, integration, security, and controlled-browser end-to-end tests demonstrate equivalent connectivity and superior correctness; then quarantine it from supported runtime paths.

This approach is preferred over hardening the Python relay because it avoids investing in a second controller contract. It is preferred over a simultaneous greenfield rewrite because it permits independently testable migration steps and preserves useful existing modules.

## 3. Trusted boundary and prohibited data

The customer-controlled browser and self-hosted server are inside the deployment's trusted boundary. Screenshots and deliberately selected, sanitized semantic observation metadata may travel from the browser to that server over encrypted transport.

The client must never collect or transmit:

- cookies or cookie values;
- `Authorization`, proxy-authorization, or authentication headers;
- local-storage or session-storage values;
- credential-manager or browser-profile data;
- password-field values;
- hidden form values;
- raw authentication tokens belonging to visited websites.

Protocol schemas must not contain fields capable of representing these values. Security tests must inspect encoded outbound messages and fail if forbidden data appears.

## 4. Component boundaries

### 4.1 Browser extension

The extension owns tab consent, observation capture, client-side redaction, local policy enforcement, CDP execution, page settlement, action-result production, reconnect reconciliation, and safe detach. It is the final enforcement boundary for commands affecting the authenticated browser.

The background service worker must delegate to focused modules rather than maintain duplicate switches:

- session persistence and recovery;
- authenticated relay transport;
- observation capture and redaction;
- action validation and execution;
- page-settlement detection;
- client policy enforcement;
- trajectory event emission.

### 4.2 Shared protocol and action packages

The shared packages define the only supported envelope, message, action, observation, result, error, approval, and terminal schemas. They provide runtime validation, serialization, protocol-version negotiation, sequence/idempotency helpers, payload limits, and redaction-safe types.

Neither the extension nor the orchestrator may maintain private aliases such as `done` versus `terminate`, `go_back` versus `history_back`, or seconds versus milliseconds.

### 4.3 TypeScript orchestrator

The orchestrator owns the authoritative session state machine, budgets, inference requests, model-output repair, action validation, server policy, dispatch, result correlation, progress detection, completion verification, cancellation, and terminal outcome.

It must allow one in-flight inference request and one in-flight action per session. It must persist enough session state to reconcile reconnects and reject stale, duplicate, reordered, or conflicting messages.

### 4.4 Python Brotto inference service

The inference service exposes a narrow structured operation:

```text
(goal, completion criteria, current observation, bounded trajectory)
  -> action proposal | completion proposal | user-question proposal
```

It owns the exact Brotto 1.5 chat template, multimodal request construction, constrained structured decoding when supported, model metadata, and raw-response diagnostics. It does not own session transitions, policy, action execution, retries across browser steps, or completion authority.

## 5. Canonical session flow

The authoritative state flow is:

```text
CREATED
  -> CONNECTING
  -> OBSERVING
  -> PLANNING
  -> VALIDATING
  -> POLICY_CHECK
  -> WAITING_FOR_APPROVAL | DISPATCHING
  -> EXECUTING
  -> SETTLING
  -> VERIFYING
  -> OBSERVING | COMPLETED | FAILED | CANCELLED
```

For each step:

1. The extension captures and sanitizes observation `N`.
2. The orchestrator requests a structured proposal based on observation `N`.
3. The proposal is schema-validated and policy-checked.
4. The orchestrator dispatches action `A`, referencing observation `N`.
5. The extension rejects stale or locally prohibited action `A`, or acknowledges and executes it once.
6. The extension settles the page using browser lifecycle signals with bounded fallbacks.
7. The extension returns the typed result and observation `N+1`.
8. The orchestrator verifies progress or completion and either continues or terminates.

The orchestrator never treats elapsed time, receipt of an unrelated screenshot, or model prose as proof of action success.

## 6. Protocol design

The extension uses one outbound authenticated WebSocket connection. The protocol supports:

- `session.open` and `session.accepted`;
- `observation.submitted`;
- `action.command`;
- `action.acknowledged`;
- `action.completed`;
- `approval.requested` and `approval.resolved`;
- `task.completed`, `task.failed`, and `task.cancelled`;
- heartbeat, reconnect reconciliation, and typed protocol errors.

Every envelope contains:

- `protocolVersion`;
- cryptographically random `sessionId`;
- monotonic `sequence`;
- unique `messageId`;
- `correlationId` and `causationId`;
- creation timestamp and expiry;
- message type and validated payload;
- authenticated transport context or a transport-bound message MAC.

The receiver validates version, authentication, expiry, payload size, sequence, schema, state transition, and idempotency before processing the payload.

### 6.1 Observation payload

An observation contains:

- `observationId` and capture timestamp;
- screenshot bytes or a short-lived artifact reference;
- screenshot hash, dimensions, and encoding;
- current HTTP(S) URL and sanitized title;
- viewport width and height, device-pixel ratio, zoom, and scroll offset;
- page lifecycle and visibility state;
- attached tab/frame identity using client-scoped opaque identifiers;
- sanitized visible semantic candidates required for grounding and later recipes.

Semantic candidates may contain tag, role, accessible name after redaction, safe allowlisted attributes, bounding box, visibility, frame/shadow path, and locator candidates. They must omit element values, password information, hidden content, cookies, storage, headers, and raw page source.

### 6.2 Action command

An action command contains `actionId`, `stepId`, source `observationId`, action type, typed parameters, policy context, expiry, and idempotency key. The supported action set is fixed and versioned. Arbitrary JavaScript, arbitrary CDP, filesystem access, shell execution, and unrestricted Playwright code are not supported actions.

### 6.3 Action result

The extension acknowledges receipt before execution and emits one terminal action result:

- `succeeded`;
- `failed_recoverable`;
- `failed_terminal`;
- `rejected_stale`;
- `rejected_policy`;
- `approval_required`;
- `cancelled`.

The result includes execution timing, sanitized target metadata, navigation or dialog effects, typed error information, and the settled post-action observation. Missing parameters, unknown actions, and execution exceptions must produce explicit failure results rather than no-ops.

## 7. Model contract and completion

Brotto output uses constrained JSON matching a versioned proposal schema. XML-regex extraction is removed from the canonical path. The schema distinguishes action, completion, and user-question proposals.

If decoding or validation fails, the inference layer records the parse failure, performs a bounded repair request with validation diagnostics, and returns `INFERENCE_CONTRACT_ERROR` after the configured limit. It must never synthesize completion from unparsed content.

A completion proposal contains:

- status;
- concise user-facing summary;
- structured findings relevant to the original goal;
- references to observations or verified browser facts;
- unmet criteria, when partial or failed;
- confidence as model metadata, not completion authority.

The orchestrator accepts completion only when deterministic completion rules are satisfied. Speculative statements such as “clicking this should lead to the offers” fail verification and cause another observation or a typed terminal failure when budgets are exhausted.

## 8. Policy and cybersecurity controls

Both orchestrator and extension enforce policy. The extension may be stricter and cannot be overridden by the server or model.

Controls include:

- explicit user attachment to a permitted tab;
- HTTP(S)-only navigation by default;
- scheme, origin, redirect, private-network, and sensitive-domain checks;
- explicit approval for purchases, bookings, messages, submissions with consequences, account changes, uploads, downloads, credential entry, sensitive-data disclosure, and other configured high-impact actions;
- short-lived session credentials and random identifiers;
- TLS/WSS, origin validation, sequence checks, expiry, replay protection, rate limits, and bounded queues;
- screenshot and semantic-data redaction before transmission;
- separate encrypted artifact storage with content hashes and retention disabled by default;
- structured logs that exclude secrets and raw visited-site credentials.

Prompt instructions may explain policy but never authorize an action or downgrade a policy decision.

## 9. Reliability and recovery

- Invalid model output receives bounded repair and then a typed failure.
- Recoverable execution failure is returned to Brotto with the exact error and post-state.
- Page settlement uses CDP navigation/lifecycle events, DOM stability, and bounded fallback timeouts rather than unconditional sleeps.
- No-progress detection compares normalized action signatures, URLs, observation hashes, and verified effects.
- Repeated-action and repeated-state thresholds force alternative planning or terminal failure.
- Duplicate messages return the stored idempotent result.
- Stale actions are rejected and replanned from a fresh observation.
- Disconnect or MV3 suspension restores minimal non-secret session state, reconnects, and reconciles server sequence and action state.
- Cancellation aborts inference, queued transport work, and active execution where possible, detaches the debugger, clears ephemeral state, and emits one terminal event.
- Policy denial cannot be retried through alternate wording.

## 10. Trajectory events required by later work

Although durable audit storage is delivery item 3, item 1 defines and emits a versioned append-only event envelope with event, session, task, step, action, observation, correlation, causation, and sequence identifiers.

Minimum event kinds are session lifecycle, observation captured, model request/response/parse failure, action proposed, policy decided, approval requested/resolved, action acknowledged/completed, verification result, and task terminal outcome. Binary artifacts are referenced by hash rather than embedded in durable events.

## 11. Testing strategy

### 11.1 Contract tests

Test every envelope, observation, action, result, approval, error, and terminal schema. Test protocol-version negotiation, encoding round trips, payload limits, forbidden fields, duplicate IDs, invalid sequences, and expiry.

### 11.2 Model-contract tests

Maintain a golden corpus containing valid structured output, prose-only output, malformed/truncated JSON, unsupported actions, missing parameters, speculative completion, partial findings, and properly evidenced completion. No invalid corpus case may become success.

### 11.3 Orchestrator tests

Exercise successful multi-step runs, action failure, retry, stale observation, duplicate and reordered messages, reconnect reconciliation, cancellation, approval, policy denial, no progress, repeated state, step/time/inference budgets, and terminal event uniqueness.

### 11.4 Extension tests

Test CDP execution, coordinate transforms across viewport/DPR/zoom, semantic capture, redaction, forbidden-data absence, page settlement, debugger detach, tab close, navigation error, service-worker suspension, reconnect, action idempotency, and cancellation.

### 11.5 Security tests

Test cookie/header/storage/password leakage, guessed session identifiers, replay, localhost cross-site requests, invalid origin, oversized payloads, unsafe navigation, private-network access, policy bypass, and malicious model parameters.

### 11.6 Integration and E2E tests

Use a simulated extension to test the complete protocol deterministically. Use controlled local browser fixtures for navigation, search, scrolling, forms, popups, approvals, failure recovery, and completion evidence. Run isolated real-Brotto evaluations against the same observation corpus to distinguish model capability from controller defects. Public websites are exploratory diagnostics, not release gates.

## 12. Acceptance criteria

- Zero malformed or unsupported model outputs are classified as completion.
- Zero cookies, authorization headers, storage values, credentials, password values, or browser-profile data appear in encoded outbound messages across the security corpus.
- Each session has at most one in-flight inference and one in-flight action.
- Duplicate action results are handled idempotently in every test case.
- Every successful terminal event contains structured findings and verifier evidence.
- Every execution links its pre-observation, proposal, policy decision, result, and post-observation.
- No task produces duplicate terminal events.
- Cancellation reaches a terminal state and detaches the client within five seconds.
- Contract and state-machine tests contain no fixed-delay-dependent flaky assertions.
- The selected Brotto deployment achieves at least 90% completion on the controlled multi-step browser-task suite.
- The canonical runtime does not import or call the ad-hoc HTTP/SSE relay.

## 13. Migration and deletion policy

Implementation must preserve unrelated dirty-worktree changes. New canonical modules are introduced behind explicit entry points and tested before runtime switching. The prototype relay and duplicated action switches remain reference-only until the canonical path passes contract, security, simulated-client, and controlled-browser E2E gates. They may then be quarantined or deleted in a separately reviewable change that confirms no supported entry point depends on them.

No `.env`, dependency directory, generated bundle, screenshot, or secret may be included in commits.

## 14. Deferred delivery items

The following are intentionally deferred to their own approved designs after item 1 passes end to end:

- durable append-only audit persistence and tamper evidence;
- complete recording UI and retention controls;
- recipe eligibility and semantic action normalization;
- Playwright recipe compilation and provenance;
- replay validation, registry, versioning, signing, and zero-token runtime.
