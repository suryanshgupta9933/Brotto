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
- `filtered_ax` keeps the first lines in tree order and drops the tail when over
  budget (`ax_filter.py`). On the extension path `viewport_coords` is `None`, so
  the drop is by tree position, not by what is on screen.

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

### A model that cannot decide fails the run

`agent.run(retries=2)` at `harness.py:173`. When the model fails output
validation three times, pydantic-ai raises `UnexpectedModelBehavior` and
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
one of `retries=2`, so a model that ignores the instruction three times
still ends the run instead of spinning. What changed is what it is told.

The second, rarer mode is a response with no text and no tool call at all,
which pydantic-ai reports as `ToolRetryError: Please return text or include
your response in a tool call.` That one usually recovers on its own — it
appeared in 1 of 6 runs and the retry fixed it — and the same measurement
run had the model recover from the `actions` omission on its second attempt
too, which is why the instruction above has to be this explicit rather than
merely different.

**Not done:** cross-task memory. `Scratchpad` is per-task — persisted to
`logs/runs/<id>/` for resume within a task and gone otherwise, so
`github.com/<user>/issues/assigned` (the entry point discovered on that run) is
relearned every run. The obvious durable content is *where things live on a
site and which routes are dead*: a per-user JSON store in the shape of
`model/store.py`, injected at the top of every task. Unbuilt.
