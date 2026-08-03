import {
  AgentEnvelopeV1Schema,
  canonicalEnvelopeBytes,
  createEnvelope,
} from '../index.js';

const NOW = Date.parse('2026-08-03T12:00:00.000Z');
const IDS = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  correlationId: '22222222-2222-4222-8222-222222222222',
  causationId: '33333333-3333-4333-8333-333333333333',
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
      payload: { type: 'session.open', client: 'browser_extension' },
    });
    expect([...canonicalEnvelopeBytes(envelope)]).toEqual([...canonicalEnvelopeBytes(roundTripped)]);
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
});
