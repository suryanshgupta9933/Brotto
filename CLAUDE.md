# Brotto — Claude Code project notes

Server-hosted browser automation harness: Python orchestrator (FastAPI + pydantic-ai + Playwright) drives a Chrome extension. Model-agnostic, BYOK.

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
docs/superpowers/{specs,plans}/ — design docs
```

## Model adapter (Phase 2)

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

`BROTTO_ENV=dev` (default) pre-populates env vars at `main.py` module load:
- `AGENT_MODEL` defaults to `anthropic:MiniMax-M3.1-Flash-Preview`
- `CONTEXT_WINDOW_TOKENS` defaults to `1000000`
- `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` propagation (idempotent; Token Plan users have AUTH_TOKEN, pydantic-ai reads API_KEY)

Set `BROTTO_ENV=prod` to opt out — server then uses whatever operator configured (extension settings, .env, AGENT_MODEL).

Startup log line shows resolved auth state immediately:
```
auth env at startup: ANTHROPIC_API_KEY=set (len=125)  ANTHROPIC_AUTH_TOKEN=set (len=125)  BROTTO_ENV=dev
```

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
./.venv/bin/python -m pytest tests/ -q     # 300 tests (2 skipped)

# Smoke test (real API call, exercises full model adapter)
AGENT_MODEL=anthropic:MiniMax-M3.1-Flash-Preview .venv/bin/python scripts/smoke_minimax_endtoend.py
```

## Gotchas /

- `.env` is gitignored. Use `.env.example` for documented config (currently there's no `.env.example`; the `.env` itself contains comments).
- `/docs/` is gitignored (internal design artifacts); force-add with `git add -f` for spec/plan commits.
- Don't include `Co-Authored-By: Claude ...` in commit messages (per global ~/.claude/CLAUDE.md).