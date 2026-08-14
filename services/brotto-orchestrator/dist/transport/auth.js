import { errors as joseErrors, jwtVerify } from 'jose';
export class ConnectionAuthError extends Error {
    code;
    statusCode = 401;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'ConnectionAuthError';
    }
}
export class JoseConnectionTokenVerifier {
    key;
    constructor(key) {
        this.key = key;
    }
    async verify(token) {
        try {
            const result = typeof this.key === 'function'
                ? await jwtVerify(token, this.key, { audience: 'browser-extension' })
                : await jwtVerify(token, this.key, { audience: 'browser-extension' });
            const { tenantId, deviceId, sessionId, aud, exp, jti } = result.payload;
            if (typeof tenantId !== 'string' || typeof deviceId !== 'string' || typeof sessionId !== 'string' || typeof jti !== 'string' || exp === undefined || (aud !== 'browser-extension' && !(Array.isArray(aud) && aud.includes('browser-extension')))) {
                throw new ConnectionAuthError('TOKEN_INVALID', 'Connection token claims are invalid');
            }
            return { tenantId, deviceId, sessionId, audience: 'browser-extension', expiresAt: exp * 1_000, credentialId: jti };
        }
        catch (error) {
            if (error instanceof ConnectionAuthError)
                throw error;
            if (error instanceof joseErrors.JWTExpired)
                throw new ConnectionAuthError('TOKEN_EXPIRED', 'Connection token has expired');
            throw new ConnectionAuthError('TOKEN_INVALID', 'Connection token is invalid');
        }
    }
}
export class InMemoryConnectionCredentialStore {
    consumed = new Map();
    async consume(credentialId, expiresAt, now) {
        for (const [id, expiry] of this.consumed)
            if (expiry <= now)
                this.consumed.delete(id);
        if (this.consumed.has(credentialId))
            return false;
        this.consumed.set(credentialId, expiresAt);
        return true;
    }
}
export function createConnectionAuthenticator(options) {
    const now = options.now ?? Date.now;
    return async (input) => {
        const { token, origin } = input;
        if (origin === undefined || !options.allowedOrigins.has(origin)) {
            throw new ConnectionAuthError('ORIGIN_REJECTED', 'WebSocket origin is not allowed');
        }
        if (token === undefined || token.length === 0) {
            throw new ConnectionAuthError('TOKEN_REQUIRED', 'A connection token is required');
        }
        const claims = await options.verifier.verify(token);
        if (!validClaims(claims))
            throw new ConnectionAuthError('TOKEN_INVALID', 'Connection token claims are invalid');
        if (claims.audience !== 'browser-extension')
            throw new ConnectionAuthError('TOKEN_INVALID', 'Connection token audience is invalid');
        if (claims.expiresAt <= now())
            throw new ConnectionAuthError('TOKEN_EXPIRED', 'Connection token has expired');
        if (inputMismatch(claims, input.expected))
            throw new ConnectionAuthError('TOKEN_INVALID', 'Connection token binding is invalid');
        return Object.freeze({ ...claims });
    };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validClaims(claims) {
    return claims.tenantId.length > 0 && claims.tenantId.length <= 256 && UUID.test(claims.deviceId) &&
        UUID.test(claims.sessionId) && claims.credentialId.length > 0 && claims.credentialId.length <= 256;
}
function inputMismatch(claims, expected) {
    return expected !== undefined && ((expected.tenantId !== undefined && expected.tenantId !== claims.tenantId) ||
        (expected.deviceId !== undefined && expected.deviceId !== claims.deviceId) ||
        (expected.sessionId !== undefined && expected.sessionId !== claims.sessionId));
}
//# sourceMappingURL=auth.js.map