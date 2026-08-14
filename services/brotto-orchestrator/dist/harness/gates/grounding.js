/**
 * Grounding gate (standalone, callable separately from termination).
 * Used by the loop to validate the candidate finalAnswer before accepting terminate.
 */
const MIN_VALUE_LENGTH = 4;
export function answerCitesMemory(state, candidateAnswer) {
    const answer = candidateAnswer ?? state.finalAnswer ?? "";
    if (!answer || state.memory.size() === 0)
        return { cited: 0, total: 0, ratio: 1 };
    const lowerAnswer = answer.toLowerCase();
    let cited = 0;
    let total = 0;
    for (const fact of state.memory.list()) {
        const value = String(fact.value ?? "").trim();
        if (value.length < MIN_VALUE_LENGTH)
            continue;
        total += 1;
        const phrases = [value, ...value.split(/[\s,;]+/).filter((p) => p.length >= MIN_VALUE_LENGTH)];
        if (phrases.some((p) => lowerAnswer.includes(p.toLowerCase())))
            cited += 1;
    }
    return { cited, total, ratio: total === 0 ? 1 : cited / total };
}
//# sourceMappingURL=grounding.js.map