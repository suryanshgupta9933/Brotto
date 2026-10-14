"""Cost of a run, from the catalog's per-model rates.

pydantic-ai has a `RunUsage.cost`, but in 2.31 only some models populate it —
`AnthropicModel` has no cost calculation at all, so for MiniMax and Claude it
stays 0. The catalog is therefore the only place a number can come from.

Cache tokens are the reason this is not `tokens * rate`. CLAUDE.md records that
Brotto's stable prompt prefix is cached, so on a normal multi-step run the
cached read dominates input volume while costing a tenth of the rate; an
input/output-only estimate overprices the actual workload several-fold. Note
`RunUsage.input_tokens` is the *uncached* portion — the API reports the three
counts separately and they do not overlap.
"""

from __future__ import annotations

from brotto_orchestrator.model.catalog import PROVIDER_CATALOG, ModelInfo, Pricing

_MTOK = 1_000_000


def lookup(provider: str, model_id: str) -> ModelInfo | None:
    """The catalog entry for a `provider:model` pair, or None. An unknown pair
    and a known model with no verified rate are different facts, and only the
    second one is priced."""
    info = PROVIDER_CATALOG.get(provider)
    if info is None:
        return None
    for model in info.models:
        if model.id == model_id:
            return model
    return None


def user_rates(
    input_per_mtok: float | None, output_per_mtok: float | None
) -> Pricing | None:
    """The rates a user stated for a model the catalogue has no entry for.

    Cached tokens are input tokens and a self-run box publishes no separate
    cache rate, so they bill at the stated input rate. Pricing them at $0.00
    would be the same confidently-wrong number as pricing the whole model at
    zero, and the consumer is a budget cap. Returns None when either rate is
    absent — a half-stated rate prices nothing, and "not priced" survives to
    `TaskResult.cost_usd` unchanged.
    """
    if input_per_mtok is None or output_per_mtok is None:
        return None
    return Pricing(input_per_mtok, output_per_mtok, input_per_mtok, input_per_mtok)


def is_unenforceable(info: ModelInfo | Pricing | None) -> bool:
    """Whether every rate is $0.00 — a truthful cost that a spend ceiling set
    against it can never exceed. Distinct from `None` (not priced) because the
    cost is honest here; it is the *cap* that is unreachable, and the operator
    is the one who has to know that."""
    p = info.pricing if isinstance(info, ModelInfo) else info
    return p is not None and not any(p.rates(long_context=False))


def price_usage(
    info: ModelInfo | Pricing | None,
    *,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read: int = 0,
    cache_write: int = 0,
) -> float | None:
    """USD, or None when the price is unknown. None is a supported answer: a
    visibly absent cost beats a confidently wrong one, because the consumer of
    this number is a budget cap."""
    p = info.pricing if isinstance(info, ModelInfo) else info
    if p is None:
        return None
    # Past the threshold the vendor re-rates the *whole* request, not just the
    # tokens over the line, so the choice is made once on total input.
    long_context = (
        p.long_context_threshold is not None and input_tokens > p.long_context_threshold
    )
    i_rate, o_rate, read_rate, write_rate = p.rates(long_context=long_context)
    return (
        input_tokens * i_rate
        + output_tokens * o_rate
        + cache_read * read_rate
        + cache_write * write_rate
    ) / _MTOK
