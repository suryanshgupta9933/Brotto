/**
 * Scratchpad — model's plan notes (phase_outline, next_step, partial_<key>).
 * Distinct from Memory: the scratchpad is internal scaffolding. The user
 * never sees it; the grounding gate doesn't validate against it.
 *
 * The split keeps "I plan to do X" separate from "the answer is Y".
 */
import type { ScratchpadAPI, ScratchpadEntry } from "../types.js";
export declare class Scratchpad implements ScratchpadAPI {
    private entries;
    set(key: string, value: string): void;
    get(key: string): string | undefined;
    size(): number;
    list(): ScratchpadEntry[];
    formatForPrompt(maxChars: number): string;
}
export declare function createScratchpad(): Scratchpad;
//# sourceMappingURL=scratchpad.d.ts.map