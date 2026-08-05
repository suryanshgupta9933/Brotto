import { OpenAICompatiblePlanner, OpenAICompatiblePlannerError } from '../adapters/openai-compatible-planner.js';
import type { OpenAICompatibleConfig } from '../adapters/openai-compatible-planner.js';
import type { PlanningInput } from '../engine/types.js';
import type { ObservationV1 } from '@fara-platform/fara-action-schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an SSE stream that emits each chunk prefixed with "data: " and
 *  terminated by "\n\n", culminating in a "data: [DONE]\n\n" sentinel. */
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const text = chunks.flatMap((c) => [`data: ${c}\n\n`]).join('') + 'data: [DONE]\n\n';
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function mockResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

const minimalObservation: ObservationV1 = {
  observationId: '00000000-0000-0000-0000-000000000001',
  capturedAt: new Date().toISOString(),
  url: 'https://example.com',
  title: 'test',
  screenshot: { kind: 'artifact', artifactId: 'artifact-1', sha256: 'a'.repeat(64), width: 1920, height: 1080, encoding: 'png' },
  viewport: { width: 1920, height: 1080, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
  page: { tabId: 'tab-1', frameId: 'frame-1', lifecycle: 'complete', visibility: 'visible' },
  semanticTargets: [],
};

function makeInput(): PlanningInput {
  return {
    workId: 'work-1',
    sessionId: 'session-1' as import('@fara-platform/fara-action-schema').SessionId,
    taskId: 'task-1' as import('@fara-platform/fara-action-schema').TaskId,
    goal: 'Test goal',
    completionCriteria: ['criterion 1'],
    observation: minimalObservation,
    recentResults: [],
    trajectory: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenAICompatiblePlanner', () => {
  // Test 1: POSTs to {baseUrl}/chat/completions with stream:true and tool schemas
  it('POSTs to {baseUrl}/chat/completions with stream:true and tool schemas', async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    let capturedBody: unknown | undefined;

    const transport = (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init.headers as Record<string, string>;
      capturedBody = JSON.parse(init.body as string);
      // Respond with a content chunk followed by [DONE]
      const stream = sseStream(['{"choices":[{"delta":{"content":"ok"}}]}']);
      return Promise.resolve(new Response(stream, { status: 200 }));
    };

    const planner = new OpenAICompatiblePlanner({
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model',
      transport,
    });

    await planner.plan(makeInput(), new AbortController().signal);

    expect(capturedUrl).toBe('https://api.example.com/v1/chat/completions');
    expect(capturedHeaders!['content-type']).toBe('application/json');
    expect(capturedBody).toMatchObject({
      model: 'test-model',
      stream: true,
      tool_choice: 'auto',
    });
    expect(capturedBody).toHaveProperty('tools');
    expect(Array.isArray((capturedBody as Record<string, unknown>).tools)).toBe(true);
  });

  // Test 2: Uses api-key header for Azure OpenAI (apiKeyHeader: "api-key")
  it('uses custom api-key header for Azure OpenAI', async () => {
    let capturedHeaders: Record<string, string> | undefined;

    const transport = (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      const stream = sseStream(['{"choices":[{"delta":{"content":"ok"}}]}']);
      return Promise.resolve(new Response(stream, { status: 200 }));
    };

    const planner = new OpenAICompatiblePlanner({
      baseUrl: 'https://example.openai.azure.com',
      apiKey: 'azure-key',
      apiKeyHeader: 'api-key',
      model: 'gpt-4o',
      transport,
    });

    await planner.plan(makeInput(), new AbortController().signal);

    expect(capturedHeaders!['api-key']).toBe('azure-key');
    expect(capturedHeaders!['authorization']).toBeUndefined();
  });

  // Test 3: Skips auth header when apiKey omitted (Ollama case)
  it('skips auth header when apiKey is omitted', async () => {
    let capturedHeaders: Record<string, string> | undefined;

    const transport = (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      const stream = sseStream(['{"choices":[{"delta":{"content":"ok"}}]}']);
      return Promise.resolve(new Response(stream, { status: 200 }));
    };

    const planner = new OpenAICompatiblePlanner({
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
      transport,
    });

    await planner.plan(makeInput(), new AbortController().signal);

    expect(capturedHeaders!['authorization']).toBeUndefined();
    expect(capturedHeaders!['api-key']).toBeUndefined();
  });

  // Test 4: HTTP 401 -> retryable=false
  it('throws non-retryable error on HTTP 401', async () => {
    const transport = () =>
      Promise.resolve(mockResponse(401, 'Unauthorized'));

    const planner = new OpenAICompatiblePlanner({
      baseUrl: 'https://api.example.com',
      apiKey: 'bad-key',
      model: 'test-model',
      transport,
    });

    await expect(
      planner.plan(makeInput(), new AbortController().signal),
    ).rejects.toThrow(OpenAICompatiblePlannerError);

    try {
      await planner.plan(makeInput(), new AbortController().signal);
    } catch (e) {
      expect(e).toBeInstanceOf(OpenAICompatiblePlannerError);
      expect((e as OpenAICompatiblePlannerError).retryable).toBe(false);
    }
  });

  // Test 5: HTTP 429 -> retryable=true
  it('throws retryable error on HTTP 429', async () => {
    const transport = () =>
      Promise.resolve(mockResponse(429, 'Too Many Requests'));

    const planner = new OpenAICompatiblePlanner({
      baseUrl: 'https://api.example.com',
      apiKey: 'key',
      model: 'test-model',
      transport,
    });

    try {
      await planner.plan(makeInput(), new AbortController().signal);
    } catch (e) {
      expect(e).toBeInstanceOf(OpenAICompatiblePlannerError);
      expect((e as OpenAICompatiblePlannerError).retryable).toBe(true);
      return;
    }
    fail('Expected error to be thrown');
  });

  // Test 6: HTTP 500 -> retryable=true
  it('throws retryable error on HTTP 500', async () => {
    const transport = () =>
      Promise.resolve(mockResponse(500, 'Internal Server Error'));

    const planner = new OpenAICompatiblePlanner({
      baseUrl: 'https://api.example.com',
      model: 'test-model',
      transport,
    });

    try {
      await planner.plan(makeInput(), new AbortController().signal);
    } catch (e) {
      expect(e).toBeInstanceOf(OpenAICompatiblePlannerError);
      expect((e as OpenAICompatiblePlannerError).retryable).toBe(true);
      return;
    }
    fail('Expected error to be thrown');
  });

  // Test 7: Skips malformed SSE chunks (one bad chunk, valid follows)
  it('skips malformed SSE chunks and processes valid ones', async () => {
    const stream = sseStream([
      '{"choices":[{"delta":{"content":"Hello"}}]}',
      'NOT JSON at all',
      '{"choices":[{"delta":{"content":" World"}}]}',
    ]);

    const transport = () =>
      Promise.resolve(
        new Response(stream, { status: 200 }),
      );

    const planner = new OpenAICompatiblePlanner({
      baseUrl: 'https://api.example.com',
      model: 'test-model',
      transport,
    });

    const result = await planner.plan(makeInput(), new AbortController().signal);
    expect(result.kind).toBe('completion');
    expect((result as { summary: string }).summary).toBe('Hello World');
  });

  // Test 8: Aborts when AbortSignal triggers
  it('aborts when AbortSignal is triggered', async () => {
    // A ReadableStream that hangs (never closes, never enqueues) simulates
    // a transport that is slow to respond.
    const hangingStream = new ReadableStream({
      pull() {
        // Never resolve — the reader will wait here until abort
        return new Promise(() => {});
      },
    });

    const transport = () =>
      Promise.resolve(new Response(hangingStream, { status: 200 }));

    const planner = new OpenAICompatiblePlanner({
      baseUrl: 'https://api.example.com',
      model: 'test-model',
      transport,
    });

    const controller = new AbortController();

    const planPromise = planner.plan(makeInput(), controller.signal);

    // Abort immediately — the reader will throw AbortError on next read
    controller.abort();

    await expect(planPromise).rejects.toThrow();
  }, 10000);

  // Test 9: Throws when choices array is empty
  it('throws when response choices array is empty', async () => {
    const stream = sseStream(['{"choices":[]}']);

    const transport = () =>
      Promise.resolve(new Response(stream, { status: 200 }));

    const planner = new OpenAICompatiblePlanner({
      baseUrl: 'https://api.example.com',
      model: 'test-model',
      transport,
    });

    await expect(
      planner.plan(makeInput(), new AbortController().signal),
    ).rejects.toThrow(OpenAICompatiblePlannerError);
  });
});
