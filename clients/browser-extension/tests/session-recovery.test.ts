import {
  CanonicalSessionStore,
  type CanonicalRecoveryState,
} from "../src/canonical/session-store";
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
