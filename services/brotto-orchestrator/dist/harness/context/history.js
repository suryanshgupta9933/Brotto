/**
 * History — recent tool calls + outcomes. Last 6 by default. Format
 * mirrors what the model sees in the prompt.
 */
const DEFAULT_RECENT = 6;
function truncate(s, max) {
    if (s.length <= max)
        return s;
    return s.slice(0, max - 1) + "…";
}
function formatArgs(args) {
    const parts = [];
    if (typeof args.x === "number" && typeof args.y === "number")
        parts.push(`(${args.x},${args.y})`);
    if (typeof args.url === "string")
        parts.push(args.url);
    if (typeof args.text === "string")
        parts.push(`"${truncate(args.text, 60)}"`);
    if (typeof args.key === "string")
        parts.push(`key=${args.key}`);
    if (typeof args.criterionId === "string")
        parts.push(`criterionId=${args.criterionId}`);
    if (typeof args.satisfied === "boolean")
        parts.push(`satisfied=${args.satisfied}`);
    if (parts.length === 0) {
        const keys = Object.keys(args);
        if (keys.length > 0)
            parts.push(`{${keys.slice(0, 3).join(",")}}`);
    }
    return parts.join(" ");
}
export class History {
    entries = [];
    push(entry) {
        this.entries.push(entry);
    }
    recent(n = DEFAULT_RECENT) {
        return this.entries.slice(-n);
    }
    list() {
        return [...this.entries];
    }
    formatForPrompt(maxChars) {
        if (this.entries.length === 0) {
            return "=== HISTORY (empty — first iteration) ===";
        }
        const recent = this.recent();
        const lines = ["=== RECENT STEPS & VERIFIED OUTCOMES ==="];
        for (const e of recent) {
            lines.push(`  ${e.index}. ${e.type} ${formatArgs(e.args)} → ${truncate(e.result, 200)}`);
        }
        let out = lines.join("\n");
        if (out.length > maxChars)
            out = out.slice(0, maxChars - 3) + "…";
        return out;
    }
}
export function createHistory() {
    return new History();
}
//# sourceMappingURL=history.js.map