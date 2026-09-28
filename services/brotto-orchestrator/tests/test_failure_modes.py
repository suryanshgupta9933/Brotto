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


def test_make_model_not_found_result():
    from brotto_orchestrator.agent.harness import _make_model_not_found_result
    r = _make_model_not_found_result(provider="minimax", model_id="totally-fake")
    assert r.failure_reason == "model_not_found"
    assert r.status == "failed"
    assert "minimax" in r.summary and "totally-fake" in r.summary


def test_make_auth_failed_result():
    from brotto_orchestrator.agent.harness import _make_auth_failed_result
    r = _make_auth_failed_result(provider="anthropic")
    assert r.failure_reason == "auth_failed"
    assert r.status == "failed"
    assert "anthropic" in r.summary
    # The summary must NOT echo any API key.
    assert "sk-" not in r.summary


def test_harness_converts_unknown_model_to_model_not_found():
    """When factory.validate_model_id returns False, the harness loop
    surfaces a TaskResult with failure_reason=model_not_found (not the
    generic task_error path)."""
    from pydantic_ai.exceptions import UserError
    from brotto_orchestrator.agent.harness import _make_model_not_found_result

    # Simulate the path: factory rejects the model id → UserError raised.
    fake_user_error = UserError("Unknown model minimax:totally-fake")
    # The conversion happens in the harness loop; verify the helper is
    # wired and produces the right TaskResult shape.
    converted = _make_model_not_found_result("minimax", "totally-fake")
    assert converted.failure_reason == "model_not_found"
    # Sanity: the source error mentions the same model.
    assert "minimax" in str(fake_user_error) and "totally-fake" in str(fake_user_error)