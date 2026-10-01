"""Cost of a run, from the catalog's rates.

The property that matters: a cached token is an order of magnitude cheaper
than an input one, and Brotto's stable prompt prefix is cached on every step.
An estimate that ignores cache reads overprices a normal multi-step run several
fold, so `price_usage` must take the counts separately.
"""

from __future__ import annotations

from brotto_orchestrator.model.catalog import PROVIDER_CATALOG, Pricing
from brotto_orchestrator.model.pricing import lookup, price_usage

_SONNET = lookup("anthropic", "claude-3-5-sonnet-latest")
assert _SONNET is not None


def test_lookup_finds_a_model_by_provider_and_id():
    assert lookup("anthropic", "claude-3-5-sonnet-latest") is _SONNET


def test_lookup_does_not_guess_across_providers():
    """`MiniMax-M3` is a real model id — but not an Anthropic one, and sending
    it there is the bug `api_shape` exists to prevent."""
    assert lookup("anthropic", "MiniMax-M3") is None


def test_lookup_of_an_unknown_provider_or_model_is_none():
    assert lookup("nope", "gpt-4o") is None
    assert lookup("openai", "gpt-9-ultra") is None


def test_a_model_with_no_verified_rate_prices_as_none():
    """MiniMax is deliberately unpriced. A confidently wrong number is worse
    than a visibly absent one, because the consumer is a budget cap."""
    assert lookup("minimax", "MiniMax-M3").pricing is None
    assert price_usage(lookup("minimax", "MiniMax-M3"), input_tokens=1_000_000) is None


def test_pricing_an_unknown_model_is_none_not_zero():
    assert price_usage(None, input_tokens=1_000_000) is None


def test_a_cached_read_costs_its_own_rate():
    usd = price_usage(_SONNET, cache_read=1_000_000)
    assert usd == _SONNET.pricing.cache_read_per_mtok
    assert usd < price_usage(_SONNET, input_tokens=1_000_000)


def test_the_four_counts_add_up():
    usd = price_usage(
        _SONNET, input_tokens=1_000, output_tokens=2_000,
        cache_read=3_000, cache_write=4_000,
    )
    p = _SONNET.pricing
    expected = (
        1_000 * p.input_per_mtok
        + 2_000 * p.output_per_mtok
        + 3_000 * p.cache_read_per_mtok
        + 4_000 * p.cache_write_per_mtok
    ) / 1_000_000
    assert usd == expected


def test_no_usage_costs_nothing_rather_than_none():
    """A turn on a free local runtime is 0.00, not unknown."""
    assert price_usage(lookup("ollama", "llama3.1"), input_tokens=0) == 0.0


def test_a_local_runtime_is_free():
    local = lookup("ollama", "llama3.1")
    assert local.pricing == Pricing(0.0, 0.0, 0.0, 0.0)
    assert price_usage(local, input_tokens=10**9, output_tokens=10**9) == 0.0


def test_every_priced_model_has_a_plausible_rate_card():
    for pid, info in PROVIDER_CATALOG.items():
        for m in info.models:
            # A local runtime is free, and unlike a missing price that one is
            # certain — so zero is a valid rate, not an unverified one.
            if m.pricing is None or m.pricing.input_per_mtok == 0:
                continue
            p = m.pricing
            assert m.context_window > 0, f"{pid}/{m.id}"
            assert p.input_per_mtok > 0, f"{pid}/{m.id}"
            assert p.output_per_mtok >= p.input_per_mtok, f"{pid}/{m.id}"
            # Anthropic-style: a cache read is ~10% of input and a write
            # ~125%. A card violating that is a transcription error, and the
            # whole reason cache is priced separately.
            assert p.cache_read_per_mtok < p.input_per_mtok, f"{pid}/{m.id}"
            assert p.cache_write_per_mtok > p.cache_read_per_mtok, f"{pid}/{m.id}"
