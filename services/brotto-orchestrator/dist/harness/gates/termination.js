/**
 * Termination gate — composes all sub-checks into a single canTerminate.
 *
 * Reasons for blocking:
 *  1. Not all must-have criteria verified
 *  2. Expected memory keys missing
 *  3. Final answer doesn't cite any recorded values (grounding)
 */
const MIN_VALUE_LENGTH = 4;
export function canTerminate(state) {
    const reasons = [];
    // 1. All must-have criteria must be verified
    const mustHave = state.criteria.filter((c) => c.kind === "must_have");
    const allVerified = mustHave.every((c) => (state.verifications.get(c.id)?.satisfied ?? 0) > 0);
    if (!allVerified && mustHave.length > 0) {
        const missing = mustHave.filter((c) => (state.verifications.get(c.id)?.satisfied ?? 0) === 0).map((c) => c.id);
        reasons.push(`verification: must-have criteria not all [x] — ${missing.join(", ")}`);
    }
    // 2. Expected memory keys must all be present
    const missingKeys = state.expectedMemoryKeys.filter((k) => !state.recordedMemoryKeys.has(k));
    if (missingKeys.length > 0) {
        reasons.push(`memory: missing keys — ${missingKeys.join(", ")}`);
    }
    // 3. Grounding — finalAnswer must reference at least one recorded value
    const answer = state.finalAnswer ?? "";
    if (answer && state.memory.size() > 0) {
        const lowerAnswer = answer.toLowerCase();
        let cited = 0;
        for (const fact of state.memory.list()) {
            const value = String(fact.value ?? "").trim();
            if (value.length < MIN_VALUE_LENGTH)
                continue;
            const phrases = [value, ...value.split(/[\s,;]+/).filter((p) => p.length >= MIN_VALUE_LENGTH)];
            if (phrases.some((p) => lowerAnswer.includes(p.toLowerCase())))
                cited += 1;
        }
        if (cited === 0) {
            reasons.push("grounding: finalAnswer references 0% of recorded values");
        }
    }
    return { allowed: reasons.length === 0, reasons };
}
//# sourceMappingURL=termination.js.map