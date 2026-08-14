/**
 * Heuristic extraction of completion criteria from a free-form goal prompt.
 *
 * Returns a list of criteria the model must verify before terminating. Two
 * kinds: `must_have` (policy gate blocks terminate if any unsatisfied) and
 * `should_have` (advisory, surfaced in the prompt).
 *
 * ponytail: deterministic regex extraction. Cheap, predictable, no LLM call.
 * The model is the one that decides whether each criterion is *actually*
 * satisfied in the live page state — this module only enumerates what to
 * check. If extraction misses a criterion, the model can still call
 * verify_completion with an arbitrary id and the gate will warn (but allow)
 * via `should_have`.
 *
 * Upgrade path: if recall on long goals drops below ~80%, swap for an LLM
 * extractor at session start (one-shot, no latency cost in the loop).
 */
export type CriterionKind = "must_have" | "should_have";
export interface CompletionCriterion {
    id: string;
    description: string;
    kind: CriterionKind;
}
export interface CriterionExtractionResult {
    criteria: CompletionCriterion[];
    unmatchedGoalKeywords: string[];
}
export declare function extractCriteria(goal: string): CriterionExtractionResult;
//# sourceMappingURL=extract.d.ts.map