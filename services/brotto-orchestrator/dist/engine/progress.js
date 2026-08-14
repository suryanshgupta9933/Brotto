import { createHash } from 'node:crypto';
// ponytail: long-horizon bumps. 50 steps and 15min were tuned for the
// single-page lookup case ("find my Amazon package"). The 4-phase market
// research task needs ~50-150 actions and up to an hour. The stagnation
// guards (maxRepeatedActions, maxNoVerifiedEffect) stay tight so the budget
// bump doesn't mask runaway loops.
export const DEFAULT_ENGINE_BUDGETS = {
    maxSteps: 200,
    maxElapsedMs: 60 * 60_000,
    maxRepeatedActions: 3,
    maxRepeatedObservations: 3,
    maxNoVerifiedEffect: 3,
    maxConsecutiveActionFailures: 3,
    maxInferenceRepairAttempts: 2,
    maxVerifierFailures: 3,
};
function normalize(value) {
    if (Array.isArray(value))
        return value.map(normalize);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => [key, normalize(nested)]));
    }
    return value;
}
function hash(value) {
    return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}
function normalizeUrl(rawUrl) {
    const url = new URL(rawUrl);
    url.hash = '';
    const parameters = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => (leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)));
    url.search = '';
    for (const [key, value] of parameters)
        url.searchParams.append(key, value);
    return url.toString();
}
export function actionSignature(action) {
    return hash(action);
}
export function observationSignature(observation) {
    return hash({
        url: normalizeUrl(observation.url),
        screenshotSha256: observation.screenshot.sha256.toLowerCase(),
    });
}
export function hasVerifiedEffect(before, result) {
    if (result.status !== 'succeeded')
        return false;
    if (result.navigation !== undefined || result.dialog?.present === true)
        return true;
    return observationSignature(before) !== observationSignature(result.postObservation);
}
function trailingRepeatCount(signatures) {
    const last = signatures.at(-1);
    if (last === undefined)
        return 0;
    let count = 0;
    for (let index = signatures.length - 1; index >= 0 && signatures[index] === last; index -= 1) {
        count += 1;
    }
    return count;
}
const messages = {
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
export function detectTerminalReason(progress, budgets, now) {
    let code = null;
    if (progress.stepCount >= budgets.maxSteps)
        code = 'STEP_LIMIT_REACHED';
    else if (Date.parse(now) - Date.parse(progress.startedAt) > budgets.maxElapsedMs)
        code = 'TIME_LIMIT_REACHED';
    else if (trailingRepeatCount(progress.actionSignatures) >= budgets.maxRepeatedActions)
        code = 'REPEATED_ACTION';
    else if (trailingRepeatCount(progress.observationSignatures) >= budgets.maxRepeatedObservations)
        code = 'REPEATED_OBSERVATION';
    else if (progress.consecutiveNoVerifiedEffect >= budgets.maxNoVerifiedEffect)
        code = 'NO_VERIFIED_EFFECT';
    else if (progress.consecutiveActionFailures >= budgets.maxConsecutiveActionFailures)
        code = 'CONSECUTIVE_ACTION_FAILURES';
    else if (progress.inferenceRepairAttempts >= budgets.maxInferenceRepairAttempts)
        code = 'INFERENCE_REPAIR_EXHAUSTED';
    else if (progress.verifierFailureCount >= progress.maxVerifierFailures)
        code = 'VERIFIER_FAILURE_LIMIT_REACHED';
    return code === null ? null : { code, message: messages[code], detectedAt: now };
}
//# sourceMappingURL=progress.js.map