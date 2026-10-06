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
    assert f.validate_model_id("claude-sonnet-5-5") is True
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
    model = f.build("gpt-6.1-sol", UserCredentials(api_key="sk-test", base_url=None))
    assert isinstance(model, OpenAIChatModel)


def test_openai_factory_rejects_unknown_model():
    f = OpenAIFactory()
    assert f.validate_model_id("gpt-6.1-sol") is True
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
    for pid in ("openai", "openrouter", "deepseek", "groq", "custom"):
        assert isinstance(PROVIDER_REGISTRY[pid], OpenAICompatibleFactory), pid


def test_gemini_factory_builds_a_google_model():
    from pydantic_ai.models.google import GoogleModel
    f = GeminiFactory()
    model = f.build("gemini-3.8-flash", UserCredentials(api_key="k", base_url=None))
    assert isinstance(model, GoogleModel)
    assert f.validate_model_id("gemini-3.8-flash") is True
    assert f.validate_model_id("gpt-6.1-sol") is False


def test_an_openai_compatible_vendor_is_one_class_with_a_different_endpoint():
    """The point of the adapter: OpenRouter and OpenAI are the same factory
    pointed at a different URL, not a wrapper per vendor."""
    openrouter = PROVIDER_REGISTRY["openrouter"]
    openai = PROVIDER_REGISTRY["openai"]
    assert type(openrouter) is type(openai)
    assert openrouter.default_base_url != openai.default_base_url
    assert openrouter.default_models() != openai.default_models()


def test_minimax_uses_anthropic_factory_with_minimax_base_url():
    f = PROVIDER_REGISTRY["minimax"]
    assert isinstance(f, AnthropicFactory)
    assert f.default_base_url == "https://api.minimax.io/anthropic"


def test_provider_registry_returns_factory_for_known_provider():
    from brotto_orchestrator.model.registry import ProviderFactory
    f = PROVIDER_REGISTRY["anthropic"]
    assert isinstance(f, ProviderFactory)

def test_custom_without_a_base_url_refuses_rather_than_falling_back_to_openai():
    """`custom` is the only provider with no default endpoint, and
    OpenAIProvider falls back to api.openai.com when given none. A user who
    picked Custom to reach a LAN vLLM box, left the field blank and pasted
    their key would have that key POSTed to OpenAI on the first step."""
    factory = PROVIDER_REGISTRY["custom"]
    with pytest.raises(ValueError, match="needs a base_url"):
        factory.build("some-model", UserCredentials(api_key="sk-x", base_url=None))


def test_custom_with_a_base_url_builds_against_it():
    model = PROVIDER_REGISTRY["custom"].build(
        "some-model",
        UserCredentials(api_key="sk-x", base_url="http://192.168.1.5:8000/v1"),
    )
    assert model.base_url.startswith("http://192.168.1.5:8000")


def test_openai_still_defaults_to_its_own_endpoint():
    """The guard is keyed on provider_id, so it must not touch openai."""
    model = PROVIDER_REGISTRY["openai"].build(
        "gpt-5.6-sol", UserCredentials(api_key="sk-x", base_url=None)
    )
    assert model.base_url.startswith("https://api.openai.com/")
