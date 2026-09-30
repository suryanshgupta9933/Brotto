# Design: Brotto Capability Map — Divide & Conquer

**Date:** 2026-09-28
**Status:** Approved
**Type:** Architecture / product-planning design
**Supersedes:** the phase sequencing in `docs/product/roadmap.md`

## Purpose

This is not a feature spec. It is the **dependency map** that future feature specs derive from.

The product is decomposed into independent capability clusters. Each cluster is broken down into its own spec → plan → implementation cycle, in an order that is **derived from this map at the time of planning**, not fixed in advance. The map defines the axes and the edges; the work order is decided when we plan.

## Why a map instead of a sequence

Phase-based planning (the previous `roadmap.md` model) serializes work that does not actually depend on anything else, and — worse — orders reliability work *after* launch, which means optimizing against imagined failure modes.

The map exists to answer two questions cheaply at any point in time:

1. **What is the critical path right now?**
2. **What can run in parallel with it, right now?**

## Organizing principle

The product is:

```
product = perception × action × recovery × identity × trust
```

A capability that multiplies out to zero on any axis is not shippable regardless of quality elsewhere. Decomposing along these axes makes the dependencies fall out rather than being asserted.

## The code-grounded justification for Wave 0

Wave 0 is foundational because of verified gaps, not intuition. As of this date:

| Finding | Evidence | Consequence |
|---|---|---|
| ~~No shadow DOM traversal~~ **Retracted — never existed** | **Measured 2026-10-01.** `tests/fixtures/perception-probe.json`, fixture `auth-shadow`: the target inside an *open* shadow root comes back from a plain top-frame `Accessibility.getFullAXTree` (`in_ax_tree: true`, verdict `OK`). Chrome traverses open shadow roots natively. The original evidence was a repo-wide grep for `shadowRoot` returning nothing, which proved only that *our source* contains no such identifier — a fact about us, not about Chrome. | None. The first-listed 0A finding was a category error, and the most confident one in the table. |
| No iframe traversal | Only hit for `iframe` is `agent/prompt.py:68`, a prompt line conceding cross-origin iframes are unseen | Payment fields, reCAPTCHA, third-party embeds, embedded players are invisible |
| No canvas / image fallback | No `canvas` handling anywhere; no `Page.captureScreenshot` despite README claiming it | Canvas-rendered and image-only surfaces are unreachable |
| No `aria-hidden` reconciliation | No handling; AX tree is consumed as-is | Elements hidden from AX but present in DOM are neither seen nor targeted |
| No dynamic-stability wait | No `MutationObserver` / `networkIdle` / `DOMContentLoaded` handling | AX tree read at an arbitrary instant; pre-hydration and mid-render reads are likely |
| Observation hard-capped | `ax_filter.py:17` `MAX_CHARS = 6000`; truncated with "scroll to reveal more". `dev/playwright_browser.py:100` `max_targets=50`. `read_page_text` caps at 2000 chars | On inboxes, dashboards and tables — the actual surfaces of "repetitive chores" — the agent is structurally blind past the first screen |
| No JS tests, no real-browser tests | `tests/` is Python-only and fully mocked | None of the above would be caught by the existing suite |

The user research states the category-level version of this: *"any task with login + 3+ steps breaks on every screenshot-driven approach."* That is a perception-and-grounding failure, and it is the thing Brotto's architecture is supposed to be immune to. It currently is not.

### What the measurement changed

`scripts/probe_perception.py` re-derived every remaining row in this table
against a real Chrome AX tree (`tests/fixtures/perception-probe.json`):

| Fixture | Verdict | Fix it implies |
|---|---|---|
| `auth-iframe` | `GAP_FRAMES` | traverse frames — the one genuine reach gap |
| `auth-aria-hidden` | `GAP_ARIA` | DOM supplement for what the AX tree drops on purpose |
| `auth-canvas` | `GAP_UNREACHABLE` | none. Pixels, not nodes — a product decision, not a task |
| `auth-slowjs` | `GAP_TIMING` | mutation-quiet wait; the target measures **5s** to appear |
| `auth-inbox` | `GAP_RENDER` | relevance-ranked selection; the target is present and past the budget |
| `auth-popup`, `auth-tabbed` | `OK` | none — Wave 1/2 problems, as the map already said |
| `auth-shadow` | `OK` | none — the gap was ours to believe in, not real |

It also settled a CDP detail the 0A design had left open: **`Accessibility.getFullAXTree`
accepts a `frameId` and reaches cross-origin frame content in-process** (the
`auth-iframe` probe enumerated 2 frames with zero errors). No target-attach
dance, and no script executed in a foreign realm.

Every other row in the table still stands, and each now names the stage that
fails rather than a gap someone inferred from a grep.


## The map

| Wave | Question | Workstreams (mutually exclusive → parallelizable) |
|---|---|---|
| **0 — Foundation** | Can it *see*, and can we *tell*? | 0A perception hardening · 0B benchmark · 0C test harness + adversarial fixtures |
| **1 — Action** | Can it *act*? | 1A verbs · 1B did-it-land verification · 1C stale-ref re-resolution |
| **2 — Recovery** | Can it *recover*? | 2A recovery slot + built-ins · 2B bounded retry · 2C model fallback · 2D stagnation recovery · 2E mid-task session expiry |
| **3 — Identity & install** | Can a stranger get in? | 3A auth · 3B onboarding · 3C CWS packaging + relay bug · 3D cost visibility |
| **4 — Observability** | Can they trust and inspect it? | 4A history API · 4B replay UI · 4C structured output contract · 4D audit export |
| **5 — Scale** | Can it do more than one thing? | 5A multi-tab · 5B long-running/background · 5C concurrency + quota |
| **6 — Compounding** | Does it get better? | 6A routines from traces · 6B skill library · 6C project memory |
| **7 — Distribution & revenue** | Does it make money? | 7A MCP server · 7B Stripe · 7C marketplace |

### Workstream contents

**0A — Perception hardening.** Iframe traversal (same-origin plus cross-origin via the CDP frame tree — `getFullAXTree` takes a `frameId` and reads cross-origin frames in-process, measured); `aria-hidden` reconciliation between AX tree and DOM; virtualized and scroll-loaded content; dynamic stability waits (mutation-quiet period and/or network idle); replace hard truncation with relevance-ranked selection so dense pages are representable. **Shadow DOM is not in this list** — it was retracted above. Canvas/image fallback via `Page.captureScreenshot` also stays out: `auth-canvas` measures `GAP_UNREACHABLE`, which is a product decision about whether Brotto takes a vision dependency, not a perception task.

**0B — Benchmark.** A scored set of real chore tasks on real logged-in sites, runnable repeatedly, tracking completion rate, abort rate, step count, and cost per task. Includes a competitor-comparable subset so "beats Operator/Skyvern" is falsifiable rather than asserted.

**0C — Test harness.** JS test runner for the extension. Real-browser integration tests that load the extension via Playwright and drive fixture sites. Fixture sites that specifically break agents: shadow DOM, `aria-hidden`, cross-origin iframe, canvas-rendered, heavy-JS hydration.

**0C splits in two, and the split matters for scheduling.** The *fixture sites* are inputs to 0A — they are what perception work is developed against, so they get built first and in parallel. The *assertion and regression runner* consumes 0B's scoring schema and lands with it. Treating 0C as a single up-front workstream would make it look like a blocker on 0A when it is not.

**1A — Verbs.** `fill_form` (one native CDP call, not N keystrokes), `select_option`, `hover`, `drag`, `upload_file`, `key_combo`, scroll-to-element. Today: 13 actions, `type_text` is char-by-char via `Input.dispatchKeyEvent`, no `hover`/`drag`/`select_option`/`fill_form`.

**1B — Did it land.** After click/type, confirm the intended element actually changed state — not merely that the URL moved. Catches mis-targeted clicks on dense pages.

**1C — Stale-ref re-resolution.** Refs are invalidated constantly by dynamic pages. Re-resolve by role+accessible-name immediately before acting.

**2A — Recovery.** A `recovery_skills` slot injected when recovery is needed, with built-ins for cookie banners, modals, age gates, newsletter overlays, and captcha-iframe detection.

**2B — Bounded retry.** Transient failure and element-not-found retry paths, re-observing between attempts, with a hard bound.

**2C — Model fallback.** Configurable chain (Anthropic → OpenAI → MiniMax) at task level.

**2D — Stagnation recovery.** Extends the existing 3-step window with a "you're stuck, try this" recovery prompt.

**2E — Mid-task session expiry.** The existing `check_login_page` guardrail covers login *pages*; handle session expiry mid-task.

**3A — Auth.** Eliminate IP-keyed identity. Self-host: shared secret minted on first boot. Hosted: email magic link. `session/auth.py` already has `validate_token` but it is not wired to `/ws/ext`. Also fixes `main.py:227` handing the extension a hardcoded `ws://localhost:8000`.

**3B — Onboarding.** First-run wizard: server URL → test connection → provider/model/key (Token Plan auto-detect) → policy mode picker → one-click sample task.

**3C — CWS packaging.** Icons (16/48/128), privacy disclosures, single-purpose statement, MV3 service worker config, Aug 2026 CWS policy compliance.

**3D — Cost visibility.** Per-step and per-task token count and USD-equivalent; daily total surfaced in the side panel.

**4A/4B — History and replay.** `/v1/tasks` list endpoint plus side-panel replay with per-step reasoning, AX tree diff, and action replay. Replaces the current JSONL-only `logs/runs/`.

**4C — Structured output.** JSON-schema-validated `extracted_data` per task. Primary way users pipe results into other tools.

**4D — Audit export.** Per-step policy and action log, exportable.

**5A — Multi-tab parallelism.** `activeTabId` is currently single and a second task is rejected outright.

**5B — Long-running.** Chrome's service worker idle budget is a real constraint; needs an explicit plan for tasks outliving the worker.

**5C — Concurrency and quota.** Required for the hosted free tier; must land before that tier carries real traffic.

**6A — Routines.** Learn a chore once from a reviewed trace, then re-run and refine it.

**6B — Skill library.** Versioned, shareable, installable.

**6C — Project memory.** Project-scoped, not just scratchpad-per-task.

**7A/7B/7C — Distribution and revenue.** MCP browser server; Stripe attached to the existing `user_id`; skill marketplace.

## Dependency edges

```
0A perception ──▶ 1A verbs ──▶ 2A recovery ──▶ (reliability claim shippable)
     │                │             │
     └─▶ 1B, 1C ──────┴─────────────┘
0B benchmark ───────────────────────────────▶ (every claim falsifiable)
0C fixtures ──▶ feeds 0A directly (dev targets, not a blocker)
0C runner ────▶ ships with 0B (consumes the scoring schema)

3A, 3B, 3C, 3D ── NO EDGES to waves 0-2. Fully parallel; start immediately.

4A, 4B ◀── 0B (scoring schema), 0A (AX diffs)
4C, 4D ◀── 4A
5x    ◀── 1, 2
6x    ◀── 4
7x    ◀── 6
```

**The parallelism win:** Wave 3 shares zero dependencies with Waves 0–2. Authentication, onboarding, Chrome Web Store packaging, and cost visibility can proceed concurrently with the entire reliability rebuild. A substantial fraction of what the phase model serialized is not actually serialized.

**Critical path:** `0A → 1A → 2A`, entirely inside the agent. Only the reliability claim is gated on it; nothing else should queue behind it.

## What is deliberately not in Wave 0

**Routines and learning (6A).** Wave 6. It depends on replay existing, because you learn from traces you can inspect. Building it early produces memory that captures the wrong lessons from traces you cannot review. This is the most tempting item to pull forward and it is the most damaging one to pull forward.

## Deriving the next plan

The map is static; the work order is not. At planning time:

1. Recompute the critical path against current code state.
2. Identify every workstream with no unmet dependencies on the path — these are the parallel candidates.
3. Pick the set that fits available capacity, preferring critical-path work plus the highest-leverage parallel item.
4. Write a spec per workstream, then a plan per spec.
5. Update this map when a workstream ships, is rescoped, or reveals a hidden dependency. **The ratchet is one-way** — hidden complexity discovered mid-work upgrades a workstream rather than being absorbed silently.

## Exit criteria per wave

| Wave | Exit |
|---|---|
| 0 | Benchmark runs green on the adversarial fixture set; shadow DOM / iframe / `aria-hidden` / canvas cases covered; dynamic-page reads stable under load |
| 1 | Native `fill_form` / `select_option` / `hover` / `drag` work on fixture sites; did-it-land detects mis-targeted clicks |
| 2 | Agent recovers from cookie banner, modal, age gate, and a retried missing element without human intervention |
| 3 | A stranger installs from CWS and completes a first task unaided; no IP-keyed state remains anywhere |
| 4 | Any past run can be opened and stepped through |
| 5 | Two tasks run concurrently in two tabs; a task outlives the service worker |
| 6 | A chore taught from a trace re-runs without re-teaching |
| 7 | First dollar collected |

## Open items for this design's successors

- 0B's task set needs a decision on which real chore sites to include; that is a scoping call for its own spec.
- 0C's fixture sites are a build-vs-adopt question (hand-built vs an existing adversarial test suite).
- Whether 3A hosted auth ships before or after the first public launch is a sequencing call, not settled here.
