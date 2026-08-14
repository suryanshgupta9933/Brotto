/**
 * Memory — structured key-value facts the model emits. Distinct from
 * Scratchpad: Memory is the structured data store the user reads in the
 * final answer. Scratchpad is the model's plan notes.
 *
 * The grounding gate validates that finalAnswer cites values from Memory
 * (not Scratchpad). The split keeps the two purposes clean.
 */
const MAX_VALUE_CHARS = 500;
const MAX_KEYS_IN_PROMPT = 30;
function truncate(s, max) {
    if (s.length <= max)
        return s;
    return s.slice(0, max - 1) + "…";
}
export class Memory {
    facts = new Map();
    set(key, value, evidence, sourcePageId) {
        if (!key || !value)
            return;
        this.facts.set(key, {
            key,
            value: truncate(value, MAX_VALUE_CHARS),
            evidence,
            recordedAt: Date.now(),
            sourcePageId: sourcePageId ?? null,
        });
    }
    get(key) {
        return this.facts.get(key);
    }
    has(key) {
        return this.facts.has(key);
    }
    size() {
        return this.facts.size;
    }
    list() {
        return [...this.facts.values()];
    }
    /** Group facts by source page id. Used to populate the page-store prompt. */
    factsBySourcePage() {
        const out = new Map();
        for (const fact of this.facts.values()) {
            if (fact.sourcePageId === null)
                continue;
            const list = out.get(fact.sourcePageId) ?? [];
            list.push(`${fact.key}=${fact.value}`);
            out.set(fact.sourcePageId, list);
        }
        return out;
    }
    formatForPrompt(maxChars) {
        if (this.facts.size === 0) {
            return "=== WORKING MEMORY (empty — record key facts here before they expire from context) ===";
        }
        const entries = [...this.facts.values()].slice(0, MAX_KEYS_IN_PROMPT);
        const lines = [
            "=== WORKING MEMORY (structured key-value facts — the values the user will see in the final answer) ===",
            "Use memoryUpdates to record: order IDs, tracking IDs, names, dates, numbers, status keywords.",
            "",
        ];
        for (const f of entries) {
            const ev = f.evidence ? `  (evidence: ${truncate(f.evidence, 100)})` : "";
            lines.push(`  ${f.key} = ${JSON.stringify(f.value)}${ev}`);
        }
        let out = lines.join("\n");
        if (out.length > maxChars)
            out = out.slice(0, maxChars - 3) + "…";
        return out;
    }
}
export function createMemory() {
    return new Memory();
}
//# sourceMappingURL=memory.js.map