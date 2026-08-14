import {
  CanonicalSessionStore,
  type DurableActionExecution,
  type CanonicalRecoveryState,
} from "../src/canonical/session-store";
import type { AgentMessageV1 } from "@brotto/relay-protocol";
import type { CanonicalBootstrapMaterial } from "../src/canonical/transport";

const NOW = Date.parse("2026-08-04T10:00:00.000Z");

function recovery(overrides: Partial<CanonicalRecoveryState> = {}): CanonicalRecoveryState {
  return {
    version: 1,
    serverUrl: "wss://agent.example.test/v1/agent",
    sessionId: "11111111-1111-4111-8111-111111111111",
    deviceId: "22222222-2222-4222-8222-222222222222",
    lastReceivedSequence: 3,
    lastSentSequence: 4,
    attachedTabId: 42,
    taskId: "33333333-3333-4333-8333-333333333333",
    lastObservationId: "44444444-4444-4444-8444-444444444444",
    pendingActionId: "55555555-5555-4555-8555-555555555555",
    status: "reconnecting",
    ...overrides,
  };
}

function material(): CanonicalBootstrapMaterial {
  return {
    serverUrl: "wss://agent.example.test/v1/agent",
    connectionCredential: "platform-credential",
    serverRecipientId: "66666666-6666-4666-8666-666666666666",
    tenantId: "tenant-a",
    deviceId: "22222222-2222-4222-8222-222222222222",
    sessionId: "11111111-1111-4111-8111-111111111111",
    expiresAt: NOW + 60_000,
    hmacKey: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY",
  };
}

function area(initial: Record<string, unknown> = {}) {
  const values = { ...initial };
  return {
    values,
    get: jest.fn(async (key: string) => ({ [key]: values[key] })),
    set: jest.fn(async (items: Record<string, unknown>) => { Object.assign(values, items); }),
    remove: jest.fn(async (key: string) => { delete values[key]; }),
  };
}

describe("CanonicalSessionStore", () => {
  it("writes only non-secret action identity before execution and preserves a completed result", async () => {
    const local = area();
    const store = new CanonicalSessionStore({ local, now: () => NOW });
    const started: DurableActionExecution = {
      actionId: "55555555-5555-4555-8555-555555555555",
      idempotencyKey: "action-once",
      observationId: "44444444-4444-4444-8444-444444444444",
      status: "started",
    };

    await store.saveActionExecution({ ...started, action: { type: "insert_text", text: "never-persist-me" } } as unknown as DurableActionExecution);
    expect(await store.loadActionExecution()).toEqual(started);
    expect(JSON.stringify(local.values)).not.toContain("never-persist-me");

    const completed = {
      actionId: started.actionId,
      stepId: "77777777-7777-4777-8777-777777777777",
      observationId: started.observationId,
      sequence: 2,
      startedAt: "2026-08-04T10:00:00.000Z",
      completedAt: "2026-08-04T10:00:01.000Z",
      durationMs: 1_000,
      status: "rejected_stale",
      rejection: { code: "EXECUTION_OUTCOME_INDETERMINATE", message: "A fresh observation is required", retryable: true },
    } as const;
    await store.saveActionExecution({ ...started, status: "completed", result: completed });
    await expect(store.loadActionExecution()).resolves.toMatchObject({ status: "completed", result: completed });
  });

  it("persists and restores canonical terminal and identifier-only approval state", async () => {
    const local = area();
    const store = new CanonicalSessionStore({ local, now: () => NOW });
    const terminal = {
      type: "task.completed",
      completion: {
        kind: "completion",
        observationId: "44444444-4444-4444-8444-444444444444",
        type: "terminate",
        status: "succeeded",
        summary: "Done",
        findings: [{ fact: "Price is 42", observationIds: ["44444444-4444-4444-8444-444444444444"] }],
        unmetCriteria: [],
        confidence: 0.9,
      },
    } as AgentMessageV1;
    await store.saveTerminal(terminal as Extract<AgentMessageV1, { type: "task.completed" }>);
    await store.saveApproval({
      approvalId: "66666666-6666-4666-8666-666666666666",
      policyDecisionId: "77777777-7777-4777-8777-777777777777",
      actionId: "55555555-5555-4555-8555-555555555555",
      observationId: "44444444-4444-4444-8444-444444444444",
      requestedAt: "2026-08-04T10:00:00.000Z",
      reason: "Approval required",
      action: { text: "never-persist-me" },
    } as never);

    await expect(store.loadTerminal()).resolves.toEqual(terminal);
    await expect(store.loadApproval()).resolves.toMatchObject({ reason: "Approval required" });
    expect(JSON.stringify(local.values)).not.toContain("never-persist-me");
  });

  it("restores only the minimal non-secret service-worker state", async () => {
    const local = area();
    const session = area();
    const store = new CanonicalSessionStore({ local, session, now: () => NOW });
    const unsafe = {
      ...recovery(),
      url: "https://visited.example/private",
      screenshot: "page-image",
      cookies: "secret",
      authorization: "Bearer secret",
      profile: { name: "private" },
    };

    await store.saveRecovery(unsafe);
    const restored = await store.loadRecovery();

    expect(restored).toEqual(recovery());
    const encoded = JSON.stringify(local.values).toLowerCase();
    expect(encoded).not.toMatch(/visited|screenshot|cookie|authorization|profile|secret/);
  });

  it("stores bootstrap credentials and HMAC material only in storage.session", async () => {
    const local = area();
    const session = area();
    const store = new CanonicalSessionStore({ local, session, now: () => NOW });

    await store.saveBootstrap(material());

    expect(await store.loadBootstrap()).toEqual(material());
    expect(JSON.stringify(session.values)).toContain("platform-credential");
    expect(JSON.stringify(local.values)).not.toContain("platform-credential");
    expect(JSON.stringify(local.values)).not.toContain("hmacKey");
  });

  it("keeps credentials memory-only when storage.session is unavailable", async () => {
    const local = area();
    const store = new CanonicalSessionStore({ local, now: () => NOW });

    await store.saveBootstrap(material());

    expect(await store.loadBootstrap()).toEqual(material());
    expect(local.set).not.toHaveBeenCalledWith(expect.objectContaining({ canonicalBootstrap: expect.anything() }));
  });

  it("clears expired bootstrap material rather than restoring it", async () => {
    const session = area();
    const store = new CanonicalSessionStore({ local: area(), session, now: () => NOW + 120_000 });
    await store.saveBootstrap(material());

    await expect(store.loadBootstrap()).resolves.toBeNull();
    expect(session.remove).toHaveBeenCalled();
  });

  it("persists only bounded generic trajectory summaries", async () => {
    const local = area();
    const store = new CanonicalSessionStore({ local, now: () => NOW });

    await store.appendTrajectory({ type: "action", summary: "LEFT_CLICK completed", occurredAt: new Date(NOW).toISOString() });
    await store.appendTrajectory({ type: "action", summary: "cookie secret at https://visited.example", occurredAt: new Date(NOW).toISOString() });

    await expect(store.loadTrajectory()).resolves.toEqual([
      { type: "action", summary: "LEFT_CLICK completed", occurredAt: new Date(NOW).toISOString() },
      { type: "action", summary: "Sensitive step", occurredAt: new Date(NOW).toISOString() },
    ]);
  });
});
