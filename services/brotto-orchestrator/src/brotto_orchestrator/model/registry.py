from __future__ import annotations

from typing import Protocol

from pydantic_ai.models import Model

from brotto_orchestrator.model.config import UserCredentials


class ProviderFactory(Protocol):
    def build(self, model_id: str, creds: UserCredentials) -> Model: ...
    def default_models(self) -> list[tuple[str, int]]: ...
    def validate_model_id(self, model_id: str) -> bool: ...


_DEFAULT_ANTHROPIC_MODELS: list[tuple[str, int]] = [
    ("MiniMax-M3", 1_000_000),
    ("MiniMax-M3.1-Flash-Preview", 1_000_000),
    ("MiniMax-M2.7", 204_800),
    ("MiniMax-M2.7-highspeed", 204_800),
    ("claude-3-5-sonnet-latest", 200_000),
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

    def build(self, model_id: str, creds: UserCredentials) -> Model:
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.openai import OpenAIProvider

        base_url = creds.base_url or self.default_base_url
        kwargs: dict[str, object] = {"api_key": creds.api_key}
        if base_url is not None:
            kwargs["base_url"] = base_url
        provider = OpenAIProvider(**kwargs)  # type: ignore[arg-type]
        return OpenAIChatModel(model_id, provider=provider)