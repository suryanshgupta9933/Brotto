/**
 * Corrective injector — merges detector results into the next-prompt guidance.
 * Single function used by the loop.
 */
import type { DetectResult, HarnessState } from "../types.js";
export declare function buildNextGuidance(_state: HarnessState, newDetectorResults: DetectResult[], extraGuidance?: string): string;
export declare function setNextGuidance(state: HarnessState, guidance: string): void;
//# sourceMappingURL=injector.d.ts.map