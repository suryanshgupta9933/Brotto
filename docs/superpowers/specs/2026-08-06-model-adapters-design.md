# Phase A Design: Multi-Model Inference (Model Adapters)

**Date:** 2026-08-06
**Status:** Draft for review
**Scope:** Phase A only. Multi-model inference (Fara + OpenAI-compatible). No workflow recording, no plan 2.

## Goal

Make the agent orchestrator work with any OpenAI-compatible model (OpenAI, Azure OpenAI, Ollama, vLLM, LM Studio) in addition to the existing Fara adapter. Single-server, env-var config. Streaming support with cancellation.

## Non-Goals

- Workflow recording/replay (plan 2)
- Anthropic adapter day 1 (registry pattern supports future `family: 'anthropic'`)
- Per-request model family override (env var only)
- Tool schema versioning
- Usage/cost tracking beyond existing token counts
- Prompt template versioning

## Architecture

```
[Orchestrator server.ts]
   └─→ InferenceRegistry.selectPlanner(config)  (NEW)
         ├─→ FaraPlanner                (existing)
         ├─→ OpenAICompatiblePlanner    (NEW, SSE streaming)
         └─→ (future: AnthropicPlanner, etc.)
   └─→ SessionEngine                    (unchanged — takes InferencePort)
```

The `InferencePort` interface already exists in `engine/types.ts`. We add one adapter implementation and one registry. The engine, parser, and policy layers are unchanged.

## Module Layout

```
services/agent-orchestrator/src/
├── adapters/
│   ├── fara-planner.ts                EXISTING — unchanged
│   └── openai-compatible-planner.ts   NEW  — ~180 lines
├── prompts/
│   └── tool-schemas.ts                NEW  — ~50 lines
├── inference-registry.ts              NEW  — ~80 lines
├── parser.ts                          EXISTING — reused (ToolCallParser)
├── server.ts                          MODIFY — +~25 lines
└── __tests__/
    ├── openai-compatible-planner.test.ts   NEW — ~100 lines
    └── inference-registry.test.ts          NEW — ~50 lines
```

**Why one adapter for OpenAI/Azure/Ollama/vLLM/LM Studio.** All speak OpenAI-compatible `/v1/chat/completions` with tool-call support. Azure uses different `baseUrl` + `api-key` header. Ollama ignores auth. vLLM and LM Studio are drop-in. Single adapter class with config; per-family quirks handled via headers/URL.

**Why separate `tool-schemas.ts`.** Tool definitions must be identical across all models so a model swap doesn't change the action surface. Centralizing prevents drift between Fara and OpenAI prompts.

## Components

### 1. `services/agent-orchestrator/src/adapters/openai-compatible-planner.ts` (NEW, ~180 lines)

```typescript
import type {
  InferencePort, PlanningInput, PlanningOutcome,
} from '../engine/types.js';
import { ToolCallParser } from '../parser.js';
import { buildToolSchemas } from '../prompts/tool-schemas.js';
import { InferenceContractError } from '../engine/types.js';

export interface OpenAICompatibleConfig {
  baseUrl: string;            // e.g. "https://api.openai.com/v1"
  apiKey?: string;            // optional for Ollama
  model: string;              // e.g. "gpt-4o"
  apiKeyHeader?: string;      // default "authorization"; Azure uses "api-key"
  apiKeyPrefix?: string;      // default "Bearer "
  maxTokens?: number;
  temperature?: number;
  transport?: typeof fetch;   // for tests
}

export class OpenAICompatiblePlannerError extends InferenceContractError {
  override readonly name = 'OpenAICompatiblePlannerError';
}

export class OpenAICompatiblePlannerRequestError extends Error {
  readonly name = 'OpenAICompatiblePlannerRequestError';
  constructor(message: string, public readonly retryable: boolean, public readonly status: number) {
    super(message);
  }
}

export class OpenAICompatiblePlanner implements InferencePort {
  constructor(private readonly config: OpenAICompatibleConfig) {}

  async plan(input: PlanningInput, signal: AbortSignal): Promise<PlanningOutcome> {
    const response = await this.streamChat(input, signal);
    return this.parseResponse(response, input);
  }

  private async streamChat(input: PlanningInput, signal: AbortSignal): Promise<ChatCompletion> {
    const transport = this.config.transport ?? fetch;
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.apiKey) {
      const h = this.config.apiKeyHeader ?? "authorization";
      const p = this.config.apiKeyPrefix ?? "Bearer ";
      headers[h] = p + this.config.apiKey;
    }
    const body = JSON.stringify({
      model: this.config.model,
      messages: buildMessages(input),
      tools: buildToolSchemas(),
      tool_choice: "auto",
      max_tokens: this.config.maxTokens ?? 1024,
      temperature: this.config.temperature ?? 0,
      stream: true,
    });

    const res = await transport(url, { method: "POST", headers, body, signal });
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429;
      throw new OpenAICompatiblePlannerRequestError(`HTTP ${res.status}`, retryable, res.status);
    }
    if (!res.body) throw new OpenAICompatiblePlannerError("empty body", true);

    // ponytail: buffer full SSE response then parse once. Streaming for cancellation
    // only; don't expose deltas to upper layers. Add incremental parsing when
    // time-to-first-token matters for UX.
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
        if (data === "[DONE]") continue;
        try { chunks.push(JSON.parse(data) as ChatCompletionChunk); }
        catch { /* skip malformed */ }
      }
    }
    return assembleChatCompletion(chunks);
  }

  private parseResponse(completion: ChatCompletion, input: PlanningInput): PlanningOutcome {
    const choice = completion.choices[0];
    if (!choice) throw new OpenAICompatiblePlannerError("no choices", true);
    const toolCalls = choice.message.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      // Model declined to call a tool; emit completion proposal
      return { kind: "completion", reason: choice.message.content ?? "(no content)", observationId: input.observation.observationId, taskId: input.taskId };
    }
    const parsed = ToolCallParser.parseToolCalls(toolCalls.map(toOpenAIFaraToolCall));
    if (!parsed.ok) throw new OpenAICompatiblePlannerError(parsed.error, true);
    return parsed.outcome;
  }
}
```

### 2. `services/agent-orchestrator/src/prompts/tool-schemas.ts` (NEW, ~50 lines)

```typescript
// Tool definitions for OpenAI tool-calling API. Derived from fara-action-schema
// action types so all models see the same surface.
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
            action: { type: "string", enum: ["left_click", "double_click", "right_click", "drag", "key", "type", "scroll", "wait", "visit_url", "history_back", "screenshot"] },
            coordinate: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
            text: { type: "string" },
            key: { type: "string" },
            url: { type: "string" },
          },
          required: ["action"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "finish",
        description: "Mark task complete",
        parameters: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
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
            choices: { type: "array", items: { type: "string" } },
          },
          required: ["question"],
        },
      },
    },
  ];
}
```

### 3. `services/agent-orchestrator/src/inference-registry.ts` (NEW, ~80 lines)

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
  if (process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY || process.env.OLLAMA_HOST) {
    return "openai-compatible";
  }
  throw new Error("No inference family configured. Set FARA_ENDPOINT, OPENAI_API_KEY, AZURE_OPENAI_API_KEY, or OLLAMA_HOST.");
}
```

### 4. `services/agent-orchestrator/src/server.ts` (MODIFY, +~25 lines)

Change `OrchestratorConfig.inference` from `InferenceConfig` to `InferenceConfig` (now a discriminated union from registry). Build planner via `createPlanner(config.inference)` and pass to `SessionEngine`. Update `OrchestratorConfig` type definition only.

```typescript
import { createPlanner } from "./inference-registry.js";
import type { InferenceConfig } from "./inference-registry.js";

// In AgentOrchestrator constructor:
this.inference = createPlanner(config.inference);  // type: InferencePort
```

## Data Flow

1. Server boot reads env vars. `inferFamilyFromEnv()` picks family; `createPlanner(config)` returns `InferencePort`.
2. Session opens → `SessionEngine.plan()` calls `inferencePort.plan(input, signal)`.
3. For OpenAI-compatible: planner sends SSE streaming POST, accumulates chunks, assembles full completion, parses tool_calls via `ToolCallParser`.
4. Returns same `PlanningOutcome` shape as Fara (engine, policy, executor layers unchanged).
5. `AbortSignal` (cancellation): propagates to fetch, killing stream mid-flight.

## Error Handling

| Failure | Behavior |
|---|---|
| Network timeout / abort | Throw `OpenAICompatiblePlannerRequestError` retryable=true, status=0 |
| HTTP 401 (auth) | `retryable: false` — bad key, won't fix itself |
| HTTP 429 (rate limit) | `retryable: true` |
| HTTP 4xx (other) | `retryable: false` |
| HTTP 5xx | `retryable: true` |
| Empty `choices` array | `InferenceContractError`, retryable=true |
| Malformed SSE chunk | Skip line, continue (defensive) |
| Tool-call parse failure | Same as Fara: triggers existing repair loop in `parser.ts` |
| `AbortSignal` triggered | Stream reader aborts; throws abort error |

## Streaming Notes

- All OpenAI-compatible APIs (OpenAI, Azure, Ollama, vLLM) support SSE `stream: true`.
- We buffer the full response then parse. Streaming is for **cancellation savings**, not partial parsing. Simpler invariants, identical external behavior to non-streaming.
- `AbortSignal` from `InferencePort.plan(input, signal)` propagates to `fetch(url, {signal})`; stream reader aborts cleanly.
- FaraPlanner keeps non-streaming (Fara vLLM endpoint doesn't support streaming tool-calls cleanly; revisit if needed).

## Code Hygiene Standards

- **Pure where possible.** `buildToolSchemas` is a pure function returning a constant array.
- **One file = one concern.** `openai-compatible-planner.ts` doesn't know about registry; `inference-registry.ts` doesn't know about HTTP.
- **No new abstractions.** No factory-with-one-product, no interface-with-one-impl.
- **Constants named, not magic.** `DEFAULT_MAX_TOKENS = 1024`, `DEFAULT_TEMPERATURE = 0`.
- **JSDoc on every exported symbol.** Match the existing `FaraPlanner` style.
- **Tests colocation.** New test files at `services/agent-orchestrator/src/__tests__/`.
- **Reuse existing patterns.** `OpenAICompatiblePlannerRequestError` mirrors `FaraPlannerRequestError`.
- **No premature generalization.** Anthropic adapter is `family: 'anthropic'` in the union; no AnthropicPlanner yet.

## Testing

| Test | Asserts |
|---|---|
| `OpenAICompatiblePlanner.plan` happy path | SSE chunks → assembled response → tool_calls → `ActionProposalV1` |
| OpenAI base URL | `https://api.openai.com/v1/chat/completions` constructed correctly |
| Azure base URL + `api-key` header | Custom header used when configured |
| Ollama with no apiKey | Skips auth header, sends valid request |
| HTTP 401 → retryable=false | Throws `OpenAICompatiblePlannerRequestError(401, false)` |
| HTTP 429 → retryable=true | Throws with `retryable=true` |
| HTTP 500 → retryable=true | Throws with `retryable=true` |
| Malformed SSE chunk | Skipped, other chunks still processed |
| `[DONE]` sentinel | Recognized, doesn't throw |
| AbortSignal | Stream aborts when signal triggers |
| Empty choices array | `InferenceContractError` |
| Tool-call parse failure | Bubbles through `ToolCallParser` |
| `InferenceRegistry` returns correct planner per family | Type-narrowed check |
| `inferFamilyFromEnv` picks correct family | Env var precedence: FARA > OPENAI > AZURE > OLLAMA |
| Existing FaraPlanner tests | Unchanged, still pass |

## Ponytail Cuts (deliberate simplifications)

- **No incremental SSE parsing.** Buffer full response, parse once. `# ponytail: full-buffer SSE, switch to delta parsing when TTFT matters`
- **No streaming for FaraPlanner.** Fara endpoint has separate streaming concerns. `# ponytail: FaraPlanner non-streaming, revisit when Fara endpoint supports it`
- **No per-request model family override.** Env var only. `# ponytail: env-var family selection, per-request header in plan 2`
- **No tool schema versioning.** Single version from fara-action-schema. `# ponytail: no tool schema versioning, add when schema breaks compat`
- **No retry/backoff inside planner.** ResilientExecutor handles it. `# ponytail: planner throws, executor retries`
- **No usage/cost tracking beyond token counts.** `# ponytail: token counts only, add cost tracking when billing lands`
- **One prompt per family.** No A/B, no per-tenant prompts. `# ponytail: one prompt per family, A/B when eval infra exists`

## Files Touched (~410 lines added, ~25 modified)

| File | Lines |
|---|---|
| `services/agent-orchestrator/src/adapters/openai-compatible-planner.ts` | +180 (new) |
| `services/agent-orchestrator/src/prompts/tool-schemas.ts` | +50 (new) |
| `services/agent-orchestrator/src/inference-registry.ts` | +80 (new) |
| `services/agent-orchestrator/src/server.ts` | +25 (modified) |
| `services/agent-orchestrator/src/__tests__/openai-compatible-planner.test.ts` | +100 (new) |
| `services/agent-orchestrator/src/__tests__/inference-registry.test.ts` | +50 (new) |
| `services/agent-orchestrator/src/index.ts` | +5 (re-export new types) |

## Verification Checklist

- [ ] `InferenceRegistry.createPlanner({family: 'fara'})` returns `FaraPlanner`
- [ ] `InferenceRegistry.createPlanner({family: 'openai-compatible'})` returns `OpenAICompatiblePlanner`
- [ ] `inferFamilyFromEnv` reads env vars correctly with documented precedence
- [ ] `OpenAICompatiblePlanner.plan` sends POST to `{baseUrl}/chat/completions`
- [ ] SSE stream consumed, chunks assembled, `[DONE]` sentinel handled
- [ ] Tool-calls map to `ActionProposalV1` via `ToolCallParser`
- [ ] HTTP errors classified retryable correctly (401/4xx=false, 429/5xx=true)
- [ ] `AbortSignal` aborts stream mid-flight
- [ ] Existing FaraPlanner tests still pass (regression check)
- [ ] SessionEngine requires no changes (interface already abstracts)

## Open Questions

1. **Anthropic day 1?** Spec defers; registry pattern supports future `family: 'anthropic'`. When added, ~150 lines (different tool-use format). **Decision: deferred.**
2. **Streaming exposure to engine?** Buffer-and-parse keeps engine API identical to Fara. Incremental deltas would require `PlanningOutcome | AsyncIterable<PlanningDelta>` change. **Decision: buffered. Revisit when TTFT > 2s is measurable.**
3. **Where do prompts live?** `prompts/tool-schemas.ts` is structural (tool defs only). System prompt content stays in FaraPlanner (existing). OpenAI-compatible uses inline system message construction. **Decision: structural prompts in `prompts/`, system content co-located with planner for now.**
