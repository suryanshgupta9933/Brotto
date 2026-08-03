import { createHash } from 'node:crypto';
import type {
  ActionResultV1,
  ExecutableActionV1,
  ObservationV1,
} from '@fara-platform/fara-action-schema';
import type { EngineBudgets, TerminalReason, TerminalReasonCode } from './types.js';

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

export const DEFAULT_ENGINE_BUDGETS: EngineBudgets = {
  maxSteps: 50,
  maxElapsedMs: 15 * 60_000,
  maxRepeatedActions: 3,
  maxRepeatedObservations: 3,
  maxNoVerifiedEffect: 3,
  maxConsecutiveActionFailures: 3,
  maxInferenceRepairAttempts: 2,
  maxVerifierFailures: 3,
};

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  }
  return value;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = '';
  const parameters = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => (
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
  ));
  url.search = '';
  for (const [key, value] of parameters) url.searchParams.append(key, value);
  return url.toString();
}

export function actionSignature(action: ExecutableActionV1): string {
  return hash(action);
}

export function observationSignature(observation: ObservationV1): string {
  return hash({
    url: normalizeUrl(observation.url),
    screenshotSha256: observation.screenshot.sha256.toLowerCase(),
  });
}

export function hasVerifiedEffect(before: ObservationV1, result: ActionResultV1): boolean {
  if (result.status !== 'succeeded') return false;
  if (result.navigation !== undefined || result.dialog?.present === true) return true;
  return observationSignature(before) !== observationSignature(result.postObservation);
}

function trailingRepeatCount(signatures: string[]): number {
  const last = signatures.at(-1);
  if (last === undefined) return 0;
  let count = 0;
  for (let index = signatures.length - 1; index >= 0 && signatures[index] === last; index -= 1) {
    count += 1;
  }
  return count;
}

const messages: Record<TerminalReasonCode, string> = {
  MODEL_COMPLETION: 'The model proposed a terminal outcome',
  POLICY_DENIED: 'Policy denied the proposed action',
  ACTION_FAILED_TERMINAL: 'The browser action failed terminally',
  SESSION_CANCELLED: 'The session was cancelled',
  STEP_LIMIT_REACHED: 'The session step budget was exhausted',
  TIME_LIMIT_REACHED: 'The session elapsed-time budget was exhausted',
  REPEATED_ACTION: 'The same normalized action repeated without an alternative',
  REPEATED_OBSERVATION: 'The same normalized browser observation repeated',
  NO_VERIFIED_EFFECT: 'Actions repeatedly produced no verified browser effect',
  CONSECUTIVE_ACTION_FAILURES: 'The consecutive action-failure budget was exhausted',
  INFERENCE_REPAIR_EXHAUSTED: 'The inference contract repair budget was exhausted',
  VERIFIER_FAILURE_LIMIT_REACHED: 'Repeated completion verification failures exhausted the verification budget',
};

export function detectTerminalReason(
  progress: ProgressSnapshot,
  budgets: EngineBudgets,
  now: string,
): TerminalReason | null {
  let code: TerminalReasonCode | null = null;
  if (progress.stepCount >= budgets.maxSteps) code = 'STEP_LIMIT_REACHED';
  else if (Date.parse(now) - Date.parse(progress.startedAt) > budgets.maxElapsedMs) code = 'TIME_LIMIT_REACHED';
  else if (trailingRepeatCount(progress.actionSignatures) >= budgets.maxRepeatedActions) code = 'REPEATED_ACTION';
  else if (trailingRepeatCount(progress.observationSignatures) >= budgets.maxRepeatedObservations) code = 'REPEATED_OBSERVATION';
  else if (progress.consecutiveNoVerifiedEffect >= budgets.maxNoVerifiedEffect) code = 'NO_VERIFIED_EFFECT';
  else if (progress.consecutiveActionFailures >= budgets.maxConsecutiveActionFailures) code = 'CONSECUTIVE_ACTION_FAILURES';
  else if (progress.inferenceRepairAttempts >= budgets.maxInferenceRepairAttempts) code = 'INFERENCE_REPAIR_EXHAUSTED';
  else if (progress.verifierFailureCount >= progress.maxVerifierFailures) code = 'VERIFIER_FAILURE_LIMIT_REACHED';

  return code === null ? null : { code, message: messages[code], detectedAt: now };
}
