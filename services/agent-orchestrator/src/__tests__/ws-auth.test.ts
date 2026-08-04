import { jest } from '@jest/globals';
import { createConnectionAuthenticator, InMemoryConnectionCredentialStore, type ConnectionTokenVerifier } from '../transport/auth.js';
import { createOrchestratorApp } from '../app.js';
import { connectionTokenFromProtocols } from '../transport/ws-server.js';
import { InMemorySessionStore } from '../engine/session-store.js';
import { InMemoryConnectionLeaseStore } from '../transport/ws-server.js';
import { createEnvelope, signEnvelope } from '@fara-platform/relay-protocol';
import { once } from 'node:events';

const now = 1_700_000_000_000;
const claims = {
  tenantId: 'tenant-a',
  deviceId: '50000000-0000-4000-8000-000000000001',
  sessionId: '10000000-0000-4000-8000-000000000001',
  audience: 'browser-extension' as const,
  expiresAt: now + 30_000,
  credentialId: 'credential-1',
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
    [{ deviceId: '50000000-0000-4000-8000-000000000002' }],
    [{ sessionId: '10000000-0000-4000-8000-000000000009' }],
  ])('rejects a token with the wrong tenant/device/session binding', async (expected) => {
    await expect(authenticate({ token: 'x', origin: 'chrome-extension://trusted-extension', expected }))
      .rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  test('exposes a minimal health endpoint without connection metadata', async () => {
    const app = await createOrchestratorApp({
      tokenVerifier: verifier,
      envelopeVerifier: { sign: async () => 'unused', verify: async () => true },
      createEngine: () => ({ handle: async () => { throw new Error('unused'); } }),
      store: new InMemorySessionStore(),
      leases: new InMemoryConnectionLeaseStore(),
      credentials: new InMemoryConnectionCredentialStore(),
      recipientId: '40000000-0000-4000-8000-000000000001',
      allowedOrigins: new Set(['chrome-extension://trusted-extension']),
    });
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  test('extracts the short-lived credential from WebSocket subprotocols, never a URL', () => {
    expect(connectionTokenFromProtocols('fara-v1, fara-credential.header.payload.signature')).toBe('header.payload.signature');
    expect(() => connectionTokenFromProtocols(undefined)).toThrow(expect.objectContaining({ code: 'TOKEN_REQUIRED' }));
  });

  test('atomically consumes a connection credential only once', async () => {
    const store = new InMemoryConnectionCredentialStore();
    await expect(store.consume(claims.credentialId, claims.expiresAt, now)).resolves.toBe(true);
    await expect(store.consume(claims.credentialId, claims.expiresAt, now + 1)).resolves.toBe(false);
  });

  test('wires the engine command sink to the authenticated socket', async () => {
    const observation = { observationId: '70000000-0000-4000-8000-000000000001', capturedAt: '2023-11-14T22:13:20.000Z', url: 'https://example.com', title: 'Example',
      screenshot: { kind: 'artifact' as const, artifactId: '71000000-0000-4000-8000-000000000001', sha256: 'a'.repeat(64), width: 1, height: 1, encoding: 'png' as const },
      viewport: { width: 1, height: 1, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 }, page: { tabId: '72000000-0000-4000-8000-000000000001', frameId: '73000000-0000-4000-8000-000000000001', lifecycle: 'complete' as const, visibility: 'visible' as const }, semanticTargets: [] };
    const action = { type: 'left_click' as const, x: 0, y: 0 };
    const command = { actionId: '74000000-0000-4000-8000-000000000001', stepId: '75000000-0000-4000-8000-000000000001', observationId: observation.observationId, sequence: 1, action,
      policyContext: { policyDecisionId: '76000000-0000-4000-8000-000000000001', policyVersion: 'v1', approved: false }, dispatchedAt: '2023-11-14T22:13:20.100Z', expiresAt: '2023-11-14T22:14:00.000Z', idempotencyKey: 'once' };
    const activeAction = { actionId: command.actionId, proposal: { kind: 'action' as const, observationId: observation.observationId, proposedAt: '2023-11-14T22:13:20.010Z', action },
      policyDecision: { policyDecisionId: command.policyContext.policyDecisionId, actionId: command.actionId, observationId: observation.observationId, decision: 'allowed' as const, decidedAt: '2023-11-14T22:13:20.050Z' }, command };
    let durableEvent: unknown;
    const store = { load: jest.fn(async () => ({ sessionId: claims.sessionId, activeAction })), admitInbound: async (input: { event: unknown }) => { durableEvent = input.event; return 'accepted' as const; }, loadInbound: async () => durableEvent, claimConnectionFence: async () => true };
    const envelopeSigner = { sign: jest.fn(async () => 'valid'), verify: async (_bytes: Uint8Array, signature: string) => signature === 'valid' };
    let engineSink: Parameters<NonNullable<Parameters<typeof createOrchestratorApp>[0]['createEngine']>>[0] | undefined;
    const handle = jest.fn(async (event: { messageId: string }) => { await engineSink!.send(command); return { kind: 'accepted' as const, sessionId: claims.sessionId, messageId: event.messageId, revision: 1, state: 'EXECUTING' as const, pendingActionIds: [command.actionId] }; });
    const app = await createOrchestratorApp({ tokenVerifier: { verify: async () => claims }, envelopeVerifier: envelopeSigner, store: store as never,
      leases: new InMemoryConnectionLeaseStore(), credentials: new InMemoryConnectionCredentialStore(), recipientId: '40000000-0000-4000-8000-000000000001',
      allowedOrigins: new Set(['chrome-extension://trusted-extension']), now: () => now,
      createEngine: (sink) => { engineSink = sink; return { handle: handle as never }; },
    });
    await app.ready();
    const socket = await app.injectWS('/v1/agent', { headers: { origin: 'chrome-extension://trusted-extension', 'sec-websocket-protocol': 'fara-v1, fara-credential.token' } });
    const inbound = await signEnvelope(createEnvelope({ messageId: '20000000-0000-4000-8000-000000000001', sessionId: claims.sessionId, correlationId: '30000000-0000-4000-8000-000000000001', causationId: '30000000-0000-4000-8000-000000000001', recipientId: '40000000-0000-4000-8000-000000000001', tenantId: claims.tenantId, deviceId: claims.deviceId, sequence: 1, createdAt: '2023-11-14T22:13:20.000Z', expiresAt: now + 30_000, payload: { type: 'observation.submitted', observation } }), envelopeSigner);
    const received = Promise.race([
      once(socket, 'message').then(([frame]) => ({ kind: 'message' as const, frame })),
      once(socket, 'close').then(([code, reason]) => ({ kind: 'close' as const, code, reason: String(reason) })),
      once(socket, 'error').then(([error]) => ({ kind: 'error' as const, error })),
    ]);
    socket.send(JSON.stringify(inbound));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(handle).toHaveBeenCalledTimes(1);
    expect(store.load).toHaveBeenCalled();
    expect(envelopeSigner.sign).toHaveBeenCalled();
    await expect(handle.mock.results[0]!.value).resolves.toMatchObject({ kind: 'accepted' });
    const event = await received;
    expect(event).toMatchObject({ kind: 'message' });
    expect(JSON.parse(String('frame' in event ? event.frame : '')).payload).toMatchObject({ type: 'action.command', command: { actionId: command.actionId } });
    const closed = once(socket, 'close');
    socket.terminate();
    await closed;
    await app.close();
  });
});
