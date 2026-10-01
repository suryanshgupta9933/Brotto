"""The one place that knows which models exist.

This used to be a `list[tuple[str, int]]` in registry.py plus two hand-kept
copies in the extension (sidepanel.js, welcome.js), which had already drifted:
the extension listed three MiniMax models where the registry listed four.
There is now a server endpoint (`GET /v1/models`) that serves this, so adding a
model is one edit here.

`pricing` is None for a model we have no verified rate for, and every consumer
must treat that as "unknown" rather than zero — a confidently wrong cost is
worse than a visibly absent one, because the whole point is a budget cap.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Pricing:
    """USD per million tokens. Anthropic-style: a cache read is ~10% of input
    and a cache write ~125%. OpenAI bills cached input at half, with no
    separate write."""

    input_per_mtok: float
    output_per_mtok: float
    cache_read_per_mtok: float
    cache_write_per_mtok: float
    # Above this many *input* tokens the vendor re-rates the whole request, and
    # the `_long` rates replace the base ones for every token class. OpenAI does
    # this past 272K (2x input and cache, 1.5x output), MiniMax past 512K (2x
    # across the board). A threshold with no long rates means single-rate.
    long_context_threshold: int | None = None
    input_per_mtok_long: float | None = None
    output_per_mtok_long: float | None = None
    cache_read_per_mtok_long: float | None = None
    cache_write_per_mtok_long: float | None = None

    def rates(self, *, long_context: bool) -> tuple[float, float, float, float]:
        if not long_context or self.input_per_mtok_long is None:
            return (
                self.input_per_mtok,
                self.output_per_mtok,
                self.cache_read_per_mtok,
                self.cache_write_per_mtok,
            )
        return (
            self.input_per_mtok_long,
            self.output_per_mtok_long or self.output_per_mtok,
            self.cache_read_per_mtok_long or self.cache_read_per_mtok,
            self.cache_write_per_mtok_long or self.cache_write_per_mtok,
        )


@dataclass(frozen=True)
class ModelInfo:
    id: str
    context_window: int
    pricing: Pricing | None = None
    label: str = ""
    # Whether the model accepts image input. Anthropic and OpenAI both state
    # that *every* current model does, so this is only ever false where a
    # vendor says so (DeepSeek's pro) or has said nothing at all (the MiniMax
    # M2 pair, Groq's open weights). False therefore means "not documented",
    # not "confirmed text-only" — the vision fallback should treat a false as
    # a reason to check, not a proof.
    vision: bool = False

    def to_dict(self) -> dict[str, object]:
        p = self.pricing
        return {
            "id": self.id,
            "label": self.label or self.id,
            "context_window": self.context_window,
            "vision": self.vision,
            "pricing": None if p is None else {
                "input_per_mtok": p.input_per_mtok,
                "output_per_mtok": p.output_per_mtok,
                "cache_read_per_mtok": p.cache_read_per_mtok,
                "cache_write_per_mtok": p.cache_write_per_mtok,
                "long_context_threshold": p.long_context_threshold,
                "input_per_mtok_long": p.input_per_mtok_long,
                "output_per_mtok_long": p.output_per_mtok_long,
                "cache_read_per_mtok_long": p.cache_read_per_mtok_long,
                "cache_write_per_mtok_long": p.cache_write_per_mtok_long,
            },
        }


@dataclass(frozen=True)
class ProviderInfo:
    id: str
    label: str
    models: tuple[ModelInfo, ...]
    # Which request shape the vendor speaks: "anthropic", "gemini", or
    # "openai" (chat completions — what most of the industry converged on).
    # This is a fact about the vendor, not about pydantic-ai, which is why it
    # lives here and not in registry.py. Dispatch on it rather than on `id`:
    # MiniMax speaks the Anthropic shape from its own id, and guessing by id
    # sends OpenAI requests to an endpoint that only accepts Anthropic ones.
    api_shape: str = "openai"
    # Whether to show the user a base-URL field, and prefill it.
    accepts_base_url: bool = False
    default_base_url: str | None = None
    # When True the model control becomes free text, so `qwen2.5-coder:7b` and
    # OpenRouter's catalogue are reachable. When False a typo fails at the gate
    # instead of costing a step.
    accepts_any_model: bool = False

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "label": self.label,
            "accepts_base_url": self.accepts_base_url,
            "default_base_url": self.default_base_url,
            "accepts_any_model": self.accepts_any_model,
            "models": [m.to_dict() for m in self.models],
        }

    def validate_model_id(self, model_id: str) -> bool:
        if self.accepts_any_model:
            return True
        return any(m.id == model_id for m in self.models)


# Rates read off each vendor's own pricing page on 2026-10-01. They drift, and
# nothing in the codebase renders a cost yet — the task budget cap is the
# consumer, and it is not built — so re-check before any of them reaches a user.
# A 0.0 cache-write rate means "no charge published for this", not "free":
# Google bills cache storage per hour instead of per write, and MiniMax
# publishes no write rate at all.
#
# Source per provider: anthropic platform.claude.com/docs/en/about-claude/pricing
# · openai developers.openai.com/api/docs/pricing · gemini
# ai.google.dev/gemini-api/docs/pricing · deepseek
# api-docs.deepseek.com/quick_start/pricing · groq console.groq.com/docs/models
# · minimax platform.minimax.io/docs/guides/pricing-paygo
_FABLE = Pricing(10.00, 50.00, 0.25, 12.50)
_OPUS = Pricing(4.00, 20.00, 0.20, 5.00)
_SONNET = Pricing(2.00, 10.00, 0.20, 2.50)
# Haiku is the one 200K model left; the other three are 1M.
_HAIKU = Pricing(1.00, 5.00, 0.10, 1.25)
# Sonnet 4.5 is the previous generation, kept because a 200K window is still
# the honest budget for a task that should not spend 1M.
_SONNET_45 = Pricing(3.00, 15.00, 0.30, 3.75)
_ASTRA = Pricing(
    10.00, 50.00, 1.00, 12.50,
    long_context_threshold=272_000,
    input_per_mtok_long=20.00, output_per_mtok_long=75.00,
    cache_read_per_mtok_long=2.00, cache_write_per_mtok_long=25.00,
)
_SOL = Pricing(
    2.00, 10.00, 0.10, 2.50,
    long_context_threshold=272_000,
    input_per_mtok_long=4.00, output_per_mtok_long=15.00,
    cache_read_per_mtok_long=0.20, cache_write_per_mtok_long=5.00,
)
_LUNA = Pricing(
    0.10, 0.50, 0.01, 0.125,
    long_context_threshold=272_000,
    input_per_mtok_long=0.20, output_per_mtok_long=0.75,
    cache_read_per_mtok_long=0.02, cache_write_per_mtok_long=0.25,
)
# The GPT-5.6 generation, one tier below GPT-6 and kept alongside it because
# they are the same architecture at a different price point. NOTE these are
# *promotional* rates — OpenAI says gpt-5.6-sol's are available "at least
# through November 21, 2026" — so re-read them before showing a cost.
_GPT56_SOL = Pricing(
    4.00, 20.00, 0.40, 5.00,
    long_context_threshold=272_000,
    input_per_mtok_long=8.00, output_per_mtok_long=30.00,
    cache_read_per_mtok_long=0.80, cache_write_per_mtok_long=10.00,
)
_GPT56_TERRA = Pricing(
    2.00, 12.00, 0.20, 2.50,
    long_context_threshold=272_000,
    input_per_mtok_long=4.00, output_per_mtok_long=18.00,
    cache_read_per_mtok_long=0.40, cache_write_per_mtok_long=5.00,
)
_GPT56_LUNA = Pricing(
    0.20, 1.20, 0.02, 0.25,
    long_context_threshold=272_000,
    input_per_mtok_long=0.40, output_per_mtok_long=1.80,
    cache_read_per_mtok_long=0.04, cache_write_per_mtok_long=0.50,
)
_FLASH_38 = Pricing(0.75, 3.75, 0.075, 0.0)
_FLASH_35 = Pricing(1.50, 9.00, 0.15, 0.0)
_FLASH_LITE = Pricing(0.30, 2.50, 0.03, 0.0)
_FLASH_LITE_31 = Pricing(0.25, 1.50, 0.025, 0.0)
# DeepSeek publishes no cache-write rate: a miss is billed at the input rate and
# a hit at the cache-hit rate, so a write is just the input price.
_DS_FLASH = Pricing(0.15, 0.60, 0.003, 0.15)
_DS_PRO = Pricing(0.66, 1.98, 0.022, 0.66)
# Groq publishes input and output only; its cache is not billed separately.
_GROQ_120B = Pricing(0.15, 0.60, 0.0, 0.0)
_GROQ_20B = Pricing(0.075, 0.30, 0.0, 0.0)
# M3 doubles past 512K input. Its cache-write rate is unpublished, so 0.0.
_M3 = Pricing(
    0.30, 1.20, 0.06, 0.0,
    long_context_threshold=512_000,
    input_per_mtok_long=0.60, output_per_mtok_long=2.40,
    cache_read_per_mtok_long=0.12,
)
_M27 = Pricing(0.30, 1.20, 0.06, 0.375)
_M27_HS = Pricing(0.60, 2.40, 0.06, 0.375)

# Order is preference. MiniMax-M3.1-Flash-Preview is the Token Plan model
# (covered by Claude Code Token Plan subscriptions) and has no pay-as-you-go
# rate at all; MiniMax-M3 is pay-as-you-go with separate credits — using M3
# without a paid balance returns 402 insufficient_balance.
#
# ponytail: DeepSeek doubles its rates during weekday peak hours (01:00-04:00
# and 06:00-10:00 UTC) and `Pricing` has no clock in it, so a peak-hour step is
# underpriced 2x. Add a time-of-day term when the budget cap actually enforces.
PROVIDER_CATALOG: dict[str, ProviderInfo] = {
    "anthropic": ProviderInfo(
        id="anthropic",
        label="Anthropic",
        api_shape="anthropic",
        # Anthropic: "All current models support text and image input".
        models=(
            ModelInfo("claude-sonnet-5-5", 1_000_000, _SONNET, vision=True),
            ModelInfo("claude-opus-5-5", 1_000_000, _OPUS, vision=True),
            ModelInfo("claude-fable-5-1", 1_000_000, _FABLE, vision=True),
            ModelInfo("claude-haiku-4-5", 200_000, _HAIKU, vision=True),
            # 200K, not the 1M its successors get — that is the point of keeping
            # it: the window drives the AX-tree budget, so a smaller honest
            # number is what a long task should be paced against.
            ModelInfo("claude-sonnet-4-5", 200_000, _SONNET_45, vision=True),
        ),
    ),
    "openai": ProviderInfo(
        id="openai",
        label="OpenAI",
        # OpenAI: "All latest OpenAI models support text and image input".
        models=(
            ModelInfo("gpt-6.1-sol", 1_050_000, _SOL, vision=True),
            ModelInfo("gpt-6-luna", 1_050_000, _LUNA, vision=True),
            ModelInfo("gpt-6-astra", 1_050_000, _ASTRA, vision=True),
            ModelInfo("gpt-5.6-sol", 1_050_000, _GPT56_SOL, vision=True),
            ModelInfo("gpt-5.6-terra", 1_050_000, _GPT56_TERRA, vision=True),
            ModelInfo("gpt-5.6-luna", 1_050_000, _GPT56_LUNA, vision=True),
        ),
    ),
    "minimax": ProviderInfo(
        id="minimax",
        label="MiniMax",
        api_shape="anthropic",
        # Not user-editable — the endpoint is fixed, unlike the OpenAI-
        # compatible vendors below. The field still exists because it is what
        # the Anthropic factory falls back to.
        default_base_url="https://api.minimax.io/anthropic",
        # MiniMax documents the M3 pair as "Multimodal" and says nothing about
        # image input on the M2.7 pair — hence vision unset there rather than
        # a guess in either direction.
        models=(
            ModelInfo("MiniMax-M3.1-Flash-Preview", 1_000_000, vision=True),
            ModelInfo("MiniMax-M3", 1_000_000, _M3, vision=True),
            ModelInfo("MiniMax-M2.7", 204_800, _M27),
            ModelInfo("MiniMax-M2.7-highspeed", 204_800, _M27_HS),
        ),
    ),
    "gemini": ProviderInfo(
        id="gemini",
        label="Google Gemini",
        api_shape="gemini",
        # Google has no cache-write charge (storage is billed per hour) and its
        # long-context tiers could not be read off the pricing page, so
        # long_context_threshold stays None rather than invented.
        models=(
            ModelInfo("gemini-3.8-flash", 1_048_576, _FLASH_38, vision=True),
            ModelInfo("gemini-3.5-flash", 1_048_576, _FLASH_35, vision=True),
            ModelInfo("gemini-3.5-flash-lite", 1_048_576, _FLASH_LITE, vision=True),
            ModelInfo("gemini-3.1-flash-lite", 1_048_576, _FLASH_LITE_31, vision=True),
        ),
    ),
    # The generic adapter. Everything below speaks the OpenAI chat-completions
    # shape, so they are the same factory with a different endpoint — which is
    # the whole reason they are not separate classes.
    "openrouter": ProviderInfo(
        id="openrouter",
        label="OpenRouter",
        accepts_base_url=True,
        default_base_url="https://openrouter.ai/api/v1",
        accepts_any_model=True,
        models=(ModelInfo("openrouter/auto", 128_000),),
    ),
    "deepseek": ProviderInfo(
        id="deepseek",
        label="DeepSeek",
        accepts_base_url=True,
        default_base_url="https://api.deepseek.com/v1",
        models=(
            # DeepSeek's own table is the only one that says "not supported"
            # outright: vision on flash, not on pro.
            ModelInfo("deepseek-v4-pro", 1_000_000, _DS_PRO),
            ModelInfo("deepseek-flash", 1_000_000, _DS_FLASH, vision=True),
        ),
    ),
    "groq": ProviderInfo(
        id="groq",
        label="Groq",
        accepts_base_url=True,
        default_base_url="https://api.groq.com/openai/v1",
        # The Llama ids this listed before are now contact-sales with no
        # published rate, so they were both unpriceable. These are the models
        # Groq actually publishes numbers for.
        models=(
            ModelInfo("openai/gpt-oss-120b", 131_072, _GROQ_120B),
            ModelInfo("openai/gpt-oss-20b", 131_072, _GROQ_20B),
        ),
    ),
    "custom": ProviderInfo(
        id="custom",
        label="Custom (OpenAI-compatible)",
        accepts_base_url=True,
        accepts_any_model=True,
        models=(),
    ),
}


def get(provider: str) -> ProviderInfo | None:
    return PROVIDER_CATALOG.get(provider)
