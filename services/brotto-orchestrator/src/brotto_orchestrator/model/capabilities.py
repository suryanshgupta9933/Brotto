"""What we know about a model the catalogue does not name.

A user can select any model string — `custom` with a LAN vLLM endpoint,
`openrouter/auto`, an env `provider:model` pair — and for an id outside
`PROVIDER_CATALOG` we knew nothing: not the window, not the price, not
whether it takes an image. Permanently, on every run. An unknown window
sizes the AX-tree budget to `MAX_CHARS`; an unknown price means
`BROTTO_MAX_TASK_COST_USD` can never fire.

Four tiers, in order, **never optimistic**:

1. the curated catalogue — authoritative for the window and the price, and
   for vision only where it says **yes**; its `False` means "not documented"
   and is no more a denial than a `None` is;
2. the vendor's own metadata API, one function per vendor that has one;
3. a probe — one 1x1 PNG, only where tier 2 gave no vision answer;
4. a conservative default — `None` everywhere, meaning *unknown*.

Tier 4 is the whole design's safety property: `None` for a window, `None`
(never `0.0`) for a price, `None` for vision. `price_usage` already treats
`None` as "unknown" and refuses to guess, so a confidently wrong number
never reaches `TaskResult.cost_usd` — and the panel, which renders a cost
it is given, would otherwise draw a reassuring `$0.00`.

**The probe's answer is tri-state and only one arm records anything.**
Gemini answers `400 INVALID_ARGUMENT` both for a text-only model and for a
payload it considers malformed, so the status alone cannot tell "this model
is not multimodal" from "I sent something wrong". The probe therefore sends
the *same* message twice — once with the image part, once without — and only
a rejection that the text-only control accepts counts as a `False`. A 401, a
429, a 5xx, a timeout, a refused connection and a malformed response all
leave vision `None` and record nothing, because a wrong `False` is a
confident lie that later gates a frame out of every future run.

**Nothing here may block a task.** `resolve()` does catalogue and cache
lookups only and does no I/O; the network tiers run behind `warm()`, which
callers should invoke off the event loop (`warm_async` does that). Every
vendor call is wrapped so that any failure at any tier degrades to tier 4.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, replace
from urllib.parse import urlsplit
from pathlib import Path

from brotto_orchestrator.model import catalog, pricing as pricing_mod
from brotto_orchestrator.model.catalog import Pricing
from brotto_orchestrator.model.store import _safe_filename

log = logging.getLogger(__name__)

BROTTO_USER_MODEL_CAPS_DIR_ENV = "BROTTO_USER_MODEL_CAPS_DIR"

# Probes cost money and a metadata call is a round trip, so a learned fact is
# kept for a month. Long enough that a per-task caller never re-probes, short
# enough that a model whose window was raised by its vendor gets re-read.
_TTL_SECONDS = 30 * 24 * 3600
_METADATA_TIMEOUT = 4.0
_PROBE_TIMEOUT = 20.0

# The smallest valid PNG there is, base64'd. 1x1, fully transparent: enough
# for a provider to say whether the *modality* is accepted, small enough that
# the probe is dominated by round-trip latency.
_PIXEL_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
_PROBE_TEXT = "ping"

# Roots for a probe when neither the caller's base_url nor the catalogue
# entry names one. `catalog.ProviderInfo.default_base_url` is None for
# Anthropic and OpenAI — the two vendors whose root is so well known that
# nothing needed to store it — so a probe needs them spelled out once here.
_SHAPE_ROOT = {
    "anthropic": "https://api.anthropic.com",
    "openai": "https://api.openai.com/v1",
    "gemini": "https://generativelanguage.googleapis.com",
}


@dataclass(frozen=True)
class Capabilities:
    """What is known about one model. Every field is tri-state: a `False` on
    `vision` is a fact ("the vendor rejects image parts"), a `None` is the
    absence of one. `source` names the tier that produced the answer, so an
    operator reading a log can tell a curated fact from a probe."""

    context_window: int | None = None
    vision: bool | None = None
    pricing: Pricing | None = None
    source: str = "default"

    @property
    def known(self) -> bool:
        return any(
            v is not None for v in (self.context_window, self.vision, self.pricing)
        )

    def to_dict(self) -> dict[str, object]:
        p = self.pricing
        return {
            "context_window": self.context_window,
            "vision": self.vision,
            "source": self.source,
            "pricing": None if p is None else {
                k: getattr(p, k)
                for k in (
                    "input_per_mtok", "output_per_mtok",
                    "cache_read_per_mtok", "cache_write_per_mtok",
                    "long_context_threshold", "input_per_mtok_long",
                    "output_per_mtok_long", "cache_read_per_mtok_long",
                    "cache_write_per_mtok_long",
                )
            },
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Capabilities":
        p = data.get("pricing")
        return cls(
            context_window=data.get("context_window"),
            vision=data.get("vision"),
            source=str(data.get("source", "default")),
            pricing=Pricing(**p) if isinstance(p, dict) else None,
        )


UNKNOWN = Capabilities()


# --------------------------------------------------------------------------
# HTTP seams. Two functions, both total: they return None / (False, "")
# rather than raising, because every call here is best-effort by
# construction — a vendor API that changed shape must cost a run its window
# budget, not the run itself.
# --------------------------------------------------------------------------

def _get_json(
    url: str, *, label: str, headers: dict | None = None,
    params: dict | None = None, timeout: float = _METADATA_TIMEOUT,
) -> dict | None:
    """`label` is what the diagnostics name, never the URL.

    Gemini authenticates with `?key=<api_key>` in the query — so a URL is a
    credential the moment it is built, and every diagnostic that printed one
    wrote the user's key into the log file. The label says *which vendor*
    failed, which is what the line was for anyway. Pinned by
    `test_a_credential_is_never_logged`.
    """
    import httpx

    try:
        response = httpx.get(url, headers=headers or {}, params=params, timeout=timeout)
        if response.status_code != 200:
            log.warning("model metadata: %s -> HTTP %s", label, response.status_code)
            return None
        return response.json()
    except Exception as exc:  # noqa: BLE001 — any failure means "no metadata"
        log.warning("model metadata: %s -> %s", label, type(exc).__name__)
        return None


def _post_probe(
    url: str, body: dict, *, label: str, headers: dict | None = None,
    timeout: float = _PROBE_TIMEOUT,
) -> tuple[bool, str]:
    """`(accepted, body_text)`. Never raises: a dead server and a rejected
    payload are the same answer here, and the probe's control request is what
    tells them apart. `label` for the same reason as `_get_json`."""
    import httpx

    try:
        response = httpx.post(url, json=body, headers=headers or {}, timeout=timeout)
        return 200 <= response.status_code < 300, response.text
    except Exception as exc:  # noqa: BLE001 — see above
        log.warning("vision probe: %s -> %s", label, type(exc).__name__)
        return False, ""


def _safe_url(url: str) -> str:
    """The vendor's host, and nothing else. **Never raises.**

    A URL carries three credentials, not one: the query (Gemini's `?key=`),
    the userinfo (`user:pass@`) and — for a `custom` base_url, where the URL is
    whatever the user typed — a path that can itself be a token. So the
    authority is rebuilt from the parsed host and port and everything else is
    dropped. Keeping the host is the point: a diagnostic that cannot say which
    endpoint answered is not a diagnostic.

    `urlsplit` raises `ValueError` on malformed input and `.port` raises on a
    non-numeric one, and this runs from inside `except` handlers on paths that
    promise to be total — so the whole body is guarded and a bad URL degrades
    to a placeholder instead of escaping at the moment the code is already
    failing. Pinned by `test_a_malformed_url_still_produces_a_string`.
    """
    try:
        parts = urlsplit(url)
        host = parts.hostname
        if not host:
            return "<no-host>"
        # `.port` is a property and raises; read it inside the guard.
        port = parts.port
        return f"{parts.scheme}://{host}" + (f":{port}" if port else "")
    except Exception:  # noqa: BLE001 — totality is the whole contract here
        return "<unparseable>"


# --------------------------------------------------------------------------
# Tier 2 — vendor metadata
# --------------------------------------------------------------------------

def _per_mtok(raw: object) -> float | None:
    """OpenRouter publishes USD *per token* as a string. Per million is the
    catalogue's unit. A rate that will not parse is no rate."""
    try:
        return float(raw) * 1_000_000  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _openrouter(model_id: str, base_url: str | None, api_key: str | None):
    """`GET /api/v1/models` — the only vendor here that publishes a rate per
    model, which is why an unpriced OpenRouter id is worth this call. No auth
    and edge-cached with `cache-control: public, max-age=120`, so a long local
    TTL costs nothing and cannot burn a user's quota."""
    root = (base_url or "https://openrouter.ai/api/v1").rstrip("/")
    payload = _get_json(f"{root}/models", label="openrouter")
    if not payload:
        return None
    wanted = model_id.strip("/").lower()
    tail = wanted.split("/")[-1]
    for entry in payload.get("data") or []:
        if not isinstance(entry, dict):
            continue
        full = str(entry.get("id", "")).lower()
        # Ids are namespaced (`anthropic/claude-sonnet-5-5`); a user who typed
        # the bare model into a free-text box meant the same model.
        if full != wanted and full.split("/")[-1] != tail:
            continue
        rates = entry.get("pricing") or {}
        # `overrides[]` replaces the base rates inside a UTC window. Take the
        # one covering now, or the base rates when none does.
        now = time.time()
        for override in rates.get("overrides") or []:
            if not isinstance(override, dict):
                continue
            start, end = override.get("start_time"), override.get("end_time")
            if start is None:
                continue
            if now >= float(start) and (end is None or now < float(end)):
                rates = override
                break
        # A cache read is billed at a fraction of input, a cache write at the
        # input rate when the vendor publishes no separate one — the same
        # choice `pricing.user_rates` makes, and for the same reason.
        window = entry.get("context_length")
        modalities = (entry.get("architecture") or {}).get("input_modalities") or []
        return Capabilities(
            context_window=window if isinstance(window, int) and window > 0 else None,
            # `or None` here would turn a documented `False` into an unknown
            # and send the model on to the probe, which is the one thing that
            # costs money. Absent modalities is the only unknown.
            vision=("image" in modalities) if modalities else None,
            pricing=pricing_mod.user_rates(
                _per_mtok(rates.get("prompt")), _per_mtok(rates.get("completion"))
            ),
            source="metadata",
        )
    return None


def _anthropic_api(model_id: str, base_url: str | None, api_key: str | None):
    """`GET /v1/models`. `max_input_tokens` is an int *or* null, and
    `capabilities.image_input` is always present — so `.supported` is the fact
    and the mere presence of the key is not."""
    if not api_key:
        return None
    root = (base_url or _SHAPE_ROOT["anthropic"]).rstrip("/")
    payload = _get_json(
        f"{root}/v1/models",
        label="anthropic",
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
    )
    for entry in (payload or {}).get("data") or []:
        if not isinstance(entry, dict) or entry.get("id") != model_id:
            continue
        window = entry.get("max_input_tokens")
        supported = (entry.get("capabilities") or {}).get("image_input") or {}
        flag = supported.get("supported")
        return Capabilities(
            context_window=window if isinstance(window, int) and window > 0 else None,
            vision=flag if isinstance(flag, bool) else None,
            source="metadata",
        )
    return None


def _deepseek_api(model_id: str, base_url: str | None, api_key: str | None):
    """`GET /models` — `context_window` and `input_modalities` both, so DeepSeek
    never needs the probe for a model it lists."""
    if not api_key:
        return None
    root = (base_url or "https://api.deepseek.com").rstrip("/")
    payload = _get_json(
        root if root.endswith("/models") else f"{root}/models",
        label="deepseek",
        headers={"Authorization": f"Bearer {api_key}"},
    )
    for entry in (payload or {}).get("data") or []:
        if not isinstance(entry, dict) or entry.get("id") != model_id:
            continue
        window = entry.get("context_window")
        modalities = entry.get("input_modalities") or []
        return Capabilities(
            context_window=window if isinstance(window, int) and window > 0 else None,
            vision=("image" in modalities) if modalities else None,
            source="metadata",
        )
    return None


def _gemini_api(model_id: str, base_url: str | None, api_key: str | None):
    """`GET /v1beta/models`. Paginated — `pageSize` caps at 1000 and a long
    tail of models sits behind `nextPageToken`, so a single page truncates
    silently and reads as "this model does not exist".

    No vision field anywhere in the response, so this tier can never answer
    it and every Gemini id goes on to the probe."""
    if not api_key:
        return None
    root = (base_url or _SHAPE_ROOT["gemini"]).rstrip("/")
    wanted = model_id.split("/")[-1]
    page_token: str | None = None
    for _ in range(20):  # a model list longer than 20 pages is a runaway
        params: dict[str, object] = {"key": api_key, "pageSize": 1000}
        if page_token:
            params["pageToken"] = page_token
        payload = _get_json(f"{root}/v1beta/models", params=params, label="gemini")
        if not payload:
            return None
        for entry in payload.get("models") or []:
            if not isinstance(entry, dict):
                continue
            if str(entry.get("name", "")).split("/")[-1] != wanted:
                continue
            limit = entry.get("inputTokenLimit")
            return Capabilities(
                context_window=limit if isinstance(limit, int) and limit > 0 else None,
                vision=None,  # genuinely absent from this API — the probe's job
                source="metadata",
            )
        page_token = payload.get("nextPageToken")
        if not page_token:
            return None
    log.warning("model metadata: gemini list exceeded 20 pages")
    return None


def _custom_api(model_id: str, base_url: str | None, api_key: str | None):
    """`{base_url}/v1/models` is a *community convention*, not a standard —
    vLLM, LM Studio and llama.cpp implement something close, and anything
    else answers with whatever it likes. Three consequences, all of them the
    reason this function returns `None` on anything unexpected: the host is
    user-supplied, so the call must never block task start (4s cap, and every
    transport error is swallowed above); the shape cannot be assumed; and the
    window field is spelled four different ways across the implementations."""
    if not base_url:
        return None
    root = base_url.rstrip("/")
    payload = _get_json(
        root if root.endswith("/v1/models") else f"{root}/v1/models",
        label="custom",
        headers={"Authorization": f"Bearer {api_key}"} if api_key else None,
    )
    for entry in (payload or {}).get("data") or []:
        if not isinstance(entry, dict):
            continue
        if entry.get("id") not in (model_id, f"models/{model_id}"):
            continue
        window = next(
            (
                entry.get(k)
                for k in ("context_length", "context_window", "max_model_len",
                          "max_model_length", "num_ctx")
                if entry.get(k)
            ),
            None,
        )
        return Capabilities(
            context_window=window if isinstance(window, int) and window > 0 else None,
            vision=None,  # no implementation publishes this; never inferred
            source="metadata",
        )
    return None


# OpenAI and Groq are absent on purpose: their `GET /v1/models` returns
# `id`/`object`/`created`/`owned_by` and nothing else — no window, no price,
# no capabilities. Calling it would be a round trip that cannot answer the
# question. MiniMax is absent for a different reason: its `/v1/models` is
# undocumented, so parsing it defensively means inventing a contract, and
# every MiniMax model Brotto ships is in the catalogue anyway — an unknown
# MiniMax id is an operator typo, not a model we need to describe. Both go
# straight to the probe.
_METADATA: dict[str, object] = {
    "openrouter": _openrouter,
    "anthropic": _anthropic_api,
    "deepseek": _deepseek_api,
    "gemini": _gemini_api,
    "custom": _custom_api,
}


# --------------------------------------------------------------------------
# Tier 3 — the probe
# --------------------------------------------------------------------------

def _probe_base(provider: str, base_url: str | None) -> str | None:
    if base_url:
        return base_url.rstrip("/")
    info = catalog.get(provider)
    if info is not None and info.default_base_url:
        return info.default_base_url.rstrip("/")
    shape = info.api_shape if info is not None else "openai"
    return _SHAPE_ROOT.get(shape)


def _probe_request(
    provider: str, model_id: str, *, with_image: bool, base_url: str | None = None,
) -> tuple[str, dict, dict] | None:
    """`(url, body, headers)` for one probe request in the vendor's own shape.
    The image part is the only difference between the probe and its control."""
    info = catalog.get(provider)
    shape = info.api_shape if info is not None else "openai"
    root = _probe_base(provider, base_url)
    if root is None:
        return None
    if shape == "anthropic":
        content: object = (
            [
                {"type": "image",
                 "source": {"type": "base64", "media_type": "image/png",
                            "data": _PIXEL_PNG_B64}},
                {"type": "text", "text": _PROBE_TEXT},
            ]
            if with_image else _PROBE_TEXT
        )
        body = {"model": model_id, "max_tokens": 1,
                "messages": [{"role": "user", "content": content}]}
        return f"{root}/v1/messages", body, {"anthropic-version": "2023-06-01"}
    if shape == "gemini":
        parts = (
            [{"inline_data": {"mime_type": "image/png", "data": _PIXEL_PNG_B64}},
             {"text": _PROBE_TEXT}]
            if with_image else [{"text": _PROBE_TEXT}]
        )
        body = {"contents": [{"role": "user", "parts": parts}],
                "generationConfig": {"maxOutputTokens": 1}}
        return f"{root}/v1beta/models/{model_id}:generateContent", body, {}
    content = (
        [
            {"type": "image_url",
             "image_url": {"url": f"data:image/png;base64,{_PIXEL_PNG_B64}"}},
            {"type": "text", "text": _PROBE_TEXT},
        ]
        if with_image else _PROBE_TEXT
    )
    body = {"model": model_id, "max_tokens": 1,
            "messages": [{"role": "user", "content": content}]}
    return f"{root}/chat/completions", body, {}


def probe_vision(
    provider: str, model_id: str, api_key: str | None,
    base_url: str | None = None,
) -> bool | None:
    """True, False, or None — and None is the answer for every failure.

    The control request is what makes `False` safe to record. Gemini answers
    `400 INVALID_ARGUMENT` both for a text-only model and for a payload it
    dislikes, so a bare 400 is not evidence. A rejection that the *text-only*
    control accepts is evidence; a rejection both share is our own fault or
    the provider's, and records nothing.
    """
    if not api_key:
        return None
    info = catalog.get(provider)
    shape = info.api_shape if info is not None else "openai"
    auth = {"x-api-key": api_key} if shape == "anthropic" else {
        "Authorization": f"Bearer {api_key}"
    }

    def _call(with_image: bool) -> tuple[bool, str]:
        """`(accepted, url)` — the URL is returned so the rejection diagnostic
        can name the host without the caller re-deriving a string it must then
        be trusted not to log."""
        built = _probe_request(
            provider, model_id, with_image=with_image, base_url=base_url
        )
        if built is None:
            return False, ""
        url, body, headers = built
        if shape == "gemini":  # authenticates with a query parameter
            url = f"{url}?key={api_key}"
        accepted, _body = _post_probe(
            url, body, headers={**headers, **auth}, label=provider
        )
        return accepted, url

    accepted, url = _call(True)
    if accepted:
        return True
    # The provider's body earns nothing: it is untrusted third-party text that
    # can carry the base URL, the resolved hostname or a fragment of the key,
    # and the only thing a caller can act on is the tri-state. Log the
    # classification and the host, and let `log.debug` below the log level be
    # where a body would live if it were ever needed.
    log.warning(
        "vision probe rejected for %s/%s at %s (body omitted)",
        provider, model_id, _safe_url(url),
    )
    return False if _call(False)[0] else None


# --------------------------------------------------------------------------
# The cache — a sidecar file, deliberately NOT a field on ModelConfig
# --------------------------------------------------------------------------

def _caps_dir() -> Path:
    return Path(os.getenv(BROTTO_USER_MODEL_CAPS_DIR_ENV, "logs/user_model_caps"))


def _cache_key(provider: str, model_id: str, base_url: str | None) -> str:
    return f"{provider}|{model_id}|{base_url or ''}"


def _read_cache(caller_key: str) -> dict:
    if not caller_key:
        return {}
    path = _caps_dir() / _safe_filename(caller_key)
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_cache(caller_key: str, key: str, caps: Capabilities) -> None:
    if not caller_key:
        return
    store = _read_cache(caller_key)
    store[key] = {**caps.to_dict(), "at": time.time()}
    try:
        path = _caps_dir() / _safe_filename(caller_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(store, sort_keys=True))
        tmp.replace(path)
    except OSError as exc:
        # A cache we cannot write is a cache that saves nothing. Never fatal.
        log.warning("failed to persist capability cache: %s", exc)


def _from_cache(caller_key: str, key: str) -> Capabilities | None:
    entry = _read_cache(caller_key).get(key)
    if not isinstance(entry, dict):
        return None
    at = entry.get("at")
    if not isinstance(at, (int, float)) or time.time() - at > _TTL_SECONDS:
        return None
    try:
        caps = Capabilities.from_dict(entry)
    except (TypeError, ValueError):
        return None
    return caps if caps.known else None


# --------------------------------------------------------------------------
# The resolver
# --------------------------------------------------------------------------

def _overlay(base: Capabilities | None, learned: Capabilities) -> Capabilities:
    """The catalogue's window and price over whatever a later tier learned; its
    `vision` under the later tier's, because the catalogue only settles vision
    by saying yes. `source` names both — an operator reading a log should be
    able to tell a curated rate from a probed modality."""
    if base is None:
        return learned
    source = (
        base.source if learned.source == "default"
        else f"{base.source}+{learned.source}"
    )
    return Capabilities(
        context_window=base.context_window,
        vision=learned.vision if learned.vision is not None else base.vision,
        pricing=base.pricing,
        source=source,
    )


def resolve(
    provider: str,
    model_id: str,
    *,
    base_url: str | None = None,
    api_key: str | None = None,
    caller_key: str | None = None,
    allow_network: bool = False,
) -> Capabilities:
    """What we know about `provider:model_id`. **Never raises, never blocks.**

    With the default `allow_network=False` this is catalogue + cache only and
    performs no I/O, so it is safe on the task-start and per-step path. The
    network tiers run behind `warm()`.

    **The catalogue short-circuits on a positive fact only.** `ModelInfo.vision`
    is a plain `bool`, so its `False` means three different things across the
    catalogue: a vendor denying image input (DeepSeek's pro), a vendor saying
    nothing (the MiniMax M2 pair, Groq's open weights), and an
    `accepts_any_model` placeholder (`openrouter/auto`, `custom`). Only the
    first is a fact, and `catalog.py` says so itself — so a catalogue `False`
    is *unresolved*, not a denial, and falls through to the cache and then to
    the network tiers where a probe can earn a real `False` with its text-only
    control. `context_window` and `pricing` stay catalogue-authoritative
    throughout: those are read off the vendor's own published page, and a
    probe is a guess.
    """
    try:
        base: Capabilities | None = None
        known = pricing_mod.lookup(provider, model_id)
        if known is not None:
            base = Capabilities(
                context_window=known.context_window,
                vision=True if known.vision else None,
                pricing=known.pricing,
                source="catalog",
            )
            if known.vision:  # a documented yes settles it — never probed
                return base

        key = _cache_key(provider, model_id, base_url)
        cached = _from_cache(caller_key or "", key)
        if cached is not None:
            return _overlay(base, cached)

        if not allow_network:
            return base if base is not None else UNKNOWN

        caps = UNKNOWN
        fetch = _METADATA.get(provider)
        if fetch is not None:
            caps = fetch(model_id, base_url, api_key) or UNKNOWN  # type: ignore[operator]
        if caps.vision is None:
            probed = probe_vision(provider, model_id, api_key, base_url)
            if probed is not None:
                # The probe is the most recent fact about this model, so it
                # names the source even where metadata supplied the window.
                caps = replace(caps, vision=probed, source="probe")
        caps = _overlay(base, caps)
        if caps.known:
            _write_cache(caller_key or "", key, caps)
            return caps
        return base if base is not None else UNKNOWN
    except Exception as exc:  # noqa: BLE001 — the invariant is that this never
        # propagates. A capability lookup is an optimisation; a run that raises
        # inside it loses the task.
        log.warning(
            "capability resolution failed for %s/%s: %s",
            provider, model_id, type(exc).__name__,
        )
        return UNKNOWN


async def warm_async(
    provider: str, model_id: str, **kwargs,
) -> Capabilities:
    """`resolve()` with the network tiers, off the event loop.

    Callers on an async path (the harness) must use this rather than
    `resolve(..., allow_network=True)`: a metadata call is a 4s round trip and
    a probe is a real request, and blocking a loop for either is exactly the
    "never block task start" rule inverted.
    """
    return await asyncio.to_thread(
        resolve, provider, model_id, allow_network=True, **kwargs
    )