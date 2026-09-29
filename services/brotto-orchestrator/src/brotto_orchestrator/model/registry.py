from __future__ import annotations

from typing import Protocol, runtime_checkable

from typing import Any

from pydantic_ai.models import Model

from brotto_orchestrator.model.config import UserCredentials


@runtime_checkable
class ProviderFactory(Protocol):
    def build(self, model_id: str, creds: UserCredentials) -> Model: ...
    def default_models(self) -> list[tuple[str, int]]: ...
    def validate_model_id(self, model_id: str) -> bool: ...
    def model_settings(self, model_id: str) -> dict[str, Any]: ...


# pydantic-ai falls back to max_tokens=4096 when a request does not set it.
# 4096 is below what a reasoning turn can produce, and the failure is silent
# from the caller's side: the API returns stop_reason="max_tokens" with no
# text content, which pydantic-ai reports as "Model token limit exceeded
# before any response was generated" — naming a prompt-length problem that
# does not exist. max_tokens is a ceiling, not a reservation, so a generous
# cap costs nothing on the steps that do not use it.
_OUTPUT_TOKEN_CAP = 32_000

# MiniMax-M3.1-Flash-Preview refuses any attempt to turn thinking off:
# sending thinking.type="disabled" returns HTTP 400 ("requires adaptive
# thinking"). Measured, not documented. Every other MiniMax model accepts
# it, and M3 does not think by default anyway — the param is here so a
# provider-side default change cannot silently turn reasoning back on for
# a UI that pays 0.8s per extra second of it.
_THINKING_REQUIRED = frozenset({"MiniMax-M3.1-Flash-Preview"})


def _anthropic_settings(model_id: str) -> dict[str, Any]:
    settings: dict[str, Any] = {"max_tokens": _OUTPUT_TOKEN_CAP}
    if model_id not in _THINKING_REQUIRED:
        settings["anthropic_thinking"] = {"type": "disabled"}
    return settings


def _openai_settings(model_id: str) -> dict[str, Any]:
    return {"max_tokens": _OUTPUT_TOKEN_CAP}


# Catalog order = preference. MiniMax-M3.1-Flash-Preview is the Token Plan
# model (covered by Claude Code Token Plan subscriptions); MiniMax-M3 is
# pay-as-you-go with separate credits — using M3 without a paid balance
# returns 402 insufficient_balance.
_DEFAULT_ANTHROPIC_MODELS: list[tuple[str, int]] = [
    ("MiniMax-M3.1-Flash-Preview", 1_000_000),  # Token Plan (default)
    ("MiniMax-M3", 1_000_000),                   # pay-as-you-go
    ("MiniMax-M2.7", 204_800),                  # pay-as-you-go, legacy
    ("MiniMax-M2.7-highspeed", 204_800),        # pay-as-you-go, legacy
    ("claude-3-5-sonnet-latest", 200_000),       # direct Anthropic API
]


_DEFAULT_OPENAI_MODELS: list[tuple[str, int]] = [
    ("gpt-4o", 128_000),
    ("gpt-4o-mini", 128_000),
    ("o1", 200_000),
]


class AnthropicFactory:
    def __init__(self, default_base_url: str | None = None) -> None:
        self.default_base_url = default_base_url

    def default_models(self) -> list[tuple[str, int]]:
        return list(_DEFAULT_ANTHROPIC_MODELS)

    def validate_model_id(self, model_id: str) -> bool:
        return any(mid == model_id for mid, _ in _DEFAULT_ANTHROPIC_MODELS)

    def model_settings(self, model_id: str) -> dict[str, Any]:
        return _anthropic_settings(model_id)

    def build(self, model_id: str, creds: UserCredentials) -> Model:
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider

        base_url = creds.base_url or self.default_base_url
        kwargs: dict[str, object] = {"api_key": creds.api_key}
        if base_url is not None:
            kwargs["base_url"] = base_url
        provider = AnthropicProvider(**kwargs)  # type: ignore[arg-type]
        return AnthropicModel(model_id, provider=provider)


class OpenAIFactory:
    def __init__(self, default_base_url: str | None = None) -> None:
        self.default_base_url = default_base_url

    def default_models(self) -> list[tuple[str, int]]:
        return list(_DEFAULT_OPENAI_MODELS)

    def validate_model_id(self, model_id: str) -> bool:
        return any(mid == model_id for mid, _ in _DEFAULT_OPENAI_MODELS)

    def model_settings(self, model_id: str) -> dict[str, Any]:
        return _openai_settings(model_id)

    def build(self, model_id: str, creds: UserCredentials) -> Model:
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.openai import OpenAIProvider

        base_url = creds.base_url or self.default_base_url
        kwargs: dict[str, object] = {"api_key": creds.api_key}
        if base_url is not None:
            kwargs["base_url"] = base_url
        provider = OpenAIProvider(**kwargs)  # type: ignore[arg-type]
        return OpenAIChatModel(model_id, provider=provider)


PROVIDER_REGISTRY: dict[str, ProviderFactory] = {
    "anthropic": AnthropicFactory(),
    "openai": OpenAIFactory(),
    "minimax": AnthropicFactory(default_base_url="https://api.minimax.io/anthropic"),
}