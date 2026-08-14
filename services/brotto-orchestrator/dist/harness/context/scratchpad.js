/**
 * Scratchpad — model's plan notes (phase_outline, next_step, partial_<key>).
 * Distinct from Memory: the scratchpad is internal scaffolding. The user
 * never sees it; the grounding gate doesn't validate against it.
 *
 * The split keeps "I plan to do X" separate from "the answer is Y".
 */
export class Scratchpad {
    entries = new Map();
    set(key, value) {
        if (!key)
            return;
        this.entries.set(key, { key, value, recordedAt: Date.now() });
    }
    get(key) {
        return this.entries.get(key)?.value;
    }
    size() {
        return this.entries.size;
    }
    list() {
        return [...this.entries.values()];
    }
    formatForPrompt(maxChars) {
        if (this.entries.size === 0) {
            return "=== PLAN NOTES (empty — record phase_outline on first turn, next_step each turn) ===";
        }
        const lines = [
            "=== PLAN NOTES (internal — not for the user) ===",
            "Use these for: phase_outline (first turn), next_step (each turn), partial_<key> (unverified findings).",
            "",
        ];
        for (const e of this.entries.values()) {
            lines.push(`  ${e.key}: ${e.value}`);
        }
        let out = lines.join("\n");
        if (out.length > maxChars)
            out = out.slice(0, maxChars - 3) + "…";
        return out;
    }
}
export function createScratchpad() {
    return new Scratchpad();
}
//# sourceMappingURL=scratchpad.js.map