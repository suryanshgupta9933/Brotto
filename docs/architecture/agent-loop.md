# The agent loop: per-step context, convergence, and failure modes

Read before touching `agent/harness.py`, `agent/prompt.py`, `ax_filter.py`, or
anything about retries, step counts, or what the model is shown.

## What the agent sees each step

Four things arrive per step. All four were captured and thrown away at some point, and each omission cost real steps on a live run:

- **Hierarchy** (`SemanticTarget.parent_ref_id`, resolved to the nearest *kept* ancestor). Rendered as indentation. Flat, a repo's star count sat eight lines from its name with nothing marking the record, and the model guessed which one it belonged to. Resolution walks the full `parentId` chain — a link's direct parent is almost always a `generic` container that gets filtered, so resolving only the direct parent yields depth 0 on most real pages. This is also why `listitem` / `row` / `gridcell` are in the extractor's kept set: they're nameless, never render, but they're the parent a record's fields resolve to.
- **Hrefs** (`SemanticTarget.href`, from the CDP `url` property, links only). Without them the model cannot see a page's URL space at all and guesses at deep-link patterns. This is the general mechanism for "use deeplinks efficiently" — no site-specific knowledge anywhere.
- **Page text** (`AgentTurn.page_text`, innerText, every step). The only source for values the AX tree omits — a repo's star count, a price. Costs nothing on the extension path (rides along in the `Runtime.evaluate` that already fetches url/title). `read_page_text` remains the targeted tool for a selector or `around` region.
- **Budget** — `ax_filter.budget_for_window(context_window, step)`, a twentieth of the window, floored at 8K and capped at 60K. Over budget, whole lines are dropped and the count is reported; the tree is never sliced mid-element. The old flat `MAX_CHARS = 6000` truncated a real GitHub list page at 6041 chars. **The budget decays with the step** — to 30% by step 15 — because the tree is worth most at step 0, where the model is surveying the page to decide what to try at all; by step 15 it is executing a plan it already holds, and most of the tree is pages it has already rejected. The tree is uncacheable every step (the page genuinely changes), so every char saved here is a per-step saving for the rest of the task: ~35K chars off every step past 15 at a 1M window. The floor is the *window* budget, not `MAX_CHARS`, so a late step that needs to re-find something still gets a real page. See the "stagnation" section below for why the tree's floor is a floor and not a fraction.

`context_window` is read at the **top** of a step and written at the **bottom** of one, which is a step behind the tree it sizes. It is now resolved by `_resolve_model(deps)` before the loop, so step 0 is budgeted against the model that will actually read it. Before that, step 0 called `budget_for_window(None)` and got the 6K `MAX_CHARS` floor while every step after it got the real window — a fifth to an eighth of the page on the step that decides what a task tries first, and the step a user reads as "the pause before it starts."

Verified: the "find my most starred repo" task that took 8 steps went to 2 — one navigate to the star-sorted view (discovered from a visible href), then the answer.

### Which lines survive the cut

`ax_filter` sorts by `(role not in ACTIONABLE_ROLES, offscreen, not t.name, depth)`
before applying the budget, and the sort is stable so tree order still breaks ties.
The old order was viewport-first, then tree order — which meant a long page's
*first* N controls survived and a named control in the middle of it did not.

**Truncation was a ranking problem, not a size problem.** `auth-inbox` failed
because the target was present in the tree and past the cut; no budget increase
fixes that, because the next page up the list has the same problem. `budget_for_window`
is untouched by this — it decides *how many* lines, the sort decides *which*.

External evidence that less tree is the right direction, and that compressing beats
passing through: on 358 OSWorld tasks, screenshot 7.0%, linearized AX tree 15.6%,
**compressed** AX tree 20.7%. Two results. The no-vision position is measured rather
than assumed, and ranking under a budget is the same move as that compression —
same source, less tree, better tree.

This is the only one of the five perception fixes the fixture suite can attest to,
because it is the only server-side one. `auth-inbox` is green because of it. The
other four are extension-side and have no headless test that exercises them.

### What a step costs

Measured off a 6-step Gmail run (session `d141a18f`, 178.10s wall, 6 model turns):

| phase | seconds | share |
|---|---|---|
| observe | 70.53 | 39.6% |
| model_plan | 82.97 | 46.6% |
| execute | 24.59 | 13.8% |

`tokens_in:out` = 39:1 — 161,764 in, 4,167 out, ~27K input tokens per turn.

**The model is not thinking — and that turned out not to be the explanation.**
`MiniMax-M3` is not in `_THINKING_REQUIRED` (`registry.py`), so
`anthropic_thinking={"type": "disabled"}` is sent. This section originally
concluded from there that `model_plan` was *prefill on a 27K-token prompt* and
that the per-turn spread (4.5s → 39.3s) tracked prompt size. **That was
inferred, not measured, and it is wrong.** It is corrected below.

#### Latency is generation-bound. Cut output, not input.

Over 73 recorded steps: `corr(output_tokens, latency) = +0.876`,
`corr(input_tokens, latency) = +0.660`. The mechanism is visible in three steps
from one Gmail session, all on the same page (`83844c3d`, `d0197c38`):

| in | out | latency | note |
|---|---|---|---|
| 25,087 | 191 | 4.3s | |
| 50,977 | 600 | 12.0s | **2× the input** |
| 25,085 | 3,612 | 41.3s | **19× the output, identical input** |
| 77,615 | 3,328 | 76.0s | 3 attempts |

Doubling input cost 4.3 → 12.0s. Multiplying output by 19 at the *same* prompt
cost 4.3 → 41.3s. The stable prefix (`SYSTEM_PROMPT + secure_prefix +
<conversation> + ## Task`) is served from cache, so 25K input tokens is close to
free; generation runs at ~60 tok/s and every token costs ~17ms.

**So the leverage is inverted from the obvious.** Shrinking the prompt buys cost
and little latency. The 41.3s step was 3.6k tokens of *writing*.

**`tokens_in` is summed over retries, so it is not a prompt size.** It reads
`result.usage.input_tokens` off pydantic-ai's `RunResult`, which is cumulative
across every request in the run — that is why it is an exact integer multiple of
the base prompt (25,086 / 50,789 / 77,615) and why `latency_ms` alone cannot
interpret it. A retry that succeeds leaves no trace in the audit, so a
retry-driven step is indistinguishable from a slow one in the document. Retries
are themselves cheap (the prefix is cached); the 76s step's 3,328 generated
tokens are ~55s of it.

**The 27K is the ranked-selection change, and it is the intended cost.** Before
it, the tree was truncated in tree order at 6K chars — small prompt, fast, and
blind to a control in the middle of a long page, which is what `auth-inbox`
caught. Ranking fills the same 50K-char budget with the *most actionable*
elements instead, so a realistic page now costs ~27K tokens to say the same
thing. The old latency was partly the old blindness; it is not a regression to
recover.

**Observation is the half that is still reducible.** Observe + execute is 95.12s
= 53.4% of wall, and 12s of `execute` is one click: `_send_action` blocks until
the extension pushes the post-action observation back.

**What it costs, measured per CDP call.** `scripts/probe_observation_perf.py`
replays the exact call sequence `captureObservation` runs, timing every call,
with `BOX_WALK` and `HIDDEN_PROBE` extracted from the TypeScript rather than
copied — a copy is a second thing to keep correct. Same-origin synthetic
embeds, 400 nodes each, best of 3:

| frames | AX nodes | geometry fallback | stability | CDP serial | @pool 6 |
|---|---|---|---|---|---|
| 1 | 5 | 0 | 3005ms | 6ms | 5ms |
| 3 | 1,613 | 0 | 3003ms | 89ms | 43ms |
| 6 | 4,025 | 2,025 | 3006ms | 1,453ms | 284ms |
| 9 | 6,437 | 4,437 | 3004ms | 3,256ms | 612ms |
| 12 | 8,849 | 6,849 | 3004ms | 4,728ms | 863ms |

Two findings that changed the design. **The stability gate is a constant 3004ms** —
3005ms on a 5-node page and 3004ms on an 8,849-node one, so it is `QUIET_MS`
and nothing about the page moves it. And **the geometry fallback is the real
cost, growing super-linearly past the cap**: `MAX_GEOMETRY_ENTRIES = 2000` bounds
the bulk batch, not the per-node `DOM.getBoxModel` loop behind it, so at the
Gmail-shaped 6-frame case it is 2,025 serial round trips for 1,453ms of one
scan. Pooling at 6 is worth 5.1–5.5× on the CDP portion at realistic frame
counts, and 1.2× on a one-frame page, which is the correct answer — there is
nothing to pool.

Composed with the unconditional retry, that is `3004 + 1453` per scan × 2
scans ≈ 9s per observation, against a measured 11.75s.

### The 41.3s step: the model was transcribing the page into its notes

One step, one page, one call — 25,085 in, 3,612 out, 41.3s. The audit's
per-field accounting (`6f66a0ae`) put **39% of that output in
`append_scratchpad.line`: 5,093 chars**, a full transcription of the inbox —
an URGENT block of 12 items plus ~45 emails by date — written on the very step
that then also wrote a 4,262-char summary and finished the task.

**Why it transcribed at all.** `Scratchpad` has two halves, and only one was in
use. `entries` is a manifest of auto-captured reads: a 200-char digest in the
prompt, the body fetched on demand by `recall_memory(id)`. That is the correct
shape and it is the textbook Write/Select split. **It had captured nothing —
`entries=0` on all three Gmail runs.** Only `read_page_text` created entries,
and `page_text` already ships in every prompt, so the model had no reason to
ever call `read_page_text`. With an empty manifest, notes were the only memory
that existed, and with nothing to retrieve, writing the page down was the only
way to keep it. The cost was ~1,300 output tokens — and output tokens are the
latency.

**It also never worked.** "Refer back to a page you've navigated away from
instead of going back" was not achievable before this: `page_text` was live-only
and the AX tree is ref-scoped, so navigating away destroyed both. The feature was
described, prompted for, and unreachable.

**The prompt fix did not work, and could not have.** The first attempt was two
changes: capture every page in code (`Scratchpad.capture_page(url, step, text)`,
called in the loop right after `get_page_text()` and before the turn is built, so
the step's *own* page is in the manifest it reads), and one paragraph telling the
model the page is already captured. **A later Gmail run (`94fd2166`) put 3,913
chars of the inbox into a note on step 0 — 22 of the 33 seconds to first step —
and then wrote the same content again as a 4,262-char summary, 59.1s.** The
paragraph was necessary and not sufficient, for two reasons.

**Two rules pointed opposite ways.** `SYSTEM_PROMPT` carried the 3-step note rule
(*write a note if you will need this again in 3+ steps*) directly above the newer
prohibition on writing a page's contents. What the model produced was a
*synthesis*, which the older rule tells it to write and the newer paragraph does
not clearly forbid — it forbids transcription. When rules conflict, the more
operational one wins. **Prompting is not a guarantee**; the third Gmail run in a
row had produced the same shape.

**So the write action left the schema.** `append_scratchpad` and `write_scratchpad`
are gone from `ActionCall`; the tokens cannot be spent on something with no action
to call. The census across every recorded run: **25 `append_scratchpad` calls, 0
`write_scratchpad`**, ~17,000 chars of them a copy of the page text already in the
prompt, ~2,000 chars of breadcrumbs that duplicate `step_summaries`, ~1,250 chars
irreducible. **The six runs with the largest `tokens_out` are exactly the six
whose final note was transcript-shaped.** Capping was considered and rejected:
`NOTES_CAP` truncated at 4K *after* the model had already spent the 1,300 output
tokens writing 5,093 chars, which is strictly worse than never offering the write.

`notes` survives as a read-only legacy field. Sidecars written before memory became
code-written carry a `# NOTES` section and the loader still parses it, so files on
disk keep working; nothing writes it and no notes block is rendered into the
prompt. `set_scratchpad` no longer waits for an action to touch memory — with
`capture_page` running above it every step, the write is unconditional, because
gating it on an action is what left `entries=0` for so long.

**…and the fix immediately moved the cost to the read path.** The prompt said
the final summary "must be grounded in memory" and to "recall the relevant
entries to verify the wording". On a live Gmail run — task *"Summarise today's
inbox"*, step 0 — the manifest held exactly one entry, the inbox the model was
already looking at, so it recalled it. The recall returned ~11K chars the prompt
was **already carrying in full**: thousands of input tokens for zero new
information, on the step that then wrote the summary. Removing the write path
and leaving a mandatory verification read is the same waste on the other side of
the token bill.

So: **recall is for pages you have navigated away from, never the page in
front of you.** `SYSTEM_PROMPT` states it, and the manifest entry whose `url`
equals `current_url` is marked `← THIS PAGE, already in your prompt — do not
recall` so the model does not have to infer it by comparing two URLs. An entry
for an *earlier* page must stay unmarked — marking every entry would make
"go back to that page" unreachable, which is what memory exists for. The stale
note-keeping example (`GOAL PROGRESS: …`) and "read your memory at the start of
every step" went with the write path.

**The AX tree is deliberately not cached.** A ref is valid only for the
observation that produced it. A cached tree hands the model refs that resolve to
nothing or, worse, to the wrong element after a re-render — the grounding bug
`_locate` was just hardened against. Page text is safe to keep precisely because
it carries no refs; that is the whole boundary between the two.

**`entries` carries `url`.** Three pages captured in one run are otherwise
indistinguishable in the manifest, and "go back to *that* page" is the recall
use case. Both entry kinds number from `Scratchpad.next_id()`; they previously
numbered independently at their two call sites, so a capture landing between two
reads could reuse an id and silently overwrite an entry. Empty and
whitespace-only pages are skipped, or a run that never loads anything fills the
manifest with empties and ships them every step.

#### The capture nearly doubled the audit document

`set_scratchpad` runs on every action-bearing step and `_record` rewrites the
whole document, so anything serialised there is re-serialised every step.
`_scratchpad_dict` used `e.model_dump()`, which includes `body`. That was
invisible *precisely because nothing was ever captured* — `entries=0` on every
run. Capturing every step's page turned a latent write-amplification into a
per-step one: 20 Gmail-shaped pages measured **200KB of document growth**. The
record now carries id/step/selector/around/digest/was_truncated/url and not the
body; the bodies go to the sidecar below, so nothing is lost, only moved.

`_as_scratchpad` rebuilds the model from that dict to write the sidecar, so it
defaults `body` to the digest — without it a resumed run loses its entire
manifest rather than keeping the digests. The sidecar header gains a trailing
optional `url=`, and the loader's regex makes that group optional so files
written before `url` existed keep parsing byte-identically.

**A resumed entry recalls as its digest, and says so.** Handed 200 unmarked chars
of an 11,000-char page, the model reads the fragment as the whole page and
answers from it. `recall_memory` appends a marker naming the URL. The test is the
trailing `…`: a page whose digest was never cut is complete, and `digest == body`
is simply what a short page looks like — labelling that as a resume casualty
would send the model navigating back for nothing.

**…which is no longer the resume path, and never was.** With every page
captured every step, a resume that recalled only digests was handing the model
a degraded tool and asking it to cope. The fix was a separate JSON sidecar,
`<session_id>.pages.json`, carrying the bodies — and that sidecar was then
switched off entirely, because 200KB of a person's inbox per twenty pages,
unredacted, on someone else's disk is not a cost worth paying. The digest is
what the manifest holds now and `recall_memory` says out loud when that is all
the model got. `docs/architecture/privacy.md` has the current shape.

**Left alone deliberately:** `page_text` (~3.4K tokens) sits *after* the AX tree,
which changes every step, so it is re-prefilled uncached every step. Moving it
above the tree would extend the cached prefix — worth perhaps 1s/step, against a
documented "don't reorder" and a lost-in-middle demotion of the values a
read-only question is answered from. Not worth it.

### The three serial loops are pooled, and the order is the contract

`pooled(items, limit, fn)` in `surfaces.ts` runs a loop at `CDP_CONCURRENCY = 6`
and writes results **by index, never by append**. It rewrites three loops: the
per-frame `getFullAXTree` reads, the supplement's `DOM.getNodeForLocation`
hit-tests, and the geometry fallback's `DOM.getBoxModel` calls. Every call is
issued with identical arguments, so the observations are bit-identical.

The frame reads were sequential deliberately — *"a page that legitimately has a
dozen frames should not have twelve `getFullAXTree` calls in flight against one
debugger session."* A bound of 6 answers that concern rather than overturning
it: `chrome.debugger.sendCommand` is a native per-call callback API with no
lock, so concurrency is supported by construction, and the number that matters
is how many are in flight, not whether they are.

**Why index-ordering is not a detail here.** A supplement ref is minted from the
item's index — `-(i + 1)` — and that numbering is the only thing keeping a
supplemented control from colliding with an AX `nodeId`. A pool that appended on
completion would renumber every `aria-hidden` control on the page, and a
renumbered AX tree is a tree that still parses and still looks plausible.
Likewise the frame bookkeeping (`cappedFrames`, `failed`) is *not* pooled even
though the reads are: both are read in order to decide whether the model lost
something, so they are filled in one sequential pass after the reads land.

**The re-attach needed deduplicating.** `sendCommand` re-attaches once when a
command reports "not attached". With six calls in flight, a detach made every
one of them independently call `chrome.debugger.attach` on the same tab. One
in-flight attach promise per tab now, cleared on settle either way so a failed
attach is not cached forever.

**Not measured, stated rather than assumed:** the probe's synthetic pages carry
no `aria-hidden` elements, so `hits` is 0 on every row and the supplement's
≤200-call `DOM.getNodeForLocation` loop is still unpriced. It is bounded at 200
calls so it cannot be the largest term, but it has no number.

**An OOPIF is invisible to all of this.** Building *cross-origin* synthetic
embeds measured zero frames: headed Chromium puts them in their own renderer
process under site isolation, which makes them a separate CDP *target*, and
they do not appear in the main frame's `Page.getFrameTree` at all. So the
frame scan cannot see them, and the 6-frame row above is a floor on the real
Gmail case rather than a representative number. This is the same gap already
recorded as unfixed for OOPIF *clicks* — one cause, two symptoms.

### The rescan is gated on the page having gone still, and `waited` is the predicate

`captureObservation`'s retry loop read a settled page twice. Its first iteration
was unconditional, so a page the stability gate had *already* watched go still
for the full 3s window still paid a second full frame scan — a flat ~3.0s on
every settled observation, and the 3.0s is the quiet window, not the scan.

`pageMayStillBeMoving(stability)` skips the loop when the page provably sat still
for the whole quiet window. `auth-slowjs` is the regression gate for this: its
control appears at 5000ms, so the page mutates past the window, never settles,
hits the deadline, and **rescans exactly as before**. `scripts/test-observation-stability.test.js`
builds all three Stability shapes through the real `waitForStable` rather than
writing them as literals, so the gate cannot ship alongside a change to what
those shapes are.

**The predicate is `waited`, not `!timedOut`.** `waitForStable`'s catch path
returns `{waited: false, timedOut: false}` for a tab that navigated mid-observe
— there was no promise left to resolve. Gating on `!timedOut` would skip the
rescan on a page nobody watched, which is how a half-rendered tree reaches the
model. The three cases are therefore: quiet for the full window → skip; ran to
the deadline still mutating → rescan; no answer at all → rescan.

What this does not buy: the *unsettled* path still runs up to three full frame
scans, so a page with a dozen frames pays 36 `getFullAXTree` calls. Worth
caching the frame list across the retries if a trace ever shows it — the cap
bounds it, it is not unbounded.

### The quiet window was unreachable on exactly the pages that need it

The above gate was correct and nearly free — and the deadline it protects was
the single largest cost in the whole loop. From the live Gmail run: wall 41.94s,
of which observe was 22.38s (53.4%). One observation was 11.19s, and 10.002s of
that was `waitForStable` sitting on its own deadline. Over a two-step run that
is **47.7% of wall clock, every step, forever.**

The reason is arithmetic, not tuning. `QUIET_MS` is 3000 and the gate resolves
only after 3s with **zero** mutations. Gmail measured 41 mutations in 10,002ms —
one every ~244ms. Three seconds of silence on that page is not rare, it is
impossible. So the common page and the animated page are the same page, and the
gate was never a wait on them; it was a sleep with a 10s timeout.

**Mutation rate separates the two shapes a mutation count cannot.** A slow
renderer is *silent* and then changes — `auth-slowjs` produces almost nothing at
1000ms and renders its control at 5000ms. A live app is already churning at 1s,
because it is past its initial render and into its steady state, where a spinner
or a live feed keeps the document dirty forever. Same observation, opposite
conclusion, and nothing in the old design could tell them apart.

So the gate now **samples**: if ≥3 mutations landed in the first 1000ms, resolve
at once with `early: true` and let the caller decide. Expected Gmail observation
is 10.8s → ~1.4s. The decision is not trusted — it is a *guess about the page*,
and the guess is checked below.

**Misclassifying toward "busy" is the safe direction and cannot corrupt
anything.** The sample only ever resolves `waited: false`; it has no path to
`waited: true`, so it can never assert a page is still when it is not. The
caller rescans and compares fingerprints, and if the page turns out to have been
moving it falls back to the full gate. Misclassifying toward "quiet" is the
dangerous direction and the sample structurally cannot do it.

`waitForStable(tabId, {noEarly: true})` sets the sample window to 0, which is
the caller's fallback and the mode that keeps a slow renderer's full window
intact. `Stability.early` marks a page the sample claimed, so `metrics` says
which path a given observation took.

### The short-circuit is a guess, so the rescans are the arbiter

`captureObservation`'s retry loop already compared `role|name|value`
fingerprints across scans and broke on the first match — the check that decides
whether an unsettled page is worth reading again. What it discarded was its exit
reason, which is the only thing that distinguishes "the sample was right, the
page had settled" from "we read it too early and owe it another look."

```ts
if (stability.early && !settledByFingerprint) {
  await waitForStable(tabId, { noEarly: true });
  const settled = await extractAx(tabId);
  ...
}
```

On the fast path the rescans match and this block never runs, so the whole
saving stands. On the slow-renderer shape every rescan differs, the full quiet
window is paid, and one more scan follows — which is the pre-existing
behaviour, unchanged.

`scripts/test-observation-rescan-guard.test.js` extracts `captureObservation`
and pins all four shapes, because a guard that silently stops firing hands the
model a half-rendered tree while every metric still reads healthy. An absence
reads clean in a diff; that is the whole reason it has a test.

**The thresholds are calibrated from one sample and are deliberately
conservative.** Gmail ran 4.1 mutations/s against a threshold of 3 per 1000ms,
so it clears the bar with ~30% headroom — a page half as busy would not, and
would pay the old 10s. One live run recalibrates it, and the metrics already
flow back to the server log. A *miss* costs time and never accuracy, which is
the asymmetry that makes shipping an uncalibrated guess the right trade.

### The observation reported its cost nowhere

`waitForStable` returns `{waited, timedOut, elapsedMs, mutations}` and `boxMap`
returns `{requested, resolved, fallback, truncated, source}`. `captureObservation`
discarded both — it called `waitForStable(tabId)` for the await and threw the
value away, and read `geometry.boxes` but not the rest. So the double rescan,
the quiet-window floor and the geometry overflow were all inferable from the
source and from nothing else, and the probe above existed to substitute for
counters that were already being computed.

`observationMetrics` now reports them, and `main.py` logs the block with every
observation. This is what makes the other two changes falsifiable: a
performance fix whose effect cannot be read off a real run is a fix argued
from a synthetic probe.

One trap in it. `geometry.boxes` is a `Map`, and a `Map` on the wire serialises
to `{}` — which in the log is indistinguishable from `source: "no-join"`, a
real and different fault. The metrics copy the geometry fields individually
rather than spreading, and `scripts/test-observation-metrics.test.js` pins it.


### What the AX tree does not contain — measured, not inferred

Everything above describes what we do with the tree we get. Whether the tree
*has* the control is a separate question, and it is answered by measurement,
not by reading our own source.

`scripts/probe_perception.py` loads each fixture site in a real Chrome and
records four routes per target: top-frame `Accessibility.getFullAXTree`, the
same per frame from `Page.getFrameTree`, a DOM walk that recurses into open
shadow roots, and whether the target reached the model at all (read from
`tests/fixtures/baseline.json`). Output is committed to
`tests/fixtures/perception-probe.json`; `tests/test_perception_probe.py` pins
the verdicts.

Two results worth carrying into any change here:

- **Shadow DOM is not a gap.** A control inside an *open* shadow root comes
  back from a plain top-frame `getFullAXTree`. The capability map listed it as
  its first 0A finding, justified by a repo-wide grep for `shadowRoot`
  returning nothing — which proved that *our source* has no such identifier and
  said nothing about Chrome. Retracted 2026-10-01. If you are about to write
  shadow-DOM traversal, do not: re-run the probe and read it first.
- **`getFullAXTree` takes a `frameId` and reads cross-origin frames
  in-process.** The `auth-iframe` probe enumerated 2 frames with zero errors.
  Traversal is therefore one call per frame, with no target-attach, and
  critically with no script evaluated in a foreign realm — reading AX nodes and
  geometry only.

The remaining five fixtures each fail at a *different* stage, which is the
point of the artifact: `GAP_FRAMES` (iframe), `GAP_ARIA` (present in the DOM,
dropped from the AX tree by `aria-hidden`), `GAP_UNREACHABLE` (canvas — no
nodes, no text, a product decision rather than a fix), `GAP_TIMING` (the
target takes 5s to appear and we read the tree at an arbitrary instant), and
`GAP_RENDER` (present, in the tree, and past the character budget).

### Frames — a bounded union, and a ref that has to be composite

`observation/surfaces.ts` walks `Page.getFrameTree` and calls
`getFullAXTree({frameId})` once per selected frame. Three things about it are
load-bearing:

- **A `nodeId` is unique only within one frame.** Two frames both return
  `nodeId: 42`, so the ref is `<frameIndex>:<nodeId>` — the *ordinal*, not
  the 32-char CDP frame id, because a ref is printed on every line of the
  rendered tree and 32 hex chars a line is not free. The real `frameId`
  travels on the target as `frameId`, which is what dispatch routes with.
  `parent` is the composite too, and the server's `_depths` treats it as an
  opaque string, so a `1:41` → `1:7` chain indents exactly as bare node ids
  did. **Parent resolution is per frame**: the `parentId` table is the
  frame's own, so a link whose kept ancestor is `dialog` at node 1 resolves
  to `1:1` in every frame, and a bare id would have made the wrong table
  invisible.
- **The caps are 12 frames, depth 4, 2000 nodes per tree, and they are
  enforced in the walk**, not written down. Depth 4 because the server's
  `MAX_DEPTH` for indentation is already 4 — a control four levels down
  flattens out of the rendered tree, so traversing it spends a round trip on
  something the model cannot use. The walk is breadth-first over an
  index-pointer queue of *nodes* (not frames: `childFrames` is on the node,
  the same wrapping that puts `id` there), so a 3000-deep bomb neither
  recurses nor starves the shallow frames. `Page.getFrameTree` delivers the
  whole tree in one call, so the cap is on the per-frame AX reads, which is
  where the cost is; `total` still counts everything, because an honest
  "12 of 3000" beats a cheap lie.
- **No script is evaluated in a foreign realm.** Everything reads
  accessibility nodes and geometry. `Runtime.evaluate` in a cross-origin
  frame's execution context is a materially larger privilege than a read and
  is not in this workstream.

A frame that fails `getFullAXTree` is recorded in `scan.failed` and skipped;
the main frame's targets are already in hand. A `Page.getFrameTree` that
fails entirely (a tab mid-navigation) falls back to a single frameless
surface — the main frame's tree is readable without a `frameId` — so the
observation degrades to the pre-frames behaviour rather than to nothing.

The scan (`frames` on the observation frame) records `traversed`, `total`,
`crossOrigin`, the three cap flags, `cappedFrames` and `failed`. `main.py` logs
a warning when any of them trips, so a truncated or partly-unreadable
observation is visible rather than silently partial. **The model is not told
yet** — that wants one more line beside the "N more element(s) not shown" note
at the end of `render_ax_tree`.

**A boolean cap flag cannot answer the question it exists for.** The first
version of that warning read

```
observation truncated: 6/6 frames (4 cross-origin), capped=nodeCapped unreadable=none
```

on every step of a Gmail run — six of six frames traversed, nothing unreadable,
and the one thing that decides whether the agent is blind is *which* frame hit
`MAX_NODES_PER_FRAME`. The main document capping is a model looking at half a
page; an analytics embed capping is nothing at all, and there is no way to tell
those two apart from the flag. The scan now carries `cappedFrames`
(`{frameIndex, url, crossOrigin, nodes}`) and the warning names them. A log line
that fires every step has to be worth reading when it fires.

**Not fixed, deliberately:** a click still dispatches by coordinate on the
top session. For a same-process cross-origin frame that works. For an
**OOPIF** — a frame in its own renderer process — the top session's
`Input.dispatchMouseEvent` does not reach it, and routing it would mean
`Target.attachToTarget`, a privilege expansion the probe did not show we
need. `frameId` is on the target so that path exists when it does. Not
verified in a browser.

## Choosing a target — and what choosing actually costs

Everything above is about *what the model is shown*. This is about *how it is
allowed to refer to it*.

Measured on web agent action spaces, the rate at which the model refers to a
target that does not exist, by how the reference is expressed
(arXiv:2603.14248, Table 4):

| Reference form | Hallucination rate |
|---|---|
| Action Object — model *names* the element | **34.0%** |
| Expanded — model describes it, then resolves | 3.0% |
| Action ID — model *selects* from a list it was given | **2.0%** |

**Two axes, and the 17× spread only sits on one of them.** Action ID was
measured over a *restricted primitive verb set* — click, type, select, hover.
"Expanded" is the expressive verb set (`google_search`, `goto`, `click`,
`fill_form`, `get_final_answer`) that is much closer to Brotto's, and it scores
3.0%. So the honest target for a Brotto-shaped action space is 3%, not 2%, and
the headline number was borrowed from a column that is not ours.

**Brotto is not in the Action Object column, and the recorded history says so.**
An earlier version of this file claimed "Brotto is at 34%." It was wrong, and
wrong in a way worth keeping: it read the capability map, saw that
`find_element` takes a free-text `name`, and inferred the whole action surface
was name-based. The observation is real but it is one verb with **0 call sites
in 75 recorded actions across 7 sessions**. `click` and `type_text` take a
`ref` from the AX tree the model was just shown, which is the Action ID shape
already.

Counted over every audit document on disk — 41 documents, 168 executable
actions, using the failure strings both relays have always returned:

**0 grounding failures. The model never once named a ref that did not resolve.**

Three things that number does *not* say, all of which matter more than the
number:

- **It is the Playwright path only.** All 41 documents came from `/run` or dev
  mode. The extension relay — the product — has never written one, so its
  grounding behaviour is *unmeasured*, not measured-as-clean.
- **It counts resolution, not validity.** A ref that hallucinates *into* a real
  but wrong element resolves, clicks, and reads as `ok: true`. That is an
  action-validity failure wearing a grounding failure's clothes, and no
  ref-resolution check can see it.
- **The paper's own caveat applies.** Its recommendation #3: action IDs "reduce
  invalid actions but often reflect uncertainty as random errors." A menu does
  not stop a model guessing — it makes the guess indistinguishable from a
  decision. The second bullet above is that failure arriving.

### A grounding failure was being recorded as a success

`harness.py` computes `ok = not outcome.startswith("Error executing")`. The
relays returned a *friendly sentence* for a ref that resolved to nothing:

```
"No coordinates for ref '0:99' — element may be off-screen"
```

which does not start with the magic prefix, so `ok: true`, so the audit holds
`ok: true` for an action that did not happen. The grounding failure rate was not
merely unmeasured — it was **actively recorded as clean**, which is why the
first attempt to measure it returned "94% of refs resolved" and that number was
a tautology of the bug. `focus_ref` and `clear_ref` were worse: they returned
`None` and silently no-opped, so a `type_text` into a hallucinated ref typed
into whatever was focused *before* — the HDFC failure class, where the model
typed six queries into a field it never successfully addressed.

Fixed at the shared point both relays route through:

- `_coords` → `_locate`, returning `(coords, reason)`. "Not in `axTargets`" and
  "present but has no box model" are now different strings, because only the
  first is a grounding error — the second is a correct guess at something
  scrolled out of view.
- Every ref-taking method returns the `Error executing:` prefix when the ref
  does not resolve, on both `extension_relay.py` and `relay.py`. `ok` is then
  correct with no change to `harness.py`, because the prefix was already the
  contract and only the callers were violating it.
- `type_text` in the harness bails if `focus_ref` or `clear_ref` reports
  failure, instead of typing into a field the model never named.

Pinned by `tests/test_grounding_outcome.py` (5 tests, both relays).

**…and then the fix was itself wrong, for the same reason.** A live Gmail run
recorded it in the audit document:

```
'click' ok=True  ->  'Clicked [13829]: Error executing: ref 13829 is not in the current AX tree'
```

The prefix was there, just not at the front: `harness.py` decorates the relay's
outcome on the way through (`f"Clicked [{ref}]: {result}"`), so a
`startswith` test misses every failure whose action had a name to print. Making
the relays well-behaved was necessary and not sufficient — the derivation point
had to change too, and it is now **membership**, `_EXEC_FAILURE not in outcome`,
with the string named as a module constant rather than repeated. A prefix test
is the kind of contract that only holds until something upstream formats the
message. Pinned by `test_a_wrapped_failure_is_still_recorded_as_not_ok`.

**The model wrote `ref: 13829` because the prompt taught it to.** Two
anti-examples in `SYSTEM_PROMPT` demonstrated the target as a *bare number*:

```
Bad: "…extracting the order ID."          (cited click on ref 42)
- Bad: "I can see [28863] in the AX tree…"
```

while the tree correctly renders `[0:13829]`. The prompt was the source of the
format it then emitted — the same class of bug as the `stagnat` needle, where
the discriminator in the code is a substring of a model-authored string. Both
lines now use composite refs, and a test scans `SYSTEM_PROMPT` for
`\bref \d` so a future edit cannot reintroduce the shape.

**…and the model kept writing it, so the relay tolerates it.** The prompt fix
was necessary and not sufficient. A later Gmail run (2026-10-01) emitted
`ref: "149099"` against a tree rendering `[0:149099]` on **4 of 4 steps** — the
same ref, the same unchanged page, `ok: false` four times, 98s of wall for a task
the model had already located. The prompt test still passes: the model simply
emits the digits, on every element, every time. The lesson is the same one the
`ok` derivation taught — *a model-authored string cannot be relied on to keep a
format*, so the constraint has to live where the string is consumed, not where it
is produced.

So `_locate` (the single function all four ref-taking methods route through)
falls back to a suffix match and resolves the bare nodeId. The interesting part
is the refusal: a `nodeId` is unique only within its frame, so `42` can name a
real element in two frames at once, and picking one would click the wrong
control and record `ok: true` — the exact conflation the `(coords, reason)`
split exists to prevent. It refuses and names both refs so the model can recover
on the next step. A number the page has never seen still fails identically; the
fallback is not a hole. Pinned by five cases in
`tests/test_grounding_outcome.py`, one per ref-taking method plus the
hallucination and exact-match shapes.

**The measurement is the audit, not a probe script.** Rung two of the ladder:
the record already exists and every run already writes it. A future
grounding failure is now countable in `logs/sessions/*.json` by counting
`ok: false` actions. The one thing it still cannot see is the validity failure
in the second bullet, and that needs a different check — did the click land on
the element the model *meant* — which needs a name to compare against and so
comes back to `find_element`, the one verb that does have free text.

**What this does to 1A′.** The workstream was justified as "replace name-based
action objects with target selection, because Action Object hallucinates at
34.0% and we are doing Action Object." The premise is wrong: we were already
doing the 2–3% thing, and the measured cost of it is zero. The remaining
questions under 1A′ are real but different — is a *validity* failure rate
measurably non-zero, and is `find_element` the right shape for the case where
it is. That is a measurement before it is a schema change, and it is not
picked from a benchmark table.

### Ten clicks, four attempts, zero changes — the same disease, one layer down

Session `a7328461` (2026-10-08, 27 turns, cancelled): "go to my github … add
branch protection rules". The agent reached GitHub's *new branch protection
rule* form and clicked **Create** ten times across four attempts — steps 4–5,
9–12, 16–18, 21–24. Every ref resolved. Every click was audited `ok: true`.
The URL never changed. `ax_targets` froze at 127 for steps 20–26, and the
127→132 delta at steps 4 and 10–12 was the *checkbox* expanding, not Create.

Every layer that could have reported this was reporting success. This is the
grounding bug above, not fixed — it is that bug's **next layer**: a ref that
resolves perfectly to an element that cannot be clicked. The two-state
`(coords, reason)` split assumed resolution was the interesting question. It is
not; resolution is necessary and nowhere near sufficient.

**Geometry handed out coordinates for elements that are not clickable.**
`getClientRects().length === 0` is a `display:none` check, not a visibility
check. An element scrolled past the fold still has client rects — its `y` is
simply past the bottom of the window. So `boxMap` emitted a centre for Create,
the relay dispatched a click at a point that is over nothing, and dispatch is
the only thing any layer knows how to report. Ten times.

The fix is to test the *point*, not the element, and to do it where the
coordinates are minted. `BOX_WALK` runs in the page's own realm over the batch
it was already walking, so this was free:

```js
if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
  out.push({ blocked: "off-screen" });  continue;
}
const hit = document.elementFromPoint(x, y);
if (hit !== el && !el.contains(hit)) { out.push({ blocked: "occluded" }); continue; }
out.push({ x: x, y: y });
```

Two tests, cheapest first — the viewport clamp is the common case on a long
page and `elementFromPoint` is the expensive one. The `contains` direction is
the one that matters: a point landing on a child **is** a hit on the parent
(refusing there would refuse every icon inside every button on the page), and a
point landing on an **ancestor** is not — which is why the reverse test is
absent. The result is a third map, `blocked`, alongside `boxes`: a target with a
reason and no coordinates, which is a state that could not previously be
expressed.

**The `DOM.getBoxModel` fallback would have put the bug back.** It runs exactly
when the bulk walk fails — shadow roots, cross-frame ids, a tab mid-navigation
— which is the branch that matters most, and it returned the unclamped quad.
It now reads `Page.getLayoutMetrics` **lazily**, only when `uncovered.length`,
so a fully-covered observation still costs three calls. No hit test on that
path: it covers nodes the page-side walk could not reach *by element path*, and
a second snippet to catch the rarer occlusion there is not worth the surface.
Off-screen is the one that costs the run its steps.

**Three markers, and one of them had never rendered.** `ax_filter` accepted a
`viewport_coords` argument, honoured it, and **no caller has ever passed one** —
so `[off-screen]` had never once appeared on a real run while the code that
would draw it sat there looking finished. That is the `canonical_step` failure
CLAUDE.md documents for the panel, repeated in the tree renderer: a parameter
nothing sends is a dead door, and it is invisible in review because every line
around it is correct. The parameter is deleted, not implemented; the extension
knows the viewport and hit-tests against it, so it ships the verdict per target
instead. `test_an_unmarked_hypothetical_parameter_is_gone` asserts the signature
so it cannot be reintroduced.

**A refusal the model cannot act on reproduces the loop it replaced.** Each of
the three states wants a *different* next action — scroll, dismiss, fix the
form — and `off-screen` sent to a covered control spends a step to learn that
scrolling changed nothing. `_locate` checks `disabled` **first** (no amount of
scrolling changes a disabled button, so the answer that costs the model nothing
must win), then `occluded`, then `off-screen`, and each sentence names what to
do. A blocked target stops `type_text` too, not just `click` — an occluded
field would otherwise take the text.

**The prompt had to learn two new words.** `[off-screen]` was already described
as "scroll to reveal them", so that one was covered by luck; `[covered]` and
`[disabled]` were new vocabulary, and a marker the model has no action for is a
marker it will click anyway. `SYSTEM_PROMPT` now has one section covering all
three, and states the part that used to be false — that clicking one *is*
refused before anything is sent.

**What the audit could not see, and now can.** The audit stores no tree, no
coordinates and no page text — `User data` is not ours, and a field carrying
any of them is ~200KB of the user's document per page. That is why this failure
was not *proven* from the session file: ten `ok: true` clicks and a frozen
target count is a strong shape, but "the Create button was past the fold" was
an inference from the form being long. **The fix does not reopen that.** It
needs no new persisted field: the refusal sentence is in `outcome`, so a
blocked control is countable in `logs/sessions/` by grepping for `off-screen`
in an action outcome. The observability came from making the failure say what it
is, not from recording more about the user's page.

Also fixed in the same pass: `find_element("Add rule or save button")` returned
`[0:17715] button 'Open agents panel'` — **Brotto's own UI, on a GitHub page**.
It matched on the single word "add" out of five, with stopwords not filtered
and no requirement that the meaningful words all match. It now requires every
non-stopword to match, and its not-found message names the recovery rather than
returning `Found:`.

Pinned by `scripts/test-observation-geometry.test.js` (the walk, the occlusion
directions, the fallback clamp) and `scripts/test-observation-surfaces.test.js`
(the wiring: a blocked target gets the reason, no coordinates, and no per-node
call to put one back), plus `tests/test_grounding_outcome.py` (the refusals)
and `tests/test_ax_filter.py` (the markers). Every case was run against the
pre-fix source first. **Not verified in a browser** — whether GitHub's Create
button was in fact off-screen is inferred from the form, not observed.

### The model could not press a key

A 19-step HDFC UPI run burned 158s and ~19 model calls without executing a single
search. Gmail's search box commits on Enter and there was **no way to press
it**. Three defects compounded, and only the first is visible in a diff of the
action layer:

- **No `press_key` action.** The extension already implemented the dispatch —
  `background.ts` reads `t === "key"` — and nothing constructed it. Dead code,
  and `ActionCall` had no such `Literal`. `press_key(key, modifiers)` now exists
  on both relays.
- **`modifiers` was dropped in the key handler.** The relay sent
  `{type:"key", key:"a", modifiers:2}` and the extension read only
  `action.key`, so `clear_ref` dispatched a bare `"a"` and **typed a letter into
  the field instead of clearing it**. That is why the model saw its own query
  still sitting in the box and misread the stall as an unrun search.
- **`scroll` read `amount_px` while the model sends `amount`**, so every scroll
  silently became 300px. A param name mismatch in the wrong direction is
  invisible: the action succeeds and does something plausible.

**Ruled out, because it looked like the cause:** the `[redacted:password]` on
those same args in the audit. Redaction happens at audit-write time
(`harness.py` → `_scrubbed`); `_execute_action` receives the original
call. It is over-redaction of a search box, not the bug — the second symptom
that reads like a cause.

The prompt now documents the semantics: `type_text` only *inserts*, so follow
it with `press_key Enter`, or use `navigate`, **which had already worked at step
2** of the same run.

Pinned by `scripts/test-key-dispatch.test.js`, which extracts the branch and
evals it. A dropped field is an *absence*, and an absence reads clean in
review.

### Select-all is not a keyboard shortcut

The ruleset name field ended up holding `Protect mainmainProteProtect mainProtect mainct ma`
and the agent could not clear it. `clear_ref` sent `Ctrl+A`, which is select-all on Windows
and Linux and **"move to line start" on macOS** — so the field kept its text, `type_text`
appended to it, and the model's only remaining move was `End` + `Backspace`, one character
per step, for ten steps. `press_key` could not rescue it either: `_PRESSABLE_KEYS` has no
letters, so `{"key": "a", "modifiers": …}` was refused as a key the client cannot dispatch.

A modified letter is therefore allowed, and `modifiers` is masked to `0xF` — **before** the
guard, not after. The ordering is the whole correctness of the mask: applied afterwards,
`press_key("a", 4096)` satisfies `bare_letter and modifiers` on the truthy 4096 and is then
dispatched with the modifier stripped, which is a bare `"a"` typing into the field — the
exact outcome the guard exists to prevent. The failure is quiet from the caller's side and
expensive: `_send_action` then waits the full observation timeout for a post-action frame
that a keystroke never produces.

`clear_ref` now selects through the DOM: `el.select()`, or a Range over `el` when it is a
`contenteditable`. Both relays share one constant, `SELECT_ALL_JS` in `relay.py`, so dev
and product cannot drift.

**The tempting fix is wrong.** `sys.platform` in the relay, or `navigator.platform` in the
extension, would each be correct on the machine you tested on and wrong everywhere else —
and the extension is talking to a user's laptop, not to the server, so the server has no
business deciding what that keyboard wants. There is no cross-platform chord for select-all;
the DOM has the operation without one. `scripts/test-select-all.test.js` runs the constant
against a fake DOM and asserts **no keyboard token appears anywhere in the script**, which
is the regression that would otherwise return quietly.

A letter is now accepted by `press_key` when a modifier is present, and refused bare — a
bare letter is `type_text`'s job, a modified one is a shortcut.

**`type_text` replaces the field; it always did.** The prompt said so in one place and
`only inserts characters` in another, and the second reading is what sends the model down
the Backspace path.

## Mid-task steering

The only way to redirect a running task was Stop, which discards the transcript. Now the composer stays live while `executing`: it posts `{"type":"steer"}` and the correction lands on the next turn.

Three design points that are load-bearing, not incidental:

- **`deps.steering` is a plain slot, not a queue.** Every approval site does a bare `await deps.human_input_queue.get()` and branches on the string, so a steer landing in that queue would be read as a *deny*, and one arriving during an approval would be consumed as the answer to it. A slot also gives last-write-wins for free — "actually, Wednesday" supersedes "Tuesday" instead of both reaching the model with the stale one read last.
- **The drain is immediately above `AgentTurn(...)`, not at the loop top.** The policy block above it `return`s and the login guardrail `continue`s, so a drain placed earlier would read a message and then drop the step holding it. And the drain clears as it copies — a copy without a clear replays the same correction every step, so the model never converges past step 1.
- **The prompt block goes last, immediately before the question.** The AX tree above is thousands of tokens; a correction placed earlier gets read past. `prompt.py` already told the model to treat mid-task messages as live corrections, so no prompt change was needed.

The `paused` phase is excluded in the panel: a prompt is outstanding then, and the same composer box answers it.

## Convergence

What the agent sees each step is only half of what decides the step count. The other half is `prompt.py`'s `<convergence>` section, added after a live run took **17 steps to conclude something the agent already had at step 5** ("no issues assigned to you"). It then visited five repositories to confirm an answer the assigned-to-me view had already given, and retyped one search query four times.

Three gaps caused it, all of them assumptions the prompt did not state:

- **A negative result was not modelled as an answer.** "Issues assigned to me with no comment" is answered by "there are none" — but an empty list read as *failed to find*, which licensed widening the search. `<convergence>` states that a well-established "none exist" is a complete answer, confirmed at the level the task actually asked about, and that a third cross-check is unresolved doubt rather than diligence.
- **Retry-with-a-tweak looked like progress.** Four rewrites of one query are one approach, not four. The rule is now: a rejected input gets one differently-worded retry, then it is a finding about the site.
- **The stagnation note pushed the wrong way.** It said *"try a completely different approach or call cannot_complete now"*, so a model that had already established "none" was being told the only two exits were more variation or failure. It now offers the third: report what you have, because a well-established empty result is a complete answer.

There is also a per-navigation gate in `<how_to_think>`: *do I already have an answer, and what specific evidence will this step add?* A step that cannot name its evidence in one sentence does not navigate.

### The agent was asking the user what it could go and look up

A live run of *"go to my github and add branch protection"* spent four round trips on
two questions — *which repository is yours?* and *are you signed in?* — both of which
are rendered on the page it was already looking at. It asked them again after the user
had restated the instruction, then sat waiting. The user-visible cost is not the seconds;
it is that every question is a person coming back to the panel.

Three separate instructions were pushing the same way, and each was individually
defensible:

- `policy_preamble`: *"When uncertain about user intent, prefer `ask_human`. Never invent
  or assume."* — correct about irreversible actions, wrong about **facts**.
- `<prompt_injection_defense>`: *"When in doubt, emit `ask_human`. False-positive prompts
  are cheap. False-negative approvals are not."* — an accounting error, because in this
  loop an approval is not free: it is a round trip plus a card the user has to read.
- `<how_to_think>` said nothing about who the work belongs to, so the default was to hand
  ambiguity back.

`<how_to_think>` now carries **"You are the user, at speed"** — a shadow framing, a
"look before you ask" rule (anything observable on the page is not a question), "have an
opinion" (an instruction with an obvious first move does not need the goal spelled out),
and an explicit bar for `ask_human`: **out of options, or a fork where a wrong guess does
real damage**. Everything else is carried. The preamble and injection-defense lines were
rewritten to agree rather than push back — a prompt that contradicts itself resolves
unpredictably, and the injection section now reads that section as governing *trust*, not
interruption frequency, since the irreversible-action card is mechanical anyway.

### Asking less must not delete *how* to ask

The fix above ran, and the next live run died at step 3 with `invalid_decision` —
and the audit's `errors[]` carried the model saying, in full:

> *"I notice the tool harness is returning a JSON validation error on my replies. Let me
> respond again in plain text without trying to use the agent action format, since I need
> clarification from you first. I'm currently unable to proceed because: 1. I'm signed out of
> GitHub."*

It wanted to ask. It wrote the question as **prose** instead of calling `ask_human`, prose
is not valid tool-call JSON, and three retries produced the same prose.

**The prompt had never said prose is not an option.** The only warning was about literal
newlines *inside the summary string* — a different failure with the same consequence.
Nothing stated that the reply has exactly one shape.

The uncomfortable part is the cause. Token counts prove the edit was live
(`tokens_in` 12537 → 13141, the size of what was added), and the two lines this change
**deleted** were the only instructions that said to use `ask_human` at all:

> `When in doubt, emit ask_human and let the user decide.`
> `When uncertain about user intent, prefer ask_human. Never invent or assume.`

So the change rationed *how often* to ask by removing *how* to ask, and the run found the
gap. Reducing a behaviour and removing the mechanism are not the same edit — when a prompt
change makes an action rarer, check that the action is still *reachable*.

`<output_format>` now opens by naming the one valid shape, says prose is a malformed reply
rather than a question, and routes each intent to its call: a question is `ask_human`, a
finish is `task_complete`, anything else is one sentence of `thought` and keep working. Both
directions are tool calls, so there is no path that ends in prose — including the dangerous
one, where a model told to ask less settles for narrating its hesitation instead of acting.

This is the same disease `_require_actions` was added for: pydantic-ai hands the model its
own schema error as the retry prompt, and a model that does not understand the complaint
repeats it. There it was reachable, because a validator could re-ask with an instruction.
Here prose never parses, so nothing downstream can intervene — the prompt is the only place.

### "My" is a session, not a search term

The same run also misread the task itself. *"Go to **my** github and add branch protection"*
went to `github.com/search?q=brotto`, which returns every public repository with that name
on the internet. The model then stalled on "which one is yours" — a question the site had
already answered — and concluded the user was signed out.

A possessive in a task names a **session**. GitHub, Drive, a bank, an inbox all render
who is signed in in the page chrome: the avatar, the profile link, the workspace name.
`<navigation_and_exploration>` now resolves the owner *first* — go to the site, read the
identity out of the chrome, then go to that account's own list (`?tab=repositories`,
"My Drive") and look there. Site-wide search is the fallback for when there really is no
session, and that is the one case worth a single `ask_human`.

Search-first is not merely slower here. It is *unanswerable*: ten identically-named public
repos contain no information about which one is the user's, so the agent cannot converge,
and every further step spends money re-reading the same ambiguous list.

### The page you were already on was a prompt

That run also opened with *"Allow Brotto to work on google.com?"* before Brotto had done
anything. `visited_domains` was seeded from `_seed_granted_domains` — **grants the user
made on previous runs** — and nothing put the page the user was looking at when they
wrote the task into it. So the one prompt with only one possible answer was also the one
guaranteed to fire first.

`_seed_starting_domain` runs once before the step loop and adds `etld1(current_url)` to
that same set. It is deliberately the *same* set every gate already reads, so it silences
exactly one prompt: a cross-domain click, a blacklist hit, an `aria-hidden` target and an
irreversible action are untouched, and the first hop **off** the starting page still asks.
It does not write a standing grant, so it does not launder the page into a permission that
outlives the run.

**`CRITICAL_PATTERNS` was deliberately left alone.** `confirm`, `approve` and `reject`
are matched against `f"{action} {action_args}"` — the model's own description text — so a
routine click described as "Confirm branch protection" can fire a card. That is a real
over-firing risk and it did not appear in this run. Whether it does is measurable: the
`policies` rows with `kind: "critical_action"` in `logs/sessions/`. Loosen it on evidence,
not on a vibe.

### A step's page has to be a frame we asked for

The agent clicked GitHub's "Set target branch" three times and never saw one branch. Every
action recorded `ok: true`, and the reason it went nowhere is visible in one column of the
audit — steps 10 through 13, `ax_targets: 151` and `page_text_chars: 3244` at every one.
**Byte-identical.** Not a stale rendering of a changed page; the same page four times.

The correlate is in the timings. Per-step `observe` alternates **3.0s / 0.001s**, and the
1ms steps are exactly the ones that got a free frame. `ExtensionCDPRelay._send_action`
drains the post-action observation, but `webNavigation.onCommitted` *also* pushes one on
its own, and `_get_observation` took whatever was on the queue without asking whether the
server had requested it. So a push fired the instant a navigation committed — before the
popover had rendered — became the next step's accessibility tree. The model was shown the
page *before* the thing it had just clicked opened, and told `ok`.

`sendObservation` now tags every frame with why it was sent — `observe`, `action`, or
`navigated` — and `_get_observation` / `_send_action` skip `navigated` frames, stashing
them in `_pushed_obs` for `_ensure_fresh_obs`, which is the one caller they are good for:
the URL moved, which they know reliably.

**An absent `reason` is not treated as unsolicited.** An extension predating the field
sends none, and skipping untagged frames makes every step request an observation, discard
it, and request again — forever, with no timeout to stop it, because the extension keeps
answering. Only an extension that positively says `navigated` is trusted to mean it. The
frame is unwrapped *before* the reason is checked, too: an `observation_error` carries no
reason, and checking first would swallow it and hang the step instead of reporting a lost
tab.

**Parking a push is not enough on its own — it has to be half-remembered.** `_pushed_obs`
outlives the fresh frame that follows it, so `_ensure_fresh_obs` installs the parked push
*whole* whenever it later finds the queue empty. That reinstates the exact bug through the
URL path: `_locate` resolves refs off `_cached_obs`, so one `get_current_url` between two
steps would hand the model the page it had already moved past. `_absorb` is the split — an
unsolicited frame contributes its `url` and `title` and **not** its `axTargets`, because a
commit tells you the URL moved and tells you nothing about the page it moved to.
(`tests/test_observation_staleness.py` pins it by stashing a push, taking a real
observation, then calling `_ensure_fresh_obs` with an empty queue: the URL follows the
navigation and the tree does not.)

**The 30s ceiling covers the skipping, not each read.** Both loops re-arm `wait_for(30)`
per iteration, so a page that navigates in a loop — each commit pushing another `navigated`
frame — restarts the budget on every one and never expires. The wait would be bounded only
by how long a page the model never chose to open kept going. One `_OBSERVATION_TIMEOUT`
deadline is taken before the loop. The regression is easy to write a test for and easy to
write a test that *passes* for the wrong reason: a flood faster than the read timeout just
exhausts itself. It has to arrive **slower** than the read timeout, which is the shape that
loops.

Shortening the budget inside that test is itself a trap. `test_failure_modes.py` purges
every `brotto_orchestrator*` entry from `sys.modules` mid-session, so by the time this test
runs a fresh `import` binds a *second* copy of the module and `sys.modules[cls.__module__]`
returns that copy — neither is the dict the function actually reads, and only
`fn.__globals__` is. The symptom is a test that passes alone and fails in the full run,
which reads as flake and is not; chase it rather than retry it.

**The diff was not the missing piece.** `compute_ax_diff` has always run and
`### What changed after last action` has always been spliced into the prompt
(`harness.py:500`). On those steps it said `(no changes detected)` — correctly, because a
stale tree genuinely has nothing new in it. The model was told, in plain text, that its
click changed nothing, and clicked again. That is the same failure as not being told; a
correct signal that gets ignored needs the underlying fault fixed, not a louder signal.

Note what this does *not* fix: a click that opens a menu still costs a step to learn it
did. The post-action frame arrives after the model has already decided, so the diff is
computed at the top of the *next* step and cannot collapse the two. What it fixes is the
model clicking a toggle three times, open-shut-open, against a menu it could not see.

### Stagnation detection — removed, not fixed

`check_stagnation` is gone, along with `StepSummary.state`, the harness's
`stagnation_warning` message and the note it injected into the model's context.
It fired falsely on two live tasks that both went on to succeed, and it is worth
recording why, because **the fix that preceded the removal was a wrong
primitive, and a correct one would not have saved it.**

The rule was "same URL for 3 steps". The first fix hashed the page instead of
the URL — `blake2b` of the filtered AX tree plus page text, in `StepSummary.state`
— which was correct as far as it went: `ax_filter` renders `value="..."`, CDP
puts an input's current text there, so the hash moved on a keystroke, and the
Google "bermuda" false positive went away.

Then a run on `news.google.com` reported *"stuck for 3 consecutive steps"* again.
The fingerprint was not moving, and the reason is that **both of its inputs are
prefixes**:

- `page_text` is `innerText.slice(0, PAGE_TEXT_MAX)`.
- `filtered_ax` dropped the tail when over budget (`ax_filter.py`). *At the time it
  was tree order* — the drop was by position, not by what was on screen. Ranked
  selection changed that in 2026-10-01 (see the ceiling section below), which is
  part of why the detector could not have been rescued by tuning: the two inputs it
  hashed were both prefixes, and one of them no longer is.

On an infinite feed, new articles land *later* in the tree. The retained prefix
is byte-identical, so the hash is identical. This is not a threshold problem and
not specific to Google News — the detector is structurally blind to everything
below the cut, which is most of any long page.

**The deeper argument is that the warning was never earning its keep.** It is a
hint, not a safety net — `MAX_STEPS` is the net. The run that motivated
adding it (17 steps to conclude something the agent had at step 5) was actually
fixed by the `<convergence>` prompt work above, not by the detector. Meanwhile
its two observed effects were both harmful: it pushed a working agent toward
reporting early, and it showed the user a warning during a task that succeeded.
"Stuck" is not separable from "working on a slow-loading page" by hashing the
top of a DOM.

What replaced it is nothing. The model still self-assesses in
`<stagnation_and_failure>` — same URL, same action twice, three failed
approaches — which is the part that was always sound, because the model can see
its own step history. Only the harness's external verdict is gone.

**The external literature agrees, which is a relief and a caution.** Redundancy
is defined there as *valid actions that produce no state change* — literally
the fingerprint we removed, hash and all. But it is reported as an **offline
metric over recorded runs**, never as a runtime detector, and the prescribed
remedy for a redundant run is **replanning**, not detection. Nobody ships a
runtime stuck-detector, because "this step changed nothing" and "this step is
loading" are not separable without a model in the loop — and a model in the
loop is just the model self-assessing, which is what `<convergence>` already
does. The removal was correct; if stagnation comes back, it should arrive as
a replan prompt fed by a recorded metric, not as a hash.

`testing/outcome.py` keeps its `"stagnat"` needle on purpose: it classifies
*recorded* runs, and the runs recorded before this removal still contain those
strings.

### No step limit — `MAX_STEPS` is a runaway backstop

The user is **not** bounded on how long a session runs. `MAX_STEPS` was 30, and
it reported `Max steps reached` on tasks that were still working — the one
thing a user must never be told, because a user reads it as "your task was too
big", not "the loop is spinning".

It is now 150, and the terminal result says what it actually means:
`failure_reason="runaway_backstop"`, `summary="Stopped after 150 steps without
finishing"`. The string `max_steps_exceeded` appears nowhere in `harness.py`,
and a test asserts that.

**What actually keeps the context bounded is the three age-scaled blocks, not a
turn ceiling.** Claude Code's compaction is the reference: its breakers are
*three consecutive compaction failures* and *three rapid refills within three
turns* — never a turn count — and its full compact is transcript surgery on a
growing message array. This harness is stateless per step, so it already *has*
the compression (windowed `<conversation>`, windowed step summaries, decaying AX
budget) and was missing only a bound. The failure mode at high step counts is
**silent amnesia, not overflow**, and amnesia is what `recall_steps` and
`recall_conversation` now address directly.

Note the parallel to the stagnation removal above: a *detector* that guesses
"this run is going nowhere" is unreliable, and its false positives cost more
than the runaway it catches. The backstop reports nothing until it fires.

### A cost ceiling, and what it may read

`model/pricing.py` was built and correct with no caller. It now has one, and
the number it produces lands in three places: `turns[].model.cost_usd`,
`totals.cost_usd`, and `TaskResult.cost_usd` — which is the one the panel
renders under the Timing block.

**The cost is priced from the catalog, never from `RunUsage.cost`.**
pydantic-ai has no cost calculation for `AnthropicModel` at all, so on Claude
and MiniMax that field stays `0` — a total read off it is a confidently wrong
`$0.00` for a run the user was billed for. This is also why an **unpriced
model writes no key at all** rather than `0.0`: a budget cap is the consumer
of this field, and a cap that cannot see a missing number spends exactly what
it was set to bound. `_catalog_for()` reads `deps._model_config` rather than
calling `_resolve_model`, because `_plan_step` sets that attribute only on the
branch that builds a real provider model — the scripted/test path has nothing
to bill, and calling the resolver there raises on a run that has no model to
raise about.

`BROTTO_MAX_TASK_COST_USD` is **unset by default**, and that is a decision
rather than an omission: Brotto is self-hosted, the key is the user's, and the
money is the user's own — so a default cap would spend their tokens for them.
A non-positive or unparseable value logs a warning and arms nothing; a `$0.00`
cap would end every run at its first step with a plausible-looking reason.

**The ceiling is checked after `audit.record_model` and before the turn's
actions dispatch.** Anywhere earlier misses a step the user already paid for;
anywhere later has clicked half of an action the ceiling was set not to pay
for. When it fires the result is `status: "failed"`,
`failure_reason: "budget_exhausted"`, with the reached and ceiling amounts in
the summary — the same shape as `runaway_backstop`, and the failure path in
`sidepanel.js` needs no cost rendering because that summary already says it.

**Not verified in a browser.** The four tests in `tests/test_task_cost.py`
pin the audit shape and the cap's parse, not a run that actually crosses a
ceiling.

### A model that cannot decide fails the run

`agent.run(retries=_OUTPUT_RETRIES)`, now 3. When the model fails output
validation four times, pydantic-ai raises `UnexpectedModelBehavior` and
`str(exc)` is literally the string **`Exceeded maximum output retries (2)`**.

The `except` chain in `_plan_step` covered only `ScriptTargetUnresolved`,
`UserError` and `ModelHTTPError`, so this one propagated out of `run()`. Three
things were wrong at once: the three attempts were **discarded**, so the
document said `errors: []` while visibly broken; the document kept
`status: running` with an **open turn** (`ended_at: null`) and `audit.close()`
never ran, so a later reconnect would try to resume a dead run and the in-memory
trail that rewrites the file on every flush would leak; and the panel got a
bare message naming neither the model nor a fix.

`_plan_step` now takes the live `audit` and catches it, setting `deps.result`
through `_make_bad_decision_result` (`status: "failed"`,
`failure_reason: "invalid_decision"`, summary naming `provider:model` and
saying "Try a different model, or rephrase the task") and writing
`code: "invalid_decision"` into `errors[]` with the retry count, the step, and
`str(e)` — truncated to 500 chars, which is not the sensitive part. Returning
`None` makes the loop's existing abort gate pick the result up on the next
iteration, exactly as `auth_failed` and `model_not_found` already do.

**What the handler still cannot tell you is *why* validation failed** — the
raw model output is not in the document, and adding it is not free (it is
untrusted page-influenced text at volume). Two tests pin what is observable:
`test_an_undecidable_model_fails_the_run_instead_of_hanging` and
`test_plan_step_catches_it_and_records_why`.

**Recording `str(e)` records the wrapper and nothing else.** Reproduced
against the live model: `str(exc)` is `"Exceeded maximum output retries (2)"`
while the useful text is one `__cause__` down. `_failure_detail` walks the
chain (`Type: message <- Type: message`) and truncates at 500. That single
line is the difference between a diagnosable failure and a guess — see
"a model that omits `actions`" below, which is what it found.

#### A model that omits `actions` cannot be told twice

The dominant cause of that failure, measured on MiniMax-M3 against a Gmail
search-results prompt: **2 of 6 runs called `final_result` with `reasoning`
and `thought` and no `actions` key at all.** The two omitted-field cases
were byte-identical to each other, and so were the retry attempts that
followed — the model repeated the same omission three times.

The retry prompt pydantic-ai sends is the reason it repeated:
`[{'type': 'missing', 'loc': ('actions',), 'msg': 'Field required', ...}]`.
A schema diff, to a model that has already written prose and is deciding it
is finished. It is not wrong, and it is not actionable.

So `actions` now defaults to empty and an output validator
(`harness._require_actions`) raises `ModelRetry` with an instruction
instead — naming `task_complete` with a `summary` for the conclude case,
`ask_human` / `cannot_complete` for the blocked one, and the action it
meant for everything else. **Defaulting the field is load-bearing**: while
it was required, pydantic-ai rejected the tool call before any validator
could run, so the only retry prompt available was the one that does not
work.

The budget is unchanged, and that is the point: raising `ModelRetry` spends
one of the retries, so a model that ignores the instruction every time
still ends the run instead of spinning. What changed is what it is told.

The second, rarer mode is a response with no text and no tool call at all,
which pydantic-ai reports as `ToolRetryError: Please return text or include
your response in a tool call.` That one usually recovers on its own — it
appeared in 1 of 6 runs and the retry fixed it — and the same measurement
run had the model recover from the `actions` omission on its second attempt
too, which is why the instruction above has to be this explicit rather than
merely different.

#### The prompt asked for a shape that is illegal in a JSON string

The third cause, and the one that actually killed a run, is a **syntax** error
rather than a missing field — so nothing a validator can reach ever sees it.
Session `7cb14a63` (2026-10-02) died at step 7 of 8 on the run's final
`task_complete`:

```
UnexpectedModelBehavior: Exceeded maximum output retries (2)
  <- Invalid JSON: expected `,` or `]` at line 1 column 3301
     input_value='{"reasoning": "The JSON keeps failing validation, likely due to
       special characters or formatting in the summary field. ..."
```

The cause is in our own prompt. The "Writing the summary for `task_complete`"
section asks for a **multi-line markdown** answer — bullet lists, `**bold**`,
three labelled fact lines. `AgentDecision` is a structured-output model, so that
summary has to go out as a JSON **string value**, and a literal newline inside a
JSON string is a syntax error. The model did exactly what it was told.

The model's own retry reasoning named the cause correctly ("special characters
or formatting in the summary field") and it tried to simplify, which is the one
case where the raw pydantic retry prompt did reach it. It still failed, because
shortening a summary does not make newlines legal.

**The fix is the prompt, and it is a contract, not a hint.** The section now
states that the summary is a JSON string, that a raw line break inside it is not
valid JSON and loses the whole run, and names the escapes (`\\n`, `\\"`, `\\\\`).
Pinned by two tests in `test_model_text_escapes.py` that grep `SYSTEM_PROMPT` —
a dropped instruction is an absence and reads clean in review.

Two details that cost the first attempt. `SYSTEM_PROMPT` is a plain
triple-quoted string, so writing `\n` in the source put a **real newline** in
the prompt — the instruction told the model to escape newlines using a
newline. The source needs `\\n`. And the fix does not remove escaping, it moves
it: the model now reliably emits `\\n` (double-escaped), which parses and is
then undone by the existing `_unescape` at the `task_complete` handler. Probed
against live MiniMax-M3, three consecutive runs parse into a valid
`task_complete` with a full multi-line markdown summary that renders to 9–10
real newlines after `_unescape`.

**The budget went 2 → 3 retries** (`_OUTPUT_RETRIES`), and the two places that
report the count now derive from it rather than hardcoding "3 attempts", which
had already drifted from `retries=2`. 4 of 22 recorded sessions ended in
`invalid_decision`, the failure loses the entire run, and a retry is cheap here
because the stable prefix is cache-read.

**Not fixed, and it is the bigger one:** `ActionCall.action_args` is a bare
`dict`, so the output tool's JSON schema tells the model **nothing** about any
action's argument names or types. Every one is guesswork from prose in the
prompt. The same run guessed three ways: `recall_memory` as `{"id": "r2"}`
(against a handler reading `entry_id`), and `read_page_text` as
`max_chars: "3000"` (a string that reached the relay and raised `TypeError:
unsupported operand type(s) for //` in `text[:max_chars // 2]`). Two of the
three are patched at the symptom — `recall_memory` now accepts `id` the way
`recall_conversation` already accepted two spellings, and `_as_int` coerces the
numeric args. Typing `action_args` as a union discriminated on `action` is the
root fix, and it is a real change: ~30 call sites construct `ActionCall` with a
literal dict and two read `action_args["ref"]` by subscript.

**Not done:** cross-task memory. `Scratchpad` is per-task — persisted to
`logs/runs/<id>/` for resume within a task and gone otherwise, so
`github.com/<user>/issues/assigned` (the entry point discovered on that run) is
relearned every run. The obvious durable content is *where things live on a
site and which routes are dead*: a per-user JSON store in the shape of
`model/store.py`, injected at the top of every task. Unbuilt.
