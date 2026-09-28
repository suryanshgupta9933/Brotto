from __future__ import annotations

import logging

import pytest

from brotto_orchestrator.model.config import ModelConfig, UserCredentials
from brotto_orchestrator.model.registry import PROVIDER_REGISTRY


def test_unknown_provider_raises_in_registry_lookup():
    with pytest.raises(KeyError):
        PROVIDER_REGISTRY["not-a-real-provider"]


def test_unknown_model_in_known_provider_fails_validation():
    f = PROVIDER_REGISTRY["minimax"]
    assert f.validate_model_id("definitely-not-real-xyz") is False
    cfg = ModelConfig(provider="minimax", model="definitely-not-real-xyz", context_window=1000)
    # The harness (Task 7) raises UserError here. We just confirm the factory rejects.
    assert not f.validate_model_id(cfg.model)


def test_api_key_redaction_in_log(caplog):
    """User-supplied api_key must never appear in logs."""
    secret = "sk-cp-supersecret-12345"
    cfg = ModelConfig(provider="minimax", model="MiniMax-M3", context_window=1_000_000)
    creds = UserCredentials(api_key=secret, base_url=None)

    with caplog.at_level(logging.INFO):
        from brotto_orchestrator.model.resolver import resolve_model_config
        resolve_model_config("127.0.0.1", cfg, creds)

    flat = " ".join(r.getMessage() for r in caplog.records)
    assert secret not in flat, f"API key leaked into logs: {flat!r}"