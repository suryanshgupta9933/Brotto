# Decision: Multi-tab parallelism — Free for everyone

**Date:** 2026-09-28
**Question:** Q4 (open-questions.md)
**Status:** Accepted

## Context

Two options:
- Free for everyone — multi-tab is table-stakes
- Paid (Pro+ only) — power feature behind paywall

The pain-points research showed "no parallelism / multi-tab" as a top-10 pain point for power users (Skyvern #4392: "single shared X display"). Multi-tab is what unlocks power use cases (price comparison across N sites, parallel form fills, etc.).

## Choice

**Free for everyone, including the OSS self-host and the free cloud tier.**

Single-tab users are not the people we monetize anyway. Power users hit Pro either because of history+skill library+replay, or because of vertical workflow needs. Multi-tab is the underlying capability that makes everything else useful.

## Consequences

**Enabled:**
- OSS self-host is meaningfully useful (single-tab is a demo, multi-tab is a tool)
- Free cloud tier is more compelling (cap is on count, not capability)
- Power users see "yes, it can do what I need" without hitting a paywall first

**Closed off:**
- Can't use multi-tab as a Pro-only acquisition lever
- Cloud concurrency is a real infra cost (more parallel sessions = more FastAPI workers)

**New constraints:**
- Free cloud tier rate limit should be on tasks/day, not on concurrent sessions
- Multi-tab concurrency needs a sensible cap in free tier (e.g. 2 concurrent tasks/day in free cloud; unlimited in paid)
- Server-side state model needs to handle multiple tabs per session cleanly

## Follow-ups

- [ ] Multi-tab implementation (Phase 3 — gap-analysis.md)
- [ ] Free cloud tier concurrency cap design (2 concurrent tasks?)
- [ ] Server state model for multiple tabs per session (Phase 3 work)