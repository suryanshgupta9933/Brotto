import {
  createEnvelope,
  signEnvelope,
  type AgentMessageV1,
} from "@brotto/relay-protocol";
import {
  CanonicalTransport,
  deriveBootstrapEnvelopeSigner,
  type CanonicalBootstrapMaterial,
  type TransportSocket,
} from "../src/canonical/transport";

const IDS = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  serverRecipientId: "33333333-3333-4333-8333-333333333333",
  taskId: "44444444-4444-4444-8444-444444444444",
  actionId: "55555555-5555-4555-8555-555555555555",
};

const NOW = Date.parse("2026-08-04T10:00:00.000Z");
const HMAC_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY";

function material(overrides: Partial<CanonicalBootstrapMaterial> = {}): CanonicalBootstrapMaterial {
  return {
    serverUrl: "wss://agent.example.test/v1/agent",
    connectionCredential: "one-time-credential",
    serverRecipientId: IDS.serverRecipientId,
    tenantId: "tenant-a",
    deviceId: IDS.deviceId,
    sessionId: IDS.sessionId,
    expiresAt: NOW + 60_000,
    hmacKey: HMAC_KEY,
    ...overrides,
  };
}

class FakeSocket implements TransportSocket {
  readonly sent: string[] = [];
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  open(): void {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }

  receive(value: string): void {
    this.onmessage?.({ data: value } as MessageEvent);
  }

  send(value: string): void {
    this.sent.push(value);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("CanonicalTransport", () => {
  it("opens authenticated WSS and signs strictly sequenced envelopes", async () => {
    const sockets: FakeSocket[] = [];
    const constructions: Array<{ url: string; protocols: string[] }> = [];
    const transport = new CanonicalTransport({
      material: material(),
      now: () => NOW,
      idGenerator: () => "66666666-6666-4666-8666-666666666666",
      websocketFactory: (url, protocols) => {
        constructions.push({ url, protocols: [...protocols] });
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });

    const connecting = transport.connect();
    sockets[0]!.open();
    await connecting;
    await transport.send(
      { type: "session.open", client: "browser_extension", goal: "Find the current price" },
      { correlationId: IDS.taskId, causationId: IDS.taskId },
    );

    expect(constructions).toEqual([{
      url: "wss://agent.example.test/v1/agent",
      protocols: ["brotto-v1", "brotto-credential.one-time-credential"],
    }]);
    const sent = JSON.parse(sockets[0]!.sent[0]!);
    expect(sent).toMatchObject({
      sessionId: IDS.sessionId,
      recipientId: IDS.serverRecipientId,
      tenantId: "tenant-a",
      deviceId: IDS.deviceId,
      sequence: 1,
      payload: { type: "session.open", goal: "Find the current price" },
    });
    expect(sent.signature).toEqual(expect.any(String));
    await transport.close();
  });

  it("validates server signatures, recipient binding, expiry, and replay before dispatch", async () => {
    const socket = new FakeSocket();
    const received: AgentMessageV1[] = [];
    const rejected: string[] = [];
    const transport = new CanonicalTransport({
      material: material(),
      now: () => NOW,
      websocketFactory: () => socket,
      onMessage: ({ message }) => { received.push(message); },
      onProtocolError: (code) => { rejected.push(code); },
    });
    const connecting = transport.connect();
    socket.open();
    await connecting;

    const signer = await deriveBootstrapEnvelopeSigner(material());
    const valid = await signEnvelope(createEnvelope({
      messageId: "77777777-7777-4777-8777-777777777777",
      sessionId: IDS.sessionId,
      correlationId: IDS.taskId,
      causationId: IDS.taskId,
      recipientId: IDS.deviceId,
      tenantId: "tenant-a",
      deviceId: IDS.deviceId,
      sequence: 4,
      createdAt: new Date(NOW).toISOString(),
      expiresAt: NOW + 30_000,
      payload: { type: "heartbeat", sentAt: new Date(NOW).toISOString() },
    }), signer);
    socket.receive(JSON.stringify(valid));
    socket.receive(JSON.stringify(valid));
    socket.receive(JSON.stringify({ ...valid, messageId: "88888888-8888-4888-8888-888888888888", signature: "invalid" }));
    await transport.drained();

    expect(received).toEqual([{ type: "heartbeat", sentAt: new Date(NOW).toISOString() }]);
    expect(rejected).toEqual(["MESSAGE_DUPLICATE", "SIGNATURE_INVALID"]);
    expect(transport.snapshot().lastReceivedSequence).toBe(4);
    await transport.close();
  });

  it("surfaces controller message failures and fails the socket closed", async () => {
    const socket = new FakeSocket();
    const faults: unknown[] = [];
    const transport = new CanonicalTransport({
      material: material(),
      now: () => NOW,
      websocketFactory: () => socket,
      onMessage: async () => { throw new Error("controller failed"); },
      onMessageError: (error) => { faults.push(error); },
    });
    const connecting = transport.connect();
    socket.open();
    await connecting;
    const signer = await deriveBootstrapEnvelopeSigner(material());
    const valid = await signEnvelope(createEnvelope({
      messageId: "77777777-7777-4777-8777-777777777777",
      sessionId: IDS.sessionId,
      correlationId: IDS.taskId,
      causationId: IDS.taskId,
      recipientId: IDS.deviceId,
      tenantId: "tenant-a",
      deviceId: IDS.deviceId,
      sequence: 1,
      createdAt: new Date(NOW).toISOString(),
      expiresAt: NOW + 30_000,
      payload: { type: "heartbeat", sentAt: new Date(NOW).toISOString() },
    }), signer);

    socket.receive(JSON.stringify(valid));
    await expect(transport.drained()).rejects.toThrow("controller failed");
    expect(faults).toHaveLength(1);
    expect(socket.readyState).toBe(3);
  });

  it("uses fresh bootstrap material and reconciles pending work after bounded reconnect", async () => {
    jest.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const refreshed = material({ connectionCredential: "replacement-credential", expiresAt: NOW + 120_000 });
    const getReconnectMaterial = jest.fn(async () => refreshed);
    const transport = new CanonicalTransport({
      material: material(),
      initialSequences: { lastReceivedSequence: 7, lastSentSequence: 8 },
      pendingActionIds: () => [IDS.actionId],
      getReconnectMaterial,
      now: () => NOW,
      websocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      reconnect: { baseDelayMs: 100, maxDelayMs: 400, maxAttempts: 3 },
    });
    const initial = transport.connect();
    sockets[0]!.open();
    await initial;

    sockets[0]!.close(1006, "network lost");
    await jest.advanceTimersByTimeAsync(100);
    expect(getReconnectMaterial).toHaveBeenCalledTimes(1);
    sockets[1]!.open();
    await transport.drained();

    const reconcile = JSON.parse(sockets[1]!.sent[0]!);
    expect(reconcile.payload).toMatchObject({
      type: "reconcile.request",
      lastReceivedSequence: 7,
      lastSentClientSequence: 10,
      pendingActionIds: [IDS.actionId],
    });
    expect(reconcile.sequence).toBe(10);
    await transport.close();
    jest.useRealTimers();
  });

  it("aborts close without scheduling another connection", async () => {
    jest.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const transport = new CanonicalTransport({
      material: material(),
      websocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const connecting = transport.connect();
    sockets[0]!.open();
    await connecting;

    await transport.close("cancelled");
    await jest.runAllTimersAsync();

    expect(sockets).toHaveLength(1);
    expect(transport.snapshot().status).toBe("closed");
    jest.useRealTimers();
  });

  it("fails closed for non-WSS or missing and expired signing material", async () => {
    expect(() => new CanonicalTransport({ material: material({ serverUrl: "ws://agent.example.test/v1/agent" }) }))
      .toThrow("WSS");
    await expect(deriveBootstrapEnvelopeSigner(material({ hmacKey: "" }))).rejects.toThrow();
    expect(() => new CanonicalTransport({ material: material({ expiresAt: NOW - 1 }), now: () => NOW }))
      .toThrow("expired");
  });
});
