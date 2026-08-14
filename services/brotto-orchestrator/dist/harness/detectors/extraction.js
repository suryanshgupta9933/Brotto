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
import { correctiveMessages } from "../correction/templates.js";
const SCAFFOLD_KEYS = new Set([
    "phase_outline",
    "next_step",
    "partial_",
    "phase_1_done",
    "phase_2_done",
    "phase_3_done",
    "phase_4_done",
    "phase_5_done",
]);
function isScaffoldKey(key) {
    for (const prefix of SCAFFOLD_KEYS) {
        if (key === prefix || key.startsWith(prefix))
            return true;
    }
    return false;
}
export function detectExtractionMissed(state, action, pageSnapshotId) {
    const updates = action.memoryUpdates ?? [];
    if (updates.length === 0)
        return { detector: "extraction", severity: "info", message: null };
    // Count data updates (not scaffold)
    const dataUpdates = updates.filter((u) => !isScaffoldKey(u.key));
    if (dataUpdates.length > 0) {
        return { detector: "extraction", severity: "info", message: null };
    }
    // Only fire on the same turn as the page was captured (currentSnapshotId)
    // — otherwise the corrective is stale.
    if (pageSnapshotId !== state.currentSnapshotId) {
        return { detector: "extraction", severity: "info", message: null };
    }
    return {
        detector: "extraction",
        severity: "warn",
        message: correctiveMessages.extractionMissing(pageSnapshotId),
    };
}
//# sourceMappingURL=extraction.js.map