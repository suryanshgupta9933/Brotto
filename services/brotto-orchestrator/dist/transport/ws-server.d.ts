import type { FastifyInstance } from 'fastify';
import { type AgentEnvelopeV1, type EnvelopeSigner } from '@brotto/relay-protocol';
import type { ActionCommandV1 } from '@brotto/brotto-action-schema';
import type { CommandSink, SessionEngineEvent, SessionStore, StoredOutcome, TerminalNotification, TerminalSink } from '../engine/types.js';
import { type ConnectionClaims, type ConnectionCredentialStore, type ConnectionTokenVerifier } from './auth.js';
export interface TransportEngine {
    handle(event: SessionEngineEvent): Promise<StoredOutcome>;
}
export declare class TransportError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export interface LeaseToken {
    sessionId: string;
    connectionId: string;
    fence: number;
    expiresAt: number;
}
export interface ConnectionLeaseStore {
    acquire(claims: Readonly<ConnectionClaims>, connectionId: string, expiresAt: number, now: number, claimFence?: (sessionId: string, fence: number) => Promise<boolean>): Promise<LeaseToken>;
    isOwner(sessionId: string, token: LeaseToken, now?: number): Promise<boolean>;
    renew(token: LeaseToken, expiresAt: number, now: number): Promise<LeaseToken | null>;
    release(token: LeaseToken): Promise<void>;
    runIfOwner<T>(token: LeaseToken, now: number, work: () => Promise<T>): Promise<T>;
}
/** Test/dev adapter. Production deployments inject a durable Redis/SQL implementation. */
export declare class InMemoryConnectionLeaseBackend {
    readonly leases: Map<string, LeaseToken>;
    readonly fenceCounters: Map<string, number>;
    gate: Promise<void>;
}
export declare class InMemoryConnectionLeaseStore implements ConnectionLeaseStore {
    private readonly backend;
    constructor(backend?: InMemoryConnectionLeaseBackend);
    private exclusive;
    acquire(claims: Readonly<ConnectionClaims>, connectionId: string, expiresAt: number, now: number, claimFence?: (sessionId: string, fence: number) => Promise<boolean>): Promise<LeaseToken>;
    isOwner(sessionId: string, token: LeaseToken, now?: number): Promise<boolean>;
    release(token: LeaseToken): Promise<void>;
    renew(token: LeaseToken, expiresAt: number, now: number): Promise<LeaseToken | null>;
    runIfOwner<T>(token: LeaseToken, now: number, work: () => Promise<T>): Promise<T>;
}
export declare class OrderedOutboundQueue {
    private readonly options;
    private readonly pending;
    private pendingBytes;
    private pumping;
    private drainWaiters;
    constructor(options: {
        maxBytes: number;
        send(value: string): Promise<void>;
    });
    enqueue(value: string): Promise<void>;
    drained(): Promise<void>;
    private pump;
}
export type TransportResult = {
    kind: 'heartbeat';
} | {
    kind: 'duplicate';
} | {
    kind: 'outcome';
    outcome: StoredOutcome;
    responseWire?: string;
};
export declare class TransportSession {
    private readonly options;
    private readonly ingress;
    private rate;
    private readonly now;
    constructor(options: {
        claims: Readonly<ConnectionClaims>;
        recipientId: string;
        verifier: EnvelopeSigner;
        engine: TransportEngine;
        store?: SessionStore;
        now?: () => number;
        maxWireBytes?: number;
        maxMessagesPerMinute?: number;
        maxBytesPerMinute?: number;
    });
    registerOutbound(envelope: AgentEnvelopeV1): void;
    receive(raw: string | Uint8Array, connectionFence?: number): Promise<TransportResult>;
    private reconcileWire;
    private charge;
}
export interface ConnectionEnvelopeSignerResolver {
    resolve(claims: Readonly<ConnectionClaims>): Promise<EnvelopeSigner>;
}
export interface OutboundConnection {
    claims: Readonly<ConnectionClaims>;
    session: TransportSession;
    queue: OrderedOutboundQueue;
    signer?: EnvelopeSigner;
}
export declare class AgentTransportHub implements CommandSink, TerminalSink {
    private readonly store;
    private readonly defaultSigner?;
    private readonly now;
    private readonly connections;
    constructor(store: SessionStore, defaultSigner?: EnvelopeSigner | undefined, now?: () => number);
    attach(connection: OutboundConnection): () => void;
    send(command: ActionCommandV1): Promise<void>;
    sendTerminal(notification: TerminalNotification): Promise<void>;
    private findSession;
}
declare module '../engine/types.js' {
    interface SessionStore {
        loadByAction?(actionId: ActionCommandV1['actionId']): Promise<CanonicalSession | null>;
    }
}
export declare function connectionTokenFromProtocols(headerValue: string | undefined): string;
export declare function registerAgentWebSocket(app: FastifyInstance, options: {
    tokenVerifier: ConnectionTokenVerifier;
    envelopeVerifier?: EnvelopeSigner;
    envelopeSignerResolver?: ConnectionEnvelopeSignerResolver;
    engine: TransportEngine;
    store: SessionStore;
    leases: ConnectionLeaseStore;
    credentials: ConnectionCredentialStore;
    recipientId: string;
    allowedOrigins: ReadonlySet<string>;
    hub?: AgentTransportHub;
    now?: () => number;
    heartbeatTimeoutMs?: number;
    maxOutboundBytes?: number;
}): Promise<void>;
//# sourceMappingURL=ws-server.d.ts.map