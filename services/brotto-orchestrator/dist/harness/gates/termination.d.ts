/**
 * Termination gate — composes all sub-checks into a single canTerminate.
 *
 * Reasons for blocking:
 *  1. Not all must-have criteria verified
 *  2. Expected memory keys missing
 *  3. Final answer doesn't cite any recorded values (grounding)
 */
import type { GateResult, HarnessState } from "../types.js";
export declare function canTerminate(state: HarnessState): GateResult;
//# sourceMappingURL=termination.d.ts.map