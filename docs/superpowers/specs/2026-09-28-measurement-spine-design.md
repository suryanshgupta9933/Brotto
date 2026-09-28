# Design: Measurement Spine — workstreams 0B (benchmark) + 0C (test harness)

**Date:** 2026-09-28
**Status:** Approved
**Parent:** `docs/superpowers/specs/2026-09-28-capability-map-design.md` (workstreams 0B, 0C)
**Implementation plan:** not yet written — follows approval of this spec

## Purpose

Give Wave 0 (perception hardening) something to develop against, and give every later wave a way to tell whether it actually helped.

This is the work that makes the map's work order *derived* rather than guessed. Without it, Waves 1 and 2 get built against imagined failure modes.

## The problem this solves, in two parts

**There is nothing to develop against.** `tests/` is Python-only and fully mocked — no JS runner, no real browser, no extension loaded. The seven verified Wave 0 gaps (no shadow DOM, no iframe traversal, no canvas fallback, no `aria-hidden` reconciliation, no stability wait, hard observation caps, unwired auth) would not be caught by the existing suite.

**There is no way to tell improvement from regression.** The reliability target in `roadmap.md` (>85% Web-Bench-style completion) is currently a hypothesis with nothing behind it.

## Key constraint: published benchmarks cannot measure the lead bet

The lead bet is "it works on the sites behind your login." Every published benchmark runs on public, unauthenticated sites. A 90% on WebVoyager is consistent with an agent that fails completely the moment a login appears — which is exactly the failure it would not reveal.

The field is also saturated and contested. Published self-reported figures sit at 85–91% (WebVoyager), and *"An Illusion of Progress?"* (arXiv 2504.01382) argues agents score far lower on harder variants. A competitive score is close to table stakes and demonstrates little on its own.

## Choice

### Two tiers, with different jobs

| Tier | Suite | Job | Explicitly not for |
|---|---|---|---|
| **1 — Comparable** | Frozen subset of Online-Mind2Web (300 tasks / 136 real sites), run as published | A number an outsider can check against Skyvern, Browser Use, Manus, Operator | The lead bet. Tuning against it |
| **2 — Lead bet** | Real chores behind real logins | The only measurement of the actual product claim | Public competitive positioning |

Online-Mind2Web is preferred over WebVoyager: more widely reported, more sites, and a subset is tractable. WebVoyager's 15 sites are too narrow to be representative.

**Tier 2 splits again**, because the two halves have different costs and different failure modes:

- **Authenticated fixtures** — local, deterministic, free, each one targeting a *specific verified gap*. This is the regression suite.
- **Real logged-in chores** — a small set on accounts we control. This is the credibility suite; it is slow, occasionally flaky, and the only thing that proves the claim against the actual web.

### The harness key move: perception tests do not need a model

Most of Wave 0 is perception work. Model-free testing of it is possible, deterministic, and effectively free.

The harness injects a **scripted planner** in place of `agent.run(turn)` — a deterministic producer of `AgentDecision` from a short script (`click element named "Next"`, `type "hello" into "Search"`). `harness.py` already takes its collaborators as injected dependencies, so this is a seam that exists, not one to invent.

Two run modes:

- `stub` — scripted planner, no model, no key, no network to a model provider. Milliseconds per task. Used for every perception and action regression.
- `live` — real model, real timing, real cost. Used for the end-to-end score only.

If a perception test can be run with a real model, it should not be.

### Primary output is failure attribution, not score

**This is the core design decision.** The score is marketing. Attribution is the engineering input, and it is what tells Waves 1 and 2 what to build next.

Every task outcome resolves to exactly one class:

| Class | Meaning | Points at |
|---|---|---|
| `PASS` | Task completed | — |
| `PERCEPTION_FAILURE` | Target not found or not seen | **0A** — shadow DOM, iframe, `aria-hidden`, canvas, truncation, no stability wait |
| `ACTION_FAILURE` | Found, but the action did not take effect | **1A/1B/1C** — missing verbs, mis-targeted, stale ref |
| `RECOVERY_FAILURE` | Blocked by popup, loop, or error; could not get past | **2A–2E** |
| `LOGIN_FAILURE` | Login or session barrier | **2E**, `3A` |
| `BUDGET_EXHAUSTED` | Hit step or token cap | `5C` |
| `HARNESS_ERROR` | Test infrastructure broke — not the agent's fault | 0C itself |

The mapping is deliberately 1:1 onto the capability map's waves. That is what makes the work order derivable: the tally of failure classes *is* the next plan's priority order.

Per-task record: outcome class, step count, tokens in/out, USD estimate, per-component wall time, final URL, whether an approval was requested.

### Anti-gaming rules

A benchmark that can be tuned into a meaningless number is worse than none. These are structural, not aspirational:

1. The Tier 1 suite is frozen, with a checksum committed to the repo. Any change requires a new suite version number, published.
2. **Tier 1 does not gate merges.** It is reported, never enforced. An enforced benchmark gets optimized for instead of through.
3. Tier 2 fixtures are ours, so they are a regression signal only. They never become a published number.
4. Raw per-task results and full methodology are published alongside any figure. The number must be checkable by someone who does not trust us.

## Fixture set

Authenticated by design — every one requires a login, and each maps to a verified gap.

| Fixture | Targets |
|---|---|
| `auth-shadow` | Component-library / shadow DOM app behind login |
| `auth-iframe` | Cross-origin iframe (two local ports) containing a form |
| `auth-aria-hidden` | Key controls hidden from the AX tree via `aria-hidden` |
| `auth-canvas` | Canvas-rendered UI exposing no AX information |
| `auth-slowjs` | Heavy-JS hydration with late-rendered content; tests the missing stability wait |
| `auth-inbox` | Dense list exceeding the 6000-char / 50-target caps |
| `auth-popup` | Cookie banner, modal, newsletter overlay — the Wave 2 recovery surface |
| `auth-tabbed` | Multi-tab and nested-frame navigation |

Fixture set is itself an open scoping decision, recorded below.

## Tooling decision: no new dependencies

The extension already bundles TypeScript to JavaScript with esbuild (`npm run build`), and has no test runner. The JS runner is therefore **Node's built-in `node:test`, running against the esbuild output**, exposed as `npm test` (`build` then `node --test`).

This adds zero dependencies. Vitest or Jest would bring a runner, a transform pipeline, and a config file to test code that mostly needs assertions over already-compiled output. Revisit only if the suite needs mocking or coverage reporting that `node:test` genuinely cannot do.

Playwright is already a Python dependency of the orchestrator, so the real-browser harness reuses it rather than adding a Node browser driver.

## Exit criteria

1. A full task runs headlessly, repeatably, from a clean checkout, with one command.
2. A scripted planner completes `auth-shadow` with no model configured and no API key present.
3. Every outcome resolves to exactly one taxonomy class; unknown classes are a harness error, not a silent pass.
4. A baseline run for all fixtures is recorded and committed.
5. Tier 1 subset runs and produces a figure with published methodology.
6. **A deliberately introduced perception bug turns the baseline red.** If it does not, the harness is not measuring what it claims to and this workstream is not done.

Criterion 6 is the real test. The others can be satisfied by a harness that looks correct and measures nothing.

## Anti-scope

- Not a user-facing feature. Nothing here ships in the extension.
- Not the roadmap's >85% target yet — that number stays a hypothesis until a Tier 1 run exists.
- No model-quality comparison. That is a different question; using a weak model to "prove" the agent is weak would be a harness bug, not a finding.
- No CAPTCHA solving. The `auth-popup` fixture detects and reports a captcha iframe; it does not defeat one.

## Open items for the implementation plan

- **Which Tier 1 subset.** Mind2Web is 300 tasks across 136 sites; the subset must be chosen for coverage of the surface types we care about, and fixed once. This is a real scoping decision, not a detail.
- **Fixture build-vs-adopt.** Hand-built fixtures are honest and precisely targeted but slow to produce. An existing adversarial suite would be faster but covers different ground and may not be authenticated. Recommendation: hand-build, because every gap we must fix is enumerated and each fixture maps to exactly one.
- **Real-account chores.** Needs a small set of accounts we control, and a judgement about rate limits and politeness toward third-party sites. Not to be decided unilaterally.
- **Stub planner seam.** Confirming the exact injection point in `harness.py` is the first implementation task.

## Plan decomposition

This is one spec but probably not one plan. The implementation plan should sequence in this order, and it is legitimate to split after the first three:

1. **Scripted-planner seam** in `harness.py` — smallest task, unblocks everything
2. **Real-browser harness** — Playwright loads the extension, one command runs a task
3. **Fixture set + attribution taxonomy** — criteria 2, 3, 4, 6
4. **Tier 1 subset** — criterion 5; depends on real outbound network and a frozen subset decision
5. **Real logged-in chores** — needs accounts we control; slowest, least deterministic, most valuable for credibility

Steps 1–3 are the minimum that makes Wave 0 safe to build. Steps 4 and 5 are what make the *public* number claimable, and neither blocks Wave 0 from starting.

## Follow-ups

- [ ] Write the implementation plan for 0B + 0C
- [ ] Record fixture set and Tier 1 subset in `open-questions.md` once chosen
- [ ] Return the failure-class tally to the capability map each run
