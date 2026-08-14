/**
 * Grounding gate (standalone, callable separately from termination).
 * Used by the loop to validate the candidate finalAnswer before accepting terminate.
 */
import type { HarnessState } from "../types.js";
export declare function answerCitesMemory(state: HarnessState, candidateAnswer?: string): {
    cited: number;
    total: number;
    ratio: number;
};
//# sourceMappingURL=grounding.d.ts.map