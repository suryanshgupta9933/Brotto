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
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`;

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
    const tool_calls = choice.delta?.tool_calls;

    if (tool_calls && tool_calls.length > 0) {
      return this.buildActionProposal(input, tool_calls);
    }

    const content = choice.delta?.content ?? '';
    if (!content) {
      throw new OpenAICompatiblePlannerError('Response has no content and no tool calls', false);
    }
    return this.buildCompletionProposal(input, content);
  }

  private buildMessages(input: PlanningInput): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    messages.push({
      role: 'system',
      content: `You are Fara, a browser automation assistant. You must use tool calls to perform actions.
You can use: browser_action (left_click, double_click, right_click, drag, key, type, scroll, wait, visit_url, history_back, screenshot), finish, ask_user_question.`,
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
    const parseResult = parser.parse(faraToolCalls);

    if (parseResult.errors.length > 0) {
      // retryable=false: a model consistently producing malformed tool calls
      // won't fix itself; hammering it just wastes the retry budget.
      throw new OpenAICompatiblePlannerError(
        `Tool call parsing failed: ${parseResult.errors[0].error}`,
        false,
      );
    }

    if (parseResult.actions.length === 0) {
      throw new OpenAICompatiblePlannerError('No valid actions parsed from tool calls', false);
    }

    const parsedAction = parseResult.actions[0];
    const now = new Date().toISOString();

    // Re-serialize through the schema to get a fully-typed ExecutableActionV1
    const actionResult = AgentProposalV1Schema.safeParse({
      kind: 'action',
      observationId: input.observation.observationId,
      proposedAt: now,
      action: parsedAction.action,
    });

    if (!actionResult.success) {
      throw new OpenAICompatiblePlannerError(
        `Action proposal schema validation failed: ${actionResult.error.issues[0]?.message ?? 'unknown'}`,
        false,
      );
    }

    return actionResult.data as ActionProposalV1;
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
