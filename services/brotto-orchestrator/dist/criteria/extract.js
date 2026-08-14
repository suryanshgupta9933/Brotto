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
// ponytail: must_have keywords — anything that sounds like a hard requirement.
// Anything else defaults to should_have.
const MUST_HAVE_HINT = /\b(?:must|required?|has to|needs? to|mandatory|critical|essential)\b/i;
// ponytail: step verbs that imply a discrete action — visiting, recording,
// verifying, creating, etc. Numbered items using these are must_have by
// default (the goal says "do this step", not "ideally also this").
const STEP_VERB_RE = /\b(?:visit|record|verify|create|submit|fill|navigate|click|enter|type|send|collect|build|write|generate|complete|confirm|capture|locate|find|identify|track|compile|examine|assess|analyze|evaluate)\b/i;
// ponytail: URL-bearing criterion = must_have. The goal is telling the
// model "you MUST visit this URL".
const URL_RE = /\bhttps?:\/\/[^\s)]+/i;
function classifyKind(text) {
    if (MUST_HAVE_HINT.test(text))
        return "must_have";
    if (URL_RE.test(text))
        return "must_have";
    if (STEP_VERB_RE.test(text))
        return "must_have";
    return "should_have";
}
// ponytail: explicit numbered list marker — "1.", "2.", "3." lines.
// Anchored at start of line so prose like "section 1." doesn't trip it.
const NUMBERED_LIST_RE = /(?:^|\n)\s*(\d+)\.\s+([^\n]{8,400})/g;
// ponytail: bullet line with a verb phrase that looks like a deliverable.
const BULLET_RE = /(?:^|\n)\s*[-*]\s+([^\n]{8,400})/g;
// ponytail: inline "should include X", "must contain X", "with proper X" —
// picks up trailing requirements the numbered list missed.
const INLINE_HINT_RE = /\b(?:should include|must include|should contain|must contain|with proper|with appropriate|should have|must have|needs? to have)\s+([^.\n]{6,200})/gi;
export function extractCriteria(goal) {
    const criteria = [];
    const seen = new Set();
    const numbered = [];
    // Numbered list lines
    for (const m of goal.matchAll(NUMBERED_LIST_RE)) {
        const text = m[2].trim();
        if (!looksLikeCriterion(text))
            continue;
        const id = `num_${m[1]}`;
        if (seen.has(id))
            continue;
        seen.add(id);
        numbered.push(text);
        criteria.push({
            id,
            description: clean(text),
            // ponytail: numbered items with explicit verbs ("record", "visit",
            // "verify", "create") are must_have by default — they describe a step
            // the model must execute, not optional polish.
            kind: classifyKind(text),
        });
    }
    // Bullet lines (only if no numbered list found, to avoid double-counting)
    if (numbered.length === 0) {
        let bulletIdx = 0;
        for (const m of goal.matchAll(BULLET_RE)) {
            const text = m[1].trim();
            if (!looksLikeCriterion(text))
                continue;
            bulletIdx += 1;
            const id = `bul_${bulletIdx}`;
            if (seen.has(id))
                continue;
            seen.add(id);
            criteria.push({
                id,
                description: clean(text),
                kind: classifyKind(text),
            });
        }
    }
    // Inline "should include X" hints — always should_have unless wording is strict.
    let inlineIdx = 0;
    for (const m of goal.matchAll(INLINE_HINT_RE)) {
        inlineIdx += 1;
        const text = m[1].trim();
        const id = `hint_${inlineIdx}`;
        if (seen.has(id))
            continue;
        seen.add(id);
        criteria.push({
            id,
            description: clean(text),
            kind: /\b(?:must|required?)\b/i.test(m[0]) ? "must_have" : "should_have",
        });
    }
    // ponytail: if the goal text mentions page-count / length / citation
    // requirements anywhere, surface them as their own criteria. Common in
    // report-style tasks.
    const length = goal.match(/\b(\d+)\s*[-–to]+\s*(\d+)\s*(?:page|section)s?\b/i);
    if (length) {
        const id = "len_pages";
        if (!seen.has(id)) {
            seen.add(id);
            criteria.push({
                id,
                description: `Document length: ${length[1]}–${length[2]} pages.`,
                kind: "must_have",
            });
        }
    }
    const citation = /\b(?:proper citations?|with citations?|citations? and references?)\b/i.test(goal);
    if (citation) {
        const id = "citations";
        if (!seen.has(id)) {
            seen.add(id);
            criteria.push({
                id,
                description: "Include proper citations / references.",
                kind: "must_have",
            });
        }
    }
    // ponytail: fallback criteria for natural-language goals. When the goal
    // is a single question ("check my package status") or a one-shot action
    // ("log in", "find X"), the extractor finds nothing — the model never
    // sees a [ ] checklist and never calls verify_completion. Synthesize
    // MULTI-SOURCE verification criteria (goal_complete + verify_latest +
    // verify_source) so the gate forces the model to drill past the first
    // readable page. General pattern: any "check status of latest X" goal
    // requires (a) finding X, (b) confirming recency, (c) citing source.
    if (criteria.length === 0 || (criteria.every((c) => c.kind === "should_have") && criteria.length < 2)) {
        const fallbacks = synthesizeFallbackCriteria(goal);
        for (const fb of fallbacks) {
            if (!seen.has(fb.id)) {
                seen.add(fb.id);
                criteria.push(fb);
            }
        }
    }
    return {
        criteria,
        unmatchedGoalKeywords: [],
    };
}
// ponytail: synthesize a single must_have criterion from a natural-language
// goal. Patterns:
//   "check/find X" → "Report X with the source URL"
//   "log in / sign in" → "Successfully authenticated, on the post-login page"
//   "submit / send / post X" → "X was submitted"
//   "go to / navigate to X" → "Navigated to X"
function synthesizeFallbackCriteria(goal) {
    const out = [];
    const g = goal.trim();
    if (g.length === 0)
        return out;
    // ponytail: multi-source verification. When the goal asks to check /
    // find / verify status of "latest" something, the gate enforces that
    // the model (a) finds the actual answer, (b) confirms it's the
    // newest by date comparison, and (c) cites the source URL where the
    // status was verified (drilling past the first readable page). One
    // generic "report the answer" criterion lets the model terminate
    // after seeing an email subject — too shallow.
    const checkMatch = g.match(/\b(?:check|find|look\s*up|get|search\s*for|locate|track)\s+(?:the\s+)?(.+)/i);
    const wantsRecency = /\b(?:latest|newest|recent|current|now|today)\b/i.test(g);
    const wantsStatus = /\b(?:status|state|delivered|shipped|tracking|where|when)\b/i.test(g);
    const subject = checkMatch ? clean(checkMatch[1]) : clean(g);
    out.push({
        id: "goal_complete",
        description: `Report the answer to "${subject}" — call terminate(finalAnswer=...) with the actual value.`,
        kind: "must_have",
    });
    if (wantsRecency) {
        out.push({
            id: "verify_latest",
            description: `Verify this is the LATEST "${subject}". When multiple candidates exist (e.g., multiple Amazon delivery emails), compare dates/timestamps and pick the newest. Surface the comparison in your evidence (e.g., "selected email dated 2026-08-10 vs prior 2026-08-05").`,
            kind: "must_have",
        });
    }
    if (wantsStatus) {
        out.push({
            id: "verify_source",
            description: `Cite the source URL where you verified the current status — drill into the link (View order / Track package / Tracking ID) and confirm against the destination page, not just the email summary. Your evidence must include the destination URL.`,
            kind: "must_have",
        });
    }
    return out;
}
function synthesizeFallbackCriterion(goal) {
    // ponytail: kept for backward compat (single-criterion callers). Use
    // synthesizeFallbackCriteria for multi-source verification.
    const arr = synthesizeFallbackCriteria(goal);
    return arr[0] ?? null;
}
function looksLikeCriterion(text) {
    if (text.length < 8 || text.length > 400)
        return false;
    // ponytail: skip phrases that are obviously headings or commentary, not
    // deliverables. "Phase N:" headers, "Overview:" headers, "Note:" lines.
    if (/^(?:phase|step|overview|note|notes?|introduction|summary)\b[:\s]/i.test(text))
        return false;
    // ponytail: require at least one verb-ish or noun-ish anchor so we don't
    // pull in stray fragments.
    if (!/[a-z]{3,}/i.test(text))
        return false;
    return true;
}
function clean(text) {
    return text
        .replace(/\s+/g, " ")
        .replace(/^[\s\-*.\d]+/, "")
        .trim()
        .slice(0, 280);
}
//# sourceMappingURL=extract.js.map