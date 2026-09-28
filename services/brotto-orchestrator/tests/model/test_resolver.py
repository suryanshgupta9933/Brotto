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
    for k in ("AGENT_MODEL", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"):
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
    cfg, creds = resolve_model_config("127.0.0.1", None, None)
    assert cfg == saved
    # No inline creds, no env → creds are empty (api_key=None)
    assert creds.api_key is None


def test_env_fallback(tmp_model_dir: Path, no_env, monkeypatch):
    monkeypatch.setenv("AGENT_MODEL", "anthropic:MiniMax-M3")
    monkeypatch.setenv("CONTEXT_WINDOW_TOKENS", "204800")
    cfg, creds = resolve_model_config("127.0.0.1", None, None)
    assert cfg.provider == "anthropic"
    assert cfg.model == "MiniMax-M3"
    assert cfg.context_window == 204800


def test_inline_overrides_per_user(tmp_model_dir: Path, no_env):
    saved = ModelConfig(provider="minimax", model="MiniMax-M3", context_window=1_000_000)
    save_user_config("127.0.0.1", saved)
    inline_cfg = ModelConfig(provider="openai", model="gpt-4o", context_window=128_000)
    cfg, _ = resolve_model_config("127.0.0.1", inline_cfg, None)
    assert cfg == inline_cfg


def test_no_resolution_raises(tmp_model_dir: Path, no_env):
    with pytest.raises(ValueError, match="No model configuration"):
        resolve_model_config("127.0.0.1", None, None)