# Design: Perception Hardening (Workstream 0A)

**Date:** 2026-10-01
**Status:** Draft for review
**Type:** Architecture — agent perception
**Workstream:** 0A in `docs/superpowers/specs/2026-09-28-capability-map-design.md`
**Branch:** `feat/perception-hardening`

## Problem

Brotto's claim is that it does repetitive chores on the sites you are already logged into.
That claim reduces to one thing: *can it see the page?*

The measurement spine gives a direct answer, and it is bad.
`tests/fixtures/baseline.json` is the recorded outcome of `scripts/run_benchmark.py --all`
over seven deliberately adversarial fixture sites:

| Fixture | Targets gap | Outcome | Steps |
|---|---|---|---|
| `auth-iframe` | iframe | `PERCEPTION_FAILURE` | 4 |
| `auth-aria-hidden` | aria_hidden | `PERCEPTION_FAILURE` | 4 |
| `auth-canvas` | canvas | `PERCEPTION_FAILURE` | 4 |
| `auth-slowjs` | slow_js | `PERCEPTION_FAILURE` | 4 |
| `auth-inbox` | truncation | `PERCEPTION_FAILURE` | 4 |
| `auth-popup` | popup | `PASS` | 6 |
| `auth-tabbed` | tabbed | `PASS` | 6 |

**Five of seven fail.** The two that pass are the two that need no perception work —
they are Wave 1 and Wave 2 problems, not Wave 0.

This is not the model being weak. `testing/scripted_planner.py` replaces `agent.run()`
with a fixed decision sequence, so no model is involved. Every failure carries one reason:

```
scripted target did not resolve: scripted action arg 'ref' did not resolve
in the current AX tree
```

The benchmark asks exactly one question — *does this target's accessible name reach the
tree the server renders?* — and the answer is no, five times out of seven. "4 steps" is
the script's length, not a ceiling. The suite is a clean, cheap, deterministic signal,
and `testing/outcome.py` already maps the outcome back to `0A`.

## What the map gets wrong

The capability map justifies six 0A gaps. **The benchmark has five fixtures — there is no
shadow-DOM fixture** — despite shadow DOM being the gap the map lists first and states
with the most confidence:

> No shadow DOM traversal | Repo-wide grep for `shadowRoot` returns nothing | Every
> component-library site is invisible

That grep was of *our* source. It proves our code contains no `shadowRoot` identifier. It
says nothing about Chrome. `Accessibility.getFullAXTree` traverses open shadow roots
natively, so shadow content can appear in the tree whether or not our source knows the
phrase.

The failure mode is the one the capability map itself warns about, applied to a gap
instead of a claim: *optimizing reliability without a measurement optimizes against an
imagined failure.* The same is true of several CDP details this design would otherwise
have to assert from memory — which frame APIs reach OOPIF content, whether
`Accessibility.getFullAXTree` accepts a `frameId`, whether backend node ids are
comparable across `getFullAXTree` and `DOM.getDocument`. Asserting them would be a
second round of imagined failures.

**So the first task is a probe, not a feature.** It records, per gap, whether the node is
*absent from Chrome* or *present and dropped by our filter*, and the remaining tasks are
written against what it finds.

## Design

### The shape of the problem

Five failures, one cause: **the observation is a single `getFullAXTree` on the top frame,
read at an arbitrary instant, truncated to a character budget, with one CDP round trip
per node for geometry.**

Each fixture attacks a different clause of that sentence. So the fix is not five fixes. It
is making the observation *complete* and *stable*, with the existing code paths kept
where they are already correct.

The pipeline becomes:

```
1. STABILITY GATE    wait until the page is quiet, not merely ready
2. SURFACE           enumerate frames; take the pierced DOM once
3. AX MERGE          getFullAXTree per frame; union into one ref namespace
4. DOM SUPPLEMENT    elements the AX tree drops on purpose (aria-hidden, canvas)
5. GEOMETRY          every box, in two round trips instead of N
6. RENDER            relevance-ranked selection against a character budget
```

### 1. Stability gate

`waitForPageReady` polls `document.readyState` until it reports complete. `readyState`
reaches `complete` when the load event fires — which on a SPA happens *before* the app
renders anything. `auth-slowjs` is exactly this.

Replace the readyState poll with a **mutation-quiet window**: `Runtime.evaluate` installs
a `MutationObserver` and returns a promise that resolves after N ms with no mutations, up
to a hard deadline. A page that is genuinely still never resolves the observer and costs
one round trip at the deadline.

Keep the existing SPA retry, but fix its condition. `axTargets.length < 3` is the wrong
test: a page can render three useless targets and stop retrying, while a page that is
merely dense never triggers a retry it did not need. Retry on *change* instead — if the
rendered tree's fingerprint is unchanged after the wait, re-read once and stop.

### 2. Surface enumeration

`Page.getFrameTree` enumerates every frame including cross-origin ones. For a frame that
is out-of-process, CDP requires attaching to its target; the extension already has the
`chrome.debugger` `targetId` mechanism, and `debugger.ts` already re-attaches on a
vanished debugger, so the machinery exists.

Bounds are mandatory and are specified in **Scalability** below. An unbounded frame walk
is a denial-of-service vector aimed at ourselves.

### 3. AX merge

Call `getFullAXTree` once per frame and union the node sets. Refs must be unique across
frames — a bare CDP `nodeId` is only unique within one frame, so the merge assigns a
composite ref and keeps the `(frameId, nodeId)` pair for dispatch. The server's
`_depths` and `filter_ax_targets` see one flat list and are unchanged; the depth
resolution already walks `parentId`, which is per-frame and consistent.

**The probe determines whether `getFullAXTree` accepts a `frameId` directly or whether
each frame needs its own attached session.** This spec does not assert which.

### 4. DOM supplement

`aria-hidden` is not a gap in Chrome — it is the contract working as designed. An
`aria-hidden` element is `ignored: true` in the AX tree, and `extractAx` skips ignored
nodes. A screen reader user cannot reach it either, which is the point of the attribute.

But an `aria-hidden` element is still *visible* and *clickable*. For a task like "delete
the draft", a control that is visually present and marked `aria-hidden` is exactly the
control the user means. So it should be **surfaced with its hidden status marked**, not
recovered. Rendering `[hidden]` on the line tells the model this element is deliberately
out of the accessibility tree, which is information, not a bug — and lets it decide
whether to click something the site itself tried to hide.

One `Runtime.evaluate` per frame returns the `[aria-hidden]` elements with their
accessible-name candidates and rects.

### 5. Geometry in bulk

This is the efficiency work, and it is the largest single win available.

Today, `extractAx` calls `DOM.getBoxModel` **once per kept node, serially, inside the
loop**. A 608-target page — the exact count recorded on the Gmail search step — is 608
serialized CDP round trips *per step*. That is a latency floor proportional to page size,
paid on every observation, forever.

Three calls replace all of them:

1. `DOM.getDocument({depth: -1, pierce: true})` — the whole document including open
   shadow roots and iframe content documents, each node carrying a `backendNodeId`.
2. `DOM.resolveNode({backendNodeId})` on the document node — one `objectId`.
3. `Runtime.callFunctionOn({objectId, functionDeclaration, arguments: [nodeIds],
   returnByValue: true})` — one function that walks the argument list and returns a
   `Map<backendNodeId, [x, y]>`, with `getBoundingClientRect()` and a
   `getClientRects().length` zero-check for elements with no box.

Backend node ids are the join key between `getFullAXTree` and `DOM.getDocument` — they
are the same id space for the same target, which is why this works at all. **The probe
verifies it on a real page before the implementation depends on it.**

The pierced document from step 1 also does double duty: it is the DOM that
`aria-hidden` discovery walks, and its shadow-root map is the answer to the shadow-DOM
question, for free.

### 6. Relevance-ranked selection

`filter_ax_targets` currently orders by "in viewport, then off-screen" and cuts at the
budget, appending `[N more element(s) not shown — scroll, or read_page_text]`.
`auth-inbox` fails because the target is past the cut.

Truncation is a ranking problem, not a size problem. Rank by what makes an element
actionable *now*:

1. interactive roles (`button`, `link`, `textbox`, `combobox`, `checkbox`, `radio`,
   `tab`, `menuitem`, `option`, `switch`, `slider`, `spinbutton`)
2. in-viewport before off-screen (existing behaviour, kept — it is correct)
3. non-empty accessible name before empty
4. shallower depth first, so a record's own controls beat a nested menu's

Drop the lowest rank until the budget is met, and report what was dropped. The
`ax_filter` budget already scales with the model's context window and decays with step
age (`budget_for_window`), and that behaviour is untouched — this changes *which* lines
survive, not how many.

**External evidence that this is the right direction, and that less tree is
better.** On 358 OSWorld tasks, three observation modes over the same tasks
(A11y-Compressor, arXiv:2605.00551) scored: raw screenshot 7.0%, linearized AX
tree 15.6%, **compressed** AX tree 20.7%. Two results here. The no-vision
position on the moat list is measured, not assumed — the screenshot condition
was 8× worse. And *compressing* the tree improved on passing it through,
which is precisely what ranking under a budget does: less tree, better tree,
same source. `GAP_RENDER` is not a "we need a bigger window" problem.

The same work finds the web degrading as a target. WebAIM's Million (Feb 2026)
puts AX defects on 95.9% of home pages, with page complexity growing ~22.5% a
year. Ranking is not a stopgap against today's pages; it is what keeps the
observation proportionate as the floor rises under us.

## Scalability

Every one of these is an unbounded-resource risk if specified casually. Bounds are part
of the design, not an afterthought:

| Resource | Bound | Why |
|---|---|---|
| Frames traversed | 12, depth 4 | a page with thousands of frames is hostile or broken; the 13th is never the target |
| Nodes per AX tree | 2000 | a flat list larger than this is not renderable under any budget |
| `Runtime.evaluate` result | 512 KB | a page whose serialized result exceeds this is a page we do not read |
| Stability wait | 3 s quiet, 10 s hard deadline | a page that never goes quiet must not hang the step |
| Geometry map size | 2000 entries | matches the node cap |
| Screenshot bytes | not captured in this workstream | see Security |

Depth-4 frame traversal is not arbitrary: the map's `MAX_DEPTH` for AX indentation is
already 4, so a control deeper than that would be flattened out of the rendered tree
anyway. Traversing it would cost frames and buy nothing.

## Security and compliance

**What does not change.** Every observation is read from the user's own browser, in
their own session, on a page they navigated to. This workstream adds no new data
egress, no new network destination, and no new capability to reach anything the user
cannot already see. The extension's existing host permissions are unchanged.

**Frame traversal is the one genuinely new reach.** Following a cross-origin iframe
means reading content the top-level document cannot script. Three constraints:

- **No execution in a foreign realm.** The traversal reads accessibility nodes and
  geometry. It does not evaluate script in a cross-origin frame's context, and no
  fix in this workstream may. An extension that injects script into a third-party frame
  is a materially different — and much larger — privilege than one that reads.
- **Bounded by the frame cap above.** A frame bomb is a denial-of-service against the
  agent; the cap is the mitigation.
- **It is already rendered to the user.** The content is on their screen. Reading it
  programmatically exposes nothing they have not seen; the failure mode to avoid is
  *silent* reading, so an observation that includes cross-origin content records that it
  did.

**`aria-hidden` surfacing is a disclosure change and is the sharpest edge here.** The
attribute exists so assistive technology skips an element. Surfacing it to a *model* is
not a screen-reader regression — nothing changes for AT users — but it does put
deliberately-hidden controls in front of an agent that will click them. Two rules:

- The rendered line is marked `[hidden]` so the model's own instructions can weigh it.
- Surfaced-by-supplement nodes are **not** auto-approved under secure mode. A control
  that the site hid from the accessibility tree must still pass a `(domain, action)`
  approval like any other first-time action.

**No screenshots are captured in this workstream.** `Page.captureScreenshot` remains out
of scope. A screenshot is page pixels, which is a different data class from text and
AX nodes, and it would make the audit document enormous if persisted. `auth-canvas` is
handled by reporting the limitation to the model instead — see Open items.

**Audit.** The existing document already records every action with its resolved target
and scrubs typed secrets. Perception changes what the model is *told*, not what it may
do, so the approval and redaction paths are unchanged. One addition: the observation
records `frames_traversed` and `supplemented_nodes` counts, so a run that reads more
than usual is visible after the fact.

## Test strategy

> **Correction, 2026-10-01 (after Task 3).** The claim below that "the seven
> fixtures are the regression suite, and `--check` against a re-recorded
> baseline is the gate" is **true of the server path and false of the
> extension path.** `run_benchmark.py` POSTs to `/run`, which builds a
> `dev/playwright_browser.PlaywrightBrowser` and drives it through
> `CDPRelay` — a separate Python CDP client. The extension is never loaded
> and `observation/` never runs. So a `PASS` certifies the server, and
> nothing else.
>
> Concretely: **Task 3** (`ax_filter` ranked selection) is server-side and
> its `auth-inbox → PASS` is real. **Tasks 2, 4, 5 and 6** are all
> extension-side and are invisible to the suite. Task 7's "re-record
> `baseline.json` when the fixtures are green" would therefore certify four
> fixes that were never exercised — worse than having no measurement, because
> it reports success.
>
> **What this workstream does instead:** unit-test the pure logic of each
> stage (the caps, the ranking, the teardown) and verify the extension path
> by hand in a real browser. `baseline.json` re-records only movement the
> suite can actually observe. Nothing in the extension is claimed as verified
> on the strength of a fixture run.
>
> **Outcome, 2026-10-01:** the baseline was re-recorded at 4/8. `auth-inbox`
> flipped to PASS — it is the only server-side fix, so it is the only PASS this
> workstream earned. `auth-shadow` is new and passes, which is the probe's
> "shadow DOM was never a gap" verdict showing up in the score. The four
> extension-side fixtures stayed `PERCEPTION_FAILURE` and were left that way on
> purpose. **Tasks 2, 4, 5 and 6 are unit-tested logic and have not been run in a
> browser**; that hand-run is still outstanding.
>
> The probe's *verdicts* are unaffected — `GAP_FRAMES`, `GAP_TIMING`,
> `GAP_ARIA` and `GAP_UNREACHABLE` are statements about what Chrome returns
> through CDP, which is the same on both paths, and the probe drove a real
> Chrome. What was conflated is the verdict (valid) with the benchmark
> outcome used to confirm it (a different client).

## Test strategy



The seven fixtures are the regression suite, and `--check` against a re-recorded
baseline is the gate. No new test infrastructure is needed for the fixes themselves —
that was workstream 0C and it shipped.

What is new:

**The probe** (Task 1) is a new script, `scripts/probe_perception.py`, which loads each
fixture in a real Chrome and records per gap: present in the top-frame AX tree? in any
frame's? in the pierced DOM? and how long the target took to appear. Its output is a
committed artifact, `tests/fixtures/perception-probe.json`, because it is what the
remaining tasks are ordered against. It shipped, and it came back **against the map on
its headline finding**: shadow DOM is `OK`, so no shadow work is built and the map's
first 0A row is retracted. The remaining five fixtures each resolve to one stage of the
pipeline above — `GAP_FRAMES`, `GAP_ARIA`, `GAP_UNREACHABLE`, `GAP_TIMING`,
`GAP_RENDER` — and no two share a cause.

**Each fix is written failing-first against its fixture**, in the existing style, and the
baseline is re-recorded only after the fixtures it changes are green — the fixtures README
already warns that recording during a regression makes every later run stay red.

**The unit layer stays meaningful.** The rendering, ranking and bounding logic is pure and
tests without a browser: `test_ax_filter.py` for ranking under a budget, and a new
`test_observation_bounds.py` for the caps. Only the CDP plumbing needs the real browser,
and only via the probe and the fixtures.

## Non-goals

- **Workstream 1A verbs** — `fill_form`, `select_option`, `hover`, `drag`. Separate.
- **Workstream 2** recovery, and **Wave 3** auth/onboarding/CWS. Unrelated.
- **Workstream 0B** real-site scored task set. The fixtures answer "is it blind", not
  "is it good enough on Gmail"; that is the next spec, not this one.
- **A vision fallback.** See below.
- **Multi-tab.** One tab is one observation surface.

## Open items for the successor

- **Canvas.** A canvas-rendered UI has no accessibility nodes and no text, by
  construction. The probe measured it: `auth-canvas` is `GAP_UNREACHABLE`, so there is
  no a11y mirror to be had for free. The honest options are a vision fallback (abandons
  the "AX tree, no vision model" position that is on the moat list in
  `brotto-current-state.md`, and costs tokens per observation) or telling the model
  plainly that the page renders via canvas and the named control was not found. **This
  is a product decision, not a task in a list**, and it is deliberately left open here.
  The external evidence tilts it. Agents with a vision fallback do not
  dominate text-driven ones on real surfaces — on WebArena-Infinity, Gemini-3-Flash
  scores 69.3% where vision-based Kimi-K2.5 scores 45.9% and Qwen-3.5-Plus 49.1%
  — so the cost of a vision path is not only tokens, it is a measurable
  regression on exactly the pages Brotto already reads well. Report the
  limitation; do not add pixels.
- ~~**Whether `getFullAXTree` takes a `frameId`**~~ — **answered by the probe.** It does,
  and cross-origin frame content comes back in-process: the `auth-iframe` probe
  enumerated 2 frames with zero errors and found "Confirm" in a subframe's AX tree. Task
  4 is one call per frame — no target-attach dance, and no script evaluated in a foreign
  realm, so the sharpest constraint in the Security section costs nothing.
- ~~**Whether shadow DOM is a 0A gap**~~ — **answered, and it is not.** `auth-shadow`
  comes back from a plain top-frame `getFullAXTree`. The capability map's headline 0A
  finding is retracted in the same commit; see the table in
  `2026-09-28-capability-map-design.md`.
- **Whether the pierced DOM's `backendNodeId` space matches `getFullAXTree`'s** — still
  open; the probe does not test it. If it does not, the bulk-geometry plan needs a
  different join key and Task 5 grows.
