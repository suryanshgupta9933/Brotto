# Brotto — Claude Code project notes

Server-hosted browser automation harness: Python orchestrator (FastAPI + pydantic-ai + Playwright) drives a Chrome extension. Model-agnostic, BYOK.

**Heads up — this project is a long-term product effort.** Strategic context lives in `docs/product/`; AI-dev workflow rules in `docs/product/dev-environment.md`. Read those before non-trivial work. See "Working agreements" below.

## Repo layout

```
services/brotto-orchestrator/  — server: FastAPI + pydantic-ai + Playwright
  src/brotto_orchestrator/
    main.py                 — entry: WS handler, dev-mode env defaults
    agent/harness.py         — observe→plan→act loop
    model/{config,registry,store,resolver}.py — provider-agnostic model adapter
    policy/                  — secure-mode policy + persistence
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

`check_stagnation` compares the **page**, not the URL. A live run of "open the Google results for bermuda" was told *"stuck for 3 consecutive steps"* while the agent was focusing the box, typing the query and submitting — three different pages that share one URL, because typing does not navigate. The warning made it worse: the panel's copy said *"Stop the task if this doesn't clear"*, and the task went on to succeed.

`StepSummary.state` is a `blake2b` of the rendered AX tree plus page text (`stagnation.page_fingerprint`), and the same-URL rule now requires that to be unchanged too. The value is load-bearing: `ax_filter` renders `value="..."`, and CDP puts the input's current text there, so the fingerprint moves on a keystroke. Verified through the real renderer — focus → `value="bermuda"` → `value="bermuda b"` gives three distinct fingerprints on one URL.

Two constraints on that line, both deliberate:
- It hashes `filtered_ax`, **not** `turn.ax_tree`. The latter has the stagnation note appended, so hashing it would report a state change on exactly the steps where nothing changed.
- An empty `state` falls back to URL-only, so anything constructing a `StepSummary` by hand keeps the old behaviour.

The panel copy no longer advises stopping. The harness note already tells the model to report what it has or take a genuinely different path; a second nudge to quit is how a task one step from done gets abandoned.

**Not done:** cross-task memory. `Scratchpad` is per-task — persisted to `logs/runs/<id>/` for resume within a task and gone otherwise, so `github.com/<user>/issues/assigned` (the entry point discovered on that run) is relearned every run. The obvious durable content is *where things live on a site and which routes are dead*: a per-user JSON store in the shape of `model/store.py`, injected at the top of every task. Unbuilt.

## Idle-page suggestions

The three task suggestions on the idle panel are **written by the model**, not
by a table. `POST /v1/suggestions` → `agent/suggest.py` → a standalone
`Agent` with `output_type=Suggestions`, given the page's URL and title.

Three hand-written versions came and went first: a 17-hostname table, then a
bigger one (15 page classes × 6 lines, 20 object kinds × 2 lines, ~130 lines of
copy). Both were correct on the sites someone had thought of and generic
everywhere else — the same failure, twice, at two scales. **The moment you
want to improve these, fix the prompt. Adding a site table is the bug.**

Four things that are load-bearing:

- **HTTP, not the WebSocket.** The socket is created in `startRelay`
  (`background.ts:505`) and only exists while a task is in flight — which is
  exactly when the panel does *not* need suggestions. `/v1/policy_ack` set the
  precedent for idle-time actions.
- **URL and title only.** No content script, `host_permissions` is
  `<all_urls>`, so page text would mean permanently injecting Brotto into
  every site the user visits.
- **A standalone Agent**, not the harness's. That one is bound to
  `AgentDecision` with a `SYSTEM_PROMPT` whose identity is "you are not a
  chatbot" — wrong for a suggestion writer, which is why `SUGGESTION_PROMPT` is
  a separate constant rather than a section of `SYSTEM_PROMPT`.
- **The fallback stays site-agnostic.** Four lines in `FALLBACK_SUGGESTIONS`.
  The good path is a cache hit most of the time, so if the fallback grew a site
  table the failure would be invisible — it would just look like a cache.

Cache key is `host + pathShape + YYYY-MM-DD` in `chrome.storage.local`, with
numeric and UUID path segments collapsed to `:id`, capped at 40. The panel
paints the fallback first and swaps in the generated set when it lands, so the
box is never empty and never waits on a model call.

**Read the real output before believing a change here.** Diff inspection found
nothing wrong with either table version. Both were only caught by running
suggestions against real URLs and reading the sentences.

## Extension storage

- `model_config` (provider, model, context_window) → `chrome.storage.local` — persists across browser restarts (not sensitive)
- `api_key` → `chrome.storage.session` — in-memory only, cleared on browser restart; mirrors the existing pause-state pattern
- The first read after an extension update runs a one-shot migration that re-saves any legacy `{modelConfig: {model_config, api_key}}` shape into the new layout

## Commands

```bash
# Build extension (TS→JS bundle)
cd clients/brotto-extension && npm run build

# Run server (dev mode picks up .env + global ANTHROPIC_AUTH_TOKEN)
cd services/brotto-orchestrator && python start_server.py

# Tests
../../.venv/bin/python -m pytest tests/ -q     # 335 tests (2 skipped)
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