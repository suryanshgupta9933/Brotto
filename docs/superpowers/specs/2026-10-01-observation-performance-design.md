# Observation performance — same observations, less waiting

**Date:** 2026-10-01
**Status:** approved, implementing
**Predecessor:** `2026-10-01-perception-hardening-design.md` (0A)

## Why

0A made the model stop being blind. The price was paid in latency, and the
perception pipeline was not measured when it got more expensive. A 6-step Gmail
run measured 178.10s:

| phase | seconds | share |
|---|---|---|
| observe | 70.53 | 39.6% |
| model_plan | 82.97 | 46.6% |
| execute | 24.59 | 13.8% |

`tokens_in:out` = 39:1, ~27K input tokens per turn. `MiniMax-M3` has thinking
disabled, so `model_plan` is prefill on a 27K prompt and the 4.5s→39.3s spread
tracks prompt size. **That half is not addressed here** — it is the intended
cost of ranked AX selection, and shrinking the tree is the one move that would
cost accuracy.

The other half is the observation round trip: 95.12s, 53.4% of wall. The user
also reports **the page itself feels sluggish while Brotto works**, which makes
renderer load a product defect rather than a latency statistic.

## The bar

Observations must be bit-identical: same AX trees, same targets, same refs,
same coordinates, same caps, same accuracy. **Timing may change.** This is the
distinction the whole spec turns on, and it was set deliberately — it admits
the stability gate and the retry loop to optimisation while forbidding anything
that alters what the model is shown.

## What we already know, and what we do not

Read from the source, and true regardless of what any measurement says:

- `captureObservation` (`observation/index.ts:170`) may run the **entire frame
  scan up to three times**: once, then up to two retries separated by 800ms.
  The retry loop's first iteration is unconditional —
  `for (let i = 0, fp = fingerprint(axTargets); i < 2; i++)` sleeps and
  re-scans before any comparison can break. A settled page therefore pays
  **two** complete scans; a page that changed pays three.
- Each `extractAx` is 1 `Page.getFrameTree`, up to 12 sequential
  `Accessibility.getFullAXTree`, one `DOM.getDocument({depth:-1, pierce:true})`,
  one `DOM.resolveNode`, one `Runtime.callFunctionOn` walking up to 2000
  element paths, up to 200 sequential `DOM.getNodeForLocation` in the
  aria-hidden supplement, and a sequential `DOM.getBoxModel` fallback.
- `MAX_GEOMETRY_ENTRIES = 2000` bounds the **bulk batch**, not the fallback
  loop. On a 6-frame page the id list can reach 12,000, and the overflow is
  paid one serial round trip at a time.
- `waitForStable` guarantees a floor of `QUIET_MS = 3000` on **every**
  observation, up to `DEADLINE_MS = 10000`.
- `chrome.debugger.sendCommand` is a native per-call API with a callback and
  carries no lock, so concurrent commands are supported by construction.

What we do **not** know, and must not pretend to:

- Whether the serial loops or the double scan dominate. "10,000 serial calls" is
  arithmetic about a worst case, not a measurement.
- `boxMap` already returns `requested / resolved / fallback / truncated /
  source` and `waitForStable` already returns `waited / timedOut / elapsedMs /
  mutations`. **`captureObservation` discards every one of them.** The
  instrumentation exists and is thrown away.

## Scope

In: the three serial loops, the unconditional retry, and shipping the counters.

**Out of scope, deliberately: reusing the post-action observation.**
`_send_action` blocks ~12s for an observation, caches it, and the next step's
`get_targets` finds the queue empty and requests another anyway — so that
observation is discarded and refetched, and roughly a third of all observations
are pure waste. Eliminating it would make the next step plan on a snapshot
taken at click time rather than plan time. That is a change to what the model
sees, which the bar forbids. Recorded here so a later session does not
re-derive it as if it were free.

Out of scope: prompt size. See "Why" above.

## Task 1 — Report what is already computed

`GeometryResult` and `Stability` ride the observation frame alongside `frames`
and are logged server-side, with:

- the scan count, so the double-scan is visible rather than inferred;
- `fallback` and `requested`, the pair that says whether the geometry overflow
  is real;
- `elapsedMs` / `mutations` / `timedOut` from the stability gate;
- the observation's serialized byte size and target count, which is the
  memory answer — `_cached_obs` retains the whole observation.

No new computation. This is a reporting change over values that already exist.

Its purpose is to make Tasks 2 and 3 falsifiable. Task 3 in particular should not
be built on an estimate of what the double scan costs.

## Task 2 — Bounded-concurrency pools

One helper, `pooled(items, concurrency, fn)`, applied to three loops:

| loop | now | after |
|---|---|---|
| `getFullAXTree` per frame | 12 sequential | 6 |
| `DOM.getNodeForLocation` (supplement) | ≤200 sequential | 6 |
| `DOM.getBoxModel` (geometry fallback) | N sequential | 6 |

Every call is still issued with identical arguments and results are consumed in
the original order, so output is bit-identical. `MAX_GEOMETRY_ENTRIES` stays at
2000: it bounds the in-page `callFunctionOn` walk, and raising it would make the
renderer slower — the symptom being removed.

The sequential frame reads were a deliberate choice
(`observation/index.ts:155`): *"a page that legitimately has a dozen frames
should not have twelve `getFullAXTree` calls in flight against one debugger
session."* A pool of 6 answers that concern rather than overturning it.

**Known limit.** The geometry fallback is dominated by *subframe* nodes, which
the page-side path walk structurally cannot reach — shadow roots and iframe
content documents are not under `children`. Pooling makes them cheap, not free.
If Task 1 shows `fallback` in the thousands, a per-frame bulk walk becomes its
own task with its own design, because `geometry.ts` already warns that walking
those subtrees wrong resolves to a *different element*, which is worse than a
round trip.

**Re-attach dedupe.** `sendCommand` retries a failed attach once. With many
calls in flight, a detach would have every one of them retry the attach. A
single in-flight attach promise is required, not optional.

## Task 3 — Do not re-scan a page that already went still

Gate the retry on the stability gate:

- `stability.timedOut === false` — the page provably went still for the full
  quiet window. One scan, done.
- `stability.timedOut === true` — it never settled. Retry as today, up to two
  more times.

Gating on `mutations === 0` was considered and rejected: the counter only
covers the quiet window, so a page that mutates *after* the window closes is
invisible to it, and skipping the retry there loses controls.

`auth-slowjs` is the regression gate and lands on the correct side: its control
appears at 5000ms, so mutations continue past the 3s window, the page never goes
quiet, the 10s deadline is hit, `timedOut` is true, and the retry fires exactly
as before. A settled page halves its scan count; an unsettled one is unchanged.

## Testing

- The fixture suite is the primary gate — it re-records the AX trees, so any
  changed tree fails it.
- One new Node test asserting the pool preserves result order and that a
  throwing item yields the same partial result the sequential loop produced.
- `tsc --noEmit` and the seven Node suites unchanged and green.
- **Not a browser test.** The extension path has never been measured in a
  browser; this ends with a manual run by the user on the same Gmail prompt,
  comparing step count and the new per-observation numbers.

## Risks

- Pooling changes the *shape* of CDP load, not its content. If the renderer is
  already saturated, six concurrent `getFullAXTree` could make a sluggish page
  feel worse before it feels better. Task 1's numbers decide whether the
  constant starts at 6 or 2.
- Task 3 is the only task that touches observation timing, which is why it is
  last and separately gated.
