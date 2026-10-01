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
    "MiniMax-M3.1-Flash-Preview", "MiniMax-M3", "claude-sonnet-5-5",
    "claude-opus-5-5", "gpt-6.1-sol", "gemini-3.8-flash", "llama3.1",
    "openrouter/auto", "deepseek-v4-pro", "openai/gpt-oss-120b",
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


def test_minimax_m3_is_told_not_to_think():
    """It accepts `thinking.type="disabled"` and does not think by default
    anyway — the param is here so a provider-side default change cannot
    silently turn reasoning back on for a UI that pays ~0.8s per extra
    second of it."""
    assert PROVIDER_REGISTRY["minimax"].model_settings("MiniMax-M3")[
        "anthropic_thinking"
    ] == {"type": "disabled"}


def test_no_claude_model_is_ever_told_to_stop_thinking():
    """Anthropic moved to adaptive thinking: Fable 5.1, Opus 5.5 and Sonnet
    5.5 are always-on and answer `disabled` with HTTP 400. Every Claude id
    in the catalog is one of them, so this is the shape that would 400 on
    every single call."""
    for model_id in ("claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1",
                     "claude-haiku-4-5"):
        settings = PROVIDER_REGISTRY["anthropic"].model_settings(model_id)
        assert "anthropic_thinking" not in settings, model_id


def test_an_anthropic_id_sent_to_the_minimax_factory_gets_no_thinking_param():
    """The two providers share a factory and differ only in `provider_id`, so
    an allowlist keyed on the model id alone would send `disabled` to Claude
    and 400 on every call."""
    settings = PROVIDER_REGISTRY["minimax"].model_settings("claude-sonnet-5-5")
    assert "anthropic_thinking" not in settings


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


def test_effort_is_never_sent_explicitly():
    """Anthropic invalidates prompt-cache breakpoints when the effort value
    changes between requests, and setting effort to the model's default is
    equivalent to omitting it. Brotto's stable prefix is the cheap part of a
    run, so the only cache-safe choice is to omit it."""
    for pid, factory in PROVIDER_REGISTRY.items():
        for model_id in _ALL:
            assert "effort" not in str(factory.model_settings(model_id)), (pid, model_id)


def test_an_unknown_model_id_does_not_raise():
    """base_url made every provider reachable, including with an id the
    catalog has never heard of — `qwen2.5-coder:7b` on Ollama, any of
    OpenRouter's catalogue. A gate that rejects an unknown id breaks that."""
    for pid, factory in PROVIDER_REGISTRY.items():
        settings = factory.model_settings("some-model-nobody-has-heard-of")
        assert settings["max_tokens"] == _OUTPUT_TOKEN_CAP, pid
