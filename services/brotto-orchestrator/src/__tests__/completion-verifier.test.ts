import type { CompletionProposalV1, TrajectoryEventV1 } from '@brotto/brotto-action-schema';
import { CompletionVerifier } from '../engine/completion-verifier.js';

const ids = {
  session: '11111111-1111-4111-8111-111111111111',
  task: '22222222-2222-4222-8222-222222222222',
  action: '33333333-3333-4333-8333-333333333333',
  observation1: '44444444-4444-4444-8444-444444444444',
  observation2: '55555555-5555-4555-8555-555555555555',
} as const;

function event(
  sequence: number,
  kind: TrajectoryEventV1['kind'],
  occurredAt: string,
  observationId?: string,
): TrajectoryEventV1 {
  return {
    eventId: `${sequence.toString().padStart(8, '0')}-0000-4000-8000-000000000000`,
    sessionId: ids.session,
    taskId: ids.task,
    sequence,
    kind,
    occurredAt,
    ...(observationId === undefined ? {} : { observationId }),
    ...(kind === 'action_completed' ? { actionId: ids.action } : {}),
  } as TrajectoryEventV1;
}

function proposal(overrides: Partial<CompletionProposalV1> = {}): CompletionProposalV1 {
  return {
    kind: 'completion',
    observationId: ids.observation2,
    type: 'terminate',
    status: 'succeeded',
    summary: 'The order confirmation is visible.',
    findings: [{ fact: 'Order confirmation number is visible', observationIds: [ids.observation2] }],
    unmetCriteria: [],
    confidence: 0.98,
    ...overrides,
  } as CompletionProposalV1;
}

const verifiedTrajectory = [
  event(1, 'observation_captured', '2026-08-03T10:00:00.000Z', ids.observation1),
  event(2, 'action_completed', '2026-08-03T10:00:05.000Z', ids.observation1),
  event(3, 'observation_captured', '2026-08-03T10:00:06.000Z', ids.observation2),
];

describe('CompletionVerifier', () => {
  const verifier = new CompletionVerifier();

  it('does not accept speculative completion', () => {
    const decision = verifier.verify(proposal({
      summary: 'The order probably succeeded.',
      findings: [{ fact: 'Order confirmation number is visible', observationIds: [ids.observation2] }],
    }), verifiedTrajectory);

    expect(decision).toEqual(expect.objectContaining({
      outcome: 'continue',
      accepted: false,
      code: 'SPECULATIVE_EVIDENCE',
    }));
  });

  it('accepts already-satisfied observational completion without a prior action', () => {
    const currentTrajectory = [
      event(1, 'observation_captured', '2026-08-03T10:00:00.000Z', ids.observation2),
    ];

    expect(verifier.verify(proposal(), currentTrajectory)).toEqual(expect.objectContaining({
      outcome: 'accepted',
      accepted: true,
      code: 'VERIFIED_COMPLETION',
    }));
  });

  it('does not treat a verification event as the current observation when no action exists', () => {
    const decision = verifier.verify(proposal(), [
      event(1, 'verification_result', '2026-08-03T10:00:00.000Z', ids.observation2),
    ]);

    expect(decision).toEqual(expect.objectContaining({
      outcome: 'continue',
      accepted: false,
      code: 'STALE_EVIDENCE',
    }));
  });

  it('requires the concrete finding itself to reference current browser evidence', () => {
    const decision = verifier.verify(proposal({
      findings: [
        {
          fact: 'Order confirmation number is visible',
          observationIds: ['99999999-9999-4999-8999-999999999999'],
        },
        {
          fact: 'The page probably updated',
          observationIds: [ids.observation2],
        },
      ],
    }), [event(1, 'observation_captured', '2026-08-03T10:00:00.000Z', ids.observation2)]);

    expect(decision).toEqual(expect.objectContaining({
      outcome: 'continue',
      accepted: false,
      code: 'INSUFFICIENT_EVIDENCE',
    }));
  });

  it('requires a finding to reference an observed browser fact', () => {
    const decision = verifier.verify(proposal({
      findings: [{ fact: 'Confirmation exists', observationIds: ['99999999-9999-4999-8999-999999999999'] }],
    }), verifiedTrajectory);

    expect(decision).toEqual(expect.objectContaining({ accepted: false, code: 'INSUFFICIENT_EVIDENCE' }));
  });

  it('requires a post-action observation newer than the last action', () => {
    const decision = verifier.verify(proposal({
      observationId: ids.observation1,
      findings: [{ fact: 'Confirmation exists', observationIds: [ids.observation1] }],
    }), [
      event(1, 'observation_captured', '2026-08-03T10:00:00.000Z', ids.observation1),
      event(2, 'action_completed', '2026-08-03T10:00:05.000Z', ids.observation1),
    ]);

    expect(decision).toEqual(expect.objectContaining({ accepted: false, code: 'STALE_EVIDENCE' }));
  });

  it('continues when a required criterion remains unmet', () => {
    const decision = verifier.verify(proposal({ unmetCriteria: ['Receipt was downloaded'] }), verifiedTrajectory);

    expect(decision).toEqual(expect.objectContaining({ outcome: 'continue', code: 'UNMET_CRITERIA' }));
  });

  it('accepts structured findings backed by a fresh post-action observation', () => {
    expect(verifier.verify(proposal(), verifiedTrajectory)).toEqual(expect.objectContaining({
      outcome: 'accepted',
      accepted: true,
      code: 'VERIFIED_COMPLETION',
    }));
  });

  it('returns a typed failed outcome for a model-reported failure', () => {
    const decision = verifier.verify(proposal({
      status: 'failed',
      findings: [],
      unmetCriteria: ['Order could not be submitted'],
      summary: 'The order failed.',
    }), verifiedTrajectory);

    expect(decision).toEqual(expect.objectContaining({
      outcome: 'failed',
      accepted: false,
      code: 'MODEL_REPORTED_FAILURE',
    }));
  });
});
