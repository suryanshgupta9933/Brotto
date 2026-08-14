/**
 * Stagnation detector — per-signature repeat counter.
 * Fix 5: [STAGNATION ESCAPE] at 3, [HARD RESET] at 5.
 */
import type { DetectResult, HarnessState, ParsedAction } from "../types.js";
export declare function detectStagnation(state: HarnessState, action: ParsedAction): DetectResult;
//# sourceMappingURL=stagnation.d.ts.map