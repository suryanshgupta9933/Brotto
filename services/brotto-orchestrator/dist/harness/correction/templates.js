/**
 * Corrective message templates — one function per failure mode.
 * ponytail: adding a new corrective = adding a function here. Don't inline
 * corrective strings anywhere else; route through here so they stay
 * consistent and easy to evolve.
 */
export const correctiveMessages = {
    /**
     * Search workflow: clicked a search input + insert_text on the same
     * target without a follow-up key('Enter'). Page never filters.
     */
    pressEnter(targetId) {
        return `[PRESS ENTER] You clicked + typed into target ${targetId.slice(0, 12)} but did NOT press Enter. Search UIs (Gmail, HN, arXiv, Amazon, GitHub) only filter results AFTER Enter is pressed. Your NEXT tool call MUST be: key({key: 'Enter'}). Do not insert_text again, do not click elsewhere — press Enter now.`;
    },
    /**
     * Multi-target progress: the goal expects N items but the model has
     * only recorded X of them. List the exact sub-keys still missing.
     */
    multiTargetProgress(recorded, total, nextKeyGroup, nextKeysList) {
        const keysStr = nextKeysList.length > 0 ? nextKeysList.join(", ") : "(sub-keys)";
        return `[MULTI-TARGET PROGRESS] You've recorded ${recorded} of ${total} targets. Next target: ${nextKeyGroup}. Required memory keys for it: ${keysStr}. Drill into the next item NOW — read its data from the page and emit memoryUpdates with those exact keys and the actual values. The harness counts each recorded key.`;
    },
    /**
     * Final answer ungrounded: terminate was called but finalAnswer
     * references 0% of recorded memory values. Reject and demand a real
     * answer that cites recorded facts.
     */
    finalAnswerUngrounded(memorySample) {
        return `[FINAL ANSWER UNGROUNDED] Your finalAnswer doesn't reference any of the facts you recorded in working memory. Memory has: ${memorySample}. The user reads the finalAnswer — they need to see the actual entities (order IDs, names, dates, numbers), not a meta-statement. Rewrite your finalAnswer to NAME these entities and cite them. Example shape: 'The latest package is order #<id> from <seller>, marked <status> on <date>. Source: <URL>.'`;
    },
    /**
     * Stagnation escape: 3 repeats of the same action signature.
     */
    stagnationEscape(actionType) {
        return `[STAGNATION ESCAPE] You've repeated \`${actionType}\` 3 times with no effect. Re-read the GOAL: are you actually advancing toward it? Pick a FUNDAMENTALLY different action — different element id, different tool, different strategy. Don't repeat the same signature.`;
    },
    /**
     * Hard reset: 5 repeats of the same action signature.
     */
    hardReset(actionType) {
        return `[HARD RESET] You've called \`${actionType}\` 5 times in a row with no observable page change. This signature CANNOT make progress from here. STOP calling it. Pick a DIFFERENT tool: visit_url to a new page, scroll, key('Escape'), or read_scratchpad to recall what you have. The harness will count further repeats against your step budget.`;
    },
    /**
     * Cookie banner auto-dismissed.
     */
    cookieDismissed(count) {
        return `[INFO] Auto-dismissed ${count} cookie banner(s). The page underneath is now interactive. Proceed with your plan.`;
    },
    /**
     * Extraction missing: model visited a page but emitted only scaffold
     * keys (next_step, phase_outline) without any data memoryUpdate.
     */
    extractionMissing(pageSnapshotId) {
        return `[EXTRACTION MISSING] You visited page[${pageSnapshotId}] but didn't extract any data into memory. Your memoryUpdates only contain scaffold keys (next_step / phase_outline / phase_N_done). The page text is right there in your context — read it, find the values the goal needs, and emit memoryUpdates with concrete data. Example: \`memoryUpdates: [{key: 'order_id', value: 'NM22309825348', evidence: 'visible in email subject line'}]\`.`;
    },
    /**
     * Insert-without-click: model called insert_text without first clicking
     * an input. Types into the void.
     */
    clickFirst(repeatCount) {
        return `[CLICK FIRST] You have typed without clicking first ${repeatCount}x — the text goes nowhere. LEFT_CLICK the input (use its targetId from === INTERACTIVE ELEMENTS ===) BEFORE insert_text in your NEXT turn. The correct sequence: left_click(targetId) → insert_text(targetId, text) → key('Enter') or left_click(submit button).`;
    },
    /**
     * Parse error: click action without targetId or coords.
     */
    parseError(actionType) {
        return `[PARSE ERROR] ${actionType} requires EITHER targetId (from === INTERACTIVE ELEMENTS ===) OR x/y coordinates. You called ${actionType}() with neither. Pick the input's targetId from INTERACTIVE ELEMENTS and try again.`;
    },
    /**
     * URL stagnation: same URL 3+ times in a row.
     */
    urlStagnation() {
        return `[URL STAGNATION] You've visited the same URL on the last 3 turns with no new content. If you have what you need, call verify_completion; otherwise visit the next URL or call read_scratchpad.`;
    },
    /**
     * Oscillation: A→B→A→B pattern in last 4 URLs.
     */
    oscillation(a, b) {
        return `[OSCILLATION] You're flipping between ${a} and ${b}. Pick one and finish, or call read_scratchpad to recall what's already done.`;
    },
    /**
     * Missing memory keys.
     */
    missingKeys(missing) {
        return `[MISSING KEYS] You haven't yet recorded these expected memory keys: ${missing.join(", ")}. Before calling verify_completion for any criterion, emit a memoryUpdate with that key.`;
    },
    /**
     * Terminate blocked — composite message for all gate failures.
     */
    terminateBlocked(reasons) {
        return `[TERMINATE BLOCKED] ${reasons.join("; ")}. Emit the missing memoryUpdates FIRST (memoryUpdates with key= and value=), then call terminate again with a populated finalAnswer.`;
    },
};
//# sourceMappingURL=templates.js.map