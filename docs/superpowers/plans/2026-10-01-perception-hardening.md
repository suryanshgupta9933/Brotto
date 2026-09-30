# Perception Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent see the pages it is sent to. Five of seven adversarial fixtures currently fail with `PERCEPTION_FAILURE`, and the sixth question (shadow DOM) is assumed rather than measured.

**Architecture:** The observation becomes a six-stage pipeline — stability gate, surface enumeration, AX merge, DOM supplement, bulk geometry, ranked render — behind one `extractObservation()` in a new `src/observation/` module, with `background.ts` reduced to a caller. A probe script runs first and decides which gaps are real, because the map's headline finding (shadow DOM) comes from a grep of our own source rather than from Chrome.

**Tech Stack:** TypeScript (MV3 extension, `chrome.debugger` CDP), Python 3.11 (server), Playwright (real-browser harness), pytest (repo-root `.venv`), Node assert (extension unit tests).

**Spec:** `docs/superpowers/specs/2026-10-01-perception-hardening-design.md` — the plan argues from the spec, so the spec travels with it; executors read both.

## Global Constraints

- **The probe is Task 1 and it gates the rest.** No gap gets a fix until the probe has recorded whether the node is *absent from Chrome* or *present and dropped by our filter*. Tasks 4–6 exist in this plan because their fixtures fail, not because the map asserts they are broken.
- **No script is evaluated inside a cross-origin frame's execution context.** Frame traversal reads accessibility nodes and geometry only. A fix that needs to run script in a foreign realm is out of scope, not a harder version of this task.
- **Every unbounded resource gets a cap, in the code, before the feature lands.** Frames 12 / depth 4, nodes 2000, `Runtime.evaluate` result 512 KB, geometry entries 2000, stability 3 s quiet / 10 s deadline. A cap that is written down but not enforced is not a cap.
- **`background.ts` must not gain observation logic.** Stage 1 splits it out; Tasks 4–6 add files to `observation/`, not lines to `background.ts`. If a task needs something in `background.ts`, it needs a reason in its commit message.
- **No screenshots in this workstream.** `Page.captureScreenshot` is out of scope; see the spec's Security section. If a task reaches for it, stop.
- **`aria-hidden` targets are not auto-approved.** A control the site hid from the accessibility tree still passes a first-time `(domain, action)` approval like any other action.
- **Re-record `baseline.json` only when every fixture affected by the change is green.** The fixtures README is explicit that recording during a regression makes every later run stay red.

## Review Focus

The spec implies five conditions no single task's tests exercise. Each gets a test in the task that owns its code.

1. **A page with 3000 frames.** The traversal must stop at 12 and say so, not walk the tree. (Task 4)
2. **A frame bomb where every frame is cross-origin.** Each one costs a target attach; the cap has to bound cost, not just count. (Task 4)
3. **An `aria-hidden` control that is also destructive** — a hidden "Delete account" button. Surfacing it must not make it pre-approved under secure mode. (Task 6)
4. **A page that never goes mutation-quiet** (a live-updating dashboard, a clock ticking). The stability gate must hit its 10 s deadline and proceed, not hang the step forever. (Task 2)
5. **A 6000-char budget where the one interactive control is ranked last.** Ranking must be by actionability, so a nameless `heading` loses to a named `button` regardless of document order. (Task 3)

---

## File structure

Extracted or created by this plan; everything else is untouched.

```
clients/brotto-extension/src/
  observation/
    index.ts          — extractObservation(): the 6-stage pipeline
    stability.ts      — Task 2 — mutation-quiet gate
    surfaces.ts       — Task 4 — frames + pierced DOM, bounded
    geometry.ts       — Task 5 — 3-call bulk box map
    supplement.ts     — Task 6 — aria-hidden discovery
  background.ts       — Task 0 reduces it to a caller
services/brotto-orchestrator/
  src/brotto_orchestrator/agent/ax_filter.py   — Task 3 — ranked selection
  scripts/probe_perception.py                   — Task 1 — new
  tests/agent/test_ax_filter.py                 — Task 3 — extend
  tests/agent/test_observation_bounds.py        — Task 4 — new
  tests/fixtures/perception-probe.json          — Task 1 — new, committed artifact
  tests/fixtures/baseline.json                  — re-recorded as fixtures go green
scripts/
  test-observation-stability.test.js            — Task 2 — new
  test-observation-surfaces.test.js             — Task 4 — new
  test-observation-geometry.test.js             — Task 5 — new
  test-observation-supplement.test.js           — Task 6 — new
```

`src/observation/` rather than one `observation.ts` because Tasks 2, 4, 5 and 6 all touch the pipeline and would otherwise serialize on one file. Free functions, no interfaces, no factory — the split is for ownership and for testing each stage without a browser, not for extensibility.

---

### Task 1: The probe

Decides which gaps are real. Everything downstream is ordered against its output.

**Files:**
- Create: `services/brotto-orchestrator/scripts/probe_perception.py`
- Create: `services/brotto-orchestrator/tests/fixtures/perception-probe.json` (generated, committed)
- Create: `services/brotto-orchestrator/tests/test_perception_probe.py`

**Interfaces:**
- Consumes: `testing.browser.brotto_browser(extension_dir=..., headless=False)`, `testing.server.serve_fixtures(port)`, `testing.server.serve_iframe_origin(port)`, `testing.fixtures.FIXTURES`
- Produces: `probe(fixture: FixtureDef) -> dict` and a module-level `PROBE_FIELDS: list[str]`, consumed by the test and by every later task's justification

- [ ] **Step 1: Write the failing test**

The probe is only worth anything if it distinguishes the two states. Test that distinction directly against a real browser — a fixture whose control is in the DOM but not in the AX tree, and one whose control is in both.

```python
# tests/test_perception_probe.py
import pytest

from scripts.probe_perception import PROBE_FIELDS, probe


@pytest.mark.asyncio
async def test_a_dom_only_control_is_reported_as_a_gap(brotto_ctx):
    """aria-hidden is in the DOM and absent from the AX tree. The probe must
    say so, and not blame Chrome."""
    r = await probe("auth-aria-hidden")
    assert r["in_pierced_dom"] is True
    assert r["in_ax_tree"] is False
    assert r["verdict"] == "GAP_REAL"


@pytest.mark.asyncio
async def test_a_control_we_already_see_is_not_reported_as_a_gap(brotto_ctx):
    r = await probe("auth-popup")
    assert r["in_ax_tree"] is True
    assert r["verdict"] == "OK"
```

`brotto_ctx` is a `conftest.py` fixture that yields a `brotto_browser` context with both fixture servers up; add it in this task.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd services/brotto-orchestrator && ../../.venv/bin/python -m pytest tests/test_perception_probe.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.probe_perception'`

- [ ] **Step 3: Write the probe**

`scripts/probe_perception.py` loads each fixture, and for the fixture's `target_name` records whether the node is reachable by each of three routes:

| Field | Route | CDP |
|---|---|---|
| `in_ax_tree` | top-frame accessibility | `Accessibility.getFullAXTree` |
| `in_ax_tree_pierced` | shadow contents | `Accessibility.getFullAXTree` with a pierced `DOM.getDocument` cross-checked |
| `in_pierced_dom` | the DOM itself | `DOM.getDocument({depth:-1, pierce:true})` |
| `in_rendered_output` | what the model is sent | the server's `filter_ax_targets` string |

Verdict is the whole point of the artifact, so it is derived, not hand-written:

```python
def verdict(row: dict) -> str:
    if row["in_rendered_output"]:
        return "OK"
    if row["in_ax_tree"] or row["in_pierced_dom"]:
        return "GAP_OURS"      # the data exists; we drop or never ask for it
    return "GAP_REAL"          # Chrome is not giving it to us at all
```

`GAP_OURS` is the interesting one — it means the fix is extraction or ranking, not traversal.

The script writes `perception-probe.json` with a `rows` list, one per fixture, and is run as:

```
python scripts/probe_perception.py --out tests/fixtures/perception-probe.json
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd services/brotto-orchestrator && ../../.venv/bin/python -m pytest tests/test_perception_probe.py -q`
Expected: PASS

- [ ] **Step 5: Run the probe and commit the artifact**

Run: `cd services/brotto-orchestrator && ../../.venv/bin/python scripts/probe_perception.py --out tests/fixtures/perception-probe.json`
Then read the output. **If shadow DOM comes back `in_ax_tree_pierced: true`, correct the capability map's shadow-DOM row and delete the shadow claim from `brotto-current-state.md` in the same commit** — that is the single most valuable thing this task can produce.

- [ ] **Step 6: Commit**

```bash
git add services/brotto-orchestrator/scripts/probe_perception.py \
        services/brotto-orchestrator/tests/test_perception_probe.py \
        services/brotto-orchestrator/tests/fixtures/perception-probe.json
git commit -m "probe: which perception gaps are real, and which are ours"
```

---

### Task 0: Extract the observation out of `background.ts`

No behaviour change. Everything after this is a new file.

**Files:**
- Create: `clients/brotto-extension/src/observation/index.ts`
- Modify: `clients/brotto-extension/src/background.ts` (delete the moved functions, import instead)
- Modify: `scripts/test-key-dispatch.test.js` (it reads `background.ts` by brace matching — repoint it at the new location if the branch it extracts moved)

**Interfaces:**
- Consumes: `dbg.sendCommand(tabId, cmd)`, `sleep(ms)` from `background.ts`
- Produces: `extractAx(tabId: number): Promise<object[]>` exported from `observation/index.ts`, same signature as today

- [ ] **Step 1: Confirm the current tests pass before touching anything**

Run: `node scripts/test-key-dispatch.test.js && node scripts/test-replay.test.js`
Expected: both `all passed`

- [ ] **Step 2: Move `extractAx` and `waitForPageReady` verbatim**

Create `observation/index.ts` with the two functions moved **byte-identical**, importing `sendCommand` through a passed-in `dbg` rather than a module-level binding, so the module is testable without the service worker. Re-export them from `background.ts` so no caller changes.

- [ ] **Step 3: Prove nothing changed**

Run: `cd clients/brotto-extension && npx tsc --noEmit && npm run build` then `node scripts/test-key-dispatch.test.js`
Expected: clean, `all passed`

- [ ] **Step 4: Commit**

```bash
git add clients/brotto-extension/src/observation/index.ts \
        clients/brotto-extension/src/background.ts scripts/
git commit -m "refactor: the observation is its own module

background.ts is over a thousand lines and every remaining task in this
workstream adds to the observation. One file means they serialize on it."
```

---

### Task 2: The stability gate

**Fixes `auth-slowjs`.** `waitForPageReady` waits for `readyState === "complete"`, which on a SPA fires before the app renders anything.

**Files:**
- Create: `clients/brotto-extension/src/observation/stability.ts`
- Create: `scripts/test-observation-stability.test.js`

**Interfaces:**
- Consumes: `sendCommand(tabId, cmd)`
- Produces: `waitForStable(tabId, opts?: {quietMs?: number, deadlineMs?: number}): Promise<{waited: boolean, timedOut: boolean}>`

- [ ] **Step 1: Write the failing test**

`scripts/test-observation-stability.test.js` extracts `waitForStable`'s body from source by brace matching — the pattern `test-key-dispatch.test.js` already uses — and evals it against a fake `dbg` whose `Runtime.evaluate` resolves or rejects on demand.

```js
// 1. a page that goes quiet resolves well before the deadline
// 2. a page that never goes quiet still returns, at the deadline
// 3. a page that goes quiet after 900ms resolves as soon as it does
// 4. the installed observer is torn down — no leak into the next step
```

Case 2 is Review Focus #4 and is the one that matters: a live dashboard never mutates out, so the gate must be a bounded wait, not a barrier.

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-observation-stability.test.js`
Expected: FAIL — the extraction finds no `waitForStable`

- [ ] **Step 3: Implement**

One `Runtime.evaluate` with `awaitPromise: true` that installs a `MutationObserver` and resolves when `quietMs` passes with no mutation, rejecting at the deadline. Defaults `quietMs = 3000`, `deadlineMs = 10000`.

Also **fix the SPA retry condition** in `captureObservation`. It currently retries on `axTargets.length < 3`, which both wastes retries on a merely-dense page and gives up on a page that rendered three useless targets. Retry when the tree's fingerprint is unchanged across the wait — re-read once, then stop.

- [ ] **Step 4: Verify against the fixture**

```bash
cd services/brotto-orchestrator
python start_server.py &            # must be restarted to pick up src/ edits
../../.venv/bin/python scripts/run_benchmark.py --fixture auth-slowjs
```
Expected: `PASS`

- [ ] **Step 5: Re-record nothing yet**

Only one fixture is green. `baseline.json` is re-recorded in Task 7.

- [ ] **Step 6: Commit**

```bash
git add clients/brotto-extension/src/observation/stability.ts \
        clients/brotto-extension/src/observation/index.ts \
        scripts/test-observation-stability.test.js
git commit -m "observation: wait for quiet, not for the load event"
```

---

### Task 3: Ranked selection

**Fixes `auth-inbox`.** Server-side, no extension work, runs in parallel with Task 0.

**Files:**
- Modify: `services/brotto-orchestrator/src/brotto_orchestrator/agent/ax_filter.py`
- Modify: `services/brotto-orchestrator/tests/agent/test_ax_filter.py`

**Interfaces:**
- Consumes: `filter_ax_targets(targets, viewport_coords, max_chars) -> str` — signature unchanged
- Produces: the same string, with a different selection when over budget

- [ ] **Step 1: Write the failing test**

```python
def test_an_interactive_control_outranks_a_nameless_heading():
    """Review Focus #5. The inbox fixture's target is past the 6000-char cut,
    and it is the only button on the page — document order puts it last."""
    targets = _inbox(heading_count=200, control_at_end=True)
    tree = filter_ax_targets(targets, max_chars=1200)
    assert "Message 400" in tree
    assert "not shown" in tree          # the headings lost, and it says so


def test_the_budget_still_scales_with_the_window():
    """Ranking changes which lines survive, never how many."""
    assert len(filter_ax_targets(_inbox(), max_chars=2000)) > \
           len(filter_ax_targets(_inbox(), max_chars=1000))
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services/brotto-orchestrator && ../../.venv/bin/python -m pytest tests/agent/test_ax_filter.py -q`
Expected: FAIL — the control is dropped

- [ ] **Step 3: Implement**

Sort by `(not interactive, not in_viewport, not named, depth)` and cut from the end. **Keep the existing in-viewport-before-off-screen rule and the existing `[N more element(s) not shown]` report** — the report is what makes a miss visible instead of silent, and a ranked cut that dropped lines silently would be a regression.

Do not touch `budget_for_window`. The budget's scaling and step-age decay are already correct and orthogonal to ranking.

- [ ] **Step 4: Verify against the fixture**

```bash
cd services/brotto-orchestrator
../../.venv/bin/python scripts/run_benchmark.py --fixture auth-inbox
```
Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add services/brotto-orchestrator/src/brotto_orchestrator/agent/ax_filter.py \
        services/brotto-orchestrator/tests/agent/test_ax_filter.py
git commit -m "agent: rank the AX tree by actionability, not document order"
```

---

### Task 4: Frames and the pierced DOM

**Fixes `auth-iframe`.** Blocked on the probe's answer for whether `getFullAXTree` takes a `frameId`.

**Files:**
- Create: `clients/brotto-extension/src/observation/surfaces.ts`
- Create: `services/brotto-orchestrator/tests/agent/test_observation_bounds.py`
- Create: `scripts/test-observation-surfaces.test.js`

**Interfaces:**
- Consumes: `sendCommand(tabId, cmd)`
- Produces: `enumerateSurfaces(tabId, limits?): Promise<Surface[]>`, `Surface = {frameId, isCrossOrigin, axNodes, domRoot}`, with `limits = {maxFrames: 12, maxDepth: 4, maxNodes: 2000}`

- [ ] **Step 1: Write the failing tests**

`test_observation_bounds.py` is a pure test — the traversal's arithmetic is separable from its I/O:

```python
def test_a_page_with_three_thousand_frames_stops_at_twelve():
    """Review Focus #1. Enumeration must stop and report, not walk."""
    kept = select_frames([_frame(i) for i in range(3000)], max_frames=12, max_depth=4)
    assert len(kept) == 12
    assert kept[0].frame_id == "root"


def test_frame_depth_beyond_four_is_not_worth_the_round_trip():
    """A control deeper than 4 indents out of the rendered tree anyway, so
    fetching it costs frames and buys nothing the model can use."""
    kept = select_frames(_chain(depth=9), max_frames=12, max_depth=4)
    assert len(kept) == 4
```

`test-observation-surfaces.test.js` covers the ref namespace: a `nodeId` is unique only within a frame, so merged refs must be unique across frames and must round-trip to the right `(frameId, nodeId)`.

- [ ] **Step 2: Run both to verify they fail**

Run: `cd services/brotto-orchestrator && ../../.venv/bin/python -m pytest tests/agent/test_observation_bounds.py -q` and `node scripts/test-observation-surfaces.test.js`
Expected: FAIL, both

- [ ] **Step 3: Implement**

`Page.getFrameTree` → bounded walk. Per the probe: if `getFullAXTree({frameId})` works, one call per frame; if not, `Target.attachToTarget` per out-of-process frame. `DOM.getDocument({depth:-1, pierce:true})` per frame for the DOM half.

Composite refs. Keep `(frameId, nodeId)` alongside so dispatch can route a click to the right frame — **`Input.dispatchMouseEvent` on the top session does not reach an OOPIF**, so a cross-origin frame's click needs its own session. This is the part most likely to surprise; write the test before the implementation.

- [ ] **Step 4: Verify against the fixture**

```bash
cd services/brotto-orchestrator
../../.venv/bin/python scripts/run_benchmark.py --fixture auth-iframe
```
Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add clients/brotto-extension/src/observation/surfaces.ts \
        services/brotto-orchestrator/tests/agent/test_observation_bounds.py \
        scripts/test-observation-surfaces.test.js
git commit -m "observation: read every frame, bounded, and never script a foreign one"
```

---

### Task 5: Geometry in bulk

The efficiency work. Not a fixture fix — every fixture gets faster.

**Files:**
- Create: `clients/brotto-extension/src/observation/geometry.ts`
- Create: `scripts/test-observation-geometry.test.js`

**Interfaces:**
- Consumes: `sendCommand(tabId, cmd)`, a `Map<backendNodeId, {x, y}>` requirement
- Produces: `boxMap(tabId, backendNodeIds: number[]): Promise<Map<number, {x, y}>>`

- [ ] **Step 1: Write the failing test**

Assert the round-trip *count*, which is the entire point:

```js
// 1. 500 backendNodeIds resolve in 3 CDP calls, not 500
// 2. an element with no box (display:none) is absent from the map, not (0,0)
//    — a (0,0) is a click at the top-left corner of the viewport
// 3. an element scrolled out of view still gets a rect
// 4. the map is empty for an empty id list, without any CDP call at all
```

Case 2 is the one that bites: today a missing `getBoxModel` leaves `x`/`y` undefined and the target is rendered off-screen, but a naive batch version would write `0,0` and every such element would be clicked in the same place.

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-observation-geometry.test.js`
Expected: FAIL

- [ ] **Step 3: Implement**

`DOM.getDocument({depth:-1, pierce:true})` → `DOM.resolveNode` → `Runtime.callFunctionOn` with the id list as an argument, returning `Map<backendNodeId, [x,y]>` by value. Three calls, bounded at 2000 entries.

- [ ] **Step 4: Measure and record the win**

Re-run the suite and record wall-time per fixture before and after in the commit message. If the number is not materially better, say so in the commit rather than shipping a refactor justified by a claim.

- [ ] **Step 5: Commit**

```bash
git add clients/brotto-extension/src/observation/geometry.ts \
        clients/brotto-extension/src/observation/index.ts \
        scripts/test-observation-geometry.test.js
git commit -m "observation: every box in three round trips, not one per node"
```

---

### Task 6: `aria-hidden` supplement

**Fixes `auth-aria-hidden`.** The sharpest security edge in the workstream.

**Files:**
- Create: `clients/brotto-extension/src/observation/supplement.ts`
- Create: `scripts/test-observation-supplement.test.js`
- Modify: `services/brotto-orchestrator/src/brotto_orchestrator/agent/ax_filter.py` (render the `[hidden]` marker)
- Modify: `services/brotto-orchestrator/tests/agent/test_ax_filter.py`

**Interfaces:**
- Consumes: `sendCommand(tabId, cmd)`
- Produces: `findHiddenTargets(tabId, frameId): Promise<object[]>` returning targets with `role`, `name`, `backendNodeId`, and `hidden: true`

- [ ] **Step 1: Write the failing tests**

```js
// 1. an aria-hidden control is found and marked hidden:true
// 2. a visible control is not returned — the supplement adds, never duplicates
// 3. the 512 KB Runtime.evaluate cap is enforced on a pathological page
// 4. a node already in the AX tree is never also emitted as hidden
```

And in `test_ax_filter.py`, the secure-mode one — **Review Focus #3**:

```python
def test_a_hidden_destructive_control_is_not_pre_approved():
    """Surfacing an aria-hidden control must not hand it a free pass. The
    site hid it from assistive tech; the user did not approve it."""
    assert _pre_approved(aria_hidden_target(role="button",
                                           name="Delete account")) is False
```

- [ ] **Step 2: Run both to verify they fail**

Expected: FAIL, both

- [ ] **Step 3: Implement**

One `Runtime.evaluate` per frame returning `[aria-hidden]` elements that are visible and hit-testable, with their accessible-name candidates. Render them with a `[hidden]` marker so the model's instructions can weigh it.

**Mark the line, do not hide it from the model.** The attribute is working as designed for AT users and nothing changes for them; the question here is only what the *model* is told.

- [ ] **Step 4: Verify against the fixture**

```bash
cd services/brotto-orchestrator
../../.venv/bin/python scripts/run_benchmark.py --fixture auth-aria-hidden
```
Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add clients/brotto-extension/src/observation/supplement.ts \
        services/brotto-orchestrator/src/brotto_orchestrator/agent/ax_filter.py \
        scripts/test-observation-supplement.test.js \
        services/brotto-orchestrator/tests/agent/test_ax_filter.py
git commit -m "observation: surface aria-hidden controls, marked, and never pre-approved"
```

---

### Task 7: The canvas decision, and re-record

**Files:**
- Modify: `docs/superpowers/specs/2026-10-01-perception-hardening-design.md` (record the decision)
- Modify: `services/brotto-orchestrator/tests/fixtures/baseline.json` (re-recorded)

- [ ] **Step 1: Ask the product question before writing code**

`auth-canvas` is the one fixture with no engineering answer. A canvas UI has no
accessibility nodes and no text by construction. Either:

- **A vision fallback** — screenshot plus a vision model per observation. Abandons
  "AX tree, no vision model", which is on the moat list in `brotto-current-state.md`,
  and adds per-observation token cost on every task.
- **Honest reporting** — tell the model the page renders via `<canvas>` and the named
  control was not found, and let it navigate or read text instead. Cheap, loses canvas
  surfaces, keeps the architecture.

**This is the user's call, not a task decision.** Present the two, with the probe's
finding on whether `auth-canvas` has an accessibility mirror, and stop until answered.
If the probe found a mirror, option B costs nothing and the question is moot.

- [ ] **Step 2: Implement whichever was chosen**

If honest reporting, it is a few lines in the prompt and no new surface. If vision,
that is a separate spec — do not start it inside this plan.

- [ ] **Step 3: Re-record the baseline, only when the suite is green**

```bash
cd services/brotto-orchestrator
../../.venv/bin/python scripts/run_benchmark.py --all --out tests/fixtures/baseline.json
../../.venv/bin/python scripts/run_benchmark.py --all --check
```
Expected: `--check` passes against the fresh baseline

- [ ] **Step 4: Commit**

```bash
git add services/brotto-orchestrator/tests/fixtures/baseline.json \
        docs/superpowers/specs/2026-10-01-perception-hardening-design.md
git commit -m "bench: re-record the baseline against a perceiving agent"
```

---

### Task 8: Docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/product/brotto-current-state.md`
- Modify: `docs/superpowers/specs/2026-09-28-capability-map-design.md`
- Create: `docs/architecture/perception.md`

- [ ] **Step 1: Write the reasoning first**

`docs/architecture/perception.md` records *why*, in the same voice as the existing six
architecture notes: what the baseline measured, which gaps the probe found real, which it
found were ours, and what each fix cost. The shadow-DOM result goes here whatever it is —
a confirmed non-gap is a result, and it is the one most likely to be needed again.

- [ ] **Step 2: Add the operative rule to `CLAUDE.md`**

One short section, the conclusion only, with a pointer to the architecture note. The
pipeline order and the caps are the parts someone needs at 3am; the CDP archaeology is
not.

- [ ] **Step 3: Correct the stale claims in the current-state and capability-map docs**

Working agreement #3. Known-stale, independent of what this workstream finds: the map
says "13 actions" (16), lists 0B and 0C as unbuilt (both shipped), and carries a
`4A, 4B ◀── 0B` edge that did not bind. Add the shadow-DOM correction if the probe
returned one.

- [ ] **Step 4: Commit**

```bash
git add -f docs/architecture/perception.md CLAUDE.md \
        docs/product/brotto-current-state.md \
        docs/superpowers/specs/2026-09-28-capability-map-design.md
git commit -m "docs: what perception costs, and which gaps were not real"
```

---

## End-to-end verification

```bash
cd services/brotto-orchestrator && ../../.venv/bin/python -m pytest tests/ -q
cd ../../clients/brotto-extension && npx tsc --noEmit && npm run build
cd ../.. && for t in scripts/test-*.test.js; do node "$t" || echo "FAIL $t"; done
```

Then the three things a person actually checks, in a browser with the extension loaded
against a **freshly restarted** server — the fixtures README is explicit that a stale
server measures code that is no longer in the tree and exits 0 regardless:

1. **`auth-slowjs` and `auth-inbox` by hand** — the two fixes whose behaviour is visible:
   a slow-loading page should not be read empty, and a long list should not need a scroll
   step to reach its last row.
2. **Observation latency on a dense page.** Open a 600-target page and watch the timing
   breakdown. This is the only check that can tell you whether Task 5 earned its place.
3. **A real site behind a login** — the claim the whole workstream exists to support. A
   Gmail or LinkedIn task that previously failed on perception should now get past the
   first observation.

The benchmark proves the pipeline sees. It cannot prove a model uses what it sees; only
the third check tests that, and it is the one that matters.
