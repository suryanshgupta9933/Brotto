import {
  AgentEnvelopeV1Schema,
  AgentMessageV1Schema,
  canonicalEnvelopeBytes,
  createEnvelope,
  signEnvelope,
  type AgentEnvelopeV1,
  type AgentMessageV1,
  type EnvelopeSigner,
} from "@brotto/relay-protocol";

const MAX_WIRE_BYTES = 2_000_000;
const DEFAULT_MESSAGE_TTL_MS = 30_000;
const DEFAULT_HEARTBEAT_MS = 20_000;
const TOKEN_PROTOCOL = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CanonicalBootstrapMaterial {
  readonly serverUrl: string;
  readonly connectionCredential: string;
  readonly serverRecipientId: string;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly sessionId: string;
  readonly expiresAt: number;
  /** URL-safe base64 for at least 256 bits of per-session WebCrypto HMAC material. */
  readonly hmacKey: string;
}

export interface TransportSocket {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  send(value: string): void;
  close(code?: number, reason?: string): void;
}

export interface TransportClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type TransportStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed" | "failed";

export interface TransportSnapshot {
  readonly status: TransportStatus;
  readonly reconnectAttempt: number;
  readonly lastReceivedSequence: number;
  readonly lastSentSequence: number;
}

export interface TransportMessage {
  readonly envelope: AgentEnvelopeV1;
  readonly message: AgentMessageV1;
}

export interface SendEnvelopeLinkage {
  readonly correlationId: string;
  readonly causationId: string;
}

export interface CanonicalTransportOptions {
  readonly material: CanonicalBootstrapMaterial;
  readonly initialSequences?: {
    readonly lastReceivedSequence: number;
    readonly lastSentSequence: number;
  };
  readonly pendingActionIds?: () => readonly string[];
  readonly getReconnectMaterial?: (signal: AbortSignal) => Promise<CanonicalBootstrapMaterial>;
  readonly onMaterial?: (material: CanonicalBootstrapMaterial) => void | Promise<void>;
  readonly onMessage?: (message: TransportMessage) => void | Promise<void>;
  readonly onMessageError?: (error: unknown) => void;
  readonly onStateChange?: (snapshot: TransportSnapshot) => void;
  readonly onProtocolError?: (code: string) => void;
  readonly websocketFactory?: (url: string, protocols: readonly string[]) => TransportSocket;
  readonly clock?: TransportClock;
  readonly now?: () => number;
  readonly idGenerator?: () => string;
  readonly heartbeatMs?: number;
  readonly reconnect?: {
    readonly baseDelayMs?: number;
    readonly maxDelayMs?: number;
    readonly maxAttempts?: number;
  };
}

const realClock: TransportClock = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Authenticated, signed canonical application transport. It exposes no browser or CDP escape hatches. */
export class CanonicalTransport {
  private material: CanonicalBootstrapMaterial;
  private signer: Promise<EnvelopeSigner>;
  private readonly options: CanonicalTransportOptions;
  private readonly now: () => number;
  private readonly clock: TransportClock;
  private readonly websocketFactory: NonNullable<CanonicalTransportOptions["websocketFactory"]>;
  private readonly idGenerator: () => string;
  private readonly abortController = new AbortController();
  private readonly receivedMessageIds = new Set<string>();
  private socket: TransportSocket | null = null;
  private status: TransportStatus = "idle";
  private reconnectAttempt = 0;
  private lastReceivedSequence: number;
  private lastSentSequence: number;
  private explicitClose = false;
  private reconnectTimer: unknown;
  private heartbeatTimer: unknown;
  private sendTail: Promise<void> = Promise.resolve();
  private receiveTail: Promise<void> = Promise.resolve();
  private receiveFault: unknown;

  constructor(options: CanonicalTransportOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.clock = options.clock ?? realClock;
    this.websocketFactory = options.websocketFactory ?? ((url, protocols) => new WebSocket(url, [...protocols]));
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
    this.material = validateMaterial(options.material, this.now());
    this.signer = deriveBootstrapEnvelopeSigner(this.material);
    this.lastReceivedSequence = validSequence(options.initialSequences?.lastReceivedSequence ?? 0);
    this.lastSentSequence = validSequence(options.initialSequences?.lastSentSequence ?? 0);
  }

  snapshot(): TransportSnapshot {
    return {
      status: this.status,
      reconnectAttempt: this.reconnectAttempt,
      lastReceivedSequence: this.lastReceivedSequence,
      lastSentSequence: this.lastSentSequence,
    };
  }

  async drained(): Promise<void> {
    await this.receiveTail;
    if (this.receiveFault !== undefined) throw this.receiveFault;
    await this.sendTail;
  }

  async connect(): Promise<void> {
    if (this.explicitClose || this.abortController.signal.aborted) throw new DOMException("Transport is closed", "AbortError");
    if (this.socket?.readyState === 1) return;
    await this.openSocket(this.reconnectAttempt > 0);
  }

  send(message: AgentMessageV1, linkage?: SendEnvelopeLinkage): Promise<AgentEnvelopeV1> {
    let resolveEnvelope!: (value: AgentEnvelopeV1) => void;
    let rejectEnvelope!: (reason?: unknown) => void;
    const result = new Promise<AgentEnvelopeV1>((resolve, reject) => {
      resolveEnvelope = resolve;
      rejectEnvelope = reject;
    });
    const work = this.sendTail.then(async () => {
      try {
        resolveEnvelope(await this.sendNow(message, linkage));
      } catch (error) {
        rejectEnvelope(error);
      }
    });
    this.sendTail = work.then(() => undefined, () => undefined);
    return result;
  }

  async reconcile(): Promise<AgentEnvelopeV1> {
    const nextSequence = this.lastSentSequence + 1;
    return this.send({
      type: "reconcile.request",
      lastReceivedSequence: this.lastReceivedSequence,
      lastSentClientSequence: nextSequence,
      pendingActionIds: [...(this.options.pendingActionIds?.() ?? [])] as never,
      requestedAt: new Date(this.now()).toISOString(),
    }, {
      correlationId: this.material.sessionId,
      causationId: this.material.sessionId,
    });
  }

  async close(reason = "client closed"): Promise<void> {
    this.explicitClose = true;
    this.abortController.abort();
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket !== null && socket.readyState < 2) socket.close(1000, safeCloseReason(reason));
    this.setStatus("closed");
  }

  private openSocket(reconnecting: boolean): Promise<void> {
    this.setStatus(reconnecting ? "reconnecting" : "connecting");
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket: TransportSocket;
      try {
        socket = this.websocketFactory(this.material.serverUrl, [
          "brotto-v1",
          `brotto-credential.${this.material.connectionCredential}`,
        ]);
      } catch (error) {
        reject(error);
        this.scheduleReconnect();
        return;
      }
      this.socket = socket;
      socket.onopen = () => {
        if (this.explicitClose || this.abortController.signal.aborted) {
          socket.close(1000, "closed");
          return;
        }
        settled = true;
        this.setStatus("open");
        this.scheduleHeartbeat();
        resolve();
        if (reconnecting || this.lastSentSequence > 0) {
          void this.reconcile().catch(() => socket.close(4400, "RECONCILE_FAILED"));
        }
      };
      socket.onmessage = (event) => {
        this.receiveTail = this.receiveTail
          .then(() => this.acceptWire(event.data))
          .catch((error: unknown) => {
            this.receiveFault = error;
            this.options.onMessageError?.(error);
            this.explicitClose = true;
            this.clearTimers();
            this.setStatus("failed");
            if (socket.readyState < 2) socket.close(4400, "MESSAGE_HANDLER_FAILED");
          });
      };
      socket.onerror = () => {
        if (!settled) reject(new Error("WebSocket connection failed"));
      };
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
        this.clearHeartbeat();
        if (!settled) reject(new Error("WebSocket closed before authentication completed"));
        if (!this.explicitClose) this.scheduleReconnect();
      };
    });
  }

  private async sendNow(message: AgentMessageV1, linkage?: SendEnvelopeLinkage): Promise<AgentEnvelopeV1> {
    if (this.abortController.signal.aborted) throw new DOMException("Transport is closed", "AbortError");
    const socket = this.socket;
    if (socket === null || socket.readyState !== 1 || this.status !== "open") throw new Error("Canonical transport is not open");
    if (this.material.expiresAt <= this.now()) throw new Error("Canonical bootstrap material expired");
    const payload = AgentMessageV1Schema.parse(message);
    const messageId = requireUuid(this.idGenerator(), "message ID");
    const correlationId = requireUuid(linkage?.correlationId ?? messageId, "correlation ID");
    const causationId = requireUuid(linkage?.causationId ?? correlationId, "causation ID");
    const sequence = this.lastSentSequence + 1;
    const createdAt = new Date(this.now()).toISOString();
    const envelope = createEnvelope({
      messageId,
      sessionId: this.material.sessionId,
      correlationId,
      causationId,
      recipientId: this.material.serverRecipientId,
      tenantId: this.material.tenantId,
      deviceId: this.material.deviceId,
      sequence,
      createdAt,
      expiresAt: Math.min(this.material.expiresAt, this.now() + DEFAULT_MESSAGE_TTL_MS),
      payload,
    });
    const signed = await signEnvelope(envelope, await this.signer);
    const wire = JSON.stringify(signed);
    if (new TextEncoder().encode(wire).byteLength > MAX_WIRE_BYTES) throw new Error("Canonical envelope exceeds wire limit");
    socket.send(wire);
    this.lastSentSequence = sequence;
    this.emitState();
    return signed;
  }

  private async acceptWire(raw: unknown): Promise<void> {
    let wire: string;
    if (typeof raw === "string") wire = raw;
    else if (raw instanceof ArrayBuffer) wire = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    else {
      this.rejectProtocol("INVALID_WIRE");
      return;
    }
    if (new TextEncoder().encode(wire).byteLength > MAX_WIRE_BYTES) {
      this.rejectProtocol("MESSAGE_TOO_LARGE");
      return;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(wire);
    } catch {
      this.rejectProtocol("INVALID_WIRE");
      return;
    }
    const parsed = AgentEnvelopeV1Schema.safeParse(decoded);
    if (!parsed.success) {
      this.rejectProtocol("INVALID_ENVELOPE");
      return;
    }
    const envelope = parsed.data;
    if (envelope.signature === undefined || !await (await this.signer).verify(canonicalEnvelopeBytes(envelope), envelope.signature)) {
      this.rejectProtocol("SIGNATURE_INVALID");
      return;
    }
    if (envelope.sessionId !== this.material.sessionId || envelope.recipientId !== this.material.deviceId ||
      envelope.tenantId !== this.material.tenantId || envelope.deviceId !== this.material.deviceId) {
      this.rejectProtocol("ENVELOPE_BINDING_INVALID");
      return;
    }
    if (envelope.expiresAt <= this.now()) {
      this.rejectProtocol("MESSAGE_EXPIRED");
      return;
    }
    if (this.receivedMessageIds.has(envelope.messageId)) {
      this.rejectProtocol("MESSAGE_DUPLICATE");
      return;
    }
    if (envelope.sequence <= this.lastReceivedSequence) {
      this.rejectProtocol("SEQUENCE_REPLAY");
      return;
    }
    if (!isServerMessage(envelope.payload.type)) {
      this.rejectProtocol("MESSAGE_DIRECTION_INVALID");
      return;
    }
    this.receivedMessageIds.add(envelope.messageId);
    this.lastReceivedSequence = envelope.sequence;
    this.emitState();
    await this.options.onMessage?.({ envelope, message: envelope.payload });
  }

  private scheduleReconnect(): void {
    if (this.explicitClose || this.reconnectTimer !== undefined) return;
    const maximum = this.options.reconnect?.maxAttempts ?? 5;
    if (this.reconnectAttempt >= maximum) {
      this.setStatus("failed");
      return;
    }
    this.reconnectAttempt += 1;
    this.setStatus("reconnecting");
    const base = this.options.reconnect?.baseDelayMs ?? 250;
    const cap = this.options.reconnect?.maxDelayMs ?? 10_000;
    const delay = Math.min(cap, base * (2 ** (this.reconnectAttempt - 1)));
    this.reconnectTimer = this.clock.setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.refreshMaterial()
        .then(() => this.openSocket(true))
        .catch(() => this.scheduleReconnect());
    }, delay);
  }

  private async refreshMaterial(): Promise<void> {
    if (this.options.getReconnectMaterial === undefined) throw new Error("A fresh one-time reconnect credential is required");
    const next = validateMaterial(await this.options.getReconnectMaterial(this.abortController.signal), this.now());
    if (next.sessionId !== this.material.sessionId || next.deviceId !== this.material.deviceId ||
      next.tenantId !== this.material.tenantId || next.serverRecipientId !== this.material.serverRecipientId) {
      throw new Error("Reconnect bootstrap binding changed");
    }
    this.material = next;
    this.signer = deriveBootstrapEnvelopeSigner(next);
    await this.options.onMaterial?.(next);
  }

  private scheduleHeartbeat(): void {
    this.clearHeartbeat();
    const heartbeatMs = boundedPositive(this.options.heartbeatMs, DEFAULT_HEARTBEAT_MS);
    this.heartbeatTimer = this.clock.setTimeout(() => {
      this.heartbeatTimer = undefined;
      if (this.status !== "open") return;
      void this.send({ type: "heartbeat", sentAt: new Date(this.now()).toISOString() }, {
        correlationId: this.material.sessionId,
        causationId: this.material.sessionId,
      }).then(() => this.scheduleHeartbeat(), () => this.socket?.close(4400, "HEARTBEAT_FAILED"));
    }, heartbeatMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) this.clock.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer !== undefined) this.clock.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private setStatus(status: TransportStatus): void {
    this.status = status;
    this.emitState();
  }

  private emitState(): void {
    this.options.onStateChange?.(this.snapshot());
  }

  private rejectProtocol(code: string): void {
    this.options.onProtocolError?.(code);
  }
}

export async function deriveBootstrapEnvelopeSigner(material: CanonicalBootstrapMaterial): Promise<EnvelopeSigner> {
  const keyBytes = decodeBase64Url(material.hmacKey);
  if (keyBytes.byteLength < 32) throw new TypeError("Bootstrap HMAC material must contain at least 256 bits");
  const key = await crypto.subtle.importKey(
    "raw",
    exactArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return {
    sign: async (bytes) => encodeBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, exactArrayBuffer(bytes)))),
    verify: async (bytes, signature) => {
      let decoded: Uint8Array;
      try {
        decoded = decodeBase64Url(signature);
      } catch {
        return false;
      }
      return crypto.subtle.verify("HMAC", key, exactArrayBuffer(decoded), exactArrayBuffer(bytes));
    },
  };
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function validateMaterial(material: CanonicalBootstrapMaterial, now: number): CanonicalBootstrapMaterial {
  const url = new URL(material.serverUrl);
  if (url.protocol !== "wss:" || url.username !== "" || url.password !== "") throw new TypeError("Canonical transport requires authenticated WSS");
  if (!TOKEN_PROTOCOL.test(material.connectionCredential) || material.connectionCredential.length > 16_384) {
    throw new TypeError("Connection credential is not a valid WebSocket subprotocol token");
  }
  requireUuid(material.serverRecipientId, "server recipient ID");
  requireUuid(material.deviceId, "device ID");
  requireUuid(material.sessionId, "session ID");
  if (material.tenantId.length === 0 || material.tenantId.length > 256) throw new TypeError("Tenant ID is invalid");
  if (!Number.isInteger(material.expiresAt) || material.expiresAt <= now) throw new TypeError("Canonical bootstrap material expired");
  if (material.hmacKey.length === 0 || material.hmacKey.length > 4_096) throw new TypeError("Bootstrap HMAC material is absent or invalid");
  return { ...material, serverUrl: url.href };
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError("Invalid URL-safe base64");
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function requireUuid(value: string, name: string): string {
  if (!UUID.test(value)) throw new TypeError(`${name} must be a UUID`);
  return value;
}

function validSequence(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new TypeError("Transport sequence is invalid");
  return value;
}

function boundedPositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function safeCloseReason(reason: string): string {
  return reason.replace(/[^a-z0-9 _.-]/gi, "").slice(0, 100) || "closed";
}

function isServerMessage(type: AgentMessageV1["type"]): boolean {
  return type === "session.accepted" || type === "action.command" || type === "approval.requested" ||
    type === "task.completed" || type === "task.failed" || type === "task.cancelled" ||
    type === "reconcile.response" || type === "protocol.error" || type === "heartbeat";
}
