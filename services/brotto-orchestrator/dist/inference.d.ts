/**
 * Brotto Inference Client
 *
 * OpenAI-compatible inference client for Brotto model as specified in
 * ARCHITECTURE.md section 3.3
 *
 * Uses OpenAI-compatible API endpoint for vLLM deployment of Brotto
 */
import { z } from 'zod';
/**
 * Inference request schema
 */
export declare const InferenceRequestSchema: z.ZodObject<{
    model: z.ZodString;
    messages: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<["system", "user", "assistant"]>;
        content: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        content: string;
        role: "system" | "user" | "assistant";
    }, {
        content: string;
        role: "system" | "user" | "assistant";
    }>, "many">;
    max_tokens: z.ZodOptional<z.ZodNumber>;
    temperature: z.ZodOptional<z.ZodNumber>;
    top_p: z.ZodOptional<z.ZodNumber>;
    stream: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    model: string;
    messages: {
        content: string;
        role: "system" | "user" | "assistant";
    }[];
    stream?: boolean | undefined;
    max_tokens?: number | undefined;
    temperature?: number | undefined;
    top_p?: number | undefined;
}, {
    model: string;
    messages: {
        content: string;
        role: "system" | "user" | "assistant";
    }[];
    stream?: boolean | undefined;
    max_tokens?: number | undefined;
    temperature?: number | undefined;
    top_p?: number | undefined;
}>;
export type InferenceRequest = z.infer<typeof InferenceRequestSchema>;
/**
 * Inference response schema
 */
export declare const InferenceResponseSchema: z.ZodObject<{
    id: z.ZodString;
    object: z.ZodString;
    created: z.ZodNumber;
    model: z.ZodString;
    choices: z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        message: z.ZodObject<{
            role: z.ZodString;
            content: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            content: string;
            role: string;
        }, {
            content: string;
            role: string;
        }>;
        finish_reason: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        message: {
            content: string;
            role: string;
        };
        index: number;
        finish_reason: string;
    }, {
        message: {
            content: string;
            role: string;
        };
        index: number;
        finish_reason: string;
    }>, "many">;
    usage: z.ZodObject<{
        prompt_tokens: z.ZodNumber;
        completion_tokens: z.ZodNumber;
        total_tokens: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    }, {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    }>;
}, "strip", z.ZodTypeAny, {
    object: string;
    choices: {
        message: {
            content: string;
            role: string;
        };
        index: number;
        finish_reason: string;
    }[];
    id: string;
    model: string;
    created: number;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}, {
    object: string;
    choices: {
        message: {
            content: string;
            role: string;
        };
        index: number;
        finish_reason: string;
    }[];
    id: string;
    model: string;
    created: number;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}>;
export type InferenceResponse = z.infer<typeof InferenceResponseSchema>;
/**
 * Brotto inference configuration
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
 * Tool call parsed from Brotto response
 */
export interface FaraToolCall {
    name: string;
    arguments: Record<string, unknown>;
}
/**
 * Parsed Brotto inference response
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
 * Brotto Inference Client
 *
 * OpenAI-compatible client for Brotto model inference
 */
export declare class FaraInferenceClient {
    private config;
    private abortController;
    constructor(config: InferenceConfig);
    /**
     * Build system prompt for Brotto
     *
     * Per ARCHITECTURE.md section 3.6, Brotto should receive:
     * - Current screenshot (handled via image in messages)
     * - User's original goal
     * - Relevant recent actions
     * - Relevant approved user answers
     * - Result of previous action
     * - Concise failure message when action failed
     */
    buildSystemPrompt(): string;
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
        lastActionResult?: {
            success: boolean;
            error?: string;
        } | null;
        failureMessage?: string;
        memories?: Array<{
            fact: string;
            category?: string;
        }>;
    }): string;
    /**
     * Request inference from Brotto
     */
    infer(messages: Array<{
        role: 'system' | 'user' | 'assistant';
        content: string;
    }>, options?: {
        maxTokens?: number;
        temperature?: number;
        imageBase64?: string;
    }): Promise<FaraInferenceResult>;
    /**
     * Execute inference request
     */
    private executeRequest;
    /**
     * Parse inference response
     */
    private parseResponse;
    /**
     * Extract tool calls from response content
     *
     * Brotto produces tool calls in a specific format that we parse here.
     * The tool calls are validated by the parser module.
     */
    private extractToolCalls;
    /**
     * Cancel ongoing inference request
     */
    cancel(): void;
    /**
     * Update configuration
     */
    updateConfig(config: Partial<InferenceConfig>): void;
    /**
     * Get current configuration
     */
    getConfig(): Readonly<InferenceConfig>;
}
/**
 * Inference error
 */
export declare class InferenceError extends Error {
    readonly statusCode: number;
    readonly responseBody?: string | undefined;
    constructor(message: string, statusCode: number, responseBody?: string | undefined);
}
/**
 * Check if an error is an InferenceError
 */
export declare function isInferenceError(error: unknown): error is InferenceError;
//# sourceMappingURL=inference.d.ts.map