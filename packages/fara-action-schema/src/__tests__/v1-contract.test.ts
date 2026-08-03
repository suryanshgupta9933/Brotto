import { z } from 'zod';
import {
  ActionCommandV1Schema,
  ActionResultV1Schema,
  AgentProposalV1Schema,
  ObservationV1Schema,
  TrajectoryLinkageV1Schema,
} from '../v1';

const observationId = '11111111-1111-4111-8111-111111111111';
const policyDecisionId = '99999999-9999-4999-8999-999999999999';

const validObservation = {
  observationId,
  capturedAt: '2026-08-03T10:00:00.000Z',
  url: 'https://example.com/search',
  title: 'Example search',
  screenshot: {
    kind: 'inline',
    encoding: 'base64',
    data: 'c2NyZWVuc2hvdA==',
    sha256: 'a'.repeat(64),
    width: 1280,
    height: 720,
  },
  viewport: {
    width: 1280,
    height: 720,
    devicePixelRatio: 1,
    zoom: 1,
    scrollX: 0,
    scrollY: 0,
  },
  page: {
    tabId: '22222222-2222-4222-8222-222222222222',
    frameId: '33333333-3333-4333-8333-333333333333',
    lifecycle: 'complete',
    visibility: 'visible',
  },
  semanticTargets: [
    {
      targetId: '44444444-4444-4444-8444-444444444444',
      tag: 'button',
      role: 'button',
      accessibleName: { source: 'aria-label', text: 'Search' },
      attributes: { 'aria-label': 'Search' },
      control: { kind: 'non_input' },
      boundingBox: { x: 12, y: 24, width: 80, height: 32 },
      visible: true,
      framePath: [],
      locatorCandidates: [{
        kind: 'role_name',
        role: 'button',
        name: { source: 'aria-label', text: 'Search' },
      }],
    },
  ],
};

const validActionCommand = {
  actionId: '55555555-5555-4555-8555-555555555555',
  stepId: '66666666-6666-4666-8666-666666666666',
  observationId,
  sequence: 1,
  action: {
    type: 'left_click',
    x: 52,
    y: 40,
    targetId: '44444444-4444-4444-8444-444444444444',
  },
  policyContext: { policyDecisionId, policyVersion: 'v1', approved: false },
  dispatchedAt: '2026-08-03T10:00:00.500Z',
  expiresAt: '2026-08-03T10:01:00.000Z',
  idempotencyKey: 'click-search-once',
};

const validResult = {
  actionId: validActionCommand.actionId,
  stepId: validActionCommand.stepId,
  observationId,
  sequence: 2,
  status: 'succeeded',
  startedAt: '2026-08-03T10:00:01.000Z',
  completedAt: '2026-08-03T10:00:02.000Z',
  durationMs: 1000,
  postObservation: {
    ...validObservation,
    observationId: '88888888-8888-4888-8888-888888888888',
    capturedAt: '2026-08-03T10:00:02.001Z',
  },
};

const validPolicyDecision = {
  policyDecisionId,
  actionId: validActionCommand.actionId,
  observationId,
  decision: 'allowed',
  decidedAt: '2026-08-03T10:00:00.250Z',
};

const validApprovalResolution = {
  approvalId: 'abababab-abab-4bab-8bab-abababababab',
  policyDecisionId,
  actionId: validActionCommand.actionId,
  status: 'approved',
  resolvedAt: '2026-08-03T10:00:00.400Z',
};

describe('canonical v1 contracts', () => {
  it('accepts a sanitized HTTP(S) observation with bounded semantic targets', () => {
    const observation = ObservationV1Schema.parse(validObservation);

    expect(observation.observationId).toBe(observationId);
    expect(observation.semanticTargets[0].accessibleName?.text).toBe('Search');
  });

  it('rejects an observation URL outside HTTP(S)', () => {
    expect(() => ObservationV1Schema.parse({ ...validObservation, url: 'file:///tmp/page.html' }))
      .toThrow();
  });

  it('reports malformed URLs as Zod validation errors at every URL boundary', () => {
    expect(() => ObservationV1Schema.parse({ ...validObservation, url: 'not a URL' }))
      .toThrow(z.ZodError);
    expect(() => ActionCommandV1Schema.parse({
      ...validActionCommand,
      action: { type: 'visit_url', url: 'not a URL' },
    })).toThrow(z.ZodError);
    expect(() => ActionResultV1Schema.parse({
      ...validResult,
      navigation: { url: 'not a URL' },
    })).toThrow(z.ZodError);
  });

  it('rejects a successful action result without a settled post-observation', () => {
    expect(() => ActionResultV1Schema.parse({
      ...validResult,
      postObservation: undefined,
    })).toThrow(z.ZodError);
  });

  it('requires a cancelled action result to carry a settled post-observation', () => {
    expect(ActionResultV1Schema.parse({
      ...validResult,
      status: 'cancelled',
      cancellation: { reason: 'Cancelled during execution' },
    }).status).toBe('cancelled');
    expect(() => ActionResultV1Schema.parse({
      ...validResult,
      status: 'cancelled',
      cancellation: { reason: 'Cancelled during execution' },
      postObservation: undefined,
    })).toThrow(z.ZodError);
  });

  it('requires findings with observation evidence for successful completion', () => {
    expect(() => AgentProposalV1Schema.parse({
      kind: 'completion',
      observationId,
      type: 'terminate',
      status: 'succeeded',
      summary: 'The task is complete.',
      findings: [],
      unmetCriteria: [],
      confidence: 0.9,
    })).toThrow(z.ZodError);
  });

  it('rejects a trajectory with a command sourced from a different observation', () => {
    expect(() => TrajectoryLinkageV1Schema.parse({
      proposal: {
        kind: 'action',
        observationId,
        proposedAt: '2026-08-03T10:00:00.100Z',
        action: validActionCommand.action,
      },
      sourceObservation: validObservation,
      command: {
        ...validActionCommand,
        observationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        policyContext: {
          ...validActionCommand.policyContext,
          policyDecisionId: validPolicyDecision.policyDecisionId,
        },
      },
      policyDecision: validPolicyDecision,
      result: validResult,
    })).toThrow(z.ZodError);
  });

  it('requires policy outcome and action result status to agree', () => {
    const trajectory = {
      sourceObservation: validObservation,
      proposal: {
        kind: 'action' as const,
        observationId,
        proposedAt: '2026-08-03T10:00:00.100Z',
        action: validActionCommand.action,
      },
      command: validActionCommand,
      policyDecision: validPolicyDecision,
      result: validResult,
    };

    expect(TrajectoryLinkageV1Schema.parse(trajectory).result.status).toBe('succeeded');
    expect(() => TrajectoryLinkageV1Schema.parse({
      ...trajectory,
      policyDecision: { ...validPolicyDecision, decision: 'denied' },
    })).toThrow(z.ZodError);
    const { postObservation: _postObservation, ...rejectedResultBase } = validResult;
    expect(() => TrajectoryLinkageV1Schema.parse({
      ...trajectory,
      result: {
        ...rejectedResultBase,
        status: 'rejected_policy',
        rejection: { code: 'POLICY_DENIED', message: 'Denied by policy', retryable: false },
      },
    })).toThrow(z.ZodError);
    expect(() => TrajectoryLinkageV1Schema.parse({
      ...trajectory,
      policyDecision: { ...validPolicyDecision, decision: 'approval_required' },
    })).toThrow(z.ZodError);
    expect(TrajectoryLinkageV1Schema.parse({
      ...trajectory,
      command: {
        ...validActionCommand,
        policyContext: {
          ...validActionCommand.policyContext,
          approved: true,
          approvalId: 'abababab-abab-4bab-8bab-abababababab',
        },
      },
      policyDecision: { ...validPolicyDecision, decision: 'approval_required' },
      approvalResolution: validApprovalResolution,
    }).result.status).toBe('succeeded');
  });

  it('rejects a post-observation captured before the action completed', () => {
    expect(() => TrajectoryLinkageV1Schema.parse({
      sourceObservation: validObservation,
      proposal: {
        kind: 'action',
        observationId,
        proposedAt: '2026-08-03T10:00:00.100Z',
        action: validActionCommand.action,
      },
      command: validActionCommand,
      policyDecision: validPolicyDecision,
      result: {
        ...validResult,
        postObservation: {
          ...validResult.postObservation,
          capturedAt: '2026-08-03T10:00:01.500Z',
        },
      },
    })).toThrow(z.ZodError);
  });

  it('rejects dispatch before the source observation has been proposed and policy-decided', () => {
    expect(() => TrajectoryLinkageV1Schema.parse({
      sourceObservation: validObservation,
      proposal: {
        kind: 'action',
        observationId,
        proposedAt: '2026-08-03T10:00:00.100Z',
        action: validActionCommand.action,
      },
      command: { ...validActionCommand, dispatchedAt: '2026-08-03T10:00:00.050Z' },
      policyDecision: validPolicyDecision,
      result: validResult,
    })).toThrow(z.ZodError);
  });

  it('rejects an executed failure that reuses the source observation as post-state', () => {
    expect(() => TrajectoryLinkageV1Schema.parse({
      sourceObservation: validObservation,
      proposal: {
        kind: 'action',
        observationId,
        proposedAt: '2026-08-03T10:00:00.100Z',
        action: validActionCommand.action,
      },
      command: validActionCommand,
      policyDecision: validPolicyDecision,
      result: {
        ...validResult,
        status: 'failed_terminal',
        error: { code: 'EXECUTION_FAILED', message: 'Click failed', retryable: false },
        postObservation: validObservation,
      },
    })).toThrow(z.ZodError);
  });

  it('rejects approval-required execution without a matching approved resolution', () => {
    expect(() => TrajectoryLinkageV1Schema.parse({
      sourceObservation: validObservation,
      proposal: {
        kind: 'action',
        observationId,
        proposedAt: '2026-08-03T10:00:00.100Z',
        action: validActionCommand.action,
      },
      command: {
        ...validActionCommand,
        policyContext: {
          ...validActionCommand.policyContext,
          approved: true,
          approvalId: 'abababab-abab-4bab-8bab-abababababab',
        },
      },
      policyDecision: { ...validPolicyDecision, decision: 'approval_required' },
      result: validResult,
    })).toThrow(z.ZodError);
  });

  it('rejects mismatched or denied approval resolutions', () => {
    const approvedTrajectory = {
      sourceObservation: validObservation,
      proposal: {
        kind: 'action' as const,
        observationId,
        proposedAt: '2026-08-03T10:00:00.100Z',
        action: validActionCommand.action,
      },
      command: {
        ...validActionCommand,
        policyContext: {
          ...validActionCommand.policyContext,
          approved: true,
          approvalId: validApprovalResolution.approvalId,
        },
      },
      policyDecision: { ...validPolicyDecision, decision: 'approval_required' as const },
      result: validResult,
      approvalResolution: validApprovalResolution,
    };

    expect(TrajectoryLinkageV1Schema.parse(approvedTrajectory).result.status).toBe('succeeded');
    expect(() => TrajectoryLinkageV1Schema.parse({
      ...approvedTrajectory,
      approvalResolution: { ...validApprovalResolution, actionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    })).toThrow(z.ZodError);
    expect(() => TrajectoryLinkageV1Schema.parse({
      ...approvedTrajectory,
      approvalResolution: { ...validApprovalResolution, status: 'denied' },
    })).toThrow(z.ZodError);
  });

  it('rejects approval resolution at the policy-decision timestamp', () => {
    expect(() => TrajectoryLinkageV1Schema.parse({
      sourceObservation: validObservation,
      proposal: {
        kind: 'action',
        observationId,
        proposedAt: '2026-08-03T10:00:00.100Z',
        action: validActionCommand.action,
      },
      command: {
        ...validActionCommand,
        policyContext: {
          ...validActionCommand.policyContext,
          approved: true,
          approvalId: validApprovalResolution.approvalId,
        },
      },
      policyDecision: { ...validPolicyDecision, decision: 'approval_required' },
      approvalResolution: {
        ...validApprovalResolution,
        resolvedAt: validPolicyDecision.decidedAt,
      },
      result: validResult,
    })).toThrow(z.ZodError);
  });

  it('rejects approval resolution at the command-dispatch timestamp', () => {
    expect(() => TrajectoryLinkageV1Schema.parse({
      sourceObservation: validObservation,
      proposal: {
        kind: 'action',
        observationId,
        proposedAt: '2026-08-03T10:00:00.100Z',
        action: validActionCommand.action,
      },
      command: {
        ...validActionCommand,
        policyContext: {
          ...validActionCommand.policyContext,
          approved: true,
          approvalId: validApprovalResolution.approvalId,
        },
      },
      policyDecision: { ...validPolicyDecision, decision: 'approval_required' },
      approvalResolution: {
        ...validApprovalResolution,
        resolvedAt: validActionCommand.dispatchedAt,
      },
      result: validResult,
    })).toThrow(z.ZodError);
  });

  it('validates supplied approval chronology even without command approval proof', () => {
    expect(() => TrajectoryLinkageV1Schema.parse({
      sourceObservation: validObservation,
      proposal: {
        kind: 'action',
        observationId,
        proposedAt: '2026-08-03T10:00:00.100Z',
        action: validActionCommand.action,
      },
      command: validActionCommand,
      policyDecision: validPolicyDecision,
      approvalResolution: {
        ...validApprovalResolution,
        resolvedAt: validPolicyDecision.decidedAt,
      },
      result: validResult,
    })).toThrow(z.ZodError);
  });

  it('rejects an executed failure whose post-observation predates completion', () => {
    expect(() => TrajectoryLinkageV1Schema.parse({
      sourceObservation: validObservation,
      proposal: {
        kind: 'action',
        observationId,
        proposedAt: '2026-08-03T10:00:00.100Z',
        action: validActionCommand.action,
      },
      command: validActionCommand,
      policyDecision: validPolicyDecision,
      result: {
        ...validResult,
        status: 'failed_terminal',
        error: { code: 'EXECUTION_FAILED', message: 'Click failed', retryable: false },
        postObservation: {
          ...validResult.postObservation,
          capturedAt: '2026-08-03T10:00:01.500Z',
        },
      },
    })).toThrow(z.ZodError);
  });

  it('rejects a cancelled action that reuses the source observation as post-state', () => {
    expect(() => TrajectoryLinkageV1Schema.parse({
      sourceObservation: validObservation,
      proposal: {
        kind: 'action',
        observationId,
        proposedAt: '2026-08-03T10:00:00.100Z',
        action: validActionCommand.action,
      },
      command: validActionCommand,
      policyDecision: validPolicyDecision,
      result: {
        ...validResult,
        status: 'cancelled',
        cancellation: { reason: 'Cancelled during execution' },
        postObservation: {
          ...validObservation,
          capturedAt: '2026-08-03T10:00:02.001Z',
        },
      },
    })).toThrow(z.ZodError);
  });

  it('rejects a cancelled action whose post-observation is captured at completion', () => {
    expect(() => TrajectoryLinkageV1Schema.parse({
      sourceObservation: validObservation,
      proposal: {
        kind: 'action',
        observationId,
        proposedAt: '2026-08-03T10:00:00.100Z',
        action: validActionCommand.action,
      },
      command: validActionCommand,
      policyDecision: validPolicyDecision,
      result: {
        ...validResult,
        status: 'cancelled',
        cancellation: { reason: 'Cancelled during execution' },
        postObservation: {
          ...validResult.postObservation,
          capturedAt: validResult.completedAt,
        },
      },
    })).toThrow(z.ZodError);
  });

  it('does not make terminate an executable browser command', () => {
    expect(() => ActionCommandV1Schema.parse({
      ...validActionCommand,
      action: { type: 'terminate', status: 'succeeded', summary: 'Finished', findings: [] },
    })).toThrow();
  });

  it('represents terminate as a completion proposal', () => {
    const proposal = AgentProposalV1Schema.parse({
      kind: 'completion',
      observationId,
      type: 'terminate',
      status: 'succeeded',
      summary: 'Search completed.',
      findings: [{ fact: 'A result was displayed.', observationIds: [observationId] }],
      unmetCriteria: [],
      confidence: 0.9,
    });

    expect(proposal.kind).toBe('completion');
  });
});
