/**
 * OpenAI-compatible planner adapter — wraps the existing planner for the
 * new harness. Thin shim that converts between ParsedAction and the
 * existing planner's wire format.
 *
 * ponytail: keep this thin. The existing planner does the heavy lifting
 * (SSE, tool calling, memory validation). The new harness plugs in via a
 * typed function callback.
 */
import type { ParsedAction } from "../types.js";
/**
 * Adapter: takes the existing OpenAI-compatible-planner.plan() method
 * and exposes it as the `(prompt: string) => Promise<ParsedAction>`
 * callback the new harness expects.
 *
 * NOTE: full integration with the existing planner requires adapting its
 * PlanningInput schema (it expects goal/context/observation separately).
 * For Phase 1 we expose the adapter shape; Phase 2 wires the actual planner.
 */
export declare function createOpenAICompatibleAdapter(opts: {
    planner: {
        plan: (input: unknown) => Promise<unknown>;
    };
}): (prompt: string) => Promise<ParsedAction>;
//# sourceMappingURL=openai-compatible.d.ts.map