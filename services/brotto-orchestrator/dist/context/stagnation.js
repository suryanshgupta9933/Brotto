/**
 * Stagnation detection: track normalized action/observation signatures in a
 * rolling window. Repeated decisions are first a recovery signal sent to the
 * model (via system prompt feedback), then a bounded loop break.
 */
const REPEAT_THRESHOLD = 5;
const WINDOW_SIZE = 8;
const PLANNING_REPEAT_THRESHOLD = 3;
const PLANNING_WINDOW = 6;
export function actionSignature(action) {
    const t = (action.type ?? "unknown").toLowerCase();
    switch (t) {
        case "visit_url":
            return `visit_url:${(action.url ?? "").trim()}`;
        case "left_click":
        case "double_click":
        case "right_click":
        case "mouse_move":
            return `${t}:${action.x ?? 0},${action.y ?? 0}`;
        case "insert_text":
            return `insert_text:${(action.text ?? "").slice(0, 40)}`;
        case "key":
            return `key:${action.key ?? ""}`;
        case "scroll":
            return "scroll";
        case "screenshot":
            return "screenshot";
        case "wait":
            return "wait";
        case "memorize_fact":
        case "pause_and_memorize_fact":
            return `${t}:${(action.fact ?? "").slice(0, 80)}`;
        case "terminate":
            return "terminate";
        case "ask_user_question":
            return `ask_user_question`;
        case "history_back":
            return "history_back";
        default:
            return t;
    }
}
export function observationSignature(obs) {
    const url = (obs.url ?? "").trim();
    const title = (obs.title ?? "").trim();
    const firstId = obs.elements && obs.elements.length > 0 ? obs.elements[0]?.id ?? "" : "";
    return `${url}|${title}|${firstId}`;
}
export function detectStagnation(actionSigs, obsSigs) {
    const actionHit = lastNIdentical(actionSigs, REPEAT_THRESHOLD, WINDOW_SIZE);
    if (actionHit) {
        return {
            kind: "repeated_action",
            signature: actionHit,
            count: countOccurrences(actionSigs.slice(-WINDOW_SIZE), actionHit),
            message: `Action "${actionHit}" repeated ${REPEAT_THRESHOLD}+ times in the last ${WINDOW_SIZE} steps. Either pick a materially different action, or if the goal is satisfied, call terminate(finalAnswer='the verified answer').`,
        };
    }
    const obsHit = lastNIdentical(obsSigs, REPEAT_THRESHOLD, WINDOW_SIZE);
    if (obsHit) {
        return {
            kind: "repeated_observation",
            signature: obsHit,
            count: countOccurrences(obsSigs.slice(-WINDOW_SIZE), obsHit),
            message: `Page hasn't changed for ${REPEAT_THRESHOLD}+ steps. Verify you've found the answer in the current page text. If yes, call terminate(finalAnswer='<value>') with the verified value. If not, try a different action.`,
        };
    }
    return null;
}
function lastNIdentical(arr, n, window) {
    if (arr.length < n)
        return null;
    const tail = arr.slice(-window);
    if (tail.length < n)
        return null;
    const recent = tail.slice(-n);
    const ref = recent[0];
    if (recent.every((s) => s === ref))
        return ref;
    return null;
}
function countOccurrences(arr, sig) {
    return arr.filter((s) => s === sig).length;
}
// ponytail: long-horizon planning stagnation. If the model writes the same
// `next_step` repeatedly with no new partial findings or verifications, it's
// stuck on the plan, not the page. Surface a corrective that asks the model
// to revise the phase outline, not the next click.
//
// `entries` is the recent slice (last ~PLANNING_WINDOW memory entries) —
// caller decides what "recent" means; default ~12 entries is enough.
export function detectPlanningStagnation(entries) {
    const recent = entries.slice(-PLANNING_WINDOW);
    if (recent.length < PLANNING_REPEAT_THRESHOLD)
        return null;
    // Collect next_step strings and count occurrences.
    const nextSteps = [];
    // Collect phase_outline revision keys.
    let outlineRevisions = 0;
    // Count new partial findings + verifications (signal of actual progress).
    let progressSignals = 0;
    for (const e of recent) {
        if (e.kind !== "memory")
            continue;
        const k = e.update.key;
        const v = e.update.value;
        if (k === "next_step" && v)
            nextSteps.push(v);
        else if (k === "phase_outline" || k.startsWith("phase_outline_"))
            outlineRevisions += 1;
        else if (k.startsWith("partial_"))
            progressSignals += 1;
    }
    for (const e of recent) {
        if (e.kind === "verify")
            progressSignals += 1;
    }
    if (nextSteps.length >= PLANNING_REPEAT_THRESHOLD) {
        const tail = nextSteps.slice(-PLANNING_REPEAT_THRESHOLD);
        const allSame = tail.every((s) => s === tail[0]);
        if (allSame && progressSignals === 0) {
            return {
                kind: "repeated_observation",
                signature: `next_step:${tail[0].slice(0, 60)}`,
                count: tail.length,
                message: `[REVIEW PHASE OUTLINE] You have written the same next_step ${tail.length} times with no new partial findings or verifications. Your plan is stuck, not the page. Either revise phase_outline (key='phase_outline_revN'), call read_scratchpad to re-read earlier context, or call ask_user_question to clarify the goal.`,
            };
        }
    }
    if (outlineRevisions >= PLANNING_REPEAT_THRESHOLD) {
        return {
            kind: "repeated_observation",
            signature: "phase_outline_churn",
            count: outlineRevisions,
            message: `[REVIEW PHASE OUTLINE] You have revised the phase outline ${outlineRevisions}+ times in the last ${recent.length} steps without progress. The outline is too volatile. Pick one and execute it; call verify_completion for completed criteria; only then revise.`,
        };
    }
    return null;
}
//# sourceMappingURL=stagnation.js.map