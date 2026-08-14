/**
 * Memory rules — what goes in memory vs scratchpad.
 */
export function memoryRulesSection() {
    return `WORKING MEMORY vs PLAN NOTES (the split):
- \`memoryUpdates\` (key-value facts): the user's actual answer data. Order IDs, tracking IDs, names, dates, numbers, status keywords. These MUST appear in your finalAnswer.
- \`scratchpadUpdates\` (plan notes): internal scaffolding. phase_outline, next_step, partial_<key>. The user never sees these.

RECORD-BEFORE-VERIFY RULE (saves 30-turn loops):
Many goals say "record X in working memory under key Y". For these, the goal becomes a fact-recording criterion. The harness REJECTS a verify_completion that claims satisfaction without the corresponding memoryUpdate in the SAME tool call batch.
If your criterion says "record X under key Y", your tool call MUST include BOTH:
  (a) memoryUpdates: [{key: 'Y', value: '<the actual value you saw>', evidence: '<where you saw it>'}]
  (b) verify_completion({criterionId, satisfied: true, evidence: 'recorded as Y in working memory'})
Without the memoryUpdate, the verify is downgraded to unsatisfied and you get [HARD CORRECTIVE] on the next turn.

EXTRACT-ON-VISIT (this is the #1 reason extraction tasks fail):
When you visit a page and the goal needs specific facts from it (title, author, price, order #, date, name, etc.), your NEXT tool call MUST be a memoryUpdate carrying those facts — not \`next_step\`, not \`phase_outline\`, not another visit_url. Read the page text in the rendered context, find the values, and emit:
  memoryUpdates: [{key: '<exact key the goal asks for>', value: '<exact text from the page>', evidence: '<short snippet from the page>'}]
Don't keep visiting pages without recording — \`next_step\` and \`phase_outline\` are scaffold keys, NOT data. Every visit must produce ≥1 data memoryUpdate, or you've wasted the visit.`;
}
//# sourceMappingURL=memory-rules.js.map