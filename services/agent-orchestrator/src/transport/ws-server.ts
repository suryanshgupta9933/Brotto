import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import {
  SecureAgentIngress,
  createEnvelope,
  signEnvelope,
  type AgentEnvelopeV1,
  type AgentMessageV1,
  type EnvelopeSigner,
} from '@fara-platform/relay-protocol';
import type { ActionCommandV1, SessionId } from '@fara-platform/fara-action-schema';
import type { CanonicalSession, CommandSink, SessionEngineEvent, SessionStore, StoredOutcome } from '../engine/types.js';
import { ConnectionAuthError, createConnectionAuthenticator, type ConnectionClaims, type ConnectionCredentialStore, type ConnectionTokenVerifier } from './auth.js';

export interface TransportEngine { handle(event: SessionEngineEvent): Promise<StoredOutcome> }
export class TransportError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'TransportError'; }
}

export interface LeaseToken { sessionId: string; connectionId: string; fence: number; expiresAt: number }
export interface ConnectionLeaseStore {
  acquire(claims: Readonly<ConnectionClaims>, connectionId: string, expiresAt: number, now: number): Promise<LeaseToken>;
  isOwner(sessionId: string, token: LeaseToken, now?: number): Promise<boolean>;
  renew(token: LeaseToken, expiresAt: number, now: number): Promise<LeaseToken | null>;
  release(token: LeaseToken): Promise<void>;
  runIfOwner<T>(token: LeaseToken, now: number, work: () => Promise<T>): Promise<T>;
}

/** Test/dev adapter. Production deployments inject a durable Redis/SQL implementation. */
export class InMemoryConnectionLeaseBackend {
  readonly leases = new Map<string, LeaseToken>();
  readonly fenceCounters = new Map<string, number>();
  gate: Promise<void> = Promise.resolve();
}
export class InMemoryConnectionLeaseStore implements ConnectionLeaseStore {
  constructor(private readonly backend = new InMemoryConnectionLeaseBackend()) {}
  private exclusive<T>(work: () => Promise<T> | T): Promise<T> {
    const result = this.backend.gate.then(work);
    this.backend.gate = result.then(() => undefined, () => undefined);
    return result;
  }
  acquire(claims: Readonly<ConnectionClaims>, connectionId: string, expiresAt: number, now: number): Promise<LeaseToken> {
    return this.exclusive(() => {
    const current = this.backend.leases.get(claims.sessionId);
    if (current !== undefined && current.expiresAt <= now) this.backend.leases.delete(claims.sessionId);
    const fence = Math.max(this.backend.fenceCounters.get(claims.sessionId) ?? 0, current?.fence ?? 0) + 1;
    this.backend.fenceCounters.set(claims.sessionId, fence);
    const token = { sessionId: claims.sessionId, connectionId, fence, expiresAt };
    this.backend.leases.set(claims.sessionId, token);
    return { ...token };
    });
  }
  isOwner(sessionId: string, token: LeaseToken, now = Date.now()): Promise<boolean> {
    return this.exclusive(() => {
    const current = this.backend.leases.get(sessionId);
    return current?.connectionId === token.connectionId && current.fence === token.fence && current.expiresAt > now;
    });
  }
  release(token: LeaseToken): Promise<void> {
    return this.exclusive(() => {
      const current = this.backend.leases.get(token.sessionId);
      if (current?.connectionId === token.connectionId && current.fence === token.fence) this.backend.leases.delete(token.sessionId);
    });
  }
  renew(token: LeaseToken, expiresAt: number, now: number): Promise<LeaseToken | null> {
    return this.exclusive(() => {
    const current = this.backend.leases.get(token.sessionId);
    if (current?.connectionId !== token.connectionId || current.fence !== token.fence || current.expiresAt <= now) return null;
    const renewed = { ...token, expiresAt };
    this.backend.leases.set(token.sessionId, renewed);
    return { ...renewed };
    });
  }
  runIfOwner<T>(token: LeaseToken, now: number, work: () => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      const current = this.backend.leases.get(token.sessionId);
      if (current?.connectionId !== token.connectionId || current.fence !== token.fence || current.expiresAt <= now) {
        throw new TransportError('LEASE_FENCED', 'Connection lease is stale or expired');
      }
      return work();
    });
  }
}

export class OrderedOutboundQueue {
  private readonly pending: Array<{ value: string; bytes: number; resolve: () => void; reject: (error: unknown) => void }> = [];
  private pendingBytes = 0;
  private pumping = false;
  private drainWaiters: Array<() => void> = [];
  constructor(private readonly options: { maxBytes: number; send(value: string): Promise<void> }) {}

  enqueue(value: string): Promise<void> {
    const bytes = Buffer.byteLength(value);
    if (bytes > this.options.maxBytes || this.pendingBytes + bytes > this.options.maxBytes) {
      return Promise.reject(new TransportError('BACKPRESSURE', 'Outbound queue is full'));
    }
    this.pendingBytes += bytes;
    const promise = new Promise<void>((resolve, reject) => this.pending.push({ value, bytes, resolve, reject }));
    void this.pump();
    return promise;
  }

  drained(): Promise<void> {
    if (!this.pumping && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.push(resolve));
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    while (this.pending.length > 0) {
      const item = this.pending[0]!;
      try { await this.options.send(item.value); item.resolve(); }
      catch (error) { item.reject(error); }
      this.pending.shift();
      this.pendingBytes -= item.bytes;
    }
    this.pumping = false;
    for (const resolve of this.drainWaiters.splice(0)) resolve();
  }
}

export type TransportResult =
  | { kind: 'heartbeat' }
  | { kind: 'duplicate' }
  | { kind: 'outcome'; outcome: StoredOutcome; responseWire?: string };

export class TransportSession {
  private readonly ingress: SecureAgentIngress;
  private rate: { startedAt: number; messages: number; bytes: number };
  private readonly now: () => number;
  constructor(private readonly options: {
    claims: Readonly<ConnectionClaims>; recipientId: string; verifier: EnvelopeSigner; engine: TransportEngine;
    store?: SessionStore; now?: () => number; maxWireBytes?: number; maxMessagesPerMinute?: number; maxBytesPerMinute?: number;
  }) {
    this.now = options.now ?? Date.now;
    this.ingress = new SecureAgentIngress({ now: this.now, maxBytes: options.maxWireBytes ?? 2_000_000, expectedRecipientId: options.recipientId, verifier: options.verifier });
    this.rate = { startedAt: this.now(), messages: 0, bytes: 0 };
  }

  registerOutbound(envelope: AgentEnvelopeV1): void {
    if (envelope.sessionId !== this.options.claims.sessionId || envelope.tenantId !== this.options.claims.tenantId || envelope.deviceId !== this.options.claims.deviceId) {
      throw new TransportError('CLAIM_MISMATCH', 'Outbound envelope does not match connection claims');
    }
    const result = this.ingress.registerOutbound(envelope);
    if (result.status === 'rejected') throw new TransportError(result.code, 'Outbound flow registration failed');
  }

  async receive(raw: string | Uint8Array, connectionFence?: number): Promise<TransportResult> {
    this.charge(raw);
    const admitted = await this.ingress.accept(raw);
    if (admitted.status === 'duplicate') return { kind: 'duplicate' };
    if (admitted.status === 'rejected') throw new TransportError(admitted.code, `Protocol message rejected: ${admitted.code}`);
    const envelope = admitted.envelope;
    if (envelope.sessionId !== this.options.claims.sessionId || envelope.tenantId !== this.options.claims.tenantId || envelope.deviceId !== this.options.claims.deviceId) {
      throw new TransportError('CLAIM_MISMATCH', 'Envelope binding does not match connection claims');
    }
    if (admitted.message.type === 'heartbeat') return { kind: 'heartbeat' };
    if (admitted.message.type === 'reconcile.request' && admitted.message.lastSentClientSequence !== envelope.sequence) {
      throw new TransportError('CLIENT_SEQUENCE_MISMATCH', 'Reconnect client sequence does not match signed envelope');
    }
    let event = toEngineEvent(envelope.messageId, envelope.sessionId, envelope.createdAt, admitted.message, connectionFence);
    if (event === null) throw new TransportError('MESSAGE_DIRECTION_INVALID', 'Server-originated message received from client');
    if (connectionFence !== undefined) {
      const admission = await this.options.store?.admitInbound?.({ sessionId: envelope.sessionId, messageId: envelope.messageId, sequence: envelope.sequence, event });
      if (admission === undefined) throw new TransportError('SEQUENCE_STORE_REQUIRED', 'Durable inbound store is required');
      if (admission === 'duplicate') throw new TransportError('SEQUENCE_REPLAY', 'Client sequence was already accepted');
      if (admission === 'gap') throw new TransportError('CLIENT_SEQUENCE_GAP', 'Client sequence contains a gap');
      const durableEvent = await this.options.store?.loadInbound?.(envelope.messageId);
      if (durableEvent === undefined || durableEvent === null) throw new TransportError('INBOX_READ_FAILED', 'Durably admitted event cannot be loaded');
      event = { ...durableEvent, connectionFence } as SessionEngineEvent;
    }
    const outcome = await this.options.engine.handle(event);
    if (admitted.message.type !== 'reconcile.request' || this.options.store === undefined) return { kind: 'outcome', outcome };
    return { kind: 'outcome', outcome, responseWire: await this.reconcileWire(envelope, outcome) };
  }

  private async reconcileWire(request: AgentEnvelopeV1, outcome: StoredOutcome): Promise<string> {
    const session = await this.options.store!.load(request.sessionId as SessionId);
    if (session === null) throw new TransportError('SESSION_NOT_FOUND', 'Session disappeared during reconciliation');
    const requested = request.payload.type === 'reconcile.request' ? request.payload.pendingActionIds : [];
    const stored = requested.map((id) => session.completedActions[id]?.result).find((value) => value !== undefined);
    const command = session.activeAction === null ? undefined : commandMessage(session);
    const response = createEnvelope({
      messageId: randomUUID(), sessionId: request.sessionId, correlationId: request.messageId, causationId: request.messageId,
      recipientId: this.options.claims.deviceId, tenantId: this.options.claims.tenantId, deviceId: this.options.claims.deviceId,
      sequence: session.nextSequence, createdAt: new Date(this.now()).toISOString(), expiresAt: this.now() + 30_000,
      payload: { type: 'reconcile.response', nextSequence: session.nextSequence, pendingActionIds: outcome.pendingActionIds,
        requiresFreshObservation: outcome.requiresFreshObservation ?? false, authoritativeState: session.state,
        ...(command === undefined ? {} : { command }), ...(stored === undefined ? {} : { storedResult: stored }),
        respondedAt: new Date(this.now()).toISOString() },
    });
    if (command !== undefined) {
      if (session.lastObservation === null) throw new TransportError('ACTION_FLOW_INVALID', 'Stored command has no source observation');
      this.ingress.restoreObservation(session.sessionId, session.lastObservation);
      this.registerOutbound(responseWithCommandFlow(response, command));
    }
    return JSON.stringify(await signEnvelope(response, this.options.verifier));
  }

  private charge(raw: string | Uint8Array): void {
    const now = this.now();
    if (now - this.rate.startedAt >= 60_000) this.rate = { startedAt: now, messages: 0, bytes: 0 };
    this.rate.messages += 1;
    this.rate.bytes += typeof raw === 'string' ? Buffer.byteLength(raw) : raw.byteLength;
    if (this.rate.messages > (this.options.maxMessagesPerMinute ?? 120) || this.rate.bytes > (this.options.maxBytesPerMinute ?? 20_000_000)) throw new TransportError('RATE_LIMITED', 'Connection message rate exceeded');
  }
}

function responseWithCommandFlow(response: AgentEnvelopeV1, command: AgentMessageV1): AgentEnvelopeV1 {
  return { ...response, payload: command } as AgentEnvelopeV1;
}
function commandMessage(session: CanonicalSession): Extract<AgentMessageV1, { type: 'action.command' }> | undefined {
  const active = session.activeAction;
  return active === null ? undefined : { type: 'action.command', proposal: active.proposal, policyDecision: active.policyDecision, command: active.command };
}

export interface OutboundConnection { claims: Readonly<ConnectionClaims>; session: TransportSession; queue: OrderedOutboundQueue }
export class AgentTransportHub implements CommandSink {
  private readonly connections = new Map<string, OutboundConnection>();
  constructor(private readonly store: SessionStore, private readonly signer: EnvelopeSigner, private readonly now: () => number = Date.now) {}
  attach(connection: OutboundConnection): () => void {
    this.connections.set(connection.claims.sessionId, connection);
    return () => { if (this.connections.get(connection.claims.sessionId) === connection) this.connections.delete(connection.claims.sessionId); };
  }
  async send(command: ActionCommandV1): Promise<void> {
    const session = await this.store.loadByAction?.(command.actionId) ?? await this.findSession(command);
    if (session === null || session.activeAction === null) throw new TransportError('SESSION_NOT_FOUND', 'No active session for command');
    const connection = this.connections.get(session.sessionId);
    if (connection === undefined) throw new TransportError('CLIENT_DISCONNECTED', 'Client is not connected');
    const payload = commandMessage(session)!;
    const envelope = createEnvelope({ messageId: randomUUID(), sessionId: session.sessionId, correlationId: command.actionId, causationId: command.observationId,
      recipientId: connection.claims.deviceId, tenantId: connection.claims.tenantId, deviceId: connection.claims.deviceId,
      sequence: command.sequence, createdAt: new Date(this.now()).toISOString(), expiresAt: Date.parse(command.expiresAt), payload });
    connection.session.registerOutbound(envelope);
    await connection.queue.enqueue(JSON.stringify(await signEnvelope(envelope, this.signer)));
  }
  private async findSession(command: ActionCommandV1): Promise<CanonicalSession | null> {
    for (const sessionId of this.connections.keys()) {
      const session = await this.store.load(sessionId as SessionId);
      if (session?.activeAction?.actionId === command.actionId) return session;
    }
    return null;
  }
}

// Optional optimized store lookup without making it part of the canonical persistence contract.
declare module '../engine/types.js' { interface SessionStore { loadByAction?(actionId: ActionCommandV1['actionId']): Promise<CanonicalSession | null> } }

function toEngineEvent(messageId: string, sessionId: string, occurredAt: string, message: AgentMessageV1, connectionFence?: number): SessionEngineEvent | null {
  const meta = { messageId, sessionId, occurredAt, ...(connectionFence === undefined ? {} : { connectionFence }) } as const;
  switch (message.type) {
    case 'observation.submitted': return { ...meta, type: message.type, observation: message.observation } as SessionEngineEvent;
    case 'action.completed': return { ...meta, type: message.type, result: message.result } as SessionEngineEvent;
    case 'approval.resolved': return { ...meta, type: message.type, resolution: message.resolution } as SessionEngineEvent;
    case 'reconcile.request': return { ...meta, type: message.type, lastReceivedSequence: message.lastReceivedSequence, lastSentClientSequence: message.lastSentClientSequence, pendingActionIds: message.pendingActionIds } as SessionEngineEvent;
    case 'task.cancelled': return { ...meta, type: message.type, reason: message.reason } as SessionEngineEvent;
    default: return null;
  }
}

interface SocketLike { bufferedAmount: number; send(data: string, callback?: (error?: Error) => void): void; close(code?: number, reason?: string): void; ping(): void; on(event: 'message', listener: (data: unknown) => void): void; on(event: 'pong' | 'close', listener: () => void): void }

export function connectionTokenFromProtocols(headerValue: string | undefined): string {
  const protocols = (headerValue ?? '').split(',').map((value) => value.trim());
  if (!protocols.includes('fara-v1')) throw new ConnectionAuthError('TOKEN_REQUIRED', 'Required WebSocket protocol is missing');
  const credential = protocols.find((value) => value.startsWith('fara-credential.'));
  if (credential === undefined || credential.length === 'fara-credential.'.length) throw new ConnectionAuthError('TOKEN_REQUIRED', 'Connection credential is missing');
  return credential.slice('fara-credential.'.length);
}

export async function registerAgentWebSocket(app: FastifyInstance, options: {
  tokenVerifier: ConnectionTokenVerifier; envelopeVerifier: EnvelopeSigner; engine: TransportEngine; store: SessionStore;
  leases: ConnectionLeaseStore; credentials: ConnectionCredentialStore; recipientId: string; allowedOrigins: ReadonlySet<string>; hub?: AgentTransportHub;
  now?: () => number; heartbeatTimeoutMs?: number; maxOutboundBytes?: number;
}): Promise<void> {
  await app.register(websocket);
  const now = options.now ?? Date.now;
  const authenticate = createConnectionAuthenticator({ verifier: options.tokenVerifier, now, allowedOrigins: options.allowedOrigins });
  const authenticated = new WeakMap<FastifyRequest, Readonly<ConnectionClaims>>();
  app.get('/v1/agent', {
    websocket: true,
    preValidation: async (request) => {
      const claims = await authenticate({ token: connectionTokenFromProtocols(header(request.headers['sec-websocket-protocol'])), origin: header(request.headers.origin) });
      if (!await options.credentials.consume(claims.credentialId, claims.expiresAt, now())) throw new ConnectionAuthError('TOKEN_REPLAY', 'Connection credential was already used');
      authenticated.set(request, claims);
    },
  }, (socketValue, request) => {
    const socket = socketValue as unknown as SocketLike;
    const claims = authenticated.get(request);
    if (claims === undefined) { socket.close(4401, 'TOKEN_INVALID'); return; }
    const connectionId = randomUUID();
    const ready = options.leases.acquire(claims, connectionId, now() + (options.heartbeatTimeoutMs ?? 30_000) * 2, now()).then((initialLease) => {
      const state = { lease: initialLease };
      const session = new TransportSession({ claims, recipientId: options.recipientId, verifier: options.envelopeVerifier, engine: options.engine, store: options.store, now });
      const outboundLimit = options.maxOutboundBytes ?? 1_000_000;
      const queue = new OrderedOutboundQueue({ maxBytes: outboundLimit, send: (value) => socketSend(socket, value, outboundLimit) });
      const detach = options.hub?.attach({ claims, session, queue });
      let alive = true;
      const timer = setInterval(() => { void options.leases.isOwner(claims.sessionId, state.lease, now()).then(async (owner) => {
        if (!owner || !alive || state.lease.expiresAt <= now()) { socket.close(4001, 'connection lease expired'); clearInterval(timer); return; }
        const renewed = await options.leases.renew(state.lease, now() + (options.heartbeatTimeoutMs ?? 30_000) * 2, now());
        if (renewed === null) { socket.close(4001, 'connection lease fenced'); clearInterval(timer); return; }
        state.lease = renewed; alive = false; socket.ping();
      }); }, options.heartbeatTimeoutMs ?? 30_000);
      timer.unref();
      socket.on('pong', () => { alive = true; });
      socket.on('close', () => { clearInterval(timer); detach?.(); void options.leases.release(state.lease); });
      return { state, session, queue };
    });
    socket.on('message', (data) => { void ready.then(({ state, session, queue }) => options.leases.runIfOwner(state.lease, now(), async () => {
      const result = await session.receive(normalizeWire(data), state.lease.fence);
      if (result.kind === 'outcome' && result.responseWire !== undefined) await queue.enqueue(result.responseWire);
    })).catch((error: unknown) => socket.close(closeCode(error), safeReason(error))); });
    void ready.catch((error: unknown) => socket.close(closeCode(error), safeReason(error)));
  });
}

function socketSend(socket: SocketLike, value: string, maxBufferedBytes: number): Promise<void> {
  if (socket.bufferedAmount + Buffer.byteLength(value) > maxBufferedBytes) return Promise.reject(new TransportError('BACKPRESSURE', 'Socket buffer is full'));
  try { socket.send(value); return Promise.resolve(); } catch (error) { return Promise.reject(error); }
}
function header(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
function normalizeWire(data: unknown): string | Uint8Array { if (typeof data === 'string' || data instanceof Uint8Array) return data; throw new TransportError('INVALID_WIRE', 'WebSocket frame must be text or binary'); }
function closeCode(error: unknown): number { return error instanceof ConnectionAuthError ? 4401 : error instanceof TransportError && error.code === 'RATE_LIMITED' ? 4429 : 4400; }
function safeReason(error: unknown): string { return error instanceof ConnectionAuthError || error instanceof TransportError ? error.code : 'INTERNAL_ERROR'; }
