/**
 * Stagnation detector — per-signature repeat counter.
 * Fix 5: [STAGNATION ESCAPE] at 3, [HARD RESET] at 5.
 */
import { correctiveMessages } from "../correction/templates.js";
const STAGNATION_ESCAPE_THRESHOLD = 3;
const HARD_RESET_THRESHOLD = 5;
function signatureOf(action) {
    const a = action.args;
    const tgt = a.targetId ?? a.url ?? a.text?.slice(0, 30) ?? "_";
    return `${action.type}:${tgt}`;
}
export function detectStagnation(state, action) {
    const sig = signatureOf(action);
    state.actionSignatures.push(sig);
    if (state.actionSignatures.length > 8)
        state.actionSignatures.shift();
    // Increment the counter for this signature; reset others.
    const prev = state.sigRepeatCounts.get(sig) ?? 0;
    const next = prev + 1;
    state.sigRepeatCounts.clear();
    state.sigRepeatCounts.set(sig, next);
    if (next >= HARD_RESET_THRESHOLD) {
        return { detector: "stagnation", severity: "block", message: correctiveMessages.hardReset(action.type) };
    }
    if (next === STAGNATION_ESCAPE_THRESHOLD) {
        return { detector: "stagnation", severity: "warn", message: correctiveMessages.stagnationEscape(action.type) };
    }
    return { detector: "stagnation", severity: "info", message: null };
}
//# sourceMappingURL=stagnation.js.map