/**
 * History — recent tool calls + outcomes. Last 6 by default. Format
 * mirrors what the model sees in the prompt.
 */
import type { HistoryAPI, HistoryEntry } from "../types.js";
export declare class History implements HistoryAPI {
    private entries;
    push(entry: HistoryEntry): void;
    recent(n?: number): HistoryEntry[];
    list(): HistoryEntry[];
    formatForPrompt(maxChars: number): string;
}
export declare function createHistory(): History;
//# sourceMappingURL=history.d.ts.map