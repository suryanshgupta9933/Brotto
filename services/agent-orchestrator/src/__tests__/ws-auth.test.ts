import { jest } from '@jest/globals';
import { createConnectionAuthenticator, type ConnectionTokenVerifier } from '../transport/auth.js';
import { createOrchestratorApp } from '../app.js';

const now = 1_700_000_000_000;
const claims = {
  tenantId: 'tenant-a',
  deviceId: 'device-a',
  sessionId: '10000000-0000-4000-8000-000000000001',
  audience: 'browser-extension' as const,
  expiresAt: now + 30_000,
};

describe('connection authentication', () => {
  const verifier: ConnectionTokenVerifier = { verify: jest.fn(async () => claims) };
  const authenticate = createConnectionAuthenticator({
    verifier,
    now: () => now,
    allowedOrigins: new Set(['chrome-extension://trusted-extension']),
  });

  test('rejects a missing token', async () => {
    await expect(authenticate({ token: undefined, origin: 'chrome-extension://trusted-extension' }))
      .rejects.toMatchObject({ code: 'TOKEN_REQUIRED' });
  });

  test('rejects expired claims and an invalid origin', async () => {
    const expired: ConnectionTokenVerifier = { verify: async () => ({ ...claims, expiresAt: now }) };
    await expect(createConnectionAuthenticator({ verifier: expired, now: () => now, allowedOrigins: new Set(['chrome-extension://trusted-extension']) })({ token: 'x', origin: 'chrome-extension://trusted-extension' }))
      .rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    await expect(authenticate({ token: 'x', origin: 'https://evil.example' }))
      .rejects.toMatchObject({ code: 'ORIGIN_REJECTED' });
  });

  test('returns immutable claims without browser credentials', async () => {
    await expect(authenticate({ token: 'x', origin: 'chrome-extension://trusted-extension' }))
      .resolves.toEqual(claims);
  });

  test.each([
    [{ tenantId: 'tenant-b' }],
    [{ deviceId: 'device-b' }],
    [{ sessionId: '10000000-0000-4000-8000-000000000009' }],
  ])('rejects a token with the wrong tenant/device/session binding', async (expected) => {
    await expect(authenticate({ token: 'x', origin: 'chrome-extension://trusted-extension', expected }))
      .rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  test('exposes a minimal health endpoint without connection metadata', async () => {
    const app = await createOrchestratorApp({
      tokenVerifier: verifier,
      envelopeVerifier: { sign: async () => 'unused', verify: async () => true },
      engine: { handle: async () => { throw new Error('unused'); } },
      recipientId: '40000000-0000-4000-8000-000000000001',
      allowedOrigins: new Set(['chrome-extension://trusted-extension']),
    });
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
