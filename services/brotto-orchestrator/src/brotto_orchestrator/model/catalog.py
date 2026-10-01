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


@dataclass(frozen=True)
class ModelInfo:
    id: str
    context_window: int
    pricing: Pricing | None = None
    label: str = ""

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "label": self.label or self.id,
            "context_window": self.context_window,
            "pricing": None if self.pricing is None else {
                "input_per_mtok": self.pricing.input_per_mtok,
                "output_per_mtok": self.pricing.output_per_mtok,
                "cache_read_per_mtok": self.pricing.cache_read_per_mtok,
                "cache_write_per_mtok": self.pricing.cache_write_per_mtok,
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
    # A local runtime may have no key at all. Only Ollama is this today.
    keyless_ok: bool = False

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "label": self.label,
            "accepts_base_url": self.accepts_base_url,
            "default_base_url": self.default_base_url,
            "accepts_any_model": self.accepts_any_model,
            "keyless_ok": self.keyless_ok,
            "models": [m.to_dict() for m in self.models],
        }

    def validate_model_id(self, model_id: str) -> bool:
        if self.accepts_any_model:
            return True
        return any(m.id == model_id for m in self.models)


# Prices drift. These were filled in on 2026-10-01 and MUST be re-checked
# against each provider's pricing page before any of them is shown to a user.
# Nothing in the codebase renders a cost yet; the task budget cap is the
# consumer, and it is not built. MiniMax, Groq, DeepSeek and OpenRouter are
# deliberately None rather than guessed — OpenRouter's rate is per-model and
# the other three change too often to be worth transcribing from memory.
_SONNET = Pricing(3.00, 15.00, 0.30, 3.75)
_HAIKU = Pricing(0.80, 4.00, 0.08, 1.00)
_GPT4O = Pricing(2.50, 10.00, 1.25, 2.50)
_GPT4O_MINI = Pricing(0.15, 0.60, 0.075, 0.15)
_O1 = Pricing(15.00, 60.00, 7.50, 15.00)
_GEMINI_2_FLASH = Pricing(0.10, 0.40, 0.025, 0.10)
_GEMINI_15_PRO = Pricing(1.25, 5.00, 0.3125, 1.25)
_GEMINI_15_FLASH = Pricing(0.075, 0.30, 0.01875, 0.075)
# Local inference is free, and unlike a missing price this one is certain.
_LOCAL = Pricing(0.0, 0.0, 0.0, 0.0)

# Order is preference. MiniMax-M3.1-Flash-Preview is the Token Plan model
# (covered by Claude Code Token Plan subscriptions); MiniMax-M3 is pay-as-you-go
# with separate credits — using M3 without a paid balance returns 402
# insufficient_balance.
PROVIDER_CATALOG: dict[str, ProviderInfo] = {
    "anthropic": ProviderInfo(
        id="anthropic",
        label="Anthropic",
        api_shape="anthropic",
        models=(
            ModelInfo("claude-3-5-sonnet-latest", 200_000, _SONNET),
            ModelInfo("claude-3-5-haiku-latest", 200_000, _HAIKU),
        ),
    ),
    "openai": ProviderInfo(
        id="openai",
        label="OpenAI",
        models=(
            ModelInfo("gpt-4o", 128_000, _GPT4O),
            ModelInfo("gpt-4o-mini", 128_000, _GPT4O_MINI),
            ModelInfo("o1", 200_000, _O1),
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
        models=(
            ModelInfo("MiniMax-M3.1-Flash-Preview", 1_000_000),
            ModelInfo("MiniMax-M3", 1_000_000),
            ModelInfo("MiniMax-M2.7", 204_800),
            ModelInfo("MiniMax-M2.7-highspeed", 204_800),
        ),
    ),
    "gemini": ProviderInfo(
        id="gemini",
        label="Google Gemini",
        api_shape="gemini",
        models=(
            ModelInfo("gemini-2.0-flash", 1_000_000, _GEMINI_2_FLASH),
            ModelInfo("gemini-1.5-pro", 2_000_000, _GEMINI_15_PRO),
            ModelInfo("gemini-1.5-flash", 1_000_000, _GEMINI_15_FLASH),
        ),
    ),
    # The generic adapter. Everything below speaks the OpenAI chat-completions
    # shape, so they are the same factory with a different default endpoint —
    # which is the whole reason they are not separate classes.
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
            ModelInfo("deepseek-chat", 128_000),
            ModelInfo("deepseek-reasoner", 128_000),
        ),
    ),
    "groq": ProviderInfo(
        id="groq",
        label="Groq",
        accepts_base_url=True,
        default_base_url="https://api.groq.com/openai/v1",
        models=(
            ModelInfo("llama-3.3-70b-versatile", 128_000),
            ModelInfo("llama-3.1-8b-instant", 128_000),
        ),
    ),
    "ollama": ProviderInfo(
        id="ollama",
        label="Ollama (local)",
        accepts_base_url=True,
        default_base_url="http://localhost:11434/v1",
        accepts_any_model=True,
        keyless_ok=True,
        models=(ModelInfo("llama3.1", 128_000, _LOCAL),),
    ),
    "custom": ProviderInfo(
        id="custom",
        label="Custom (OpenAI-compatible)",
        accepts_base_url=True,
        accepts_any_model=True,
        models=(),
    ),
}


def is_keyless_ok(provider: str) -> bool:
    info = PROVIDER_CATALOG.get(provider)
    return info is not None and info.keyless_ok


def get(provider: str) -> ProviderInfo | None:
    return PROVIDER_CATALOG.get(provider)
