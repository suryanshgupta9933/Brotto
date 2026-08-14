/**
 * Corrective injector — merges detector results into the next-prompt guidance.
 * Single function used by the loop.
 */
export function buildNextGuidance(_state, newDetectorResults, extraGuidance) {
    const messages = [];
    // Include new detector results (block/warn only, deduped by message text)
    const seen = new Set();
    for (const r of newDetectorResults) {
        if (!r.message)
            continue;
        if (r.severity === "info")
            continue;
        if (seen.has(r.message))
            continue;
        seen.add(r.message);
        messages.push(r.message);
    }
    if (extraGuidance)
        messages.push(extraGuidance);
    return messages.join("\n\n");
}
export function setNextGuidance(state, guidance) {
    state.nextGuidance = guidance;
}
//# sourceMappingURL=injector.js.map