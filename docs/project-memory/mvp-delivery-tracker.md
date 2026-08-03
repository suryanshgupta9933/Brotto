# Browser Automation MVP Delivery Tracker

**Last updated:** 2026-08-03

This file is the durable, high-level status index. Detailed requirements live in approved design specs and implementation plans. A delivery item moves to `complete` only after its acceptance gates pass end to end.

| Item | Status | Design | Plan | Exit gate |
| --- | --- | --- | --- | --- |
| 1. Canonical agent loop and client protocol | Design approved; awaiting user review of written spec | `docs/superpowers/specs/2026-08-03-canonical-agent-loop-design.md` | Not started | Contract, security, simulated-client, controlled-browser E2E, and Fara evaluation gates pass |
| 2. Secure thin browser extension | Pending item 1 | Not started | Not started | Canonical protocol only; deterministic observation/action/result loop; recovery and policy tests pass |
| 3. Trajectory recording and audit | Pending item 2 | Not started | Not started | Complete causal event chain, durable ingestion, privacy, retention, and tamper-evidence tests pass |
| 4. Recipe compiler and zero-token replay | Pending item 3 | Not started | Not started | Generated Playwright type-checks, passes replay validation, meets determinism and zero-token KPIs |
| 5. Open-source release hardening | Pending items 1–4 | Not started | Not started | Documentation, threat model, packaging, CI, licensing, reproducible deployment, and release evals pass |

## Current blocking gate

The written item-1 design must be reviewed and approved before an implementation plan is created. Implementation must not begin from the dirty prototype state without that reviewed plan and explicit file ownership.

## Working rules

- Work on one delivery item at a time.
- Use test-driven implementation with independently reviewable commits.
- Preserve unrelated dirty-worktree changes.
- Never commit `.env` files, secrets, dependency directories, generated bundles, screenshots, or browser data.
- Record verification evidence in the implementation handoff for each completed item.
- Public-site demonstrations supplement but do not replace controlled release gates.
