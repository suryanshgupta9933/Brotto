import { jest } from '@jest/globals';
import type { EnvelopeSigner } from '@fara-platform/relay-protocol';
import { createEnvelope, signEnvelope } from '@fara-platform/relay-protocol';
import { AgentTransportHub, InMemoryConnectionLeaseStore, OrderedOutboundQueue, TransportSession, type TransportEngine } from '../transport/ws-server.js';

const ids = {
  session: '10000000-0000-4000-8000-000000000001',
  message: '20000000-0000-4000-8000-000000000001',
  correlation: '30000000-0000-4000-8000-000000000001',
  recipient: '40000000-0000-4000-8000-000000000001',
};
const signer: EnvelopeSigner = {
  sign: async () => 'valid',
  verify: async (_bytes, signature) => signature === 'valid',
};
const claims = { tenantId: 'tenant-a', deviceId: '50000000-0000-4000-8000-000000000001', sessionId: ids.session, audience: 'browser-extension' as const, expiresAt: 1_700_000_030_000, credentialId: 'credential-1' };

async function wire(sequence: number, payload: Parameters<typeof createEnvelope>[0]['payload'], messageId = ids.message, binding: { tenantId?: string; deviceId?: string; sessionId?: string } = {}): Promise<string> {
  return JSON.stringify(await signEnvelope(createEnvelope({
    messageId,
    sessionId: binding.sessionId ?? ids.session,
    correlationId: ids.correlation,
    causationId: ids.correlation,
    recipientId: ids.recipient,
    sequence,
    createdAt: '2023-11-14T22:13:20.000Z',
    expiresAt: 1_700_000_030_000,
    tenantId: binding.tenantId ?? claims.tenantId,
    deviceId: binding.deviceId ?? claims.deviceId,
    payload,
  }), signer));
}

describe('websocket reconciliation transport', () => {
  test('registers a server command as flow authority and routes its client completion', async () => {
    const observation = {
      observationId: '70000000-0000-4000-8000-000000000001', capturedAt: '2023-11-14T22:13:20.000Z', url: 'https://example.com', title: 'Example',
      screenshot: { kind: 'artifact' as const, artifactId: '71000000-0000-4000-8000-000000000001', sha256: 'a'.repeat(64), width: 1, height: 1, encoding: 'png' as const },
      viewport: { width: 1, height: 1, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
      page: { tabId: '72000000-0000-4000-8000-000000000001', frameId: '73000000-0000-4000-8000-000000000001', lifecycle: 'complete' as const, visibility: 'visible' as const }, semanticTargets: [],
    };
    const action = { type: 'left_click' as const, x: 0, y: 0 };
    const command = { actionId: '74000000-0000-4000-8000-000000000001', stepId: '75000000-0000-4000-8000-000000000001', observationId: observation.observationId, sequence: 1, action,
      policyContext: { policyDecisionId: '76000000-0000-4000-8000-000000000001', policyVersion: 'v1', approved: false }, dispatchedAt: '2023-11-14T22:13:20.100Z', expiresAt: '2023-11-14T22:14:00.000Z', idempotencyKey: 'once' };
    const commandMessage = { type: 'action.command' as const, proposal: { kind: 'action' as const, observationId: observation.observationId, proposedAt: '2023-11-14T22:13:20.010Z', action },
      policyDecision: { policyDecisionId: command.policyContext.policyDecisionId, actionId: command.actionId, observationId: observation.observationId, decision: 'allowed' as const, decidedAt: '2023-11-14T22:13:20.050Z' }, command };
    const engine: TransportEngine = { handle: jest.fn(async (event) => ({ kind: 'accepted', sessionId: ids.session, messageId: event.messageId, revision: 1, state: 'EXECUTING', pendingActionIds: [] })) };
    const session = new TransportSession({ claims, recipientId: ids.recipient, verifier: signer, engine, now: () => 1_700_000_000_000 });
    await session.receive(await wire(1, { type: 'observation.submitted', observation }, '21000000-0000-4000-8000-000000000001'));
    session.registerOutbound(createEnvelope({ messageId: '22000000-0000-4000-8000-000000000001', sessionId: ids.session, correlationId: ids.correlation, causationId: ids.correlation, recipientId: claims.deviceId, tenantId: claims.tenantId, deviceId: claims.deviceId, sequence: 1, createdAt: '2023-11-14T22:13:20.000Z', expiresAt: 1_700_000_030_000, payload: commandMessage }));
    const sent: string[] = [];
    const store = { load: async () => ({ sessionId: ids.session, activeAction: { proposal: commandMessage.proposal, policyDecision: commandMessage.policyDecision, command, actionId: command.actionId } }) };
    const hub = new AgentTransportHub(store as never, signer, () => 1_700_000_000_000);
    const detach = hub.attach({ claims, session, queue: new OrderedOutboundQueue({ maxBytes: 10_000, send: async (value) => { sent.push(value); } }) });
    await hub.send(command);
    expect(JSON.parse(sent[0]!).payload).toMatchObject({ type: 'action.command', command: { actionId: command.actionId } });
    detach();
    await expect(session.receive(await wire(2, { type: 'action.completed', result: { actionId: command.actionId, stepId: command.stepId, observationId: observation.observationId, sequence: 2, status: 'succeeded', startedAt: '2023-11-14T22:13:20.200Z', completedAt: '2023-11-14T22:13:20.300Z', durationMs: 100, postObservation: { ...observation, observationId: '77000000-0000-4000-8000-000000000001', capturedAt: '2023-11-14T22:13:20.301Z' } } }, '23000000-0000-4000-8000-000000000001'))).resolves.toMatchObject({ kind: 'outcome' });
    expect(engine.handle).toHaveBeenCalledTimes(2);
  });

  test('rejects expired envelopes, replayed sequences, and claim mismatch before engine routing', async () => {
    const engine: TransportEngine = { handle: jest.fn() };
    const session = new TransportSession({ claims, recipientId: ids.recipient, verifier: signer, engine, now: () => 1_700_000_000_000 });
    expect((await session.receive(await wire(1, { type: 'heartbeat', sentAt: '2023-11-14T22:13:20.000Z' }))).kind).toBe('heartbeat');
    await expect(session.receive(await wire(1, { type: 'heartbeat', sentAt: '2023-11-14T22:13:20.000Z' }, '20000000-0000-4000-8000-000000000002')))
      .rejects.toMatchObject({ code: 'SEQUENCE_REPLAY' });
    expect(engine.handle).not.toHaveBeenCalled();

    const expiredSession = new TransportSession({ claims, recipientId: ids.recipient, verifier: signer, engine, now: () => 1_700_000_040_000 });
    await expect(expiredSession.receive(await wire(1, { type: 'heartbeat', sentAt: '2023-11-14T22:13:20.000Z' })))
      .rejects.toMatchObject({ code: 'MESSAGE_EXPIRED' });

    const mismatched = new TransportSession({ claims: { ...claims, sessionId: '10000000-0000-4000-8000-000000000009' }, recipientId: ids.recipient, verifier: signer, engine, now: () => 1_700_000_000_000 });
    await expect(mismatched.receive(await wire(1, { type: 'heartbeat', sentAt: '2023-11-14T22:13:20.000Z' })))
      .rejects.toMatchObject({ code: 'CLAIM_MISMATCH' });

    for (const binding of [{ tenantId: 'tenant-b' }, { deviceId: '50000000-0000-4000-8000-000000000002' }]) {
      const bound = new TransportSession({ claims, recipientId: ids.recipient, verifier: signer, engine, now: () => 1_700_000_000_000 });
      await expect(bound.receive(await wire(1, { type: 'heartbeat', sentAt: '2023-11-14T22:13:20.000Z' }, '24000000-0000-4000-8000-000000000001', binding)))
        .rejects.toMatchObject({ code: 'CLAIM_MISMATCH' });
    }
  });

  test('routes reconnect state once and returns the authoritative pending action result', async () => {
    const outcome = { kind: 'reconciled' as const, sessionId: ids.session, messageId: ids.message, revision: 3, state: 'EXECUTING' as const, pendingActionIds: ['50000000-0000-4000-8000-000000000001'], requiresFreshObservation: false };
    const engine: TransportEngine = { handle: jest.fn(async () => outcome) };
    const session = new TransportSession({ claims, recipientId: ids.recipient, verifier: signer, engine, now: () => 1_700_000_000_000 });
    const result = await session.receive(await wire(1, {
      type: 'reconcile.request', lastReceivedSequence: 2, lastSentClientSequence: 1,
      pendingActionIds: ['50000000-0000-4000-8000-000000000001'], requestedAt: '2023-11-14T22:13:20.000Z',
    }));
    expect(result).toMatchObject({ kind: 'outcome', outcome });
    expect(engine.handle).toHaveBeenCalledTimes(1);
  });

  test('returns a signed authoritative fresh-observation reconciliation response', async () => {
    const outcome = { kind: 'reconciled' as const, sessionId: ids.session, messageId: ids.message, revision: 3, state: 'OBSERVING' as const, pendingActionIds: [], requiresFreshObservation: true };
    const engine: TransportEngine = { handle: async () => outcome };
    const store = { load: async () => ({ sessionId: ids.session, state: 'OBSERVING', nextSequence: 2, activeAction: null, completedActions: {}, lastObservation: null }) };
    const session = new TransportSession({ claims, recipientId: ids.recipient, verifier: signer, engine, store: store as never, now: () => 1_700_000_000_000 });
    const result = await session.receive(await wire(1, { type: 'reconcile.request', lastReceivedSequence: 0, lastSentClientSequence: 1,
      pendingActionIds: ['50000000-0000-4000-8000-000000000009'], requestedAt: '2023-11-14T22:13:20.000Z' }));
    expect(result.kind).toBe('outcome');
    const payload = JSON.parse((result as Extract<typeof result, { kind: 'outcome' }>).responseWire!).payload;
    expect(payload).toMatchObject({ type: 'reconcile.response', authoritativeState: 'OBSERVING', requiresFreshObservation: true, pendingActionIds: [] });
  });

  test('uses a fenced shared connection lease across server instances', async () => {
    const leases = new InMemoryConnectionLeaseStore();
    const first = await leases.acquire(claims, 'connection-1', 1_700_000_030_000, 1_700_000_000_000);
    const second = await leases.acquire(claims, 'connection-2', 1_700_000_040_000, 1_700_000_000_001);
    expect(second.fence).toBeGreaterThan(first.fence);
    await expect(leases.isOwner(ids.session, first)).resolves.toBe(false);
    await expect(leases.isOwner(ids.session, second)).resolves.toBe(true);
  });

  test('preserves outbound order and rejects beyond its byte bound', async () => {
    const sent: string[] = [];
    const queue = new OrderedOutboundQueue({ maxBytes: 10, send: async (value) => { sent.push(value); } });
    await queue.enqueue('one');
    await queue.enqueue('two');
    await expect(queue.enqueue('01234567890')).rejects.toMatchObject({ code: 'BACKPRESSURE' });
    await queue.drained();
    expect(sent).toEqual(['one', 'two']);
  });

  test('routes cancellation received after a disconnect and does not re-execute an action', async () => {
    const engine: TransportEngine = { handle: jest.fn(async (event) => ({ kind: event.type === 'task.cancelled' ? 'terminal' : 'reconciled', sessionId: ids.session, messageId: ids.message, revision: 4, state: 'CANCELLED', pendingActionIds: [] })) };
    const session = new TransportSession({ claims, recipientId: ids.recipient, verifier: signer, engine, now: () => 1_700_000_000_000 });
    const result = await session.receive(await wire(1, {
      type: 'task.cancelled', taskId: '60000000-0000-4000-8000-000000000001', occurredAt: '2023-11-14T22:13:20.000Z', reason: 'user cancelled while offline', observationId: '70000000-0000-4000-8000-000000000001',
    }));
    expect(result).toMatchObject({ kind: 'outcome', outcome: { kind: 'terminal' } });
    expect(engine.handle).toHaveBeenCalledTimes(1);
  });
});
