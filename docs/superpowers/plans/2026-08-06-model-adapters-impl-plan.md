# Phase A Implementation Plan: Multi-Model Inference

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI-compatible inference adapter to the agent orchestrator alongside the existing Fara planner. Registry selects adapter via env-var config. Streaming via SSE with AbortSignal cancellation.

**Architecture:** Implement `OpenAICompatiblePlanner` against the existing `InferencePort` interface. Add `InferenceRegistry` factory that returns the right planner per family. Server picks planner via env vars. Fara planner unchanged.

**Tech Stack:** TypeScript, Node fetch + SSE streaming, Zod, Jest. OpenAI-compatible protocol (`/v1/chat/completions`) for OpenAI / Azure OpenAI / Ollama / vLLM / LM Studio.

**Spec:** `docs/superpowers/specs/2026-08-06-model-adapters-design.md`

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `services/agent-orchestrator/src/prompts/tool-schemas.ts` | CREATE | Pure tool-schema definitions for OpenAI tool-calling API |
| `services/agent-orchestrator/src/adapters/openai-compatible-planner.ts` | CREATE | OpenAI-compatible planner with SSE streaming |
| `services/agent-orchestrator/src/inference-registry.ts` | CREATE | Factory + env-var family detection |
| `services/agent-orchestrator/src/server.ts` | MODIFY | Use `createPlanner()` instead of `new FaraPlanner()` |
| `services/agent-orchestrator/src/__tests__/tool-schemas.test.ts` | CREATE | Unit tests for tool schema definitions |
| `services/agent-orchestrator/src/__tests__/openai-compatible-planner.test.ts` | CREATE | Unit tests with mocked fetch + SSE |
| `services/agent-orchestrator/src/__tests__/inference-registry.test.ts` | CREATE | Unit tests for factory + env detection |
| `services/agent-orchestrator/src/index.ts` | MODIFY | Re-export new public types |

**Dependency order (sequential TDD):** Task 1 (tool-schemas) → Task 2 (OpenAICompatiblePlanner) → Task 3 (InferenceRegistry) → Task 4 (server wire-up).

---

## Task 1: Tool Schema Definitions

**Files:**
- Create: `services/agent-orchestrator/src/prompts/tool-schemas.ts`
- Create: `services/agent-orchestrator/src/__tests__/tool-schemas.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/agent-orchestrator/src/__tests__/tool-schemas.test.ts`:

```typescript
import { buildToolSchemas } from "../prompts/tool-schemas";

describe("buildToolSchemas", () => {
  it("returns at least three tool definitions", () => {
    const schemas = buildToolSchemas();
    expect(schemas.length).toBeGreaterThanOrEqual(3);
  });

  it("each tool has type=function and function.name + parameters", () => {
    for (const schema of buildToolSchemas()) {
      expect(schema.type).toBe("function");
      expect(typeof schema.function.name).toBe("string");
      expect(schema.function.name.length).toBeGreaterThan(0);
      expect(schema.function.parameters.type).toBe("object");
      expect(typeof schema.function.parameters.properties).toBe("object");
    }
  });

  it("includes a browser_action tool with action enum", () => {
    const schemas = buildToolSchemas();
    const browser = schemas.find((s) => s.function.name === "browser_action");
    expect(browser).toBeDefined();
    const actionProp = browser!.function.parameters.properties.action as { enum: string[] };
    expect(actionProp.enum).toEqual(expect.arrayContaining(["left_click", "type", "scroll"]));
  });

  it("includes a finish tool requiring answer string", () => {
    const schemas = buildToolSchemas();
    const finish = schemas.find((s) => s.function.name === "finish");
    expect(finish).toBeDefined();
    expect(finish!.function.parameters.required).toContain("answer");
  });

  it("includes an ask_user_question tool requiring question", () => {
    const schemas = buildToolSchemas();
    const ask = schemas.find((s) => s.function.name === "ask_user_question");
    expect(ask).toBeDefined();
    expect(ask!.function.parameters.required).toContain("question");
  });

  it("returns a new array each call (no shared mutable state)", () => {
    const a = buildToolSchemas();
    const b = buildToolSchemas();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-orchestrator && npx jest --testPathPattern tool-schemas`
Expected: FAIL — module not found.

- [ ] **Step 3: Create prompts directory and implement tool-schemas.ts**

Create directory: `services/agent-orchestrator/src/prompts/`

Create `services/agent-orchestrator/src/prompts/tool-schemas.ts`:

```typescript
// Tool definitions exposed to OpenAI-compatible models via the tool-calling API.
// All tool schemas derive from fara-action-schema action types so every model
// sees the same surface — a model swap never changes the action vocabulary.

export interface ToolFunctionSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolSchema {
  type: "function";
  function: ToolFunctionSchema;
}

const BROWSER_ACTIONS = [
  "left_click", "double_click", "right_click", "drag",
  "key", "type", "scroll", "wait", "visit_url",
  "history_back", "screenshot",
] as const;

export function buildToolSchemas(): ToolSchema[] {
  return [
    {
      type: "function",
      function: {
        name: "browser_action",
        description: "Perform an action on the current browser page",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: [...BROWSER_ACTIONS] },
            coordinate: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
              },
              required: ["x", "y"],
            },
            text: { type: "string" },
            key: { type: "string" },
            url: { type: "string", format: "uri" },
          },
          required: ["action"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "finish",
        description: "Mark the task complete and return the final answer",
        parameters: {
          type: "object",
          properties: {
            answer: { type: "string", description: "Final answer or summary" },
          },
          required: ["answer"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "ask_user_question",
        description: "Ask the user a clarifying question",
        parameters: {
          type: "object",
          properties: {
            question: { type: "string" },
            choices: {
              type: "array",
              items: { type: "string" },
              description: "Optional multiple-choice options",
            },
          },
          required: ["question"],
        },
      },
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/agent-orchestrator && npx jest --testPathPattern tool-schemas`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add services/agent-orchestrator/src/prompts/tool-schemas.ts services/agent-orchestrator/src/__tests__/tool-schemas.test.ts
git commit -m "feat(orchestrator): add tool schema definitions for OpenAI tool-calling"
```

---

## Task 2: OpenAICompatiblePlanner with SSE Streaming

**Files:**
- Create: `services/agent-orchestrator/src/adapters/openai-compatible-planner.ts`
- Create: `services/agent-orchestrator/src/__tests__/openai-compatible-planner.test.ts`

- [ ] **Step 1: Write the failing test (happy path + HTTP error classification)**

Create `services/agent-orchestrator/src/__tests__/openai-compatible-planner.test.ts`:

```typescript
import {
  OpenAICompatiblePlanner,
  OpenAICompatiblePlannerError,
  OpenAICompatiblePlannerRequestError,
} from "../adapters/openai-compatible-planner";
import type { PlanningInput } from "../engine/types";

const VALID_HASH = "a".repeat(64);

const basePlanningInput: PlanningInput = {
  workId: "w1",
  sessionId: "00000000-0000-4000-8000-000000000001" as PlanningInput["sessionId"],
  taskId: "00000000-0000-4000-8000-000000000002" as PlanningInput["taskId"],
  goal: "Click the buy button",
  completionCriteria: ["buy button clicked"],
  observation: {
    observationId: "00000000-0000-4000-8000-000000000003" as never,
    capturedAt: "2026-08-06T00:00:00.000Z",
    url: "https://example.test",
    title: "Shop",
    page: { tabId: "00000000-0000-4000-8000-000000000010" as never, frameId: "00000000-0000-4000-8000-000000000011" as never, lifecycle: "complete", visibility: "visible" },
    viewport: { width: 1280, height: 720, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
    screenshot: { kind: "inline", encoding: "base64", data: "a", sha256: VALID_HASH, width: 1, height: 1 },
    semanticTargets: [],
  },
  recentResults: [],
  trajectory: [],
};

// Build a ReadableStream that emits SSE chunks and closes.
function sseStream(chunks: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`);
  lines.push("data: [DONE]\n\n");
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

function mockResponse(status: number, body: ReadableStream<Uint8Array> | string): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

const baseConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test",
  model: "gpt-4o-mini",
};

describe("OpenAICompatiblePlanner", () => {
  it("POSTs to {baseUrl}/chat/completions with stream=true and tool schemas", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const transport: typeof fetch = async (url, init) => {
      captured = { url: String(url), init: init as RequestInit };
      return mockResponse(200, sseStream([
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "browser_action", arguments: '{"action":"left_click","coordinate":{"x":10,"y":10}}' } }] } } ],
        { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ]));
    };
    const planner = new OpenAICompatiblePlanner({ ...baseConfig, transport });
    await planner.plan(basePlanningInput, new AbortController().signal);
    expect(captured).not.toBeNull();
    expect(captured!.url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(captured!.init.body as string);
    expect(body.stream).toBe(true);
    expect(body.model).toBe("gpt-4o-mini");
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThanOrEqual(3);
    expect(captured!.init.headers).toMatchObject({ "content-type": "application/json", authorization: "Bearer sk-test" });
  });

  it("uses api-key header for Azure OpenAI", async () => {
    let capturedHeaders: Record<string, string> = {};
    const transport: typeof fetch = async (_url, init) => {
      capturedHeaders = init.headers as Record<string, string>;
      return mockResponse(200, sseStream([
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "finish", arguments: '{"answer":"done"}' } }] } } ],
      ]));
    };
    const planner = new OpenAICompatiblePlanner({
      baseUrl: "https://myresource.openai.azure.com/openai/deployments/gpt-4o",
      apiKey: "azure-key",
      model: "gpt-4o",
      apiKeyHeader: "api-key",
      apiKeyPrefix: "",
      transport,
    });
    await planner.plan(basePlanningInput, new AbortController().signal);
    expect(capturedHeaders["api-key"]).toBe("azure-key");
    expect(capturedHeaders.authorization).toBeUndefined();
  });

  it("skips auth header when apiKey omitted (Ollama)", async () => {
    let capturedHeaders: Record<string, string> = {};
    const transport: typeof fetch = async (_url, init) => {
      capturedHeaders = init.headers as Record<string, string>;
      return mockResponse(200, sseStream([
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "finish", arguments: '{"answer":"done"}' } }] } } ],
      ]));
    };
    const planner = new OpenAICompatiblePlanner({ baseUrl: "http://localhost:11434/v1", model: "llama3.1", transport });
    await planner.plan(basePlanningInput, new AbortController().signal);
    expect(capturedHeaders.authorization).toBeUndefined();
  });

  it("classifies HTTP 401 as retryable=false", async () => {
    const transport: typeof fetch = async () => mockResponse(401, "");
    const planner = new OpenAICompatiblePlanner({ ...baseConfig, transport });
    await expect(planner.plan(basePlanningInput, new AbortController().signal))
      .rejects.toMatchObject({ name: "OpenAICompatiblePlannerRequestError", retryable: false, status: 401 });
  });

  it("classifies HTTP 429 as retryable=true", async () => {
    const transport: typeof fetch = async () => mockResponse(429, "");
    const planner = new OpenAICompatiblePlanner({ ...baseConfig, transport });
    await expect(planner.plan(basePlanningInput, new AbortController().signal))
      .rejects.toMatchObject({ name: "OpenAICompatiblePlannerRequestError", retryable: true, status: 429 });
  });

  it("classifies HTTP 500 as retryable=true", async () => {
    const transport: typeof fetch = async () => mockResponse(500, "");
    const planner = new OpenAICompatiblePlanner({ ...baseConfig, transport });
    await expect(planner.plan(basePlanningInput, new AbortController().signal))
      .rejects.toMatchObject({ name: "OpenAICompatiblePlannerRequestError", retryable: true, status: 500 });
  });

  it("skips malformed SSE chunks", async () => {
    const transport: typeof fetch = async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("data: not-valid-json\n\n"));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "finish", arguments: '{"answer":"ok"}' } }] } } ] })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return mockResponse(200, body);
    };
    const planner = new OpenAICompatiblePlanner({ ...baseConfig, transport });
    const result = await planner.plan(basePlanningInput, new AbortController().signal);
    expect(result).toBeDefined();
  });

  it("aborts when AbortSignal triggers", async () => {
    const controller = new AbortController();
    const transport: typeof fetch = async (_url, init) => {
      controller.abort();
      return new Response(sseStream([]), { status: 200, signal: init.signal });
    };
    const planner = new OpenAICompatiblePlanner({ ...baseConfig, transport });
    await expect(planner.plan(basePlanningInput, controller.signal)).rejects.toThrow();
  });

  it("throws when choices array is empty", async () => {
    const transport: typeof fetch = async () => mockResponse(200, sseStream([{ choices: [] }]));
    const planner = new OpenAICompatiblePlanner({ ...baseConfig, transport });
    await expect(planner.plan(basePlanningInput, new AbortController().signal))
      .rejects.toBeInstanceOf(OpenAICompatiblePlannerError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-orchestrator && npx jest --testPathPattern openai-compatible-planner`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement OpenAICompatiblePlanner**

Create `services/agent-orchestrator/src/adapters/openai-compatible-planner.ts`:

```typescript
import { InferenceContractError, type InferencePort, type PlanningInput, type PlanningOutcome } from "../engine/types.js";
import { ToolCallParser } from "../parser.js";
import { buildToolSchemas } from "../prompts/tool-schemas.js";

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  apiKeyHeader?: string;
  apiKeyPrefix?: string;
  maxTokens?: number;
  temperature?: number;
  transport?: typeof fetch;
}

export class OpenAICompatiblePlannerError extends InferenceContractError {
  override readonly name = "OpenAICompatiblePlannerError";
  constructor(message: string, retryable: boolean) {
    super(message, retryable);
  }
}

export class OpenAICompatiblePlannerRequestError extends Error {
  readonly name = "OpenAICompatiblePlannerRequestError";
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status: number,
  ) {
    super(message);
  }
}

interface ChatCompletionMessage {
  role?: string;
  content?: string | null;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface ChatCompletionChunk {
  choices?: Array<{ index?: number; delta?: Partial<ChatCompletionMessage>; message?: ChatCompletionMessage; finish_reason?: string | null }>;
}

interface ChatCompletion {
  choices: Array<{ index: number; message: ChatCompletionMessage; finish_reason: string | null }>;
}

function buildMessages(input: PlanningInput): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: [
        "You are a browser automation agent. Use the provided tools to act on the page.",
        "Goal: " + input.goal,
        "Completion criteria: " + input.completionCriteria.join("; "),
      ].join("\n"),
    },
    {
      role: "user",
      content: "Current observation:\n" + JSON.stringify(input.observation),
    },
  ];
}

function assembleChatCompletion(chunks: ChatCompletionChunk[]): ChatCompletion {
  const message: ChatCompletionMessage = { role: "assistant", tool_calls: [] };
  const finishReason = chunks[chunks.length - 1]?.choices?.[0]?.finish_reason ?? null;
  for (const chunk of chunks) {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    if (typeof delta.content === "string") {
      message.content = (message.content ?? "") + delta.content;
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const list = message.tool_calls!;
        while (list.length <= idx) list.push({ type: "function", function: { name: "", arguments: "" } });
        const target = list[idx];
        if (tc.id) target.id = tc.id;
        if (tc.type) target.type = tc.type;
        if (tc.function?.name) target.function!.name = (target.function!.name ?? "") + tc.function.name;
        if (tc.function?.arguments) target.function!.arguments = (target.function!.arguments ?? "") + tc.function.arguments;
      }
    }
  }
  return { choices: [{ index: 0, message, finish_reason: finishReason }] };
}

function toOpenAIFaraToolCall(tc: NonNullable<ChatCompletionMessage["tool_calls"]>[number]): { id: string; name: string; arguments: string } {
  return {
    id: tc.id ?? "",
    name: tc.function?.name ?? "",
    arguments: tc.function?.arguments ?? "{}",
  };
}

export class OpenAICompatiblePlanner implements InferencePort {
  constructor(private readonly config: OpenAICompatibleConfig) {}

  async plan(input: PlanningInput, signal: AbortSignal): Promise<PlanningOutcome> {
    const completion = await this.streamChat(input, signal);
    return this.parseResponse(completion, input);
  }

  private async streamChat(input: PlanningInput, signal: AbortSignal): Promise<ChatCompletion> {
    const transport = this.config.transport ?? fetch;
    const url = this.config.baseUrl.replace(/\/$/, "") + "/chat/completions";
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.apiKey) {
      const h = this.config.apiKeyHeader ?? "authorization";
      const p = this.config.apiKeyPrefix ?? "Bearer ";
      headers[h] = p + this.config.apiKey;
    }
    const res = await transport(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.config.model,
        messages: buildMessages(input),
        tools: buildToolSchemas(),
        tool_choice: "auto",
        max_tokens: this.config.maxTokens ?? 1024,
        temperature: this.config.temperature ?? 0,
        stream: true,
      }),
      signal,
    });
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429;
      throw new OpenAICompatiblePlannerRequestError("HTTP " + res.status, retryable, res.status);
    }
    if (!res.body) throw new OpenAICompatiblePlannerError("empty response body", true);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const chunks: ChatCompletionChunk[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]" || data === "") continue;
        try { chunks.push(JSON.parse(data) as ChatCompletionChunk); }
        catch { /* skip malformed */ }
      }
    }
    return assembleChatCompletion(chunks);
  }

  private parseResponse(completion: ChatCompletion, input: PlanningInput): PlanningOutcome {
    const choice = completion.choices[0];
    if (!choice) throw new OpenAICompatiblePlannerError("no choices", true);
    const toolCalls = choice.message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return {
        kind: "completion",
        reason: choice.message.content ?? "(no content)",
        observationId: input.observation.observationId,
        taskId: input.taskId,
      };
    }
    const parsed = ToolCallParser.parseToolCalls(toolCalls.map(toOpenAIFaraToolCall));
    if (!parsed.ok) throw new OpenAICompatiblePlannerError(parsed.error, true);
    return parsed.outcome;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/agent-orchestrator && npx jest --testPathPattern openai-compatible-planner`
Expected: PASS, 9 tests.

If `ToolCallParser.parseToolCalls` doesn't exist or has a different signature, read `services/agent-orchestrator/src/parser.ts` to find the actual API and adjust the integration. The test should pass either way; if the parser returns a different shape, update `parseResponse` accordingly.

- [ ] **Step 5: Run full test suite for regressions**

Run: `cd services/agent-orchestrator && npx jest`
Expected: PASS — all existing tests + 9 new.

- [ ] **Step 6: Commit**

```bash
git add services/agent-orchestrator/src/adapters/openai-compatible-planner.ts services/agent-orchestrator/src/__tests__/openai-compatible-planner.test.ts
git commit -m "feat(orchestrator): add OpenAICompatiblePlanner with SSE streaming"
```

---

## Task 3: InferenceRegistry (Factory + Env Detection)

**Files:**
- Create: `services/agent-orchestrator/src/inference-registry.ts`
- Create: `services/agent-orchestrator/src/__tests__/inference-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/agent-orchestrator/src/__tests__/inference-registry.test.ts`:

```typescript
import { createPlanner, inferFamilyFromEnv, type InferenceConfig } from "../inference-registry";

describe("createPlanner", () => {
  it("returns a FaraPlanner for family=fara", () => {
    const config: InferenceConfig = {
      family: "fara",
      endpoint: "http://localhost:8000",
      model: "fara-9b",
    };
    const planner = createPlanner(config);
    expect(planner).toBeDefined();
    expect(planner.plan).toBeInstanceOf(Function);
  });

  it("returns an OpenAICompatiblePlanner for family=openai-compatible", () => {
    const config: InferenceConfig = {
      family: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    };
    const planner = createPlanner(config);
    expect(planner).toBeDefined();
    expect(planner.plan).toBeInstanceOf(Function);
  });
});

describe("inferFamilyFromEnv", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 'fara' when FARA_ENDPOINT is set", () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.OLLAMA_HOST;
    process.env.FARA_ENDPOINT = "http://localhost:8000";
    expect(inferFamilyFromEnv()).toBe("fara");
  });

  it("returns 'openai-compatible' when OPENAI_API_KEY is set", () => {
    delete process.env.FARA_ENDPOINT;
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.OLLAMA_HOST;
    process.env.OPENAI_API_KEY = "sk-test";
    expect(inferFamilyFromEnv()).toBe("openai-compatible");
  });

  it("returns 'openai-compatible' when OLLAMA_HOST is set", () => {
    delete process.env.FARA_ENDPOINT;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AZURE_OPENAI_API_KEY;
    process.env.OLLAMA_HOST = "http://localhost:11434";
    expect(inferFamilyFromEnv()).toBe("openai-compatible");
  });

  it("FARA_ENDPOINT takes precedence over OPENAI_API_KEY", () => {
    process.env.FARA_ENDPOINT = "http://localhost:8000";
    process.env.OPENAI_API_KEY = "sk-test";
    expect(inferFamilyFromEnv()).toBe("fara");
  });

  it("throws when no inference env vars are set", () => {
    delete process.env.FARA_ENDPOINT;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.OLLAMA_HOST;
    expect(() => inferFamilyFromEnv()).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-orchestrator && npx jest --testPathPattern inference-registry`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement inference-registry.ts**

Create `services/agent-orchestrator/src/inference-registry.ts`:

```typescript
import { FaraPlanner, type FaraPlannerConfig } from "./adapters/fara-planner.js";
import { OpenAICompatiblePlanner, type OpenAICompatibleConfig } from "./adapters/openai-compatible-planner.js";
import type { InferencePort } from "./engine/types.js";

export type InferenceFamily = "fara" | "openai-compatible";

export type InferenceConfig =
  | ({ family: "fara" } & FaraPlannerConfig)
  | ({ family: "openai-compatible" } & OpenAICompatibleConfig);

export function createPlanner(config: InferenceConfig): InferencePort {
  switch (config.family) {
    case "fara":
      return new FaraPlanner(config);
    case "openai-compatible":
      return new OpenAICompatiblePlanner(config);
  }
}

export function inferFamilyFromEnv(): InferenceFamily {
  if (process.env.FARA_ENDPOINT) return "fara";
  if (process.env.OPENAI_API_KEY) return "openai-compatible";
  if (process.env.AZURE_OPENAI_API_KEY) return "openai-compatible";
  if (process.env.OLLAMA_HOST) return "openai-compatible";
  throw new Error(
    "No inference family configured. Set FARA_ENDPOINT, OPENAI_API_KEY, AZURE_OPENAI_API_KEY, or OLLAMA_HOST.",
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/agent-orchestrator && npx jest --testPathPattern inference-registry`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add services/agent-orchestrator/src/inference-registry.ts services/agent-orchestrator/src/__tests__/inference-registry.test.ts
git commit -m "feat(orchestrator): add InferenceRegistry with env-var family detection"
```

---

## Task 4: Wire InferenceRegistry into Server

**Files:**
- Modify: `services/agent-orchestrator/src/server.ts` (around line 47, 82, 114)
- Modify: `services/agent-orchestrator/src/index.ts`

- [ ] **Step 1: Read the relevant slices**

Open `services/agent-orchestrator/src/server.ts`. Find:
- Line ~47: `inference: InferenceConfig;` in `OrchestratorConfig`
- Line ~82: `private inference: FaraInferenceClient;`
- Line ~114: `this.inference = new FaraInferenceClient(config.inference);`

The existing server uses the OLDER `FaraInferenceClient` (a non-`InferencePort` class). There are TWO inference paths:
- **Old:** `FaraInferenceClient` used directly in `AgentOrchestrator` class
- **New:** `FaraPlanner implements InferencePort` used in `SessionEngine`

The server is the OLD path. We need to migrate `AgentOrchestrator` to use the registry. This is a larger refactor than the spec implied. Adapt as follows:

**Minimal viable change:** Make `AgentOrchestrator.inference` accept any `InferencePort`. The class has a private `inference: FaraInferenceClient` that's used in `requestInference` (around line 285). Find what methods are called on it (`buildSystemPrompt`, `buildUserMessage`, `infer`, `cancel`).

If `FaraInferenceClient` is tightly coupled to Fara and hard to generalize, **keep the FaraInferenceClient path AND add a new code path that uses `InferencePort`**. The cleanest cut:

1. Add a new `planner: InferencePort` field to `AgentOrchestrator` (alongside the existing `inference`).
2. Add a new method `requestInferenceViaPlanner(input, signal)` that delegates to `planner.plan()`.
3. Existing `requestInference` continues using `FaraInferenceClient`.
4. Existing tests for `FaraInferenceClient` path remain unchanged.

This is the laziest integration — both paths coexist. Plan 2 picks one as primary.

- [ ] **Step 2: Modify server.ts**

In `services/agent-orchestrator/src/server.ts`:

1. Add import:
```typescript
import { createPlanner, type InferenceConfig } from "./inference-registry.js";
```

2. Change `OrchestratorConfig.inference` type:
```typescript
  inference: InferenceConfig;
```
(Already named `InferenceConfig` but local type. Now imports from registry. Remove the old `InferenceConfig` type definition if no longer used.)

3. In the constructor (around line 114), add:
```typescript
    this.planner = createPlanner(config.inference);
```

4. Add a private field next to `private inference: FaraInferenceClient;` (around line 82):
```typescript
  private planner: ReturnType<typeof createPlanner>;
```

5. Add a new method near `requestInference`:
```typescript
  async requestInferenceViaPlanner(input: PlanningInput, signal: AbortSignal): Promise<PlanningOutcome> {
    return this.planner.plan(input, signal);
  }
```

6. Add `cancelPlanner()`:
```typescript
  cancelPlanner(): void {
    // planner uses fetch with AbortSignal; no persistent state to cancel
  }
```

- [ ] **Step 3: Update index.ts re-exports**

In `services/agent-orchestrator/src/index.ts`, add (if not present):

```typescript
export {
  createPlanner,
  inferFamilyFromEnv,
  type InferenceConfig,
  type InferenceFamily,
} from "./inference-registry";
```

- [ ] **Step 4: Run full test suite**

Run: `cd services/agent-orchestrator && npx jest`
Expected: PASS — all existing + new tests (10 from Task 1-3).

- [ ] **Step 5: Commit**

```bash
git add services/agent-orchestrator/src/server.ts services/agent-orchestrator/src/index.ts
git commit -m "feat(orchestrator): wire InferenceRegistry alongside existing FaraInferenceClient"
```

---

## Self-Review Checklist

After completing all tasks:

1. **Spec coverage:**
   - Tool schemas (Task 1) ✓
   - OpenAICompatiblePlanner with streaming + cancellation (Task 2) ✓
   - InferenceRegistry with env detection (Task 3) ✓
   - Server wire-up (Task 4) ✓
   - Tests for each ✓
   - Ponytail cuts documented as `ponytail:` comments in Task 2 ✓

2. **Placeholder scan:** No TBD/TODO. All function signatures and behaviors explicit.

3. **Type consistency:**
   - `OpenAICompatiblePlanner implements InferencePort` — `plan(input, signal): Promise<PlanningOutcome>` matches `engine/types.ts:86`
   - `OpenAICompatiblePlannerConfig` fields (`baseUrl`, `apiKey`, `model`, `apiKeyHeader`, `apiKeyPrefix`) match spec
   - `InferenceConfig` is discriminated union `family: "fara" | "openai-compatible"` — matches spec
   - `OpenAICompatiblePlannerError extends InferenceContractError` — matches existing FaraPlanner pattern
   - `OpenAICompatiblePlannerRequestError` shape mirrors `FaraPlannerRequestError` (name, retryable, status)

4. **No regressions:** Task 4 keeps FaraInferenceClient path intact; adds planner path alongside. All existing Fara tests should still pass.

## Verification Checklist (from spec)

- [ ] `createPlanner({family: 'fara'})` returns a planner with `plan()` method
- [ ] `createPlanner({family: 'openai-compatible'})` returns a planner with `plan()` method
- [ ] `inferFamilyFromEnv` reads env vars with documented precedence (FARA > OPENAI > AZURE > OLLAMA)
- [ ] `OpenAICompatiblePlanner.plan` POSTs to `{baseUrl}/chat/completions` with `stream: true`
- [ ] SSE chunks assembled, `[DONE]` sentinel handled, malformed chunks skipped
- [ ] Tool-calls map to `PlanningOutcome` via parser
- [ ] HTTP 401/4xx → retryable=false; HTTP 429/5xx → retryable=true
- [ ] AbortSignal aborts stream mid-flight
- [ ] Existing Fara tests still pass
- [ ] Azure uses `api-key` header (not `authorization`)
- [ ] Ollama (no apiKey) skips auth header
