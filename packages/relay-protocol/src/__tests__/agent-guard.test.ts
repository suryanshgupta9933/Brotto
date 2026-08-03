import {
  createEnvelope,
  ProtocolGuard,
} from '../index.js';

const NOW = Date.parse('2026-08-03T12:00:00.000Z');
const RECIPIENT_ID = '55555555-5555-4555-8555-555555555555';

const validEnvelope = createEnvelope({
  sessionId: '11111111-1111-4111-8111-111111111111',
  messageId: '44444444-4444-4444-8444-444444444444',
  correlationId: '22222222-2222-4222-8222-222222222222',
  causationId: '33333333-3333-4333-8333-333333333333',
  recipientId: RECIPIENT_ID,
  sequence: 0,
  createdAt: '2026-08-03T12:00:00.000Z',
  expiresAt: NOW + 60_000,
  payload: { type: 'heartbeat', sentAt: '2026-08-03T12:00:00.000Z' },
});

describe('protocol guard', () => {
  it('rejects replay before dispatching payload', () => {
    const guard = new ProtocolGuard({ now: () => NOW, maxBytes: 1_000_000, expectedRecipientId: RECIPIENT_ID });

    expect(guard.accept(validEnvelope).status).toBe('accepted');
    expect(guard.accept(validEnvelope)).toMatchObject({ status: 'duplicate' });
  });

  it('rejects an expired envelope', () => {
    const guard = new ProtocolGuard({ now: () => NOW, maxBytes: 1_000_000, expectedRecipientId: RECIPIENT_ID });

    expect(guard.accept({ ...validEnvelope, createdAt: '2026-08-03T11:58:00.000Z', expiresAt: NOW - 1 })).toMatchObject({
      status: 'rejected', code: 'MESSAGE_EXPIRED',
    });
  });

  it('rejects a distinct message that reuses an accepted session sequence', () => {
    const guard = new ProtocolGuard({ now: () => NOW, maxBytes: 1_000_000, expectedRecipientId: RECIPIENT_ID });

    expect(guard.accept(validEnvelope).status).toBe('accepted');
    expect(guard.accept({ ...validEnvelope, messageId: '12121212-1212-4212-8212-121212121212' }))
      .toMatchObject({ status: 'rejected', code: 'SEQUENCE_REPLAY' });
  });

  it('rejects an envelope larger than the configured bound', () => {
    const guard = new ProtocolGuard({ now: () => NOW, maxBytes: 1, expectedRecipientId: RECIPIENT_ID });

    expect(guard.accept(validEnvelope)).toMatchObject({
      status: 'rejected', code: 'MESSAGE_TOO_LARGE',
    });
  });

  it('rejects an observation for a different recipient before payload use', () => {
    const guard = new ProtocolGuard({ now: () => NOW, maxBytes: 1_000_000, expectedRecipientId: RECIPIENT_ID });
    const observationEnvelope = createEnvelope({
      ...validEnvelope,
      messageId: '77777777-7777-4777-8777-777777777777',
      sequence: 1,
      recipientId: '66666666-6666-4666-8666-666666666666',
      payload: {
        type: 'observation.submitted',
        observation: {
          observationId: '88888888-8888-4888-8888-888888888888',
          capturedAt: '2026-08-03T12:00:00.000Z',
          url: 'https://example.com',
          title: 'Example',
          screenshot: { kind: 'artifact', artifactId: '99999999-9999-4999-8999-999999999999', sha256: 'a'.repeat(64), width: 1, height: 1, encoding: 'png' },
          viewport: { width: 1, height: 1, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
          page: { tabId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', frameId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', lifecycle: 'complete', visibility: 'visible' },
          semanticTargets: [],
        },
      },
    });

    expect(guard.accept(observationEnvelope)).toMatchObject({ status: 'rejected', code: 'RECIPIENT_MISMATCH' });
  });

  it('counts the transmitted signature when enforcing the wire-size limit', () => {
    const signedEnvelope = { ...validEnvelope, signature: 'x'.repeat(100) };
    const unsignedSize = new TextEncoder().encode(JSON.stringify(validEnvelope)).byteLength;
    const guard = new ProtocolGuard({ now: () => NOW, maxBytes: unsignedSize, expectedRecipientId: RECIPIENT_ID });

    expect(guard.accept(signedEnvelope)).toMatchObject({ status: 'rejected', code: 'MESSAGE_TOO_LARGE' });
  });
});
