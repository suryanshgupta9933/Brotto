import {
  createEnvelope,
  ProtocolGuard,
} from '../index.js';

const NOW = Date.parse('2026-08-03T12:00:00.000Z');

const validEnvelope = createEnvelope({
  sessionId: '11111111-1111-4111-8111-111111111111',
  messageId: '44444444-4444-4444-8444-444444444444',
  correlationId: '22222222-2222-4222-8222-222222222222',
  causationId: '33333333-3333-4333-8333-333333333333',
  sequence: 0,
  createdAt: '2026-08-03T12:00:00.000Z',
  expiresAt: NOW + 60_000,
  payload: { type: 'heartbeat', sentAt: '2026-08-03T12:00:00.000Z' },
});

describe('protocol guard', () => {
  it('rejects replay before dispatching payload', () => {
    const guard = new ProtocolGuard({ now: () => NOW, maxBytes: 1_000_000 });

    expect(guard.accept(validEnvelope).status).toBe('accepted');
    expect(guard.accept(validEnvelope)).toMatchObject({ status: 'duplicate' });
  });

  it('rejects an expired envelope', () => {
    const guard = new ProtocolGuard({ now: () => NOW, maxBytes: 1_000_000 });

    expect(guard.accept({ ...validEnvelope, expiresAt: NOW - 1 })).toMatchObject({
      status: 'rejected', code: 'MESSAGE_EXPIRED',
    });
  });

  it('rejects an envelope larger than the configured bound', () => {
    const guard = new ProtocolGuard({ now: () => NOW, maxBytes: 1 });

    expect(guard.accept(validEnvelope)).toMatchObject({
      status: 'rejected', code: 'MESSAGE_TOO_LARGE',
    });
  });
});
