import { jest } from '@jest/globals';
import type { ObservationV1, TrajectoryEventV1 } from '@fara-platform/fara-action-schema';
import {
  FaraPlanner,
  FaraPlannerError,
  FaraPlannerRequestError,
} from '../adapters/fara-planner.js';
import type { PlanningInput } from '../engine/types.js';

const observation = {
  observationId: '11111111-1111-4111-8111-111111111111',
  capturedAt: '2026-08-03T10:00:00.000Z',
  url: 'https://example.com/',
  title: 'Example',
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
  semanticTargets: [],
} as ObservationV1;

const trajectory: TrajectoryEventV1[] = [{
  eventId: '55555555-5555-4555-8555-555555555555',
  sessionId: '66666666-6666-4666-8666-666666666666',
  taskId: '77777777-7777-4777-8777-777777777777',
  observationId: observation.observationId,
  sequence: 1,
  occurredAt: observation.capturedAt,
  kind: 'observation_captured',
  summary: 'Observation accepted',
}];

function planningInput(): PlanningInput {
  return {
    workId: 'inference:88888888-8888-4888-8888-888888888888',
    sessionId: '66666666-6666-4666-8666-666666666666',
    taskId: '77777777-7777-4777-8777-777777777777',
    goal: 'Open the example site',
    completionCriteria: ['The example page is visible'],
    observation,
    recentResults: [],
    trajectory,
  };
}

describe('FaraPlanner', () => {
  it('sends only the v1 planning contract and retains response provenance', async () => {
    let request: { input: string; init?: RequestInit } | undefined;
    const transport = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      request = { input: String(input), init };
      return new Response(JSON.stringify({
        kind: 'action',
        observationId: observation.observationId,
        proposedAt: '2026-08-03T10:00:01.000Z',
        action: { type: 'wait', durationMs: 100 },
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'request-123',
          'x-fara-model': 'fara1.5-9b',
          'x-fara-finish-reason': 'stop',
          'x-fara-usage': JSON.stringify({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }),
        },
      });
    });
    const planner = new FaraPlanner({ endpoint: 'https://inference.example/v1/plan', transport });

    const proposal = await planner.plan(planningInput(), new AbortController().signal);

    expect(proposal.kind).toBe('action');
    expect(request?.input).toBe('https://inference.example/v1/plan');
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      goal: 'Open the example site',
      completionCriteria: ['The example page is visible'],
      observation,
      trajectory,
      limits: { maxTokens: 2048, maxRepairAttempts: 2 },
    });
    expect(planner.getDiagnostic(planningInput().workId)).toEqual({
      workId: planningInput().workId,
      requestId: 'request-123',
      model: 'fara1.5-9b',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
    });
  });

  it('maps contract errors without synthesizing an action', async () => {
    const planner = new FaraPlanner({
      endpoint: 'https://inference.example/v1/plan',
      transport: async () => new Response(JSON.stringify({
        kind: 'contract_error',
        code: 'INFERENCE_CONTRACT_ERROR',
        message: 'Model output remained invalid after repairs',
        retryable: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });

    await expect(planner.plan(planningInput(), new AbortController().signal)).rejects.toEqual(
      expect.objectContaining<FaraPlannerError>({
        code: 'INFERENCE_CONTRACT_ERROR',
        retryable: false,
        message: 'Model output remained invalid after repairs',
      }),
    );
  });

  it('does not misclassify a transient HTTP failure as a model contract failure', async () => {
    const planner = new FaraPlanner({
      endpoint: 'https://inference.example/v1/plan',
      transport: async () => new Response('unavailable', { status: 503 }),
    });

    await expect(planner.plan(planningInput(), new AbortController().signal)).rejects.toEqual(
      expect.objectContaining<FaraPlannerRequestError>({
        code: 'INFERENCE_HTTP_ERROR',
        retryable: true,
      }),
    );
  });

  it('passes cancellation to the planning request', async () => {
    let receivedSignal: AbortSignal | undefined;
    const planner = new FaraPlanner({
      endpoint: 'https://inference.example/v1/plan',
      transport: async (_input, init) => {
        receivedSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          receivedSignal?.addEventListener('abort', () => reject(receivedSignal?.reason), { once: true });
        });
      },
    });
    const controller = new AbortController();
    const pending = planner.plan(planningInput(), controller.signal);

    controller.abort(new DOMException('cancelled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(receivedSignal).toBe(controller.signal);
  });
});
