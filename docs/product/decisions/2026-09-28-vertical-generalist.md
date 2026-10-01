# Decision: Vertical — Generalist for first 6 months

**Date:** 2026-09-28
**Fork:** C
**Status:** Accepted

## Context

Two options:
- C1: Generalist — compete on reliability, memory, templates, replay
- C2: Vertical day-one — pick a vertical, narrower TAM, higher ARPU potential

The market research showed vertical winners exist (EvenUp $1B+ for legal case building, Eve for personal injury intake, Kolena for commercial real estate). But also: real Pro usage data is the only reliable signal for which vertical patterns actually repeat. Picking a vertical too early locks marketing, caps TAM, and risks missing the actual high-volume use case.

## Choice

**C1: Generalist for first 6 months.**

Compete on horizontal capabilities: reliability, memory, skills/templates, replay, multi-tab, cost controls, model-agnostic BYOK. Defer vertical specialization until we have Pro usage data (≥100 paying Pro users with task history) showing which vertical patterns actually repeat.

## Consequences

**Enabled:**
- Maximum TAM (everyone who wants a browser agent)
- Marketing stays generalist ("BYOK browser agent that runs in your Chrome")
- Phase 5 (vertical spinout) becomes data-driven, not bet-driven
- Skill library is naturally horizontal; verticals become curated skill bundles later

**Closed off:**
- No vertical-specific marketing in Phase 1–4
- No vertical-specific templates on day 1
- Slower perceived differentiation (every generalist competitor fights the same way)
- Have to revisit vertical decision in 6 months — that's a future problem

**New constraints:**
- Skill library design must support later vertical bundling (don't paint into a corner)
- Task history must capture enough metadata to enable vertical analysis later (domain, action type, workflow shape)
- Don't accidentally build vertical-shaped features in Phase 1–4 that lock you in

## Follow-ups

- [ ] Q7 (first vertical candidate) — defer to month 6 when usage data exists
- [ ] Q5 (vertical spinout trigger) — revisit at month 6 with real data
- [ ] Skill library metadata schema: support vertical-bundle structure from day 1