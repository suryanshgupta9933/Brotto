import { AgentProposalV1Schema, type AgentProposalV1 } from '@fara-platform/fara-action-schema';
import { InferenceContractError, type InferencePort, type PlanningInput } from '../engine/types.js';

export interface FaraPlannerUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface FaraPlannerDiagnostic {
  workId: string;
  requestId: string;
  model?: string;
  usage?: FaraPlannerUsage;
  finishReason?: string;
}

export interface FaraPlannerConfig {
  endpoint: string;
  transport?: typeof fetch;
  maxTokens?: number;
  maxRepairAttempts?: number;
  headers?: Record<string, string>;
}

export class FaraPlannerError extends InferenceContractError {
  override readonly name = 'FaraPlannerError';
  override readonly code = 'INFERENCE_CONTRACT_ERROR';

  constructor(message: string, retryable: boolean) {
    super(message, retryable);
  }
}

export class FaraPlannerRequestError extends Error {
  readonly name = 'FaraPlannerRequestError';
  readonly code = 'INFERENCE_HTTP_ERROR';

  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status: number,
  ) {
    super(message);
  }
}

export class FaraPlanner implements InferencePort {
  private readonly transport: typeof fetch;
  private readonly diagnostics = new Map<string, FaraPlannerDiagnostic>();

  constructor(private readonly config: FaraPlannerConfig) {
    this.transport = config.transport ?? fetch;
  }

  async plan(input: PlanningInput, signal: AbortSignal): Promise<AgentProposalV1> {
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
    this.diagnostics.set(input.workId, diagnostic);
    if (!response.ok) {
      throw new FaraPlannerRequestError(
        `Planning endpoint returned HTTP ${response.status}`,
        response.status >= 500,
        response.status,
      );
    }

    let decoded: unknown;
    try {
      decoded = await response.json();
    } catch {
      throw new FaraPlannerError('Planning endpoint returned invalid JSON', false);
    }

    if (this.isContractError(decoded)) {
      throw new FaraPlannerError(decoded.message, decoded.retryable);
    }
    if (this.isQuestion(decoded)) {
      throw new FaraPlannerError('Planning requires user input before it can continue', false);
    }

    const proposal = AgentProposalV1Schema.safeParse(decoded);
    if (!proposal.success) {
      throw new FaraPlannerError(
        `Planning response violated the canonical proposal contract: ${proposal.error.issues[0]?.message ?? 'invalid response'}`,
        false,
      );
    }
    return proposal.data;
  }

  getDiagnostic(workId: string): FaraPlannerDiagnostic | undefined {
    const diagnostic = this.diagnostics.get(workId);
    return diagnostic === undefined ? undefined : structuredClone(diagnostic);
  }

  private readDiagnostic(response: Response, workId: string): FaraPlannerDiagnostic {
    const requestId = response.headers.get('x-request-id') ?? workId;
    const model = response.headers.get('x-fara-model') ?? response.headers.get('x-model') ?? undefined;
    const finishReason = response.headers.get('x-fara-finish-reason') ??
      response.headers.get('x-finish-reason') ?? undefined;
    const rawUsage = response.headers.get('x-fara-usage') ?? response.headers.get('x-usage');
    const usage = rawUsage === null ? undefined : this.parseUsage(rawUsage);
    return {
      workId,
      requestId,
      ...(model === undefined ? {} : { model }),
      ...(usage === undefined ? {} : { usage }),
      ...(finishReason === undefined ? {} : { finishReason }),
    };
  }

  private parseUsage(raw: string): FaraPlannerUsage | undefined {
    try {
      const usage = JSON.parse(raw) as Record<string, unknown>;
      const promptTokens = usage.prompt_tokens;
      const completionTokens = usage.completion_tokens;
      const totalTokens = usage.total_tokens;
      if (![promptTokens, completionTokens, totalTokens].every((value) => (
        typeof value === 'number' && Number.isFinite(value) && value >= 0
      ))) return undefined;
      return {
        promptTokens: promptTokens as number,
        completionTokens: completionTokens as number,
        totalTokens: totalTokens as number,
      };
    } catch {
      return undefined;
    }
  }

  private isContractError(value: unknown): value is {
    kind: 'contract_error';
    code: 'INFERENCE_CONTRACT_ERROR';
    message: string;
    retryable: boolean;
  } {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return candidate.kind === 'contract_error' &&
      candidate.code === 'INFERENCE_CONTRACT_ERROR' &&
      typeof candidate.message === 'string' &&
      typeof candidate.retryable === 'boolean';
  }

  private isQuestion(value: unknown): value is { kind: 'question' } {
    return value !== null && typeof value === 'object' &&
      (value as Record<string, unknown>).kind === 'question';
  }
}
