# Decision: Distribution — OSS core + freemium cloud

**Date:** 2026-09-28 (license refined same day)
**Fork:** A
**Status:** Accepted (Apache 2.0 candidate → BSL on refinement)

## Context

Three options were on the table for how Brotto reaches users:
- A1: OSS core + freemium cloud
- A2: Closed-source freemium extension
- A3: API-only / SDK

The market research showed: (1) the dominant playbook in this category is OSS→cloud, validated by Browser Use ($17M seed on 110k stars) and Skyvern ($2.7M seed + SOC2 + 500+ enterprise teams). (2) Standalone browser-takeover products without dev infra are getting killed (Mariner, Reworkd, Adept, MultiOn consumer). (3) Closed-source freemium fights Anthropic/OpenAI on bundled-model UX — losing battle.

## Choice

**A1: OSS core + freemium cloud.**

Open the harness loop, AX relay, policy engine, secure-mode flow. Keep the server side (auth, billing, history, skill library, replay) under the cloud subscription.

**License:** **Business Source License (BSL)**, with a 3-year conversion to Apache 2.0. The non-commercial-use clause protects cloud revenue; the time-delayed conversion ensures it eventually becomes truly open.

- Permitted without license: personal use, evaluation, non-commercial internal use, modifications for personal/non-commercial purposes.
- Requires commercial license: use to provide a competing commercial product or service, use to operate a hosted service for third parties.
- After 3 years from each release: that release converts to Apache 2.0.

Pattern: Sentry, CockroachDB, MariaDB, HashiCorp (until relicense).

## Consequences

**Enabled:**
- Dev adoption (pip/npm + GitHub stars is the wedge; OSS makes the policy engine a potential standard)
- YC pedigree pathway (Browser Use + Skyvern are YC alumni; pedigree matters in this category)
- HN launch potential
- Vertical landing pages can be added without re-licensing
- Self-host community keeps the OSS version honest
- Cloud tier is pure value-add (history, skills, replay, multi-tab orchestration), not a forced upgrade
- Pricing model (Fork B) is structurally simpler — free self-host, paid cloud, paid enterprise

**Closed off:**
- Can't monetize the harness loop itself — must monetize the wrapper
- Cloud value-add (auth, billing, history, skill library) must be defensible enough that contributors don't fork the whole product for free
- License choice (Q1 in open-questions.md) becomes a fork on question

**New constraints:**
- License choice (Q1) — Apache 2.0 for max adoption, or BSL for cloud protection
- Phase 2 (OSS launch) is now mandatory, not optional
- Repo hygiene (CONTRIBUTING, ARCHITECTURE, public roadmap) becomes a Phase 1 deliverable

## Follow-ups

- [x] Answer Q1 (license choice) — BSL with 3-year Apache 2.0 conversion
- [ ] ARCHITECTURE.md + public roadmap before Phase 2 launch
- [ ] Write LICENSE file at repo root (use BSL template + commercial-license terms)