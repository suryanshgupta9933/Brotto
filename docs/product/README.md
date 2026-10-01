# Brotto Product Docs

Strategic context for turning Brotto into a shipping product. **All files in this directory are gitignored** — they're for the team's working context, not for public docs. Force-add with `git add -f docs/product/` for commits you want to ship.

## How to use these docs

Every Claude session working on Brotto should:

1. **Session start** — Read `vision.md` (2 min) and skim `open-questions.md` (1 min). That gives you the strategic frame for the day.
2. **Before writing code** — Check `gap-analysis.md` and `roadmap.md` to see if the work is already prioritized. If it's a fork-A/B/C decision, check `open-questions.md` first; if unresolved, **stop and ask**.
3. **Before designing a feature** — Check `users.md` (pain points + wishes) and `positioning.md` (competitive matrix) to make sure the feature is in Brotto's lane and addresses a real user need.
4. **Before pricing or fundraising** — Read `market.md`.
5. **Before competing with anyone** — Re-read `competitors.md`. The shutdown list is more important than the live list.
6. **Always** — Update the doc you're working from if reality changes. Stale product docs are worse than no docs.

## Files

| File | When to read | When to update |
|---|---|---|
| `vision.md` | Session start | When the strategic frame changes (rare) |
| `brotto-current-state.md` | When working on the codebase | When a feature ships, gets ripped, or its scope changes |
| `competitors.md` | Before making positioning claims | When a competitor launches, pivots, dies, or raises |
| `market.md` | Before pricing/fundraising decisions | When a major analyst report or funding event shifts the numbers |
| `users.md` | Before designing any feature | When new pain-point or wishlist signal emerges from research |
| `positioning.md` | Before public-facing copy/launch | When the white-space picks change |
| `gap-analysis.md` | When planning work | When a gap is filled or a new gap is discovered |
| `roadmap.md` | When planning work | When a phase is hit, missed, or re-prioritized |
| `risks.md` | When making risk decisions | When a new risk emerges or an old one dies |
| `open-questions.md` | Session start, before big calls | When a question is answered (move to `decisions/`) |
| `decisions/` | Before re-debating | **Append** a new file when answering an open question |
| `dev-environment.md` | When starting a new Claude session on a non-trivial task | When a new skill/hook/pattern becomes standard |

## Workflow rules

- **Never duplicate content between docs.** Link instead. Each doc is a focused read.
- **Never let a doc go stale.** If a fact in here is wrong, fix the doc **in the same commit** as the code change that obsoletes it.
- **Decision docs are append-only.** To supersede, write a new decision that references the old one. History is the point.
- **Open questions live in `open-questions.md`.** When answered, the answer moves to `decisions/YYYY-MM-DD-<slug>.md` and the entry in `open-questions.md` becomes a link.