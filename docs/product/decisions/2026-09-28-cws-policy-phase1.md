# Decision: Chrome Web Store policy work — Phase 1 (before launch)

**Date:** 2026-09-28
**Question:** Q8 (open-questions.md)
**Status:** Accepted

## Context

Chrome Web Store Developer Program Policies (revised, effective Aug 1, 2026) impose stricter privacy/data-handling standards on extensions. Requirements:
- Single-purpose statement
- Privacy disclosures on data collection
- Justified permissions (`debugger`, `storage`, `tabs`)
- Manifest v3 service worker compliance
- AI extensions are explicitly *encouraged* by Google (so we're welcome, but must comply)

## Choice

**Phase 1 (before launch).**

CWS listing is the primary distribution channel per Fork A. Sideload-only distribution (Phase 2-only CWS work) caps adoption. Compliance is part of shipping, not a separate phase.

## Consequences

**Enabled:**
- Phase 2 OSS launch includes CWS listing (not just GitHub releases)
- Distribution + product launch are coupled, not separate work streams
- Phase 1 deliverable list already includes "Chrome Web Store package" per roadmap.md

**Closed off:**
- Can't skip privacy disclosures or permission justifications
- Single-purpose statement requires real clarity on what Brotto does (helps with marketing copy too)
- MV3 service worker budget compliance required (per risks.md: long-running background tasks will be killed)

**New constraints:**
- Phase 1 timeline must accommodate CWS submission + review (typically 1–3 weeks)
- Privacy disclosures must accurately reflect data handling (don't over-claim, don't under-claim)
- Permission justifications must be honest about why each is needed
- Single-purpose statement may force clarity on "Brotto is a browser automation agent, not a search helper"

## Follow-ups

- [ ] Phase 1 deliverable: privacy disclosures, single-purpose statement, permission justifications
- [ ] MV3 service worker budget plan: long-running background tasks (per risks.md)
- [ ] CWS submission timing: end of Phase 1 / start of Phase 2 OSS launch
- [ ] Honest permission justifications (debugger = needed for CDP relay; storage = needed for BYOK persistence; tabs = needed for tab management)