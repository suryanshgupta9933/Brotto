/**
 * Exploration rules — the agent's tendency to scan + pick the first
 * "interesting" row is the #1 reason agents land on the wrong item.
 *
 * This section forces a goal-entity check BEFORE the first click and a
 * source-mismatch check BEFORE every terminate. Reframes "make
 * progress" into "make correct progress".
 */
export declare function explorationRulesSection(): string;
//# sourceMappingURL=exploration-rules.d.ts.map