from __future__ import annotations

from pathlib import Path

import pytest

from brotto_orchestrator.model.config import ModelConfig, UserCredentials
from brotto_orchestrator.model.registry import PROVIDER_REGISTRY
from brotto_orchestrator.model.store import (
    BROTTO_USER_MODEL_DIR_ENV,
    save_user_config,
)


@pytest.fixture
def tmp_model_dir(monkeypatch, tmp_path: Path):
    monkeypatch.setenv(BROTTO_USER_MODEL_DIR_ENV, str(tmp_path))
    return tmp_path


def test_registry_builds_minimax_model_with_correct_base_url():
    creds = UserCredentials(api_key="sk-test", base_url=None)
    cfg = ModelConfig(provider="minimax", model="MiniMax-M3", context_window=1_000_000)
    model = PROVIDER_REGISTRY[cfg.provider].build(cfg.model, creds)
    assert str(model._provider.base_url).rstrip("/") == "https://api.minimax.io/anthropic"


def test_phase1_auth_token_propagation_still_works(tmp_model_dir: Path, monkeypatch):
    """Phase 1 regression: ANTHROPIC_AUTH_TOKEN env var must still
    resolve to a usable API key via the env-var fallback path."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "sk-cp-test-token")
    monkeypatch.setenv("AGENT_MODEL", "minimax:MiniMax-M3")

    from brotto_orchestrator.model.resolver import resolve_model_config
    cfg, creds = resolve_model_config("127.0.0.1", None, None)
    assert creds.api_key == "sk-cp-test-token"
    assert cfg.provider == "minimax"


def test_per_user_config_used_when_no_inline(tmp_model_dir: Path, monkeypatch):
    monkeypatch.delenv("AGENT_MODEL", raising=False)
    saved = ModelConfig(provider="openai", model="gpt-4o", context_window=128_000)
    save_user_config("127.0.0.1", saved)
    from brotto_orchestrator.model.resolver import resolve_model_config
    cfg, _ = resolve_model_config("127.0.0.1", None, None)
    assert cfg == saved