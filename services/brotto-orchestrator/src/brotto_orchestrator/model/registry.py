from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from pydantic_ai.models import Model

from brotto_orchestrator.model.catalog import PROVIDER_CATALOG, ModelInfo
from brotto_orchestrator.model.config import UserCredentials


@runtime_checkable
class ProviderFactory(Protocol):
    def build(self, model_id: str, creds: UserCredentials) -> Model: ...
    def default_models(self) -> list[ModelInfo]: ...
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


class BaseFactory:
    """Shared behaviour. Subclasses override `build`; only Anthropic needs to
    override `model_settings`.

    The default deliberately does not look at `model_id`. It is called with ids
    belonging to other providers (test_registry_settings sweeps every provider
    against the MiniMax ids), so anything that inspects the id or raises on an
    unrecognised one breaks that sweep.
    """

    default_base_url: str | None = None
    # Which catalog entry this instance answers for. Set by _build_registry, so
    # one class serves several vendors; the subclasses read their own entry
    # rather than a hardcoded one, which is what made the minimax factory
    # validate model ids against Anthropic's list.
    provider_id = "openai"

    def __init__(self, default_base_url: str | None = None) -> None:
        self.default_base_url = default_base_url

    def default_models(self) -> list[ModelInfo]:
        raise NotImplementedError

    def validate_model_id(self, model_id: str) -> bool:
        raise NotImplementedError

    def model_settings(self, model_id: str) -> dict[str, Any]:
        return {"max_tokens": _OUTPUT_TOKEN_CAP}


class AnthropicFactory(BaseFactory):
    provider_id = "anthropic"

    def default_models(self) -> list[ModelInfo]:
        return list(PROVIDER_CATALOG[self.provider_id].models)

    def validate_model_id(self, model_id: str) -> bool:
        return PROVIDER_CATALOG[self.provider_id].validate_model_id(model_id)

    def model_settings(self, model_id: str) -> dict[str, Any]:
        settings = super().model_settings(model_id)
        if model_id not in _THINKING_REQUIRED:
            settings["anthropic_thinking"] = {"type": "disabled"}
        return settings

    def build(self, model_id: str, creds: UserCredentials) -> Model:
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider

        kwargs: dict[str, object] = {"api_key": creds.api_key}
        base_url = creds.base_url or self.default_base_url
        if base_url is not None:
            kwargs["base_url"] = base_url
        provider = AnthropicProvider(**kwargs)  # type: ignore[arg-type]
        return AnthropicModel(model_id, provider=provider)


class OpenAICompatibleFactory(BaseFactory):
    """OpenAI, and everything that converged on the OpenAI chat-completions
    shape: OpenRouter, Groq, DeepSeek, Ollama, vLLM. One class and a
    different default endpoint, rather than a wrapper per vendor.

    Deliberately OpenAIChatModel and not OpenAIResponsesModel: the Responses
    API is OpenAI's own, and the local runtimes this exists to reach
    implement chat completions only.
    """

    provider_id = "openai"

    def default_models(self) -> list[ModelInfo]:
        return list(PROVIDER_CATALOG[self.provider_id].models)

    def validate_model_id(self, model_id: str) -> bool:
        return PROVIDER_CATALOG[self.provider_id].validate_model_id(model_id)

    def build(self, model_id: str, creds: UserCredentials) -> Model:
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.openai import OpenAIProvider

        base_url = creds.base_url or self.default_base_url
        # Ollama ignores the key but OpenAIProvider still wants one; the
        # catalog flags the provider as keyless_ok and the resolver is what
        # lets a keyless inline config through, so this is the only place the
        # placeholder appears.
        kwargs: dict[str, object] = {"api_key": creds.api_key or "not-needed"}
        if base_url is not None:
            kwargs["base_url"] = base_url
        provider = OpenAIProvider(**kwargs)  # type: ignore[arg-type]
        return OpenAIChatModel(model_id, provider=provider)


class GeminiFactory(BaseFactory):
    provider_id = "gemini"

    def default_models(self) -> list[ModelInfo]:
        return list(PROVIDER_CATALOG[self.provider_id].models)

    def validate_model_id(self, model_id: str) -> bool:
        return PROVIDER_CATALOG[self.provider_id].validate_model_id(model_id)

    def build(self, model_id: str, creds: UserCredentials) -> Model:
        from pydantic_ai.models.google import GoogleModel
        from pydantic_ai.providers.google import GoogleProvider

        kwargs: dict[str, object] = {"api_key": creds.api_key}
        base_url = creds.base_url or self.default_base_url
        if base_url is not None:
            kwargs["base_url"] = base_url
        provider = GoogleProvider(**kwargs)  # type: ignore[arg-type]
        return GoogleModel(model_id, provider=provider)


_FACTORY_BY_SHAPE: dict[str, type[BaseFactory]] = {
    "anthropic": AnthropicFactory,
    "gemini": GeminiFactory,
    "openai": OpenAICompatibleFactory,
}


def _build_registry() -> dict[str, ProviderFactory]:
    """One factory instance per catalog entry, so PROVIDER_REGISTRY and the
    catalog cannot disagree about which providers exist. Dispatch is on the
    vendor's request shape, never on its id."""
    registry: dict[str, ProviderFactory] = {}
    for provider_id, info in PROVIDER_CATALOG.items():
        factory = _FACTORY_BY_SHAPE[info.api_shape](info.default_base_url)
        factory.provider_id = provider_id
        registry[provider_id] = factory
    return registry


PROVIDER_REGISTRY: dict[str, ProviderFactory] = _build_registry()

# Kept so the existing import in tests and any external caller still resolves.
# "openai" is the OpenAI-compatible factory pointed at the real OpenAI.
OpenAIFactory = OpenAICompatibleFactory
