import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
import { ConnectionAuthError, } from './auth.js';
export class JoseConnectionCredentialCodec {
    key;
    now;
    constructor(key, now = Date.now) {
        this.key = key;
        this.now = now;
    }
    async issue(claims) {
        return new SignJWT({
            tenantId: claims.tenantId,
            deviceId: claims.deviceId,
            sessionId: claims.sessionId,
        })
            .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
            .setAudience('browser-extension')
            .setJti(claims.credentialId)
            .setIssuedAt(Math.floor(this.now() / 1_000))
            .setExpirationTime(Math.floor(claims.expiresAt / 1_000))
            .sign(this.key);
    }
    async verify(token) {
        try {
            const verifyOptions = { audience: 'browser-extension', currentDate: new Date(this.now()) };
            const result = await jwtVerify(token, this.key, verifyOptions);
            const { tenantId, deviceId, sessionId, exp, jti } = result.payload;
            if (typeof tenantId !== 'string' || typeof deviceId !== 'string' ||
                typeof sessionId !== 'string' || typeof jti !== 'string' || exp === undefined)
                throw new ConnectionAuthError('TOKEN_INVALID', 'Connection token claims are invalid');
            return {
                tenantId,
                deviceId,
                sessionId,
                audience: 'browser-extension',
                expiresAt: exp * 1_000,
                credentialId: jti,
            };
        }
        catch (error) {
            if (error instanceof ConnectionAuthError)
                throw error;
            if (error instanceof joseErrors.JWTExpired) {
                throw new ConnectionAuthError('TOKEN_EXPIRED', 'Connection token has expired');
            }
            throw new ConnectionAuthError('TOKEN_INVALID', 'Connection token is invalid');
        }
    }
}
export function createHmacEnvelopeSigner(base64UrlKey) {
    const key = Buffer.from(base64UrlKey, 'base64url');
    if (key.byteLength < 32)
        throw new TypeError('Envelope HMAC key must contain at least 256 bits');
    return {
        sign: async (bytes) => createHmac('sha256', key).update(bytes).digest('base64url'),
        verify: async (bytes, signature) => {
            let supplied;
            try {
                supplied = Buffer.from(signature, 'base64url');
            }
            catch {
                return false;
            }
            const expected = createHmac('sha256', key).update(bytes).digest();
            return supplied.byteLength === expected.byteLength && timingSafeEqual(supplied, expected);
        },
    };
}
export class InMemoryBrowserSessionBootstrapBackend {
    sessions = new Map();
    credentials = new Map();
}
/** Explicit single-process development adapter. Production must use a shared durable store. */
export class InMemoryBrowserSessionBootstrapStore {
    now;
    backend;
    constructor(now = Date.now, backend = new InMemoryBrowserSessionBootstrapBackend()) {
        this.now = now;
        this.backend = backend;
    }
    async register(record) {
        this.purge();
        if (record.expiresAt <= this.now() || this.backend.sessions.has(record.sessionId) ||
            this.backend.credentials.has(record.credentialId))
            return false;
        const stored = { ...record, consumed: false };
        this.backend.sessions.set(record.sessionId, stored);
        this.backend.credentials.set(record.credentialId, record.sessionId);
        return true;
    }
    async consume(credentialId, expiresAt, now) {
        this.purge(now);
        const sessionId = this.backend.credentials.get(credentialId);
        const record = sessionId === undefined ? undefined : this.backend.sessions.get(sessionId);
        if (record === undefined || record.consumed || record.expiresAt !== expiresAt ||
            record.expiresAt <= now)
            return false;
        record.consumed = true;
        return true;
    }
    async resolve(claims) {
        this.purge();
        const record = this.backend.sessions.get(claims.sessionId);
        if (record === undefined || record.expiresAt <= this.now() ||
            record.tenantId !== claims.tenantId || record.deviceId !== claims.deviceId ||
            record.credentialId !== claims.credentialId || record.expiresAt !== claims.expiresAt)
            throw new ConnectionAuthError('TOKEN_INVALID', 'Bootstrap signer binding is invalid');
        return createHmacEnvelopeSigner(record.hmacKey);
    }
    purge(now = this.now()) {
        for (const [sessionId, record] of this.backend.sessions) {
            if (record.expiresAt > now)
                continue;
            this.backend.sessions.delete(sessionId);
            this.backend.credentials.delete(record.credentialId);
        }
    }
}
export async function registerBrowserSessionBootstrap(app, options) {
    const now = options.now ?? Date.now;
    const ttlMs = options.ttlMs ?? 30_000;
    if (!Number.isInteger(ttlMs) || ttlMs < 5_000 || ttlMs > 300_000) {
        throw new RangeError('Bootstrap TTL must be between 5 seconds and 5 minutes');
    }
    const publicUrl = new URL(options.publicWebSocketUrl);
    if (publicUrl.protocol !== 'wss:' || publicUrl.username !== '' || publicUrl.password !== '') {
        throw new TypeError('Bootstrap public WebSocket URL must use WSS without credentials');
    }
    const idGenerator = options.idGenerator ?? randomUUID;
    const hmacKeyGenerator = options.hmacKeyGenerator ?? (() => randomBytes(32).toString('base64url'));
    app.post('/v1...sessions', async (request, reply) => {
        const origin = header(request.headers.origin);
        if (origin === undefined || !options.allowedOrigins.has(origin)) {
            return reply.code(401).send({ error: 'DEVICE_BOOTSTRAP_REJECTED' });
        }
        let identity;
        try {
            identity = await options.authenticator.authenticate({
                authorization: header(request.headers.authorization),
                origin,
                body: request.body,
            });
        }
        catch {
            return reply.code(401).send({ error: 'DEVICE_BOOTSTRAP_REJECTED' });
        }
        if (!boundedIdentity(identity))
            return reply.code(401).send({ error: 'DEVICE_BOOTSTRAP_REJECTED' });
        const sessionId = idGenerator();
        const credentialId = idGenerator();
        const expiresAt = Math.floor((now() + ttlMs) / 1_000) * 1_000;
        const hmacKey = hmacKeyGenerator();
        createHmacEnvelopeSigner(hmacKey);
        const claims = {
            tenantId: identity.tenantId,
            deviceId: identity.deviceId,
            sessionId,
            audience: 'browser-extension',
            expiresAt,
            credentialId,
        };
        const credential = await options.credentialIssuer.issue(claims);
        if (!await options.sessions.register({ ...claims, hmacKey })) {
            return reply.code(409).send({ error: 'SESSION_ID_CONFLICT' });
        }
        reply.header('cache-control', 'no-store');
        return reply.code(201).send({
            serverUrl: publicUrl.href,
            connectionCredential: credential,
            serverRecipientId: options.recipientId,
            tenantId: identity.tenantId,
            deviceId: identity.deviceId,
            sessionId,
            expiresAt,
            hmacKey,
        });
    });
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function boundedIdentity(identity) {
    return identity.tenantId.length > 0 && identity.tenantId.length <= 256 && UUID.test(identity.deviceId);
}
function header(value) {
    return Array.isArray(value) ? value[0] : value;
}
//# sourceMappingURL=bootstrap.js.map