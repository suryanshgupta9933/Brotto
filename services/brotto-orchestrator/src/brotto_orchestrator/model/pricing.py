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

from brotto_orchestrator.model.catalog import PROVIDER_CATALOG, ModelInfo

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


def price_usage(
    info: ModelInfo | None,
    *,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read: int = 0,
    cache_write: int = 0,
) -> float | None:
    """USD, or None when the price is unknown. None is a supported answer: a
    visibly absent cost beats a confidently wrong one, because the consumer of
    this number is a budget cap."""
    if info is None or info.pricing is None:
        return None
    p = info.pricing
    return (
        input_tokens * p.input_per_mtok
        + output_tokens * p.output_per_mtok
        + cache_read * p.cache_read_per_mtok
        + cache_write * p.cache_write_per_mtok
    ) / _MTOK
