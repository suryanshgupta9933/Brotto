import { once } from 'node:events';
import {
  InMemoryBrowserSessionBootstrapStore,
  InMemoryConnectionLeaseStore,
  InMemorySessionStore,
  JoseConnectionCredentialCodec,
  createHmacEnvelopeSigner,
  createOrchestratorApp,
  PolicyAdapter,
  TransportSession,
  type DeviceBootstrapAuthenticator,
  type PolicyInput,
} from '@fara/agent-orchestrator';
import {
  SecureAgentIngress,
  createEnvelope,
  signEnvelope,
} from '@fara-platform/relay-protocol';
import {
  ForbiddenBrowserDataError,
  assertNoForbiddenBrowserData,
  type ActionProposalV1,
  type ObservationV1,
} from '@fara-platform/fara-action-schema';
import { ClientPolicy } from '../../clients/browser-extension/src/canonical/client-policy.js';
import { captureObservation } from '../../clients/browser-extension/src/canonical/observation.js';
import { IDS, observation } from './helpers/fakes.js';

const DEVICE_ID = '30000000-0000-4000-8000-000000000001';
const SERVER_ID = '30000000-0000-4000-8000-000000000002';
const ORIGIN = 'chrome-extension://trusted-extension';

describe('authenticated browser session bootstrap', () => {
  test('binds a one-time credential and HMAC signer from bootstrap through signed WSS', async () => {
    let now = Date.parse('2026-08-04T10:00:00.000Z');
    const jwtKey = new TextEncoder().encode('0123456789abcdef0123456789abcdef');
    const codec = new JoseConnectionCredentialCodec(jwtKey, () => now);
    const sessions = new InMemoryBrowserSessionBootstrapStore(() => now);
    const authenticator: DeviceBootstrapAuthenticator = {
      authenticate: async (input) => {
        if (input.authorization !== 'Pairing device-proof') throw new Error('device proof rejected');
        return { tenantId: 'tenant-a', deviceId: DEVICE_ID };
      },
    };
    const handled: Array<{ messageId: string; sessionId: string }> = [];
    const handle = async (event: { messageId: string; sessionId: string }) => {
      handled.push(event);
      return {
      kind: 'accepted' as const,
      sessionId: event.sessionId as never,
      messageId: event.messageId as never,
      revision: 1,
      state: 'OBSERVING' as const,
      pendingActionIds: [],
      };
    };
    const app = await createOrchestratorApp({
      tokenVerifier: codec,
      envelopeSignerResolver: sessions,
      createEngine: () => ({ handle: handle as never }),
      store: new InMemorySessionStore(),
      leases: new InMemoryConnectionLeaseStore(),
      credentials: sessions,
      recipientId: SERVER_ID,
      allowedOrigins: new Set([ORIGIN]),
      now: () => now,
      bootstrap: {
        authenticator,
        credentialIssuer: codec,
        sessions,
        publicWebSocketUrl: 'wss://agent.example.test/v1/agent',
      },
    });
    await app.ready();

    const denied = await app.inject({
      method: 'POST', url: '/v1/browser-extension/sessions',
      headers: { origin: ORIGIN, authorization: 'Pairing wrong-proof' },
      payload: {},
    });
    expect(denied.statusCode).toBe(401);
    const wrongOrigin = await app.inject({
      method: 'POST', url: '/v1/browser-extension/sessions',
      headers: { origin: 'https://evil.example', authorization: 'Pairing device-proof' },
      payload: {},
    });
    expect(wrongOrigin.statusCode).toBe(401);

    const response = await app.inject({
      method: 'POST', url: '/v1/browser-extension/sessions',
      headers: { origin: ORIGIN, authorization: 'Pairing device-proof' },
      payload: {},
    });
    expect(response.statusCode).toBe(201);
    const material = response.json<{
      serverUrl: string; connectionCredential: string; serverRecipientId: string;
      tenantId: string; deviceId: string; sessionId: string; expiresAt: number; hmacKey: string;
    }>();
    expect(material).toMatchObject({
      serverUrl: 'wss://agent.example.test/v1/agent', serverRecipientId: SERVER_ID,
      tenantId: 'tenant-a', deviceId: DEVICE_ID,
    });
    expect(JSON.stringify(material).toLowerCase()).not.toMatch(/cookie|authorization|localstorage|sessionstorage|password|profile/);
    await expect(sessions.resolve({
      tenantId: material.tenantId,
      deviceId: '30000000-0000-4000-8000-000000000099',
      sessionId: material.sessionId,
      audience: 'browser-extension',
      expiresAt: material.expiresAt,
      credentialId: (await codec.verify(material.connectionCredential)).credentialId,
    })).rejects.toMatchObject({ code: 'TOKEN_INVALID' });

    const socket = await app.injectWS('/v1/agent', { headers: {
      origin: ORIGIN,
      'sec-websocket-protocol': `fara-v1, fara-credential.${material.connectionCredential}`,
    } });
    const signer = createHmacEnvelopeSigner(material.hmacKey);
    const opened = await signEnvelope(createEnvelope({
      messageId: '31000000-0000-4000-8000-000000000001',
      sessionId: material.sessionId,
      correlationId: '31000000-0000-4000-8000-000000000002',
      causationId: '31000000-0000-4000-8000-000000000002',
      recipientId: SERVER_ID,
      tenantId: material.tenantId,
      deviceId: material.deviceId,
      sequence: 1,
      createdAt: new Date(now).toISOString(),
      expiresAt: now + 30_000,
      payload: { type: 'session.open', client: 'browser_extension', goal: 'Verify signed bootstrap' },
    }), signer);
    socket.send(JSON.stringify(opened));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(handled).toHaveLength(1);

    await expect(app.injectWS('/v1/agent', { headers: {
      origin: ORIGIN,
      'sec-websocket-protocol': `fara-v1, fara-credential.${material.connectionCredential}`,
    } })).rejects.toThrow(/Unexpected server response: 401/);

    now = material.expiresAt;
    await expect(codec.verify(material.connectionCredential)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    socket.terminate();
    await app.close();
  });
});

describe('authenticated protocol attack matrix', () => {
  const now = Date.parse('2026-08-04T10:00:00.000Z');
  const signer = createHmacEnvelopeSigner(Buffer.alloc(32, 7).toString('base64url'));
  const claims = {
    tenantId: 'tenant-a', deviceId: DEVICE_ID,
    sessionId: '32000000-0000-4000-8000-000000000001',
    audience: 'browser-extension' as const,
    expiresAt: now + 60_000, credentialId: 'credential-a',
  };
  const envelope = (overrides: Record<string, unknown> = {}) => createEnvelope({
    messageId: '32000000-0000-4000-8000-000000000002',
    sessionId: claims.sessionId,
    correlationId: '32000000-0000-4000-8000-000000000003',
    causationId: '32000000-0000-4000-8000-000000000003',
    recipientId: SERVER_ID,
    tenantId: claims.tenantId,
    deviceId: claims.deviceId,
    sequence: 1,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + 30_000,
    payload: { type: 'heartbeat', sentAt: new Date(now).toISOString() },
    ...overrides,
  } as never);

  test('rejects malformed, expired, oversized, unsigned, forged, recipient, and replay attacks before routing', async () => {
    const ingress = () => new SecureAgentIngress({
      now: () => now, maxBytes: 2_000_000, expectedRecipientId: SERVER_ID, verifier: signer,
    });
    await expect(ingress().accept('{not json')).resolves.toMatchObject({ status: 'rejected', code: 'INVALID_WIRE' });
    await expect(ingress().accept(JSON.stringify(envelope()))).resolves.toMatchObject({ status: 'rejected', code: 'SIGNATURE_REQUIRED' });

    const forged = await signEnvelope(envelope(), signer);
    await expect(ingress().accept(JSON.stringify({ ...forged, signature: 'forged' })))
      .resolves.toMatchObject({ status: 'rejected', code: 'SIGNATURE_INVALID' });
    await expect(ingress().accept(JSON.stringify(await signEnvelope(envelope({
      createdAt: new Date(now - 60_000).toISOString(), expiresAt: now - 1,
    }), signer))))
      .resolves.toMatchObject({ status: 'rejected', code: 'MESSAGE_EXPIRED' });
    await expect(ingress().accept(JSON.stringify(await signEnvelope(envelope({ recipientId: DEVICE_ID }), signer))))
      .resolves.toMatchObject({ status: 'rejected', code: 'RECIPIENT_MISMATCH' });

    const tooSmall = new SecureAgentIngress({ now: () => now, maxBytes: 1, expectedRecipientId: SERVER_ID, verifier: signer });
    await expect(tooSmall.accept(JSON.stringify(forged))).resolves.toMatchObject({ status: 'rejected', code: 'MESSAGE_TOO_LARGE' });

    const replay = ingress();
    await expect(replay.accept(JSON.stringify(forged))).resolves.toMatchObject({ status: 'accepted' });
    await expect(replay.accept(JSON.stringify(forged))).resolves.toMatchObject({ status: 'duplicate' });
    await expect(replay.accept(JSON.stringify(await signEnvelope(envelope({
      messageId: '32000000-0000-4000-8000-000000000004',
    }), signer)))).resolves.toMatchObject({ status: 'rejected', code: 'SEQUENCE_REPLAY' });
  });

  test.each([
    ['tenantId', 'tenant-b'],
    ['deviceId', '30000000-0000-4000-8000-000000000099'],
    ['sessionId', '32000000-0000-4000-8000-000000000099'],
  ])('rejects a signed envelope with the wrong %s binding', async (field, value) => {
    const session = new TransportSession({
      claims, recipientId: SERVER_ID, verifier: signer,
      engine: { handle: async () => { throw new Error('must not route'); } },
      now: () => now,
    });
    const signed = await signEnvelope(envelope({ [field]: value }), signer);
    await expect(session.receive(JSON.stringify(signed))).rejects.toMatchObject({ code: 'CLAIM_MISMATCH' });
  });
});

describe('privacy and policy defense in depth', () => {
  test.each(['cookie', 'authorization', 'localStorage', 'sessionStorage', 'password', 'profile'])
  ('rejects forbidden %s data at arbitrary nested array depth', (marker) => {
    expect(() => assertNoForbiddenBrowserData({ safe: [{ nested: [{ [marker]: 'secret' }] }] }))
      .toThrow(ForbiddenBrowserDataError);
  });

  test('denies unsafe/private/rebound destinations on the server and again on the client', async () => {
    const observed = observation({
      observationId: IDS.observationBlank,
      capturedAt: '2026-08-04T10:00:00.000Z',
      url: 'https://public.example/start', title: 'Start',
    });
    const proposal = (url: string): ActionProposalV1 => ({
      kind: 'action', observationId: observed.observationId,
      proposedAt: '2026-08-04T10:00:01.000Z', action: { type: 'visit_url', url },
    });
    const input = (value: ActionProposalV1): PolicyInput => ({
      workId: '33000000-0000-4000-8000-000000000001',
      sessionId: IDS.session, taskId: IDS.task,
      actionId: '33000000-0000-4000-8000-000000000002' as never,
      policyDecisionId: '33000000-0000-4000-8000-000000000003' as never,
      proposal: value, observation: observed,
    });
    const rebound = new PolicyAdapter({
      hostResolver: { resolve: async () => ['93.184.216.34', '169.254.169.254'] },
    });
    expect((await rebound.evaluate(input(proposal('https://public.example/resource')), new AbortController().signal)).decision).toBe('denied');
    const unsafe = proposal('https://public.example');
    (unsafe.action as { url: string }).url = 'javascript:alert(1)';
    expect((await new PolicyAdapter().evaluate(input(unsafe), new AbortController().signal)).decision).toBe('denied');

    const client = new ClientPolicy();
    expect(client.evaluate({
      action: { type: 'visit_url', url: 'http://169.254.169.254/latest/meta-data' },
      observationId: observed.observationId,
      policyContext: { policyDecisionId: input(proposal('https://public.example')).policyDecisionId, policyVersion: 'v1', approved: false },
    }, {
      tabId: 42, attachedTabIds: new Set([42]), approvedApprovalIds: new Set(),
      observation: observed,
    }).code).toBe('PRIVATE_NETWORK_DENIED');
  });

  test('requires locally retained approval proof and binds it to the current tab observation', () => {
    const target = {
      targetId: IDS.target, tag: 'button', role: 'button',
      accessibleName: { source: 'visible_text' as const, text: 'Buy now' },
      control: { kind: 'non_input' as const }, boundingBox: { x: 0, y: 0, width: 100, height: 50 },
      visible: true, framePath: [], locatorCandidates: [],
    };
    const observed = observation({ observationId: IDS.observationTarget, capturedAt: '2026-08-04T10:00:00.000Z', url: 'https://shop.example/checkout', title: 'Checkout', semanticTargets: [target] });
    const policy = new ClientPolicy();
    const base = {
      action: { type: 'left_click' as const, x: 10, y: 10, targetId: IDS.target },
      observationId: observed.observationId,
      policyContext: { policyDecisionId: '34000000-0000-4000-8000-000000000001', policyVersion: 'v1', approved: true, approvalId: '34000000-0000-4000-8000-000000000002' },
    };
    const context = { tabId: 42, attachedTabIds: new Set([42]), observation: observed };
    expect(policy.evaluate(base, { ...context, approvedApprovalIds: new Set() }).code).toBe('APPROVAL_PROOF_INVALID');
    expect(policy.evaluate(base, { ...context, approvedApprovalIds: new Set([base.policyContext.approvalId]) }).decision).toBe('allowed');
    expect(policy.evaluate({ ...base, observationId: IDS.observationBlank }, { ...context, approvedApprovalIds: new Set([base.policyContext.approvalId]) }).code).toBe('STALE_OBSERVATION');
  });

  test('captures one exact active tab/main frame and emits only opaque IDs plus a bounded screenshot', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7+XIAAAAASUVORK5CYII=';
    const snapshot = {
      url: 'https://example.test/', title: 'Example',
      viewport: { width: 1, height: 1, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
      readyState: 'complete', visibility: 'visible', documentToken: 'document-1',
      domScanComplete: true, sensitiveRegionOverflow: false, sensitiveRegions: [], semanticTargets: [],
    };
    const captured = await captureObservation(42, {
      captureVisibleTab: async (tabId, windowId) => {
        expect([tabId, windowId]).toEqual([42, 7]);
        return `data:image/png;base64,${png}`;
      },
      getTabIdentity: async () => ({ id: 42, windowId: 7, active: true }),
      getZoom: async () => 1,
      maskScreenshot: async ({ pngBytes }) => pngBytes,
      now: () => new Date('2026-08-04T10:00:00.000Z'),
      sendCdpCommand: async (_tabId, method) => method === 'Page.getFrameTree'
        ? { frameTree: { frame: { id: 'raw-main-frame' } } }
        : { result: { value: snapshot } },
    });
    expect(captured.page.tabId).not.toContain('42');
    expect(captured.page.frameId).not.toContain('raw-main-frame');
    expect(captured.screenshot).toMatchObject({ kind: 'inline', width: 1, height: 1, encoding: 'png' });
    expect(JSON.stringify(captured)).not.toContain('document-1');
  });

  test('rejects an oversized screenshot before any observation can leave the client', async () => {
    const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7+XIAAAAASUVORK5CYII=', 'base64');
    pngBytes.writeUInt32BE(20_000, 16);
    const snapshot = {
      url: 'https://example.test/', title: 'Example',
      viewport: { width: 1, height: 1, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
      readyState: 'complete', visibility: 'visible', documentToken: 'document-1',
      domScanComplete: true, sensitiveRegionOverflow: false, sensitiveRegions: [], semanticTargets: [],
    };
    await expect(captureObservation(42, {
      captureVisibleTab: async () => `data:image/png;base64,${pngBytes.toString('base64')}`,
      getTabIdentity: async () => ({ id: 42, windowId: 7, active: true }),
      getZoom: async () => 1,
      maskScreenshot: async ({ pngBytes: value }) => value,
      sendCdpCommand: async (_tabId, method) => method === 'Page.getFrameTree'
        ? { frameTree: { frame: { id: 'main-frame' } } }
        : { result: { value: snapshot } },
    })).rejects.toThrow(/dimension|pixel/i);
  });
});
