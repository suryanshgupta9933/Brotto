# Product Decisions Log

Append-only. **Every product decision gets a file here.** When a decision is reversed, write a new file that supersedes the old one; never edit history.

## File naming

`YYYY-MM-DD-<slug>.md`

- `YYYY-MM-DD` — date the decision was made (not when discussed)
- `<slug>` — kebab-case, ≤60 chars, summarizes the decision

Examples:
- `2026-09-28-distribution-oss-cloud.md`
- `2026-09-28-pricing-byok-freemium.md`
- `2026-10-15-vertical-recruiters-first.md`

## File template

```markdown
# Decision: <one-line summary>

**Date:** YYYY-MM-DD
**Fork:** A | B | C | other (from open-questions.md)
**Status:** Accepted | Superseded by <new-decision-file>

## Context

What was the question? What were the options? Why now?

## Choice

What did we pick?

## Consequences

What's enabled? What's closed off? What new constraints does this create?

## Follow-ups

- [ ] Concrete next action
- [ ] What to revisit, and when
```

## Index

<!-- Newest first. One line per decision. -->

| Date | Decision | Status |
|---|---|---|
| _none yet — first decision lands when a fork is answered_ | | |

## What goes here vs. `decisions.md` (repo root)

- **`decisions.md`** at repo root = **architectural** decisions (D1–D10 currently). Locked code-architecture choices: AX tree, ref IDs, agent loop, etc.
- **`docs/product/decisions/`** = **product/strategy** decisions (forks A/B/C, vertical, vertical spinout timing, license choice, etc.).

Different scopes, both append-only. Architectural decisions change when the architecture changes; product decisions change when the market/user/strategy shifts.