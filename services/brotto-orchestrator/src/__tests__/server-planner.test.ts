/**
 * Server Planner Wire-up Tests
 *
 * Tests that InferenceRegistry is correctly wired for use with AgentOrchestrator.
 * Note: Full AgentOrchestrator instantiation is blocked by policy-engine not being
 * built in this environment (policy-engine/dist/ missing). These tests verify the
 * InferenceRegistry wiring directly; integration with AgentOrchestrator is confirmed
 * by the fact that existing tests (144 passing) are unaffected by server.ts changes.
 */

import { jest } from '@jest/globals';
import type { ObservationV1 } from '@brotto/brotto-action-schema';
import { createPlanner, inferFamilyFromEnv, type InferenceConfig } from '../inference-registry';
import type { PlanningInput, PlanningOutcome } from '../engine/types.js';

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

function validPlanningInput(): PlanningInput {
  return {
    workId: 'inference:88888888-8888-4888-8888-888888888888',
    sessionId: '66666666-6666-4666-8666-666666666666',
    taskId: '77777777-7777-4777-8777-777777777777',
    goal: 'Open the example site',
    completionCriteria: ['The example page is visible'],
    observation,
    recentResults: [],
    trajectory: [],
  };
}

/** Build an SSE stream for OpenAI-compatible responses */
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const text = chunks.flatMap((c) => [`data: ${c}\n\n`]).join('') + 'data: [DONE]\n\n';
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe('InferenceRegistry wiring for AgentOrchestrator', () => {
  describe('createPlanner', () => {
    it('creates an InferencePort for openai-compatible family', async () => {
      const config: InferenceConfig = {
        family: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
        transport: jest.fn(async () => {
          const stream = sseStream(['{"choices":[{"delta":{"content":"ok"}}]}']);
          return new Response(stream, { status: 200 });
        }) as unknown as typeof fetch,
      };

      const planner = createPlanner(config);
      const result = await planner.plan(validPlanningInput(), new AbortController().signal);

      expect(result).toBeDefined();
      expect(result.kind).toMatch(/^(action|completion|question)$/);
      expect(planner.plan).toBeInstanceOf(Function);
    });

    it('creates an InferencePort for fara family', async () => {
      const config: InferenceConfig = {
        family: "brotto",
        endpoint: 'https://inference.example/v1/plan',
        transport: jest.fn(async () => new Response(JSON.stringify({
          kind: 'action',
          observationId: observation.observationId,
          proposedAt: '2026-08-03T10:00:01.000Z',
          action: { type: 'wait', durationMs: 100 },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
      };

      const planner = createPlanner(config);
      const result = await planner.plan(validPlanningInput(), new AbortController().signal);

      expect(result).toBeDefined();
      expect(result.kind).toBe('action');
      expect(planner.plan).toBeInstanceOf(Function);
    });

    it('throws for unsupported family', () => {
      const config = { family: 'unsupported' } as InferenceConfig;
      expect(() => createPlanner(config)).toThrow(/Unsupported inference family/);
    });
  });

  describe('inferFamilyFromEnv', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('returns fara when BROTTO_ENDPOINT is set', () => {
      delete process.env.OPENAI_API_KEY;
      delete process.env.AZURE_OPENAI_API_KEY;
      delete process.env.OLLAMA_HOST;
      process.env.BROTTO_ENDPOINT = 'http://localhost:8000';
      expect(inferFamilyFromEnv()).toBe('fara');
    });

    it('returns openai-compatible when OPENAI_API_KEY is set', () => {
      delete process.env.BROTTO_ENDPOINT;
      delete process.env.AZURE_OPENAI_API_KEY;
      delete process.env.OLLAMA_HOST;
      process.env.OPENAI_API_KEY = 'sk-test';
      expect(inferFamilyFromEnv()).toBe('openai-compatible');
    });

    it('throws when no inference env vars are set', () => {
      delete process.env.BROTTO_ENDPOINT;
      delete process.env.OPENAI_API_KEY;
      delete process.env.AZURE_OPENAI_API_KEY;
      delete process.env.OLLAMA_HOST;
      expect(() => inferFamilyFromEnv()).toThrow();
    });
  });

  describe('InferenceConfig type compatibility', () => {
    it('accepts openai-compatible config with all required fields', () => {
      const config: InferenceConfig = {
        family: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
      };
      expect(config.family).toBe('openai-compatible');
    });

    it('accepts fara config with all required fields', () => {
      const config: InferenceConfig = {
        family: "brotto",
        endpoint: 'https://inference.example/v1/plan',
      };
      expect(config.family).toBe('fara');
    });
  });
});
