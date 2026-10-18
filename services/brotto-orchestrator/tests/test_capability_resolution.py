"""What we know about a model the catalogue does not name.

A user can select any model string — `custom` on a LAN vLLM box,
`openrouter/auto`, an env `provider:model` pair — and before this module every
such run knew nothing about its model: the AX-tree budget was sized to
`MAX_CHARS` by an unknown window, and `BROTTO_MAX_TASK_COST_USD` could never
fire because no rate existed.

The failure this file exists to prevent is not a missing capability. It is a
**wrong** one. Every assertion about an *absence* — a 401 recording nothing, a
refused connection raising nothing, a price staying `None` rather than
`0.0` — pins the invariant that the resolver is never optimistic. A
confidently wrong `vision=False` outlives the run that produced it: it is
cached for a month and then gates an image out of every future run of a
model that would have taken it.
"""

from __future__ import annotations

import json
import time

import pytest

from brotto_orchestrator.agent import ax_filter
from brotto_orchestrator.model import capabilities as caps_mod
from brotto_orchestrator.model.capabilities import (
    Capabilities,
    _TTL_SECONDS,
    probe_vision,
    resolve,
)
from brotto_orchestrator.model.pricing import price_usage

CATALOG_MODEL = ("anthropic", "claude-sonnet-5-5")


@pytest.fixture(autouse=True)
def _caps_dir(tmp_path, monkeypatch):
    """The cache is a file beside the per-user configs; point it at tmp so a
    test never writes to the developer's `logs/` and never reads another's."""
    monkeypatch.setenv(caps_mod.BROTTO_USER_MODEL_CAPS_DIR_ENV, str(tmp_path / "caps"))


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Wall the socket at `httpx`, one layer below the module's own seams.

    Stubbing `_get_json` / `_post_probe` is enough to make a test *pass* and
    not enough to make it *mean* anything: a seam that is bypassed on one path
    reaches a real vendor with a fake key, silently. A test that wants a
    transport failure overrides `httpx.post` itself, which is the layer that
    actually fails."""
    import httpx

    def _boom(*a, **kw):
        raise AssertionError("a test opened a socket — stub _get_json/_post_probe")

    monkeypatch.setattr(httpx, "get", _boom)
    monkeypatch.setattr(httpx, "post", _boom)


# --------------------------------------------------------------------------
# Tier 1 — the curated catalogue
# --------------------------------------------------------------------------

def test_a_catalogued_model_resolves_without_any_network(no_network):
    """Tier 1 is the curated entry, and it is authoritative enough that the
    lookup is done without touching a vendor — which is the behaviour every
    existing catalogue model already had."""
    caps = resolve(*CATALOG_MODEL)
    assert caps.source == "catalog"
    assert caps.context_window == 1_000_000
    assert caps.pricing is not None


def test_a_documented_yes_is_the_only_catalogue_short_circuit(no_network):
    """`vision=True` is a fact read off a vendor's own page, so it returns
    from the catalogue without touching a vendor even with the network tiers
    open."""
    caps = resolve(*CATALOG_MODEL, allow_network=True, api_key="k")
    assert caps.source == "catalog"
    assert caps.vision is True


def test_a_catalogue_false_is_unresolved_not_a_denial(monkeypatch):
    """`ModelInfo.vision` is a bool that means "not documented" wherever the
    vendor said nothing — so `deepseek-v4-pro`, the one model the catalogue
    records as text-only, is reported as unknown forever if the False
    short-circuits. It must reach the probe, keep the catalogue's window and
    price, and take the probed modality."""
    monkeypatch.setattr(caps_mod, "_get_json", lambda *a, **kw: None)
    # Image rejected, text-only control accepted — a real, earned False.
    monkeypatch.setattr(
        caps_mod, "_post_probe",
        lambda url, body, **kw: ("image" not in str(body), ""),
    )
    caps = resolve(
        "deepseek", "deepseek-v4-pro", allow_network=True, api_key="k",
        caller_key="dev-cat",
    )
    assert caps.vision is False
    assert caps.context_window == 1_000_000  # the catalogue's, not a probe's
    assert caps.pricing is not None
    assert caps.source == "catalog+probe"


def test_a_probed_false_on_a_catalogue_model_is_cached(monkeypatch):
    """The second resolve costs no network: the probe is a real request and
    this one ran once and will not run again for a month."""
    monkeypatch.setattr(caps_mod, "_get_json", lambda *a, **kw: None)
    monkeypatch.setattr(
        caps_mod, "_post_probe",
        lambda url, body, **kw: ("image" not in str(body), ""),
    )
    resolve("deepseek", "deepseek-v4-pro", allow_network=True, api_key="k",
            caller_key="dev-cat2")

    monkeypatch.setattr(
        caps_mod, "_get_json",
        lambda *a, **kw: (_ for _ in ()).throw(
            AssertionError("a cached fact must not be re-read")
        ),
    )
    monkeypatch.setattr(
        caps_mod, "_post_probe",
        lambda *a, **kw: (_ for _ in ()).throw(
            AssertionError("a cached fact must not be re-probed")
        ),
    )
    cached = resolve("deepseek", "deepseek-v4-pro", allow_network=True, api_key="k",
                     caller_key="dev-cat2")
    assert cached.vision is False
    assert cached.context_window == 1_000_000


def test_a_probe_never_overturns_a_documented_yes(monkeypatch):
    """The opposite sign of the same bug: a probe that disagrees must not
    demote a model the vendor documents as multimodal — that is what would
    gate a frame out of every future run of it."""
    monkeypatch.setattr(caps_mod, "_get_json", lambda *a, **kw: None)
    monkeypatch.setattr(caps_mod, "_post_probe", lambda *a, **kw: (False, "boom"))
    caps = resolve(*CATALOG_MODEL, allow_network=True, api_key="k")
    assert caps.vision is True
    assert caps.source == "catalog"


def test_an_uncatalogued_model_off_the_network_is_tier_four(no_network):
    """Without `allow_network` this is instant and total: an unknown model is
    `None` everywhere, never an exception, because the harness calls this on
    the task-start path where a raise would lose the task."""
    caps = resolve("custom", "qwen2.5-coder:7b", base_url="http://box:8000/v1")
    assert caps == caps_mod.UNKNOWN
    assert caps.context_window is None and caps.vision is None and caps.pricing is None


def test_an_unknown_window_budgets_to_the_floor_not_a_guess(no_network):
    """`budget_for_window(None)` is `MAX_CHARS` — the tightest tree we render.
    This is the concrete starvation the resolver exists to end, and it is the
    reason resolving the window at all is worth a network round trip."""
    caps = resolve("custom", "qwen2.5-coder:7b", base_url="http://box:8000/v1")
    assert ax_filter.budget_for_window(caps.context_window) == ax_filter.MAX_CHARS


# --------------------------------------------------------------------------
# Tier 2 — vendor metadata
# --------------------------------------------------------------------------

_OR_MODELS = {
    "data": [{
        "id": "anthropic/claude-sonnet-5-5",
        "context_length": 1_000_000,
        "architecture": {"input_modalities": ["text", "image"]},
        # USD per *token*, as strings.
        "pricing": {"prompt": "0.000002", "completion": "0.00001"},
    }]
}


def test_openrouter_supplies_a_window_a_price_and_a_modality(monkeypatch):
    """The one vendor that publishes a rate per model. Anything else answering
    `None` for price would mean the cap can never fire, so this path is what
    makes an arbitrary OpenRouter id priceable at all."""
    calls = []

    def fake(url, **kw):
        calls.append(url)
        return _OR_MODELS

    monkeypatch.setattr(caps_mod, "_get_json", fake)
    caps = resolve(
        "openrouter", "anthropic/claude-sonnet-5-5", allow_network=True,
    )
    assert caps.context_window == 1_000_000
    assert caps.vision is True
    # Per token -> per million, which is the catalogue's unit.
    assert caps.pricing.input_per_mtok == pytest.approx(2.00)
    assert caps.pricing.output_per_mtok == pytest.approx(10.00)
    # No auth, and the list is edge-cached.
    assert calls == ["https://openrouter.ai/api/v1/models"]


def test_openrouter_needs_no_key(monkeypatch):
    """The endpoint is public. A user with no OpenRouter key at all still gets
    a window and a rate for a model they route through someone else's key."""
    monkeypatch.setattr(caps_mod, "_get_json", lambda url, **kw: _OR_MODELS)
    caps = resolve("openrouter", "claude-sonnet-5-5", allow_network=True)
    assert caps.context_window == 1_000_000


def test_openrouter_applies_a_time_windowed_rate_override(monkeypatch):
    """`pricing.overrides[]` replaces the base rates inside a UTC window. A
    base rate read during a promotion is a rate the provider will not charge."""
    payload = json.loads(json.dumps(_OR_MODELS))
    payload["data"][0]["pricing"]["overrides"] = [{
        "start_time": time.time() - 60,
        "end_time": time.time() + 60,
        "prompt": "0.000004",
        "completion": "0.00002",
    }]
    monkeypatch.setattr(caps_mod, "_get_json", lambda url, **kw: payload)
    caps = resolve("openrouter", "anthropic/claude-sonnet-5-5", allow_network=True)
    assert caps.pricing.input_per_mtok == pytest.approx(4.00)


def test_anthropic_reads_the_supported_flag_and_not_the_key(monkeypatch):
    """`capabilities.image_input` is always present, so `.supported` is the
    fact and the mere existence of the key is not — treating presence as True
    is a bug that would assert vision on every model the endpoint lists."""
    payload = {
        "data": [{
            # An id the catalogue does not have, or tier 1 answers first and
            # this path never runs.
            "id": "claude-sonnet-5-5x",
            "max_input_tokens": 1_000_000,
            "capabilities": {"image_input": {"supported": False}},
        }]
    }
    monkeypatch.setattr(caps_mod, "_get_json", lambda url, **kw: payload)
    caps = resolve("anthropic", "claude-sonnet-5-5x", allow_network=True, api_key="k")
    assert caps.vision is False
    assert caps.context_window == 1_000_000


def test_anthropic_treats_a_null_window_as_unknown_not_zero(monkeypatch):
    """`max_input_tokens` is an int *or* null. A null is not a zero window."""
    monkeypatch.setattr(caps_mod, "_get_json", lambda url, **kw: {
        "data": [{"id": "claude-x", "max_input_tokens": None}]
    })
    caps = resolve("anthropic", "claude-x", allow_network=True, api_key="k")
    assert caps.context_window is None


def test_deepseek_answers_both_questions_from_one_table(monkeypatch):
    """DeepSeek publishes `context_window` and `input_modalities` together, so
    it never needs the probe — and its `["text"]` is the one hard `False`
    available without spending a request."""
    monkeypatch.setattr(caps_mod, "_get_json", lambda url, **kw: {
        "data": [{"id": "deepseek-v4", "context_window": 128_000,
                  "input_modalities": ["text"]}]
    })
    caps = resolve("deepseek", "deepseek-v4", allow_network=True, api_key="k")
    assert (caps.context_window, caps.vision) == (128_000, False)


def test_gemini_follows_pagination(monkeypatch):
    """`pageSize` caps at 1000 and the rest sits behind `nextPageToken`. A
    single page truncates silently, and a truncated list reads exactly like
    "this model does not exist" — so the model under test is on page two."""
    pages = [
        {"models": [{"name": "models/other"}], "nextPageToken": "page2"},
        {"models": [{"name": "models/gemini-x", "inputTokenLimit": 2_000_000}]},
    ]
    seen = []

    def fake(url, **kw):
        seen.append((kw.get("params") or {}).get("pageToken"))
        return pages[len(seen) - 1]

    monkeypatch.setattr(caps_mod, "_get_json", fake)
    caps = resolve("gemini", "gemini-x", allow_network=True, api_key="k")
    assert caps.context_window == 2_000_000
    assert seen == [None, "page2"]


def test_gemini_metadata_leaves_vision_unknown(monkeypatch):
    """There is no vision field anywhere in the Gemini response. Reporting a
    `False` from the absence would be the exact confidently-wrong number the
    tri-state exists to prevent — this tier must return `None` and hand the
    question to the probe."""
    monkeypatch.setattr(caps_mod, "_get_json", lambda url, **kw: {
        "models": [{"name": "models/gemini-x", "inputTokenLimit": 100}]
    })
    monkeypatch.setattr(caps_mod, "probe_vision", lambda *a, **kw: None)
    caps = resolve("gemini", "gemini-x", allow_network=True, api_key="k")
    assert caps.context_window == 100
    assert caps.vision is None


def test_openai_and_groq_never_ask_their_own_models_endpoint(monkeypatch):
    """`GET /v1/models` returns id/object/created/owned_by — no window, no
    price, no capability. The call cannot answer the question, so the only
    thing it could do is cost a round trip on the task-start path."""
    monkeypatch.setattr(
        caps_mod, "_get_json",
        lambda *a, **kw: (_ for _ in ()).throw(
            AssertionError("OpenAI/Groq /v1/models is useless — do not call it")
        ),
    )
    monkeypatch.setattr(caps_mod, "probe_vision", lambda *a, **kw: None)
    for provider in ("openai", "groq"):
        assert resolve(provider, "gpt-x", allow_network=True, api_key="k") is caps_mod.UNKNOWN


# --------------------------------------------------------------------------
# Tier 3 — the probe
# --------------------------------------------------------------------------

def test_an_accepted_image_proves_vision(monkeypatch):
    monkeypatch.setattr(caps_mod, "_post_probe", lambda *a, **kw: (True, ""))
    assert probe_vision("gemini", "gemini-x", api_key="k") is True


def test_a_rejection_the_text_only_control_accepts_is_a_false(monkeypatch):
    """The control is what makes `False` recordable. Gemini answers
    `400 INVALID_ARGUMENT` for a text-only model *and* for a payload it
    dislikes; only the second also fails without the image part."""
    calls = []

    def fake(url, body, **kw):
        calls.append(body)
        has_image = "inline_data" in body["contents"][0]["parts"][0]
        return (not has_image, "400 INVALID_ARGUMENT: image input not supported")

    monkeypatch.setattr(caps_mod, "_post_probe", fake)
    assert probe_vision("gemini", "gemini-x", api_key="k") is False
    assert len(calls) == 2


@pytest.mark.parametrize(
    "image_result,control_result",
    [
        pytest.param((False, "401 unauthorized"), (False, "401"), id="401"),
        pytest.param((False, "429 rate limited"), (False, "429"), id="429"),
        pytest.param((False, "503 upstream"), (False, "503"), id="5xx"),
        pytest.param((False, "malformed payload"), (False, "400 bad request"), id="malformed"),
    ],
)
def test_a_failure_shared_by_both_requests_records_nothing(
    monkeypatch, image_result, control_result
):
    """Every failure mode where the control fails too is *our* fault or the
    provider's, and the answer is unknown. This is the assertion that matters:
    a recorded `False` here is cached for 30 days and then withholds an image
    from a model that would have accepted one."""
    monkeypatch.setattr(
        caps_mod, "_post_probe",
        lambda url, body, **kw: (
            control_result
            if "inline_data" not in body["contents"][0]["parts"][0]
            else image_result
        ),
    )
    assert probe_vision("gemini", "gemini-x", api_key="k") is None


def test_a_connection_error_is_unknown_not_a_false(monkeypatch):
    """A transport failure never reaches a status code at all — a dead LAN box
    is the self-hoster's most common state, and reporting its model as
    text-only would be the one answer nobody could disprove. Stubs the socket
    rather than `_post_probe` so the swallowing under test is the real one."""
    import httpx

    def boom(*a, **kw):
        raise ConnectionRefusedError("box is down")

    monkeypatch.setattr(httpx, "post", boom)
    assert probe_vision("custom", "qwen", api_key="k") is None


def test_a_probe_with_no_key_is_unknown_and_costs_nothing(monkeypatch):
    monkeypatch.setattr(
        caps_mod, "_post_probe",
        lambda *a, **kw: (_ for _ in ()).throw(
            AssertionError("a probe without a key is a free call, not a request")
        ),
    )
    assert probe_vision("gemini", "gemini-x", api_key=None) is None


def test_the_probe_carries_a_one_pixel_image_and_one_token(monkeypatch):
    """The probe must not cost anything measurable: `max_tokens: 1` and a 1x1
    PNG. A probe that billed like a step would make this feature *cost* money
    on the models it is meant to save money on."""
    sent = {}

    def fake(url, body, **kw):
        sent.update(body)
        return True, ""

    monkeypatch.setattr(caps_mod, "_post_probe", fake)
    probe_vision("openai", "gpt-x", api_key="k")
    assert sent["max_tokens"] == 1
    url = sent["messages"][0]["content"][0]["image_url"]["url"]
    assert url.startswith("data:image/png;base64,iVBOR")


# --------------------------------------------------------------------------
# Tier 4 — and the price contract
# --------------------------------------------------------------------------

def test_an_unresolved_price_is_none_and_never_zero(monkeypatch):
    """`None` survives to `TaskResult.cost_usd` and renders as "no cost";
    `0.0` renders as a reassuring `$0.00` and makes the budget cap
    unenforceable. `audit.py` and `tests/test_task_cost.py` pin "no rate means
    no key" on the consumer side; this pins it on the producer side."""
    monkeypatch.setattr(caps_mod, "_get_json", lambda url, **kw: None)
    monkeypatch.setattr(caps_mod, "probe_vision", lambda *a, **kw: None)
    caps = resolve("custom", "qwen", base_url="http://box:8000/v1",
                   allow_network=True, api_key="k")
    assert caps.pricing is None
    assert price_usage(caps.pricing, input_tokens=1_000_000, output_tokens=1_000_000) is None
    assert not caps_mod.pricing_mod.is_unenforceable(caps.pricing)


def test_a_custom_host_that_refuses_the_connection_is_tier_four(monkeypatch):
    """`{base_url}/v1/models` is a community convention, not a standard, and
    the host is whatever the user typed. Every connection error means "no
    metadata" — it must degrade to tier 4 and never reach task start as an
    exception."""

    def boom(*a, **kw):
        raise ConnectionRefusedError("nothing listening")

    monkeypatch.setattr(caps_mod, "_get_json", boom)
    monkeypatch.setattr(caps_mod, "probe_vision", lambda *a, **kw: None)
    caps = resolve("custom", "qwen", base_url="http://127.0.0.1:1/v1",
                   allow_network=True, api_key="k")
    assert caps == caps_mod.UNKNOWN


def test_a_custom_host_answering_html_is_tier_four(monkeypatch):
    """A vLLM-shaped assumption is exactly what breaks: some hosts answer
    `/v1/models` with a 200 and a login page."""
    monkeypatch.setattr(caps_mod, "_get_json", lambda url, **kw: None)  # JSON decode
    monkeypatch.setattr(caps_mod, "probe_vision", lambda *a, **kw: None)
    assert resolve("custom", "qwen", base_url="http://box/v1",
                   allow_network=True, api_key="k") is caps_mod.UNKNOWN


def test_custom_metadata_is_read_defensively_across_spellings(monkeypatch):
    """vLLM says `max_model_len`, llama.cpp says `n_ctx`/`num_ctx`, LM Studio
    says `context_length`. Only the first is a guess; the rest are the same
    fact spelled differently."""
    monkeypatch.setattr(caps_mod, "_get_json", lambda url, **kw: {
        "data": [{"id": "qwen", "max_model_len": 32768}]
    })
    caps = resolve("custom", "qwen", base_url="http://box/v1",
                   allow_network=True, api_key="k")
    assert caps.context_window == 32768
    assert caps.vision is None  # no implementation publishes this


# --------------------------------------------------------------------------
# The cache
# --------------------------------------------------------------------------

def test_a_learned_capability_round_trips_and_skips_the_network(monkeypatch):
    """The second step of a task must not re-probe: the probe is a real
    request, and a per-step repetition is a per-step tax."""
    monkeypatch.setattr(caps_mod, "_post_probe", lambda *a, **kw: (True, ""))
    learned = resolve("groq", "gpt-x", allow_network=True, api_key="k", caller_key="dev-1")
    assert learned.vision is True and learned.source == "probe"

    monkeypatch.setattr(
        caps_mod, "_post_probe",
        lambda *a, **kw: (_ for _ in ()).throw(
            AssertionError("a cached fact must not be re-probed")
        ),
    )
    cached = resolve("groq", "gpt-x", allow_network=True, api_key="k", caller_key="dev-1")
    assert cached.vision is True


def test_a_run_that_learns_nothing_is_not_cached(monkeypatch):
    """The mirror of the test above, and the one that keeps the cache honest:
    a `None` is not a fact, so it is never written — a cached unknown would be
    indistinguishable from a learned answer once the vendor recovered."""
    monkeypatch.setattr(caps_mod, "_post_probe", lambda *a, **kw: (False, "401"))
    first = resolve("groq", "gpt-x", allow_network=True, api_key="k", caller_key="dev-0")
    assert first == caps_mod.UNKNOWN
    assert caps_mod._read_cache("dev-0") == {}


def test_an_expired_entry_is_re_resolved():
    """30 days is long enough that a per-task caller never re-probes and short
    enough that a model whose window was raised gets re-read."""
    caps_mod._write_cache("dev-2", caps_mod._cache_key("groq", "gpt-x", None),
                          Capabilities(vision=True, source="probe"))
    path = caps_mod._caps_dir() / caps_mod._safe_filename("dev-2")
    entry = json.loads(path.read_text())
    key = caps_mod._cache_key("groq", "gpt-x", None)
    entry[key]["at"] = time.time() - _TTL_SECONDS - 1
    path.write_text(json.dumps(entry))
    assert caps_mod._from_cache("dev-2", key) is None


def test_the_cache_is_a_sidecar_and_not_a_model_config_field():
    """`ModelConfig.from_dict` raises `ValueError` on an unknown field and
    `store.load_user_config` swallows it into a log line — so a cache field on
    the config would silently make every already-saved user config unreadable,
    one invisible warning per user per task."""
    from brotto_orchestrator.model.config import ModelConfig

    fields = set(ModelConfig("custom", "qwen", 32_000).to_dict())
    assert fields == {
        "provider", "model", "context_window", "base_url",
        "input_per_mtok", "output_per_mtok",
    }


def test_two_users_do_not_share_a_cache(monkeypatch):
    """The cache is keyed by the same per-install identity as the per-user
    config, so one user's learned window is not another's answer — and the
    filename is sanitised by the same helper, because this value is
    client-supplied."""
    monkeypatch.setattr(caps_mod, "_post_probe", lambda *a, **kw: (True, ""))
    resolve("groq", "gpt-x", allow_network=True, api_key="k", caller_key="dev-3")

    monkeypatch.setattr(
        caps_mod, "_post_probe",
        lambda *a, **kw: (_ for _ in ()).throw(
            AssertionError("dev-4 must not read dev-3's cache")
        ),
    )
    resolve("groq", "gpt-x", allow_network=True, api_key="k", caller_key="dev-4")


def test_a_corrupt_cache_file_is_not_an_error(monkeypatch):
    """The file is ours and it is disposable. A half-written or hand-edited
    one must not take task start with it."""
    caps_mod._caps_dir().mkdir(parents=True, exist_ok=True)
    (caps_mod._caps_dir() / caps_mod._safe_filename("dev-5")).write_text("{not json")
    assert resolve("groq", "gpt-x", caller_key="dev-5") is caps_mod.UNKNOWN


def test_warm_async_learns_the_same_facts_off_the_event_loop(monkeypatch):
    """The harness is async, and a metadata call is a 4s round trip with a real
    request behind it — calling the sync resolver there blocks the loop for
    every other session. `warm_async` is the only correct way in."""
    import asyncio

    monkeypatch.setattr(caps_mod, "_post_probe", lambda *a, **kw: (True, ""))
    warmed = asyncio.run(
        caps_mod.warm_async("groq", "gpt-x", api_key="k", caller_key="dev-6")
    )
    assert warmed.vision is True


def test_every_provider_resolves_without_raising(no_network):
    """The one invariant the whole module rests on: eight providers, free-text
    ids, a refused host, a missing key — and no exception out."""
    for provider in caps_mod.catalog.PROVIDER_CATALOG:
        for model_id, kwargs in (
            ("some-model", {}),
            ("org/some-model", {"base_url": None}),
            ("x", {"base_url": "http://box:8000/v1", "api_key": "k"}),
        ):
            caps = resolve(provider, model_id, **kwargs)
            assert isinstance(caps, Capabilities)