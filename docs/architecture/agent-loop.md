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
`MiniMax-M3` is in `_THINKING_DISABLE_OK` under the `minimax` provider key
(`model/registry.py:46`), so `anthropic_thinking={"type": "disabled"}` is sent.
The allowlist is keyed by **provider id, not model id**, and it fails
asymmetrically: sending `disabled` to an always-adaptive model is a 400 on *every*
call, while omitting it costs only latency, so an unverified id falls on the
"send nothing" side. (`MiniMax-M3.1-Flash-Preview` is absent for exactly that
reason — it requires adaptive thinking, and `disabled` is a hard 400.)

This section originally
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

**…and it was being paid per CDP command rather than per user action.** The
extension sends a full `captureObservation` after *every* action, so a logical
user action cost its action count times a stability gate, an AX-tree walk and a
`Page.captureScreenshot`. `type_text` was the worst case in the action space:
`harness.py` called `focus_ref`, then `clear_ref`, then `type_text_to_ref`, and
**the first two each dispatched a `click` frame with the same coordinates and the
same `backendNodeId`, resolved by the same `_locate` against the same cached
observation**. The second click was byte-identical to the first, and was there
because each relay method had to be independently complete — not because the page
needed it. Three actions, three observations, two server-side evaluates, for one
keystroke. Session `3dab5bb6` records a `type_text` at **19,965ms** against a
~3.6s per-action floor; `445fc36d` has two higher still, at 27,058ms and
26,415ms.

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
front of you.** `SYSTEM_PROMPT` states it, and the entry for the page in front
of the model is marked `← THIS PAGE, already in your prompt — do not recall`
so the model does not have to infer it. The marker is **identity, not url**:
`_is_current_page` requires `source == "page"` (set in code at the capture site
and not reachable from an action's arguments — `read_page_text` takes `selector`
as an argument, so a model-writable field is not a sound basis for a factual
claim to the model), `step == current_step`, and `task_index == current_task`.
All three are needed and none suffices: `step` alone is satisfied by task 1's
step 4 during task 2, and url equality matches several entries after a reload,
an SPA route swap, or a site serving one path across a run — every one of them
would claim to be the current page. An entry
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
record now carries id/step/selector/around/digest/was_truncated/url/task_index/
source and not the body. **There is nowhere for the body to go** — the digests
are the whole persistence, and the sidecar that was meant to hold the bodies
has had no writer since the manifest replaced it. Bodies live on
`deps.scratchpad` for the length of the run and nowhere else; `docs/architecture/privacy.md`
has the disk-side record of that decision.

`_as_scratchpad` rebuilds the model from that dict, so it defaults `body` to
the digest — without it a resumed run loses its entire manifest rather than
keeping the digests. The sidecar header gained a trailing optional `url=`, and
the loader's regex makes that group optional so files written before `url`
existed keep parsing byte-identically; `*.scratchpad.txt` is still the file
current builds write.

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

**The manifest is windowed, and the window names what it dropped.** Uncapped
growth was fine while entries were nearly free; at ~70 tokens each they are not,
against an AX budget that *decays* by 30% by step 15. `_MANIFEST_WINDOW = 12`
keeps the head 3 and the tail N and renders the omitted ids as contiguous runs
(`r4–r19, r21–r31`). One run per unbroken stretch rather than a single
`r4–r31`, because `recall_memory` resolves *any* entry including ones the gap
would have covered — a kept entry sitting between the endpoints renders in the
manifest directly under a note saying it is gone. **Nothing is dropped from
`entries`**, only from the rendering: naming the ids is the whole point, since a
model told an entry is gone with no way to read it concludes it is unavailable.
The current page's entry survives the window even if it would not, because its
line carries the "do not recall" marker. The manifest header states the *real*
guarantee and only that one — `recall_memory(entry_id) returns the kept body` vs
`fetches full body` — conditionally, because a caveat on a live run would be a
false statement paid for in tokens on the step that can least afford them, and
`degraded` is read over *every* entry, not only the shown ones, since the gap
note promises an omitted entry is fetchable.

**Everything page-derived is now fenced, and the manifest was the last one
standing.** The prompt's `## Trust hierarchy` names `<step_history untrusted
outcomes-including-page-evaluated>`, `<step_note untrusted>`,
`<memory_manifest untrusted page-digests>`, `<memory_body untrusted>` and
`<ax_diff untrusted>`. The manifest was the interesting one: a digest is the
first 200 characters of page text *verbatim*, so unfenced it put
page-controlled text at the top of the prompt inside the one section that reads
as harness-authored inventory — exactly where an injection wants to sit. The AX
diff was the last unfenced page-derived block for the same reason. Fences are
not a parser guarantee either way; every renderer strips angle brackets from
the values it interpolates, because trusting `url`/`selector`/`digest` to be
delimiter-free is exactly the assumption that fails.

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

So the gate now **samples**, and the sample is a *rate*, not a pair of
absolute thresholds. It resolves at once with `early: true` when the mean gap
between mutations since `t0` is shorter than the quiet window — meaning a
silent window cannot happen and waiting for one only ends at the deadline. The
only constant in *this* exit is `RATE_SAMPLES = 3`, a floor on how much evidence
counts as a rate at all. Expected Gmail observation is 10.8s → ~1.4s. The
decision is not trusted — it is a *guess about the page*, and the guess is
checked below.

**`RATE_SAMPLES = 3` still misses the case its own comment names.** A page with
fewer than three mutations is not a rate, it is an anecdote, so the exit cannot
fire — which is deliberate, and is what keeps a slow loader from being called
busy. But the same floor is what the sparse case runs into from the other side.
A spreadsheet with a blinking cursor and an autosave mutates at gaps of roughly
1.7–3.3s, so its mean gap is under the 3s quiet window and the exit *can* fire
— but three samples have to exist before a mean means anything, and the third
one arrives at 7–9s of the 10s deadline. The exit therefore resolves a second
or three before the thing it exists to avoid, and on the page it was measured
on it saves almost nothing.

**Raising the sample count is not the fix either.** More samples makes the exit
later still, and fewer makes a sparse loader look busy — the one direction the
exit structurally cannot make safely. The sparse end is therefore closed by a
*second* exit rather than by moving this one: **two samples whose gap is shorter
than the quiet window, once the page has been churning continuously for
`CHURN_WINDOWS = 1.5` windows** (`extension.md`, `stability.ts`). A page that
has produced a change or two and then gone quiet is a *loading* page
(`auth-slowjs`), and the churn floor is what keeps it out — the fixture never
reaches 1.5 windows of continuous churn, so it still runs to the deadline
unsettled, for the right reason. The churn floor is measured from `t0` (how long
the page has been *watched* without ever going quiet), not from the first
mutation, because that is the part of the wait the exit exists to shorten. It
is a number of quiet windows, so it scales with the window the caller asked
for rather than with the default.

**Both exits are evaluated in the observer callback, at the moment a sample
arrives — not in the 50ms poll.** A sample is the only thing that can *start* a
rate, and a poll firing long after the last mutation would claim a page busy
on the strength of a change it has already forgotten. That is also why a single
mutation starts neither exit: the rate needs three samples before a mean means
anything, and the churn needs two before there is a gap between them.

**An absolute threshold here was one page's number wearing a universal claim.**
The first version of this exit was "3 mutations inside 1000ms", which Gmail's
41-per-10s clears with ~30% headroom — and which silently assumed any slower
page was a *loading* page. Google Sheets mutates 3–6 times per 10,002ms (gap
1.7–3.3s), so it is too slow to trip the busy sample and too fast to fall
silent for 3s: it satisfied neither heuristic and matched neither. A live
Sheets run then measured **177s over 8 steps, with 10 of 14 observations at the
full 10,002ms deadline** — against ~2s a call of model generation, so ~90% of
wall clock was observation latency, and each tree came from an arbitrary
mid-repaint instant. That measurement is what moved the rule from an absolute
pair to a rate-relative one; `extension.md` carries the gate-side mechanics and
the same Gmail calibration point.

**Misclassifying toward "busy" is the safe direction and cannot corrupt
anything.** The sample only ever resolves `waited: false`; it has no path to
`waited: true`, so it can never assert a page is still when it is not. The
caller rescans and compares fingerprints, and disagreement means the guess did
not hold. Misclassifying toward "quiet" is the dangerous direction and the
sample structurally cannot do it.

`Stability.early` marks a page the sample claimed, so `metrics` says which path
a given observation took.

### The short-circuit is a guess, so the rescans are the arbiter

The early exits are a claim about the page: *already mutating hard ⇒ past its
initial render ⇒ a silent window cannot happen, so waiting for one only ends at
the deadline.* It is a good claim and an untested one. `captureObservation`'s
rescan loop is what tests it — two full re-reads 800ms apart, comparing
`role|name|value` fingerprints and breaking at the first match. Agreement means
the guess held. Every scan differing means the page was still moving and the
short path read it early; the disagreement *is* the signal, and the response is
already in hand — what ships is the **last** scan, the freshest tree, not the
one the gate handed back.

The rescans were never a retry mechanism, which is what the surrounding code's
shape suggested. They were the empirical check on the early exits, and the
settling work they used to do was delegated to a second gate.

**There is one gate, and the rescan is its arbiter.** An earlier version had a
second one — a re-wait with the early exits disabled, for a page whose rescans
disagreed — and it bought nothing: its only reachable outcomes were a 3s
silence or the full 10s deadline, on a page whose silence was already
arithmetically unlikely, so it handed back a tree from an arbitrary mid-repaint
instant. It was also a second charge the log line never accounted for, because
`metrics.stability` is written from the first `waitForStable` alone. It is
gone, and `StableOpts.noEarly` remains in `stability.ts` — pinned by a test, no
caller passing it any more — because it is the gate's own API and deleting it
alongside its last use would have been a change nobody asked for.

**The accepted cost, stated plainly:** a page whose every rescan differs is now
read ~1.6s late rather than up to 10s late. It is still moving. The next step
re-observes — and a page still moving at capture time is not made settled by
waiting longer for it.

**What the gate now guarantees, and what it does not.** Two early exits, both in
the observer callback, both of which hand the caller `early: true` and neither
of which can report a page as quiet — a page the gate is unsure about is
reported as unsettled, never as settled. The 10s deadline is unchanged and is
still the backstop, and the quiet window is still the only thing *in the gate*
that can claim a page is still. The fingerprint rescan in `captureObservation`
remains the arbiter for every page an exit claimed, which is the whole reason
neither exit is trusted with the claim it makes.

**The sparse end is now closed, and the quiet end is still the unreachable
one.** The gate requires **zero** mutations for a continuous 3s, and a
spreadsheet's blinking cursor plus autosave never produces that — so the *quiet*
exit is unreachable on that page and the early exits are what remains. The rate
exit used to be late by the sample floor; the churn exit now takes a sparse
page at the *second* sample instead of the third, which is what the 8752ms
observation in the Sheets run was. What a rate tolerance would change is what a
captured observation guarantees, so it was held back rather than guessed at.
Reading this section as a solved canvas story is reading it wrong: the exit
exists, it fires on that page, and it fires well before the deadline.

`scripts/test-observation-rescan-guard.test.js` extracts `captureObservation`
and pins all four shapes, because a guard that silently stops firing hands the
model a half-rendered tree while every metric still reads healthy. An absence
reads clean in a diff; that is the whole reason it has a test.

**The exits are a miss that costs time, never accuracy.** That asymmetry is what
makes shipping a guess the right trade: a page wrongly called busy is rescanned
and re-tested, and only a page wrongly called *quiet* could hand the model a
half-rendered tree — which the structure of the exits makes impossible. The
absolute version was recalibratable from one run; the rate-relative version is
calibrated on no page in particular, which is why it needed the Sheets
measurement above to find rather than a tuning pass to guess. The metrics still
flow back to the server log.

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

### `timedOut` does not mean the deadline was hit, and the log cannot tell them apart

A recorded live run logged **`stability=7452ms unsettled`** — and `7452` is well
below `DEADLINE_MS = 10000`, which reads as impossible. It is not impossible, and
the reason is a naming problem worth writing down before someone else spends an
afternoon on it.

`waitForStable` derives the field as `timedOut: v?.quiet !== true`. That is
"**did not settle quietly**", not "reached the deadline". The rate exit resolves
`finish(false, true)` — `quiet: false`, `early: true` — **at whatever moment the
sample fires**, which on a fast page is well before the deadline. So `timedOut`
is `true` for an early exit exactly as it is for a real deadline, and the two are
one flag. `main.py` renders that flag as `unsettled`, which is why a sub-deadline
number carries a deadline-sounding label.

Three consequences, in descending order of how much they mislead:

- **`stability=…ms unsettled` does not mean the gate used its whole window.** A
  reader measuring the cost of the gate from that line will overestimate it by
  up to 10s per observation.
- **`Stability.early` is carried all the way to the metrics and is never
  rendered.** It is computed, sent, logged by `waitForStable` itself on the
  deadline-only path, and then dropped at the one place a human reads it. The
  `console.warn` inside `waitForStable` is the *only* output that
  distinguishes the two cases, and it fires only on `timedOut && !early`.
- **`unknown` is a third thing entirely** — `waited: false, timedOut: false`,
  which is the `catch` arm in `waitForStable`: the tab went away mid-observe and
  the evaluate rejected, so there was no answer to report. It is not an early
  exit and it is not a timeout.

**Not fixed.** The fix is to render `early` as its own word in the `main.py`
ternary, which is one branch; it was not done because it was found while
reading logs rather than while designing the metric. Until it is, the honest
reading of the line is *"the gate did not observe a full quiet window, and the
reason is not in this line."*


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

### When the page is a canvas, the fallback is a picture

`GAP_UNREACHABLE` above is the fixture that used to be a dead end: a canvas has
no AX node and no page text, so the loop handed the model an empty page and
called it a page. `_vision_fallback` (`harness.py`) is the narrow answer.

**The trigger is relevance to the task, not a count** (`_sparse_for_task`). The
narrowest reading — empty tree *and* blank page text — is the case the feature
was born for and the *rare* one: a Google Sheet comes back with forty real AX
nodes for the toolbar and the menu bar, so an empty-tree test never fires and
the page the task is actually about stays invisible. A count cannot be the bar
either, because 40 nodes for "fill in this spreadsheet" is as blind as 0 while
40 nodes for "click the search box" is plenty. What separates them is whether
anything the harness can see is *about this task* — a target named for it, or
page text that mentions it. Blank page text is still load-bearing (`(page_text
or "").strip()`, whitespace is blank) and so is `_PAGE_TEXT_ENOUGH`: past 400
characters the model has prose to read and the picture is a second, uncacheable
copy of something it already has.

**The task's leading verb is not evidence, and excluding it is positional.**
`not (words & seen)` fires on *zero* overlap, and UI chrome is named for the
same operations task instructions are: a Sheet has **Fill**, **Copy**,
**Paste**, **Undo**, **View**, so "fill in the spreadsheet with these values"
matched on `fill` and the page stopped firing. The predicate is about the task's
*subject*, and a verb in slot 0 of an instruction is the operation, never the
subject — so `_task_relevance_words` drops the word at position 0. That is a
**position test, not a list**: `_TASK_STOPWORDS` cannot do this job, because
every collision arrives as a new toolbar verb and each entry the list gains is
a word some real page already uses. A count ("one overlap is not enough") was
rejected for the same reason — it is the same vocabulary test with a softer
edge, and it still misfires on the second accidental overlap. Only slot 0 is
dropped and only when it is a content word, so "what is the revenue in the
spreadsheet" keeps every word; the asymmetry is deliberate, since a false drop
costs money (a picture) while a missed drop costs the task.

**The model cannot be the one to ask.** Making the screenshot an explicit
action the model requests was considered and rejected, and the reason is the
failure mode, not the cost. A model can only ask for a picture if it knows it
cannot see — and the case this exists for is a page that *looks fine*: forty
toolbar buttons is a rich page, and the grid missing out of it is an absence,
the one thing a model reading a tree does not register. An ask fires on
`<canvas>` (an empty tree is glaring) and not on a Sheet. It also costs a
whole step, because the ask is a decision and the capture is a later step,
where the heuristic puts the image in the *same* step beside the tree so the
model's next judgement already has both. And D5 — model self-report is not
evidence — points the same way: the self-report is exactly what cannot be
trusted here, and it is the ask design's only input.

**Cost is bounded explicitly, not by making the decision rarer.**
`_MAX_CAPTURES_PER_TASK = 3`, counted on a field on `AgentDeps`, which is what
makes it **per task**. The `deps.screenshots_taken = 0` line in `run()` that
once reset it there is gone: its premise was that a resume moves to the next
task, and `resume_from` is never passed by any caller. `resume=True` reopens
the same document under the same `task_id` and continues the *same* task, so the
old reset bought nothing and the counter was per run in practice — a client that
reconnected could buy a fresh budget of three images on every reconnect, which
is the opposite of what a per-task cap is for. It is checked *before* the
capture, so a run past the cap pays no round trip. Reuse across steps was
rejected because a picture of a page the model has left is evidence it did not
observe, and "only re-capture when stale" needs a staleness heuristic of exactly
the kind being removed. Three is the step that lands, the step that acts, and
one re-look. Past the cap `needed` stays `True` and the ordinary refusal note
rides, so a bounded run reads as "unseen", never as a blank page.

**That counter is now two, and the split is the point** — see "The three-pictures
rule inverts on a canvas page" below, which is why the paragraph above now
stands as the reasoning for the *ordinary* page only.

**Resolve capability before capturing.** `_vision_capability` reads
`model/capabilities.py` and caches the answer on `deps._vision_caps` — **once
per run, never on the loop**, because the model cannot change mid-task and the
loop's hot path should not pay a metadata round trip. It goes through
`warm_async`, never `resolve(..., allow_network=True)`: the network tiers are a
4s call and a real probe request. The order matters — a capture is ~270–700 KB
on the wire, so capturing first and discarding afterwards is the expensive
order. The scripted/test paths short-circuit to "needed, no model" so `/run` and
every harness test never reach for a frame the fake relay cannot answer.

**A catalogue `vision=False` means *not documented*, not *cannot see*.** So
only `True` short-circuits; `False` and `None` both fall through, and the
resolver's probe can still earn a real `False`. Unknown therefore arrives as
**unresolved, which is not a denial** — the run proceeds to a refusal rather
than to a stop. The two are rendered differently on purpose: `False` is a fact
about the model, `None` is our own ignorance and is not the user's fault.

**The image rides as a real `BinaryContent` part, image last.**
`_turn_to_input` returns a list, not a string: `[prompt, screenshot_note,
BinaryImage(…)]`. The harness-authored trust note is its **own part immediately
before the image**, and the image is **last**, so nothing page-derived can
follow the trust statement — the nearest neighbour of a boundary has to be the
thing being bounded. Putting the note in the prompt body left it thousands of
tokens away with the question as its neighbour, which is the shape the AX
envelope avoids by being welded to the tree it wraps. An image carries no
wrapper and no delimiters at all: it is pixels, so there is nothing to bracket.

**With no image, the note is still delivered.** A refused or failed capture
arrives as `screenshot=""` plus a non-empty `screenshot_note`, and the same
`_turn_to_input` returns `[prompt, note]` — the note is the last part, the
image-last rule holds vacuously, and a turn with *neither* is an ordinary turn
and stays a bare `str`. This was a real regression, not a hypothetical: the
no-image branch returned the bare prompt, so the refusal note never reached the
model and a refused capture read as a silently blank page — the task failed for
a reason nothing stated. Asserting on `_VisionFallback.note` could not catch it,
because that is the level at which the note is always present; the tests assert
on the rendered input, including one driven through the loop.

**The prompt was telling the model to do the opposite of this feature.** The
`<how_to_think>` section that owns the empty-page case read, on a canvas or a
spreadsheet: check `read_page_text("body")`, and if that is empty too, the
control is not in anything you can read — *say so and ask the user how to
proceed.* So on exactly the pages `_vision_fallback` exists to rescue, the
prompt instructed the model to give up on its own evidence and spend a human
turn. A picture arriving with the turn was not mentioned at all. The feature
was correct and the instruction contradicted it.

`<how_to_think>` now states four things, and each is a rule the harness
enforces rather than one the model is trusted to infer:

- **A picture is sent for one reason only** — nothing in the tree or the page
  text is about the task, i.e. `_sparse_for_task`. The model does not need to
  re-derive the trigger, and a model-invented one would fire on every page.
- **It is capped** — three per task on an ordinary page, and the canvas
  ceiling on a canvas page, where the picture comes with every step. Stating
  it means a model that reads the
  absence correctly does not spend a turn asking why there is no picture.
- **A turn without a picture is not evidence of a blank page.** This is the
  sentence the old prompt got backwards: past the cap the page is merely
  unseen, and `needed` stays true with the ordinary refusal note so a bounded
  run reads as "unseen" rather than empty.
- **The AX tree outranks the picture where they disagree.** A canvas can be
  mid-render, and pixels show a *rendering* state rather than the semantic
  state the model is about to act on. This is the same distinction the
  geometry walk rests on, arriving where a model will actually read it, and it
  is why the picture is a supplement and never an override.

The give-up-and-ask instruction survives, narrowed to the case where **no
picture came with the turn**. It was not deleted; it was moved off the case a
picture already answers.

**The log line is not the trigger.** `harness.py:5006` logs `screenshot
attached (%d B base64)` on the capture path, which reads as "every step gets a
picture". That line predates the trigger being narrowed to `_sparse_for_task`;
a step that does not log it is normal and says nothing about the page.

**The base64 is transit only.** It goes on the turn, into the prompt, to the
provider. Not the audit document, not a step summary, not a log line — the one
log carries a byte count and nothing else. Redaction does not apply to it (see
`privacy.md`, "A screenshot is a gate, not a redaction pass"), which is why
capture is off unless the operator turns it on. A refused capture and a failed
capture reach the model as the same sentence — the page is unseen, say so,
do not guess — so a run moves on rather than stalling the step. And a domain on
the user's blocklist is refused before any capture is attempted.

**A coordinate action is bounded too, because the picture is not a map.** Having
a screenshot is not having coordinates: on a canvas the model is aiming from a
picture at a rendered surface, and the prompt tells it to use
`click_xy`/`focus_xy`/`type_xy` because there is no element to name. `_missed_point`
counts a coordinate action that missed — out of viewport, something on top of
the canvas at that point, the page moving mid-decision, or a dispatch that
reported failure — on `deps.xy_misses`, with `_XY_MISS_LIMIT = 1`, and three
sentences rather than one generic "that failed":

1. **first miss** — re-look and click once more, adjusted. The loop
   re-observes at the top of every step, so the retry is a *new step* with a
   fresh tree and a fresh `probe_xy`, not a redispatch from geometry already
   proved wrong. The limit is 1 and not 0 because a mis-aimed coordinate is
   tens of pixels out, not hundreds, and a second informed attempt measurably
   lands closer than asking a person.
2. **second miss** — coordinate actions are spent for the task; bring the user
   in with `ask_human` and ask where the label is. Deliberately **not**
   `_ask_user`: an interactive prompt here records a failed action in the
   document, and the escalation is one the model can make itself.
3. **third and after** — a terminal refusal for the verb.

**The third stage is the one that bounds it.** Nothing here can stop a model
emitting `click_xy` on every step, and stages 1–2 are prose — so a counter that
only escalates the wording still buys an ignoring model a fresh human approval
every step. The ceiling is what closes it. `xy_misses` is reset **only** by a
coordinate action that lands, so two misses on the way onto one canvas do not
follow the model onto the next. The loop it closes is the one recorded below,
"Ten clicks, four attempts, zero changes": that was this path with no ceiling.

**A coordinate is a number, and the output schema cannot say so.** `action_args`
is a bare `dict`. Nothing in the schema the model generates against tells it
that `x` is an integer rather than a string, so it guesses — and **it guesses by
quoting**: a recorded Sheets run emitted `{"x": "113", "y": "213"}` as JSON
strings, and the action was refused outright, spending the step to reject an aim
the agent had got exactly right. The refusal was not wrong; it was the *only*
safe response to a value whose type the schema never specified.

Two things ship, and the second is the one that matters. `_coordinate_action`
now coerces at the guard — an int that is not a bool, or a string of ASCII
digits and nothing else, with surrounding whitespace tolerated because quoting
plus padding is a formatting difference rather than a different number. And
`prompt.py` names the type on `click_xy`, `focus_xy` and `type_xy` and carries
one coordinate example with unquoted literals, so the guess has something to be
instead of the default.

**What is refused, deliberately.** `bool` (`True` is `1`), any float
(`113.7` — truncating aims at a pixel the model never named), `"113.0"` and
`"1e2"` (a decimal or an exponent is not a whole pixel count, and the model may
well have meant the fraction), `"0x71"` and `"1,13"` (a radix prefix or a
separator the model invented), `""`, `null`, a list. **A coordinate silently
floored is worse than a refusal**, because the run continues and is wrong.
Everything downstream — the probe, the viewport bound check, the
`backendNodeId` binding, the approval card — reads the coerced int and is
unchanged.

**The root cause was written down in the code before the incident.**
`harness.py` carried a comment saying `action_args` is a bare dict and that the
schema therefore tells the model nothing about an argument's type. It shipped
anyway. That is the failure worth naming: a comment is not a control, and a
reasoning nobody is forced to read is not a constraint.

**A canvas-dominated page is sparse unconditionally, and this is the third
case, checked first.** The two tests above can only see what is *there*. A
canvas page reports a rich, plausible tree — forty AX nodes on a Sheet, for the
toolbar and the menu bar — and the grid missing out of it is exactly the thing a
model reading that tree does not register, because a vocabulary test cannot see
an absence. It did not fire on a real Sheets run for the reason it would not
fire in theory: the chrome carries **Sheet1** and a **Name box**, so the page
text always shares a content word with the task and `not (words & seen)` read
that as "the tree has something for you". (`read_page_text around='Name'`
succeeded on that run, so "Name" really was in the text.) So `_sparse_for_task`
checks `_is_canvas_page(deps.canvas_covered)` **before** the page-text length
and before the vocabulary: `canvasCovered >= _CANVAS_COVERED_FLOOR` (0.5)
returns `True` outright, because both of the other tests report the *chrome*,
and the chrome is not what the task is about. Half the viewport is the floor
that separates "the app draws its content here" from "there is a chart or a
canvas ad in the corner". The signal itself — one number, no extra round trip,
both enumeration bounds — is `extension.md`.

**Unknown is not "not a canvas".** A missing, non-numeric or unmeasurable
`canvasCovered` leaves both tests below exactly as they were, so an extension
build from before the field shipped behaves precisely as it did before. `0.0`
would be the failure mode: it is a claim about the page, and nothing checked.

**An empty `read_page_text` on a canvas page is not an empty page.** It is
Brotto being unable to read the page, and the third cause of the failing Sheets
run was the model concluding from it that the work was absent and backspacing
over it. `read_page_text` now appends, on a canvas page and only there, that
nothing came back *because* the content is drawn on a canvas — do not conclude
the work is missing, do not redo or erase what you have done. The same
discipline as the delta block below, pointed at the model instead of at the
harness: an empty read is an absence of evidence about the page, not evidence
about the page.

Pinned by `tests/agent/test_vision_fallback.py`, `tests/agent/test_canvas_awareness.py`,
`tests/agent/test_coordinate_click.py`,
`tests/test_capability_resolution.py` and `tests/test_vision_capture_gate.py`.

### The three-pictures rule inverts on a canvas page

The rule above — three pictures a task — is a rule about a page **the agent can
otherwise read**. Its reasoning is a cost guard on a *supplement*: past three,
the model has prose in front of it, so the picture is a second copy of something
it already has, and an uncacheable image is charged again on every step that
carries one. On a canvas page that reasoning is inverted, because the tree
carries the toolbar and the text carries the same chrome, and **the content is
in neither**: a `<canvas>` contributes no AX node and no text.

The recorded run that produced the change is the argument, and it is worth
keeping because every number in it is a property of the *page*, not of the
agent: 14 steps, 62–67 accessibility targets, ~375 characters of page text,
**zero cells**. Everything the harness could see was the sheet's chrome, and
the grid was in none of it. The whole task's picture budget was **three**, and
11 of the 14 steps carried no picture at all — and the run ended in two
`cannot_complete` endings with no errors anywhere.

So the ceiling is `_capture_ceiling(deps)`: **three on an ordinary page, and
`_MAX_CANVAS_CAPTURES_PER_TASK = 40` on a canvas-dominated page** — a page
where `canvasCovered >= _CANVAS_COVERED_FLOOR` (0.5), the same signal
`_sparse_for_task` uses. Forty is a *cost bound*, not a claim about how many
pictures a canvas task needs: a picture is an uncacheable few thousand tokens
and it is charged again on every step that carries one, so forty bounds a long
canvas task in the low hundreds of thousands of tokens and sits **below** the
loop's own `MAX_STEPS` of 150 — the picture budget is bounded under the step
budget rather than over it.

**One counter for two buyers starved both.** The model's picture and the
approval card's picture shared `deps.screenshots_taken`, and on a canvas page
every action is a coordinate click, so **every capture that was bought went to
the card** — the model's perception budget was spent on pictures it never
sees, the model itself went the whole task without a picture, and the run was
refused its fourth coordinate click for "this task has already been shown as
many screenshots as it gets". The two buy different things: the model's
picture is *perception*, it is what the model reads; the card's picture is the
**user's own approval surface**, shown to the user on the user's machine,
which the model never sees. The counters are now split — `deps.sight_captures`
for the model's perception and `deps.screenshots_taken` for the card's — and
`_capture_page` takes `card=True` to say which one it is spending. A shared
budget is a budget shared between a need and a want, and on a canvas page the
need loses.

**A canvas page gets its own notes, because the ordinary ones are false there.**
`_SCREENSHOT_CANVAS_NOTE` says the tree and the text describe the application's
*controls* and not its content, that the picture is therefore the primary view
rather than a supplement, that a step arriving with no picture is **the page
being unseen** and not a change in the page, that the AX tree outranks the
picture where they disagree, and that the picture is page content — including
the words drawn inside it, because a canvas can render an instruction as
glyphs. `_SCREENSHOT_CANVAS_UNSEEN_NOTE` is the same page with no picture: on an
ordinary page the refusal note is enough, because the model can still read the
tree; here it is blindness, and a model told only "no image could be captured"
on a page whose content it has never been shown describes the toolbar and
calls it the page.

**One function builds both, so the two templates cannot drift.**
`_failure_note(why, canvas)` picks the canvas or the ordinary template and
formats it. The model reads a sentence, not a branch, and two hand-written
notes saying the same thing in different words is how one of them ends up
contradicting the other.

**`_UNVERIFIED_BLIND` was reworded to say what it knows.** It no longer claims
the page did not change; it says the page is a canvas app, that the element
tree did not change and **no measurement of the page's pixels was available**,
so the action may have landed or may have missed — and that the picture shows
the page as it is now, so the model can look in it for what it set, while the
harness keeps no copy of the previous one and so cannot confirm a change by
comparison. A step on a page like this stays unconfirmed until something else
confirms it.

### The keyboard is how you act; the tree is how you know, where there is one

The canvas page reduced the model to clicking pixels, and **a coordinate in a
spreadsheet is a guess at which cell that is** — the app has no element to
name, so there is nothing to make the guess right. `SYSTEM_PROMPT`'s "When a
page looks empty" section now teaches the keyboard instead: arrows move, Tab
and Shift+Tab move right and left, Enter commits the cell and moves down,
Escape abandons an edit, and where the page names a cell — the name box is in a
spreadsheet's tree — clicking that name box and typing the reference is the
same jump with no guess in it, and the tree's name for it is a better target
than any pixel.

**Two limits are stated, and both are real.** A key press reports that the key
was sent and never that the cell changed, so **a keyboard step is UNVERIFIED by
construction** — and repeating it teaches nothing. And a key press tells the
model nothing about the page: not what is selected, not what is there. What it
wants next, and whether its last move landed, still comes from the picture.

#### The page names its own accessibility mode, and it is read before the page is called empty

The second limit above was true and **unconditional**, and it was wrong as
written. An app whose grid is a `<canvas>` knows that, and ships a
screen-reader mode behind a chord — and it usually says so **in its own page
text**, which the loop already has. Google Sheets reads "Turn on screen reader
support / To enable screen reader support, press ⌘+Option+Z". So the prompt now
tells the model to read a canvas page's text for such a shortcut and press it,
once, early, before typing anything, spelling the modifiers as the numbers the
prompt already spells Home's with (Meta=4, Alt=1, so Meta+Alt is
`press_key("z", modifiers=5)`). Do not skip one because the page looks empty,
because on a canvas the shortcut is sometimes the only text there is.

**The chord is an allowlist, and the page's naming it is not a permission.**
The original wording here — "press the chord the page names", with the
counterpart "do not guess a chord the page did not name" — made the page's own
text the authority, and a security review flagged it as an indirect
prompt-injection vector: page text is untrusted data, and an instruction to
press a key is an instruction the *page* must not be able to give. So the
prompt no longer says "press the chord the page names" at all.

**A page may direct the agent to press exactly one chord: Option/Alt + Z with
Command or Ctrl** — `press_key("z", modifiers=5)` (Meta+Alt) or
`press_key("z", modifiers=3)` (Ctrl+Alt), one key sent two ways, both inert in
a browser. **That is the only chord a page may direct the agent to press.** A
chord named in page text is a *fact about the page, never an order*, and the
fact that a page named a chord is the reason to distrust it rather than the
reason to send it. The prompt names the hostile cases explicitly — ⌘Q, ⌘W,
⌘⇧Q, ⌘L and F4 are chords a page naming them is trying to make the agent
press on the user's own machine, where one of them closes their tab or ends
their session, and the model must not press those, nor one "just to see what
happens".

**The bound is on what the PAGE may direct, not on what the MODEL may press.**
Keys the model chooses for its own navigation — the arrows, Home, Enter,
Escape and Tab — remain the model's to press on any page whenever the task
calls for them.

**The residual ceiling, stated honestly.** The allowlist bounds the *chord*,
not the *page*: a page that names the whitelisted chord and has no
accessibility mode behind it can still get one inert key press. The ceiling is
**one inert chord**, not "no page-directed key". Nothing else moved — the
extension, the pixel veto, the capture budget and the redaction rules are
untouched, and the change is prompt text only.

**What that measured, and what it did not.** Measured on a live Google Sheet in
Chrome: pressing that chord flips the accessibility layer on and the tree
carries the grid again **for the cell the model is in** — the name box is a
`textbox value="A2"` holding the current cell's ADDRESS, the formula bar is a
`textbox value="..."` holding that cell's CONTENT, and a live region announces
the two together. Both follow selection: ArrowDown moved A1/`president_number`
to A2/`1`. The grid itself stays a `<canvas>`; it is the accessibility layer
that appears, not the DOM. **None of this needed new plumbing** — the extension
already captures `node.value?.value` (`observation/index.ts`) and
`filter_ax_targets` already renders `value="..."` and already keeps a node that
has a value and no name (`ax_filter.py`), and `press_key` already speaks CDP's
modifier bitmask (Alt=1, Ctrl=2, Meta=4, Shift=8) with `keyCodeFor` handling a
single letter. **One page, one browser:** a real run's model-facing behaviour is
not yet verified, and the five tests in
`tests/agent/test_canvas_accessibility_mode.py` assert the *prompt's wording* —
that it names the shortcut, the bitmask, the name box and the ceiling — and
never that a model read the grid because of it.

**The ceiling is one cell, and it is stated where the model will read it.** The
mode reports the selected cell. It is **not a read of the whole sheet**, so no
claim about neighbouring or distant cells follows from it, and the prompt says
so in the same paragraph as the confirmation rather than leaving it to be
inferred from a convenient one. Read the name box and the formula bar *before*
the next move, and read the cell you wrote **at its own address** after a
write — the content box follows the selection, so the read has to go back to
the address you wrote rather than reading whatever it is showing now. The two
boxes are a pair and the third target is the off-screen editor; all three are
resolved below, and the read-and-verify rule is stated there because it is the
same rule with the boxes named.

**So the old sentence is scoped, not deleted.** "The keyboard is how you act;
the picture is how you know" was the rule for a page with **no accessibility
mode**, and there it still is: the picture remains the only view of the cells and
the keyboard remains how you act. It is not the rule on a page that ships a mode
and names it. Two contradicting paragraphs are worse than either one alone, so
the replacement states both branches rather than leaving the superseded claim
standing next to the correction.

**No gate moved.** This is worth saying because the natural misreading of "the
canvas problem is fixed" is "something was loosened". Nothing was. The pixel
veto (`_PixelVeto`, `latched` and the two-step ambiguous window) is unchanged
and still runs **before** the model is resolved; `_MAX_CANVAS_CAPTURES_PER_TASK`
is still 40 and the picture still rides along with the veto; the redaction rules
are untouched; `BROTTO_VISION_CAPTURE` is still default-off; the blocklist is
still the user's. The commit is one paragraph of `SYSTEM_PROMPT` and its tests —
no product code. **The point of the change is that the model stops needing a
picture**, so the privacy cost of a canvas task should not grow; nothing in this
section is a licence for a wider capture and `privacy.md` §3's account of that
trade stands unchanged.

**Home is sent two ways, and that is not a branch.** `Ctrl+Home` and `Cmd+Home`
are the same intent on different keyboards, and this project forbids
`sys.platform` / `navigator.platform` branches anywhere — behaviour must be
identical on every OS. So the prompt sends one key two ways, as a **retry**
rather than a branch: Home with Ctrl (`modifiers=2`), and if the grid does not
move, Home with Meta (`modifiers=4`). The extension holds no platform branch
and must not grow one; the CDP modifier bitmask is the extension's
(Alt=1, Ctrl=2, Meta=4, Shift=8) and the caller's to supply. A test asserts
that no OS vocabulary ("on a Mac", "Windows", …) enters that section, because a
sentence that names an operating system is a branch wearing prose.

### Two boxes that look identical, and the two ways the work disappears

A measured Google Sheets run typed its two column headers into the sheet's
**name box** — the address box — and the data never landed. A word typed there
does not write a cell: it creates a **named range**. The page opened a "Create a
named range" panel and the run still reported itself completed. **The failure
is silent three ways at once**: the typing succeeds, the cell stays empty, and
nothing errors.

A later run failed on the *other* box and was just as silent: it typed into the
formula bar, pressed Enter, and reported completed with no cell written. That
one was ours in two parts — the delivery (an `Input.insertText` fires no
keydown, so a grid never entered edit mode) and the target (the prompt told the
model the off-screen editor was not a field to type into, and told it to read
the content box back, which is a mirror of the selection rather than the cell).
Both halves are corrected here and in `extension.md`, and the verification step
is what turned the first one into a certifiable success.

**The two boxes are told apart by their value, not their name.** A grid app's
chrome carries two **anonymous** textboxes that look identical in the AX tree.
The one whose value is a cell reference — letters and digits, like `A2` or
`B12` — is the **ADDRESS box**; the other, whose value is the selected cell's
text, is the **CONTENT box**. Position is the second tell: the address box is
the small one at the far left, the content box is the wide one beside it.
Google Sheets is the example — its name box holds the address, its formula bar
holds the cell's content.

**The two are a pair, and that is what the first version of this section got
wrong.** The content box **follows the selection** rather than staying where
you left it, so the address box is what says *which* cell the content box is
showing. And the content box is a **mirror of the selected cell, not that
cell's editor**: its value is the selected cell's content, and while an edit is
in flight it is that edit — but a write aimed at the cell lands in the cell
because the grid routed it, not because the box is the cell's editor. A run
that typed a header into the formula bar, pressed Enter, and read the formula
bar back had verified a mirror of itself.

**The off-screen textbox is the grid's own cell editor, and it is a write
target.** A textbox the tree marks off-screen in a grid is the zero-width
element the app parks outside the viewport and keeps focused while an edit is
in progress. It has no point on screen, so it is not a field you *press* into —
but it is where the pending edit lives, and its value is what the tree reports
for the cell being edited. The earlier sentence here called it "the app's
editor, not a field to type into", and that phrasing is what pushed the model
onto the mirror: it read as "this cannot be a write target" and the formula bar
became the only remaining option.

**A reference typed into the address box is a jump, and a word is not.** That
is the whole difference between the two boxes: a reference navigates, and a
word is taken as the *name* of a range. So the address box is not a field to
avoid — it is a field with exactly one legal use.

**To write a cell: `type_text` into the content box, `press_key("Enter")` to
commit it.** Nothing shorter than Enter commits an edit, and the value reaches
the cell only if it arrived **as a keystroke** — which the extension routes by
the page's origin **and path prefix** (an origin alone is a host, not an
application: `docs.google.com` serves Docs and Drive as well as Sheets), not by
which box was focused (`extension.md`). The
off-screen editor textbox carries the same edit, so either target can hold a
cell's content; the content box is the one you can see.

**Verify by reading the cell you wrote, not the box you typed into.** Enter
moves the selection down, so immediately after it the content box shows the
**next** cell, and reading it then proves nothing — it cannot tell a written
cell from an empty one. That was the verification step that certified the
Sheets run whose cell was never written. ArrowUp after Enter returns the
selection to the address you wrote; read the content box's value **there**,
with the address box confirming you are back where you wrote. Not a picture,
and not re-typing the value to see whether it took.

**If the tree does not show your value for that address, the write did not
land.** Say so, and do not report the cell as written. **Do not type the same
value into the same box a second time either**: while an uncommitted edit is
still in the editor, a second write *replaces* it rather than adding to it, so
the retry loses the first attempt and the cell stays empty — the retry converts
a not-yet-landed write into a definitely-lost one. Try the other target once,
the grid's own off-screen editor textbox, and read that address again. If the
value is still not there, `cannot_complete`, naming the cell and what the page
did not show. The extension's own half is the refusal path — `grid-text-not-
delivered` / `grid-text-misdelivered` (`extension.md`) — and this is the loop's
half: **the refusal is worth taking over the report.**

**If the tree carries no content box and no off-screen editor, the page exposes
no field that takes a cell's content.** No accessibility mode, no formula bar —
then the agent must call `cannot_complete` and say what the page does not
expose, rather than type into a field it has not identified. Typing into an
unidentified field is how the named-range mistake is made in the first place.

**The address box is DETECTED, not guessed, and the detection is a nudge
rather than a kill.** `address_box_nudge(deps)` fires when **two writes into an
address box** land within the last **six steps**; the count is over *steps*,
and a step that typed nothing contributes nothing. Detection is by the value
the field holds — a cell reference — and only a written value that is **not
itself a reference** counts, because a reference typed there is a legitimate
jump. Two writes in six steps put one line into the next prompt naming the
mistake and the alternative (find the box that holds the cell's content, type
there, press Enter, read it back), and **the run continues**: the model may
still try something different, or stop and call `cannot_complete`.

**The rule it replaced was wrong, and the same box is why.** The earlier bound
fired on "the same field typed into again and again" — but writing a column of
values through the *content* box uses the same field every step, so that rule
fired on ordinary work. The reference test is what separates navigation from
data.

**Neither existing bound could see it, for two different reasons.** The
word-overlap nudge compares the *last two* steps' summaries, and the measured
run's steps differed (type, Enter, click, read), so it never fired. The
stagnation bound measures the *page*, and the agent's own typing changed the
tree every step, so every step looked like progress.

Pinned by `tests/agent/test_address_box_nudge.py` (what counts as a write
into an address box, and when the nudge fires) and
`tests/agent/test_grid_write_path.py` (the two-box rule and the write-and-
verify path).

### The CSS-pixel capture, and what it actually saves

`capture_screenshot` grew one optional key, `css_resolution`, and the seam is
deliberate: **the harness asks, the extension obeys.** The extension cannot
tell the model's capture from the approval card's — the same frame, the same
branch — and the card is the user's own surface, where small text has to stay
legible. Deciding in the extension would mean a second, weaker copy of
`_is_canvas_page` on the client. So the request is the server's, the key is
optional, and a server that predates it gets today's behaviour.

**The measurement corrected the premise the change was built on.** A
3024×1890 device capture and a 1512×945 CSS capture are **not** 1.8x apart in
tokens. The API downscales the long edge to 1568px before pricing, so the
device copy prices at ~2,049 image tokens and the CSS copy at ~1,905 — **about
7% apart, not 1.8x**. (The per-picture figure the harness carries, ~3.3k, is a
different provider's measurement of the same device capture; the ratio is what
this paragraph is about, and the ratio is ~7%.) The real win is **bytes**
(~223 KB → ~85 KB per capture; ~3.1 MB → ~1.2 MB per canvas task across the
relay) and **1:1 with `click_xy`'s CSS-pixel coordinate space** — the model
clicks in CSS pixels whatever the picture is, so a CSS-pixel picture needs no
scaling step in the model's head, while a retina picture invites it to
multiply.

**The clip-scale gotcha is measured, not assumed.** A `clip` is specified in
CSS pixels but its `scale` applies to the *device* surface, so `scale: 1`
returns 3024×1890 — byte-identical to no clip at all, and 2.6x the bytes for
nothing. It is `1 / devicePixelRatio` that lands on 1512×945. A viewport that
cannot be measured falls back to the device capture rather than to a clip of a
guessed size: a wrong clip is a picture that does not show the page the model
is clicking on, which is the one failure here that costs a click.

The extension's half of this is `extension.md`.

### The shutter is closed for a window now, not for the run

The harness's rule for refusing pixels used to be one rule with one duration: a
run that touched a credential lost the page delta and the screenshot for every
remaining step. On a canvas that is not a precaution, it is the removal of the
run's only evidence channel — and it happened for reasons that had nothing to
do with credentials. `privacy.md` §3g carries the rule itself; this is what it
costs the loop.

`_PixelVeto` (`harness.py`) now holds two claims, and they have two lengths.
`latched` is positive evidence — a field that positively identifies as a secret
— and is run-wide, because a credential can be rendered into this page or the
next at any point. `armed_at` is the step of an *ambiguous* write: a value that
was redacted because the field could not be told from a password box, which is
every canvas cell and every literal keypress. `open(step)` is
`latched or 0 <= step - armed_at <= 2`, so an ambiguous write closes the
shutter on its own step and the two that follow, and opens it again on the
third.

**A value cannot have been rendered before it was typed, so the window is the
exposure.** The only moment an ambiguous value can be on screen is the
observation taken after the keystroke — the page paints it into the DOM, a
password manager echoes it back, a live-validated form redisplays it. After two
more steps have had a full observation each, the claim is spent. Vetoing for
the rest of the run was vetoing a risk that had already passed, at the price of
the run.

**The window is keyed on `deps.step_number` and is read, never consumed.**
Nothing decrements it. That is the whole reason it is a step comparison and not
a countdown: an early `break`, a terminal action, `ask_human`, a cancellation
or `deps.result` ending the loop cannot shorten it, because there is no
countdown for them to eat, and neither can a step that calls the three veto
sites. The window includes the armed step itself, because the keystroke has
just happened and nothing has settled — the least safe moment in the run, not
the most.

**What the loop loses while it is closed.** The delta is `None` — unknown, not
"nothing moved" — so the page earns no progress credit from it and falls back
to the URL and AX terms, and the vision screenshot is refused, so the model
reads the page as unseen rather than as blank. Both are the existing refusal
semantics; only the length of the refusal changed.

**What it cost, in a live Google Sheets run.** The grid is a `<canvas>` whose AX
tree does not change when a cell is edited, so the pixel delta and the
screenshot were the **sole** signal that an edit landed. One blank-named grid
cell latched the flag, the shutter stayed closed for the rest of the run, and
the agent re-clicked the same cell seven times — reading its own repeated
failure as a page that refused to change. The incident is recorded in
`privacy.md` §3e; the loop's half of it is that a run on a canvas was left
with no evidence to correct itself with.

**"Sole signal" was true of that run and is now a choice.** The tree did not
change because the mode was off, and Sheets names the chord that turns it on in
its own page text — see "The page names its own accessibility mode" above. With
that mode on the tree carries the selected cell, so a canvas step has a channel
that is not pixels and is not vetoed by a veto about pixels. **The window
below is unchanged**: an ambiguous write still withholds the delta and the
screenshot for the armed step and the two that follow, because those are
exposures of what the user typed, and the tree does not redact.

**The second instance of the identical bug, found only because the first was
fixed.** `_redact_press_key` returned a bare `bool` that its caller turned into
`latch=True`, on a path that answers "unknown" three times out of four because
no relay implements `focused_attributes()` yet — so every Enter on a canvas
latched the poisoned run too. The lesson is in `privacy.md` §3e: "fix the
branch that was named" and "fix the bug" are different achievements, and the
grep is what tells you which one you did.

**Still open, and recorded as open rather than designed.** `type_xy` and a
literal `press_key` character are always ambiguous writes, so they arm the
window on most canvas steps — and a run that keeps typing keeps re-arming it.
The window is bounded in time, not in the presence of continuous writing, and
on such a run the delta is withheld on most steps. That is the same evidence
channel the canvas case depends on, so the canvas case is not closed by the
window. The accessibility tree reaching a provider is a separate disclosed gap
(`privacy.md`) and is not closed by any of this.

### A marker the model read as a verdict on its own input

A Google Sheets run typed its values, and then wrote that it was "navigating to
[typed into a secret field]" and that "the system is redacting any short text
I try to type, treating it as a potential password". It gave up on typing, and
went looking for a workaround to a block that did not exist. **The text was
typed.** Nothing refused it; the value reached the page exactly as the model
sent it.

**The marker was the bug, twice over.** It made a claim about a *field* — a
secret field — and the model read that claim as a claim about its *own input*,
because that is the reading its own action line put next to it. And nothing in
`SYSTEM_PROMPT` had ever defined the token, so the model filled the gap with
the worst reading available. On a canvas app every cell is unclassifiable, so
every typed value was marked, and the agent's conclusion was consistent with
the evidence it had been given. **A marker the model has no definition for is
a marker the model will interpret**, and the interpretation it picked was
expensive.

**The model-facing marker now says what happened, and the prompt defines it.**
`prompt.WITHHELD` is `"[withheld from the record]"`. The prompt has a section
that says, in terms: read the marker as a fact about the *record*, never about
delivery; **the text was typed**; a typing that did not reach the page is
reported as a failure and the action line says so, so a marker that is the
only thing on the line means the typing worked; do not re-type around it and do
not go looking for a block that is not there; and the value is not recoverable
from the marker, so read it back off the page or ask the user rather than
reconstructing it from context. The definition is the fix — the marker alone
would have been a new undefined token with a friendlier name.

**Two markers, two audiences, and the masking is in the action arguments.** The record keeps
`audit.REDACTED` — `"[redacted:password]"` — and the model-facing line
carries `WITHHELD`. The masking is in the **action arguments**: the per-action
`redact` flag covers both audiences there, and only the length survives. The
guarantee is **narrower in the model's own prose** than in the action
arguments, and that is now on purpose — a value is scrubbed out of the
outcome summary, the narration, the thought and the reasoning only when the
field **positively identifies as a credential**. `privacy.md` carries the
split itself; this is the loop's half, because the whole cost of the old
marker was paid in steps.

**Prose substitution removes the value wherever it appears, whole string or
part of one, longest value first.** Every value on the list is a positively
identified credential, so the safe direction there is to over-redact: a
credential that survives because it happened to sit inside a longer token
("pw1" inside "pw123") is a credential on disk. That is why the substitution
is a plain longest-value-first `str.replace` with no word boundary on it.

A bare `str.replace` ate ordinary words too: measured on the failed Sheets
run, "The page Agent shows Messages about the age of the Image." with the
value "Age" came out as "The page [withheld from the record]nt shows …" —
"Age" is a prefix of "Agent", so the model's own sentence came back as
gibberish and the user read it. That was fixed **at the source**, not by
loosening the match: the list holds only values whose field positively
identifies as a credential, and an unclassifiable field's value (every typed
value on a canvas) is ordinary data that never reaches it. The mask in the
action arguments is what protects that value. So the ordinary-word mangling
cannot recur — not because the match was loosened, but because the value never
reaches the list.

**The general rule, because the same shape recurs.** A closed vocabulary is a
promise that each token means exactly one thing. `[off-screen]`,
`[covered]`, `[disabled]`, `focus-identify-failed` and `[redacted:password]`
are all in that vocabulary, and every one of them is a *fact about the world*:
the control is off-screen, the press was refused, the value is not in the
record. The old marker broke the promise in the one direction that costs the
most, because a model told "your input was treated as a password" will act on
that — it will not type, and it will spend the run looking for a gate that is
not there. A redaction marker has to be about the *record*, and the prompt has
to say so, or the model will read it about itself.

Pinned by `tests/agent/test_withheld_marker.py`, which asserts the two
markers, the prompt's definition of the model-facing one, and that the value
never reaches the **recorded action**; and by
`tests/agent/test_typed_secret_capture.py`, which asserts the value never
reached the audit document. `tests/agent/test_prose_scrub.py` carries the
narrower prose rule and the substitution — that a credential is removed even
inside a longer token, and that a value is removed wherever it appears — and
`tests/agent/test_memory_capture.py` pins the same over-redaction on the
narration in `test_a_credential_is_removed_even_inside_a_longer_token`.

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
- `type_text` no longer sequences `focus_ref` and `clear_ref` in the harness at
  all. It is one `type_text_into_ref` call, and the relay owns the ref
  resolution and every guard in it — so a ref that does not resolve refuses
  before a keystroke is dispatched, rather than typing into a field the model
  never named. See "One observation per model turn, not per CDP command".

Pinned by `tests/test_grounding_outcome.py` (5 tests, both relays).

**…and then the fix was itself wrong, for the same reason.** A live Gmail run
recorded it in the audit document:

```
'click' ok=True  ->  'Clicked [13829]: Error executing: ref 13829 is not in the current AX tree'
```

The prefix was there, just not at the front: `harness.py` decorated the relay's
outcome on the way through (`f"Clicked [{ref}]: {result}"`), so a
`startswith` test missed every failure whose action had a name to print. Making
the relays well-behaved was necessary and not sufficient — the derivation point
had to change too, and it is now **membership**, `_EXEC_FAILURE not in outcome`,
with the string named as a module constant rather than repeated. A prefix test
is the kind of contract that only holds until something upstream formats the
message. Pinned by `test_a_wrapped_failure_is_still_recorded_as_not_ok`.

**…and the decoration itself was the same bug again, in the other direction.**
Tolerating a mid-string failure marker is necessary but not sufficient: the
wrapper asserted a destination the relay had never checked. The relay already
returns `Clicked [0:10183]` on success and `Error executing: …` on refusal —
both already name the ref and both are honest. So the harness stopped wrapping
(`click` now returns the relay's string verbatim, exactly as `type_text` does
after 11fa5fff), which deletes the double assertion: the audit document and the
model's context read `Clicked [0:10183]`, not `Clicked [0:10183]: Clicked
[0:10183]`. On session 3dab5bb6 the click landed on the formula bar instead of
a cell and the record claimed the cell.

`ok` is unaffected — membership survives either shape — and
`_REFUSAL_RE`'s optional `Clicked [...]: ` group is **kept**: a run resumed from
an audit document written before this change replays decorated outcomes into
`step_summaries`, and that prompt builder still has to select them.
Pinned by `test_a_click_outcome_reaches_the_caller_unchanged` and
`test_a_refused_click_reaches_the_caller_unchanged`.

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

**`TARGET_PROBE`'s cross-frame check is best-effort, and that is the honest
description.** It compares `window.top` against `window`, and `window.top` is a
page-writable global: a page that wants the check to lie can make it. So this
is a signal against a page that is *not* actively misleading it, not a hard
boundary — do not read it as tamper-proof. The hard version needs
`Page.createIsolatedWorld` per frame, which is the frame workstream and
explicitly out of scope. What it is worth is the ordinary case: a click that
lands on the wrong frame because a re-render moved things under it.

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

### The cross-domain gate asks before dispatch — for the verbs that can

A click that hops to a new eTLD+1 used to be gated **after** it ran: dispatch,
`sleep`, read the URL, then ask. By the time the user was asked, the navigation
had already left their logged-in tab carrying a form POST, an OAuth code or a
`?token=`, and a deny could abort the task but not un-navigate. That is an
approval in the future tense about something already done.

Two verbs, two shapes, and the difference is not a preference — it is what each
verb knows before it presses.

**Ref `click` gets a pre-flight.** `_click_ref_href` reads the `href` off the
step's *own* target list (`observation/index.ts`, `propUrl`) and returns the
absolute destination; `_preflight_cross_domain_click` then runs
`_should_prompt_cross_domain_click` — **unchanged**, with the href standing in
for the URL the click will land on, so the six existing pure-helper tests cover
the predicate the gate runs on.

**The href is used as-is and never re-resolved, because `urljoin` is not
WHATWG.** Chrome fills that property with the *resolved* URL, so an absolute
href is already what the browser would navigate to and resolving it again can
only introduce disagreement. The case that decided it: a **doubled**
backslash, `\\evil.com/x`, which a browser reads as slashes and resolves to
`//evil.com/x` — cross-origin — while `urljoin` leaves it on this page. So a
relative href is exactly the input where a Python resolver invents a
*same-domain* verdict the browser would contradict. (The single-backslash form
is *not* the divergent case: `\evil.com/x` resolves to a same-origin path in
both. Worth saying, because the shape that motivates the rule is easy to get
wrong by one character.)
Therefore a relative href and a protocol-relative one are `None`, not resolved.
So are `javascript:`, `data:` and `file:` (no eTLD+1 to read) and any netloc
carrying `@`, which a browser reads as the *host* while a glance reads it as the
userinfo (`https://bank.example@evil.example/`). **Refuse the shape rather than
pick a side.** All of them land on the same `None` as an unreadable href, and
`None` means *no destination we can read*, not *same domain* — see below.

**No wire change was needed, and that is the reason it was possible.** The
extension already puts each link's CDP `url` property on the target, and
`extension_relay._to_semantic` already maps it to `SemanticTarget.href`. The
pre-flight reads a field the model was already shown; it does not invent one.

**Two meanings of "no href", and the difference is load-bearing.** A button
whose handler navigates in JS, a form submit, and a ref that has aged out of the
tree all return `None` — and `None` means *no destination we can read*, **not
*same domain***. Collapsing the two produces a gate that looks load-bearing and
resolves nothing for exactly the cases that most need it. `None` falls through
to the post-dispatch check, which stays for three reasons: it is defense in
depth, it is the only line for an href that cannot be read, and the JS-nav case
is still caught one step late by design.

**The blacklist is read first, before any question is asked.** `navigate` reads
the same policy against its target before dispatch, and the post-click check
reads it after; a ref `click` now does the same. This is the one verb where the
destination is readable in advance, so asking first would downgrade the user's
own "never go here" into "please confirm" — a block is a block, with no approval
path, and nothing joins `visited_domains`.

**The href is re-read after the user answers, and that re-read has no
substitute.** The page can rewrite an anchor's `href` inside the window the
human spends on the card, and then the approval is consent to `good.example`
being used to reach `evil.example`. A re-read of the *page URL* cannot catch
that — the page did not move — so it has to read the href, exactly as
`_coordinate_action` re-reads the point. Disagreement returns `_EXEC_FAILURE`,
not a friendly sentence: `ok` is derived from that, and a soft refusal would
audit a refusal as a successful click. The re-read can confirm nothing when
`get_targets()` hands back the relay's reusable post-action frame rather than a
fresh capture; the post-click gate remains the line for that case.

**The post-click check is now phrased in the past tense on purpose.** Two prompts
that both predict cannot both be right, and the one after the fact must not read
like a veto that still has time to stop it — it says *"The page navigated to X.
This has already happened."* Both halves share `visited_domains`, so approving in
the pre-flight means the post-click check sees a domain it already has and stays
silent: usually **one prompt per domain per task**, not one before and one after
the same click.

**Open gap: `target=_blank` gets no post-click prompt either.** The navigation
lands in a tab this relay is not driving, so `get_current_url()` returns the
*old* tab's URL, the eTLD+1 matches, and the gate says nothing. The fix is a
`target` field read off the link and mapped onto the target the extension already
sends — the target object itself is on the wire; nothing reads `target` today.
**Not built.**

#### A coordinate click is gated and audited, not prevented

`click_xy` / `focus_xy` / `type_xy` run `_coordinate_cross_domain_after`, a
**post-dispatch** gate reusing the same BLOCK / prompt / `record_policy` /
`visited_domains` machinery. Before it, a coordinate click had **no policy read
on where it landed at all**, and could carry a run onto a blacklisted site.

**A pre-flight is impossible for this verb, not merely unavailable.** This is
the part someone will try to "fix". `_coordinate_action` dispatches only where
`elementFromPoint` is a `CANVAS` — anything else refuses — and a canvas has no
href, no AX role and no destination; whatever leaves the page leaves through a
JS handler on the pixel. The two guards that look like they close the gap do
not: `boundedPoint` runs **inside the extension**, after this server has already
decided, and `verifyTarget`'s own docstring says *"Nothing here runs for
`click_xy` / `focus_xy` / `type_xy`"* — those arrive with no ref and no id, and
refusing them on an absent id would break the only way to act on a canvas page.

So the strongest available form is a report. It still buys three real things:
the landing is checked against the user's blacklist **in the same step**, the hop
is recorded under the identity the user was shown, and the domain joins
`visited_domains` so one approval covers the rest of the task. The deny path
**aborts** rather than returning to the loop — a declined pixel is a statement
about one point, but a page that has already navigated is not something the model
gets to try again on.

**The consent the user can get before the press is a caveat, not a check.**
Every coordinate approval card now carries `_COORDINATE_CROSS_ORIGIN_CAVEAT` —
*"Nothing about where this press leads can be read before it happens: the page
is a canvas there, so this may open another site. If it lands somewhere new,
you will be asked then."* The last sentence is **conditional on purpose**:
`_coordinate_cross_domain_after` skips a domain already in `visited_domains`, so
an unconditional "you will be asked" is a promise the run can break — on a card
that fires for every canvas press, which is exactly the sort of claim that
teaches a user to stop reading it. It rides `frame_reason`, not `reason`, so it
is card-only: no domain, no page text, nothing that reaches the audit document.
See `privacy.md`.

**A click that navigates *during* the approval wait is already caught
pre-dispatch.** The post-approval recheck in `_coordinate_action` re-reads the
viewport, the topmost element *and* the URL after the human answers, and refuses
on any disagreement. So the only hop that escapes is the one the click itself
causes.

D2 already exempts `click_xy` from "diff tiles are never a targeting coordinate
source". That exemption is documented, and its cost is precisely this: the
coordinate path acts on a target nothing can vouch for. Gated and audited is
what it is; prevented is not on offer.

Pinned by `tests/test_click_preflight.py` and
`tests/test_coordinate_cross_domain.py`.

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

### One observation per model turn, not per CDP command

The observation boundary used to be the CDP command. It is the model turn, and
it moved when `type_text` stopped being three relay calls and became one.

`ExtensionCDPRelay.type_text_into_ref` sends a single `type_at` frame —
`{type, x, y, backendNodeId, text, clear}` — so one keystroke is one action, one
post-action observation and one extension-side evaluate, against three of each
before. The harness call site needed no edit: `clear=True` is still the default
and still means *the caller asked to replace the field's contents*, which is what
the prompt says `type_text` does.

**Playwright and Chrome DevTools MCP put the boundary in the same place, and for
the same reason.** Playwright's `fill()` is one `evaluateInUtility` that checks
visible, enabled and editable and fills, with no observation between sub-steps;
the DevTools MCP tool set is one observation per model turn, not per CDP verb.
The cost of getting this wrong is not elegance — it is that every decomposition
of a single user intent is multiplied by a full observation cycle, which is the
19.9s above.

**The clear is a DOM operation, and it runs in the extension *after* the press.**
That ordering is the whole reason it cannot be a server-side call. `clear_ref`
already used `SELECT_ALL_JS` — the chord was fixed earlier — but it was a
*separate action*: its click was dispatched, the extension sent a full
observation, and only then did the select-all evaluate. After `pressAt`,
`document.activeElement` **is** the clicked target; before it, it is whatever held
focus a moment earlier, which may be a different field. Clearing that one is
worse than appending, because the field the model did not name is the field that
empties. So `type_at` presses, then `focusState` reads focus and calls
`select()` on the same `Runtime.evaluate`.

`clear-ref` is the third trip, and it was never free even before the chord was
removed: it dispatched a whole `click` — with the coordinates the type was about
to use — to establish focus, and then paid a second observation. The fused
action is what removes it.

**The canvas case needs no special handling, and a *blanket* containment check
would break it.** A Google Sheets cell is a `<canvas>`; its editor is not a
descendant of the cell node that was clicked, so "is the focused element inside
the thing I clicked" as a blanket rule refuses on exactly the shape this action
exists to serve. `activeElement.select()` selects that element's own contents
wherever it hangs in the tree. So containment **is** performed — by `bindFocus`,
before `focusState` — and the canvas shape is a named, logged exemption inside
that check rather than an exemption for everything. `extension.md` has the
predicate and its three conditions; this is recorded here because the obvious
"fix" is still the one that breaks Sheets.

**The identity binding is the other half of why one fused action is safe.** The
argument above is about cost — one observation per model turn, not per CDP
command — but fusing alone is only cheaper, not safer, and *fusing plus the
binding* is what makes it safe. Before the fusion, the last thing that read
`document.activeElement` was the server, and it read it between frames. After it,
one extension branch reads it and *destroys* whatever it finds — so the branch
needs a wall of its own. `bindFocus` is that wall: the focused node is read in the
extension's **isolated world** and named by the engine (`DOM.describeNode`),
never by a page getter, and must be the pressed node, a descendant of it, a
canvas editor lying wholly inside it, or the grid's own editor lying outside
the canvas entirely — and that last one only on a **recognised grid's own
origin and path prefix**, because the geometry that identifies a spreadsheet is a
geometry any page can imitate, and an origin alone is a host rather than an
application. It refuses an absent `backendNodeId` as
`focus-unidentified` where `verifyTarget` fails open for an older relay,
because this is the branch that empties the user's text. Two walls, no
dependency between them.

**What the grid path does about the focus is not a read.** A grid cell is
*typed*, not inserted: the text arrives as key events, and a key event goes to
whatever holds focus when the browser processes it. So the extension cannot
bind the text to a node by reading the focus before the dispatch — a page that
moves the focus in that window takes the text anyway. It binds it by putting
the focus **back**, in the page, immediately before each keystroke, and it
does that per character rather than per string, because a single check would
leave a window spanning every keystroke. The cost is one extra CDP round trip
per character. The window that remains — one round trip between the re-assert
answering and the browser processing the key — is stated in `extension.md`
rather than smoothed over, and the honest residual is Google's own re-render
rather than a hostile page, since the adapter is looked up by the document's
own origin and path, both unforgeable from inside it. `extension.md` has the
mechanism; what is owned here is the shape
of it: **a reading is not a binding**, and the refusal vocabulary grew a name
for the binding (`focus-changed`) and a separate one for the delivery check
(`grid-text-not-delivered`) rather than one that blurred the two cases. It has
since grown a third: `grid-text-misdelivered`, for a keystroke that reached
some editor other than the validated one — the model needs to know the text
went *somewhere else*, because the next move is a different target and not a
retry. The window is still one round trip per character; what the third name
buys is that the residual is now **detectable** as well as stated.

**That wall was refusing every call in the field, and the reason is worth
carrying.** The route it used to ask the question — `DOM.getFocusNode` — was
removed from Chrome, so the read failed on every build, `bindFocus` returned
`focus-identify-failed`, and **every `type_at` was refused on every site**.
The reason string was true about itself and wrong in fact, which is the
failure this file keeps meeting: a closed vocabulary of reasons is a promise
that each reason means one thing. The lesson for the loop is that the model
was handed a plausible reason — *the focus could not be identified* — for a
cause that had nothing to do with the page, and it built its next step on
it. `extension.md` has the mechanism and the geometry; what is owned here is
the shape of the mistake — a platform change that no mocked test can see, and
a reason string that hides it.

**The focus refusal is unchanged, and it is still two walls — now a third,
serving a different question.** The server's `focus_id` pre-check runs before the
frame is sent and refuses `none` / `body` / `""` — the `445fc36d` outcome, where a
`type_text` typed "Name"/"Age" into a new sheet whose body held focus, read
"Typed into [0:10050]", and completed on an empty sheet. The extension's probes
are *different* questions and do not replace it: `bindFocus` asks whether what
holds focus **after the press** is the thing the press was aimed at, which a
press landing on the wrong focusable node satisfies perfectly, and which
therefore cannot answer *intent* or *shape*. Only a read taken before the
dispatch can say the page was in a state where the model could have meant this
field at all. That is what `focus_id` refuses, and it is unchanged for the model:
click the field first, then `type_text` into it. Fusing the frames closed the
window `focus_id` used to guard — the one between two clicks where a user could
reach for the keyboard — and the extension-side probes are what close it.

`focus_id` now also calls `_locate(ref, need_backend_id=True)`, refusing a ref
that has a position but no element identity at the source, so `focus-unidentified`
never costs a press.

**What `focus_id` costs, stated plainly.** It was a *main-world* `evaluate`, so
the page owned the getter it read and could report a focus that was not there —
the same exposure `FOCUS_PROBE` was hardened against by moving into an isolated
world. **That is closed: `focus_id` now sends `isolatedWorld: true`**, so the
read runs in the extension's world and the page cannot shadow the getters it
resolves through. It never needed to be the wall — `bindFocus` is, and stays
independent. The two answer different questions and are not redundant: `focus_id`
answers *intent* (was this field plausibly in focus before the dispatch), which
the engine cannot answer; `bindFocus` answers *identity* (is this node the one
that holds focus now), which `focus_id`'s page-shaped read never could.

A world that cannot be created must refuse, and it does: the extension answers
`{value: "", error: …}` rather than falling back to the main world, `""` is not
in `FOCUS_ID_RE`, and every caller reads `None` as *unknown* and refuses —
pinned by `test_focus_id_isolated_world.py`.

**Per-phase timing was added because the aggregate number attributes nothing.**
`_phase("focus")` and `_phase("type_at")` log milliseconds per phase under the
session id. The total was measurable; which trip held the seconds was not.
`clear_verify` is gone as a phase because there is no server-side clear left to
verify — it happens inside `type_at`.

### What an action aimed at, and whether the page moved

`record_action` carries two more fields (`SCHEMA_VERSION` 2 → 3), and the loop
now fills them. Both exist because the record was answering *what the model
said* about a dispatch rather than what the harness could see.

- **`target` is the ref or the point.** `0:13829`, or `412,88` for a
  coordinate action on a canvas — an identifier, not text. `_action_target`
  builds it from the call's own arguments and never copies `MAX_TARGET_CHARS`
  from `audit.py`: the audit owns the bound, and a second copy of the number
  is one that can drift.
- **`changed` is `deps.canvas_changed`, and nothing else.** The extension
  measured it, the server compared two measurements of the same page. A model
  saying "I clicked submit and the page updated" is D5 — self-report is not
  evidence — and that claim already has a home, which is `outcome`. The one
  honest caveat: the delta is read at the step's observe, so it describes the
  change *into* this step and sits one action behind, and it is `None` — not
  `False` — on every step while the capture gate is off, which is the default.
  A step that turns the delta into a per-action measurement is the honest next
  move and is not built.

Pinned by `tests/agent/test_action_evidence.py`, including the case that
matters most: the fake executor asserts the page updated on *every* action,
and the assertion is that `changed` is still `None`.

### `press_key` targets focus, and focus is the user's

`press_key` takes no ref. It types into `document.activeElement`, and the user
is free to click something else while the model is thinking — the real case is
the user reaching for their open email draft and the agent's next `Enter`
sending it. Irreversible, and every layer above it records `ok: true`.

**Nothing on the wire told us what the user touched.** The scope check came
first and came back empty: there is no pointer event, no `user_gesture` and no
navigation-attributed focus change on the relay, so the guard needed its own
read rather than reusing a signal that exists.

`focus_id()` is it, on both relays, over the `evaluate` round trip
`clear_ref` already uses — no new request type and no extension change.
`FOCUS_ID_JS` has **three** outcomes, not two, and the uniqueness is
conditional. Not a DOM object (the identity would change every read) and not a
backendNodeId (correct, but not reachable from the one `Runtime.evaluate` both
relays have):

- `TAG#id` — but only when **exactly one** element in the document carries that
  id. The script counts the matches before returning, and a duplicate id
  returns `""`.
- `TAG[n]` — the ordinal among same-tag elements, for an element with no id.
- `""` — anything this evaluate cannot prove a unique identity for: a duplicate
  id, or an element absent from its own tag list.

That third outcome replaced a bare tag name, and the reason is the guard, not
taste: **every `<div>` on the page shares one tag name**, so a bare `t` compares
a value many elements hold and reads a real focus move as *no move* — the
silent wrong answer this exists to prevent.

`""` → `focus_id()` returns `None` → `_focus_refusal` refuses the keystroke.
**Unknown means refuse, end to end**, and `None` is now the ordinary result for
an unnamed element, not a signal that something broke.

**One honest limit.** The enumeration binds `getElementsByTagName` once, so a
prototype swap installed *after* the bind does not decide what the list holds —
but one installed *before* the evaluate still does. Closing that needs
`Page.createIsolatedWorld`, which is the frame workstream, not a bugfix. The
gate is not unconditional and the docstring should not read as if it were.

Three rules, and the middle one is the guard:

- **Only the step's *first* dispatch is checked, and "dispatched" is decided by
  the outcome, not the verb.** Once the agent has actually moved the page, a
  changed focus is the agent's own — it clicked, then pressed — and refusing
  there breaks the ordinary click-then-Enter path that commits a search. So
  the guard arms off on `not _EXEC_FAILURE in outcome`: a click the hit-test
  refused, or that missed, or was off-screen, moved nothing, and **a refused
  click leaves the guard armed** behind it. Arming off on the verb alone is the
  fail-open direction, and the refused click is exactly the case where the
  keystroke behind it would land on the user's own draft. Read-only actions do
  not count against the step (they touch nothing), and neither does `press_key`
  itself (counting it would let a second press_key in the same batch past the
  guard that just refused the first). Cheap, and aimed at the one window where
  nothing the agent did explains the difference.
- **Unknown focus is refused.** A relay without `focus_id`, a read that failed,
  an evaluate that errored, and an element whose id `FOCUS_ID_JS` could not
  prove unique — all arrive as "we could not tell where this keystroke would
  go", which is the condition this exists to prevent. A refusal costs one step;
  the mistake it prevents does not come back.
- **The capture is unconditional, so it is not free.** One `Runtime.evaluate`
  at the top of **every** step, taken before `_plan_step`, not only on steps
  whose batch contains `press_key`. The ~30s the model spends generating is
  exactly the window a user is free to click something else in, and it is
  unobservable afterwards — capturing after the plan reads the baseline from a
  page the user has already moved focus on. A capture on only some steps is a
  guard on only some steps, and the steps it skips are the ones that press a
  key. That is one extra evaluate per step for a guard most steps never
  consult, and it is the right trade against a guard that is off exactly when
  it matters.

**Not verified in a browser** — `FOCUS_ID_JS` has not run against a live page.
The ordinal path is the part that wants a real one: a re-render that reorders
same-tag elements changes the id, which reads as a moved focus and refuses.
That is the safe direction, but it is a step cost nobody has measured. How
often a real page's focused element actually lands on the `""` path — a
duplicate id, or missing from its own tag list — is likewise unmeasured, and
it is the frequency that decides whether this guard costs a step or costs a
step per keystroke.

### Declined: `intent` / `expect` on `StepSummary`

"I aimed at X and the page did not become Y" would turn a silent loop into a
named failure, and it is not built. Recording the model's intent is easy and
recording that it was met is not: there is no verifier the loop can honestly
run. The AX diff would be the candidate and it is evidence only — D2 makes it
never a targeting coordinate source and its diff tiles say nothing about *which
element* was meant to change — so "did Y happen" can only be answered by the
model asking itself, which is D5 again. A field named `intent`/`expect` on
`StepSummary` would read in the document as evidence and be a self-report,
which is the failure this record has been cleaned of twice. It needs a real
verifier first, not a schema change.

What *is* recorded is the opposite of a self-report: the **absence of
evidence**, which the loop can establish for itself. That is the next section.

## A step that nothing could confirm

The live Google Sheets run is the failure this exists for. The agent created a
file, clicked into the grid and typed successfully — and then re-clicked the
same cell seven times across steps 3 to 9. It was not a weak model on a hard
page. For most of that run it had **no feedback channel at all**: the grid is a
`<canvas>`, the accessibility tree does not change when a cell is edited, and
the pixel delta and the screenshot had both been vetoed (a separate bug, since
fixed). And the agent's own transcript told it the previous step had worked,
so re-trying was *indistinguishable from making progress*. Nothing in the
record said "you cannot tell".

The step record now carries that fact. `StepSummary` gains two fields
(`context.py`):

- **`mutated: bool`** — whether this step dispatched something the page would
  show. A step of pure reading is not a step whose effect went unseen: the page
  not changing after a read is the expected reading.
- **`unverified: str`** — the fact itself. Empty in the overwhelming majority
  of steps.

### The three channels, and what their silence means

A step is unverified when **no channel existed** to report its effect. There
are three channels, and their silence does not mean the same thing.

- **The element tree.** On an ordinary page this *is* the channel, so its
  silence is a reading the model already has — "no changes detected" in the
  diff block — and a coarse one. A checkbox toggle changes no name and no
  value, so "the tree did not change" is wrong as often as it is right. On a
  canvas page the tree holds the app's chrome and not its content, so its
  silence says nothing about the content at all.
- **The pixel delta.** `True` means the page moved, `False` means it did not,
  and both are readings the model can act on. `None` is the unknown — withheld
  (the capture gate, a typed secret) or unavailable (first observation, after
  a navigation, a failed capture). **`None` is not `False`**, and it is never
  read as "nothing moved"; the tri-state is the whole design, and
  `deps.canvas_changed` is `True`/`False`/`None` for exactly that reason.
- **The URL.** A navigation changes it, and the tree changes with it.

So "no channel existed" is exactly one case: **a canvas page whose tree did
not change and whose pixels could not be compared.** A step whose effect was
*observed to be nil* is a different fact and is not this one.

That is also why the fact is recorded **per page**. The blindness belongs to
the page, not to each step: the page says it once, on the first blind step, and
the steps after it on that same page carry no second line. A line on every
step of a blind run is noise that teaches the model to skip the line — and the
marker says so in as many words, telling the model that steps on a page like
this stay unconfirmed until something else confirms them.

### The rule, and the three details that are load-bearing

A step is marked only when all four hold:

1. it **mutated** the page;
2. the AX tree **did not change** across it (`ax_diff == _AX_NO_CHANGE`);
3. the pixel delta was **`None`** — withheld or unavailable, never `False`;
4. the page **is a canvas page** (`_is_canvas_page`).

- **A read and a scroll are never mutations.** `_NON_MUTATING_ACTIONS` is the
  read-only actions, the terminal actions, `ask_human` and `scroll`. A scroll
  changes no name and no value, so a page that scrolled perfectly well is
  silent — calling that an unverified step would be a false alarm on every long
  page. A blocked step dispatched nothing and is not a mutation either.
- **The previous step is the one being judged.** The call site is in the
  observe block, right after `compute_ax_diff`, because that is the first
  moment the evidence exists: a step cannot know whether its own click landed
  until the page has been read again. Judging there rather than at write time
  is why the record is set once and never re-litigated.
- **Unknown is not a canvas.** `_is_canvas_page` reads the canvas coverage
  measurement, and an unavailable measurement is not a canvas page — so a page
  whose coverage we could not read is never marked. A false mark costs the
  model its trust in the line.

**The marker can only be written, never cleared.** Nothing unmarks a step, and
nothing branches on it.

`tests/agent/test_unverified_steps.py` pins each of the four conditions and
each of the ways a step escapes them — a tree that moved, a measured delta
either way, an ordinary page, a read, a scroll — plus the once-per-page rule
and the fact that the marker reaches the history line and the prompt.

### It is a fact, not a gate

`unverified` is read in exactly one place, `_history_line`, which renders it as
a second line of the history entry — and the same line comes back through
`recall_steps`, so a step the history window dropped can still be fetched with
its fact attached. **No gate, stop, approval or budget branches on it** — it is
easy to read a marker and assume a behaviour change, and there is none.

**Nothing was relaxed to make this work.** Stagnation, the delta-only stop and
the approval gates are untouched, and the marker can only be written. The
behaviour change is indirect and deliberate: the model now has a fact it did
not have ("nothing confirmed this step") plus a named response to it.
`repeat_nudge` already fires when the last two steps did the same thing; this
supplies the missing half — that the page never confirmed anything. Repeating a
click on a page that cannot show the click is not a recovery, it is the loop.

The sentence says what is **missing** rather than concluding failure, because
on a canvas page a working click and a missed one look identical and "did not
work" would be a claim the record cannot support. The behaviour that follows
from an unverified step lives in the prompt — "A step that could not be
verified" — and not in the string, because the history block is untrusted by
contract and a record carrying an order would be read as page content. The
trust hierarchy in the prompt points at that section, so the line is read as
Brotto's own fact about the page rather than something the page said.

### What it deliberately does not do

- **No self-reported `intent`/`expect` field.** The record carries what the
  loop could not confirm, never what the model says it meant or expected — a
  field the model fills in about itself would read as evidence, and it is not.
  See "Declined: `intent` / `expect` on `StepSummary`" above.
- **Not on an ordinary page.** There the tree is a channel, its silence is a
  reading, and nothing is written — an ordinary run pays no token cost for the
  marker.
- **Not on a read or a scroll**, for the reason above.
- **Not a failure verdict.** `UNVERIFIED` is neither success nor failure; it
  is the absence of evidence, and the prompt says so in those words.

### What a resumed run gets

The audit document stores turns, not step records, so the marker does not
survive a resume. The resume path **rebuilds `mutated`** from the actions in
the document, so a resumed run's later steps can still be judged — but the
blind page's earlier steps carry no marker, and the model that picks the run up
does not learn that the page had already gone blind.

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

The skip set is a named constant, `_UNSOLICITED`, and it holds exactly one member —
`navigated`. Everything else, including a frame with no `reason` at all, is solicited and
is served to the step.

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
(`harness.py:868`, now inside the `<ax_diff untrusted>` fence). On those steps it
said `(no changes detected)` — correctly, because a
stale tree genuinely has nothing new in it. The model was told, in plain text, that its
click changed nothing, and clicked again. That is the same failure as not being told; a
correct signal that gets ignored needs the underlying fault fixed, not a louder signal.

Note what this does *not* fix: a click that opens a menu still costs a step to learn it
did. The post-action frame arrives after the model has already decided, so the diff is
computed at the top of the *next* step and cannot collapse the two. What it fixes is the
model clicking a toggle three times, open-shut-open, against a menu it could not see.

### A step captured the same page twice

The fix above made the post-action frame *trustworthy*, and nothing then reused it. A live
Sheets run spent 177s over 8 steps with model generation at ~2s a call: two full captures
per step, and the second was of a page nobody had changed since the first. `_send_action`
had already blocked on a solicited frame and cached it; `get_targets()` then sent
`observe` regardless.

`_obs_reusable` is the one boolean that closes it, and it is deliberately not a cache with
invalidation rules — it is set only where a capture provably cannot be stale and cleared by
anything that learns otherwise. Reusable means all of: the frame was solicited for *this*
action (`reason` was `None`/`"action"`, already enforced by `_send_action`'s loop); the
action was not a `navigate`, whose URL will differ by the next step; and no push has been
heard since — nothing parked in `_pushed_obs`, nothing on the queue. `_absorb` clears it,
so the `get_current_url` that follows a click already disarms the frame if that click
committed a navigation.

A frame on the queue at reuse time is the same 7d567b66 failure one step later — a tree
captured before the page it describes rendered — so the reuse path refuses it and the
method falls through to a real capture. That check is why the condition is provable rather
than merely likely: reuse fires only when the relay has heard nothing since the action, and
any other arrival costs one round trip exactly as before.

`refresh_target_map()` stays a `pass`. On the Playwright relay it re-reads the DOM; here
there is no target map, and disarming on every call would disarm the frame the call itself
produced.

Pinned by `tests/test_observation_reuse.py`, because a flag that stops being set is
indistinguishable from one that is never set — `get_targets()` would just quietly go back
to capturing, at the old cost, with nothing red.

### Stagnation detection — removed, then rebuilt as a stop

The old detector is gone, and the record of why is worth keeping, because what
replaced it is the *second* attempt at the same problem and it is right for a
reason the first one got wrong.

`check_stagnation` went with `StepSummary.state`, the harness's
`stagnation_warning` message and the note it injected into the model's context.
It fired falsely on two live tasks that both went on to succeed, and **the fix
that preceded the removal was a wrong primitive, and a correct one would not
have saved it.**

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

What replaced it is **not nothing**: `harness.py` carries
`_note_stagnation(deps, url, text_len, ax_diff)`, evaluated once per step,
after observe and before the model call, with `_STAGNANT_STEPS = 5`. The model
also still self-assesses in `<stagnation_and_failure>` — same URL, same action
twice, three failed approaches — which is the part that was always sound,
because the model can see its own step history. The harness's verdict is back;
its shape is what changed, and none of the three differences is a tuning knob.

- **It reads the full target diff, not a hash of it.** The old fingerprint was
  computed from *prefixes* of the page and the budgeted tree, so it was blind
  exactly where long pages put their content. The new check compares `ax_diff`
  against the literal `(no changes detected)` (`_AX_NO_CHANGE`, named so a change
  to `compute_ax_diff`'s contract breaks there rather than silently matching),
  and checks the URL and the page-text length separately. A step is "unchanged"
  only when **all three** hold; **any one of them changing resets the count.**
- **A step made only of read-only actions resets it**, because nothing was
  dispatched — an unchanged page is the expected reading there, and a read step
  is not evidence of a loop.
- **It stops the run; it does not hint.** The old one warned at 3 steps and
  pushed two still-working tasks toward reporting early. A run that trips this
  ends with `failure_reason="page_not_responding"` and `_STAGNANT_MESSAGE`,
  which describes what was observed — "the agent acted and the page came back
  looking exactly the same each time" — and then says outright that on a
  spreadsheet or canvas editor this may be an app Brotto cannot read rather than
  a broken page. **It never claims the user made no progress.**

The threshold is 5 rather than 3 because it now *ends* a run rather than nudging
one, which is the only reason the false-positive rate could go up at all.

**What it still cannot tell you, and must never be reported as if it can.** The
detector cannot distinguish "nothing happened" from "Brotto cannot see anything
happening." On a canvas app the accessibility tree is byte-identical whether the
agent succeeded or failed, so tree stability is a signal of *blindness*, not
proof of failure. That is the honest ceiling of this feature, it is why the
reported message names what was observed rather than what it concluded, and it
is why the two known bypasses are named in a comment beside the code rather
than only here: a ticking clock or an animated banner keeps the fingerprint
moving while nothing works, and on a canvas page the page-text term is noise
rather than a signal — see below.

**The consumer that makes the ceiling smaller is a pixel delta.** The
accessibility tree is byte-identical across a canvas app's whole run, so the
detector above cannot distinguish "nothing happened" from "Brotto cannot see
anything happening" — that sentence is the ceiling, stated as such. The
extension now computes a per-tile 16×16 mean-absolute-difference over
luminance between the last two frames and ships it on the observation frame;
`ExtensionCDPRelay.get_page_delta` reads it off the *cached* observation (no
round trip) and `_delta_section` puts it in the prompt. So the model, not the
harness, sees whether the viewport moved.

Four rules hold that block:

- **Read after `get_targets()`, in the same step.** The delta rides on the
  observation that call just took; anywhere earlier it is the previous step's
  answer or none.
- **`None` renders as nothing at all.** It is the *common* answer — first
  observation, post-navigation (the clear fires on `onCommitted`, before the
  new page paints, so a navigation costs two steps), post-resize, failed
  capture, and every Playwright run — and a "no change" line there would be a
  claim about the page dressed as a claim about our plumbing. It is the same
  discipline `_STAGNANT_MESSAGE` follows in the other direction.
- **It costs no capture.** No entry against the per-task capture budget, no
  second trip
  through the screenshot path. It is arithmetic on pixels the extension
  already had.
- **Changed is not succeeded, and a tile is not an element.** A repaint
  proves pixels moved and nothing about what they say; the block forbids
  aiming a coordinate action at a region (D2).

The gate is `screenshot_block_reason` and is not weakened: **with
`BROTTO_VISION_CAPTURE` unset — the default — the delta is withheld on every
step and the feature is inert.** Turning it on also turns on viewport capture,
which is a privacy decision, not a default to take here.

#### The delta is also the stagnation *term*, and page-text length is not

**On a canvas page the pixel delta replaces page-text length as the third
progress term in `_note_stagnation`, because on such a page the length is
noise.** A Google Sheet's `innerText` is the chrome plus the caret plus the
search box, and it flickers every step — 10031 → 10044 → 10136 → 10030 — while
the grid it fails to contain is untouched. A length change therefore reset the
counter on every step, and a 23-step run never fired. The rule that replaced
it, "drop the text-length term on a canvas page", is exactly what the docstring
in `harness.py` used to get wrong in the other direction: an earlier version
claimed a canvas app "never moves it at all", which was false and was written
by us. **It moves constantly and it means nothing.** The AX diff and the URL
still count on every page, including a canvas one.

**The delta is page-derived evidence, and it inherits both ceilings.** Tiles are
evidence only, never a targeting coordinate source (D2), and it is never a
model self-report (D5) — the extension measures, and the server compares two
measurements of the same page.

**An unknown delta neither advances the counter nor produces a verdict.** It is
`None` — not `False` — on the first observation, after a navigation (two
consecutive steps: the clear fires on `onCommitted`, before the new page
paints), after a resize, on a failed capture, and on **every** step of every
run while `BROTTO_VISION_CAPTURE` is off, which is the default. With `value is
None` the term is simply absent from the comparison: a URL that moved or an AX
tree that moved still clears a standing counter, and only a real `False` counts
as no progress. The old rule required *all three* terms to be unchanged before
counting a step, and dropping the other two inside that branch is what let a
23-step run be "stopped" for having navigated.

**The two ways a delta comes back unknown are deliberately the same value.** A
page the harness refused to look at — because it carries a typed secret, or
because an ambiguous write opened the window above — and a `get_page_delta` that
raised `TabUnreachable`, both land on `None` and are
indistinguishable to everything downstream — so neither a veto nor a failed read
can read as "nothing moved", and neither can end a step. The cost is the same
on purpose: a vetoed or unreadable canvas page earns *no* progress credit from
the delta and falls back to the URL and AX terms alone, because inferring "no
progress" from a refusal to look would be the silence-is-not-a-measurement
error this rewrite exists to remove, and the stop message would be false about
the run.

**Because the delta belongs to the page, it cannot hold the loop open.** A
caret blink, a spinner, a feed repainting for its own reasons moves pixels
forever, so progress credited to the delta alone is bounded separately:
`_DELTA_ONLY_STEPS = 18` consecutive steps whose *only* evidence of progress was
the delta, on a page whose URL and AX tree never moved. Three times the ordinary
ceiling, because a real task on a canvas app — typing, a few clicks — reaches
its end well inside it and a page that repaints forever does not.

**On that path `stagnant_steps` stays 0, and the run gets its own message.** The
pixels genuinely did change, so counting them as stagnation would be false, and
`_STAGNANT_MESSAGE` ("the page did not visibly change") would be a lie about
that run twice over. `_DELTA_ONLY_MESSAGE` says what actually happened: the page
repainted every step, nothing Brotto can read changed, so it could not tell
whether the actions did anything and kept going anyway — the same guidance, the
same "this may be an app Brotto can only see pixels of", and it never claims the
user made no progress either.

The three causes were one bug each and none of them was the detector: the
screenshot never fired because the chrome matched the task's vocabulary; the
counter never fired because the text-length term was noise; and the model erased
its own work because an empty `read_page_text` read to it as an empty page.
Fixing only the third would have produced a run that confidently un-does itself
more slowly.

Pinned by `tests/agent/test_stagnation_bound.py`,
`tests/agent/test_stagnant_messages.py` and `tests/agent/test_page_delta_prompt.py`.

So the earlier reading of this section — that a runtime detector is not
shippable, because "this step changed nothing" and "this step is loading" are not
separable — was right about the *hint* and wrong about the *stop*. **The
external literature is still what it was**, and the caution still stands:
redundancy is defined there as *valid actions that produce no state change* —
literally the fingerprint that was removed, hash and all — but it is reported
as an **offline metric over recorded runs**, never as a runtime detector, and
the prescribed remedy for a redundant run is **replanning**, not detection. That
is why the softer signal still lives in the prompt. What changed is that a
browser is not a headless DOM: the viewport repaints, scrolls and animates under
the agent every step, so a *fully* unchanging viewport is a stronger fact than a
hash of a DOM prefix was. Five of them ends a run honestly; three did not earn a
warning.

`testing/outcome.py` keeps its `"stagnat"` needle on purpose: it classifies
*recorded* runs, and the runs recorded before both changes still contain those
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

Note the parallel to the stagnation stop above: a *detector* that guesses
"this run is going nowhere" is unreliable, and its false positives cost more
than the runaway it catches. The backstop reports nothing until it fires —
which is why the stagnation check only earns a place by *ending* a run with an
honest description of what it saw, rather than warning mid-flight.

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
