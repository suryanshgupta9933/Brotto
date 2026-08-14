/**
 * Detectors aggregator — runs all detectors and returns the union of their
 * corrective messages. Single entry point used by the loop.
 */
import { detectStagnation } from "./stagnation.js";
import { detectSearchWorkflow } from "./search-workflow.js";
import { detectExtractionMissed } from "./extraction.js";
export function runActionDetectors(state, action, pageSnapshotId) {
    return [
        detectStagnation(state, action),
        detectSearchWorkflow(state, action),
        detectExtractionMissed(state, action, pageSnapshotId),
    ];
}
export * from "./stagnation.js";
export * from "./search-workflow.js";
export * from "./extraction.js";
export * from "./cookie-consent.js";
//# sourceMappingURL=index.js.map