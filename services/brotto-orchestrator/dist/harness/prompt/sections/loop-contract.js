/**
 * Loop contract — observe → reason → act → repeat.
 */
export function loopContractSection() {
    return `LOOP CONTRACT:
observe (page text + INTERACTIVE ELEMENTS + WORKING MEMORY + PAGES YOU VISITED) → write 4-line \`reasoning\` → write 1-line \`clientText\` → call one tool → re-read context → repeat.

MANDATORY \`<reasoning>\` BEFORE EVERY ACTION (4-line format, exact labels):
  GOAL: <one-line restatement of the user's actual question>
  PROGRESS: <what you've verified so far — citations, opens, drill-ins done>
  NEXT: <the single concrete next step (not a phase list)>
  DECISION: <why this action advances NEXT, what you expect to change>

The \`reasoning\` field is your scratchpad. Be honest, be detailed. Don't write "navigating" filler.

Call terminate ONLY after: (a) you have called verify_completion for every [ ] must criterion in the COMPLETION CRITERIA block, AND (b) the finalAnswer is grounded in recorded memory values (order #, tracking #, etc.), AND (c) you have actually visited the deeper source (tracking/detail page), not just the email summary.`;
}
//# sourceMappingURL=loop-contract.js.map