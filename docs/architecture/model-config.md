# Model adapter, dev mode, and key resolution

Read before touching `model/{config,catalog,registry,store,resolver,pricing}.py`,
`main.py`'s dev-mode env defaults, or anything about which model runs a task.

## Model adapter

**One catalogue, nine providers** (`brotto_orchestrator.model.catalog.PROVIDER_CATALOG`).
This is the single source of truth: the factories, the `GET /v1/models` endpoint,
and both extension screens are all generated from it, so adding a model is one
edit. It replaced three hand-kept copies that had already drifted.

| id | shape | notes |
|---|---|---|
| `anthropic` | anthropic | claude-sonnet-5-5, claude-opus-5-5, claude-fable-5-1 (1M), claude-haiku-4-5 (200K), claude-sonnet-4-5 (200K, previous gen) |
| `openai` | openai | gpt-6.1-sol, gpt-6-luna, gpt-6-astra and the gpt-5.6 tier (sol/terra/luna); all 1.05M |
| `minimax` | anthropic | 4 models; fixed endpoint, no base-URL field |
| `gemini` | gemini | gemini-3.8-flash, 3.5-flash, 3.5-flash-lite, 3.1-flash-lite; all 1.05M |
| `openrouter` | openai | any model id; endpoint editable |
| `deepseek` | openai | deepseek-v4-pro, deepseek-flash; 1M |
| `groq` | openai | openai/gpt-oss-120b, openai/gpt-oss-20b; 131K |
| `ollama` | openai | **keyless**, any model id, defaults to `http://localhost:11434/v1` |
| `custom` | openai | any model id, no models, no default endpoint |

**The lineup is re-read from each vendor's own page, not remembered.** It was
refreshed on 2026-10-01 and every id here was verified against the provider's
model list that day; the old set (claude-3-5-\*, gpt-4o, o1, gemini-1.5/2.0,
deepseek-chat/reasoner) is gone, several of those shut down entirely. The
reasoning lives here because the failure is silent in review — a stale id looks
exactly like a correct one, and only a 404 or a rejected `thinking` param at
runtime tells you. **When refreshing, read the source URL recorded above the
rate constants in `catalog.py`; do not transcribe from memory.**

**One previous generation is kept per vendor, not just the newest.** Claude
Sonnet 4.5 (200K) and the gpt-5.6 tier sit below their successors. This is
deliberate and not sentimentality: `context_window` becomes `window/20` of AX
tree, so a genuinely smaller window is the honest budget for a task that should
*not* spend a million tokens, and a user who has a Claude Code subscription
landed on a 4.5-era model. `gpt-5.6`'s rates are promotional — OpenAI says
Sol's hold "at least through November 21, 2026".

### Vision

`ModelInfo.vision` is a plain bool and it is set only where a vendor says so.
Anthropic ("all current models support text and image input") and OpenAI ("all
latest OpenAI models support text and image input") mean *every* one of their
entries is True, and MiniMax labels the M3 pair "Multimodal". DeepSeek's table
is the only one that says "not supported" outright — vision on `deepseek-flash`,
not on `deepseek-v4-pro`.

**A `False` means "not documented", not "confirmed text-only."** The MiniMax
M2.7 pair, Groq's open weights and every `accepts_any_model` provider fall in
that bucket, because a vendor not listing a capability is not a vendor denying
it. So a `False` is a reason for the vision fallback to check before it sends a
frame, not a proof it should skip the model. Set it when the vendor documents
it; do not set it on a hunch.

The field is on the wire (`GET /v1/models`) and nothing consumes it yet — the
fallback that selects on it is §1.1, which is not written. Pinned by
`test_models_ship_whether_they_take_an_image`.


**Dispatch is on the vendor's request shape (`api_shape`), never on its id.**
MiniMax speaks the Anthropic shape from its own id; a registry that dispatched
on `id == "anthropic"` sent it OpenAI requests at an endpoint that only accepts
Anthropic ones, and — because both factories are the same class — Anthropic
requests went to `api.minimax.io` at the same time. `ProviderInfo.api_shape` is
a fact about the vendor, which is why it lives in the catalog and not in
`registry.py`.

**Three factories, not nine.** `AnthropicFactory`, `GeminiFactory` and
`OpenAICompatibleFactory`, each carrying a `provider_id` that `_build_registry`
sets from the catalog key. `OpenAICompatibleFactory` is the whole OpenAI-
convergence bet: OpenRouter, Groq, DeepSeek, Ollama, vLLM and any self-hosted
endpoint are the same class with a different default URL. A previous
`_VendoredOpenAI` subclass existed to carry the id and was removed once
`provider_id` moved onto the base — it was also the reason `AnthropicFactory`
validated model ids against *Anthropic's* list, so the minimax factory rejected
`MiniMax-M3` for a minimax user.

**`OpenAIChatModel`, not `OpenAIResponsesModel`.** The Responses API is
OpenAI's own. Ollama, vLLM, DeepSeek and most gateways implement chat
completions only, and reaching them is the entire point of the adapter.

**Per-task resolution** (`resolver.resolve_model_config`):
1. inline_config / inline_creds (from extension's task_start)
2. per-user JSON file keyed by client IP
3. env vars (`AGENT_MODEL`, `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`)

### `base_url` lives on the config, not the credentials

`UserCredentials.base_url` is what the factories read; `ModelConfig.base_url` is
where it is stored. The split is deliberate: the config is what `store.py`
persists, so an Ollama user does not re-paste the URL every browser restart the
way they re-paste their key, while the URL still travels next to the key on the
one path that builds a provider.

`resolver._with_base_url` is what joins the halves, and it is the reason the
resolver is the only place that needs to know about it — a caller that built
`UserCredentials` itself and passed the config separately would send the
request to the wrong endpoint with no error anywhere.

Adding the field was backward compatible with no migration: `from_dict`'s `known`
set only rejects *extra* keys, so every already-persisted `logs/user_models/*.json`
loads unchanged, and `background.ts` already ships `model_config` whole so the
wire needed no new field.

**This is an SSRF primitive and the line is drawn at the scheme.** `/ws/ext` is
unauthenticated, so anyone who can reach the server can point it at an arbitrary
URL and have it make authenticated POSTs there. `ModelConfig.__post_init__`
requires `http://` or `https://`. Private IP ranges are deliberately *not*
refused — that would break `http://localhost:11434/v1`, the case the feature
exists for, and the server's operator is the one choosing to expose it. It is
not recorded in the audit document's `model` block, so an internal hostname
stays out of the session record.

**A shell-exported `ANTHROPIC_BASE_URL` overrides the Anthropic default**, and
the base-URL half of this feature makes that stickier than it was: `_from_env`
now persists it into a per-user config. Same class as "the key must be in `.env`,
not the shell" above. Verify with the environment scrubbed:

```bash
env -u ANTHROPIC_BASE_URL -u AGENT_BASE_URL \
  ../../.venv/bin/python -m pytest tests/ -q
```

`AGENT_BASE_URL` is the provider-neutral name and is read first;
`ANTHROPIC_BASE_URL` is kept for the configs that predate it.

### Ollama has no key

`resolver` deliberately ignores an inline config that arrives without one — a
rule this file documents at length. Rather than weaken it, `ProviderInfo.
keyless_ok` marks the one provider it applies to (Ollama, today) and
`_authenticates` honours exactly that. Every other provider keeps the old
behaviour, so `test_keyless_inline_config_is_ignored` still passes. The panel
hides the API-key box for a keyless provider, so the user is not told to fill in
something that is ignored.

### Pricing

`model/pricing.py`. `RunUsage` carries `cache_read_tokens` / `cache_write_tokens`
and pydantic-ai 2.31 has `RunUsage.cost`, but `AnthropicModel` has **no cost
calculation at all**, so on Claude and MiniMax it stays 0 — the catalog is the
only source of a number.

Cache tokens are the reason this is not `tokens * rate`. CLAUDE.md records that
the stable prompt prefix is cached, so on a normal multi-step run the cached
read dominates input volume while costing a tenth of the rate; an input/output
-only estimate overprices the actual workload several fold. `RunUsage.
input_tokens` is the *uncached* portion — the API reports the three counts
separately and they do not overlap. `harness.py` accumulates all four into
`TaskResult.timing` and the audit document records them per turn and in
`totals`; the keys are additive, so a document written before them still parses
and is still resumable.

`Pricing | None` is a supported value and `price_usage` returns `None` for it.
OpenRouter is deliberately unpriced — its rate is per-model, not per-provider.
**A visibly absent cost beats a confidently wrong one**, because the consumer of
this number is a budget cap. Rates were read off each vendor's pricing page on
2026-10-01 and must be re-checked before any of them is shown to a user. Local
inference is the one zero that is certain rather than unknown.

**A `0.0` cache-write rate is "not published", not "free".** Google charges per
hour of cache storage rather than per write, Groq publishes no write rate at all,
and MiniMax publishes none for M3. The write field is a required float, so
`price_usage` has nowhere to record the distinction — which is why
`test_every_priced_model_has_a_plausible_rate_card` asserts only that a read is
cheaper than an uncached input token, and says so.

**Two vendors re-rate the whole request past a size threshold**, which is why
`Pricing` grew `long_context_threshold` and four `_long` fields. OpenAI doubles
input and cache and multiplies output by 1.5 past 272K input tokens; MiniMax
doubles everything past 512K. The rule applies to the **entire request**, not to
the tokens over the line — a per-token split prices a long run at the base rate
and undercounts it by up to half. Gemini has tiers too, but they could not be
read off its pricing page, so its threshold is left `None` rather than invented.
DeepSeek doubles during weekday peak hours (01:00–04:00, 06:00–10:00 UTC) and
`Pricing` has no clock in it; that is the one known underestimate, marked with a
`ponytail:` comment at the constants.

`testing/runner.py` prices the offline benchmark off `tokens_in`/`tokens_out`
with its own flat 3.00/15.00 rates and is **deliberately not wired to the
catalog** — it is the benchmark's assumption, not the live pricing path.
`tests/testing/test_runner.py` pins its result.

### The extension

`GET /v1/models` serves the catalog; `model_catalog.js` fetches it, caches it in
`chrome.storage.local` for a day, and falls back to a small built-in list so
Settings still opens with the server down. That fallback is the last copy and is
deliberately *not* a thing to keep in sync — it is stale-tolerant by design.

The model control is `<input list=…>` with a `<datalist>`, not a `<select>`.
OpenRouter's catalogue and `qwen2.5-coder:7b` are not enumerable, and a select
cannot express "one of these, or your own" — which also deleted the
`accepts_any_model` branch the select would have needed. `context_window` for a
free-text id falls back to the provider's *smallest* known window, because it
becomes `window/20` of AX-tree budget and an invented 1M would overrun the real
window and 400 on the next step. Pinned by `scripts/test-model-config.test.js`.

The base-URL box and the API-key box are shown per provider, not always. A field
left visible for a provider that ignores it is a lie about what the user has to
fill in.

**MiniMax model choice** — latency, not billing, is the deciding factor:
- `MiniMax-M3` — accepts `thinking.type="disabled"`. Measured 2–5s/step end-to-end. Dev default.
- `MiniMax-M3.1-Flash-Preview` — **requires** adaptive thinking; sending `thinking.type="disabled"` returns HTTP 400. Measured 4.5s / 11s / 26.5s across three runs of the same prompt, with a `ThinkingPart` on all but the first. It is the Token Plan model, so a subscription-only user who has no M3 credits has to fall back to it and pay that latency.

**`max_tokens` and thinking are set in `registry.py`, not the harness.** Each factory exposes `model_settings(model_id)`, wired at the `agent.run` call in `harness.py`:
- `_OUTPUT_TOKEN_CAP = 32_000` on every provider. pydantic-ai's own default is 4096, below what a reasoning turn produces, and the failure names a *prompt-length* problem that does not exist ("simplify the prompt to result in a shorter response"). A cap is a ceiling, not a reservation, so a generous one costs nothing.
- `anthropic_thinking={"type":"disabled"}` only where it is *known* to be accepted, and it is an allowlist now, not a denylist. **Anthropic moved to adaptive thinking**: Fable 5.1, Opus 5.5 and Sonnet 5.5 are "adaptive (always on)" and answer `disabled` with HTTP 400, so every Claude id in the catalog rejects it. `_THINKING_DISABLE_OK` is keyed by `provider_id` and holds only the three MiniMax models that take it. **The failure mode is asymmetric**: sending the param to a model that requires adaptive thinking is an HTTP 400 on every call, whereas omitting it from one that would have accepted it only costs latency — so an unknown id must fall on the "send nothing" side. It is also why the allowlist is keyed on `provider_id` and not on the model id: `anthropic` and `minimax` share one factory, and an id-keyed list would hand `disabled` to Claude. Never send it to OpenAI or Gemini either — it is an Anthropic request field, they reject an unknown body key, and every OpenAI-compatible gateway passes the body through.
- **Effort is deliberately never sent.** Anthropic's control is now `thinking: {"type": "adaptive"}` + `output_config: {"effort": …}`, and the docs are explicit that *changing* the effort value invalidates prompt-cache breakpoints while *setting it to the model's default is equivalent to omitting it*. Brotto's stable prefix is the cheap part of a run (see the latency section in CLAUDE.md), so omitting is the only choice that is both cache-safe and correct.

Both are pinned by `tests/model/test_registry_settings.py`, which sweeps **every** provider in the registry against model ids belonging to *other* providers. That is why the base `model_settings` must not look at `model_id`: it is called with ids it has never heard of, and a gate that raises on an unrecognised one breaks the sweep and the feature.

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

- An inline config **without** a key is ignored and falls through — unless the
  catalog marks its provider `keyless_ok`, which today only Ollama is. The
  extension stores `model_config` in `chrome.storage.local` (survives restart)
  but the key in `chrome.storage.session` (does not), so every browser restart
  it sends a config and no key. Honoring that gave a keyless provider and "Set
  `ANTHROPIC_API_KEY`" while shadowing a working `.env`.
- A per-user config persists the *model* only, never a key — so after a browser
  restart it is unusable on its own and the resolver says so explicitly. It
  does now persist the **base URL**, which is the half that is not a secret.
