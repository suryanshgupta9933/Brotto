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

def test_stated_rates_round_trip_through_the_saved_file():
    """store.py persists this dataclass, so the per-user JSON is where a
    self-hoster states a rate with no extension and no account."""
    cfg = ModelConfig(provider="custom", model="qwen2.5-coder:7b", context_window=32_768,
                      base_url="http://gpu-box.lan:8000/v1",
                      input_per_mtok=0.0, output_per_mtok=0.0)
    assert ModelConfig.from_dict(cfg.to_dict()) == cfg


def test_half_a_rate_is_rejected():
    with pytest.raises(ValueError, match="both input_per_mtok"):
        ModelConfig(provider="custom", model="x", context_window=1000,
                    input_per_mtok=1.0)
    with pytest.raises(ValueError, match="both input_per_mtok"):
        ModelConfig(provider="custom", model="x", context_window=1000,
                    output_per_mtok=1.0)


def test_a_negative_rate_is_rejected():
    with pytest.raises(ValueError, match="input_per_mtok"):
        ModelConfig(provider="custom", model="x", context_window=1000,
                    input_per_mtok=-1.0, output_per_mtok=1.0)
    with pytest.raises(ValueError, match="output_per_mtok"):
        ModelConfig(provider="custom", model="x", context_window=1000,
                    input_per_mtok=1.0, output_per_mtok=-1.0)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_a_non_finite_rate_is_rejected(bad):
    """`nan < 0` is False, so the range check alone let it through and out as
    `cost_usd=nan` — which defeats a budget cap rather than failing it."""
    with pytest.raises(ValueError, match="input_per_mtok"):
        ModelConfig(provider="custom", model="x", context_window=1000,
                    input_per_mtok=bad, output_per_mtok=1.0)
    with pytest.raises(ValueError, match="output_per_mtok"):
        ModelConfig(provider="custom", model="x", context_window=1000,
                    input_per_mtok=1.0, output_per_mtok=bad)


def test_zero_is_a_stated_rate_not_an_absent_one():
    """A box the user runs themselves genuinely costs $0.00 — but it is their
    statement, not our guess, so it prices rather than reading as unknown."""
    cfg = ModelConfig(provider="custom", model="local", context_window=1000,
                      input_per_mtok=0.0, output_per_mtok=0.0)
    assert cfg.input_per_mtok == 0.0
