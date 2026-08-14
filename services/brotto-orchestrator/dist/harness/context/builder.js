/**
 * Context builder — assembles the full per-turn context for the model.
 * Order (high-signal first / low-signal last per Anthropic pattern):
 *   1. STEP STATUS (orientation)
 *   2. GOAL (the user's original ask)
 *   3. COMPLETION CRITERIA (must-have vs should-have checkboxes)
 *   4. PAGES YOU VISITED (the new page-snapshot store, with recorded facts)
 *   5. WORKING MEMORY (structured key-value)
 *   6. PLAN NOTES (internal scratchpad)
 *   7. HISTORY (recent steps + outcomes)
 *   8. CORRECTIVE GUIDANCE (harness-issued nudges — last so they don't get lost)
 *   9. CURRENT OBSERVATION (URL + path + headings + body + elements)
 *
 * ponytail: section order is deliberate — high-signal content (goal, criteria,
 * memory) stays in the model's attention. Corrective guidance goes LAST so
 * it's prominent for the model's next action without displacing data.
 */
const SECTION_MAX_CHARS = {
    stepStatus: 200,
    goal: 400,
    criteria: 800,
    pages: 2500,
    memory: 1500,
    scratchpad: 600,
    history: 1500,
    guidance: 1500,
    observation: 6000,
};
const CURRENT_OBSERVATION_HEADER = `=== CURRENT OBSERVATION (page[latest] — the page the agent is on RIGHT NOW) ===`;
function renderStepStatus(state) {
    return [
        "=== STEP STATUS ===",
        `Step ${state.steps + 1} · max ${state.maxSteps} · current page snapshot id = page[${state.currentSnapshotId}]`,
        "=== END STEP STATUS ===",
    ].join("\n");
}
function renderGoal(state) {
    const kws = state.goalKeywords.length > 0 ? `\nkeywords: [${state.goalKeywords.join(", ")}]` : "";
    return `=== GOAL ===\n${state.goal}${kws}\n=== END GOAL ===`;
}
function renderCriteria(state) {
    if (state.criteria.length === 0)
        return "";
    const lines = [
        "=== COMPLETION CRITERIA ===",
        "Before terminate, call verify_completion for each [ ] must criterion.",
        "",
    ];
    for (const c of state.criteria) {
        const v = state.verifications.get(c.id);
        const sat = v && v.satisfied > 0;
        const box = sat ? "[x]" : "[ ]";
        const ev = v?.latestEvidence ? `  (evidence: ${v.latestEvidence.slice(0, 80)})` : "";
        lines.push(`  ${box} ${c.id} (${c.kind === "must_have" ? "must" : "advisory"}): ${c.description}${ev}`);
    }
    lines.push("=== END COMPLETION CRITERIA ===");
    return lines.join("\n");
}
function renderObservation(obs) {
    // ponytail: drop the page title per the user's request — the URL + path
    // gives enough orientation without the noisy browser tab title. The
    // heading is captured separately for orientation.
    const lines = [CURRENT_OBSERVATION_HEADER];
    lines.push(`URL: ${obs.url}`);
    if (obs.path)
        lines.push(`PATH: ${obs.path}`);
    if (obs.headings.length > 0) {
        lines.push(`HEADINGS: ${obs.headings.slice(0, 5).join(" | ")}`);
    }
    lines.push("");
    if (obs.bodyText) {
        lines.push("BODY (excerpt):");
        lines.push(obs.bodyText);
        lines.push("");
    }
    if (obs.interactiveElementLabels.length > 0) {
        lines.push("INTERACTIVE ELEMENTS (top 20):");
        for (const label of obs.interactiveElementLabels) {
            lines.push(`  ${label}`);
        }
    }
    return lines.join("\n");
}
export function buildContext(opts) {
    const { state, observation, pageStore } = opts;
    const factsByPage = state.memory.factsBySourcePage();
    const sections = [
        renderStepStatus(state).slice(0, SECTION_MAX_CHARS.stepStatus),
        renderGoal(state).slice(0, SECTION_MAX_CHARS.goal),
        renderCriteria(state).slice(0, SECTION_MAX_CHARS.criteria),
        pageStore.formatForPrompt(SECTION_MAX_CHARS.pages, factsByPage),
        state.memory.formatForPrompt(SECTION_MAX_CHARS.memory),
        state.scratchpad.formatForPrompt(SECTION_MAX_CHARS.scratchpad),
        state.history.formatForPrompt(SECTION_MAX_CHARS.history),
    ];
    if (state.nextGuidance) {
        sections.push(`=== CORRECTIVE GUIDANCE (from harness) ===\n${state.nextGuidance}\n=== END CORRECTIVE GUIDANCE ===`);
    }
    sections.push(renderObservation(observation).slice(0, SECTION_MAX_CHARS.observation));
    return sections.filter(Boolean).join("\n\n");
}
//# sourceMappingURL=builder.js.map