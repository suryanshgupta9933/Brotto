/**
 * PageSnapshotStore — every page the agent visits is captured here. Model
 * references pages by id (page[0], page[1], ...) when synthesizing final
 * answers or recalling earlier context.
 *
 * ponytail: the harness MUST be able to surface all visited pages to the
 * model so a multi-step research task can pull facts from page[0] when
 * constructing the final answer at page[N]. The previous design threw away
 * all earlier pages — the model only ever saw the current observation.
 *
 * Snapshots are derived from PageObservation (no separate capture). The
 * store picks which fields to keep and assigns sequential ids.
 */
const MAX_HEADINGS = 5;
const MAX_BODY_CHARS = 2000;
const MAX_ELEMENT_LABELS = 20;
function truncate(s, max) {
    if (s.length <= max)
        return s;
    return s.slice(0, max - 1) + "…";
}
function extractHeading(headings) {
    return headings[0] ?? "(no heading)";
}
function goalRelevant(obs, goalKeywords) {
    if (goalKeywords.length === 0)
        return true;
    const haystack = `${obs.url}\n${obs.headings.join(" ")}\n${obs.bodyText}`.toLowerCase();
    let hits = 0;
    for (const kw of goalKeywords) {
        if (haystack.includes(kw.toLowerCase()))
            hits += 1;
    }
    // 1+ keyword hits = relevant
    return hits > 0;
}
export class PageSnapshotStore {
    nextId = 0;
    pages = [];
    capture(observation, goalKeywords = []) {
        const id = this.nextId++;
        this.pages.push({
            id,
            url: observation.url,
            heading: extractHeading(observation.headings),
            headings: observation.headings.slice(0, MAX_HEADINGS),
            bodyText: truncate(observation.bodyText, MAX_BODY_CHARS),
            interactiveElementLabels: observation.interactiveElementLabels.slice(0, MAX_ELEMENT_LABELS),
            visitedAt: observation.capturedAt,
            goalRelevant: goalRelevant(observation, goalKeywords),
        });
        return id;
    }
    get(id) {
        return this.pages.find((p) => p.id === id);
    }
    list() {
        return [...this.pages];
    }
    size() {
        return this.pages.length;
    }
    /**
     * Render for the prompt. Format:
     *   === PAGES YOU VISITED (refer by id, e.g. "page[0]") ===
     *   [page[0]] Inbox - Gmail
     *     URL: https://mail.google.com/mail/u/0/
     *     Goal-relevant: yes
     *     Recorded facts: <memory recorded on this page>
     *   ...
     *
     * When factsRecordedByPage is provided, the per-page section includes
     * which memory keys the model recorded on that page (via sourcePageId).
     */
    formatForPrompt(maxChars, factsRecordedByPage = new Map()) {
        if (this.pages.length === 0)
            return "";
        const lines = ["=== PAGES YOU VISITED (refer by id, e.g. \"page[0]\") ==="];
        for (const p of this.pages) {
            lines.push(`[page[${p.id}]] ${p.heading}`);
            lines.push(`  URL: ${p.url}`);
            lines.push(`  Goal-relevant: ${p.goalRelevant ? "yes" : "no"}`);
            const facts = factsRecordedByPage.get(p.id) ?? [];
            if (facts.length > 0) {
                lines.push(`  Recorded facts: ${facts.join(", ")}`);
            }
            lines.push("");
        }
        let out = lines.join("\n");
        if (out.length > maxChars) {
            out = out.slice(0, maxChars - 3) + "…";
        }
        return out;
    }
}
// ─── Default factory ────────────────────────────────────────────────────────
export function createPageSnapshotStore() {
    return new PageSnapshotStore();
}
//# sourceMappingURL=page-store.js.map