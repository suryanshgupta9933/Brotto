/**
 * Extraction detector — fires when the model visits a page but only emits
 * scaffold keys (next_step / phase_outline / phase_N_done) without any
 * data memoryUpdate.
 *
 * ponytail: this is the user's #1 issue ("model just emits next_step").
 * Detector tracks per-page-snapshot whether ANY data memoryUpdate was
 * emitted on the same turn the page was captured. If not, inject
 * [EXTRACTION MISSING] corrective.
 */
import type { DetectResult, HarnessState, ParsedAction } from "../types.js";
export declare function detectExtractionMissed(state: HarnessState, action: ParsedAction, pageSnapshotId: number): DetectResult;
//# sourceMappingURL=extraction.d.ts.map