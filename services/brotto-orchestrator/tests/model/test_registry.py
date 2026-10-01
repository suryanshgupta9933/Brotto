from __future__ import annotations

import pytest

from brotto_orchestrator.model.catalog import PROVIDER_CATALOG
from brotto_orchestrator.model.config import UserCredentials
from brotto_orchestrator.model.registry import (
    AnthropicFactory,
    GeminiFactory,
    OpenAICompatibleFactory,
    OpenAIFactory,
    PROVIDER_REGISTRY,
)


def test_anthropic_factory_default_models_nonempty():
    f = AnthropicFactory()
    models = f.default_models()
    assert len(models) >= 1
    for info in models:
        assert isinstance(info.id, str) and info.id
        assert info.context_window > 0


def test_anthropic_factory_validates_known_model():
    f = AnthropicFactory()
    assert f.validate_model_id("claude-3-5-sonnet-latest") is True
    assert f.validate_model_id("definitely-not-a-real-model-xyz") is False


def test_a_minimax_model_is_not_accepted_under_the_anthropic_provider():
    """MiniMax models used to be listed under `anthropic`, which sent them to
    api.anthropic.com and failed there. The catalog splits them, and a user who
    genuinely wants the Anthropic-shaped MiniMax endpoint picks `minimax`."""
    assert AnthropicFactory().validate_model_id("MiniMax-M3") is False
    assert PROVIDER_REGISTRY["minimax"].validate_model_id("MiniMax-M3") is True


def test_anthropic_factory_build_returns_anthropic_model():
    from pydantic_ai.models.anthropic import AnthropicModel
    f = AnthropicFactory()
    model = f.build("MiniMax-M3", UserCredentials(api_key="sk-test", base_url=None))
    assert isinstance(model, AnthropicModel)


def test_anthropic_factory_uses_creds_base_url():
    from pydantic_ai.models.anthropic import AnthropicModel
    f = AnthropicFactory(default_base_url="https://default.example")
    model = f.build("MiniMax-M3", UserCredentials(api_key="sk-test", base_url="https://override.example"))
    assert isinstance(model, AnthropicModel)
    # pydantic-ai stores the provider on the model
    assert str(model._provider.base_url).rstrip("/") == "https://override.example"


def test_anthropic_factory_falls_back_to_default_base_url():
    from pydantic_ai.models.anthropic import AnthropicModel
    f = AnthropicFactory(default_base_url="https://default.example")
    model = f.build("MiniMax-M3", UserCredentials(api_key="sk-test", base_url=None))
    assert isinstance(model, AnthropicModel)
    assert str(model._provider.base_url).rstrip("/") == "https://default.example"


def test_openai_factory_default_models_nonempty():
    f = OpenAIFactory()
    models = f.default_models()
    assert len(models) >= 1
    for info in models:
        assert isinstance(info.id, str) and info.id
        assert info.context_window > 0


def test_openai_factory_build_returns_openai_model():
    from pydantic_ai.models.openai import OpenAIChatModel
    f = OpenAIFactory()
    model = f.build("gpt-4o", UserCredentials(api_key="sk-test", base_url=None))
    assert isinstance(model, OpenAIChatModel)


def test_openai_factory_rejects_unknown_model():
    f = OpenAIFactory()
    assert f.validate_model_id("gpt-4o") is True
    assert f.validate_model_id("definitely-not-a-real-model-xyz") is False


def test_provider_registry_covers_every_catalog_entry():
    """Dispatch is generated from the catalog, so these two cannot disagree."""
    assert set(PROVIDER_REGISTRY) == set(PROVIDER_CATALOG)


def test_the_registry_builds_on_the_request_shape_not_the_provider_id():
    """The trap: minimax speaks the Anthropic shape from its own id, and
    dispatching on id sent it OpenAI requests at an endpoint that only accepts
    Anthropic ones."""
    assert isinstance(PROVIDER_REGISTRY["minimax"], AnthropicFactory)
    assert isinstance(PROVIDER_REGISTRY["anthropic"], AnthropicFactory)
    assert isinstance(PROVIDER_REGISTRY["gemini"], GeminiFactory)
    for pid in ("openai", "openrouter", "deepseek", "groq", "ollama", "custom"):
        assert isinstance(PROVIDER_REGISTRY[pid], OpenAICompatibleFactory), pid


def test_gemini_factory_builds_a_google_model():
    from pydantic_ai.models.google import GoogleModel
    f = GeminiFactory()
    model = f.build("gemini-2.0-flash", UserCredentials(api_key="k", base_url=None))
    assert isinstance(model, GoogleModel)
    assert f.validate_model_id("gemini-2.0-flash") is True
    assert f.validate_model_id("gpt-4o") is False


def test_an_openai_compatible_vendor_is_one_class_with_a_different_endpoint():
    """The point of the adapter: Ollama and OpenRouter are the same factory
    pointed at a different URL, not a wrapper per vendor."""
    ollama = PROVIDER_REGISTRY["ollama"]
    openai = PROVIDER_REGISTRY["openai"]
    assert type(ollama) is type(openai)
    assert ollama.default_base_url != openai.default_base_url
    assert ollama.default_models() != openai.default_models()


def test_a_keyless_local_runtime_still_gets_a_placeholder_key():
    """OpenAIProvider demands a key even for Ollama, which ignores it."""
    from pydantic_ai.models.openai import OpenAIChatModel
    model = PROVIDER_REGISTRY["ollama"].build(
        "llama3.1", UserCredentials(api_key="", base_url=None)
    )
    assert isinstance(model, OpenAIChatModel)


def test_minimax_uses_anthropic_factory_with_minimax_base_url():
    f = PROVIDER_REGISTRY["minimax"]
    assert isinstance(f, AnthropicFactory)
    assert f.default_base_url == "https://api.minimax.io/anthropic"


def test_provider_registry_returns_factory_for_known_provider():
    from brotto_orchestrator.model.registry import ProviderFactory
    f = PROVIDER_REGISTRY["anthropic"]
    assert isinstance(f, ProviderFactory)