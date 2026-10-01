# Decision: Skill marketplace — Hybrid (curated community)

**Date:** 2026-09-28
**Question:** Q3 (open-questions.md)
**Status:** Accepted

## Context

Three options for the skill/template marketplace:
- Community-curated — anyone publishes, ratings + install count, real moderation cost (security review of untrusted skills)
- First-party only — Brotto team ships skills, lowest risk, slowest to grow
- Hybrid — community can submit, Brotto team vets and promotes (Vercel pattern)

User wishes research showed: "reusable skills / saved workflows" was a top-3 wishlist item. The skill library is the differentiation between Brotto and Browser Use / Skyvern. A marketplace is the long-term moat.

## Choice

**Hybrid: community can submit, Brotto team vets and promotes.**

Mechanics:
- Anyone with a Brotto account can submit a skill for review.
- Submission includes: skill metadata (name, description, vertical tags, version), the skill definition, a test plan that runs against the AX-tree replay harness.
- Brotto team (or trusted reviewers) reviews for: security (no exfiltration, no destructive actions without approval), reliability (test plan passes), UX (clear description, good error messages).
- Approved skills appear in the gallery with submitter attribution + install count + ratings.
- Trusted authors (10+ skills approved, low rejection rate) can publish directly without review, with retroactive audit.

Vercel/Next.js template pattern, adapted for skills.

## Consequences

**Enabled:**
- Faster library growth than first-party-only
- Community becomes a moat (network effects)
- Submitters get distribution + credit; users get more skills
- Trust model scales via reviewer tier, not bottleneck

**Closed off:**
- Some moderation cost (estimated 2–4 hrs/week per 100 submissions once at scale)
- Some skills will be low quality (handled by ratings, not removal)
- Submitters can leave the platform (skills stay, attribution stays)

**New constraints:**
- Skill definition format must be reviewable (structured, not just free-text)
- Test harness for skill review (Phase 3 deliverable)
- Reviewer tooling (Phase 4 deliverable)
- Trust tier mechanics need to be clear to submitters

## Follow-ups

- [ ] Skill definition format (Phase 3 — needs design)
- [ ] Skill review test harness (Phase 3 — leverage AX-tree replay infra)
- [ ] Reviewer UI / tooling (Phase 4)
- [ ] Trusted author criteria + promotion mechanics (Phase 4)