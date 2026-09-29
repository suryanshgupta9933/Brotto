from __future__ import annotations

from brotto_orchestrator.model.registry import (
    _OUTPUT_TOKEN_CAP,
    PROVIDER_REGISTRY,
)

_ALL = ["MiniMax-M3.1-Flash-Preview", "MiniMax-M3", "claude-3-5-sonnet-latest"]


def test_every_provider_sets_a_token_cap():
    """pydantic-ai falls back to max_tokens=4096, which is below what a
    reasoning turn produces. The resulting failure blames the prompt
    ("simplify the prompt to result in a shorter response") when the
    prompt is not the problem."""
    for provider, factory in PROVIDER_REGISTRY.items():
        for model_id in _ALL:
            settings = factory.model_settings(model_id)
            assert settings["max_tokens"] == _OUTPUT_TOKEN_CAP, (provider, model_id)


def test_thinking_is_disabled_where_the_provider_allows_it():
    assert PROVIDER_REGISTRY["minimax"].model_settings("MiniMax-M3")[
        "anthropic_thinking"
    ] == {"type": "disabled"}


def test_thinking_required_model_is_not_sent_a_disabled_param():
    """MiniMax-M3.1-Flash-Preview answers thinking.type="disabled" with
    HTTP 400 — it requires adaptive thinking. Sending the param there
    turns every call into an error rather than a slow one."""
    settings = PROVIDER_REGISTRY["minimax"].model_settings("MiniMax-M3.1-Flash-Preview")
    assert "anthropic_thinking" not in settings


def test_openai_never_gets_an_anthropic_thinking_param():
    for model_id in _ALL:
        assert "anthropic_thinking" not in PROVIDER_REGISTRY["openai"].model_settings(model_id)
