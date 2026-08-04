import {
  AgentEnvelopeV1Schema,
  AgentMessageV1Schema,
  canonicalEnvelopeBytes,
  createEnvelope,
  signEnvelope,
  verifyEnvelopeSignature,
} from '../index.js';

const NOW = Date.parse('2026-08-03T12:00:00.000Z');
const IDS = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  correlationId: '22222222-2222-4222-8222-222222222222',
  causationId: '33333333-3333-4333-8333-333333333333',
  recipientId: '55555555-5555-4555-8555-555555555555',
};

function sessionOpenEnvelope() {
  return createEnvelope({
    ...IDS,
    messageId: '44444444-4444-4444-8444-444444444444',
    sequence: 0,
    createdAt: '2026-08-03T12:00:00.000Z',
    expiresAt: NOW + 60_000,
    payload: {
      type: 'session.open',
      client: 'browser_extension',
      goal: 'Find the current product price',
    },
  });
}

describe('canonical agent envelope', () => {
  it('round-trips a versioned typed message with deterministic canonical bytes', () => {
    const envelope = sessionOpenEnvelope();
    const roundTripped = AgentEnvelopeV1Schema.parse(JSON.parse(JSON.stringify(envelope)));

    expect(roundTripped).toMatchObject({
      protocolVersion: '1.0',
      sequence: 0,
      payload: { type: 'session.open', client: 'browser_extension', goal: 'Find the current product price' },
    });
    expect([...canonicalEnvelopeBytes(envelope)]).toEqual([...canonicalEnvelopeBytes(roundTripped)]);
  });

  it('requires a bounded task goal when opening a browser-extension session', () => {
    expect(() => AgentMessageV1Schema.parse({
      type: 'session.open',
      client: 'browser_extension',
    })).toThrow();
    expect(() => AgentMessageV1Schema.parse({
      type: 'session.open',
      client: 'browser_extension',
      goal: 'x'.repeat(4_001),
    })).toThrow();
    expect(AgentMessageV1Schema.parse({
      type: 'session.open',
      client: 'browser_extension',
      goal: 'Find the current product price',
    })).toMatchObject({ goal: 'Find the current product price' });
  });

  it('rejects forbidden browser data before creating an envelope', () => {
    expect(() => createEnvelope({
      ...IDS,
      messageId: '44444444-4444-4444-8444-444444444444',
      sequence: 0,
      createdAt: '2026-08-03T12:00:00.000Z',
      expiresAt: NOW + 60_000,
      payload: {
        type: 'protocol.error',
        code: 'INVALID_MESSAGE',
        message: 'Rejected',
        details: { cookies: ['secret'] },
      },
    })).toThrow('Forbidden browser data');
  });

  it('rejects an expiry that is not after envelope creation', () => {
    expect(() => createEnvelope({
      ...IDS,
      messageId: '44444444-4444-4444-8444-444444444444',
      sequence: 0,
      createdAt: '2026-08-03T12:00:00.000Z',
      expiresAt: NOW,
      payload: { type: 'heartbeat', sentAt: '2026-08-03T12:00:00.000Z' },
    })).toThrow();
  });

  it('signs and verifies recipient-bound canonical bytes', async () => {
    const checksum = (bytes: Uint8Array) => [...bytes].reduce((total, value) => total + value, 0);
    const signer = {
      sign: async (bytes: Uint8Array) => String(checksum(bytes)),
      verify: async (bytes: Uint8Array, signature: string) => signature === String(checksum(bytes)),
    };
    const signed = await signEnvelope(sessionOpenEnvelope(), signer);

    expect(await verifyEnvelopeSignature(signed, signer)).toBe(true);
    expect(await verifyEnvelopeSignature({ ...signed, recipientId: '66666666-6666-4666-8666-666666666666' }, signer)).toBe(false);
  });

  it('rejects task completion prose that has no observation-backed findings', () => {
    expect(() => createEnvelope({
      ...IDS,
      messageId: '77777777-7777-4777-8777-777777777777',
      sequence: 1,
      createdAt: '2026-08-03T12:00:00.000Z',
      expiresAt: NOW + 60_000,
      payload: {
        type: 'task.completed',
        completion: {
          kind: 'completion',
          observationId: '88888888-8888-4888-8888-888888888888',
          type: 'terminate',
          status: 'succeeded',
          summary: 'The task is complete.',
          findings: [],
          unmetCriteria: [],
          confidence: 0.9,
        },
      },
    })).toThrow();
  });

  it('allows task.failed only for a canonical failed completion proposal', () => {
    const failed = {
      kind: 'completion',
      observationId: '88888888-8888-4888-8888-888888888888',
      type: 'terminate',
      status: 'failed',
      summary: 'The task could not finish.',
      findings: [],
      unmetCriteria: ['The page stayed unavailable.'],
      confidence: 0.1,
    };

    expect(AgentMessageV1Schema.parse({ type: 'task.failed', completion: failed }).type).toBe('task.failed');
    expect(() => AgentMessageV1Schema.parse({
      type: 'task.failed', completion: { ...failed, status: 'partial' },
    })).toThrow();
  });

  it('requires task cancellation identity, timing, reason, and observation linkage', () => {
    const cancelled = {
      type: 'task.cancelled',
      taskId: '99999999-9999-4999-8999-999999999999',
      occurredAt: '2026-08-03T12:00:00.000Z',
      reason: 'The user cancelled the task.',
      observationId: '88888888-8888-4888-8888-888888888888',
    };

    expect(AgentMessageV1Schema.parse(cancelled).type).toBe('task.cancelled');
    expect(() => AgentMessageV1Schema.parse({ ...cancelled, observationId: undefined })).toThrow();
  });
});
