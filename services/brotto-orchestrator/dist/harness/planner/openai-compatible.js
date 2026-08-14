/**
 * OpenAI-compatible planner adapter — wraps the existing planner for the
 * new harness. Thin shim that converts between ParsedAction and the
 * existing planner's wire format.
 *
 * ponytail: keep this thin. The existing planner does the heavy lifting
 * (SSE, tool calling, memory validation). The new harness plugs in via a
 * typed function callback.
 */
/**
 * Adapter: takes the existing OpenAI-compatible-planner.plan() method
 * and exposes it as the `(prompt: string) => Promise<ParsedAction>`
 * callback the new harness expects.
 *
 * NOTE: full integration with the existing planner requires adapting its
 * PlanningInput schema (it expects goal/context/observation separately).
 * For Phase 1 we expose the adapter shape; Phase 2 wires the actual planner.
 */
export function createOpenAICompatibleAdapter(opts) {
    return async (prompt) => {
        const input = { context: prompt };
        const result = await opts.planner.plan(input);
        // The existing planner returns ActionProposalV1 which has compatible
        // shape with ParsedAction. Cast for now; proper deserialization in
        // Phase 2.
        return result;
    };
}
//# sourceMappingURL=openai-compatible.js.map