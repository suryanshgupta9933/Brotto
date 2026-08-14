import { InferenceContractError, type InferencePort, type PlanningInput, type PlanningOutcome } from '../engine/types.js';
export interface BrottoPlannerUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}
export interface BrottoPlannerDiagnostic {
    workId: string;
    requestId?: string;
    model?: string;
    usage?: BrottoPlannerUsage;
    finishReason?: string;
}
export interface BrottoPlannerConfig {
    endpoint: string;
    transport?: typeof fetch;
    maxTokens?: number;
    maxRepairAttempts?: number;
    maxDiagnosticEntries?: number;
    headers?: Record<string, string>;
}
export declare class BrottoPlannerError extends InferenceContractError {
    readonly name = "BrottoPlannerError";
    readonly code = "INFERENCE_CONTRACT_ERROR";
    constructor(message: string, retryable: boolean);
}
export declare class BrottoPlannerRequestError extends Error {
    readonly retryable: boolean;
    readonly status: number;
    readonly name = "BrottoPlannerRequestError";
    readonly code = "INFERENCE_HTTP_ERROR";
    constructor(message: string, retryable: boolean, status: number);
}
export declare class BrottoPlanner implements InferencePort {
    private readonly config;
    private readonly transport;
    private readonly diagnostics;
    private readonly maxDiagnosticEntries;
    constructor(config: BrottoPlannerConfig);
    plan(input: PlanningInput, signal: AbortSignal): Promise<PlanningOutcome>;
    getDiagnostic(workId: string): BrottoPlannerDiagnostic | undefined;
    private readDiagnostic;
    private rememberDiagnostic;
    private parseUsage;
    private isContractError;
}
//# sourceMappingURL=brotto-planner.d.ts.map