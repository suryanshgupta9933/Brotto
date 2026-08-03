import { jest } from '@jest/globals';
import type { EnvelopeSigner } from '@fara-platform/relay-protocol';
import { createEnvelope, signEnvelope } from '@fara-platform/relay-protocol';
import { TransportSession, type TransportEngine } from '../transport/ws-server.js';

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
const claims = { tenantId: 'tenant-a', deviceId: 'device-a', sessionId: ids.session, audience: 'browser-extension' as const, expiresAt: 1_700_000_030_000 };

async function wire(sequence: number, payload: Parameters<typeof createEnvelope>[0]['payload'], messageId = ids.message): Promise<string> {
  return JSON.stringify(await signEnvelope(createEnvelope({
    messageId,
    sessionId: ids.session,
    correlationId: ids.correlation,
    causationId: ids.correlation,
    recipientId: ids.recipient,
    sequence,
    createdAt: '2023-11-14T22:13:20.000Z',
    expiresAt: 1_700_000_030_000,
    payload,
  }), signer));
}

describe('websocket reconciliation transport', () => {
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
  });

  test('routes reconnect state once and returns the authoritative pending action result', async () => {
    const outcome = { kind: 'reconciled' as const, sessionId: ids.session, messageId: ids.message, revision: 3, state: 'EXECUTING' as const, pendingActionIds: ['50000000-0000-4000-8000-000000000001'], requiresFreshObservation: false };
    const engine: TransportEngine = { handle: jest.fn(async () => outcome) };
    const session = new TransportSession({ claims, recipientId: ids.recipient, verifier: signer, engine, now: () => 1_700_000_000_000 });
    const result = await session.receive(await wire(1, {
      type: 'reconcile.request', lastReceivedSequence: 2,
      pendingActionIds: ['50000000-0000-4000-8000-000000000001'], requestedAt: '2023-11-14T22:13:20.000Z',
    }));
    expect(result).toMatchObject({ kind: 'outcome', outcome });
    expect(engine.handle).toHaveBeenCalledTimes(1);
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
