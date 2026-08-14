import type {
  ActionCommandV1,
  ObservationV1,
} from "@brotto/brotto-action-schema";
import type {
  AgentEnvelopeV1,
  AgentMessageV1,
} from "@brotto/relay-protocol";
import {
  CanonicalExtensionController,
  type CanonicalTransportPort,
  type ConnectionBootstrapPort,
  type ControllerUiEvent,
} from "../src/canonical/controller";
import { CanonicalSessionStore } from "../src/canonical/session-store";
import type {
  CanonicalBootstrapMaterial,
  TransportMessage,
  TransportSnapshot,
} from "../src/canonical/transport";

const IDS = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  serverRecipientId: "33333333-3333-4333-8333-333333333333",
  taskId: "44444444-4444-4444-8444-444444444444",
  observationId: "55555555-5555-4555-8555-555555555555",
  postObservationId: "66666666-6666-4666-8666-666666666666",
  actionId: "77777777-7777-4777-8777-777777777777",
  stepId: "88888888-8888-4888-8888-888888888888",
  policyDecisionId: "99999999-9999-4999-8999-999999999999",
};

const NOW = Date.parse("2026-08-04T10:00:10.000Z");

function observation(id = IDS.observationId, capturedAt = "2026-08-04T10:00:00.000Z"): ObservationV1 {
  return {
    observationId: id as ObservationV1["observationId"],
    capturedAt,
    url: "https://example.test/",
    title: "Example",
    screenshot: { kind: "artifact", artifactId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sha256: "a".repeat(64), width: 1, height: 1, encoding: "png" },
    viewport: { width: 800, height: 600, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
    page: {
      tabId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      frameId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      lifecycle: "complete",
      visibility: "visible",
    },
    semanticTargets: [],
  };
}

function command(): ActionCommandV1 {
  return {
    actionId: IDS.actionId,
    stepId: IDS.stepId,
    observationId: IDS.observationId,
    sequence: 5,
    action: { type: "scroll", deltaX: 0, deltaY: 100 },
    policyContext: {
      policyDecisionId: IDS.policyDecisionId,
      policyVersion: "v1",
      approved: false,
    },
    dispatchedAt: "2026-08-04T10:00:05.000Z",
    expiresAt: "2026-08-04T10:01:00.000Z",
    idempotencyKey: "scroll-once",
  } as ActionCommandV1;
}

function commandMessage(): Extract<AgentMessageV1, { type: "action.command" }> {
  const value = command();
  return {
    type: "action.command",
    proposal: {
      kind: "action",
      observationId: IDS.observationId,
      proposedAt: "2026-08-04T10:00:01.000Z",
      action: value.action,
    },
    policyDecision: {
      policyDecisionId: IDS.policyDecisionId,
      actionId: IDS.actionId,
      observationId: IDS.observationId,
      decision: "allowed",
      decidedAt: "2026-08-04T10:00:02.000Z",
    },
    command: value,
  } as Extract<AgentMessageV1, { type: "action.command" }>;
}

function material(): CanonicalBootstrapMaterial {
  return {
    serverUrl: "wss://agent.example.test/v1/agent",
    connectionCredential: "platform-credential",
    serverRecipientId: IDS.serverRecipientId,
    tenantId: "tenant-a",
    deviceId: IDS.deviceId,
    sessionId: IDS.sessionId,
    expiresAt: NOW + 60_000,
    hmacKey: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY",
  };
}

class FakeTransport implements CanonicalTransportPort {
  sent: AgentMessageV1[] = [];
  closed = false;
  private state: TransportSnapshot = {
    status: "idle",
    reconnectAttempt: 0,
    lastReceivedSequence: 0,
    lastSentSequence: 0,
  };

  async connect(): Promise<void> {
    this.state = { ...this.state, status: "open" };
  }

  async send(message: AgentMessageV1): Promise<AgentEnvelopeV1> {
    this.sent.push(message);
    this.state = { ...this.state, lastSentSequence: this.state.lastSentSequence + 1 };
    return { payload: message, sequence: this.state.lastSentSequence } as AgentEnvelopeV1;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.state = { ...this.state, status: "closed" };
  }

  snapshot(): TransportSnapshot {
    return { ...this.state };
  }
}

function area() {
  const values: Record<string, unknown> = {};
  return {
    get: jest.fn(async (key: string) => ({ [key]: values[key] })),
    set: jest.fn(async (items: Record<string, unknown>) => { Object.assign(values, items); }),
    remove: jest.fn(async (key: string) => { delete values[key]; }),
  };
}

function setup(options: {
  execute?: (input: unknown, signal?: AbortSignal) => Promise<unknown>;
  store?: CanonicalSessionStore;
  bootstrap?: ConnectionBootstrapPort;
  detach?: (tabId: number) => Promise<void>;
} = {}) {
  const transport = new FakeTransport();
  const ui: ControllerUiEvent[] = [];
  const order: string[] = [];
  const detach = jest.fn(options.detach ?? (async () => {}));
  const execute = jest.fn(options.execute ?? (async () => {
    order.push("execute");
    return {
      status: "succeeded",
      code: "ACTION_SUCCEEDED",
      execution: { ok: true },
      settlement: {
        status: "settled",
        navigation: false,
        targetCreated: false,
        pageState: { url: "https://example.test/", lifecycle: "complete" },
      },
    };
  }));
  const send = transport.send.bind(transport);
  transport.send = async (message) => {
    order.push(`send:${message.type}`);
    return send(message);
  };
  let captureCount = 0;
  const bootstrap: ConnectionBootstrapPort = options.bootstrap ?? {
    bootstrap: jest.fn(async () => material()),
  };
  const local = area();
  const session = area();
  const store = options.store ?? new CanonicalSessionStore({ local, session, now: () => NOW });
  const controller = new CanonicalExtensionController({
    bootstrap,
    store,
    transportFactory: () => transport,
    tabs: {
      activeTabId: async () => 42,
      attach: async () => {},
      detach,
      isAttached: () => true,
    },
    capture: async () => ({
      observation: captureCount++ === 0
        ? observation()
        : observation(IDS.postObservationId, "2026-08-04T10:00:11.000Z"),
      mainFrameId: "main-frame",
    }),
    executionPipelineFactory: () => ({ execute: execute as never }),
    now: () => NOW,
    idGenerator: () => IDS.taskId,
    emitUiEvent: (event) => { ui.push(event); },
  });
  return { bootstrap, controller, detach, execute, order, store, transport, ui };
}

function inbound(message: AgentMessageV1): TransportMessage {
  return {
    message,
    envelope: { payload: message, sequence: 5 } as AgentEnvelopeV1,
  };
}

describe("CanonicalExtensionController", () => {
  it("bootstraps a task, opens the canonical session, and submits the first observation", async () => {
    const { bootstrap, controller, transport } = setup();

    await controller.startTask("Find the current price");

    expect(bootstrap.bootstrap).toHaveBeenCalledWith(expect.objectContaining({
      goal: "Find the current price",
      taskId: IDS.taskId,
    }), expect.any(AbortSignal));
    expect(transport.sent.map((message) => message.type)).toEqual([
      "session.open",
      "observation.submitted",
    ]);
    expect(transport.sent[0]).toMatchObject({ goal: "Find the current price" });
  });

  it("ACKs before the sole trusted pipeline executes and sends one result", async () => {
    const { controller, execute, order, transport } = setup();
    await controller.startTask("Find the current price");
    order.length = 0;

    await controller.handleTransportMessage(inbound(commandMessage()));

    expect(order).toEqual([
      "send:action.acknowledged",
      "execute",
      "send:action.completed",
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(transport.sent.filter((message) => message.type === "action.completed")).toHaveLength(1);
  });

  it("returns a stored result for a duplicate idempotency key without executing twice", async () => {
    const { controller, execute, transport } = setup();
    await controller.startTask("Find the current price");
    await controller.handleTransportMessage(inbound(commandMessage()));
    await controller.handleTransportMessage(inbound(commandMessage()));

    const results = transport.sent.filter((message) => message.type === "action.completed");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(results[1]);
  });

  it("never re-executes a write-ahead started action after service-worker suspension", async () => {
    const { controller, execute, store, transport } = setup();
    await controller.startTask("Find the current price");
    await store.saveActionExecution({
      actionId: IDS.actionId,
      idempotencyKey: "scroll-once",
      observationId: IDS.observationId,
      status: "started",
    });

    await controller.handleTransportMessage(inbound(commandMessage()));

    expect(execute).not.toHaveBeenCalled();
    const completed = transport.sent.filter((message) => message.type === "action.completed").pop();
    expect(completed).toMatchObject({
      result: {
        status: "rejected_stale",
        rejection: { code: "EXECUTION_OUTCOME_INDETERMINATE", retryable: true },
      },
    });
  });

  it("never executes an unknown pending action restored without a journal record", async () => {
    const sharedStore = new CanonicalSessionStore({ local: area(), session: area(), now: () => NOW });
    await sharedStore.saveRecovery({
      version: 1,
      serverUrl: material().serverUrl,
      sessionId: IDS.sessionId,
      deviceId: IDS.deviceId,
      lastReceivedSequence: 5,
      lastSentSequence: 6,
      attachedTabId: 42,
      taskId: IDS.taskId,
      lastObservationId: IDS.observationId,
      pendingActionId: IDS.actionId,
      status: "executing",
    });
    await sharedStore.saveBootstrap(material());
    const { controller, execute, transport } = setup({ store: sharedStore });
    await controller.restore();

    await controller.handleTransportMessage(inbound(commandMessage()));

    expect(execute).not.toHaveBeenCalled();
    expect(transport.sent.filter((message) => message.type === "action.completed").pop()).toMatchObject({
      result: { rejection: { code: "EXECUTION_OUTCOME_INDETERMINATE" } },
    });
  });

  it("durably replays a completed action after a crash between browser effect and result send", async () => {
    const sharedStore = new CanonicalSessionStore({ local: area(), session: area(), now: () => NOW });
    const first = setup({ store: sharedStore });
    await first.controller.startTask("Find the current price");
    const send = first.transport.send.bind(first.transport);
    first.transport.send = async (message) => {
      if (message.type === "action.completed") throw new Error("worker stopped before send");
      return send(message);
    };

    await expect(first.controller.handleTransportMessage(inbound(commandMessage()))).rejects.toThrow("worker stopped before send");
    expect(first.execute).toHaveBeenCalledTimes(1);
    await expect(sharedStore.loadActionExecution()).resolves.toMatchObject({ status: "completed" });

    const resumed = setup({ store: sharedStore });
    await resumed.controller.restore();
    await resumed.controller.handleTransportMessage(inbound(commandMessage()));
    expect(resumed.execute).not.toHaveBeenCalled();
    expect(resumed.transport.sent.filter((message) => message.type === "action.completed").pop()).toBeDefined();
  });

  it("cancellation aborts bootstrap/execution, sends canonical cancellation, closes, and detaches", async () => {
    let executionSignal: AbortSignal | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const { controller, detach, transport } = setup({
      execute: async (_input, signal) => {
        executionSignal = signal;
        markStarted();
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
        return { status: "cancelled", code: "ACTION_CANCELLED" };
      },
    });
    await controller.startTask("Find the current price");
    const action = controller.handleTransportMessage(inbound(commandMessage()));
    await started;

    await controller.cancel("User cancelled");
    await action;

    expect(executionSignal?.aborted).toBe(true);
    expect(transport.sent.some((message) => message.type === "task.cancelled")).toBe(true);
    expect(transport.closed).toBe(true);
    expect(detach).toHaveBeenCalledWith(42);
  });

  it("emits exactly one non-truncated terminal UI event", async () => {
    const { controller, ui } = setup();
    await controller.startTask("Find the current price");
    const terminal: AgentMessageV1 = {
      type: "task.completed",
      completion: {
        kind: "completion",
        observationId: IDS.observationId,
        type: "terminate",
        status: "succeeded",
        summary: "Complete structured summary that must not be truncated.",
        findings: [{ fact: "The complete finding remains available.", observationIds: [IDS.observationId] }],
        unmetCriteria: [],
        confidence: 0.99,
      },
    } as AgentMessageV1;

    await controller.handleTransportMessage(inbound(terminal));
    await controller.handleTransportMessage(inbound(terminal));

    const terminals = ui.filter((event) => event.type === "canonical_terminal");
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({ message: terminal });
    expect(JSON.stringify(terminals[0])).toContain("The complete finding remains available.");
    expect(await controller.viewState()).toMatchObject({ terminal });
  });

  it("closes and durably publishes the authoritative terminal reconciliation", async () => {
    const { controller, detach, transport, ui } = setup();
    await controller.startTask("Find the current price");
    const terminal = {
      type: "task.completed",
      completion: {
        kind: "completion",
        observationId: IDS.observationId,
        type: "terminate",
        status: "succeeded",
        summary: "Done",
        findings: [{ fact: "Price is 42", observationIds: [IDS.observationId] }],
        unmetCriteria: [],
        confidence: 0.98,
      },
    } as const;
    await controller.handleTransportMessage(inbound({
      type: "reconcile.response",
      nextSequence: 8,
      pendingActionIds: [],
      requiresFreshObservation: false,
      authoritativeState: "COMPLETED",
      terminal,
      respondedAt: "2026-08-04T10:00:12.000Z",
    } as AgentMessageV1));

    expect(transport.closed).toBe(true);
    expect(detach).toHaveBeenCalledWith(42);
    expect(ui.filter((event) => event.type === "canonical_terminal")).toHaveLength(1);
    expect(await controller.viewState()).toMatchObject({ terminal });
    await expect(controller.restore()).resolves.toBe(false);
  });

  it("restores identifier-only approval metadata and can resolve it after suspension", async () => {
    const sharedStore = new CanonicalSessionStore({ local: area(), session: area(), now: () => NOW });
    const first = setup({ store: sharedStore });
    await first.controller.startTask("Find the current price");
    const approval = {
      type: "approval.requested",
      approvalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      policyDecisionId: IDS.policyDecisionId,
      actionId: IDS.actionId,
      observationId: IDS.observationId,
      requestedAt: "2026-08-04T10:00:05.000Z",
      reason: "Approve consequential action",
    } as AgentMessageV1;
    await first.controller.handleTransportMessage(inbound(approval));

    const resumed = setup({ store: sharedStore });
    await resumed.controller.restore();
    expect(await resumed.controller.viewState()).toMatchObject({
      approval: { approvalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", reason: "Approval required" },
    });
    await resumed.controller.resolveApproval(true);
    expect(resumed.transport.sent.filter((message) => message.type === "approval.resolved").pop()).toBeDefined();
  });

  it("aborts an in-progress bootstrap even before recovery state exists", async () => {
    let bootstrapSignal: AbortSignal | undefined;
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const bootstrap: ConnectionBootstrapPort = {
      bootstrap: jest.fn(async (_input, signal) => {
        bootstrapSignal = signal;
        markEntered();
        await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
        return material();
      }),
    };
    const { controller } = setup({ bootstrap });
    const starting = controller.startTask("Find the current price");
    await entered;

    await controller.cancel();

    expect(bootstrapSignal?.aborted).toBe(true);
    await expect(starting).rejects.toThrow("Aborted");
  });

  it("bounds debugger detach when cancellation interrupts bootstrap", async () => {
    jest.useFakeTimers();
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const bootstrap: ConnectionBootstrapPort = {
      bootstrap: async (_input, signal) => {
        markEntered();
        await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
        return material();
      },
    };
    const { controller } = setup({
      bootstrap,
      detach: async () => new Promise<void>(() => undefined),
    });
    const starting = controller.startTask("Find the current price");
    const rejected = expect(starting).rejects.toThrow("Aborted");
    await entered;
    await controller.cancel();
    await jest.advanceTimersByTimeAsync(1_000);

    await rejected;
    jest.useRealTimers();
  });

  it("contains pipeline failures in one typed action result", async () => {
    const { controller, transport } = setup({ execute: async () => { throw new Error("page secret must not escape"); } });
    await controller.startTask("Find the current price");

    await controller.handleTransportMessage(inbound(commandMessage()));

    const completed = transport.sent.filter((message) => message.type === "action.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ result: { status: "rejected_stale", rejection: { code: "CLIENT_EXECUTION_INDETERMINATE" } } });
    expect(JSON.stringify(completed[0])).not.toContain("page secret");
  });

  it("restores a suspended non-secret session and reconnects for reconciliation", async () => {
    const { controller, store, transport } = setup();
    await store.saveRecovery({
      version: 1,
      serverUrl: material().serverUrl,
      sessionId: IDS.sessionId,
      deviceId: IDS.deviceId,
      lastReceivedSequence: 5,
      lastSentSequence: 6,
      attachedTabId: 42,
      taskId: IDS.taskId,
      lastObservationId: IDS.observationId,
      pendingActionId: IDS.actionId,
      status: "reconnecting",
    });
    await store.saveBootstrap(material());

    await expect(controller.restore()).resolves.toBe(true);
    expect(transport.snapshot().status).toBe("open");
  });
});
