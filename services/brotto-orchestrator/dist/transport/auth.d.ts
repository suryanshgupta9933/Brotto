import { type JWTVerifyGetKey, type KeyLike } from 'jose';
export interface ConnectionClaims {
    tenantId: string;
    deviceId: string;
    sessionId: string;
    audience: 'browser-extension';
    expiresAt: number;
    credentialId: string;
}
export interface ConnectionTokenVerifier {
    verify(token: string): Promise<ConnectionClaims>;
}
export declare class ConnectionAuthError extends Error {
    readonly code: 'TOKEN_REQUIRED' | 'TOKEN_INVALID' | 'TOKEN_EXPIRED' | 'TOKEN_REPLAY' | 'ORIGIN_REJECTED';
    readonly statusCode = 401;
    constructor(code: 'TOKEN_REQUIRED' | 'TOKEN_INVALID' | 'TOKEN_EXPIRED' | 'TOKEN_REPLAY' | 'ORIGIN_REJECTED', message: string);
}
export declare class JoseConnectionTokenVerifier implements ConnectionTokenVerifier {
    private readonly key;
    constructor(key: KeyLike | Uint8Array | JWTVerifyGetKey);
    verify(token: string): Promise<ConnectionClaims>;
}
export interface ConnectionCredentialStore {
    consume(credentialId: string, expiresAt: number, now: number): Promise<boolean>;
}
export declare class InMemoryConnectionCredentialStore implements ConnectionCredentialStore {
    private readonly consumed;
    consume(credentialId: string, expiresAt: number, now: number): Promise<boolean>;
}
export interface AuthenticateConnectionInput {
    token?: string;
    origin?: string;
    expected?: Partial<Pick<ConnectionClaims, 'tenantId' | 'deviceId' | 'sessionId'>>;
}
export declare function createConnectionAuthenticator(options: {
    verifier: ConnectionTokenVerifier;
    now?: () => number;
    allowedOrigins: ReadonlySet<string>;
}): (input: AuthenticateConnectionInput) => Promise<Readonly<ConnectionClaims>>;
//# sourceMappingURL=auth.d.ts.map