/**
 * Fara Inference Client
 *
 * OpenAI-compatible inference client for Fara model as specified in
 * ARCHITECTURE.md section 3.3
 *
 * Uses OpenAI-compatible API endpoint for vLLM deployment of Fara1.5
 */

import { z } from 'zod';

/**
 * Inference request schema
 */
export const InferenceRequestSchema = z.object({
  model: z.string(),
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
    })
  ),
  max_tokens: z.number().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  stream: z.boolean().optional(),
});

export type InferenceRequest = z.infer<typeof InferenceRequestSchema>;

/**
 * Inference response schema
 */
export const InferenceResponseSchema = z.object({
  id: z.string(),
  object: z.string(),
  created: z.number(),
  model: z.string(),
  choices: z.array(
    z.object({
      index: z.number(),
      message: z.object({
        role: z.string(),
        content: z.string(),
      }),
      finish_reason: z.string(),
    })
  ),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
});

export type InferenceResponse = z.infer<typeof InferenceResponseSchema>;

/**
 * Fara inference configuration
 */
export interface InferenceConfig {
  endpoint: string;
  apiKey?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
}

/** @deprecated Alias for the legacy FaraInferenceClient config. New code should use InferenceConfig from inference-registry. */
export type LegacyInferenceConfig = InferenceConfig;

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Partial<InferenceConfig> = {
  maxTokens: 4096,
  temperature: 0.7,
  timeout: 120000, // 2 minutes
};

/**
 * Tool call parsed from Fara response
 */
export interface FaraToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Parsed Fara inference response
 */
export interface FaraInferenceResult {
  content: string;
  toolCalls: FaraToolCall[];
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Fara Inference Client
 *
 * OpenAI-compatible client for Fara model inference
 */
export class FaraInferenceClient {
  private config: Required<InferenceConfig>;
  private abortController: AbortController | null = null;

  constructor(config: InferenceConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    } as Required<InferenceConfig>;
  }

  /**
   * Build system prompt for Fara
   *
   * Per ARCHITECTURE.md section 3.6, Fara should receive:
   * - Current screenshot (handled via image in messages)
   * - User's original goal
   * - Relevant recent actions
   * - Relevant approved user answers
   * - Result of previous action
   * - Concise failure message when action failed
   */
  buildSystemPrompt(): string {
    return `You are Fara, a screenshot-based computer use model. You see screenshots and produce coordinate-grounded actions.

IMPORTANT SECURITY RULES:
- Never reveal authentication tokens or credentials
- Never execute arbitrary JavaScript
- Never access internal service URLs
- Never modify policy settings
- Always validate coordinates are within viewport bounds
- Always use the provided tool calls for browser actions

You can perform these actions:
- left_click: Click at viewport coordinates
- double_click: Double-click at viewport coordinates
- right_click: Right-click at viewport coordinates
- drag: Drag from one coordinate to another
- mouse_move: Move cursor to viewport coordinates
- scroll: Scroll at viewport coordinates
- key: Press keyboard key
- visit_url: Navigate to URL
- history_back: Navigate back in history
- screenshot: Take a screenshot
- wait: Wait for specified duration
- ask_user_question: Ask user for input/approval
- terminate: End the session
- pause_and_memorize_fact: Store information in session memory

For coordinate actions, always ensure coordinates are within the viewport bounds shown in the screenshot.`;
  }

  /**
   * Build user message with screenshot context
   */
  buildUserMessage(context: {
    goal: string;
    recentActions?: Array<{
      actionType: string;
      success: boolean;
      error?: string;
    }>;
    lastActionResult?: { success: boolean; error?: string } | null;
    failureMessage?: string;
    memories?: Array<{ fact: string; category?: string }>;
  }): string {
    let message = `TASK: ${context.goal}\n\n`;

    // Add recent actions context
    if (context.recentActions && context.recentActions.length > 0) {
      message += '\nRECENT ACTIONS:\n';
      for (const action of context.recentActions.slice(-5)) {
        const status = action.success ? 'SUCCESS' : `FAILED: ${action.error || 'Unknown error'}`;
        message += `- ${action.actionType}: ${status}\n`;
      }
    }

    // Add last action result
    if (context.lastActionResult) {
      if (context.lastActionResult.success) {
        message += '\nLast action completed successfully.\n';
      } else {
        message += `\nLast action failed: ${context.lastActionResult.error || 'Unknown error'}\n`;
      }
    }

    // Add failure message if present
    if (context.failureMessage) {
      message += `\nWARNING: ${context.failureMessage}\n`;
    }

    // Add memories
    if (context.memories && context.memories.length > 0) {
      message += '\nMEMORIZED FACTS:\n';
      for (const mem of context.memories) {
        message += `- ${mem.fact}${mem.category ? ` (${mem.category})` : ''}\n`;
      }
    }

    message += '\nAnalyze the screenshot and determine the next action to progress toward the task goal.';

    return message;
  }

  /**
   * Request inference from Fara
   */
  async infer(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options?: {
      maxTokens?: number;
      temperature?: number;
      imageBase64?: string;
    }
  ): Promise<FaraInferenceResult> {
    const request: InferenceRequest = {
      model: this.config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: options?.imageBase64 && m.role === 'user'
          ? [
              { type: 'text', text: m.content },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${options.imageBase64}` } },
            ]
          : m.content,
      })) as InferenceRequest['messages'],
      max_tokens: options?.maxTokens ?? this.config.maxTokens,
      temperature: options?.temperature ?? this.config.temperature,
      stream: false,
    };

    const response = await this.executeRequest(request);
    return this.parseResponse(response);
  }

  /**
   * Execute inference request
   */
  private async executeRequest(request: InferenceRequest): Promise<InferenceResponse> {
    this.abortController = new AbortController();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new InferenceError(
        `Inference request failed: ${response.status} ${response.statusText}`,
        response.status,
        errorText
      );
    }

    const data = await response.json();
    return InferenceResponseSchema.parse(data);
  }

  /**
   * Parse inference response
   */
  private parseResponse(response: InferenceResponse): FaraInferenceResult {
    const choice = response.choices[0];
    const content = choice.message.content;

    return {
      content,
      toolCalls: this.extractToolCalls(content),
      finishReason: choice.finish_reason,
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      },
    };
  }

  /**
   * Extract tool calls from response content
   *
   * Fara produces tool calls in a specific format that we parse here.
   * The tool calls are validated by the parser module.
   */
  private extractToolCalls(content: string): FaraToolCall[] {
    const toolCalls: FaraToolCall[] = [];

    // Try to extract JSON tool calls
    // Format: {"tool": "action_name", "args": {...}}
    const jsonPattern = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/g;
    const directPattern = /\{\s*"tool":\s*"(\w+)",\s*"args":\s*(\{[\s\S]*?\})\s*\}/g;

    let match;

    // Try JSON code blocks
    while ((match = jsonPattern.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.tool && parsed.args) {
          toolCalls.push({
            name: parsed.tool,
            arguments: parsed.args,
          });
        }
      } catch {
        // Ignore parsing errors
      }
    }

    // Try direct JSON objects
    while ((match = directPattern.exec(content)) !== null) {
      try {
        const args = JSON.parse(match[2]);
        toolCalls.push({
          name: match[1],
          arguments: args,
        });
      } catch {
        // Ignore parsing errors
      }
    }

    // Also try simpler formats like:
    // tool: action_name
    // args: {...}
    const simplePattern = /(left_click|double_click|right_click|drag|mouse_move|scroll|key|visit_url|history_back|screenshot|wait|ask_user_question|terminate|pause_and_memorize_fact)\s*\(\s*([^)]+)\s*\)/gi;
    while ((match = simplePattern.exec(content)) !== null) {
      const name = match[1].toLowerCase();
      try {
        // Try to parse args as JSON
        const args = JSON.parse(`{${match[2]}}`);
        toolCalls.push({ name, arguments: args });
      } catch {
        // Try key=value format
        const args: Record<string, unknown> = {};
        const argPattern = /(\w+)=([^,]+)/g;
        let argMatch;
        while ((argMatch = argPattern.exec(match[2])) !== null) {
          let value: unknown = argMatch[2].trim();
          // Try to parse as number
          const num = Number(value);
          if (!isNaN(num)) {
            value = num;
          }
          args[argMatch[1]] = value;
        }
        if (Object.keys(args).length > 0) {
          toolCalls.push({ name, arguments: args });
        }
      }
    }

    return toolCalls;
  }

  /**
   * Cancel ongoing inference request
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<InferenceConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    } as Required<InferenceConfig>;
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<InferenceConfig> {
    return { ...this.config };
  }
}

/**
 * Inference error
 */
export class InferenceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = 'InferenceError';
  }
}

/**
 * Check if an error is an InferenceError
 */
export function isInferenceError(error: unknown): error is InferenceError {
  return error instanceof InferenceError;
}
