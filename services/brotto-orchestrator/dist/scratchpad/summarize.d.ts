/**
 * Summarize a scratchpad entry stream into the compact view rendered in the
 * model prompt.
 *
 * Output sections:
 *   - phase_outline: latest outline (key prefix `phase_outline`)
 *   - phases_done:   progress log (key prefix `phase_N_done`)
 *   - next_step:     latest lookahead (key `next_step`)
 *   - partial:       in-progress findings (key prefix `partial_`)
 *   - facts:         everything else, latest value per key
 *   - verifications: count of verify entries per criterion
 *
 * ponytail: keep the summary under a few hundred tokens so it survives long
 * sessions. The model reads full detail via the read_scratchpad tool when the
 * summary isn't enough.
 */
import type { MemoryUpdate } from "../context/decision.js";
import type { ScratchpadEntry } from "./store.js";
export interface ScratchpadSummary {
    phase_outline: MemoryUpdate[];
    phases_done: MemoryUpdate[];
    next_step: MemoryUpdate[];
    partial: MemoryUpdate[];
    facts: MemoryUpdate[];
    verifications: Record<string, {
        satisfied: number;
        unsatisfied: number;
        latestEvidence?: string;
    }>;
    totalEntries: number;
}
export declare function summarize(entries: ScratchpadEntry[]): ScratchpadSummary;
//# sourceMappingURL=summarize.d.ts.map