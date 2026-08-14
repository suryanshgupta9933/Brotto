/**
 * Detectors aggregator — runs all detectors and returns the union of their
 * corrective messages. Single entry point used by the loop.
 */
import type { DetectResult, HarnessState, ParsedAction } from "../types.js";
export declare function runActionDetectors(state: HarnessState, action: ParsedAction, pageSnapshotId: number): DetectResult[];
export * from "./stagnation.js";
export * from "./search-workflow.js";
export * from "./extraction.js";
export * from "./cookie-consent.js";
//# sourceMappingURL=index.d.ts.map