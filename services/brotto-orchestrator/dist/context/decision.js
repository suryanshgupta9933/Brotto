/**
 * Harness decision contract and working memory.
 *
 * The model emits a NormalizedDecision per turn: either continue (one action),
 * complete (with final answer), or blocked (with reason). Working memory is
 * harness-owned — the model only proposes updates, the harness merges and
 * dedupes. This keeps memory and loop invariants out of the model's text.
 */
export class WorkingMemory {
    facts = new Map();
    merge(updates) {
        for (const u of updates) {
            if (!u || typeof u.key !== "string")
                continue;
            const key = u.key.trim();
            const value = typeof u.value === "string" ? u.value.trim() : "";
            if (!key || !value)
                continue;
            const evidence = typeof u.evidence === "string" ? u.evidence.trim() : "";
            const existing = this.facts.get(key);
            // ponytail: first non-empty wins per key. Updates overwrite only if
            // the existing entry has no evidence — model got more specific.
            if (!existing || (!existing.evidence && evidence)) {
                this.facts.set(key, { key, value, evidence });
            }
        }
    }
    get size() {
        return this.facts.size;
    }
    toView() {
        return { facts: Array.from(this.facts.values()) };
    }
}
export function isMemoryUpdate(x) {
    if (!x || typeof x !== "object")
        return false;
    const r = x;
    return typeof r.key === "string" && typeof r.value === "string";
}
export function validateMemoryUpdates(input) {
    if (!Array.isArray(input))
        return [];
    return input.filter(isMemoryUpdate);
}
// ponytail: domain-agnostic validator for model-emitted memoryUpdates.
// Mirrors fact-extractor's always-crucial + goal-keyword filter. Stops the
// model from poisoning memory with facts from an unrelated domain — e.g.
// committing SOCKENUP.IN shipping updates under an "Amazon package" goal.
//
// Rule: accept if EITHER (a) key matches always-crucial category, OR (b)
// the claim (key/value/evidence) contains a goal keyword AND value does not
// contradict the goal domain (no domain in value that is absent from goal
// keywords). Otherwise reject with a reason the planner turns into a
// corrective.
// ponytail: long-horizon scratchpad keys (phase_outline, next_step,
// partial_*, phase_N_done) are always-crucial — they carry plan state and
// must survive the goal-keyword filter so the model can record them even
// when the goal text doesn't match (e.g. "research X" doesn't share words
// with the partial finding "next_step = drill into statista report").
//
// ponytail: mismatch_<n> keys are also always-crucial. The contradiction
// check (line 153 below) would otherwise reject these — the value's domain
// IS the point of a mismatch record (e.g. "Neeman's email from
// shopifyemail.com"). Without this bypass the model can't log the very
// mismatch it's supposed to detect, and silently fails to pivot. See the
// run where the agent opened a Shopify-sourced email on an Amazon goal and
// was blocked from recording the mismatch fact.
const ALWAYS_CRUCIAL_RE = /^(tracking_id|order_id|amount_|status|event_date|delivered_date|sender|number|phase_outline|next_step|partial_|phase_\d+_done|mismatch_)/;
const DOMAIN_RE = /\b[a-z0-9-]+\.(in|com|org|co|io|net|ai|dev|app)\b/g;
const STOPWORDS = new Set([
    "the", "and", "for", "with", "that", "this", "from", "your", "have",
    "are", "was", "were", "but", "not", "you", "all", "any", "can", "had",
    "her", "his", "how", "man", "new", "now", "old", "see", "two", "way",
    "who", "boy", "did", "its", "let", "put", "say", "she", "too", "use",
    "into", "over", "after", "them", "than", "then", "what", "when", "where",
    "which", "while", "would", "could", "should", "about", "their", "there",
    "these", "those", "through", "before", "because",
]);
export function extractGoalKeywords(goal) {
    if (!goal)
        return [];
    const words = goal.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const seen = new Set();
    const out = [];
    for (const w of words) {
        if (w.length < 3 || STOPWORDS.has(w))
            continue;
        if (seen.has(w))
            continue;
        seen.add(w);
        out.push(w);
    }
    return out;
}
export function validateMemoryUpdatesForGoal(input, goal) {
    const accepted = [];
    const rejected = [];
    if (!Array.isArray(input))
        return { accepted, rejected };
    const keywords = extractGoalKeywords(goal);
    const keywordIncludes = (s) => keywords.length === 0 || keywords.some((kw) => s.includes(kw));
    for (const item of input) {
        if (!isMemoryUpdate(item))
            continue;
        const key = item.key ?? "";
        const valueLc = (item.value ?? "").toLowerCase();
        const evidenceLc = (item.evidence ?? "").toLowerCase();
        // ponytail: contradiction check — if the value contains a domain name
        // (e.g. "sockenup.in") and that domain is NOT referenced by any goal
        // keyword (e.g. "amazon"), reject. This catches SOCKENUP.IN facts
        // sneaking through because the evidence happened to mention "gmail".
        const valueDomains = valueLc.match(DOMAIN_RE) ?? [];
        const valueContradictsGoal = valueDomains.length > 0 && !valueDomains.some((d) => keywordIncludes(d));
        const valueHasKeyword = keywordIncludes(valueLc);
        const evidenceHasKeyword = keywordIncludes(evidenceLc);
        const keyHasKeyword = keywordIncludes(key);
        const isAlwaysCrucial = ALWAYS_CRUCIAL_RE.test(key);
        const claimMatchesGoal = (valueHasKeyword || evidenceHasKeyword || keyHasKeyword) && !valueContradictsGoal;
        if (isAlwaysCrucial || claimMatchesGoal) {
            accepted.push(item);
        }
        else {
            const why = valueContradictsGoal
                ? `value references a domain [${valueDomains.join(", ")}] that isn't in the goal domain [${keywords.join(", ")}]`
                : `value/evidence/key doesn't reference any goal keyword [${keywords.join(", ")}] and key isn't in an always-crucial category`;
            rejected.push({
                update: item,
                reason: `Memory update key="${key}" value="${(item.value ?? "").slice(0, 60)}" rejected: ${why}. Drop this update or rewrite the evidence to cite a source that matches the goal domain.`,
            });
        }
    }
    return { accepted, rejected };
}
//# sourceMappingURL=decision.js.map