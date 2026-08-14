/**
 * Harness decision contract and working memory.
 *
 * The model emits a NormalizedDecision per turn: either continue (one action),
 * complete (with final answer), or blocked (with reason). Working memory is
 * harness-owned — the model only proposes updates, the harness merges and
 * dedupes. This keeps memory and loop invariants out of the model's text.
 */
export interface MemoryUpdate {
    key: string;
    value: string;
    evidence: string;
}
export interface WorkingMemoryView {
    facts: MemoryUpdate[];
}
export interface StagnationSignal {
    kind: "repeated_action" | "repeated_observation";
    signature: string;
    count: number;
    message: string;
}
export type NormalizedDecision = {
    kind: "continue";
    reasoning: string;
    memoryUpdates: MemoryUpdate[];
    action: {
        type: string;
        [k: string]: unknown;
    };
} | {
    kind: "blocked";
    reasoning: string;
    memoryUpdates: MemoryUpdate[];
    blockedReason: string;
} | {
    kind: "complete";
    reasoning: string;
    memoryUpdates: MemoryUpdate[];
    finalAnswer: string;
};
export declare class WorkingMemory {
    private facts;
    merge(updates: MemoryUpdate[]): void;
    get size(): number;
    toView(): WorkingMemoryView;
}
export declare function isMemoryUpdate(x: unknown): x is MemoryUpdate;
export declare function validateMemoryUpdates(input: unknown): MemoryUpdate[];
export declare function extractGoalKeywords(goal: string): string[];
export interface MemoryValidationResult {
    accepted: MemoryUpdate[];
    rejected: Array<{
        update: MemoryUpdate;
        reason: string;
    }>;
}
export declare function validateMemoryUpdatesForGoal(input: unknown, goal: string): MemoryValidationResult;
//# sourceMappingURL=decision.d.ts.map