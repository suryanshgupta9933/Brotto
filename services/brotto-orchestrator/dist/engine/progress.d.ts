import type { ActionResultV1, ExecutableActionV1, ObservationV1 } from '@brotto/brotto-action-schema';
import type { EngineBudgets, TerminalReason } from './types.js';
export interface ProgressSnapshot {
    startedAt: string;
    stepCount: number;
    actionSignatures: string[];
    observationSignatures: string[];
    consecutiveNoVerifiedEffect: number;
    consecutiveActionFailures: number;
    inferenceRepairAttempts: number;
    verifierFailureCount: number;
    maxVerifierFailures: number;
}
export declare const DEFAULT_ENGINE_BUDGETS: EngineBudgets;
export declare function actionSignature(action: ExecutableActionV1): string;
export declare function observationSignature(observation: ObservationV1): string;
export declare function hasVerifiedEffect(before: ObservationV1, result: ActionResultV1): boolean;
export declare function detectTerminalReason(progress: ProgressSnapshot, budgets: EngineBudgets, now: string): TerminalReason | null;
//# sourceMappingURL=progress.d.ts.map