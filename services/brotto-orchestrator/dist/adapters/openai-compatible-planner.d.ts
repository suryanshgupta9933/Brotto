/**
 * OpenAI-compatible inference planner adapter.
 *
 * Implements InferencePort for OpenAI-compatible endpoints (Ollama, LM Studio,
 * Azure OpenAI, vLLM, etc.) using SSE streaming.
 */
import { InferenceContractError, type InferencePort, type PlanningInput, type PlanningOutcome } from '../engine/types.js';
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
export declare class OpenAICompatiblePlannerError extends InferenceContractError {
    readonly name = "OpenAICompatiblePlannerError";
    readonly code = "INFERENCE_CONTRACT_ERROR";
    constructor(message: string, retryable: boolean);
}
export declare class OpenAICompatiblePlanner implements InferencePort {
    private readonly config;
    private readonly transport;
    constructor(config: OpenAICompatibleConfig);
    plan(input: PlanningInput, signal: AbortSignal): Promise<PlanningOutcome>;
    private buildMessages;
    private readSseStream;
    private buildActionProposal;
    private buildCompletionProposal;
}
//# sourceMappingURL=openai-compatible-planner.d.ts.map