# Model adapter, dev mode, and key resolution

Read before touching `model/{config,catalog,registry,store,resolver,pricing,capabilities}.py`,
`main.py`'s dev-mode env defaults, or anything about which model runs a task.

## Model adapter

**One catalogue, eight providers** (`brotto_orchestrator.model.catalog.PROVIDER_CATALOG`).
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

### 1.1 Capability resolution — models outside the catalogue

`model/capabilities.py`. A user can select any model string (`custom` with a
LAN endpoint, `openrouter/auto`, an env `provider:model` pair), and for an id
outside `PROVIDER_CATALOG` Brotto used to know nothing: no window, no price, no
vision — permanently, on every run. Three consequences shipped with that: an
unknown window sizes the AX-tree budget to `MAX_CHARS` (6000) because
`budget_for_window(None)` returns the floor, `_catalog_for()` returns `None` so
`BROTTO_MAX_TASK_COST_USD` **can never fire**, and there is no consumer of
`ModelInfo.vision` anywhere outside `catalog.py`.

Four tiers, in order, **never optimistic**:

1. **the curated catalogue** — authoritative, and what every existing model
   already got. A catalogue entry is never merged with a network answer.
2. **the vendor's own metadata API** — one function per vendor that has one:
   OpenRouter (`/api/v1/models`, no auth, edge-cached), Anthropic
   (`/v1/models`, `max_input_tokens` is an int *or* null and
   `capabilities.image_input` is always present, so read `.supported` and never
   treat presence as true), DeepSeek (`/models`, `context_window` +
   `input_modalities`), Gemini (`/v1beta/models`, **paginated** — `pageSize`
   caps at 1000 and the rest sits behind `nextPageToken`, so one page
   truncates silently and reads as "no such model"), and `custom`
   (`{base_url}/v1/models`).
3. **the probe** — one message, one 1×1 PNG, `max_tokens: 1`, only where tier
   2 gave no vision answer.
4. **a conservative default** — `None` for the window, `None` (never `0.0`)
   for the price, `None` for vision.

**Three tier-2 calls are deliberately not made.** OpenAI and Groq's
`GET /v1/models` returns `id`/`object`/`created`/`owned_by` and nothing else,
so the round trip cannot answer the question; both go straight to the probe.
MiniMax's `/v1/models` is undocumented, so parsing it defensively means
inventing a contract — and every MiniMax model Brotto ships is curated
anyway, so an unknown MiniMax id is an operator typo, not a model we need to
describe. It also goes to the probe.

**The probe's answer is tri-state and only one arm records anything.** Gemini
answers `400 INVALID_ARGUMENT` both for a text-only model and for a payload it
considers malformed, so the status alone cannot tell "not multimodal" from "I
sent something wrong". The probe therefore sends the *same* message twice —
once with the image part, once without — and only a rejection the **text-only
control accepts** counts as a `False`. A 401, a 429, a 5xx, a timeout, a
refused connection and a malformed response all leave vision `None` and record
nothing. That is the whole safety of the design: a wrong `False` is a
confident lie that is cached for a month and then withholds an image from
every future run of a model that would have taken it.

**`custom` is a community convention, not a standard.** vLLM, LM Studio and
llama.cpp implement something close; anything else answers however it likes.
So the call to a user-supplied host is capped at 4s, every transport error is
tier 4, the response shape is not assumed, and the window field is read from
four spellings (`context_length`, `context_window`, `max_model_len`,
`num_ctx`) because that is the same fact written four ways.

**Price is the dangerous field and only OpenRouter supplies it.** Token counts
are measurable for every model (`RunUsage.input_tokens` works across all eight
adapters); the $/Mtok multiplier is not, and no other vendor exposes it. A
`None` survives to `TaskResult.cost_usd` and renders as "no cost" — `audit.py`
and `tests/test_task_cost.py` pin "no rate means no key", and a `0.0` here
would both defeat the budget cap and render a reassuring `$0.00`. A `0.0`
cache-write rate stays the meaning it has everywhere else: not published, not
free, so a write bills at the input rate (the same choice
`pricing.user_rates` makes).

**The cache is a sidecar file, not a field on `ModelConfig`.**
`ModelConfig.from_dict` raises `ValueError` on an unknown field and
`store.load_user_config` swallows it into `log.warning` + `return None` — so a
cache field on the config would silently make every already-saved config
unreadable for every existing user, one invisible log line each. It is
therefore a separate JSON file beside the per-user config directory
(`logs/user_model_caps`, overridable with `BROTTO_USER_MODEL_CAPS_DIR`), keyed
by the same per-install identity as the config and sanitised by the same
`_safe_filename`. TTL is 30 days. **Only a learned fact is written** — a
`None` is not a fact, and a cached unknown would be indistinguishable from a
real answer once the vendor recovered. This is the first server-written file
under that directory; the config file itself stays extension-owned with one
write site (`main.py`'s `save_user_config`).

**Nothing here may block a task.** `resolve()` is catalogue + cache only and
performs no I/O, so it is safe on the task-start and per-step path; the network
tiers run behind `warm()`, and `warm_async` runs them off the event loop,
because a metadata call is a 4s round trip and a probe is a real request.
Every vendor call is wrapped so any failure at any tier degrades to tier 4,
and the resolver catches broadly around itself — a capability lookup is an
optimisation, and a run that raises inside it loses the task.

**`vision` has its consumer; the cap warning does not.** `resolve()`/`warm_async()`
are called once per run from `harness._vision_capability`, cached on `AgentDeps`,
and their `vision` answer is what gates the screenshot — see `_vision_fallback`.
The **cap warning is still unbuilt**, so a model resolved at tier 2 or 3 is used
for its window and priced at `None` without saying so. One precedence rule for
whoever writes it, because it is the easy thing to get backwards: a rate §1.1
discovered from a vendor's own
API outranks a rate the user **typed** (a typed rate is a guess; the API is
the vendor's own number) and is still outranked by the curated catalogue. So
the order is catalogue → §1.1 → `ModelConfig.input_per_mtok`, with `None`
falling through to `cost_usd=None` as it does today. Pinned by
`tests/test_capability_resolution.py`.

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

The field is on the wire (`GET /v1/models`) and `model/capabilities.py` now
resolves it for a model the catalogue does not name — with a **tri-state**, so
the catalogue's documented-not `False` arrives as §1.1's `None` rather than as a
denial. **`harness._vision_fallback` is that consumer**: it resolves once per
run and captures only when the answer is a positive `True`, so `False` and
`None` both reach the model as a refusal and differ only in which reason is
named. Pinned by `test_models_ship_whether_they_take_an_image`,
`tests/test_capability_resolution.py` and `tests/agent/test_vision_fallback.py`.

**The resolver short-circuits on a positive fact only.** The bool that carries
"not documented" would otherwise be read as a denial, so a catalogue
`vision=False` is treated as *unresolved*: it falls through to the cache and
then to the network tiers, where the probe can earn a real `False` with its
text-only control. `deepseek-v4-pro` is the reason this matters — the one
model in the catalogue recorded as text-only is one probe away from a fact,
and reported as `None` it is `None` forever. `context_window` and `pricing`
stay catalogue-authoritative at every tier (read off the vendor's published
page, not a guess), so a merged result names both origins:
`source == "catalog+probe"`. A probe can never overturn a catalogue `True` —
that entry returns immediately — so the residual risk stays one-directional:
we may send a frame to a text-only model, never gate a frame out of a model
that takes one.


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
convergence bet: OpenRouter, Groq, DeepSeek and any self-hosted endpoint are
the same class with a different default URL. A previous
`_VendoredOpenAI` subclass existed to carry the id and was removed once
`provider_id` moved onto the base — it was also the reason `AnthropicFactory`
validated model ids against *Anthropic's* list, so the minimax factory rejected
`MiniMax-M3` for a minimax user.

**`OpenAIChatModel`, not `OpenAIResponsesModel`.** The Responses API is
OpenAI's own. vLLM, DeepSeek and most gateways implement chat completions
only, and reaching them is the entire point of the adapter.

**The dependency mirrors the factories, one extra each.** `requirements.txt`
asks for `pydantic-ai-slim[anthropic,google,openai]`, and those three extras
are exactly the `pydantic_ai.models.*` and `pydantic_ai.providers.*` modules
`registry.py` imports. It was `pydantic-ai` — the meta-package — which
resolves to *every* optional integration (mcp, fastmcp, google-genai, logfire,
evals, mistral, tavily, xai): ~120 installed packages, most of the self-host
image, and most of what `pip-audit` had to read on every CI run. There is no
`anthropic` requirement either, because nothing imports the SDK directly — the
`anthropic` extra supplies it at the version pydantic-ai was tested against.
**A fourth factory in the catalog means a fourth extra here**, or that provider
ImportErrors on a self-hoster's box and not on yours.

**Per-task resolution** (`resolver.resolve_model_config`):
1. inline_config / inline_creds (from extension's task_start)
2. per-user JSON file keyed by the install's `device_id` (peer address if it sends none)
3. env vars (`AGENT_MODEL`, `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`)

### `base_url` lives on the config, not the credentials

`UserCredentials.base_url` is what the factories read; `ModelConfig.base_url` is
where it is stored. The split is deliberate: the config is what `store.py`
persists, so a self-hosted user does not re-paste the URL every browser restart
the way they re-paste their key, while the URL still travels next to the key on the
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

### There is no keyless provider

`resolver` deliberately ignores an inline config that arrives without a key — a
rule this file documents at length. It used to carry an exception, marked by
`ProviderInfo.keyless_ok`, for `ollama`; the local-runtime case is gone and so
is the flag. `_authenticates` is now unconditional (`return bool(creds.api_key)`),
`is_keyless_ok()` and the registry's `"not-needed"` placeholder key are deleted,
and the panel's API-key box is never hidden. Every provider in the catalogue
needs a key, so there is no keyless case worth preserving — and a provider that
existed only to justify a concept is the wrong thing to keep. Ollama was removed
from the catalogue for product reasons (BYOB/BYOK, ship fast, no local-AI
hassle); this was the cleanup it made possible. `custom` still reaches a local
runtime for a self-hoster, because it takes a base URL.

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

**A model the catalogue cannot name can still state its own rate.** `custom`
carries an empty model tuple and `openrouter` a single synthetic one, so
`pricing.lookup` returned `None` for every free-text id — a self-hoster on a
vLLM box got `cost_usd=None` on every run, including the ones their provider
bills. `ModelConfig` gains optional `input_per_mtok` / `output_per_mtok` (USD
per million tokens), reachable from `.env` as `AGENT_INPUT_PER_MTOK` /
`AGENT_OUTPUT_PER_MTOK` and from the per-user JSON `store.py` already
persists. **The panel sends nothing new** for this; the extensionless self-host
path works unchanged, and the same two fields carry a self-hoster's context
window through `modelConfig.context_window`.

Four rules, all of them load-bearing:

- **A catalogue rate always beats a stated one.** `_catalog_for` falls back to
  the stated rate only when the catalogue has none — the catalogue is read off
  each vendor's own pricing page and a typed rate is not.
- **Cached tokens bill at the stated input rate.** A cache read is not free, and
  pricing it at zero is the same confidently-wrong number as pricing the whole
  model at zero.
- **Both fields or neither.** Half a rate prices nothing, so a lone field is
  rejected, and both-absent stays the honest "not priced" `TaskResult.cost_usd`
  already was. `None` is never rendered as `$0.00`.
- **A stated rate is range-checked symmetrically and must be finite.** `nan < 0`
  is False, so a bare `< 0` let a NaN through into `Pricing` and out as
  `cost_usd=nan` — which defeats the budget cap rather than failing it.
  `resolver._rate()` raises naming the variable, so a malformed
  `AGENT_INPUT_PER_MTOK` says its own name.

**A `$0.00` rate is a truthful cost, and an unenforceable cap.** A local box
genuinely costs the user nothing per token, and calling that "unpriced" would be
a lie in the other direction — so it stands. What is broken is the ceiling:
`BROTTO_MAX_TASK_COST_USD` cannot be exceeded by zero. `pricing.
is_unenforceable()` detects it and the harness warns **at task start**, because
the operator is the one who has to know their cap is not live.
`is_unenforceable()` is deliberately distinct from `price_usage` returning
`None`: the cost is honest, it is the cap that is unreachable. Pinned by
`tests/test_task_cost.py` and `tests/model/test_pricing.py`.

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

**That fallback is now something the user can overrule.** For a provider with
`accepts_any_model` the catalogue can only offer a fallback, so the same 128k
answer sized the AX-tree budget for every model on a 32k vLLM box and on a 1M
one alike. Settings shows a context-window input beside the base-URL field,
under the same rule that shows that field, persisted onto the
`modelConfig.context_window` that already exists. `effectiveContextWindow()`
uses the typed value only when the provider applies and it parses to a positive
finite number — empty, `32k`, `0`, `-5` and `abc` all fall back to the
catalogue, because a persisted `0` would size the budget to nothing. **The
wizard no longer overwrites a stated window with its own 128k fallback**: a
number the user typed outranks the only answer the catalogue can give, and
re-running the wizard must not silently write the fallback back over it.

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

**The key must be in `.env` itself, not in the shell.** While the model key lived in `chrome.storage.session`, reloading the extension dropped the key it sends — which is what produced the recurring `AnthropicProvider(api_key=...)` error. With `BROTTO_FORCE_ENV_MODEL=1` the extension's key is never consulted, so the only thing that matters is `ANTHROPIC_AUTH_TOKEN` being in `.env`. A shell-exported token is not enough: it isn't inherited by a server started from Finder, a launch agent, or a fresh terminal. Verify with the key scrubbed from the environment entirely:

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

- An inline config **without** a key is ignored and falls through, for every
  provider without exception. While the key lived in `chrome.storage.session`,
  the extension sent a config and no key after every browser restart. Honoring that gave a keyless provider and "Set
  `ANTHROPIC_API_KEY`" while shadowing a working `.env`.
- A per-user config persists the *model* only, never a key — so after a browser
  restart it is unusable on its own and the resolver says so explicitly. It
  does now persist the **base URL**, which is the half that is not a secret.

## The pre-flight (`POST /v1/model/check`)

The panel asks the server "can this browser run anything?" before it starts a
task. The server resolves the config through the same three tiers `task_start`
uses, builds the same model, and makes **one real request** to the provider.
`{"ok": true, "model": "provider:model"}` or
`{"ok": false, "kind": ..., "error": <a sentence the user can act on>}`.

**A check that never calls the provider answers `ok` for every key ever typed,
including the wrong one.** That is the whole point of it, and it is why
`tests/test_model_check_endpoint.py` asserts the fake model was *called* rather
than only checking the response shape.

**Three things about it that are not obvious:**

- **A failed check is not a failed model.** A dead server, a 500, an
  unparseable body — all return `ok: true` to the panel. The server being down
  has its own reporting (connect, reconnect, the unreachable toast) and it
  already works; routing it through this gate would replace "Server
  unreachable, retrying" with "your API key was rejected", sending the user to
  fix something that isn't broken.
- **A pass is cached for 10 minutes in the panel; a failure is cached in
  storage, and only some kinds expire.** A pass is cached because paying for
  the probe on every send is a tax, and caching a *standing* failure would
  leave a user who has just fixed the key still blocked for the TTL — worse
  than not caching at all. The record itself is written to
  `chrome.storage.local` because the moment it matters is the moment the panel
  is closed. Its **lifetime follows the taxonomy above**:
  `TRANSIENT_CHECK_KINDS` (`rate_limited`, `provider_error`, `unreachable`,
  and the catch-all `error`) expire on the same 10-minute TTL as the pass
  cache and re-probe on the next send; every other kind stands until the user
  changes something, which is exactly what the banner asks them to do. A kind
  in neither list counts as **standing**, so one a future server ships cannot
  become a permanent block for every user it reaches. The record predates the
  TTL only in the transient direction — a standing failure never consults
  `at`.
  The cache is keyed on provider, model, base URL, the **server the probe is
  sent to**, and *whether* a key was present, never on the key itself; a
  re-paste in Settings clears it outright, since two keys of the same length
  are indistinguishable without hashing a secret to find out.
- **`_inline_model()` is one parser for three call sites** (this, `task_start`,
  `/v1/suggestions`). They were three separate literal parses, which is how a
  check ends up answering `ok` for a config the run would refuse.

**The gate sits after the steer, clarify and in-flight branches.** A steer is a
correction to a task already running and a clarify answer is an answer, not a
new run — neither should be blocked on a pre-flight that re-resolves a config
that is not changing. Ordering is invisible in a return value, so it is pinned
on the source by `scripts/test-model-check.test.js` rather than left to review.

**A 400 is classified by body, not by status.** MiniMax and OpenAI answer an
exhausted balance with a 400 and a sentence — "insufficient balance" — rather
than a 402, so `_CREDIT_HINTS` reads the body. The keyword test is deliberately
narrow: a schema complaint reported as `no_credits` would send someone to top
up a paid account.

**No branch forwards provider text — that is a property of every branch, not
of the 5xx one.** It started as a fix to one branch and it is the general rule:
`_classify_probe_failure` returns sentences *this file wrote*, and a kind, and
nothing else. Provider text goes to `log.warning` where an operator can read
it; a kind goes to the client, because a kind is the only part a client can
*act* on.

The rule is load-bearing because of what the panel does with the sentence: it
persists it to `chrome.storage.local` to survive a close. So a forwarded
`body[:300]` is not a response field, it is up to 300 characters of a third
party's HTTP response written to the user's disk indefinitely — against
"transit, never persist", and carrying whatever the far end felt like saying:
the URL it dialled, a fragment of the key, an internal hostname. `error` did
exactly that until this rule existed. Two tests hold it in place, one per
branch that has ever been caught doing it:
`test_the_response_never_echoes_the_key` (the invariant — the key is the one
thing that must never come back) and
`test_a_provider_5xx_never_echoes_the_provider_body` /
`test_the_generic_error_branch_never_echoes_the_provider_body` (the guard
against re-adding it "helpfully" — they assert the provider's own words are
absent, not just the key).

**A 5xx is `provider_error`, not `error` — for what it means, not what it may
forward.** `error` was absorbing three unrelated things: a 5xx, a 400 that
matched neither hint set, and a non-httpx SDK exception. A 5xx means the
request got *past* auth and the model itself failed — reported as `error` it
reads as "your key is wrong" and sends the user to re-paste a key that was
fine, which is the case the product owner named: *if the model is down, show
the error*. The split is therefore about diagnosis, and adding it was what
exposed the echo in its neighbour.

The kinds are therefore: `no_model`, `unknown_model`, `auth_failed`,
`no_credits`, `rate_limited`, `provider_error`, `unreachable`, `error`.
`no_model` is the only one the panel rewrites; the rest render
`modelCheckTitle(kind)`, which falls back to a generic sentence rather than
`undefined`, so a kind this build of the panel has not heard of degrades
instead of rendering nothing.

**Transport failures are found by walking `__cause__`.** pydantic-ai wraps a
connect failure in `ModelAPIError` and hangs the real error off the cause
(`raise ModelAPIError(...) from e`), so a `ConnectionRefusedError` never
reaches the handler directly. Every provider SDK it ships sits on httpx, so
one `httpx.TransportError` test covers refused connections, DNS misses, TLS
failures and timeouts. A LAN `base_url` that is down is the self-hosted user's
common failure, and classifying it as `auth_failed` would send them to re-paste
a key that was fine.

`no_model` is the one kind the panel **rewrites**. The resolver's message names
env vars and WS frame fields — accurate for an operator, useless to the person
reading the panel, and it is the only message that path can produce. The panel
replaces it with a sentence pointing at Settings.
