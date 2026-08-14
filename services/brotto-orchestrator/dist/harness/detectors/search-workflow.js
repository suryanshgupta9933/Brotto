/**
 * Search workflow detector — click + insert_text on same target without
 * follow-up key('Enter'). Fix 1.
 */
import { correctiveMessages } from "../correction/templates.js";
const WINDOW = 4;
export function detectSearchWorkflow(state, action) {
    if (action.type !== "insert_text") {
        return { detector: "search-workflow", severity: "info", message: null };
    }
    const targetId = action.args.targetId;
    if (!targetId) {
        return { detector: "search-workflow", severity: "info", message: null };
    }
    const last = state.actionSignatures.slice(-WINDOW);
    const hasKey = last.some((s) => s.startsWith("key:"));
    if (hasKey) {
        return { detector: "search-workflow", severity: "info", message: null };
    }
    // Last 2 entries should be left_click:<targetId> then insert_text:<targetId>
    const last2 = last.slice(-2);
    if (last2.length !== 2) {
        return { detector: "search-workflow", severity: "info", message: null };
    }
    const sameTarget = last2[0].startsWith("left_click:") &&
        last2[1].startsWith("insert_text:") &&
        last2[0].slice("left_click:".length) === last2[1].slice("insert_text:".length);
    if (!sameTarget) {
        return { detector: "search-workflow", severity: "info", message: null };
    }
    const sameTargetId = last2[0].slice("left_click:".length) === targetId;
    if (!sameTargetId) {
        return { detector: "search-workflow", severity: "info", message: null };
    }
    return {
        detector: "search-workflow",
        severity: "warn",
        message: correctiveMessages.pressEnter(targetId),
    };
}
//# sourceMappingURL=search-workflow.js.map