import type { FastifyInstance } from 'fastify';
import type { EnvelopeSigner } from '@brotto/relay-protocol';
import { type ConnectionClaims, type ConnectionCredentialStore, type ConnectionTokenVerifier } from './auth.js';
export interface DeviceBootstrapIdentity {
    tenantId: string;
    deviceId: string;
}
export interface DeviceBootstrapInput {
    authorization?: string;
    origin?: string;
    body: unknown;
}
export interface DeviceBootstrapAuthenticator {
    authenticate(input: DeviceBootstrapInput): Promise<DeviceBootstrapIdentity>;
}
export interface ConnectionCredentialIssuer {
    issue(claims: ConnectionClaims): Promise<string>;
}
export interface BrowserSessionRegistration {
    tenantId: string;
    deviceId: string;
    sessionId: string;
    credentialId: string;
    expiresAt: number;
    hmacKey: string;
}
export interface BrowserSessionBootstrapStore extends ConnectionCredentialStore {
    register(record: BrowserSessionRegistration): Promise<boolean>;
    resolve(claims: Readonly<ConnectionClaims>): Promise<EnvelopeSigner>;
}
export interface BrowserSessionBootstrapOptions {
    authenticator: DeviceBootstrapAuthenticator;
    credentialIssuer: ConnectionCredentialIssuer;
    sessions: BrowserSessionBootstrapStore;
    publicWebSocketUrl: string;
    ttlMs?: number;
    idGenerator?: () => string;
    hmacKeyGenerator?: () => string;
}
export declare class JoseConnectionCredentialCodec implements ConnectionCredentialIssuer, ConnectionTokenVerifier {
    private readonly key;
    private readonly now;
    constructor(key: Uint8Array, now?: () => number);
    issue(claims: ConnectionClaims): Promise<string>;
    verify(token: string): Promise<ConnectionClaims>;
}
export declare function createHmacEnvelopeSigner(base64UrlKey: string): EnvelopeSigner;
export declare class InMemoryBrowserSessionBootstrapBackend {
    readonly sessions: Map<string, BrowserSessionRegistration & {
        consumed: boolean;
    }>;
    readonly credentials: Map<string, string>;
}
/** Explicit single-process development adapter. Production must use a shared durable store. */
export declare class InMemoryBrowserSessionBootstrapStore implements BrowserSessionBootstrapStore {
    private readonly now;
    private readonly backend;
    constructor(now?: () => number, backend?: InMemoryBrowserSessionBootstrapBackend);
    register(record: BrowserSessionRegistration): Promise<boolean>;
    consume(credentialId: string, expiresAt: number, now: number): Promise<boolean>;
    resolve(claims: Readonly<ConnectionClaims>): Promise<EnvelopeSigner>;
    private purge;
}
export declare function registerBrowserSessionBootstrap(app: FastifyInstance, options: BrowserSessionBootstrapOptions & {
    recipientId: string;
    allowedOrigins: ReadonlySet<string>;
    now?: () => number;
}): Promise<void>;
//# sourceMappingURL=bootstrap.d.ts.map