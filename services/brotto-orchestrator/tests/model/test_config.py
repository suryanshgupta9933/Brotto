from __future__ import annotations

import pytest

from brotto_orchestrator.model.config import ModelConfig, UserCredentials


def test_model_config_round_trip():
    cfg = ModelConfig(provider="anthropic", model="MiniMax-M3", context_window=1_000_000)
    assert ModelConfig.from_dict(cfg.to_dict()) == cfg


def test_user_credentials_round_trip():
    c = UserCredentials(api_key="sk-test", base_url=None)
    assert UserCredentials.from_dict(c.to_dict()) == c


def test_user_credentials_none_api_key_round_trip():
    c = UserCredentials(api_key=None, base_url="https://example")
    d = UserCredentials.from_dict(c.to_dict())
    assert d.api_key is None
    assert d.base_url == "https://example"


def test_model_config_negative_context_window_rejected():
    with pytest.raises(ValueError, match="context_window"):
        ModelConfig(provider="anthropic", model="MiniMax-M3", context_window=-1)


def test_model_config_empty_provider_rejected():
    with pytest.raises(ValueError, match="provider"):
        ModelConfig(provider="", model="MiniMax-M3", context_window=1000)


def test_user_credentials_redact_in_repr():
    c = UserCredentials(api_key="sk-secret-abc", base_url=None)
    s = repr(c)
    assert "sk-secret-abc" not in s
    assert "***" in s or "redacted" in s.lower()


def test_from_dict_rejects_unknown_field():
    with pytest.raises(ValueError, match="unknown"):
        ModelConfig.from_dict({"provider": "anthropic", "model": "x", "context_window": 1000, "extra": True})