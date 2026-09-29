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

**MiniMax billing** (the gotcha that wastes an hour if you miss it):
- `MiniMax-M3.1-Flash-Preview` — Token Plan (covered by Claude Code Token Plan subscriptions)
- `MiniMax-M3` — pay-as-you-go, requires separate credits; using without credits returns 402 insufficient_balance
- Dev default is M3.1-Flash-Preview for this reason

## Dev mode

`.env` is loaded first at `main.py` module load (before the dev defaults below, so an `AGENT_MODEL` in `.env` wins over the built-in one), then:

`BROTTO_ENV=dev` (default) pre-populates env vars:
- `AGENT_MODEL` defaults to `minimax:MiniMax-M3.1-Flash-Preview` — provider is `minimax`, not `anthropic`, because the `minimax` factory carries the `https://api.minimax.io/anthropic` base URL
- `CONTEXT_WINDOW_TOKENS` defaults to `1000000`
- `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` propagation (idempotent; Token Plan users have AUTH_TOKEN, pydantic-ai reads API_KEY)

Set `BROTTO_ENV=prod` to opt out — server then uses whatever operator configured (extension settings, .env, AGENT_MODEL).

**`BROTTO_FORCE_ENV_MODEL=1`** — ignore the extension's model *and* key entirely, run on `.env`. Set it in `.env` and you never type a key into the side panel again. Also set in `tests/conftest.py`-neutralised scope so it can't leak into the suite.

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
./.venv/bin/python -m pytest tests/ -q     # 314 tests (2 skipped)

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