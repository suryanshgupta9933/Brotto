# Brotto — Claude Code project notes

Server-hosted browser automation harness: Python orchestrator (FastAPI + pydantic-ai + Playwright) drives a Chrome extension. Model-agnostic, BYOK.

**Heads up — this project is a long-term product effort.** Strategic context lives in `docs/product/`; AI-dev workflow rules in `docs/product/dev-environment.md`. Read those before non-trivial work. See "Working agreements" below.

## How this file is organised

This file is the **operative rules** — constants, file paths, the one conclusion each hard-won lesson actually needs, and pointers. The reasoning behind each ("we tried X, it failed because Y") lives in `docs/architecture/`, one file per subsystem, so a wrong fix is not re-derived a second time. **Read the linked file before touching that subsystem** — the conclusion here is not enough to change the design safely.

| Doc | Read before touching |
|---|---|
| `docs/architecture/model-config.md` | `model/`, dev-mode env defaults, provider settings, key resolution |
| `docs/architecture/agent-loop.md` | `agent/harness.py`, `agent/prompt.py`, `ax_filter.py`, retries/validation |
| `docs/architecture/conversation.md` | `agent/audit.py`, WS frames, resume/reconnect, replay |
| `docs/architecture/suggestions.md` | `agent/suggest.py`, `POST /v1/suggestions`, the suggestion box |
| `docs/architecture/panel-ui.md` | `sidepanel.js` rendering, cards, `renderMarkdown`, history rows |
| `docs/architecture/extension.md` | `background.ts`, `debugger.ts`, policy, notifications, storage |

## Repo layout

```
services/brotto-orchestrator/  — server: FastAPI + pydantic-ai + Playwright
  src/brotto_orchestrator/
    main.py                 — entry: WS handler, dev-mode env defaults
    agent/harness.py         — observe→plan→act loop
    agent/audit.py           — per-session audit document (nested JSON, files)
    model/{config,registry,store,resolver}.py — provider-agnostic model adapter
    policy/                  — the user's secure-mode policy (no server floor)
clients/brotto-extension/   — Chrome extension (TS, manifest v3)
  src/{background,sidepanel,model_config}.ts
  src/observation/          — the observation pipeline behind captureObservation()
docs/architecture/             — per-subsystem design reasoning (read on demand)
docs/superpowers/{specs,plans}/ — formal feature specs
docs/product/                  — product strategy docs

# OSS / launch surface (untracked or pending as of 2026-10-01 — see release-plan.md)
README.md  PRIVACY.md  SECURITY.md     — required for the Chrome Web Store
clients/brotto-extension/src/welcome.html — first-run screen; must carry the purpose statement
.github/ISSUE_TEMPLATE/                — bug report template
```

## Product docs (`docs/product/`) — strategic context

**Read at session start: `vision.md` (2 min) + `open-questions.md` (1 min).** Other docs as relevant to the task.

| Doc | Read when | Update when |
|---|---|---|
| `vision.md` | Session start | Strategic frame changes (rare) |
| `open-questions.md` | Session start, before big calls | Question is answered (move to `decisions/`) |
| `brotto-current-state.md` | Working on the codebase | Feature ships/rips/scope changes |
| `competitors.md` | Before positioning claims | Competitor launches/pivots/dies/raises |
| `market.md` | Before pricing/fundraising | Major analyst report or regulatory shift |
| `users.md` | Before designing a feature | New pain-point or wishlist signal |
| `positioning.md` | Before public-facing copy | White-space picks change |
| `gap-analysis.md` | When planning work | A gap fills or a new one emerges |
| `roadmap.md` | When planning work | Phase hits, misses, or re-prioritizes |
| `risks.md` | When making risk decisions | New risk emerges, old one dies |
| `release-plan.md` | **Before any launch or packaging work** | A blocker clears or a date moves |
| `cws-submission.md` | **Before touching the Chrome Web Store listing** | A store field is filled in or a placeholder resolves |
| `dev-environment.md` | Starting a non-trivial Claude session | New skill/hook/pattern becomes standard |
| `decisions/` | Before re-debating | **Append** a new file when answering an open question |

Full navigation in `docs/product/README.md`.

## Model adapter

Providers: `anthropic`, `openai`, `minimax` (reuses AnthropicFactory with `https://api.minimax.io/anthropic` as base URL). Resolution order: inline (extension) → per-user JSON file keyed by client IP → env. Full notes in `docs/architecture/model-config.md`.

- **Latency, not billing, picks the MiniMax model.** `MiniMax-M3` accepts `thinking.type="disabled"` (2–5s/step, dev default). `MiniMax-M3.1-Flash-Preview` **requires** adaptive thinking — sending `disabled` is HTTP 400, and it measured 4.5s/11s/26.5s on one prompt. It is the Token Plan model, so a subscription-only user with no M3 credits lands on it and pays that.
- **`max_tokens` and thinking are set in `registry.py`, not the harness** (`model_settings(model_id)`, wired at the `agent.run` call). `_OUTPUT_TOKEN_CAP = 32_000` everywhere — pydantic-ai's own 4096 default is below a reasoning turn and makes the error name a prompt-length problem that doesn't exist. `anthropic_thinking={"type":"disabled"}` on everything except `_THINKING_REQUIRED`; never send it to OpenAI. Pinned by `tests/model/test_registry_settings.py`.

### Dev mode

`BROTTO_ENV=dev` (default) pre-populates `AGENT_MODEL=minimax:MiniMax-M3`, `CONTEXT_WINDOW_TOKENS=1000000`, and propagates `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY`. But `.env` loads **first**, so a stale `AGENT_MODEL` in `.env` silently outranks the built-in one and pins the slow path.

- **`BROTTO_FORCE_ENV_MODEL=1`** ignores the extension's model *and* key entirely. Set it in `.env` and you never type a key in the side panel again.
- **The key must be in `.env`, not the shell.** A shell-exported token isn't inherited by a server started from Finder, a launch agent, or a fresh terminal. Verify with the environment scrubbed: `env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY ../../.venv/bin/python scripts/smoke_minimax_endtoend.py`
- Startup logs `auth env at startup: ANTHROPIC_API_KEY=set (len=125) …` — check it first when a key is rejected.
- Resolution ignores an inline config **without** a key: the extension keeps `model_config` in `storage.local` (survives restart) but the key in `storage.session` (doesn't), so every browser restart it sends a config and no key. A per-user config likewise persists the *model* only.

## What the agent sees each step

Four things per step — hierarchy (`parent_ref_id`, resolved to the nearest **kept** ancestor, or depth is 0 on most pages), hrefs (the model cannot see a page's URL space without them), page text, and `ax_filter.budget_for_window(context_window, step)` (window/20, floor 8K, cap 60K, **decaying to 30% by step 15**). The budget decides *how many* lines; `ax_filter` sorts by actionability before applying it and so decides *which* — truncation was a ranking problem, not a size one. `context_window` is resolved by `_resolve_model(deps)` *before* the loop so step 0 isn't budgeted against the wrong model. Full reasoning in `docs/architecture/agent-loop.md`.

### Frames, and why a ref is composite

The observation is the union of every frame's AX tree, not just the top frame's — the probe measured `GAP_FRAMES` on `auth-iframe`, and `getFullAXTree` takes a `frameId` and reads cross-origin frames in-process, so it is one call per frame and **no script in a foreign realm, ever**.

- **A `nodeId` is unique only within one frame.** Two frames both return `42`. The ref is `<frameIndex>:<nodeId>` — the ordinal, not the 32-char CDP id, because a ref is printed on every rendered line; `frameId` rides on the target for dispatch. `parent` is composite too and `_depths` treats it as opaque, so the server is unchanged. Parent resolution is **per frame** — the `parentId` table is that frame's own.
- **Caps are enforced in the walk: 12 frames, depth 4, 2000 nodes per tree.** Depth 4 because `MAX_DEPTH` for indentation is already 4 — anything deeper flattens out of the rendered tree anyway. A failing frame is recorded in `scan.failed` and skipped; a failed `Page.getFrameTree` falls back to the frameless main-frame read. **A capped frame is recorded as a frame, not a boolean** (`scan.cappedFrames`), because only *which* frame hit the 2000-node cut decides whether the model lost something: the main document going dark is a blind agent, an analytics embed going dark is nothing. A bare `capped=nodeCapped` fires every step and answers nothing.
- `frames` rides the observation frame and `main.py` warns when any cap trips. **The model isn't told about truncation yet** — that wants one line beside `render_ax_tree`'s "N more element(s) not shown".
- **Not fixed:** a click still dispatches by coordinate on the top session. Fine for a same-process cross-origin frame; an **OOPIF** would need `Target.attachToTarget`, a privilege expansion the probe did not show we need. Not verified in a browser.

### Convergence and step count

What the model sees is half of it; the other half is `prompt.py`'s `<convergence>` section, added after a live run took 17 steps to conclude something it had at step 5. Three gaps it closes: **a well-established "none exist" is a complete answer** (an empty list previously read as *failed to find*, licensing a wider search); **a rejected input gets one differently-worded retry, then it is a finding about the site**; and there is a per-navigation gate — *what specific evidence will this step add?* A step that cannot name it does not navigate.

- **Stagnation detection is gone** — `check_stagnation`, `StepSummary.state`, `stagnation_warning`. A detector that guesses "this run is going nowhere" fires falsely on slow-loading pages, and its false positives cost more than the runaway it catches. The model self-assesses in `<stagnation_and_failure>`, which is the part that was always sound. `testing/outcome.py` keeps its `"stagnat"` needle for classifying *recorded* runs.
- **`MAX_STEPS` is 150 and is a runaway backstop, not a limit.** The user is not bounded on session length. Terminal result is `failure_reason="runaway_backstop"`; `max_steps_exceeded` appears nowhere in `harness.py`. What actually bounds context is the three age-scaled blocks, not a turn count — the failure mode at high step counts is silent amnesia, not overflow, and `recall_steps` / `recall_conversation` address that directly.

### When the model can't decide

`agent.run(retries=2)`. Three failed output validations raise `UnexpectedModelBehavior`, and `str(exc)` is literally `"Exceeded maximum output retries (2)"` — the useful text is one `__cause__` down, so `_failure_detail` walks the chain. `_plan_step` catches it, sets `failure_reason: "invalid_decision"` naming `provider:model`, and records `code: "invalid_decision"` into `errors[]`; returning `None` lets the loop's existing abort gate pick it up. Pinned by `test_an_undecidable_model_fails_the_run_instead_of_hanging` and `test_plan_step_catches_it_and_records_why`.

**A model that omits `actions` cannot be told twice** (2 of 6 runs on a Gmail prompt, and it repeated the omission all three attempts). pydantic-ai's own retry prompt is a schema diff — `{'type': 'missing', 'loc': ('actions',)}` — which is not actionable to a model that has already written prose. So `actions` **defaults to empty** and `harness._require_actions` raises `ModelRetry` with an instruction instead, naming `task_complete`/`ask_human`/`cannot_complete` as appropriate. Defaulting is load-bearing: while the field was required, pydantic-ai rejected the call before any validator could run, leaving only the prompt that does not work. The budget is unchanged — raising `ModelRetry` spends one of `retries=2`.

### A ref that resolves to nothing is now a recorded failure

The relays used to return a *friendly sentence* for an unresolvable ref
(`"No coordinates for ref '0:99' — element may be off-screen"`), which does not
match the `Error executing:` marker, so the audit wrote **`ok: true` for an
action that never happened** — and the grounding failure rate was not merely
unmeasured, it was recorded as clean. `focus_ref`/`clear_ref` returned `None`
and no-opped silently, so a `type_text` into a hallucinated ref typed into
whatever was focused before.

Every ref-taking method on **both** relays now returns the `Error executing:`
prefix when the ref does not resolve, and `_coords` is `_locate`, returning
`(coords, reason)` so "not in the AX tree" (a grounding error) is separable
from "no box model" (a correct guess at something off-screen). `type_text`
bails if focus or clear reports failure.

**`ok` is membership, not a prefix.** The relays were necessary and not
sufficient: `harness.py` decorates the outcome as `f"Clicked [{ref}]: {result}"`,
so the marker arrives *mid-string* and a live Gmail run recorded
`'click' ok=True -> 'Clicked [13829]: Error executing: ref … is not in the
current AX tree'`. The derivation is now `_EXEC_FAILURE not in outcome`, with
the string a module constant. **The model wrote `ref: 13829` because the prompt
taught it to** — two anti-examples in `SYSTEM_PROMPT` demonstrated a bare number
while the tree renders `[0:13829]`; both are composite now, and a test greps the
prompt for `\bref \d`.

**…and the model kept doing it anyway, so `_locate` tolerates it.** Removing the
anti-examples did not stop the bare number: a later Gmail run emitted
`ref: "149099"` for a tree rendering `[0:149099]` on **4 of 4 steps**, so every
click failed, the page never changed, and each step was spent re-deciding it.
The prompt fix was necessary and not sufficient — this is a format the model
cannot be relied on to reproduce, not a prompt defect to re-fix. `_locate` now
falls back to a suffix match and resolves the bare nodeId, **refusing when two
frames hold the same nodeId** and naming them: a `nodeId` is unique only within
its frame, and guessing would click the wrong element and record `ok: true`.
A number the page has never seen still fails exactly as before — the fallback is
not a hole. Pinned by `tests/test_grounding_outcome.py` (12 tests).

**Counted over all 41 audit documents / 168 executable actions: 0 grounding
failures.** Read that narrowly — it is the Playwright path only (the extension
has never written a document), and it counts *resolution*, not *validity*: a
ref that hallucinates into a real but wrong element resolves and records
`ok: true`. The measurement is the audit, not a probe script — count `ok: false`
actions in `logs/sessions/`. **That count is now stale: the first
extension-written document recorded 7 of 42 refs failing to resolve, every one a
bare nodeId.** Full reasoning, including why "1A′: we are at 34.0% Action Object"
was wrong, in `docs/architecture/agent-loop.md`.

### A step costs ~30s, and it is *generation*, not the prompt

**Cut output tokens for latency; cut input tokens for cost.** Measured over 73
recorded steps (`corr(out,lat)=+0.876`, `corr(in,lat)=+0.660`), and the mechanism
is plain in two steps from the same inbox, same page, same prompt:

| in | out | latency |
|---|---|---|
| 25,087 | 191 | **4.3s** |
| 50,977 | 600 | 12.0s |
| 25,085 | **3,612** | **41.3s** |

Doubling *input* cost 4.3→12.0s; tripling *output* at **identical input** cost
4.3→41.3s. The stable prefix is cached, so a 25K-token prompt is nearly free and
generation runs at ~60 tok/s. The instinct to shrink the prompt buys cost and
misses the wall.

`tokens_in` is pydantic-ai's cumulative `RunResult.usage`, so it is **summed over
retries** — it is an integer multiple of the base prompt, not a step size. A 76s
step was three attempts. Retries are cheap (the prefix is cached); the 3,328
*generated* tokens were 55s of that 76s. Retries that succeed leave no trace in
the audit, so a retry-driven step looks identical to a slow one.

**What produced the 3,612 output tokens, and the fix.** Three Gmail runs recorded
`entries=0` — the scratchpad's retrieval half had *never been used*. `page_text`
already ships in every prompt, so the model never called `read_page_text`, so
nothing was ever auto-captured, so notes were the only memory that existed — and
with nothing to retrieve, the model **transcribed the page into a note**. 5,093
chars, ~1,300 output tokens, ~28 of that step's 41.3 seconds, written on the step
that then also wrote a 4,262-char summary. Details in
[the section below](#the-page-is-captured-in-code-every-step-and-the-model-cannot-write-memory)
and `docs/architecture/agent-loop.md`.

The 27K input is `ax_filter`'s ranked selection filling the 50K budget with the
*most actionable* elements rather than truncating in tree order; the old flat 6K
was smaller and blind to a control mid-page, which is the `auth-inbox` failure.
`MiniMax-M3` is not in `_THINKING_REQUIRED`, so none of this is reasoning time.
Observe+execute is 53.4% of wall, and 12s of that is one click —
`_send_action` blocks on the post-action observation.

### The page is captured in code, every step, and the model cannot write memory

`Scratchpad` has one half. **`entries`** is the correct shape — a 200-char digest
in the prompt, the body fetched on demand by `recall_memory(id)` — and
`capture_page` fills it with **every step's page**, in code, before the turn is
built, so the step's own page is in the manifest it reads. **The model has no
write action at all.** `append_scratchpad`/`write_scratchpad` are gone from
`ActionCall`, the prompt and the dispatch; `Scratchpad.notes` survives only as a
read-only legacy field so sidecars already on disk keep parsing.

- **Prompting alone did not work, and it was not a prompt defect.** The memory
  section carried two rules pointing opposite ways — *"the 3-step rule for
  notes: if you will need this again in 3 or more steps, write a synthesized
  note"* sat directly above *"never write a page's contents into a note"*. The
  model wrote a **synthesis**, which the older rule tells it to write and the
  newer one does not clearly forbid. Capturing pages made this worse, not
  better: it proved the transcription was pure duplicate. The action had to go —
  a capability the model spends 1,000 output tokens on is not a capability.
- **The measurement that decided it.** 25 `append_scratchpad` calls and 0
  `write_scratchpad` across every recorded run. ~17,000 chars were a copy of the
  page text already in the prompt, ~2,000 were step breadcrumbs duplicating
  `step_summaries`, and ~1,250 were the only irreducible use (a goal statement).
  **The six runs with the largest `tokens_out` are exactly the six whose final
  note was transcript-shaped** — 3,612 / 5,232 / 4,167 / 3,768 / 3,293 /
  2,587. One of them, `94fd2166`, spent 3,913 chars and 22 of its 33 seconds to
  first step on a note, then spent 59 more writing the same content again as the
  summary.
- **This is what makes memory work at all.** Before it, `page_text` was live-only
  and the AX tree is ref-scoped, so navigating away destroyed both — "refer back
  to that page instead of going back" was not achievable, and writing the page
  down was the model's only option. `entries` carries `url` because three pages
  in one run are otherwise indistinguishable.
- **The AX tree is deliberately *not* cached.** A ref is valid only for the
  observation that produced it; a cached tree hands the model refs that resolve to
  nothing or, worse, to the wrong element. Page text is safe precisely because it
  carries no refs.
- **Recall is for pages you have navigated away from, never the page in front
  of you.** Removing the write action moved the cost rather than removing it:
  the prompt's *"the summary must be grounded in memory… recall the relevant
  entries to verify the wording"* made a live Gmail run call `recall_memory` on
  step 0 of *"Summarise today's inbox"*, re-reading ~11K chars the prompt was
  already carrying in full. The manifest entry whose `url` equals `current_url`
  is now marked `← THIS PAGE … do not recall`; earlier pages stay unmarked, or
  "go back to that page" becomes unreachable.
- **`body` goes to a second sidecar, not into the audit document.** `set_scratchpad`
  runs every step and rewrites the whole file; `model_dump()` carried `body`,
  which was free while nothing was captured and is 200KB per 20 pages now that
  every step captures one. The document keeps id/step/selector/url/digest;
  `<session>.pages.json` holds the bodies. **JSON, not the manifest's
  line format** — page text is arbitrary content and can contain a line that
  looks like a manifest header, and that format predates bodies so files on disk
  must keep parsing byte-identically. A resumed run now recalls **whole pages**;
  the "only the digest survived" marker is the legacy path (no bodies file), and
  a missing or corrupt one degrades to digests rather than raising.

**The observation now reports its own cost.** `waitForStable` and `boxMap`
returned a `Stability` and a `GeometryResult` and `captureObservation` threw
both away; `metrics` ships `scans`, `bytes`, the stability verdict and
`geometry.{requested,resolved,fallback,truncated,source}` on the observation
frame, and `main.py` logs it. **`scans` is the one to watch** — it is 1 on a
page that went still and 1–4 on one that did not. The per-CDP-call probe numbers
(geometry fallback is super-linear past `MAX_GEOMETRY_ENTRIES`; the 3s quiet
floor is constant; pooling at 6 is worth 5.1–5.5× at realistic frame counts; a
cross-origin embed is an OOPIF and invisible to `Page.getFrameTree`) are in
`docs/architecture/agent-loop.md`.

**The three serial CDP loops are pooled** (`pooled` in `surfaces.ts`,
`CDP_CONCURRENCY = 6`): per-frame `getFullAXTree`, the supplement's
`DOM.getNodeForLocation`, and the geometry fallback's `DOM.getBoxModel`.
**Results are written by index, never appended** — a supplement ref is
`-(i + 1)`, so completion order would renumber every `aria-hidden` control and
the tree would still parse. Frame bookkeeping (`cappedFrames`, `failed`) is
deliberately *not* pooled; it is filled in one sequential pass after the reads
land. `sendCommand` re-attaches **once per tab**, shared by everything in
flight, or six concurrent calls would each race their own `attach`.

**The rescan is gated on the page having gone still**
(`pageMayStillBeMoving` in `stability.ts`): a page that sat still for the full
quiet window skips the retry loop, which took ~3.0s off every settled
observation. The predicate is `stability.waited`, **not `!timedOut`** — the
catch path returns `{waited:false, timedOut:false}` for a tab that navigated
mid-observe, and skipping there is how a half-rendered tree reaches the model.
`auth-slowjs` (control at 5000ms → never settles → deadline) rescans exactly as
before, which is the regression gate.

**The 3s quiet window is unreachable on an animating page, and that page is the
common one.** Gmail measured 41 mutations in 10,002ms — one every ~244ms — so
3s of silence is arithmetically impossible and every observation paid the full
10s deadline: 10.002s of an 11.19s observation, **47.7% of the wall clock of a
two-step run, every step, forever.** The gate now **samples at 1000ms and gives
up early if ≥3 mutations landed**: a page already churning hard at a second in
is past its initial render, not about to make one. Expected Gmail observation
10.8s → ~1.4s. `Stability.early` marks it and `waitForStable({noEarly:true})`
disables the sample for the fallback.

**The short-circuit is a guess, so `captureObservation` checks it.** If every
rescan saw a different `role|name|value` fingerprint the page really *was*
still moving and the short path read it early — so the guard pays the full
quiet window (`noEarly`) and scans once more. That is the pre-existing
behaviour on the slow-renderer shape; on the fast path the rescans match and the
guard costs nothing. **Misclassifying toward "busy" is safe and cannot corrupt
anything**; the sample can only ever report `waited:false`, never `waited:true`.
Pinned by `scripts/test-observation-rescan-guard.test.js`. The thresholds (3 per
1000ms, calibrated from one Gmail sample at 4.1/s) are a starting point — a
miss costs time, never accuracy, and the metrics already flow back.


### The model could not press a key

A 19-step HDFC UPI run burned 158s and ~19 model calls without executing a
single search. Gmail's search box is a combobox that commits on Enter, and
**there was no way to press Enter.** Three defects compounded, and only the
first is visible in a diff:

- **No `press_key` action.** The extension already implemented the dispatch
  (`background.ts`, `t === "key"`) and **nothing constructed it** — dead
  code, and `ActionCall` had no such Literal, so pydantic rejected the call
  before the harness saw it. The model typed into the search box six times
  and never submitted. Now `press_key(key, modifiers)`, on both relays.
- **`modifiers` was dropped in the key handler.** The relay sent
  `{type:"key", key:"a", modifiers:2}` (Control) and the extension read only
  `action.key`, so `clear_ref` — click, then Control+A — dispatched a bare
  `"a"` and **typed a letter into the field instead of clearing it**. Each of
  those six steps therefore appended another `a` to the query, which is why
  the model saw "my query" in the box and misread the stall as an unrun
  search. `scripts/test-key-dispatch.test.js` extracts the branch from source
  and evals it against a fake `dbg`, because a dropped field is an absence
  and reads clean in review.
- **`scroll` read `amount_px` while the model sends `amount`**, so every
  scroll silently became 300px.

**The evidence is in the page, not the trace.** Captured page text (memory
`r4`) contains Gmail's own `All search results for "..." Press ENTER`, and
the model's reasoning at step 16 says *"Pressing Enter to run the search"* —
then emits `type_text` again. It identified the missing capability three
times and had nothing to do with it. `ax_chars` moving 1802→2661 across 17
steps is the fingerprint: a step that changes nothing.

The prompt also documents the semantics now (`type_text` only inserts; follow
with `press_key Enter`; or `navigate` to the results URL, which **had already
worked at step 2** and the model abandoned unprompted).

**Ruled out, because it looked like the cause:** the `[redacted:password]` on
those `type_text` args. Redaction happens at audit-write time
(`harness.py` → `_scrubbed`); `_execute_action` receives the original `call`.
The model typed real queries. It is over-redaction of a search box, not the
bug.

### Mid-task steering

The composer stays live while `executing`; it posts `{"type":"steer"}` and the correction lands next turn. Three things are load-bearing: **`deps.steering` is a plain slot, not a queue** (every approval site does a bare `human_input_queue.get()` and would read a steer as a *deny*; a slot also gives last-write-wins free); **the drain is immediately above `AgentTurn(...)`, not at the loop top** (the policy block above it `return`s and the login guardrail `continue`s, so an earlier drain reads a message and drops the step holding it — and the drain clears as it copies, or the correction replays every step); **the prompt block goes last**, because the AX tree above is thousands of tokens and an earlier correction gets read past.

## Conversation lifecycle

The harness is **stateless per step** — every `agent.run` is a freshly rebuilt prompt with no `message_history`, so `step_summaries` + `scratchpad` *are* the model's entire history. That is what makes resume a reconstruction rather than a guess. Full design in `docs/architecture/conversation.md`.

- **`task_start`'s `resume: bool` is the whole fork.** `_conversation_state()` returns `new_task` / `resume` / `refuse` and is the only place that decides. A frame *without* the flag defaults to follow-up, because an extension predating it never reconnects with resume intent.
- **`status: running` on disk means *abandoned*, not live.** `main.py` has already refused a concurrent `task_start` (`duplicate_task_start`, `websocket.close(4009)`), so by the time `_conversation_state` runs, `running` means abandoned. Seal it `interrupted` via `audit.seal_task` and append the new task — keep the record on top, never replace it.
- **A turn with `ended_at: null` is unfinished, never a resume point** — same reason an approved-but-unexecuted action is not replayed as if it had. A `new_task` starts at step 0 with no `step_summaries`, so it can never look like it ran.
- **A new prompt works after every stop reason**; resume works only for a genuinely unfinished run and refuses a finished or cancelled one. Pinned by `test_a_new_prompt_works_after_any_stop_reason` and `test_only_an_unfinished_run_can_be_resumed`.
- **Every new task calls `begin_task`, including the first on a fresh session.** Gating that on an existing document lost the conversation's first task; three tests in `test_conversation.py` drive `run()` twice against one real document, not a decision function.
- **A window is only worth having if there is a way back to what it dropped.** `<conversation>` is first 2 + last 6 and *names the id range it elided*; `recall_conversation(from, to)` fetches it. Same for `_HISTORY_WINDOW` (12) and `recall_steps(from, to)`. Truncation is head+tail, never head — a `task_complete` summary opens with the method and closes with the findings, and the follow-up asks about the findings. The 1200-char cap is rendering only; the record is never truncated.
- **KV cache:** the stable prefix is `SYSTEM_PROMPT + secure_prefix + <conversation> + ## Task` (~8–9.5K, byte-identical every step). The growing step list sits *after* that boundary. Don't reorder.
- **A v1 document is un-continuable** — it has no `tasks[]` to append to, and it is refused on schema *before* status so an abandoned v1 run isn't half-migrated.
- Resume restores `visited_domains` from **approved** first-navigation events only; re-adding an unapproved domain would skip the prompt that exists to ask. A stopped task and a dropped socket look identical server-side, so the client says which in a `cancel` frame; a user-cancelled run is sealed `cancelled` and never reconnects (the extension's full-jitter reconnect reuses the `session_id`).
- A corrupt / wrong-version / already-ended document is reported `interrupted` with the reason, **never silently restarted** — a silent restart re-runs approved actions. The refusal is recorded on top, and a corrupt file is left byte-for-byte.

**Not verified in a browser:** the reconnect path and the offline-history fallback are unit-tested logic only.

## Audit trail

One nested-JSON document per session at `logs/sessions/<session_id>.json` — `schema_version: 2` splits it into `tasks[]` (per user message), `messages[]` (the readable transcript) and `turns[]` (the audit, each carrying `task` as the join). `GET /v1/sessions/{id}/audit` serves it. No database; the file is the record. `atomic write via .tmp + os.replace` **is** the whole durability mechanism — a crash mid-write leaves the previous valid document. `json.dump` does not sort by default, so **key order inside a turn is causal and the tests assert it**: `model → prompts → actions`.

Other load-bearing bits, all in `docs/architecture/conversation.md`: writes never raise (a failed flush bumps `dropped_writes` and logs the exception *type* only — the message quotes the document); the scratchpad is per-**session**; `is_secret_field` lives in exactly one place and every ambiguous branch resolves toward redact.

## Extension runtime

`model_config` → `chrome.storage.local`; `api_key` → `chrome.storage.session` (cleared on browser restart — the cause of the recurring `AnthropicProvider(api_key=…)` error, and why the key belongs in `.env`). A one-shot migration on first read after an update moves the legacy `{modelConfig: {...}}` shape. Details in `docs/architecture/extension.md`.

- **Domain blocking is one list — the user's.** No server floor, no `policy.json`, no `merge()`. There *was* a second code path and it rendered nothing: a self-hosted install never shipped a `policy.json`, so `FLOOR_POLICY` was always empty and the panel's "Brotto refuses these too" list always came back blank. Every three-way union existed to describe a distinction that never occurred. `Policy`/`UserPolicy` stay so old files with removed `whitelist`/`block_blacklisted` fields still parse (pinned by `tests/test_policy_schema.py`).
- **Notifications gate on different things.** `notifyBlocking` always speaks up; `notifyResults` (default **on** — Brotto's premise is you leave it running and come back later) only when nobody's watching. "Watching" is a **boolean on the keep-alive port** driven from `focus`/`blur` at module scope, not port liveness and not `hasFocus()` (forced `true` under CDP focus emulation, so untestable in the harness). A click focuses the window and deliberately does not call `chrome.sidePanel.open()` — that needs a user gesture (chromium bug 40929586).
- **The debugger can vanish mid-run and nothing raises on the sending side** — the next `sendCommand` is where it surfaces. Only two reasons exist: `target_closed` and `canceled_by_user` (DevTools opened on the tab). Switching tabs does *not* drop it. `sendCommand` re-attaches once and retries; `background.ts` notifies, because the re-attach takes the tab back from DevTools. **Not fixed, deliberately:** the resulting empty observation is still handed to the model as a page. **Not verified in a browser.**

## Idle-page suggestions

`POST /v1/suggestions` → a standalone `Agent` (no `output_type`, its own `SUGGESTION_PROMPT` — the harness's `SYSTEM_PROMPT` has the wrong identity) given URL, title and **visible page text** read on demand via `chrome.scripting.executeScript`. Over HTTP, not the WebSocket — the socket only exists while a task is in flight, which is exactly when the panel doesn't need suggestions. Details in `docs/architecture/suggestions.md`.

- **To improve these, fix the prompt. Adding a site table is the bug.** Two table versions were generic everywhere except the sites someone had thought of; a third was model-written but URL-and-title only, so `chrome://extensions` got described back to itself as a task. **Absence of signal renders as confident specificity** — hence `context_used: false` tells the model the text is unavailable rather than letting it invent a subject.
- Two filters sit between the model and the button: `_is_destructive` and `_is_declining`, both anchored on the **leading word** (a suggestion is an imperative, so the first token is the verb). Declining is a closed set — the prompt asks for a literal `NONE`; told it may return nothing, the model returned prose about declining, which rendered as a clickable button. **An empty list is a correct outcome.**
- **This reads the user's page with no task in flight** — an escalation from requested to ambient, and the one default here chosen rather than tested. Ships on, mitigated by a short TTL (10 min context-derived, a day for URL-and-title-only, chosen from the server's `context_used`). **There is no indicator in the panel.**
- **Read the real output before believing a change here.** All three earlier versions looked fine in a diff and were only caught by running them against real pages and reading the sentences.

## Panel rendering

Cards (clarify/approval/login) answer **in place** — `resolveCard` drops the controls, puts the answer where they were and clears `.blocking`; the reply goes *inside* the card, not beside it, so the exchange reads as one exchange. Replayed cards are marked `.resolved` so `clearLoginPrompt` doesn't sweep live history. `renderMarkdown` is hand-rolled and escape-first: blocks parsed from raw lines, then inline per block, with code spans pulled out first via a NUL-delimited placeholder (a printable one would eat a real " 12 " in a price), and link hrefs must match `https?://` explicitly so `javascript:` stays visible text. **Not one string reaches `innerHTML` unescaped** — the model's own words are steerable by page content, so `appendPlanCard` builds its badge, sites line and step numbers with `textContent`/`createTextNode`. Clicking a history row **replays into live chat bubbles**, rebuilt from `tasks[]`/`turns[]`/`prompts[]` rather than `messages[]` alone; a turn draws a step bubble only if it had an external action. **Not verified in a browser** — `scripts/test-replay.test.js` is the only check, and it extracts the real functions by brace matching so it can't drift. Full text in `docs/architecture/panel-ui.md`.

### The panel shows a working line, and streaming would not have fixed it

**Don't move this to the streaming API.** Three independent reasons, any one sufficient. `AgentDecision` is structured JSON (`thought` + `actions[]`) — there is no prose token stream, and `thought` is ~10 tokens. The latency is in **silence, not text**: observe (~11.8s) and model_plan (~13.8s) both complete *before* `step_progress` fires, so ~25s of a ~30s step produces no frame at all. And panel-closed forbids it structurally — no socket means no stream, and reopening replays a finished record.

- **The frame is a phase key, not a sentence.** `harness.py` sends `{"type":"canonical_step","kind":"observe"|"plan"}` at the two boundaries; `WORKING_LINES` in `sidepanel.js` maps each key to panel-owned English. A wording change is then a panel edit, not a server deploy — presentation lives where rendering lives. The frame is not audited (it is a live UI frame; the timings it summarises are already in the document).
- **The bug was a wired feature nobody sent.** `canonical_step` had a panel handler, a bubble builder and a closer, and **had never once run** — `finishAssistantMessage` had no call site, so the caret blinked for the life of the panel. That is the "looks stuck" complaint, named. It was never a missing feature but a missing producer.
- **A line is held 700ms** (`setWorkingText`). A cached page answers in under a second and the two phase lines would otherwise flash past unread, which reads as *more* broken than the silence this replaced. A burst inside one hold collapses to the last line rather than showing one and immediately overwriting it.
- **The bubble and its ticker are torn down together.** `dropWorkingMessage` calls `stopSpinner` *before* the null check — otherwise the interval outlives the node it animates and writes frames into a detached element every 90ms. It fires from `setPhase` (any phase but `executing`), `step_card`, and `context_update` (which the server sends *instead of* `step_progress` when a step had no visible action).
- **`SPINNER_FRAMES` is data, not mechanism** — `{frames, ms, back}`, five sets, randomly picked, each with its **own cadence** because same-shape-at-same-speed reads as one spinner. `back: true` ping-pongs instead of wrapping; `bar` needs it or it snaps `█` straight back to empty. Three rules keep a sixth set honest, and all three are asserted in the test: no two sets share a cadence; every frame is Block/Braille/Arrow (`0x2580–0x259f`, `0x2800–0x28ff`, `0x2190–0x21ff`) — **no curves**, since the sheet sets `border-radius: 0 !important` globally, so a circle is the one shape this panel has no vocabulary for; every frame is one character. `.working-spinner` has a fixed `width: 1em` and is load-bearing — the glyphs are different widths, so without it the line reflows on every frame. `prefers-reduced-motion` is honoured in **JS** (`matchMedia`), because the stylesheet's reduced-motion block cannot reach a ticker; it still shows a frame, it just stops ticking.
- **Pinned by `scripts/test-working-line.test.js`** (49 checks), which stubs `Math.random` to walk all five sets deterministically — the picker is a coin toss, so testing only the drawn set leaves four of five unexercised most runs. **Not verified in a browser**: `▛▜▙▟` and `▖▘▝▗` at 11px are the two most likely to render as tofu.

## Commands

```bash
# Build extension (TS→JS bundle)
cd clients/brotto-extension && npm run build

# Run server (dev mode picks up .env)
cd services/brotto-orchestrator && python start_server.py

# Python tests — run from services/brotto-orchestrator/
../../.venv/bin/python -m pytest tests/ -q

# Extension JS tests — run from the REPO ROOT, not clients/brotto-extension
node scripts/test-replay.test.js           # or any other scripts/*.test.js

# Smoke test (real API call, exercises full model adapter; reads .env)
.venv/bin/python scripts/smoke_minimax_endtoend.py
```

The pytest install lives in the **repo-root** venv, not `services/brotto-orchestrator/.venv` (which has pydantic-ai but no pytest).

**`npm test` runs nothing.** It is `node --test tests/*.test.js`, and `clients/brotto-extension/tests/` does not exist — the 10 suites live in repo-root `scripts/`. Repointing the glob would newly *enable* ten never-executed suites, which is a bigger change than the one-word fix looks; until someone does it deliberately, run them directly. Every `scripts/*.test.js` is extraction-based: it pulls the real functions out of `sidepanel.js` / `background.ts` by brace matching and evals them against a fake DOM, so it cannot drift from what ships. A dropped field is an *absence* and reads clean in review, which is the whole reason they exist.

## Gotchas

- **`/ws/ext` is unauthenticated.** `main.py:454` is a bare `await websocket.accept()` with no token, and it is the *only* path a Chrome Web Store install uses. Anyone who can reach a self-hosted server's URL can drive the agent against that user's logged-in browser. Hard launch gate — do not ship the store listing until it is closed. Listed as Wave 3 auth in `release-plan.md`, but it is not in that doc's blocker table either.
- **`.gitignore` lists `/docs/` and `/CLAUDE.md`, but 27 files under `docs/` and this file are tracked** (force-added with `git add -f`). New docs are ignored by default and silently local-only — that is the failure, not the absence of tracking. `vision.md`, `users.md`, `market.md`, `risks.md`, `gap-analysis.md`, `competitors.md`, `dev-environment.md`, `release-plan.md` and `cws-submission.md` are **not** yet tracked.
- `.env` is gitignored and there is no `.env.example`; the `.env` itself carries the comments.
- Don't include `Co-Authored-By: Claude ...` in commit messages (per global `~/.claude/CLAUDE.md`).
- **`decisions.md` is locked architectural decisions (D1–D10).** Don't change without explicit re-discussion. Product/strategy decisions live in `docs/product/decisions/`.

## Working agreements (AI-assisted dev)

Full list in `docs/product/dev-environment.md`. The non-negotiables:

1. **Read product docs at session start** (vision + open-questions minimum).
2. **Check `open-questions.md` before any fork-shaped decision.** If unresolved, **stop and ask the user** — do not implement past an unresolved fork.
3. **Update the doc you're working from in the same commit as the change.** Stale product docs are worse than no docs.
4. **Append decisions to `docs/product/decisions/`, never edit history.** When superseded, write a new file.
5. **Use superpowers before plan mode.** Brainstorming first, writing-plans second, then ExitPlanMode. Use `subagent-driven-development` for parallelizable features.
6. **Ponytail reflex on code.** Ladder: needs to exist? → already in codebase? → stdlib? → native? → installed dep? → one line? → minimum.
7. **Bug fix = root cause.** Grep every caller of the function you're about to touch before editing. Fix in the shared function, not every caller.
8. **No unrequested abstractions, no scaffolding "for later", no half-finished implementations.**
9. **Comments only when WHY is non-obvious.** Don't repeat the code.
10. **Don't include `Co-Authored-By: Claude ...` in commit messages.** Per global `~/.claude/CLAUDE.md`.
11. **The "we tried X and it failed" reasoning lives in `docs/architecture/`, not here.** When you land a non-obvious conclusion, add it to the matching file in the same commit — and if the operative rule in this file changes, change it here too.
