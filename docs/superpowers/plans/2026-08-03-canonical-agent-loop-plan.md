# Canonical Agent Loop and Client Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc HTTP/SSE prototype with one secure, versioned TypeScript-controlled observation → plan → policy → action → result → verification loop, using Python only as the structured Brotto inference adapter.

**Architecture:** Shared Zod schemas are the only wire and action contracts. A pure TypeScript session engine enforces one in-flight action, idempotency, budgets, policy, and verified completion; an authenticated WebSocket server connects it to a modular MV3 extension client. The Python inference service accepts multimodal observations and returns constrained action/completion proposals without owning session state.

**Tech Stack:** TypeScript 5.4, Zod 3.22, Node.js 20, Jest 29, Fastify/WebSocket, Python 3.11, FastAPI/Pydantic 2, pytest 8, Chrome Manifest V3, Chrome DevTools Protocol.

## Global Constraints

- Screenshots and sanitized semantic observation metadata may travel only to the configured customer-controlled server.
- Cookies, authorization headers, local/session-storage values, credentials, password values, and browser-profile data must never be collected or transmitted.
- TypeScript owns the canonical controller; Python owns only Brotto request/response adaptation.
- Exactly one inference request and one action may be in flight per session.
- Parse failure, unsupported output, or speculative prose must never become successful completion.
- Every action must link its source observation, policy decision, execution result, and settled post-action observation.
- Preserve unrelated dirty-worktree changes and never commit `.env`, secrets, dependency directories, generated bundles, screenshots, or browser data.
- No arbitrary JavaScript, unrestricted CDP, filesystem, shell, or unrestricted Playwright action may appear in the model-facing schema.

---

## Planned file structure

### Shared contracts

- `packages/brotto-action-schema/src/v1/ids.ts`: branded run, task, step, observation, action, and message identifiers.
- `packages/brotto-action-schema/src/v1/observation.ts`: sanitized observation and semantic-target schemas.
- `packages/brotto-action-schema/src/v1/actions.ts`: canonical action, proposal, completion, and user-question schemas.
- `packages/brotto-action-schema/src/v1/results.ts`: typed action outcomes with no browser-secret fields.
- `packages/brotto-action-schema/src/v1/events.ts`: append-only trajectory-event schemas.
- `packages/brotto-relay-protocol/src/v1/envelope.ts`: authenticated application envelope.
- `packages/brotto-relay-protocol/src/v1/messages.ts`: session, observation, action, approval, terminal, heartbeat, and reconciliation messages.
- `packages/brotto-relay-protocol/src/v1/guard.ts`: size, expiry, sequence, replay, and idempotency validation.

### Brotto inference

- `services/brotto-inference/app/contracts.py`: Pydantic multimodal planning request and structured proposal response.
- `services/brotto-inference/app/brotto_adapter.py`: exact Brotto request construction, constrained output, and bounded repair.
- `services/brotto-inference/tests/fixtures/model_outputs.json`: golden valid and invalid response corpus.

### Canonical orchestrator

- `services/brotto-orchestrator/src/engine/types.ts`: ports and engine state.
- `services/brotto-orchestrator/src/engine/session-engine.ts`: authoritative pure session loop.
- `services/brotto-orchestrator/src/engine/progress.ts`: repeated-action/state and completion evidence checks.
- `services/brotto-orchestrator/src/engine/session-store.ts`: session persistence/idempotency interface and in-memory implementation.
- `services/brotto-orchestrator/src/transport/ws-server.ts`: authenticated WebSocket connection and routing.
- `services/brotto-orchestrator/src/transport/auth.ts`: short-lived connection credential verification.
- `services/brotto-orchestrator/src/app.ts`: production composition root.

### Browser extension

- `clients/brotto-extension/src/canonical/session-store.ts`: resumable non-secret MV3 state.
- `clients/brotto-extension/src/canonical/transport.ts`: canonical WebSocket client and reconciliation.
- `clients/brotto-extension/src/canonical/redaction.ts`: observation sanitization and forbidden-data defense.
- `clients/brotto-extension/src/canonical/observation.ts`: screenshot and semantic candidate capture.
- `clients/brotto-extension/src/canonical/client-policy.ts`: URL and high-impact action enforcement.
- `clients/brotto-extension/src/canonical/action-executor.ts`: canonical CDP action execution.
- `clients/brotto-extension/src/canonical/page-settler.ts`: lifecycle/DOM stability settlement.
- `clients/brotto-extension/src/canonical/controller.ts`: action ACK, execution, result, and reconnect orchestration.

### End-to-end verification

- `evals/canonical-loop/fixtures/server.ts`: deterministic browser fixture site.
- `evals/canonical-loop/simulated-client.test.ts`: full loop without Chrome.
- `evals/canonical-loop/security.test.ts`: forbidden-data and protocol attacks.
- `evals/canonical-loop/browser.spec.ts`: controlled Chrome end-to-end tasks.
- `evals/canonical-loop/brotto-eval.py`: isolated Brotto contract/task evaluation.

---

### Task 1: Establish canonical identifiers and secret-free action/observation schemas

**Files:**
- Create: `packages/brotto-action-schema/src/v1/ids.ts`
- Create: `packages/brotto-action-schema/src/v1/observation.ts`
- Create: `packages/brotto-action-schema/src/v1/actions.ts`
- Create: `packages/brotto-action-schema/src/v1/results.ts`
- Create: `packages/brotto-action-schema/src/v1/events.ts`
- Create: `packages/brotto-action-schema/src/v1/index.ts`
- Modify: `packages/brotto-action-schema/src/index.ts`
- Modify: `packages/brotto-action-schema/src/results.ts`
- Test: `packages/brotto-action-schema/src/__tests__/v1-contract.test.ts`
- Test: `packages/brotto-action-schema/src/__tests__/v1-forbidden-data.test.ts`

**Interfaces:**
- Produces: `ObservationV1`, `ActionProposalV1`, `CompletionProposalV1`, `AgentProposalV1`, `ActionCommandV1`, `ActionResultV1`, `TrajectoryEventV1`, and branded string IDs.
- Consumes: Zod only.

- [ ] **Step 1: Write failing tests for strict observation and result contracts**

```ts
it('rejects forbidden browser state and unknown keys', () => {
  expect(() => ObservationV1Schema.parse({ ...validObservation, cookies: [] })).toThrow();
  expect(() => ObservationV1Schema.parse({ ...validObservation, localStorage: {} })).toThrow();
  expect(() => ActionResultV1Schema.parse({ ...validResult, authorization: 'Bearer secret' })).toThrow();
});

it('requires an action to reference its exact source observation', () => {
  const command = ActionCommandV1Schema.parse(validActionCommand);
  expect(command.observationId).toBe(validObservation.observationId);
});
```

- [ ] **Step 2: Run the focused tests and verify contract symbols are missing**

Run: `pnpm --filter @brotto/brotto-action-schema test -- --runInBand v1-contract v1-forbidden-data`

Expected: FAIL because the `v1` schemas do not exist.

- [ ] **Step 3: Implement branded IDs and strict Zod schemas**

Use UUID strings for globally correlated IDs and an integer `sequence` for ordering:

```ts
export const ObservationIdSchema = z.string().uuid().brand<'ObservationId'>();
export const ActionIdSchema = z.string().uuid().brand<'ActionId'>();

export const ObservationV1Schema = z.object({
  observationId: ObservationIdSchema,
  capturedAt: z.string().datetime(),
  url: z.string().url().refine((url) => ['http:', 'https:'].includes(new URL(url).protocol)),
  title: z.string().max(512),
  screenshot: ScreenshotSchema,
  viewport: ViewportSchema,
  page: PageStateSchema,
  semanticTargets: z.array(SemanticTargetSchema).max(200),
}).strict();
```

Canonical actions are `left_click`, `double_click`, `right_click`, `drag`, `mouse_move`, `scroll`, `key`, `insert_text`, `visit_url`, `history_back`, `wait`, `ask_user_question`, `memorize_fact`, and `terminate`. `terminate` is an `AgentProposalV1` completion variant, not an executable browser command. Remove `CookieData`, `cookies`, and `localStorage` from the legacy result type instead of retaining a compatibility escape hatch.

- [ ] **Step 4: Add a recursive forbidden-key assertion for serialized values**

```ts
export const FORBIDDEN_BROWSER_DATA_KEYS = new Set([
  'cookie', 'cookies', 'authorization', 'proxy-authorization',
  'localstorage', 'sessionstorage', 'password', 'credentials', 'profile',
]);

export function assertNoForbiddenBrowserData(value: unknown): void;
```

The function must traverse objects and arrays, normalize key casing and punctuation, and throw `ForbiddenBrowserDataError` before serialization.

- [ ] **Step 5: Run package tests and type build**

Run: `pnpm --filter @brotto/brotto-action-schema test -- --runInBand && pnpm --filter @brotto/brotto-action-schema build`

Expected: PASS; generated declarations contain no cookie or storage result fields.

- [ ] **Step 6: Commit the contract foundation**

```bash
git add packages/brotto-action-schema/src
git commit -m "feat(schema): add secure canonical agent contracts"
```

---

### Task 2: Replace the generic CDP relay envelope with canonical agent-loop messages

**Files:**
- Create: `packages/brotto-relay-protocol/src/v1/envelope.ts`
- Create: `packages/brotto-relay-protocol/src/v1/messages.ts`
- Create: `packages/brotto-relay-protocol/src/v1/guard.ts`
- Create: `packages/brotto-relay-protocol/src/v1/index.ts`
- Modify: `packages/brotto-relay-protocol/src/index.ts`
- Modify: `packages/brotto-relay-protocol/package.json`
- Test: `packages/brotto-relay-protocol/src/__tests__/agent-envelope.test.ts`
- Test: `packages/brotto-relay-protocol/src/__tests__/agent-guard.test.ts`
- Test: `evals/contract/relay-protocol.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas.
- Produces: `AgentEnvelopeV1`, `AgentMessageV1`, `ProtocolGuard`, `EnvelopeSigner`, and `createEnvelope()`.

- [ ] **Step 1: Write failing envelope round-trip, expiry, replay, and size tests**

```ts
it('rejects replay before dispatching payload', () => {
  const guard = new ProtocolGuard({ now: () => NOW, maxBytes: 1_000_000 });
  expect(guard.accept(validEnvelope).status).toBe('accepted');
  expect(guard.accept(validEnvelope)).toMatchObject({ status: 'duplicate' });
});

it('rejects an expired envelope', () => {
  expect(guard.accept({ ...validEnvelope, expiresAt: NOW - 1 })).toMatchObject({
    status: 'rejected', code: 'MESSAGE_EXPIRED',
  });
});
```

- [ ] **Step 2: Run tests and verify the application messages are absent**

Run: `pnpm --filter @brotto/relay-protocol test -- --runInBand agent-envelope agent-guard`

Expected: FAIL on missing exports.

- [ ] **Step 3: Implement a discriminated message union**

```ts
export const AgentMessageV1Schema = z.discriminatedUnion('type', [
  SessionOpenSchema, SessionAcceptedSchema, ObservationSubmittedSchema,
  ActionCommandMessageSchema, ActionAcknowledgedSchema, ActionCompletedSchema,
  ApprovalRequestedSchema, ApprovalResolvedSchema, TaskTerminalSchema,
  ReconcileRequestSchema, ReconcileResponseSchema, HeartbeatSchema, ProtocolErrorSchema,
]);
```

The envelope uses `protocolVersion: '1.0'`, UUID `messageId/sessionId/correlationId/causationId`, non-negative monotonic `sequence`, ISO timestamps, expiry, and the typed message payload. Keep raw CDP frames out of this application protocol.

Add `zod` and `@brotto/brotto-action-schema: workspace:*` as runtime dependencies of `@brotto/relay-protocol`; do not duplicate the action payload shapes inside the relay package.

- [ ] **Step 4: Implement signing and validation ports without browser-incompatible Node globals**

```ts
export interface EnvelopeSigner {
  sign(canonicalBytes: Uint8Array): Promise<string>;
  verify(canonicalBytes: Uint8Array, signature: string): Promise<boolean>;
}
```

Use deterministic canonical JSON and WebCrypto-compatible byte helpers. Validate forbidden data before signing or sending.

- [ ] **Step 5: Reconcile contract evals to the new versioned names**

Update evals to assert the real `protocolVersion`, `type`, sequence, expiry, and payload discriminators rather than maintaining a second expected dialect.

- [ ] **Step 6: Run unit, contract, and build checks**

Run: `pnpm --filter @brotto/relay-protocol test -- --runInBand && pnpm --filter @brotto/relay-protocol build && pnpm --dir evals/contract test -- --runInBand relay-protocol`

Expected: PASS.

- [ ] **Step 7: Commit the wire protocol**

```bash
git add packages/brotto-relay-protocol evals/contract/relay-protocol.test.ts
git commit -m "feat(protocol): define canonical agent loop messages"
```

---

### Task 3: Make the Python inference boundary multimodal and structurally reliable

**Files:**
- Create: `services/brotto-inference/app/contracts.py`
- Create: `services/brotto-inference/app/brotto_adapter.py`
- Create: `services/brotto-inference/tests/fixtures/model_outputs.json`
- Create: `services/brotto-inference/tests/test_contracts.py`
- Create: `services/brotto-inference/tests/test_brotto_adapter.py`
- Modify: `services/brotto-inference/app/api.py`
- Modify: `services/brotto-inference/app/models.py`
- Modify: `services/brotto-inference/app/prompts.py`

**Interfaces:**
- Consumes: JSON-compatible mirror of Task 1 proposal/observation contracts.
- Produces: `POST /v1/plan`, `PlanningRequest`, `PlanningResponse`, and `FaraAdapter.plan()`.

- [ ] **Step 1: Add a golden model-output corpus**

Include cases named `valid_visit_url`, `valid_click`, `valid_completion`, `prose_only`, `truncated_json`, `unsupported_action`, `missing_coordinates`, `speculative_completion`, and `xml_garbage`. Each case declares `expected: accepted | repair | rejected`.

- [ ] **Step 2: Write failing tests for multimodal requests and parse-failure behavior**

```py
def test_prose_only_never_becomes_completion(adapter, corpus):
    result = adapter.parse_model_output(corpus['prose_only']['output'])
    assert result.kind == 'contract_error'

def test_planning_request_accepts_screenshot_and_sanitized_targets(client, request_body):
    response = client.post('/v1/plan', json=request_body)
    assert response.status_code == 200
```

- [ ] **Step 3: Run the focused tests and verify failure**

Run: `cd services/brotto-inference && pytest tests/test_contracts.py tests/test_brotto_adapter.py -q`

Expected: FAIL because `/v1/plan` and the adapter do not exist.

- [ ] **Step 4: Implement strict Pydantic request and response models**

`PlanningRequest` contains goal, completion criteria, sanitized observation, bounded trajectory, and limits. `PlanningResponse` is a discriminated action/completion/question/contract-error union. Configure Pydantic with `extra='forbid'` and validate the forbidden-key invariant recursively.

- [ ] **Step 5: Implement exact multimodal request construction and bounded repair**

```py
class FaraAdapter:
    async def plan(self, request: PlanningRequest) -> PlanningResponse: ...
    def parse_model_output(self, content: str) -> PlanningResponse: ...
```

Send image content in the OpenAI-compatible multimodal array, request constrained JSON/schema output when the deployed endpoint supports it, use temperature `0`, record finish reason/usage/model version, and allow at most two repair attempts. A repair prompt contains validation errors and the schema, not browser secrets. Return `INFERENCE_CONTRACT_ERROR` after the limit.

- [ ] **Step 6: Preserve the actual structured completion findings**

Tests must prove that findings, evidence references, unmet criteria, and summary survive parsing unchanged; do not truncate them for transport or UI.

- [ ] **Step 7: Run Python tests and static checks**

Run: `cd services/brotto-inference && pytest -q && ruff check app tests && mypy app`

Expected: PASS.

- [ ] **Step 8: Commit the inference boundary**

```bash
git add services/brotto-inference/app services/brotto-inference/tests
git commit -m "feat(inference): add constrained Brotto planning contract"
```

---

### Task 4: Implement the authoritative session engine and idempotent store

**Files:**
- Create: `services/brotto-orchestrator/src/engine/types.ts`
- Create: `services/brotto-orchestrator/src/engine/session-store.ts`
- Create: `services/brotto-orchestrator/src/engine/session-engine.ts`
- Create: `services/brotto-orchestrator/src/engine/progress.ts`
- Test: `services/brotto-orchestrator/src/__tests__/canonical-engine.test.ts`
- Test: `services/brotto-orchestrator/src/__tests__/canonical-idempotency.test.ts`
- Modify: `services/brotto-orchestrator/package.json`
- Modify: `services/brotto-orchestrator/tsconfig.json`

**Interfaces:**
- Consumes: `AgentProposalV1`, `ActionResultV1`, `ObservationV1`, and trajectory events.
- Produces: `SessionEngine.handle(event)`, `SessionStore`, `InferencePort`, `PolicyPort`, `CommandSink`, and `TrajectorySink`.

- [ ] **Step 1: Correct workspace dependency names before engine tests**

Replace all stale `@brotto/brotto-action-schema` source/test imports with `@brotto/brotto-action-schema`, add `@brotto/relay-protocol: workspace:*`, and restore a test command that resolves workspace packages.

- [ ] **Step 2: Write failing state-machine and single-flight tests**

```ts
it('dispatches only one action until its terminal result arrives', async () => {
  await engine.handle(observationSubmitted(obs1));
  await engine.handle(observationSubmitted(obs1));
  expect(commandSink.commands).toHaveLength(1);
});

it('rejects a result for a different observation/action pair', async () => {
  await expect(engine.handle(actionCompleted(staleResult))).rejects.toMatchObject({
    code: 'STALE_ACTION_RESULT',
  });
});
```

- [ ] **Step 3: Run tests and confirm the canonical engine is absent**

Run: `pnpm --filter @brotto/agent-orchestrator test -- --runInBand canonical-engine canonical-idempotency`

Expected: FAIL on missing engine modules, not module resolution.

- [ ] **Step 4: Define ports and serializable session state**

```ts
export interface InferencePort { plan(input: PlanningInput): Promise<AgentProposalV1>; }
export interface PolicyPort { evaluate(input: PolicyInput): Promise<PolicyDecisionV1>; }
export interface CommandSink { send(command: ActionCommandV1): Promise<void>; }
export interface TrajectorySink { append(event: TrajectoryEventV1): Promise<void>; }
export interface SessionStore {
  load(sessionId: SessionId): Promise<CanonicalSession | null>;
  compareAndSwap(session: CanonicalSession, expectedRevision: number): Promise<void>;
  getProcessed(messageId: MessageId): Promise<StoredOutcome | null>;
}
```

- [ ] **Step 5: Implement event-driven transitions with compare-and-swap**

The engine accepts session open, observation, approval, action result, reconnect, and cancellation events. It persists the state transition before external dispatch, stores processed-message outcomes for idempotency, and never holds two active inference/action IDs.

- [ ] **Step 6: Implement progress and budget checks**

Hash normalized action type/parameters and observation URL/screenshot hash. Detect repeated actions, repeated observations, no verified effect, step count, elapsed time, consecutive action failures, and inference repair exhaustion. Produce typed terminal reasons.

- [ ] **Step 7: Run all orchestrator tests and build**

Run: `pnpm --filter @brotto/agent-orchestrator test -- --runInBand && pnpm --filter @brotto/agent-orchestrator build`

Expected: PASS without the existing asynchronous retry-test crash.

- [ ] **Step 8: Commit the session engine**

```bash
git add services/brotto-orchestrator
git commit -m "feat(orchestrator): implement canonical session engine"
```

---

### Task 5: Integrate inference repair, policy, and evidence-based completion

**Files:**
- Create: `services/brotto-orchestrator/src/adapters/brotto-planner.ts`
- Create: `services/brotto-orchestrator/src/adapters/policy-adapter.ts`
- Create: `services/brotto-orchestrator/src/engine/completion-verifier.ts`
- Test: `services/brotto-orchestrator/src/__tests__/planner-contract.test.ts`
- Test: `services/brotto-orchestrator/src/__tests__/completion-verifier.test.ts`
- Test: `services/brotto-orchestrator/src/__tests__/policy-enforcement.test.ts`
- Modify: `services/brotto-orchestrator/src/engine/session-engine.ts`

**Interfaces:**
- Consumes: Task 3 `/v1/plan`, Task 4 ports, existing `policy-engine` rules.
- Produces: `FaraPlanner`, `PolicyAdapter`, and `CompletionVerifier.verify()`.

- [ ] **Step 1: Write failing tests for contract failure, policy denial, and speculative completion**

```ts
it('does not accept speculative completion', () => {
  const decision = verifier.verify(speculativeProposal, trajectory);
  expect(decision).toEqual(expect.objectContaining({ accepted: false, code: 'INSUFFICIENT_EVIDENCE' }));
});

it('does not replan around a policy denial', async () => {
  await engine.handle(proposalForPurchase);
  expect(inference.calls).toBe(1);
  expect(commandSink.commands).toHaveLength(0);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @brotto/agent-orchestrator test -- --runInBand planner-contract completion-verifier policy-enforcement`

Expected: FAIL on missing adapters/verifier.

- [ ] **Step 3: Implement the inference adapter with abort and typed diagnostics**

The adapter sends only Task 3 fields, propagates request ID/model/usage/finish reason, maps contract errors without synthesizing actions, and supports `AbortSignal` for cancellation.

- [ ] **Step 4: Implement code-enforced policy categories**

Classify navigation and actions before dispatch. Purchases, bookings, external messages, consequential submissions, account changes, uploads/downloads, credential entry, and sensitive disclosure return `requires_approval`. Unsafe schemes/private-network targets return `denied` unless explicitly configured by the self-hosted administrator.

- [ ] **Step 5: Implement completion evidence rules**

Require structured findings, at least one referenced observation or verified browser fact, no unmet required criterion, a post-action observation newer than the last executed action, and no speculative-only summary. Return `accepted`, `continue`, or `failed` with a typed reason.

- [ ] **Step 6: Run orchestrator tests and build**

Run: `pnpm --filter @brotto/agent-orchestrator test -- --runInBand && pnpm --filter @brotto/agent-orchestrator build`

Expected: PASS.

- [ ] **Step 7: Commit planner, policy, and verifier**

```bash
git add services/brotto-orchestrator/src
git commit -m "feat(orchestrator): enforce policy and verified completion"
```

---

### Task 6: Add authenticated WebSocket session transport and reconciliation

**Files:**
- Create: `services/brotto-orchestrator/src/transport/auth.ts`
- Create: `services/brotto-orchestrator/src/transport/ws-server.ts`
- Create: `services/brotto-orchestrator/src/app.ts`
- Test: `services/brotto-orchestrator/src/__tests__/ws-auth.test.ts`
- Test: `services/brotto-orchestrator/src/__tests__/ws-reconcile.test.ts`
- Modify: `services/brotto-orchestrator/package.json`
- Modify: `services/brotto-orchestrator/src/index.ts`

**Interfaces:**
- Consumes: Task 2 protocol guard and Task 4 engine/store.
- Produces: `createOrchestratorApp()`, `/healthz`, authenticated WSS upgrade, and connection reconciliation.

- [ ] **Step 1: Write failing tests for authentication, origin, replay, and reconnect**

Test missing/expired token, wrong tenant/device binding, invalid origin, expired envelope, replayed sequence, reconnect with a pending action, and cancellation during disconnect.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @brotto/agent-orchestrator test -- --runInBand ws-auth ws-reconcile`

Expected: FAIL on missing transport.

- [ ] **Step 3: Implement short-lived connection token verification**

```ts
export interface ConnectionClaims {
  tenantId: string;
  deviceId: string;
  sessionId: string;
  audience: 'browser-extension';
  expiresAt: number;
}
```

Bind the claims to the WSS session and reject payload tenant/device/session mismatches. Do not place visited-site credentials in connection metadata or logs.

Add explicit runtime dependencies on `fastify`, `@fastify/websocket`, `jose`, `@brotto/relay-protocol`, and `@brotto/brotto-action-schema`. Pin them through the workspace lockfile and keep token verification behind the `ConnectionTokenVerifier` interface so unit tests do not depend on wall-clock time or real keys.

- [ ] **Step 4: Implement guarded routing and bounded queues**

Validate signature/MAC, schema, expiry, sequence, size, and state before invoking the engine. Apply per-session message/byte rates, a bounded outbound queue, heartbeat timeout, and one active connection lease per session.

- [ ] **Step 5: Implement reconnect reconciliation**

The client sends last received server sequence, last sent client sequence, and any pending action ID. The server returns the authoritative state and either the stored idempotent result/command or a fresh-observation request. Reconnect must never execute an action twice.

- [ ] **Step 6: Run transport tests and build**

Run: `pnpm --filter @brotto/agent-orchestrator test -- --runInBand && pnpm --filter @brotto/agent-orchestrator build`

Expected: PASS.

- [ ] **Step 7: Commit the server transport**

```bash
git add services/brotto-orchestrator
git commit -m "feat(orchestrator): add authenticated agent websocket transport"
```

---

### Task 7: Capture sanitized deterministic browser observations

**Files:**
- Create: `clients/brotto-extension/src/canonical/redaction.ts`
- Create: `clients/brotto-extension/src/canonical/observation.ts`
- Test: `clients/brotto-extension/tests/redaction.test.ts`
- Test: `clients/brotto-extension/tests/observation.test.ts`
- Modify: `clients/brotto-extension/package.json`
- Modify: `clients/brotto-extension/tsconfig.json`

**Interfaces:**
- Consumes: Task 1 `ObservationV1`.
- Produces: `captureObservation(tabId, options): Promise<ObservationV1>` and `sanitizeSemanticTarget()`.

- [ ] **Step 1: Write failing forbidden-data and observation-metadata tests**

```ts
it.each(['password', 'cookie', 'authorization', 'localStorage', 'sessionStorage'])(
  'never serializes %s data', async (marker) => {
    const encoded = JSON.stringify(await captureFixture(marker));
    expect(encoded.toLowerCase()).not.toContain(marker.toLowerCase());
    expect(encoded).not.toContain('super-secret-value');
  },
);
```

- [ ] **Step 2: Run focused extension tests and verify failure**

Run: `pnpm --dir clients/brotto-extension test -- --runInBand redaction observation`

Expected: FAIL on missing canonical modules.

- [ ] **Step 3: Implement screenshot and viewport capture**

Capture visible-tab PNG, hash it with WebCrypto SHA-256, and capture URL, sanitized title, viewport, DPR, zoom, scroll position, visibility, ready state, and opaque frame identifiers. Do not call cookie/storage/network-header CDP domains.

Add `@brotto/brotto-action-schema: workspace:*` and `@brotto/relay-protocol: workspace:*` to the extension runtime dependencies so the bundle consumes the canonical schemas rather than copied interfaces.

- [ ] **Step 4: Implement semantic candidate capture with allowlisted fields**

Inspect visible actionable elements only. Retain role, redacted accessible name/label, tag, safe `data-testid`/`name`/`type` attributes, bounding rect, visibility, and locator candidates. Never retain `value`, `innerHTML`, hidden text, password metadata, or arbitrary attributes. Cap candidates and string lengths.

- [ ] **Step 5: Add a final outbound forbidden-data assertion**

Run `assertNoForbiddenBrowserData()` on the completed observation before returning it. Failure blocks transmission and produces a local security error.

- [ ] **Step 6: Run tests, type-check, and build**

Run: `pnpm --dir clients/brotto-extension test -- --runInBand && pnpm --dir clients/brotto-extension run build:tsc && pnpm --dir clients/brotto-extension run build`

Expected: PASS; build must return non-zero on TypeScript/esbuild failure.

- [ ] **Step 7: Commit observation capture**

```bash
git add clients/brotto-extension/src/canonical clients/brotto-extension/tests clients/brotto-extension/package.json clients/brotto-extension/tsconfig.json
git commit -m "feat(extension): capture sanitized browser observations"
```

---

### Task 8: Implement client policy, canonical CDP execution, and deterministic settlement

**Files:**
- Create: `clients/brotto-extension/src/canonical/client-policy.ts`
- Create: `clients/brotto-extension/src/canonical/action-executor.ts`
- Create: `clients/brotto-extension/src/canonical/page-settler.ts`
- Test: `clients/brotto-extension/tests/client-policy.test.ts`
- Test: `clients/brotto-extension/tests/canonical-action-executor.test.ts`
- Test: `clients/brotto-extension/tests/page-settler.test.ts`

**Interfaces:**
- Consumes: Task 1 action commands/results and existing `src/debugger.ts` command wrapper.
- Produces: `ClientPolicy.evaluate()`, `CanonicalActionExecutor.execute()`, and `PageSettler.settle()`.

- [ ] **Step 1: Write failing tests for unsafe URLs, approvals, coordinate transforms, and real scroll deltas**

Cover `file:`, `chrome:`, extension URLs, private-network destinations, purchase/form-submit actions, stale observation IDs, out-of-bounds coordinates, DPR/zoom transforms, `insert_text`, modifier keys, drag, and requested wheel deltas.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --dir clients/brotto-extension test -- --runInBand client-policy canonical-action-executor page-settler`

Expected: FAIL on missing modules.

- [ ] **Step 3: Implement fail-closed client policy**

Return `allowed`, `requires_approval`, or `denied` with stable codes. The extension rejects commands for unattached tabs, stale observations, disallowed schemes/origins, private-network URLs without explicit policy, and high-impact actions lacking approval proof.

- [ ] **Step 4: Implement canonical actions using controlled CDP calls**

Use `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.insertText`, `Page.navigate`, and `Page.getNavigationHistory` only through typed helpers. Transform coordinates using the captured viewport/DPR/zoom context. Missing parameters and unknown actions return typed failures. Do not use interpolated `Runtime.evaluate` for action execution.

- [ ] **Step 5: Implement event-based page settlement**

Subscribe before execution to navigation/lifecycle, dialog, target, and debugger-detach events. Resolve when the applicable navigation/load and bounded DOM-stability conditions pass; otherwise return a typed timeout with the current page state. Use injectable clocks in tests, not real sleeps.

- [ ] **Step 6: Run extension tests, type-check, and build**

Run: `pnpm --dir clients/brotto-extension test -- --runInBand && pnpm --dir clients/brotto-extension run build:tsc && pnpm --dir clients/brotto-extension run build`

Expected: PASS.

- [ ] **Step 7: Commit secure execution**

```bash
git add clients/brotto-extension/src/canonical clients/brotto-extension/tests
git commit -m "feat(extension): enforce policy and deterministic actions"
```

---

### Task 9: Connect the MV3 extension to the canonical protocol with recovery

**Files:**
- Create: `clients/brotto-extension/src/canonical/session-store.ts`
- Create: `clients/brotto-extension/src/canonical/transport.ts`
- Create: `clients/brotto-extension/src/canonical/controller.ts`
- Test: `clients/brotto-extension/tests/canonical-transport.test.ts`
- Test: `clients/brotto-extension/tests/canonical-controller.test.ts`
- Test: `clients/brotto-extension/tests/session-recovery.test.ts`
- Modify: `clients/brotto-extension/src/background.ts`
- Modify: `clients/brotto-extension/src/popup.js`
- Modify: `clients/brotto-extension/src/popup.html`
- Modify: `clients/brotto-extension/manifest.json`
- Modify: `clients/brotto-extension/build.mjs`

**Interfaces:**
- Consumes: Tasks 2, 7, and 8.
- Produces: `CanonicalExtensionController`, resumable session state, and canonical popup events.

- [ ] **Step 1: Write failing ACK/result, duplicate-command, reconnect, cancellation, and suspension tests**

Prove ACK precedes execution, only one command executes, duplicate commands return the stored result, reconnect reconciles pending state, service-worker restoration contains no secrets, cancellation aborts fetch/transport and detaches, and exactly one terminal UI event is emitted.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --dir clients/brotto-extension test -- --runInBand canonical-transport canonical-controller session-recovery`

Expected: FAIL on missing controller.

- [ ] **Step 3: Implement a class-based transport with injected WebSocket and clock**

The transport performs authenticated WSS setup, envelope validation/signing, heartbeat, bounded exponential reconnect, sequence tracking, abortable close, and reconciliation. It does not expose cookie export or raw CDP forwarding methods.

- [ ] **Step 4: Persist only minimal non-secret recovery state**

Persist server URL, opaque session/device IDs, sequences, attached tab ID, task ID, last observation ID, pending action ID, and status. Store the short-lived platform connection credential only in `chrome.storage.session` when available; never persist visited-site data.

- [ ] **Step 5: Implement action lifecycle orchestration**

On `action.command`: validate → send `action.acknowledged` → enforce client policy → execute once → settle → capture post-observation → send `action.completed`. Cache the terminal result by idempotency key until the session lease ends.

- [ ] **Step 6: Replace the active background HTTP/SSE path**

Make `background.ts` a composition root for the canonical controller. Remove active `fetch('/connect')`, `fetch('/task')`, `EventSource`/SSE parsing, the duplicate relay action switch, fixed continuation sleeps, and duplicate `done` handling. Preserve unrelated login/session UI behavior through explicit controller events.

- [ ] **Step 7: Make popup results durable and non-truncating**

Display one terminal result with complete structured findings, concise step events, approval state, cancel control, and reconnect status. Persist logs as sanitized trajectory summaries rather than ephemeral DOM entries.

- [ ] **Step 8: Make the build fail closed**

Run `tsc --noEmit` before esbuild and propagate any error exit code. Copy only required extension assets. Confirm no `.env`, source maps containing secrets, or dependency directories enter `dist`.

- [ ] **Step 9: Run the complete extension suite and build**

Run: `pnpm --dir clients/brotto-extension test -- --runInBand && pnpm --dir clients/brotto-extension run build:tsc && pnpm --dir clients/brotto-extension run build`

Expected: PASS.

- [ ] **Step 10: Commit the canonical extension runtime**

```bash
git add clients/brotto-extension/manifest.json clients/brotto-extension/build.mjs clients/brotto-extension/src clients/brotto-extension/tests
git commit -m "feat(extension): use canonical agent protocol"
```

---

### Task 10: Prove the full loop with a simulated client and security attacks

**Files:**
- Create: `evals/canonical-loop/package.json`
- Create: `evals/canonical-loop/jest.config.js`
- Create: `evals/canonical-loop/helpers/fakes.ts`
- Create: `evals/canonical-loop/simulated-client.test.ts`
- Create: `evals/canonical-loop/security.test.ts`
- Modify: `package.json`
- Modify: `turbo.json`

**Interfaces:**
- Consumes: Tasks 1–6 server packages and protocol.
- Produces: deterministic release-gate tests without Chrome or a live model.

- [ ] **Step 1: Write a complete simulated-client success test**

Script observations for blank page → target site → search/results page → evidenced completion. Assert exact state/event order, action/observation linkage, one in-flight command, complete findings, and one terminal event.

- [ ] **Step 2: Write failure and adversarial test matrices**

Cover malformed inference, speculative completion, action failure, no progress, stale result, duplicate/reordered/replayed envelopes, disconnect/reconcile, cancellation, policy denial, guessed session, wrong origin, expired token, oversized screenshot, unsafe URL, and malicious forbidden keys nested in arrays/objects.

- [ ] **Step 3: Run tests and confirm missing composition hooks**

Run: `pnpm --dir evals/canonical-loop test -- --runInBand`

Expected: FAIL until server composition permits fake inference/policy/store/clock injection.

- [ ] **Step 4: Add only the dependency-injection hooks required by the tests**

Do not add test-only branches. Compose the real engine with fake ports through the public interfaces defined in Task 4.

- [ ] **Step 5: Run canonical, contract, orchestrator, and extension suites together**

Run: `pnpm --dir evals/canonical-loop test -- --runInBand && pnpm --dir evals/contract test -- --runInBand && pnpm --filter @brotto/agent-orchestrator test -- --runInBand && pnpm --dir clients/brotto-extension test -- --runInBand`

Expected: PASS with zero forbidden-data leaks and zero duplicate terminal events.

- [ ] **Step 6: Commit the deterministic integration gate**

```bash
git add evals/canonical-loop package.json turbo.json
git commit -m "test(e2e): gate canonical agent loop and security"
```

---

### Task 11: Validate controlled Chrome tasks and isolated Brotto capability

**Files:**
- Create: `evals/canonical-loop/fixtures/server.ts`
- Create: `evals/canonical-loop/fixtures/pages/index.html`
- Create: `evals/canonical-loop/fixtures/pages/offers.html`
- Create: `evals/canonical-loop/fixtures/pages/form.html`
- Create: `evals/canonical-loop/browser.spec.ts`
- Create: `evals/canonical-loop/playwright.config.ts`
- Create: `evals/canonical-loop/brotto-eval.py`
- Create: `evals/canonical-loop/tasks.json`
- Create: `evals/canonical-loop/README.md`

**Interfaces:**
- Consumes: complete canonical runtime.
- Produces: controlled-browser release gate and isolated Brotto scorecard.

- [ ] **Step 1: Define controlled tasks and expected evidence**

Include navigation and extraction, search and comparison, scrolling, recoverable wrong click, form filling without submission, approval-required consequential submission, reconnect during a run, and cancellation. Each task specifies allowed origins, maximum steps, expected findings, expected approvals, and terminal reason.

- [ ] **Step 2: Write failing Playwright E2E tests**

Launch Chromium with the unpacked extension, issue a task through the canonical server, and assert browser state plus terminal structured findings. Inspect captured outbound protocol messages and assert the forbidden-data invariant.

- [ ] **Step 3: Run the controlled browser gate**

Run: `pnpm --dir evals/canonical-loop exec playwright test browser.spec.ts`

Expected before final wiring: FAIL with a concrete missing runtime/configuration dependency.

- [ ] **Step 4: Wire the development composition without weakening production defaults**

Add explicit development-issued short-lived connection credentials, fixture-origin allowlist, in-memory session store, and configured inference endpoint. Production continues to require WSS and externally supplied signing/auth configuration.

- [ ] **Step 5: Implement the isolated Brotto evaluation runner**

Feed the same screenshot/trajectory corpus directly to `/v1/plan`. Score valid-schema rate, correct next-action rate, premature-completion rate, repair rate, and latency separately from browser execution. Save only hashes/metrics by default; raw screenshots require explicit local opt-in.

- [ ] **Step 6: Run release gates and record evidence**

Run: `pnpm --dir evals/canonical-loop exec playwright test && python3 evals/canonical-loop/brotto-eval.py --tasks evals/canonical-loop/tasks.json`

Expected: controlled deterministic tasks pass; Brotto valid-schema rate is 100% after bounded repair, premature-completion acceptance is 0%, and task completion reaches the approved 90% KPI or is reported as a model-deployment blocker rather than hidden by the controller.

- [ ] **Step 7: Commit controlled E2E and model evals**

```bash
git add evals/canonical-loop
git commit -m "test(e2e): validate browser loop and Brotto capability"
```

---

### Task 12: Quarantine the prototype path and publish item-1 verification

**Files:**
- Create: `docs/superpowers/handoffs/2026-08-03-canonical-agent-loop-handoff.md`
- Modify: `docs/project-memory/mvp-delivery-tracker.md`
- Modify: `docs/protocol/README.md`
- Modify: `docs/architecture/README.md`
- Modify: `clients/brotto-extension/README.md`
- Modify: `services/brotto-orchestrator/README.md`
- Modify: `deploy/docker-compose/dev.yml`
- Quarantine or delete after dependency proof: `services/playwright-relay/`

**Interfaces:**
- Consumes: verification output from Tasks 1–11.
- Produces: one documented supported runtime path and item-1 handoff.

- [ ] **Step 1: Prove no supported entry point depends on the prototype**

Run: `rg -n "playwright-relay|/events/|/task/|execute_action|EventSource" --glob '!**/node_modules/**' --glob '!**/dist/**' .`

Expected: matches exist only in explicitly identified legacy files/docs before quarantine; canonical runtime and deployment contain none.

- [ ] **Step 2: Run the complete verification matrix from a clean process state**

Run the schema, protocol, inference, orchestrator, extension, contract, security, simulated-client, and controlled-browser commands from prior tasks. Capture command, exit code, test counts, and KPI output in the handoff.

- [ ] **Step 3: Quarantine the prototype safely**

First inspect `services/playwright-relay/.env` and ensure it remains ignored and uncommitted without printing its contents. Remove the prototype from deployment/start scripts. Delete or move prototype source only if `rg` proves no supported dependency and the canonical E2E gate passes. Report exactly what was removed and whether Git can recover it.

- [ ] **Step 4: Update architecture and protocol documentation**

Document the canonical message lifecycle, privacy boundary, forbidden-data invariant, authentication/reconciliation behavior, local development setup, controlled E2E command, and Brotto evaluation interpretation. Mark audit persistence and recipe compilation as subsequent delivery items.

- [ ] **Step 5: Update the delivery tracker using evidence**

Set item 1 to `complete` only when every acceptance criterion is met. If the isolated Brotto task-completion KPI is below 90% while all controller gates pass, mark item 1 `blocked on model deployment capability` and include the scorecard; do not claim completion.

- [ ] **Step 6: Commit the supported-path documentation and quarantine**

```bash
git add docs clients/brotto-extension/README.md services/brotto-orchestrator/README.md deploy/docker-compose/dev.yml
git commit -m "docs: publish canonical agent loop verification"
```

---

## Plan self-review checklist

- Every approved design requirement maps to at least one task.
- Forbidden browser data is removed at schema level and tested again at capture, serialization, integration, and E2E boundaries.
- TypeScript owns state/policy/completion; Python owns multimodal structured inference only.
- All cross-task names and ports are defined before consumption.
- Every production implementation task begins with a failing behavioral test and ends with focused verification plus a reviewable commit.
- The prototype is not deleted until supported-path dependency and E2E proofs pass.
- Recording persistence and recipe compilation remain explicitly deferred, while trajectory events needed by them are defined now.
