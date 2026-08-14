/**
 * Corrective message templates — one function per failure mode.
 * ponytail: adding a new corrective = adding a function here. Don't inline
 * corrective strings anywhere else; route through here so they stay
 * consistent and easy to evolve.
 */
export declare const correctiveMessages: {
    /**
     * Search workflow: clicked a search input + insert_text on the same
     * target without a follow-up key('Enter'). Page never filters.
     */
    pressEnter(targetId: string): string;
    /**
     * Multi-target progress: the goal expects N items but the model has
     * only recorded X of them. List the exact sub-keys still missing.
     */
    multiTargetProgress(recorded: number, total: number, nextKeyGroup: string, nextKeysList: string[]): string;
    /**
     * Final answer ungrounded: terminate was called but finalAnswer
     * references 0% of recorded memory values. Reject and demand a real
     * answer that cites recorded facts.
     */
    finalAnswerUngrounded(memorySample: string): string;
    /**
     * Stagnation escape: 3 repeats of the same action signature.
     */
    stagnationEscape(actionType: string): string;
    /**
     * Hard reset: 5 repeats of the same action signature.
     */
    hardReset(actionType: string): string;
    /**
     * Cookie banner auto-dismissed.
     */
    cookieDismissed(count: number): string;
    /**
     * Extraction missing: model visited a page but emitted only scaffold
     * keys (next_step, phase_outline) without any data memoryUpdate.
     */
    extractionMissing(pageSnapshotId: number): string;
    /**
     * Insert-without-click: model called insert_text without first clicking
     * an input. Types into the void.
     */
    clickFirst(repeatCount: number): string;
    /**
     * Parse error: click action without targetId or coords.
     */
    parseError(actionType: string): string;
    /**
     * URL stagnation: same URL 3+ times in a row.
     */
    urlStagnation(): string;
    /**
     * Oscillation: A→B→A→B pattern in last 4 URLs.
     */
    oscillation(a: string, b: string): string;
    /**
     * Missing memory keys.
     */
    missingKeys(missing: string[]): string;
    /**
     * Terminate blocked — composite message for all gate failures.
     */
    terminateBlocked(reasons: string[]): string;
};
//# sourceMappingURL=templates.d.ts.map