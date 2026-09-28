# Model adapter — design spec

**Date:** 2026-09-28
**Status:** Awaiting user review (post-brainstorming)
**Scope:** Phase 2 of MiniMax integration — server-side adapter + extension model picker. Phase 1 (MiniMax M3 wired through env vars + a 2-line `ANTHROPIC_AUTH_TOKEN → ANTHROPIC_API_KEY` fallback in `agent/harness.py`) is already landed; the developer sets `AGENT_MODEL=anthropic:MiniMax-M3` and `CONTEXT_WINDOW_TOKENS=1000000` in the shell before running `start_server.py` to use it today.

## Problem

Today `agent/harness.py` reads a single `AGENT_MODEL` env var and a single global API key. That's fine for one developer pointing at one provider, but it doesn't support:

- Multiple users using the same brotto deployment with different providers / keys
- BYOK ("bring your own key") for product
- Future cloud-managed auth where brotto calls a hosted proxy instead of upstream providers

This spec adds the smallest adapter that solves all three without speculative abstractions.

## Goal

A user installs the brotto extension, opens settings, picks `MiniMax` (or `Anthropic`, `OpenAI` — anything registered), enters their API key, and runs tasks against that provider — without the server operator configuring anything beyond a default for users who don't bring their own key.

## Non-goals (deferred)

- Server-side API-key caching (extension re-sends key per task; v1 keeps keys in memory only)
- Cross-provider fallback / retry policies
- Per-provider telemetry or cost tracking
- Cloud SSO / OAuth flows (the wire shape leaves a `key_source` hook point but doesn't implement one)
- A remote model registry (catalog ships in code)

## Architecture

### New modules (under `services/brotto-orchestrator/src/brotto_orchestrator/model/`)

| Module | Purpose |
|---|---|
| `config.py` | `ModelConfig`, `UserCredentials` dataclasses; JSON (de)serialization; validation with clear error messages |
| `registry.py` | `PROVIDER_REGISTRY: dict[str, ProviderFactory]`; each factory builds the right `pydantic_ai.models.<X>Model` from `(model_id, api_key, base_url)`; also exposes `default_models()` and `validate_model_id()` |
| `store.py` | Per-user JSON store keyed by `client_ip`, same pattern as `policy/persist.py`; atomic write, content-hash dedup |

### Refactor

`agent/harness.py:84` (`_MODEL = os.getenv("AGENT_MODEL", "no-model")`) becomes a `_resolve_model_config(deps) -> ModelConfig` helper that the harness loop calls once per task. Same defer-then-validate pattern; no behavior change for users who don't send the new fields.

### Data shapes

```python
# model/config.py
@dataclass(frozen=True)
class ModelConfig:
    provider: str        # "anthropic" | "openai" | "minimax"
    model: str           # e.g. "MiniMax-M3", "gpt-4o", "claude-3-5-sonnet"
    context_window: int  # for the side-panel CONTEXT cell (e.g. 1_000_000 for M3)

@dataclass(frozen=True)
class UserCredentials:
    api_key: str | None  # None → server falls back to env (dev convenience)
    base_url: str | None # None → provider default
```

### Registry entry pattern

```python
# model/registry.py
class ProviderFactory(Protocol):
    def build(self, model_id: str, creds: UserCredentials) -> Model: ...
    def default_models(self) -> list[tuple[str, int]]: ...
    def validate_model_id(self, model_id: str) -> bool: ...

PROVIDER_REGISTRY: dict[str, ProviderFactory] = {
    "anthropic": AnthropicFactory(default_base_url=None),
    "openai":    OpenAIFactory(default_base_url=None),
    "minimax":   AnthropicFactory(default_base_url="https://api.minimax.io/anthropic"),
}
```

`minimax` reuses the Anthropic factory because MiniMax's public Anthropic-compatible endpoint speaks the Anthropic wire protocol (`https://api.minimax.io/anthropic/v1/messages`). One factory, one transport.

## Data flow

### WebSocket additions (additive, backward-compatible)

```ts
// extension sends on task_start
{
  type: "task_start",
  goal: "...",
  // new optional fields
  model_config?: { provider: string, model: string, context_window?: number },
  api_key?: string | null,        // null = "use server default"
  remember_key?: boolean          // reserved for v2 server-side caching; ignored in v1
}
```

Old clients (or new clients that haven't been configured with a model yet) still work — they fall through to env vars (Phase 1 path).

### Resolution order on the server (first hit wins; per task, per user)

1. Inline in `task_start` (`model_config` + `api_key`)
2. Server-side per-user JSON file at `{client_ip}.json` under `BROTTO_USER_MODEL_DIR` (model choice only — never the key)
3. Env vars (`AGENT_MODEL` + `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`) — dev fallback

The Phase 1 `ANTHROPIC_AUTH_TOKEN → ANTHROPIC_API_KEY` propagation in `harness.py` keeps working as the env-fallback path.

### Storage

| What | Where | Why |
|---|---|---|
| API key (active session) | Server memory only | Never touches disk — `logs/`, run records, traceback all redact `api_key` |
| API key (long-term) | `chrome.storage.local` on the user's machine | BYOK = user's responsibility for their key |
| Model choice | Per-user JSON, keyed by `client_ip` | Same pattern as `user_policy`; survives browser restart, doesn't carry the key |
| Provider catalog | Static in `model/registry.py` | No remote registry; fewer moving parts |

## Error handling

| Failure | Caught where | Surface |
|---|---|---|
| Missing API key | Server, before `agent.run()` | `auth_failed` bubble, "Add an API key in the extension settings" |
| Invalid API key (401) | Server, after provider response | `auth_failed` bubble with provider name |
| Invalid provider / model id | Extension validation (early) + server validation (defense) | Extension: red field on save; server: `model_not_found` |
| Provider 5xx / timeout | Existing `retries=2` on `Agent(...)` | `task_failed(TRANSIENT)`; existing run_logger captures |
| Rate limit (429) | Provider SDK / pydantic-ai | `task_failed(RATE_LIMITED)`; existing backoff applies |

`TaskResult.failure_reason` gains two values: `auth_failed` (missing or rejected key) and `model_not_found` (unknown provider/model id). Both apply in normal and secure mode — the failure bubble renderer already shows provider + model; no UI change needed.

## Extension UI

Add a **Model** section to the existing settings page (next to user policy):

- **Provider** dropdown — populated from `PROVIDER_REGISTRY` keys
- **Model** dropdown — populated from the selected provider's `default_models()`; falls back to free-text input if empty (lets devs test new models without a server release)
- **API key** — `type="password"`, with show/hide toggle; placeholder `Leave blank to use server default` for dev
- **Save** — writes the four fields to `chrome.storage.local`; on next `task_start` the sidepanel reads the latest values

No "remember on server" toggle in v1 — the extension re-sends the key on each task.

## Testing

| Layer | Coverage |
|---|---|
| Unit — `model/config.py` | Parse valid / invalid JSON; validation errors with clear messages |
| Unit — `model/registry.py` | Each factory builds the right `pydantic_ai.models.<X>Model`; `validate_model_id` accepts known / rejects unknown |
| Unit — `model/store.py` | Per-user JSON read/write atomic; content-hash dedup; missing-file fallback |
| Unit — `agent/harness.py` | `_resolve_model_config(deps)` returns the right tier (env > per-user > inline) for each input shape |
| Integration | End-to-end: test client sends `task_start` with `model_config` + `api_key`, server routes to MiniMax, gets a response, key absent from logs |
| Backward compat | Existing `task_start` without `model_config` still works (the Phase 1 path) |
| Manual | Real extension: pick MiniMax + key, run a short task, verify CONTEXT cell updates against `context_window` |

## Out of scope (acknowledged for product later)

- Server-side API-key caching (`remember_key=true` is a no-op in v1; one-file add to `model/store.py` later, opt-in)
- OAuth / SSO flows for cloud-managed auth
- Per-model capability flags (vision, image generation, tool-use restrictions)
- Model cost / quota tracking
- Cross-provider retry / fallback chains

These are deliberately left as hook points (`remember_key`, `key_source` enum) but not implemented. Add them when the product story demands, not before.

## Ship list

- Three new modules under `brotto_orchestrator/model/`
- One helper in `agent/harness.py` (~30 LOC)
- Extension settings additions (one new section)
- WS protocol additive (one new optional field group on `task_start`)
- Tests as listed above