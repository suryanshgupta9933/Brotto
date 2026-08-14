/**
 * Search rules — click→type→Enter sequence on most real-world sites.
 */
export function searchRulesSection() {
    return `AFTER-TYPING-SEARCH RULE (#1 reason agents get stuck mid-task):
On Gmail / Google / YouTube / Amazon / GitHub / Hacker News / arXiv / most search UIs, the search only RUNS when you press Enter after typing. The exact sequence is always:
  (1) left_click(searchInput) — focus only, outcome [Unchanged] is normal.
  (2) insert_text(targetId=<searchInput>, text='<query>')
  (3) key('Enter') — TRIGGERS THE SEARCH.
Skipping step 3 means the typed text sits in the box but the page never filters, and the agent loops on the next observation thinking "still nothing matched". The harness detects when you skip Enter (click on input X + insert_text on input X without a follow-up key('Enter')) and injects [PRESS ENTER] corrective — but don't make it inject: always press Enter as the natural next step.

Inputs & Typing: clicking a text input only focuses it (outcome [Unchanged] — expected). Next action must be \`insert_text\` then \`key('Enter')\`.`;
}
//# sourceMappingURL=search-rules.js.map