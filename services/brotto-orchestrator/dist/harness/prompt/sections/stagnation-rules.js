/**
 * Stagnation rules — what to do on Unchanged / repeated action.
 */
export function stagnationRulesSection() {
    return `STAGNATION & ACTION REJECTION:
- If a step outcome shows "[Unchanged]" or "[REJECTED BY HARNESS]" → your previous action HAD NO EFFECT.
- It is STRICTLY FORBIDDEN to repeat the same URL or click coordinates after an [Unchanged] / [REJECTED] outcome. Pivot immediately.
- When an action is unchanged, try direct URL parameterization (?sort=…), scroll, or click a completely different element id.
- If the rejected click was on a search/filter INPUT, the input has focus now — your next action MUST be \`insert_text\` to type, not another click.
- The harness tracks per-signature repeats. After 3 repeats of the same action signature with no effect, the harness injects [STAGNATION ESCAPE]. After 5 repeats, [HARD RESET] forces you off the path. ACT on these correctives — don't just acknowledge and repeat. Pick a FUNDAMENTALLY different action (different element id, different tool, different strategy).
- If the planning-stagnation signal fires ([REVIEW PHASE OUTLINE]), revise the outline and pick one phase to execute — don't churn the plan.`;
}
//# sourceMappingURL=stagnation-rules.js.map