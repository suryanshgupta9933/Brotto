import type { FastifyInstance, FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import {
  SecureAgentIngress,
  type AgentMessageV1,
  type EnvelopeSigner,
} from '@fara-platform/relay-protocol';
import type { SessionEngineEvent, StoredOutcome } from '../engine/types.js';
import {
  ConnectionAuthError,
  createConnectionAuthenticator,
  type ConnectionClaims,
  type ConnectionTokenVerifier,
} from './auth.js';

export interface TransportEngine { handle(event: SessionEngineEvent): Promise<StoredOutcome> }

export class TransportError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'TransportError'; }
}

export type TransportResult = { kind: 'heartbeat' } | { kind: 'duplicate' } | { kind: 'outcome'; outcome: StoredOutcome };

interface RateWindow { startedAt: number; messages: number; bytes: number }

export class TransportSession {
  private readonly ingress: SecureAgentIngress;
  private rate: RateWindow;
  private readonly maxMessagesPerMinute: number;
  private readonly maxBytesPerMinute: number;

  constructor(private readonly options: {
    claims: Readonly<ConnectionClaims>;
    recipientId: string;
    verifier: EnvelopeSigner;
    engine: TransportEngine;
    now?: () => number;
    maxWireBytes?: number;
    maxMessagesPerMinute?: number;
    maxBytesPerMinute?: number;
  }) {
    const now = options.now ?? Date.now;
    this.ingress = new SecureAgentIngress({ now, maxBytes: options.maxWireBytes ?? 2_000_000, expectedRecipientId: options.recipientId, verifier: options.verifier });
    this.rate = { startedAt: now(), messages: 0, bytes: 0 };
    this.maxMessagesPerMinute = options.maxMessagesPerMinute ?? 120;
    this.maxBytesPerMinute = options.maxBytesPerMinute ?? 20_000_000;
  }

  async receive(raw: string | Uint8Array): Promise<TransportResult> {
    this.charge(raw);
    const admitted = await this.ingress.accept(raw);
    if (admitted.status === 'duplicate') return { kind: 'duplicate' };
    if (admitted.status === 'rejected') throw new TransportError(admitted.code, `Protocol message rejected: ${admitted.code}`);
    if (admitted.envelope.sessionId !== this.options.claims.sessionId) {
      throw new TransportError('CLAIM_MISMATCH', 'Envelope session does not match connection claims');
    }
    if (admitted.message.type === 'heartbeat') return { kind: 'heartbeat' };
    const event = toEngineEvent(admitted.envelope.messageId, admitted.envelope.sessionId, admitted.envelope.createdAt, admitted.message);
    if (event === null) throw new TransportError('MESSAGE_DIRECTION_INVALID', 'Server-originated message received from client');
    return { kind: 'outcome', outcome: await this.options.engine.handle(event) };
  }

  private charge(raw: string | Uint8Array): void {
    const now = (this.options.now ?? Date.now)();
    if (now - this.rate.startedAt >= 60_000) this.rate = { startedAt: now, messages: 0, bytes: 0 };
    const bytes = typeof raw === 'string' ? Buffer.byteLength(raw) : raw.byteLength;
    this.rate.messages += 1;
    this.rate.bytes += bytes;
    if (this.rate.messages > this.maxMessagesPerMinute || this.rate.bytes > this.maxBytesPerMinute) {
      throw new TransportError('RATE_LIMITED', 'Connection message rate exceeded');
    }
  }
}

function toEngineEvent(messageId: string, sessionId: string, occurredAt: string, message: AgentMessageV1): SessionEngineEvent | null {
  const meta = { messageId, sessionId, occurredAt } as const;
  switch (message.type) {
    case 'observation.submitted': return { ...meta, type: message.type, observation: message.observation } as SessionEngineEvent;
    case 'action.completed': return { ...meta, type: message.type, result: message.result } as SessionEngineEvent;
    case 'approval.resolved': return { ...meta, type: message.type, resolution: message.resolution } as SessionEngineEvent;
    case 'reconcile.request': return { ...meta, type: message.type, lastReceivedSequence: message.lastReceivedSequence, pendingActionIds: message.pendingActionIds } as SessionEngineEvent;
    case 'task.cancelled': return { ...meta, type: message.type, reason: message.reason } as SessionEngineEvent;
    default: return null;
  }
}

interface SocketLike {
  bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  ping(): void;
  on(event: 'message', listener: (data: unknown) => void): void;
  on(event: 'pong' | 'close', listener: () => void): void;
}

export async function registerAgentWebSocket(app: FastifyInstance, options: {
  tokenVerifier: ConnectionTokenVerifier;
  envelopeVerifier: EnvelopeSigner;
  engine: TransportEngine;
  recipientId: string;
  allowedOrigins: ReadonlySet<string>;
  now?: () => number;
  heartbeatTimeoutMs?: number;
  maxOutboundBytes?: number;
}): Promise<void> {
  await app.register(websocket);
  const authenticate = createConnectionAuthenticator({ verifier: options.tokenVerifier, now: options.now, allowedOrigins: options.allowedOrigins });
  const active = new Map<string, SocketLike>();
  app.get('/v1/agent', { websocket: true }, async (socketValue, request: FastifyRequest) => {
    const socket = socketValue as unknown as SocketLike;
    try {
      const query = request.query as { token?: string };
      const claims = await authenticate({ token: query.token, origin: header(request.headers.origin) });
      const old = active.get(claims.sessionId);
      if (old !== undefined) old.close(4001, 'connection lease replaced');
      active.set(claims.sessionId, socket);
      const session = new TransportSession({ claims, recipientId: options.recipientId, verifier: options.envelopeVerifier, engine: options.engine, now: options.now });
      let alive = true;
      const timer = setInterval(() => {
        if (!alive) { socket.close(4000, 'heartbeat timeout'); clearInterval(timer); return; }
        alive = false;
        socket.ping();
      }, options.heartbeatTimeoutMs ?? 30_000);
      timer.unref();
      socket.on('pong', () => { alive = true; });
      socket.on('message', (data) => {
        void session.receive(normalizeWire(data)).then((result) => {
          const body = JSON.stringify(result);
          if (socket.bufferedAmount + Buffer.byteLength(body) > (options.maxOutboundBytes ?? 1_000_000)) throw new TransportError('BACKPRESSURE', 'Outbound queue is full');
          socket.send(body);
        }).catch((error: unknown) => socket.close(closeCode(error), safeReason(error)));
      });
      socket.on('close', () => { clearInterval(timer); if (active.get(claims.sessionId) === socket) active.delete(claims.sessionId); });
    } catch (error) {
      socket.close(closeCode(error), safeReason(error));
    }
  });
}

function header(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
function normalizeWire(data: unknown): string | Uint8Array {
  if (typeof data === 'string' || data instanceof Uint8Array) return data;
  throw new TransportError('INVALID_WIRE', 'WebSocket frame must be text or binary');
}
function closeCode(error: unknown): number { return error instanceof ConnectionAuthError ? 4401 : error instanceof TransportError && error.code === 'RATE_LIMITED' ? 4429 : 4400; }
function safeReason(error: unknown): string { return error instanceof ConnectionAuthError || error instanceof TransportError ? error.code : 'INTERNAL_ERROR'; }
