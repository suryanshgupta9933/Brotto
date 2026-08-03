import { z } from 'zod';
import {
  ActionCommandV1Schema,
  ActionResultV1Schema,
  AgentProposalV1Schema,
  ObservationV1Schema,
} from '../v1';

const observationId = '11111111-1111-4111-8111-111111111111';

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
      accessibleName: 'Search',
      attributes: { 'aria-label': 'Search' },
      boundingBox: { x: 12, y: 24, width: 80, height: 32 },
      visible: true,
      framePath: [],
      locatorCandidates: ['button[aria-label="Search"]'],
    },
  ],
};

const validActionCommand = {
  actionId: '55555555-5555-4555-8555-555555555555',
  stepId: '66666666-6666-4666-8666-666666666666',
  observationId,
  sequence: 1,
  action: { type: 'left_click', x: 52, y: 40 },
  policyContext: { policyVersion: 'v1', approved: false },
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
  postObservation: validObservation,
};

describe('canonical v1 contracts', () => {
  it('accepts a sanitized HTTP(S) observation with bounded semantic targets', () => {
    const observation = ObservationV1Schema.parse(validObservation);

    expect(observation.observationId).toBe(observationId);
    expect(observation.semanticTargets[0].accessibleName).toBe('Search');
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

  it('requires an action to reference its exact source observation', () => {
    const command = ActionCommandV1Schema.parse(validActionCommand);

    expect(command.observationId).toBe(validObservation.observationId);
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
