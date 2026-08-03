import { jwtVerify, type JWTVerifyGetKey, type KeyLike } from 'jose';

export interface ConnectionClaims {
  tenantId: string;
  deviceId: string;
  sessionId: string;
  audience: 'browser-extension';
  expiresAt: number;
}

export interface ConnectionTokenVerifier {
  verify(token: string): Promise<ConnectionClaims>;
}

export class ConnectionAuthError extends Error {
  constructor(public readonly code: 'TOKEN_REQUIRED' | 'TOKEN_INVALID' | 'TOKEN_EXPIRED' | 'ORIGIN_REJECTED', message: string) {
    super(message);
    this.name = 'ConnectionAuthError';
  }
}

export class JoseConnectionTokenVerifier implements ConnectionTokenVerifier {
  constructor(private readonly key: KeyLike | Uint8Array | JWTVerifyGetKey) {}

  async verify(token: string): Promise<ConnectionClaims> {
    try {
      const result = typeof this.key === 'function'
        ? await jwtVerify(token, this.key, { audience: 'browser-extension' })
        : await jwtVerify(token, this.key, { audience: 'browser-extension' });
      const { tenantId, deviceId, sessionId, aud, exp } = result.payload;
      if (typeof tenantId !== 'string' || typeof deviceId !== 'string' || typeof sessionId !== 'string' || exp === undefined || (aud !== 'browser-extension' && !(Array.isArray(aud) && aud.includes('browser-extension')))) {
        throw new ConnectionAuthError('TOKEN_INVALID', 'Connection token claims are invalid');
      }
      return { tenantId, deviceId, sessionId, audience: 'browser-extension', expiresAt: exp * 1_000 };
    } catch (error) {
      if (error instanceof ConnectionAuthError) throw error;
      throw new ConnectionAuthError('TOKEN_INVALID', 'Connection token is invalid');
    }
  }
}

export interface AuthenticateConnectionInput {
  token?: string;
  origin?: string;
  expected?: Partial<Pick<ConnectionClaims, 'tenantId' | 'deviceId' | 'sessionId'>>;
}

export function createConnectionAuthenticator(options: {
  verifier: ConnectionTokenVerifier;
  now?: () => number;
  allowedOrigins: ReadonlySet<string>;
}): (input: AuthenticateConnectionInput) => Promise<Readonly<ConnectionClaims>> {
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
    if (claims.audience !== 'browser-extension') throw new ConnectionAuthError('TOKEN_INVALID', 'Connection token audience is invalid');
    if (claims.expiresAt <= now()) throw new ConnectionAuthError('TOKEN_EXPIRED', 'Connection token has expired');
    if (inputMismatch(claims, input.expected)) throw new ConnectionAuthError('TOKEN_INVALID', 'Connection token binding is invalid');
    return Object.freeze({ ...claims });
  };
}

function inputMismatch(claims: ConnectionClaims, expected: AuthenticateConnectionInput['expected']): boolean {
  return expected !== undefined && (
    (expected.tenantId !== undefined && expected.tenantId !== claims.tenantId) ||
    (expected.deviceId !== undefined && expected.deviceId !== claims.deviceId) ||
    (expected.sessionId !== undefined && expected.sessionId !== claims.sessionId)
  );
}
