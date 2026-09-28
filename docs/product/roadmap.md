# Roadmap — Brotto (Sept 2026)

**Read when planning work.** Update when a wave hits or misses its exit criteria, or when a re-plan changes the derived order.

## How this plan works

**This document holds the strategic targets. It does not hold the work order.**

The work order lives in the capability map: `docs/superpowers/specs/2026-09-28-capability-map-design.md`. That document decomposes the product into independent capability clusters with explicit dependency edges, so that at any moment we can answer "what is the critical path, and what can run beside it" without re-deriving the whole plan.

The previous phase model (Phase 0–5) is superseded. It serialized work that had no actual dependency — most obviously authentication, onboarding, and Chrome Web Store packaging, none of which depend on agent quality and all of which were stuck behind it.

**The map is static; the work order is derived at planning time.** Recompute the critical path against current code state, pick the critical-path work plus the highest-leverage parallel item, then write a spec per workstream. See "Deriving the next plan" in the map.

## Waves

| Wave | Question | Depends on |
|---|---|---|
| **0 — Foundation** | Can it see, and can we tell? | — |
| **1 — Action** | Can it act? | 0A |
| **2 — Recovery** | Can it recover? | 0A, 1A |
| **3 — Identity & install** | Can a stranger get in? | **nothing — start now, in parallel** |
| **4 — Observability** | Can they trust and inspect it? | 0B, 0A |
| **5 — Scale** | Can it do more than one thing? | 1, 2 |
| **6 — Compounding** | Does it get better? | 4 |
| **7 — Distribution & revenue** | Does it make money? | 6 |

Workstream contents and per-wave exit criteria are in the map.

**Critical path:** 0A → 1A → 2A, entirely inside the agent. Only the reliability claim is gated on it.

**Wave 3 is unblocked today.** Auth, onboarding, CWS packaging, and cost visibility share no dependency with the reliability work. Scheduling them after it is the single largest waste in the previous plan.

## Strategic targets (12-month)

| Metric | Target | Benchmark |
|---|---|---|
| GitHub stars | 10–25k | Browser Use started at 110k |
| CWS weekly active installs | 5–20k | Surfside ~40k peak |
| ARR | $250k–$1.5M | Skyvern cleared $1M in year 1 |
| Paying teams | 50–200 | Browser Use cloud ~500 enterprise teams |
| Reliability benchmark | >85% Web-Bench score | Skyvern ~78%, Manus ~50% |
| Median task cost | <$0.50 on Sonnet 4.6 | Browser Use ~$0.30 |

The reliability benchmark target is what the Wave 0B benchmark exists to measure. Until it exists, the number above is a hypothesis.

## Why the order is what it is

1. **Perception before everything.** Verified gaps: no shadow DOM, no iframe traversal, no canvas fallback, no `aria-hidden` reconciliation, no dynamic-stability wait, and observation hard-capped at 6000 chars / 50 targets. The agent is structurally blind on component-library sites, cross-origin embeds, and dense pages — which are the surfaces of the target use case. See the map's justification table.
2. **Measurement is a peer of perception, not a follow-up.** Optimizing reliability without a benchmark optimizes against imagined failures.
3. **Recovery is what makes a chore complete.** A chore that fails at step 4 of 8 does not save the user anything.
4. **Routines last, despite being the strongest retention lever** — they learn from traces, and traces you cannot inspect teach the wrong lessons.
5. **Go-to-market is not blocked on reliability.** It needs to not be embarrassing, not to be perfect.

## When to update this doc

- A wave hits or misses its exit criteria
- The derived work order changes
- A new competitive signal forces a change (e.g. a competitor ships a strong skill library first)
- A fork answer in `decisions/` reshapes a wave
