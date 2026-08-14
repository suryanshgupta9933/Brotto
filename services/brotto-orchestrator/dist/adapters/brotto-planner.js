import { AgentProposalV1Schema } from '@brotto/brotto-action-schema';
import { z } from 'zod';
import { InferenceContractError, } from '../engine/types.js';
const QuestionProposalSchema = z.object({
    kind: z.literal('question'),
    observationId: z.string().uuid(),
    question: z.string().min(1).max(2_000),
    choices: z.array(z.string().min(1).max(256)).max(20).optional(),
}).strict();
export class BrottoPlannerError extends InferenceContractError {
    name = 'BrottoPlannerError';
    code = 'INFERENCE_CONTRACT_ERROR';
    constructor(message, retryable) {
        super(message, retryable);
    }
}
export class BrottoPlannerRequestError extends Error {
    retryable;
    status;
    name = 'BrottoPlannerRequestError';
    code = 'INFERENCE_HTTP_ERROR';
    constructor(message, retryable, status) {
        super(message);
        this.retryable = retryable;
        this.status = status;
    }
}
export class BrottoPlanner {
    config;
    transport;
    diagnostics = new Map();
    maxDiagnosticEntries;
    constructor(config) {
        this.config = config;
        this.transport = config.transport ?? fetch;
        this.maxDiagnosticEntries = Number.isSafeInteger(config.maxDiagnosticEntries) &&
            (config.maxDiagnosticEntries ?? 0) > 0
            ? config.maxDiagnosticEntries
            : 1_000;
    }
    async plan(input, signal) {
        const response = await this.transport(this.config.endpoint, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-request-id': input.workId,
                ...this.config.headers,
            },
            body: JSON.stringify({
                goal: input.goal,
                completionCriteria: input.completionCriteria,
                observation: input.observation,
                trajectory: input.trajectory.slice(-100),
                limits: {
                    maxTokens: this.config.maxTokens ?? 2048,
                    maxRepairAttempts: this.config.maxRepairAttempts ?? 2,
                },
            }),
            signal,
        });
        const diagnostic = this.readDiagnostic(response, input.workId);
        this.rememberDiagnostic(input.workId, diagnostic);
        if (!response.ok) {
            throw new BrottoPlannerRequestError(`Planning endpoint returned HTTP ${response.status}`, response.status >= 500, response.status);
        }
        let decoded;
        try {
            decoded = await response.json();
        }
        catch {
            throw new BrottoPlannerError('Planning endpoint returned invalid JSON', false);
        }
        if (this.isContractError(decoded)) {
            throw new BrottoPlannerError(decoded.message, decoded.retryable);
        }
        const question = QuestionProposalSchema.safeParse(decoded);
        if (question.success)
            return question.data;
        const proposal = AgentProposalV1Schema.safeParse(decoded);
        if (!proposal.success) {
            throw new BrottoPlannerError(`Planning response violated the canonical proposal contract: ${proposal.error.issues[0]?.message ?? 'invalid response'}`, false);
        }
        return proposal.data;
    }
    getDiagnostic(workId) {
        const diagnostic = this.diagnostics.get(workId);
        if (diagnostic === undefined)
            return undefined;
        this.diagnostics.delete(workId);
        this.diagnostics.set(workId, diagnostic);
        return structuredClone(diagnostic);
    }
    readDiagnostic(response, workId) {
        const requestId = response.headers.get('x-request-id') ?? undefined;
        const model = response.headers.get('x-brotto-model') ?? undefined;
        const finishReason = response.headers.get('x-brotto-finish-reason') ?? undefined;
        const rawUsage = response.headers.get('x-brotto-usage');
        const usage = rawUsage === null ? undefined : this.parseUsage(rawUsage);
        return {
            workId,
            ...(requestId === undefined ? {} : { requestId }),
            ...(model === undefined ? {} : { model }),
            ...(usage === undefined ? {} : { usage }),
            ...(finishReason === undefined ? {} : { finishReason }),
        };
    }
    rememberDiagnostic(workId, diagnostic) {
        this.diagnostics.delete(workId);
        this.diagnostics.set(workId, diagnostic);
        while (this.diagnostics.size > this.maxDiagnosticEntries) {
            const oldestWorkId = this.diagnostics.keys().next().value;
            if (oldestWorkId === undefined)
                return;
            this.diagnostics.delete(oldestWorkId);
        }
    }
    parseUsage(raw) {
        try {
            const usage = JSON.parse(raw);
            const promptTokens = usage.prompt_tokens;
            const completionTokens = usage.completion_tokens;
            const totalTokens = usage.total_tokens;
            if (![promptTokens, completionTokens, totalTokens].every((value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0)))
                return undefined;
            return {
                promptTokens: promptTokens,
                completionTokens: completionTokens,
                totalTokens: totalTokens,
            };
        }
        catch {
            return undefined;
        }
    }
    isContractError(value) {
        if (value === null || typeof value !== 'object')
            return false;
        const candidate = value;
        return candidate.kind === 'contract_error' &&
            candidate.code === 'INFERENCE_CONTRACT_ERROR' &&
            typeof candidate.message === 'string' &&
            typeof candidate.retryable === 'boolean';
    }
}
//# sourceMappingURL=brotto-planner.js.map