from __future__ import annotations

from pathlib import Path

import pytest

from brotto_orchestrator.model.config import ModelConfig, UserCredentials
from brotto_orchestrator.model.resolver import resolve_model_config
from brotto_orchestrator.model.store import (
    BROTTO_USER_MODEL_DIR_ENV,
    save_user_config,
)


@pytest.fixture
def no_env(monkeypatch):
    # The base-URL vars matter as much as the key: a shell that exports
    # ANTHROPIC_BASE_URL pins every resolved config to it, which silently
    # rewrites what a test thinks it asserted.
    for k in ("AGENT_MODEL", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
              "AGENT_BASE_URL", "ANTHROPIC_BASE_URL", "BROTTO_FORCE_ENV_MODEL"):
        monkeypatch.delenv(k, raising=False)


@pytest.fixture
def tmp_model_dir(monkeypatch, tmp_path: Path):
    monkeypatch.setenv(BROTTO_USER_MODEL_DIR_ENV, str(tmp_path))
    return tmp_path


def test_inline_wins(tmp_model_dir: Path, no_env):
    inline_cfg = ModelConfig(provider="openai", model="gpt-4o", context_window=128_000)
    inline_creds = UserCredentials(api_key="sk-inline", base_url=None)
    cfg, creds = resolve_model_config("127.0.0.1", inline_cfg, inline_creds)
    assert cfg == inline_cfg
    assert creds == inline_creds


def test_per_user_fallback(tmp_model_dir: Path, no_env):
    saved = ModelConfig(provider="minimax", model="MiniMax-M3", context_window=1_000_000)
    save_user_config("127.0.0.1", saved)
    # A per-user config carries no key of its own — the store only
    # persists the model. It needs creds from somewhere to be usable.
    creds = UserCredentials(api_key="sk-from-session", base_url=None)
    cfg, out = resolve_model_config("127.0.0.1", None, creds)
    assert cfg == saved
    assert out == creds


def test_env_fallback(tmp_model_dir: Path, no_env, monkeypatch):
    monkeypatch.setenv("AGENT_MODEL", "anthropic:MiniMax-M3")
    monkeypatch.setenv("CONTEXT_WINDOW_TOKENS", "204800")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "sk-from-env")
    cfg, creds = resolve_model_config("127.0.0.1", None, None)
    assert cfg.provider == "anthropic"
    assert cfg.model == "MiniMax-M3"
    assert cfg.context_window == 204800
    assert creds.api_key == "sk-from-env"


def test_env_model_without_a_key_says_so(tmp_model_dir: Path, no_env, monkeypatch):
    """The recurring "Set the ANTHROPIC_API_KEY environment variable or pass
    it via AnthropicProvider(api_key=...)" error. Every registered provider
    needs a key, so a keyless env config used to resolve fine and then blow
    up inside the provider constructor — an Anthropic error naming neither
    AGENT_MODEL nor .env, whichever provider was actually configured."""
    monkeypatch.setenv("AGENT_MODEL", "minimax:MiniMax-M3")
    monkeypatch.setenv("BROTTO_FORCE_ENV_MODEL", "1")
    with pytest.raises(ValueError, match="no key to authenticate"):
        resolve_model_config("127.0.0.1", None, None)


def test_inline_overrides_per_user(tmp_model_dir: Path, no_env):
    saved = ModelConfig(provider="minimax", model="MiniMax-M3", context_window=1_000_000)
    save_user_config("127.0.0.1", saved)
    inline_cfg = ModelConfig(provider="openai", model="gpt-4o", context_window=128_000)
    creds = UserCredentials(api_key="sk-inline", base_url=None)
    cfg, _ = resolve_model_config("127.0.0.1", inline_cfg, creds)
    assert cfg == inline_cfg


def test_no_resolution_raises(tmp_model_dir: Path, no_env):
    with pytest.raises(ValueError, match="No model configuration"):
        resolve_model_config("127.0.0.1", None, None)


def test_keyless_inline_config_is_ignored(tmp_model_dir: Path, no_env, monkeypatch):
    """The recurring bug: the extension keeps model_config in
    chrome.storage.local across restarts but the key in
    chrome.storage.session, which does not. So every browser restart it
    sends a config and no key, and honoring that produced a keyless
    provider — "Set ANTHROPIC_API_KEY or pass it via
    AnthropicProvider(api_key=...)" — while shadowing a working .env.
    """
    monkeypatch.setenv("AGENT_MODEL", "minimax:MiniMax-M3.1-Flash-Preview")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "sk-from-dotenv")
    inline_cfg = ModelConfig(provider="anthropic", model="claude-sonnet-4-6", context_window=200_000)
    cfg, creds = resolve_model_config("127.0.0.1", inline_cfg, None)
    assert cfg.provider == "minimax"          # .env won, not the extension
    assert creds.api_key == "sk-from-dotenv"


def test_force_env_model_ignores_everything(tmp_model_dir: Path, no_env, monkeypatch):
    """BROTTO_FORCE_ENV_MODEL=1 — the dev escape hatch. Runs on .env even
    when the extension has a perfectly good key and model of its own."""
    monkeypatch.setenv("AGENT_MODEL", "minimax:MiniMax-M3.1-Flash-Preview")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-dotenv")
    monkeypatch.setenv("BROTTO_FORCE_ENV_MODEL", "1")
    save_user_config("127.0.0.1", ModelConfig(provider="openai", model="gpt-4o", context_window=128_000))
    inline_cfg = ModelConfig(provider="openai", model="gpt-4o", context_window=128_000)
    creds = UserCredentials(api_key="sk-inline", base_url=None)
    cfg, out = resolve_model_config("127.0.0.1", inline_cfg, creds)
    assert cfg.provider == "minimax"
    assert out.api_key == "sk-dotenv"


def test_force_env_model_without_env_model_raises(tmp_model_dir: Path, no_env, monkeypatch):
    monkeypatch.setenv("BROTTO_FORCE_ENV_MODEL", "1")
    with pytest.raises(ValueError, match="BROTTO_FORCE_ENV_MODEL is set"):
        resolve_model_config("127.0.0.1", None, None)


def test_keyless_per_user_names_the_problem(tmp_model_dir: Path, no_env):
    """"Remember my model" persists the model but never the key, so this
    is reachable after a browser restart. Say which piece is missing
    rather than failing later inside a provider constructor."""
    save_user_config("127.0.0.1", ModelConfig(provider="openai", model="gpt-4o", context_window=128_000))
    with pytest.raises(ValueError, match="has no api_key"):
        resolve_model_config("127.0.0.1", None, None)

def test_an_inline_config_without_a_key_is_ignored_for_every_provider(tmp_model_dir: Path, no_env):
    """There is no keyless provider left in the catalogue, so the rule is
    unconditional: an inline config with no key falls through to the next
    tier rather than resolving into a provider that cannot authenticate."""
    cfg = ModelConfig(provider="openrouter", model="openrouter/auto", context_window=128_000)
    save_user_config("127.0.0.1", ModelConfig(provider="openai", model="gpt-6.1-sol", context_window=1_050_000))
    with pytest.raises(ValueError):
        resolve_model_config("127.0.0.1", cfg, UserCredentials(api_key="", base_url=None))


def test_base_url_travels_with_the_inline_config(tmp_model_dir: Path, no_env):
    cfg = ModelConfig(provider="openrouter", model="openrouter/auto", context_window=128_000,
                      base_url="https://openrouter.ai/api/v1")
    out_cfg, out_creds = resolve_model_config(
        "127.0.0.1", cfg, UserCredentials(api_key="sk-x", base_url=None))
    assert out_cfg.base_url == "https://openrouter.ai/api/v1"
    # The creds are what the factory reads; a base_url that stops crossing
    # over is the two-line gap that made every OpenAI-compatible vendor
    # unreachable.
    assert out_creds.base_url == "https://openrouter.ai/api/v1"


def test_env_base_url_is_read_and_preferred_over_the_legacy_name(tmp_model_dir: Path, no_env, monkeypatch):
    monkeypatch.setenv("AGENT_MODEL", "openai:gpt-4o")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-env")
    monkeypatch.setenv("AGENT_BASE_URL", "https://new.example/v1")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://legacy.example/v1")
    cfg, creds = resolve_model_config("127.0.0.1", None, None)
    assert cfg.base_url == "https://new.example/v1"
    assert creds.base_url == "https://new.example/v1"


def test_a_shell_exported_base_url_is_not_silently_ignored(tmp_model_dir: Path, no_env, monkeypatch):
    """Documented, not endorsed: ANTHROPIC_BASE_URL in the shell overrides
    the Anthropic default, so a developer's environment quietly redirects
    every anthropic request. Same class as CLAUDE.md's "the key must be in
    .env, not the shell"."""
    monkeypatch.setenv("AGENT_MODEL", "anthropic:claude-3-5-sonnet-latest")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-env")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://api.minimax.io/anthropic")
    cfg, creds = resolve_model_config("127.0.0.1", None, None)
    assert cfg.base_url == "https://api.minimax.io/anthropic"
    assert creds.base_url == "https://api.minimax.io/anthropic"


def test_a_per_user_config_keeps_its_base_url_across_reloads(tmp_model_dir: Path, no_env):
    cfg = ModelConfig(provider="custom", model="qwen2.5-coder:7b", context_window=128_000,
                      base_url="http://gpu-box.lan:8000/v1")
    save_user_config("127.0.0.1", cfg)
    out_cfg, out_creds = resolve_model_config("127.0.0.1", None, UserCredentials(api_key="sk-persisted", base_url=None))
    assert out_cfg.base_url == "http://gpu-box.lan:8000/v1"
    assert out_creds.base_url == "http://gpu-box.lan:8000/v1"
