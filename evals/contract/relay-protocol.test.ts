import {
  AgentEnvelopeV1Schema,
  AgentMessageV1Schema,
  createEnvelope,
} from '@brotto/relay-protocol';

const envelope = createEnvelope({
  sessionId: '11111111-1111-4111-8111-111111111111',
  messageId: '44444444-4444-4444-8444-444444444444',
  correlationId: '22222222-2222-4222-8222-222222222222',
  causationId: '33333333-3333-4333-8333-333333333333',
  recipientId: '55555555-5555-4555-8555-555555555555',
  sequence: 7,
  createdAt: '2026-08-03T12:00:00.000Z',
  expiresAt: Date.parse('2026-08-03T12:01:00.000Z'),
  payload: { type: 'heartbeat', sentAt: '2026-08-03T12:00:00.000Z' },
});

describe('canonical relay protocol contract', () => {
  it('uses the canonical version, envelope sequence and typed payload discriminator', () => {
    const parsed = AgentEnvelopeV1Schema.parse(envelope);

    expect(parsed.protocolVersion).toBe('1.0');
    expect(parsed.recipientId).toBe('55555555-5555-4555-8555-555555555555');
    expect(parsed.sequence).toBe(7);
    expect(parsed.expiresAt).toBeGreaterThan(Date.parse(parsed.createdAt));
    expect(parsed.payload.type).toBe('heartbeat');
  });

  it('accepts only recognized canonical message discriminators', () => {
    expect(AgentMessageV1Schema.parse(envelope.payload).type).toBe('heartbeat');
    expect(() => AgentMessageV1Schema.parse({ type: 'cdp.frame', method: 'Page.enable' })).toThrow();
  });
});
