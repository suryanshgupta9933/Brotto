# Decision: Product boundary, audience, and the three outsmart bets

**Date:** 2026-09-28
**Type:** Product strategy
**Status:** Accepted
**Related:** `docs/superpowers/specs/2026-09-28-capability-map-design.md`

## Context

Two things were unresolved going into this session.

**Audience.** An earlier assumption in this session was that the target is developers — which would follow naturally from a BYOK, OSS-friendly product. That was wrong. The target is the general, non-technical consumer. BYOK and OSS distribution do not imply a developer *audience*; they are delivery mechanics. Designing for a dev audience (GitHub OAuth, OSS-first onboarding, framework-shaped UX) would have been a category error.

**Boundary.** "Automate my repetitive web chores" — a product whose entry point is *"I do this boring browser thing 20× a week"* — was initially framed as a narrow wedge. The framing was rejected: the product needs all three competitive bets below, and scoping down to a cheap-to-build slice would have thrown away the architecture advantage. The boundary is an *audience and entry point*, not a scope limiter.

## The structural read

Every incumbent sits in one of three postures, each with a fatal flaw the research keeps hitting:

| Posture | Who | Fatal flaw |
|---|---|---|
| Owns the surface | Comet, Dia, Atlas | Browser companies, not agent companies — you must switch browsers to get an agent |
| Remote Chromium | Operator, Manus | Login handoff, bot detection, you cannot see it work |
| Framework | Browser Use, Skyvern | You write and babysit code; developer-only |

Nobody occupies the middle: **an agent that lives in the browser you are already using, with your accounts, that you watch and can stop.** This is an architecture gap, not a feature gap — Operator cannot close it without becoming a browser company, Skyvern cannot without abandoning the cloud model.

## Choice

**Entry point:** automating repetitive logged-in web chores. Research, cross-site data copying, repetitive form filling, watching pages for changes.

**Three bets, all shipped — they are a dependency chain, not competing options:**

1. **It works on the sites behind your login.** The category's stated failure — *"any task with login + 3+ steps breaks on every screenshot-driven approach"* — is architectural. Brotto is immune by construction *if and only if* perception is solid. This is the lead bet and it gates 0A → 1A → 2A.
2. **Trust as the headline, not the fine print.** The category is losing trust in real time: Codex *"launched 826 parallel agents"* unprompted, the spyware-bridge HN thread (151 points), Manus *"8200 credits gone in 1 month."* Most of the underlying machinery already exists (approval cards, secure mode, session-only keys, per-step timing, policy log) — this is a surface bet.
3. **Routines that compound.** Teach a chore once from a reviewed trace, re-run and refine it forever. This is the retention mechanism. Explicitly deferred to Wave 6 because it depends on replay existing.

**Parity list (table stakes, not differentiators, all currently missing or partial):** plain-language tasks, multi-tab, structured output, approval before sensitive actions, history + replay, saved skills, long-running tasks, visible cost, model choice, real onboarding, and the missing action verbs.

## Self-host posture

Self-host is a **credibility and power-user channel, not the onboarding path.** For a non-technical audience "install Docker" is a wall, not an offering. The hosted path is where the product lives and where onboarding points. OSS/self-host is retained because Fork A (distribution) requires it, and because it is how the reliability work earns contributors and credibility — but it must never appear in the first-run path.

## Consequences

**Enabled:**
- A demo competitors structurally cannot copy: a real chore on a real logged-in site.
- Trust as a differentiator rather than a checkbox, riding a live category-wide trust collapse.
- A retention story that justifies month-2 revenue rather than a novelty spike.
- Unambiguous critical path (0A → 1A → 2A) that does not depend on go-to-market.

**Closed off:**
- Cannot compete on bundled UX polish, cloud-scale speed, a free-browser surface, or enterprise procurement.
- Cannot lead with a framework/SDK-shaped product — wrong audience, and it is Browser Use's position.
- "Works on logged-in sites" cannot be claimed until Wave 0–2 exit criteria are met. Claiming it early is worse than not claiming it.

**New constraints:**
- Every capability claim needs a number behind it (Wave 0B), or it is marketing copy.
- Hosting defaults bring an abuse-control obligation, distinct from the OSS story.

## Follow-ups

- [ ] Build the benchmark task set (0B) — a scoping decision in its own spec
- [x] Dependency map written: `docs/superpowers/specs/2026-09-28-capability-map-design.md`
- [x] Auth model decided: `2026-09-28-auth-model.md`
- [ ] Revisit whether bet 3 (routines) can be pulled forward once replay lands
