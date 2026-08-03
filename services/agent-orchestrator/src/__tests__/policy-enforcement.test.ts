import type { ActionProposalV1, ObservationV1 } from '@fara-platform/fara-action-schema';
import { PolicyEngine } from 'policy-engine';
import { PolicyAdapter, type HostResolver } from '../adapters/policy-adapter.js';
import type { PolicyInput } from '../engine/types.js';

const observation = {
  observationId: '11111111-1111-4111-8111-111111111111',
  capturedAt: '2026-08-03T10:00:00.000Z',
  url: 'https://shop.example/checkout',
  title: 'Checkout',
  screenshot: {
    kind: 'artifact',
    artifactId: '22222222-2222-4222-8222-222222222222',
    sha256: 'a'.repeat(64),
    width: 1280,
    height: 720,
    encoding: 'png',
  },
  viewport: { width: 1280, height: 720, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
  page: {
    tabId: '33333333-3333-4333-8333-333333333333',
    frameId: '44444444-4444-4444-8444-444444444444',
    lifecycle: 'complete',
    visibility: 'visible',
  },
  semanticTargets: [{
    targetId: '55555555-5555-4555-8555-555555555555',
    tag: 'button',
    role: 'button',
    accessibleName: { source: 'visible_text', text: 'Buy now' },
    control: { kind: 'non_input' },
    boundingBox: { x: 10, y: 10, width: 100, height: 40 },
    visible: true,
    framePath: [],
    locatorCandidates: [],
  }],
} as ObservationV1;

function policyInput(proposal: ActionProposalV1, currentObservation = observation): PolicyInput {
  return {
    workId: '66666666-6666-4666-8666-666666666666',
    sessionId: '77777777-7777-4777-8777-777777777777',
    taskId: '88888888-8888-4888-8888-888888888888',
    actionId: '99999999-9999-4999-8999-999999999999',
    policyDecisionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    proposal,
    observation: currentObservation,
  };
}

function actionProposal(action: ActionProposalV1['action']): ActionProposalV1 {
  return {
    kind: 'action',
    observationId: observation.observationId,
    proposedAt: '2026-08-03T10:00:01.000Z',
    action,
  };
}

function resolver(result: string[] | Error): HostResolver {
  return {
    resolve: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function denyingPolicy(actionType: 'make_purchase' | 'upload_file'): PolicyEngine {
  const engine = new PolicyEngine();
  engine.addPolicySet({
    id: `deny-${actionType}`,
    name: `Deny ${actionType}`,
    enabled: true,
    defaultEffect: 'allow',
    rules: [{
      id: `deny-${actionType}-rule`,
      name: `Denied ${actionType}`,
      priority: 1_000,
      effect: 'deny',
      enabled: true,
      actionTypes: [actionType],
    }],
  });
  return engine;
}

describe('PolicyAdapter', () => {
  const signal = new AbortController().signal;

  it.each([
    ['purchase', actionProposal({ type: 'left_click', x: 20, y: 20, targetId: observation.semanticTargets[0]!.targetId })],
    ['booking', actionProposal({ type: 'insert_text', text: '2 seats' }), { ...observation, title: 'Book a flight' }],
    ['external_message', actionProposal({ type: 'insert_text', text: 'Hello there' }), { ...observation, title: 'Compose' }],
    ['consequential_submission', actionProposal({ type: 'key', key: 'Enter' }), { ...observation, title: 'Contact form' }],
    ['account_change', actionProposal({ type: 'left_click', x: 20, y: 20 }), { ...observation, title: 'Change account settings', semanticTargets: [] }],
    ['upload', actionProposal({ type: 'left_click', x: 20, y: 20 }), { ...observation, title: 'Upload file', semanticTargets: [] }],
    ['download', actionProposal({ type: 'left_click', x: 20, y: 20 }), { ...observation, title: 'Download report', semanticTargets: [] }],
    ['credential_entry', actionProposal({ type: 'insert_text', text: 'hunter2' }), { ...observation, title: 'Enter password' }],
    ['sensitive_disclosure', actionProposal({ type: 'insert_text', text: '123-45-6789' }), { ...observation, title: 'Tax form' }],
  ])('requires approval for %s actions', async (category, proposal, currentObservation = observation) => {
    const adapter = new PolicyAdapter({ now: () => '2026-08-03T10:00:02.000Z' });

    const decision = await adapter.evaluate(policyInput(proposal as ActionProposalV1, currentObservation), signal);

    expect(decision.decision).toBe('approval_required');
    expect(adapter.getEvaluation(policyInput(proposal as ActionProposalV1).workId)?.category).toBe(category);
  });

  it.each([
    ['purchase', denyingPolicy('make_purchase'), observation],
    ['upload', denyingPolicy('upload_file'), {
      ...observation,
      title: 'Files',
      semanticTargets: [{
        ...observation.semanticTargets[0]!,
        accessibleName: { source: 'visible_text' as const, text: 'Upload file' },
      }],
    }],
  ])('keeps an explicit policy-engine deny terminal for %s actions', async (_category, policyEngine, currentObservation) => {
    const adapter = new PolicyAdapter({
      policyEngine,
      now: () => '2026-08-03T10:00:02.000Z',
    });
    const proposal = actionProposal({
      type: 'left_click',
      x: 20,
      y: 20,
      targetId: currentObservation.semanticTargets[0]!.targetId,
    });

    const decision = await adapter.evaluate(policyInput(proposal, currentObservation), signal);

    expect(decision.decision).toBe('denied');
  });

  it.each([
    ['RFC1918', ['10.0.0.8']],
    ['loopback', ['127.0.0.1']],
    ['IPv4 link-local', ['169.254.1.8']],
    ['IPv6 link-local', ['fe80::1']],
    ['reserved documentation space', ['192.0.2.1']],
    ['mixed rebinding answers', ['93.184.216.34', '192.168.1.9']],
    ['IPv4-mapped loopback', ['::ffff:7f00:1']],
  ])('denies a public hostname resolving to %s', async (_case, addresses) => {
    const adapter = new PolicyAdapter({
      hostResolver: resolver(addresses),
      now: () => '2026-08-03T10:00:02.000Z',
    });
    const proposal = actionProposal({ type: 'visit_url', url: 'https://public.example/resource' });

    const decision = await adapter.evaluate(policyInput(proposal), signal);

    expect(decision.decision).toBe('denied');
  });

  it('fails closed when hostname resolution fails', async () => {
    const adapter = new PolicyAdapter({ hostResolver: resolver(new Error('DNS unavailable')) });
    const proposal = actionProposal({ type: 'visit_url', url: 'https://public.example/resource' });

    expect((await adapter.evaluate(policyInput(proposal), signal)).decision).toBe('denied');
  });

  it('allows resolution failure only under an explicit administrator override', async () => {
    const adapter = new PolicyAdapter({
      hostResolver: resolver(new Error('DNS unavailable')),
      administratorOverrides: { allowUnresolvedHosts: true },
    });
    const proposal = actionProposal({ type: 'visit_url', url: 'https://public.example/resource' });

    expect((await adapter.evaluate(policyInput(proposal), signal)).decision).toBe('allowed');
  });

  it('classifies IPv4-mapped IPv6 literals with normalized hexadecimal forms', async () => {
    const adapter = new PolicyAdapter();
    const proposal = actionProposal({ type: 'visit_url', url: 'https://example.com' });
    (proposal.action as { url: string }).url = 'http://[::ffff:7f00:1]/admin';

    expect((await adapter.evaluate(policyInput(proposal), signal)).decision).toBe('denied');
  });

  it('requires approval for an unlabeled coordinate click', async () => {
    const adapter = new PolicyAdapter();
    const currentObservation = { ...observation, title: 'Página', semanticTargets: [] } as ObservationV1;

    const decision = await adapter.evaluate(
      policyInput(actionProposal({ type: 'left_click', x: 700, y: 500 }), currentObservation),
      signal,
    );

    expect(decision.decision).toBe('approval_required');
  });

  it('requires approval for a localized control whose consequence is unknown', async () => {
    const currentObservation = {
      ...observation,
      title: 'Reserva',
      semanticTargets: [{
        ...observation.semanticTargets[0]!,
        accessibleName: { source: 'visible_text' as const, text: 'Confirmar' },
      }],
    } as ObservationV1;
    const adapter = new PolicyAdapter();

    const decision = await adapter.evaluate(policyInput(actionProposal({
      type: 'left_click',
      x: 20,
      y: 20,
      targetId: currentObservation.semanticTargets[0]!.targetId,
    }), currentObservation), signal);

    expect(decision.decision).toBe('approval_required');
  });

  it('uses coordinate hit testing to classify a semantic purchase target', async () => {
    const adapter = new PolicyAdapter();
    const currentObservation = { ...observation, title: 'Store' } as ObservationV1;

    const decision = await adapter.evaluate(
      policyInput(actionProposal({ type: 'left_click', x: 20, y: 20 }), currentObservation),
      signal,
    );

    expect(decision.decision).toBe('approval_required');
    expect(adapter.getEvaluation(policyInput(actionProposal({ type: 'left_click', x: 20, y: 20 })).workId))
      .toMatchObject({ category: 'purchase' });
  });

  it('requires approval when a supplied target ID disagrees with click coordinates', async () => {
    const declaredTab = {
      ...observation.semanticTargets[0]!,
      role: 'tab',
      accessibleName: { source: 'visible_text' as const, text: 'Details' },
      boundingBox: { x: 0, y: 0, width: 100, height: 40 },
    };
    const purchaseButton = {
      ...observation.semanticTargets[0]!,
      targetId: '99999999-9999-4999-8999-999999999999',
      accessibleName: { source: 'visible_text' as const, text: 'Buy now' },
      boundingBox: { x: 200, y: 0, width: 100, height: 40 },
    };
    const currentObservation = {
      ...observation,
      title: 'Store',
      semanticTargets: [declaredTab, purchaseButton],
    } as ObservationV1;
    const adapter = new PolicyAdapter({ policyEngine: denyingPolicy('make_purchase') });

    const decision = await adapter.evaluate(policyInput(actionProposal({
      type: 'left_click',
      x: 220,
      y: 20,
      targetId: declaredTab.targetId,
    }), currentObservation), signal);

    expect(decision.decision).toBe('denied');
  });

  it('requires approval for text insertion without a trustworthy semantic target', async () => {
    const adapter = new PolicyAdapter();
    const currentObservation = { ...observation, title: 'Editor', semanticTargets: [] } as ObservationV1;

    const decision = await adapter.evaluate(
      policyInput(actionProposal({ type: 'insert_text', text: 'hello' }), currentObservation),
      signal,
    );

    expect(decision.decision).toBe('approval_required');
  });

  it.each([
    'javascript:alert(1)',
    'http://127.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/admin',
    'http://[fc00::1]/admin',
    'http://[fe80::1]/admin',
  ])('denies unsafe navigation to %s', async (url) => {
    const adapter = new PolicyAdapter({ now: () => '2026-08-03T10:00:02.000Z' });
    const proposal = actionProposal({ type: 'visit_url', url: 'https://example.com' });
    (proposal.action as { url: string }).url = url;

    const decision = await adapter.evaluate(policyInput(proposal), signal);

    expect(decision.decision).toBe('denied');
  });

  it('allows an administrator-configured private-network target', async () => {
    const adapter = new PolicyAdapter({
      now: () => '2026-08-03T10:00:02.000Z',
      administratorOverrides: { allowedPrivateHosts: ['127.0.0.1'] },
    });
    const proposal = actionProposal({ type: 'visit_url', url: 'https://example.com' });
    (proposal.action as { url: string }).url = 'http://127.0.0.1/admin';

    const decision = await adapter.evaluate(policyInput(proposal), signal);

    expect(decision.decision).toBe('allowed');
  });

  it('allows an administrator-configured navigation scheme', async () => {
    const adapter = new PolicyAdapter({
      now: () => '2026-08-03T10:00:02.000Z',
      administratorOverrides: { allowedSchemes: ['http', 'https', 'web+internal'] },
    });
    const proposal = actionProposal({ type: 'visit_url', url: 'https://example.com' });
    (proposal.action as { url: string }).url = 'web+internal://public.example/resource';

    const decision = await adapter.evaluate(policyInput(proposal), signal);

    expect(decision.decision).toBe('allowed');
  });

  it('honors cancellation before policy evaluation', async () => {
    const adapter = new PolicyAdapter();
    const controller = new AbortController();
    controller.abort(new DOMException('cancelled', 'AbortError'));

    await expect(adapter.evaluate(
      policyInput(actionProposal({ type: 'wait', durationMs: 100 })),
      controller.signal,
    )).rejects.toMatchObject({ name: 'AbortError' });
  });
});
