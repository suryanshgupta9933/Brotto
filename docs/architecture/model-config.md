# Model adapter, dev mode, and key resolution

Read before touching `model/{config,registry,store,resolver}.py`, `main.py`'s
dev-mode env defaults, or anything about which model runs a task.

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
