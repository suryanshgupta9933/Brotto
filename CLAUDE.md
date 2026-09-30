# Brotto — Claude Code project notes

Server-hosted browser automation harness: Python orchestrator (FastAPI + pydantic-ai + Playwright) drives a Chrome extension. Model-agnostic, BYOK.

**Heads up — this project is a long-term product effort.** Strategic context lives in `docs/product/`; AI-dev workflow rules in `docs/product/dev-environment.md`. Read those before non-trivial work. See "Working agreements" below.

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
docs/superpowers/{specs,plans}/ — formal feature specs (force-add with -f)
docs/product/                  — product strategy docs (gitignored; force-add)
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
| `dev-environment.md` | Starting a non-trivial Claude session | New skill/hook/pattern becomes standard |
| `decisions/` | Before re-debating | **Append** a new file when answering an open question |

Full navigation in `docs/product/README.md`.

## Model adapter

**Always-available providers** (`brotto_orchestrator.model.registry`):
- `anthropic` (claude-3-5-sonnet-latest)
- `openai` (gpt-4o, gpt-4o-mini, o1)
- `minimax` (MiniMax-M3.1-Flash-Preview, MiniMax-M3, MiniMax-M2.7) — reuses AnthropicFactory with `https://api.minimax.io/anthropic` as base URL

**Per-task resolution** (`resolver.resolve_model_config`):
1. inline_config / inline_creds (from extension's task_start)
2. per-user JSON file keyed by client IP
3. env vars (`AGENT_MODEL`, `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`)

**MiniMax model choice** — latency, not billing, is the deciding factor:
- `MiniMax-M3` — accepts `thinking.type="disabled"`. Measured 2–5s/step end-to-end. Dev default.
- `MiniMax-M3.1-Flash-Preview` — **requires** adaptive thinking; sending `thinking.type="disabled"` returns HTTP 400. Measured 4.5s / 11s / 26.5s across three runs of the same prompt, with a `ThinkingPart` on all but the first. It is the Token Plan model, so a subscription-only user who has no M3 credits has to fall back to it and pay that latency.

**`max_tokens` and thinking are set in `registry.py`, not the harness.** Each factory exposes `model_settings(model_id)`, wired at the `agent.run` call in `harness.py`:
- `_OUTPUT_TOKEN_CAP = 32_000` on every provider. pydantic-ai's own default is 4096, below what a reasoning turn produces, and the failure names a *prompt-length* problem that does not exist ("simplify the prompt to result in a shorter response"). A cap is a ceiling, not a reservation, so a generous one costs nothing.
- `anthropic_thinking={"type":"disabled"}` on every model except `_THINKING_REQUIRED` (`MiniMax-M3.1-Flash-Preview`). Don't send it to OpenAI providers.

Both are pinned by `tests/model/test_registry_settings.py`, which fails with the reason in the test name.

## Dev mode

`.env` is loaded first at `main.py` module load (before the dev defaults below, so an `AGENT_MODEL` in `.env` wins over the built-in one), then:

`BROTTO_ENV=dev` (default) pre-populates env vars:
- `AGENT_MODEL` defaults to `minimax:MiniMax-M3` — provider is `minimax`, not `anthropic`, because the `minimax` factory carries the `https://api.minimax.io/anthropic` base URL. **The `setdefault` is inert whenever `.env` names a model**, so a stale `AGENT_MODEL` in `.env` silently outranks this and pins the slow path.
- `CONTEXT_WINDOW_TOKENS` defaults to `1000000`
- `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` propagation (idempotent; Token Plan users have AUTH_TOKEN, pydantic-ai reads API_KEY)

Set `BROTTO_ENV=prod` to opt out — server then uses whatever operator configured (extension settings, .env, AGENT_MODEL).

**`BROTTO_FORCE_ENV_MODEL=1`** — ignore the extension's model *and* key entirely, run on `.env`. Set it in `.env` and you never type a key into the side panel again. Also set in `tests/conftest.py`-neutralised scope so it can't leak into the suite.

**The key must be in `.env` itself, not in the shell.** Reloading the extension clears `chrome.storage.session`, so the key it sends disappears on every reload — which is what produced the recurring `AnthropicProvider(api_key=...)` error. With `BROTTO_FORCE_ENV_MODEL=1` the extension's key is never consulted, so the only thing that matters is `ANTHROPIC_AUTH_TOKEN` being in `.env`. A shell-exported token is not enough: it isn't inherited by a server started from Finder, a launch agent, or a fresh terminal. Verify with the key scrubbed from the environment entirely:

```bash
env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY \
  ../../.venv/bin/python scripts/smoke_minimax_endtoend.py
```

A keyless `AGENT_MODEL` now raises at resolution time naming the variable and `.env`, rather than deferring into the provider constructor where pydantic-ai reports it as a generic `AnthropicProvider` error that names neither the model nor the file.

Startup log line shows resolved auth state immediately:
```
auth env at startup: ANTHROPIC_API_KEY=set (len=125)  ANTHROPIC_AUTH_TOKEN=set (len=125)  BROTTO_ENV=dev
```

## Model resolution (`model/resolver.py`)

Tiers: inline (extension) → per-user file → env. Two rules that aren't obvious:

- An inline config **without** a key is ignored and falls through. The extension stores `model_config` in `chrome.storage.local` (survives restart) but the key in `chrome.storage.session` (does not), so every browser restart it sends a config and no key. Honoring that gave a keyless provider and "Set `ANTHROPIC_API_KEY`" while shadowing a working `.env`.
- A per-user config persists the *model* only, never a key — so after a browser restart it is unusable on its own and the resolver says so explicitly.

## What the agent sees each step

Four things arrive per step. All four were captured and thrown away at some point, and each omission cost real steps on a live run:

- **Hierarchy** (`SemanticTarget.parent_ref_id`, resolved to the nearest *kept* ancestor). Rendered as indentation. Flat, a repo's star count sat eight lines from its name with nothing marking the record, and the model guessed which one it belonged to. Resolution walks the full `parentId` chain — a link's direct parent is almost always a `generic` container that gets filtered, so resolving only the direct parent yields depth 0 on most real pages. This is also why `listitem` / `row` / `gridcell` are in the extractor's kept set: they're nameless, never render, but they're the parent a record's fields resolve to.
- **Hrefs** (`SemanticTarget.href`, from the CDP `url` property, links only). Without them the model cannot see a page's URL space at all and guesses at deep-link patterns. This is the general mechanism for "use deeplinks efficiently" — no site-specific knowledge anywhere.
- **Page text** (`AgentTurn.page_text`, innerText, every step). The only source for values the AX tree omits — a repo's star count, a price. Costs nothing on the extension path (rides along in the `Runtime.evaluate` that already fetches url/title). `read_page_text` remains the targeted tool for a selector or `around` region.
- **Budget** — `ax_filter.budget_for_window(context_window)`, a twentieth of the window, floored at 8K and capped at 60K. Over budget, whole lines are dropped and the count is reported; the tree is never sliced mid-element. The old flat `MAX_CHARS = 6000` truncated a real GitHub list page at 6041 chars.

`context_window` is set on `deps` by `_plan_step` once the per-task config resolves, so step 1 falls back to the env default.

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
hint, not a safety net — `MAX_STEPS = 30` is the net. The run that motivated
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

**Not done:** cross-task memory. `Scratchpad` is per-task — persisted to `logs/runs/<id>/` for resume within a task and gone otherwise, so `github.com/<user>/issues/assigned` (the entry point discovered on that run) is relearned every run. The obvious durable content is *where things live on a site and which routes are dead*: a per-user JSON store in the shape of `model/store.py`, injected at the top of every task. Unbuilt.

## Idle-page suggestions

The three task suggestions on the idle panel are **written by the model**, not
by a table. `POST /v1/suggestions` → `agent/suggest.py` → a standalone
`Agent` with no `output_type`, given the page's URL, title, and **visible page
text**.

Three hand-written versions came and went first: a 17-hostname table, then a
bigger one (15 page classes × 6 lines, 20 object kinds × 2 lines, ~130 lines of
copy). Both were correct on the sites someone had thought of and generic
everywhere else — the same failure, twice, at two scales. **The moment you
want to improve these, fix the prompt. Adding a site table is the bug.**

A third version was model-written but still **URL and title only**, and that was
the same bug in different clothes. On a new tab and on `chrome://extensions`
the generator received a page *class* and nothing else, so it wrote each page's
own manual back as a task — "List every installed extension along with its
current enabled or disabled state" is `chrome://extensions` described to itself.
Absence of signal rendered as confident specificity.

Five things that are load-bearing:

- **HTTP, not the WebSocket.** The socket is created in `startRelay`
  (`background.ts:505`) and only exists while a task is in flight — which is
  exactly when the panel does *not* need suggestions. `/v1/policy_ack` set the
  precedent for idle-time actions.
- **Page text, read on demand.** `chrome.scripting.executeScript` from the
  panel, which needs the `scripting` permission. Not a permanent content script
  (`host_permissions` is `<all_urls>`, so that means Brotto inside every site
  the user visits) and **not the debugger** — that raises Chrome's "debugging
  this browser" banner, a heavy thing to show someone who opened a panel to
  read a list. `chrome://` pages refuse the script; that arrives as
  `context_used: false` and the prompt tells the model the text is
  unavailable, so it must not invent a subject to fill the slot.
- **A standalone Agent**, not the harness's. That one is bound to
  `AgentDecision` with a `SYSTEM_PROMPT` whose identity is "you are not a
  chatbot" — wrong for a suggestion writer, which is why `SUGGESTION_PROMPT` is
  a separate constant rather than a section of `SYSTEM_PROMPT`.
- **The fallback stays site-agnostic.** Three lines in `FALLBACK_SUGGESTIONS`.
  The good path is a cache hit most of the time, so if the fallback grew a site
  table the failure would be invisible — it would just look like a cache.
- **Two filters between the model and the button.** `_is_destructive` drops a
  line that opens by proposing a change — deleting, disabling, sending, paying
  — because a destructive task offered as a casual one-liner is how it happens
  by accident. `_is_declining` drops the model's refusal. Both anchor on the
  leading word, since a suggestion is an imperative and the first token is the
  verb; matching anywhere in the line would throw away "summarise the thread
  about deleting the old branch".

**Declining had to become a closed set, which took two attempts.** The prompt
allows fewer than three and none at all. Told it may return nothing, the model
returns *prose about declining* — truncated to the panel's width, "I can't
return anything for this page, it's the browser's own extensions settings…"
rendered as a clickable button. It came back in three different shapes across
three runs, so matching prose was a losing game. The prompt now asks for a
literal `NONE` (a closed set, one comparison) and the prose openers are kept
only as a named backstop for a model that ignores the sentinel. **An empty list
is a correct outcome**: the panel already treats it as "keep your own fallback".

Cache key is `host + pathShape + YYYY-MM-DD` in `chrome.storage.local`, with
numeric and UUID path segments collapsed to `:id`, capped at 40. Entries carry
a TTL, and **it is short when page text was used**: "three emails from your
manager" is page content, and a day-long entry is that content left on disk.
Ten minutes context-derived, a day for URL-and-title-only, chosen from the
server's `context_used` rather than guessed at from whether the read
succeeded. The panel paints the fallback first and swaps in the generated set
when it lands, so the box is never empty and never waits on a model call.

**This reads the user's page with no task in flight.** That is a real
escalation from "the user asked for something" to ambient, and it is the one
default here that was chosen rather than tested. The user owns the key and the
extension already held `<all_urls>`, so it ships on — TTL as the mitigation,
and a `page text N chars` / `page text unavailable` line in the server log as
the only place it is visible. **There is no indicator in the panel.** If that
matters, it is the missing piece, not a refinement.

**Read the real output before believing a change here.** Diff inspection found
nothing wrong with either table version, and nothing wrong with the
URL-and-title version either. All three were only caught by running suggestions
against real page shapes and reading the sentences.

## Extension storage

- `model_config` (provider, model, context_window) → `chrome.storage.local` — persists across browser restarts (not sensitive)
- `api_key` → `chrome.storage.session` — in-memory only, cleared on browser restart; mirrors the existing pause-state pattern
- The first read after an extension update runs a one-shot migration that re-saves any legacy `{modelConfig: {model_config, api_key}}` shape into the new layout

## Domain blocking — one list, the user's

The blacklist is whatever the user typed in the panel, whole. There is no
server-side floor, no `policy.json`, no `merge()`.

There was a whole second code path for it and **it rendered nothing**: a
self-hosted install never shipped a `policy.json` for `load_policy()` to find,
so `FLOOR_POLICY` was always an empty `Policy`, and the panel's "Brotto refuses
these too" list always came back empty. Every three-way union
(`floor ∪ user ∪ ?`) and every "source: floor / server / user" label existed to
describe a distinction that never occurred. Deleted: `policy/config.py`,
`merge()`, `FLOOR_POLICY`, the `/health` `policy` key, the `source` block on
`/v1/policy`, and the panel's floor section.

`Policy` / `UserPolicy` stay, and `UserPolicy` is still a `Policy` subclass, so
an old policy file on disk with the removed `whitelist` / `block_blacklisted`
fields still parses — pydantic 2 drops unknown fields rather than rejecting them.
That is pinned by `tests/test_policy_schema.py`.

## Notifications

Two classes, and they gate on **different** things, which is the whole point:

- **Blocking** (`approval_request`, `login_required`, `clarify_request`) —
  always speaks up, panel open or not. The user has usually wandered off
  precisely because the panel looks idle. `notifyBlocking` gates it.
- **Results** (`task_completed`, `task_failed`) — only when nobody is
  watching. `notifyResults` gates it. Default **on**, and this is a product
  judgement worth knowing about: Brotto's premise is that you leave it running
  and come back later, so "the task ended" is the event the whole thing exists
  to deliver. Flip it if that reads as too loud.

"Watching" is a **boolean on the keep-alive port**, not port liveness. A bare
`chrome.runtime.connect` cannot tell an open-and-watched panel from an
open-and-forgotten one, and the second is the normal state for a ten-minute
task. `sidepanel.js` drives it from `focus`/`blur` events — not by polling
`hasFocus()`, which **is forced `true` under CDP focus emulation** and so cannot
be tested in the browser harness at all. Those listeners are registered at
module scope, not inside `connectSwKeepAlive`, which re-runs on every service
worker restart and would accumulate a pair of listeners per reconnect. The
background defaults `panelWatching` to `true`, so a cold service worker reads
"connected" as "watched" and stays quiet rather than guessing.

A notification click focuses `activeWindowId` and clears. It deliberately does
**not** call `chrome.sidePanel.open()` — that needs a user gesture a
notification click does not provide (chromium bug 40929586, still open), and a
click that clears the notification and leaves you where you were is a dead
end. `chrome.windows.update(id, {focused: true})` has no such restriction.

**A setting that is written and read nowhere is worse than no setting.**
`notifyBlocking` was persisted in three places and consulted in zero, so
unchecking it changed nothing at all. Both toggles are now read in
`maybeNotify`.

Not built, and cheap if wanted: a "waiting on you" badge on the panel icon.
`currentPrompt` is already tracked in the background.

## Audit trail

Every run writes one nested-JSON document per session to
`logs/sessions/<session_id>.json`: `turns[]`, each with
`observation → model → prompts[] → actions[]`, plus root-level `totals`,
`policy_events[]`, `errors[]`, and a `scratchpad` snapshot. `GET
/v1/sessions/{id}/audit` serves it and the panel's transcript view renders
it. There is no database; the file is the record.

**Atomic write, and that is the whole durability mechanism.** `json.dump` to
`<id>.json.tmp` then `os.replace`, which is atomic on POSIX — a crash
mid-write leaves the previous valid document, never a truncated one. It was
chosen over append-only JSONL specifically because a JSONL trail does not
form a nested document until a task ends *cleanly*, i.e. it holds nothing
exactly when you want the audit.

Five things that are load-bearing, and each is a way this could have been
quietly wrong:

- **Key order inside a turn is causal and the tests assert it** —
  `model → prompts → actions`, because that is the order they happen in and
  the order a replay walks. Dict ordering survives the JSON round trip
  because `json.dump` does not sort by default.
- **A turn with `ended_at: null` is unfinished, never a resume point.** A
  turn in flight when the socket died describes actions that may or may not
  have run, so it is re-run from scratch rather than half-recorded. This is
  the same reason an approved-but-unexecuted action is not replayed as if it
  had.
- **Writes never raise.** A failed flush increments `dropped_writes`, counts
  into `totals["errors"]`, and logs — the loop never sees an audit failure.
  So the log line carries the exception *type* and not its message: a
  serialization error quotes the value that failed, and that value is the
  document. `pytest` still exercises the failure path by standing a file
  where the sessions directory must be.
- **The scratchpad is per session** (`<session_id>.scratchpad.txt`). `dir`
  is the root that holds *every* session, so a bare `scratchpad.txt` there
  would let concurrent tasks overwrite each other's memory and read each
  other's.
- **`is_secret_field` lives in exactly one place.** A `type=password` check
  misses an API-key field, because those are usually `type=text` or
  `type=email` — so the accessible name is the only signal left, and the
  Playwright relay and the extension relay must not be able to disagree
  about it. Over-redacting costs a replay that says `[redacted]`; under-
  redacting costs a plaintext credential on disk forever, and every
  ambiguous branch resolves toward redact.

A live `AuditTrail` holds the document in memory and rewrites the whole file
on every flush, so a second writer read-modify-writing the path gets clobbered
by the next flush. `append_policy_event` routes through the live instance for
this reason, and `close()` deregisters — only on a terminal path.

### Resume

`AgentHarness.run(deps, *, resume_from=0)`. This works because the harness is
**stateless per step**: `agent.run` is called with a freshly rebuilt prompt and
no `message_history`, so `step_summaries` + `scratchpad` ARE the model's entire
history. The document has both, which makes resume a reconstruction rather
than a guess. `visited_domains` is restored from the *approved* first-navigation
events only — re-adding a domain the user never approved would skip the prompt
that exists to ask them.

A stopped task and a dropped socket look identical to the server: the agent
task is cancelled either way, and only one of them may be resumed. So the
client says which it was in a `cancel` frame rather than leaving the server to
infer it from the disconnect, and a user-cancelled run is sealed `cancelled`
(never resumable) while a dropped one is left `running`.

A document that is corrupt, is at another `schema_version`, or belongs to a run
that already ended is reported as `status: "interrupted"` with the reason —
never silently restarted, because a silent restart re-runs actions the user
approved. Two consequences worth keeping: the refusal is recorded **on top of**
the existing record rather than replacing it, and a corrupt file is left
byte-for-byte as found. It is the only copy of a run nobody can read, and "we
cannot read it" is not a reason to delete it.

The extension reconnects with full jitter (1s base, ×2, 30s cap, 6 attempts)
reusing the `session_id`. `stopRelay` and a cancel never reconnect — a
cancelled task must not resurrect.

**Not verified in a browser.** The reconnect path, the transcript view, and
the offline-history fallback are unit-tested logic only.

## Commands

```bash
# Build extension (TS→JS bundle)
cd clients/brotto-extension && npm run build

# Run server (dev mode picks up .env + global ANTHROPIC_AUTH_TOKEN)
cd services/brotto-orchestrator && python start_server.py

# Tests
../../.venv/bin/python -m pytest tests/ -q     # 423 tests (2 skipped)
# The pytest install lives in the REPO-ROOT venv, not services/brotto-orchestrator/.venv
# (which has pydantic-ai but no pytest). Run it from services/brotto-orchestrator/.

# Smoke test (real API call, exercises full model adapter; reads .env)
.venv/bin/python scripts/smoke_minimax_endtoend.py
```

## Gotchas

- `.env` is gitignored. Use `.env.example` for documented config (currently there's no `.env.example`; the `.env` itself contains comments).
- `/docs/` is gitignored (internal design artifacts); force-add with `git add -f` for spec/plan commits.
- Don't include `Co-Authored-By: Claude ...` in commit messages (per global ~/.claude/CLAUDE.md).
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