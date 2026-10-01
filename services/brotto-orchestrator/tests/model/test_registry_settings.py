from __future__ import annotations

from brotto_orchestrator.model.catalog import PROVIDER_CATALOG
from brotto_orchestrator.model.registry import (
    _OUTPUT_TOKEN_CAP,
    PROVIDER_REGISTRY,
)

# Deliberately cross-provider: `model_settings` is called with ids belonging to
# other vendors, so the base default must not look at the id or raise on one
# it has never heard of.
_ALL = [
    "MiniMax-M3.1-Flash-Preview", "MiniMax-M3", "claude-3-5-sonnet-latest",
    "gpt-4o", "gemini-2.0-flash", "llama3.1", "openrouter/auto",
]


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


def test_no_non_anthropic_vendor_ever_gets_the_thinking_param():
    """The param is an Anthropic request field. OpenAI and Gemini reject an
    unknown body key, and every OpenAI-compatible gateway passes the body
    through — so one factory that emitted it for the wrong shape would fail
    at the API, not at review."""
    for pid, factory in PROVIDER_REGISTRY.items():
        if PROVIDER_CATALOG[pid].api_shape == "anthropic":
            continue
        for model_id in _ALL:
            assert "anthropic_thinking" not in factory.model_settings(model_id), (pid, model_id)


def test_an_unknown_model_id_does_not_raise():
    """base_url made every provider reachable, including with an id the
    catalog has never heard of — `qwen2.5-coder:7b` on Ollama, any of
    OpenRouter's catalogue. A gate that rejects an unknown id breaks that."""
    for pid, factory in PROVIDER_REGISTRY.items():
        settings = factory.model_settings("some-model-nobody-has-heard-of")
        assert settings["max_tokens"] == _OUTPUT_TOKEN_CAP, pid
