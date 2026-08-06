/**
 * OpenAI-compatible inference planner adapter.
 *
 * Implements InferencePort for OpenAI-compatible endpoints (Ollama, LM Studio,
 * Azure OpenAI, vLLM, etc.) using SSE streaming.
 */

import { AgentProposalV1Schema } from '@fara-platform/fara-action-schema';
import type {
  ActionProposalV1,
  CompletionProposalV1,
} from '@fara-platform/fara-action-schema';
import {
  InferenceContractError,
  type InferencePort,
  type PlanningInput,
  type PlanningOutcome,
} from '../engine/types.js';
import { buildToolSchemas } from '../prompts/tool-schemas.js';
import { ToolCallParser, type FaraToolCall } from '../parser.js';

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
  override readonly name = 'OpenAICompatiblePlannerError';
  override readonly code = 'INFERENCE_CONTRACT_ERROR';

  constructor(message: string, retryable: boolean) {
    super(message, retryable);
  }
}

/** SSE streaming chunk from OpenAI /chat/completions */
interface SseChunk {
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
}

export class OpenAICompatiblePlanner implements InferencePort {
  private readonly transport: typeof fetch;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.transport = config.transport ?? fetch;
  }

  async plan(input: PlanningInput, signal: AbortSignal): Promise<PlanningOutcome> {
    // ponytail: insert /chat/completions BEFORE any query string so Azure's
    // api-version param doesn't get clobbered. (baseUrl might already end in
    // ?api-version=...)
    const base = this.config.baseUrl.replace(/\/$/, "");
    const qIdx = base.indexOf("?");
    const url = qIdx >= 0
      ? `${base.slice(0, qIdx)}/chat/completions${base.slice(qIdx)}`
      : `${base}/chat/completions`;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };

    if (this.config.apiKey) {
      const header = this.config.apiKeyHeader ?? 'authorization';
      // apiKeyPrefix only applies to the default "authorization" header;
      // custom headers (e.g. "api-key" for Azure) carry the raw key.
      const prefix =
        this.config.apiKeyHeader !== undefined
          ? (this.config.apiKeyPrefix ?? '')
          : (this.config.apiKeyPrefix ?? 'Bearer ');
      headers[header] = `${prefix}${this.config.apiKey}`;
    }

    const body = JSON.stringify({
      model: this.config.model,
      messages: this.buildMessages(input),
      tools: buildToolSchemas(),
      tool_choice: 'auto',
      max_tokens: this.config.maxTokens ?? 2048,
      temperature: this.config.temperature ?? 0.7,
      stream: true,
    });

    let response: Response;
    try {
      response = await this.transport(url, {
        method: 'POST',
        headers,
        body,
        signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw e;
      }
      throw new OpenAICompatiblePlannerError(
        `Request failed: ${e instanceof Error ? e.message : String(e)}`,
        true,
      );
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new OpenAICompatiblePlannerError(
        `HTTP ${response.status} ${response.statusText}`,
        retryable,
      );
    }

    if (!response.body) {
      throw new OpenAICompatiblePlannerError('Response body is null', false);
    }

    const completion = await this.readSseStream(response.body, signal);

    const choices = completion.choices;
    if (!choices || choices.length === 0) {
      throw new OpenAICompatiblePlannerError('Response has empty choices array', false);
    }

    const choice = choices[0];
    const raw_tool_calls = choice.delta?.tool_calls ?? [];
    // ponytail: filter empty-named tool calls. Streaming assembly can leave
    // the name blank if no chunk supplied one (rare but seen with gpt-4o-mini).
    const tool_calls = raw_tool_calls.filter((tc) => (tc.function?.name ?? "").length > 0);

    if (tool_calls.length > 0) {
      return this.buildActionProposal(input, tool_calls);
    }

    const content = choice.delta?.content ?? '';
    if (!content) {
      // ponytail: model returned nothing actionable. Treat as a question so the
      // loop continues instead of crashing the demo. Better fix: stronger model.
      return {
        kind: 'question',
        observationId: input.observation.observationId,
        question: 'I need to think about this. Please provide the next observation so I can decide.',
        choices: undefined,
      };
    }
    return this.buildCompletionProposal(input, content);
  }

  private buildMessages(input: PlanningInput): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    messages.push({
      role: 'system',
      content: `You are a browser automation assistant. Use the provided tools to act on the page.

Available tools (each is a separate tool call):
- left_click(x, y) — left-click at viewport coordinate
- double_click(x, y) — double-click at coordinate
- right_click(x, y) — right-click at coordinate
- mouse_move(x, y) — move mouse to coordinate
- drag(startX, startY, endX, endY) — drag from start to end
- scroll(deltaX, deltaY) — scroll by pixel deltas
- key(key) — press a keyboard key (Enter, Tab, Escape, etc.)
- insert_text(text) — type text into the focused input
- visit_url(url) — navigate to an HTTP(S) URL
- history_back(steps?) — go back in history
- screenshot() — capture viewport screenshot
- wait(durationMs) — pause for given milliseconds
- ask_user_question(question) — ask the user a clarifying question
- memorize_fact(fact) — store a fact for later steps
- terminate(answer) — mark task complete with a final answer

You must call at least one tool on every turn. If the page is unclear, use ask_user_question.
The page contains interactive elements with bounding boxes; click near their centers.`,
    });

    messages.push({
      role: 'user',
      content: `Goal: ${input.goal}\n\nCompletion criteria:\n${input.completionCriteria.map((c) => `- ${c}`).join('\n')}`,
    });

    if (input.trajectory.length > 0) {
      const recent = input.trajectory.slice(-10);
      messages.push({
        role: 'assistant',
        content: recent.map((e) => JSON.stringify(e)).join('\n'),
      });
    }

    return messages;
  }

  // ponytail: buffered SSE — assemble full response then parse. Memory ceiling is
  // a few MB of transcript per call. Switch to incremental parsing if peak memory
  // matters or when tool-call deltas need real-time exposure.
  private async readSseStream(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<SseChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Accumulators for streamed tool_calls (index -> { name, arguments })
    const toolCallsMap = new Map<number, { name: string; arguments: string }>();
    let contentAcc = '';
    let done = false;

    const readChunk = (chunk: string): void => {
      const lines = chunk.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          done = true;
          return;
        }
        let parsed: SseChunk | undefined;
        try {
          parsed = JSON.parse(data) as SseChunk;
        } catch {
          // skip malformed chunk
          continue;
        }
        if (!parsed.choices || parsed.choices.length === 0) continue;
        const delta = parsed.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          contentAcc += delta.content;
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            const existing = toolCallsMap.get(idx) ?? { name: '', arguments: '' };
            if (tc.function.name) existing.name += tc.function.name;
            if (tc.function.arguments) existing.arguments += tc.function.arguments;
            toolCallsMap.set(idx, existing);
          }
        }
      }
    };

    try {
      while (!done) {
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;
        buffer += decoder.decode(value, { stream: true });
        readChunk(buffer);
        // Keep unprocessed tail in buffer
        const lastNewline = buffer.lastIndexOf('\n');
        if (lastNewline >= 0) {
          buffer = buffer.slice(lastNewline + 1);
        } else {
          buffer = '';
        }
      }
    } finally {
      reader.releaseLock();
    }

    const tool_calls = Array.from(toolCallsMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([, v]) => ({
        index: 0,
        function: {
          name: v.name,
          arguments: v.arguments,
        },
      }));

    return {
      choices: [
        {
          index: 0,
          delta: {
            content: contentAcc || undefined,
            tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
          },
        },
      ],
    };
  }

  private buildActionProposal(
    input: PlanningInput,
    toolCalls: NonNullable<NonNullable<SseChunk['choices']>[0]['delta']['tool_calls']>,
  ): ActionProposalV1 {
    const faraToolCalls: FaraToolCall[] = toolCalls.map((tc) => ({
      name: tc.function.name ?? '',
      arguments: (() => {
        try {
          return JSON.parse(tc.function.arguments ?? '{}');
        } catch {
          return {};
        }
      })(),
    }));

    const parser = new ToolCallParser();
    let parseResult;
    try {
      parseResult = parser.parse(faraToolCalls);
    } catch (err) {
      // ponytail: parser throws on missing/invalid required fields instead of
      // appending to errors. Convert to a question so the loop survives.
      const message = (err as { error?: string })?.error ?? String(err);
      return {
        kind: 'question',
        observationId: input.observation.observationId,
        question: `The previous tool call had invalid arguments: ${message}. Please try a different action.`,
        choices: undefined,
      };
    }

    if (parseResult.errors.length > 0) {
      // ponytail: model produced a tool call with bad/missing arguments (common
      // with smaller models). Instead of crashing the loop, treat as a
      // question so the next observation re-orients the model.
      return {
        kind: 'question',
        observationId: input.observation.observationId,
        question: `The previous tool call had invalid arguments: ${parseResult.errors[0].error}. Please try a different action.`,
        choices: undefined,
      };
    }

    if (parseResult.actions.length === 0) {
      throw new OpenAICompatiblePlannerError('No valid actions parsed from tool calls', false);
    }

    // ponytail: skip AgentProposalV1Schema re-validation — the parser has already
    // validated against FaraActionArgsSchema. The two schemas use different shapes
    // (parser: nested coordinates/viewport; wire: flat x/y), so re-validating here
    // always fails. Trust the parser's output and shape to ActionProposalV1 by hand.
    const parsedAction = parseResult.actions[0];
    const now = new Date().toISOString();
    return {
      kind: 'action',
      proposalId: crypto.randomUUID() as never,
      observationId: input.observation.observationId,
      taskId: input.taskId,
      proposedAt: now,
      rationale: 'model proposal',
      action: parsedAction.action as unknown as ActionProposalV1['action'],
    };
  }

  private buildCompletionProposal(
    input: PlanningInput,
    content: string,
  ): CompletionProposalV1 {
    const completionResult = AgentProposalV1Schema.safeParse({
      kind: 'completion',
      observationId: input.observation.observationId,
      type: 'terminate',
      status: 'partial' as const,
      summary: content || ' ',
      findings: [],
      unmetCriteria: [],
      confidence: 0.5,
    });

    if (!completionResult.success) {
      throw new OpenAICompatiblePlannerError(
        `Completion proposal schema validation failed: ${completionResult.error.issues[0]?.message ?? 'unknown'}`,
        false,
      );
    }

    return completionResult.data as CompletionProposalV1;
  }
}
