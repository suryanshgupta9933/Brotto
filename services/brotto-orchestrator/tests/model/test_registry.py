from __future__ import annotations

import pytest

from brotto_orchestrator.model.config import UserCredentials
from brotto_orchestrator.model.registry import AnthropicFactory, OpenAIFactory


def test_anthropic_factory_default_models_nonempty():
    f = AnthropicFactory()
    models = f.default_models()
    assert len(models) >= 1
    for mid, ctx in models:
        assert isinstance(mid, str) and mid
        assert ctx > 0


def test_anthropic_factory_validates_known_model():
    f = AnthropicFactory()
    assert f.validate_model_id("MiniMax-M3") is True
    assert f.validate_model_id("definitely-not-a-real-model-xyz") is False


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
    for mid, ctx in models:
        assert isinstance(mid, str) and mid
        assert ctx > 0


def test_openai_factory_build_returns_openai_model():
    from pydantic_ai.models.openai import OpenAIChatModel
    f = OpenAIFactory()
    model = f.build("gpt-4o", UserCredentials(api_key="sk-test", base_url=None))
    assert isinstance(model, OpenAIChatModel)


def test_openai_factory_rejects_unknown_model():
    f = OpenAIFactory()
    assert f.validate_model_id("gpt-4o") is True
    assert f.validate_model_id("definitely-not-a-real-model-xyz") is False