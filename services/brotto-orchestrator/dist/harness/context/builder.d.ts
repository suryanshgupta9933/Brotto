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
import type { PageObservation, HarnessState } from "../types.js";
import type { PageSnapshotStore } from "./page-store.js";
export declare function buildContext(opts: {
    state: HarnessState;
    observation: PageObservation;
    pageStore: PageSnapshotStore;
}): string;
//# sourceMappingURL=builder.d.ts.map