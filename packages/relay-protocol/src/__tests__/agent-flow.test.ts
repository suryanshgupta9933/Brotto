import { AgentFlowGuard, createEnvelope } from '../index.js';

const RECIPIENT_ID = '99999999-9999-4999-8999-999999999999';
const IDS = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  correlationId: '22222222-2222-4222-8222-222222222222',
  causationId: '33333333-3333-4333-8333-333333333333',
  observationId: '44444444-4444-4444-8444-444444444444',
  actionId: '55555555-5555-4555-8555-555555555555',
  stepId: '66666666-6666-4666-8666-666666666666',
  policyDecisionId: '77777777-7777-4777-8777-777777777777',
};

const observation = {
  observationId: IDS.observationId,
  capturedAt: '2026-08-03T10:00:00.000Z',
  url: 'https://example.com/search',
  title: 'Example',
  screenshot: { kind: 'artifact', artifactId: '88888888-8888-4888-8888-888888888888', sha256: 'a'.repeat(64), width: 1, height: 1, encoding: 'png' },
  viewport: { width: 1, height: 1, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
  page: { tabId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', frameId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', lifecycle: 'complete', visibility: 'visible' },
  semanticTargets: [],
};

const command = {
  actionId: IDS.actionId,
  stepId: IDS.stepId,
  observationId: IDS.observationId,
  sequence: 1,
  action: { type: 'left_click' as const, x: 0, y: 0 },
  policyContext: { policyDecisionId: IDS.policyDecisionId, policyVersion: 'v1', approved: false },
  dispatchedAt: '2026-08-03T10:00:00.500Z',
  expiresAt: '2026-08-03T10:01:00.000Z',
  idempotencyKey: 'click-once',
};

const commandMessage = {
  type: 'action.command' as const,
  proposal: { kind: 'action' as const, observationId: IDS.observationId, proposedAt: '2026-08-03T10:00:00.100Z', action: command.action },
  policyDecision: { policyDecisionId: IDS.policyDecisionId, actionId: IDS.actionId, observationId: IDS.observationId, decision: 'allowed' as const, decidedAt: '2026-08-03T10:00:00.250Z' },
  command,
};

const result = {
  actionId: IDS.actionId,
  stepId: IDS.stepId,
  observationId: IDS.observationId,
  sequence: 2,
  status: 'succeeded' as const,
  startedAt: '2026-08-03T10:00:01.000Z',
  completedAt: '2026-08-03T10:00:02.000Z',
  durationMs: 1_000,
  postObservation: { ...observation, observationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', capturedAt: '2026-08-03T10:00:02.001Z' },
};

const approvalResolution = {
  approvalId: '12121212-1212-4212-8212-121212121212',
  policyDecisionId: IDS.policyDecisionId,
  actionId: IDS.actionId,
  status: 'approved' as const,
  resolvedAt: '2026-08-03T10:00:00.400Z',
};

const approvalRequiredCommandMessage = {
  ...commandMessage,
  policyDecision: { ...commandMessage.policyDecision, decision: 'approval_required' as const },
  command: {
    ...command,
    policyContext: { ...command.policyContext, approved: true, approvalId: approvalResolution.approvalId },
  },
};

function envelope(sequence: number, messageId: string, payload: unknown) {
  return createEnvelope({
    sessionId: IDS.sessionId,
    recipientId: RECIPIENT_ID,
    correlationId: IDS.correlationId,
    causationId: IDS.causationId,
    messageId,
    sequence,
    createdAt: '2026-08-03T10:00:00.000Z',
    expiresAt: Date.parse('2026-08-03T10:01:00.000Z'),
    payload: payload as never,
  });
}

describe('agent flow guard', () => {
  it('accepts an action completion linked to the accepted approval trajectory', () => {
    const guard = new AgentFlowGuard();

    expect(guard.accept(envelope(0, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', { type: 'observation.submitted', observation })).status).toBe('accepted');
    expect(guard.accept(envelope(1, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', approvalRequiredCommandMessage)).status).toBe('accepted');
    expect(guard.accept(envelope(2, 'ffffffff-ffff-4fff-8fff-ffffffffffff', { type: 'approval.resolved', resolution: approvalResolution })).status).toBe('accepted');
    expect(guard.accept(envelope(3, '13131313-1313-4313-8313-131313131313', { type: 'action.completed', result })).status).toBe('accepted');
  });

  it('rejects action completion without an accepted predecessor trajectory', () => {
    const guard = new AgentFlowGuard();

    expect(guard.accept(envelope(2, 'ffffffff-ffff-4fff-8fff-ffffffffffff', { type: 'action.completed', result }))).toMatchObject({ status: 'rejected', code: 'ACTION_FLOW_INVALID' });
  });

  it('rejects a completion that does not match its accepted action command', () => {
    const guard = new AgentFlowGuard();
    guard.accept(envelope(0, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', { type: 'observation.submitted', observation }));
    guard.accept(envelope(1, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', commandMessage));

    expect(guard.accept(envelope(2, 'ffffffff-ffff-4fff-8fff-ffffffffffff', {
      type: 'action.completed', result: { ...result, actionId: '12121212-1212-4212-8212-121212121212' },
    }))).toMatchObject({ status: 'rejected', code: 'ACTION_FLOW_INVALID' });
  });

  it('rejects an approval-required completion without a matching prior resolution', () => {
    const guard = new AgentFlowGuard();
    guard.accept(envelope(0, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', { type: 'observation.submitted', observation }));
    guard.accept(envelope(1, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', approvalRequiredCommandMessage));

    expect(guard.accept(envelope(2, 'ffffffff-ffff-4fff-8fff-ffffffffffff', { type: 'action.completed', result })))
      .toMatchObject({ status: 'rejected', code: 'ACTION_FLOW_INVALID' });
  });
});
