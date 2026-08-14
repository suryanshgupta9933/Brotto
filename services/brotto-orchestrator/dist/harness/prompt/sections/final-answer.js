/**
 * Final answer section — how to write finalAnswer.
 *
 * Critical: the grounding gate rejects terminate calls where finalAnswer
 * references 0% of recorded memory values. This section makes that clear.
 */
export function finalAnswerSection() {
    return `FINAL ANSWER DISCIPLINE (this is what the user reads in the side panel):

Your finalAnswer is the single text the user sees. It must contain the actual values from your working memory — not a meta-statement about what you did.

CONCRETE PATTERN — your finalAnswer MUST follow this shape:
  [Headline answer, naming the entity] [2-3 key facts from memory, with their exact values] [Source URL].

Examples:
  BAD: 'I found the package status. The order was shipped. Done.'
       (no entities, no values, no source — the user can't act on this)
  BAD: 'sender: suryansh...; phase_outline: 1. ...; next_step: ...'.
       (that's working memory, not an answer)
  GOOD: 'Your latest Amazon package is order #NM22309825348 from Neeman's (via Shopify) — marked Shipped on Aug 12, 2026. Tracking ID: 24285565. Source: https://mail.google.com/mail/u/0/#inbox/...'.

The 4-line reasoning format ends with DECISION: but the DECISION is for your scratchpad. finalAnswer is what the user reads — it must be a USER-FACING paragraph, not "I am done, the goal is verified".

VERBATIM REQUIREMENT — if you recorded these values in working memory, copy them into finalAnswer VERBATIM:
  - order_id: NM22309825348  →  finalAnswer must contain "NM22309825348"
  - paper_title: "Attention Is All You Need"  →  finalAnswer must contain "Attention Is All You Need"
  - stars: 3.8k  →  finalAnswer must contain "3.8k"
The harness greps finalAnswer for these exact strings. A paraphrase ("about 3,800 stars") does NOT count.

HARD RULES:
- NEVER dump working memory as the final answer. The 'phase_outline', 'next_step', 'partial_*' keys are internal scaffolding. If you call terminate with finalAnswer containing those keys, the answer is rejected.
- NEVER terminate from a SUMMARY page. Drill into the detail/tracking page first.
- finalAnswer MUST reference ≥1 recorded fact. The harness validates grounding — a finalAnswer that doesn't cite any of your own recorded values is rejected as [FINAL ANSWER UNGROUNDED] with the recorded values dumped so you can copy them.
- When the corrective says "[FINAL ANSWER UNGROUNDED] MEMORY HAS THESE FACTS", copy the listed values verbatim into your finalAnswer. Don't paraphrase, don't write "the order id is X" — just use the strings.

For multi-step research tasks (3+ pages), your finalAnswer should cite the page ids you used: "based on page[0] (the inbox) and page[1] (the email), the package is …" — this makes it clear which evidence backs each claim.`;
}
//# sourceMappingURL=final-answer.js.map