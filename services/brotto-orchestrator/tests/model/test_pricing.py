"""Cost of a run, from the catalog's rates.

The property that matters: a cached token is an order of magnitude cheaper
than an input one, and Brotto's stable prompt prefix is cached on every step.
An estimate that ignores cache reads overprices a normal multi-step run several
fold, so `price_usage` must take the counts separately.
"""

from __future__ import annotations

from brotto_orchestrator.model.catalog import PROVIDER_CATALOG, Pricing
from brotto_orchestrator.model.pricing import lookup, price_usage

_SONNET = lookup("anthropic", "claude-sonnet-5-5")
assert _SONNET is not None
# Past 272K input OpenAI re-rates the *whole* request, and MiniMax past 512K.
_SOL = lookup("openai", "gpt-6.1-sol")
assert _SOL is not None
_M3 = lookup("minimax", "MiniMax-M3")
assert _M3 is not None


def test_lookup_finds_a_model_by_provider_and_id():
    assert lookup("anthropic", "claude-sonnet-5-5") is _SONNET


def test_lookup_does_not_guess_across_providers():
    """`MiniMax-M3` is a real model id — but not an Anthropic one, and sending
    it there is the bug `api_shape` exists to prevent."""
    assert lookup("anthropic", "MiniMax-M3") is None


def test_lookup_of_an_unknown_provider_or_model_is_none():
    assert lookup("nope", "gpt-6-luna") is None
    assert lookup("openai", "gpt-9-ultra") is None


def test_a_model_with_no_verified_rate_prices_as_none():
    """M3.1-Flash-Preview is Token Plan only and has no pay-as-you-go rate at
    all. A confidently wrong number is worse than a visibly absent one, because
    the consumer is a budget cap."""
    assert lookup("minimax", "MiniMax-M3.1-Flash-Preview").pricing is None
    assert price_usage(
        lookup("minimax", "MiniMax-M3.1-Flash-Preview"), input_tokens=1_000_000
    ) is None


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


def test_just_under_the_threshold_is_priced_at_the_base_rate():
    threshold = _SOL.pricing.long_context_threshold
    under = price_usage(_SOL, input_tokens=threshold, output_tokens=10_000)
    p = _SOL.pricing
    assert under == (threshold * p.input_per_mtok + 10_000 * p.output_per_mtok) / 1_000_000


def test_past_the_threshold_the_whole_request_is_rerated():
    """Not just the tokens over the line: OpenAI's published rule is 2x input
    and cache, 1.5x output, for the full request. A per-token split prices a
    long run at the base rate and undercounts it by up to half."""
    p = _SOL.pricing
    just_over = p.long_context_threshold + 1
    usd = price_usage(_SOL, input_tokens=just_over, output_tokens=100_000, cache_read=50_000)
    assert usd == (
        just_over * p.input_per_mtok_long
        + 100_000 * p.output_per_mtok_long
        + 50_000 * p.cache_read_per_mtok_long
    ) / 1_000_000
    at_base_rate = (
        just_over * p.input_per_mtok
        + 100_000 * p.output_per_mtok
        + 50_000 * p.cache_read_per_mtok
    ) / 1_000_000
    assert usd > at_base_rate


def test_a_model_with_no_long_tier_keeps_one_rate_at_any_size():
    """Gemini's tiers could not be read off the pricing page, so the catalog
    carries no threshold — inventing one would re-rate a 1M-token run at
    numbers nobody published."""
    gemini = lookup("gemini", "gemini-3.8-flash")
    assert gemini.pricing.long_context_threshold is None
    p = gemini.pricing
    assert price_usage(gemini, input_tokens=10**7, output_tokens=1) == (
        10**7 * p.input_per_mtok + 1 * p.output_per_mtok
    ) / 1_000_000


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
            # The load-bearing one: a cached read is cheaper than an uncached
            # input token. There is deliberately no matching assertion on the
            # write rate — Google charges per hour of storage rather than per
            # write and Groq publishes no write rate at all, so a 0.0 write is a
            # "not published", not a "free".
            assert p.cache_read_per_mtok < p.input_per_mtok, f"{pid}/{m.id}"


def test_a_long_tier_is_never_cheaper_than_the_base_rate():
    for pid, info in PROVIDER_CATALOG.items():
        for m in info.models:
            p = m.pricing
            if p is None or p.input_per_mtok_long is None:
                continue
            assert p.long_context_threshold is not None, f"{pid}/{m.id}"
            assert p.input_per_mtok_long >= p.input_per_mtok, f"{pid}/{m.id}"
            assert p.output_per_mtok_long >= p.output_per_mtok, f"{pid}/{m.id}"
            assert p.cache_read_per_mtok_long >= p.cache_read_per_mtok, f"{pid}/{m.id}"
