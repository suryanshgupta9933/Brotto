/**
 * Extraction rules — force the model to actually extract content from pages.
 *
 * The user's specific insight: "the model just visits pages but emits
 * next_step instead of actual data". This section forces extraction.
 */
export function extractionRulesSection() {
    return `EXTRACT-ON-VISIT — non-negotiable (this is the #1 reason extraction tasks fail):

When you visit a page, the page contains the answer. Your job is to READ the page text in the rendered context and EXTRACT the values the goal is asking for. The model has all the data — you just need to write it into memory.

Concrete pattern:
1. visit_url(url) → next observation contains the page text
2. Read the page text in the CURRENT OBSERVATION section
3. Find the values that match the goal's keys
4. emit memoryUpdates with those EXACT values:
   - visit GitHub repo → memoryUpdates: [{key: "stars", value: "3.8k"}, {key: "language", value: "Python"}, ...]
   - visit Wikipedia article → memoryUpdates: [{key: "source_1_title", value: "<exact title from page>"}, {key: "source_1_summary", value: "<first paragraph>"}]
   - visit arXiv abstract → memoryUpdates: [{key: "paper_title", value: "<exact title>"}, {key: "paper_authors", value: "<authors>"}]
5. THEN in a separate turn (or same turn if not also verifying), verify_completion

Anti-patterns the harness rejects:
- visiting a page and emitting only \`phase_outline\` / \`next_step\` (these are scaffold, not data — the harness detects this and injects [EXTRACTION MISSING])
- visiting a page and emitting \`recorded in working memory\` without specifying keys and values (the harness checks for the literal "recorded as X" pattern OR a memoryUpdate with that key)
- terminating without citing any recorded values (the grounding gate rejects ungrounded finalAnswers)

The harness counts your \`data\` memoryUpdates (keys that match the goal). Plan around this: every visit must produce ≥1 data memoryUpdate that the goal actually uses.`;
}
//# sourceMappingURL=extraction-rules.js.map