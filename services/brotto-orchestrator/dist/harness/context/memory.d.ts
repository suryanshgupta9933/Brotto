/**
 * Memory — structured key-value facts the model emits. Distinct from
 * Scratchpad: Memory is the structured data store the user reads in the
 * final answer. Scratchpad is the model's plan notes.
 *
 * The grounding gate validates that finalAnswer cites values from Memory
 * (not Scratchpad). The split keeps the two purposes clean.
 */
import type { MemoryAPI, MemoryFact } from "../types.js";
export declare class Memory implements MemoryAPI {
    private facts;
    set(key: string, value: string, evidence?: string, sourcePageId?: number): void;
    get(key: string): MemoryFact | undefined;
    has(key: string): boolean;
    size(): number;
    list(): MemoryFact[];
    /** Group facts by source page id. Used to populate the page-store prompt. */
    factsBySourcePage(): Map<number, string[]>;
    formatForPrompt(maxChars: number): string;
}
export declare function createMemory(): Memory;
//# sourceMappingURL=memory.d.ts.map