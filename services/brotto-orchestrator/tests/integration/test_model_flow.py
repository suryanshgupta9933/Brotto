from __future__ import annotations

from pathlib import Path

import pytest

from brotto_orchestrator.contracts import ModelConfigWire, TaskStart
from brotto_orchestrator.model.config import ModelConfig, UserCredentials
from brotto_orchestrator.model.resolver import resolve_model_config
from brotto_orchestrator.model.store import (
    BROTTO_USER_MODEL_DIR_ENV,
    load_user_config,
    save_user_config,
)


@pytest.fixture
def tmp_model_dir(monkeypatch, tmp_path: Path):
    monkeypatch.setenv(BROTTO_USER_MODEL_DIR_ENV, str(tmp_path))
    return tmp_path


def test_task_start_with_inline_model_config_round_trips():
    msg = TaskStart(
        goal="search",
        model_cfg=ModelConfigWire(provider="minimax", model="MiniMax-M3", context_window=1_000_000),
        api_key="sk-test",
    )
    assert msg.model_cfg.provider == "minimax"
    assert msg.api_key == "sk-test"


def test_base_url_survives_the_wire():
    """The extension ships `model_config` whole, so adding the field to the
    wire type is the whole client-side change — but a wire type that drops it
    on validation would send a self-hosted user back to the default
    endpoint with no error anywhere."""
    msg = TaskStart(
        goal="run it",
        model_cfg=ModelConfigWire(provider="ollama", model="llama3.1",
                                  context_window=128_000,
                                  base_url="http://localhost:11434/v1"),
        api_key="",
    )
    assert msg.model_cfg.base_url == "http://localhost:11434/v1"


def test_a_task_start_without_a_base_url_still_parses():
    """Additive field: a pre-existing extension sends none, and the model
    must be optional rather than required."""
    msg = TaskStart(
        goal="search",
        model_cfg=ModelConfigWire(provider="anthropic",
                                  model="claude-3-5-sonnet-latest", context_window=200_000),
        api_key="sk-test",
    )
    assert msg.model_cfg.base_url is None


def test_a_non_http_base_url_is_refused_at_construction():
    """/ws/ext is unauthenticated, so a client-supplied URL is a
    request-forgery primitive: point the server at file:// or an internal
    host and it will POST there with the caller's key."""
    with pytest.raises(ValueError, match="http"):
        ModelConfig(provider="custom", model="whatever", context_window=8_000,
                    base_url="file:///etc/passwd")
    with pytest.raises(ValueError, match="http"):
        ModelConfig(provider="custom", model="whatever", context_window=8_000,
                    base_url="gopher://internal:70/")


def test_remember_key_saves_per_user_config(tmp_model_dir: Path):
    msg = TaskStart(
        goal="search",
        model_cfg=ModelConfigWire(provider="minimax", model="MiniMax-M3", context_window=1_000_000),
        api_key="sk-test",
        remember_key=True,
        client_ip="10.0.0.1",
    )
    if msg.remember_key and msg.model_cfg and msg.client_ip:
        cfg = ModelConfig(
            provider=msg.model_cfg.provider,
            model=msg.model_cfg.model,
            context_window=msg.model_cfg.context_window or 400_000,
        )
        save_user_config(msg.client_ip, cfg)
    loaded = load_user_config("10.0.0.1")
    assert loaded is not None
    assert loaded.provider == "minimax"


@pytest.mark.asyncio
async def test_inline_task_start_routes_to_resolver(monkeypatch, tmp_path):
    """End-to-end: inline task_start with model_config + api_key. Resolver
    should pick the inline tier and produce a Model."""
    inline = ModelConfig(provider="minimax", model="MiniMax-M3", context_window=1_000_000)
    creds = UserCredentials(api_key="sk-test", base_url=None)
    cfg, got_creds = resolve_model_config("127.0.0.1", inline, creds)
    assert cfg == inline
    assert got_creds == creds


@pytest.mark.asyncio
async def test_old_task_start_without_model_config_falls_back_to_env(monkeypatch, tmp_path):
    """Backward compat: no model_config on task_start must still work when
    AGENT_MODEL env var is set."""
    monkeypatch.setenv("BROTTO_USER_MODEL_DIR", str(tmp_path))
    monkeypatch.setenv("AGENT_MODEL", "anthropic:MiniMax-M3")
    monkeypatch.setenv("CONTEXT_WINDOW_TOKENS", "1000000")

    cfg, _ = resolve_model_config("127.0.0.1", None, None)
    assert cfg.provider == "anthropic"
    assert cfg.model == "MiniMax-M3"


@pytest.mark.asyncio
async def test_resolved_context_window_propagates_to_model_config(monkeypatch):
    """CONTEXT cell guard: resolver returns the right context_window
    so the side-panel renders the correct percentage."""
    monkeypatch.setenv("AGENT_MODEL", "minimax:MiniMax-M3")
    monkeypatch.setenv("CONTEXT_WINDOW_TOKENS", "1000000")

    cfg, _ = resolve_model_config("127.0.0.1", None, None)
    assert cfg.context_window == 1_000_000, "side-panel CONTEXT cell will render wrong %"


def test_build_context_uses_resolved_window_when_provided(monkeypatch):
    """Per-task context_window must drive the CONTEXT cell, not the
    module-level env var."""
    monkeypatch.setenv("CONTEXT_WINDOW_TOKENS", "99999")  # would be wrong
    from brotto_orchestrator.agent.harness import _build_context
    # Use the resolved window (1M for MiniMax-M3), not the env-set 99999
    payload = _build_context(tokens=50_000, window=1_000_000)
    assert payload["window"] == 1_000_000
    assert payload["tokens"] == 50_000
    assert payload["pct"] == 5.0  # 50k / 1M = 5%


def test_build_context_falls_back_to_env_when_window_is_none(monkeypatch):
    """When the caller passes window=None, fall back to env default.
    This preserves the existing behavior for callers that haven't been
    updated yet (defense in depth — main flow passes the resolved window)."""
    monkeypatch.setenv("CONTEXT_WINDOW_TOKENS", "200000")
    from brotto_orchestrator.agent.harness import _build_context
    payload = _build_context(tokens=10_000, window=None)
    assert payload["window"] == 200_000
    assert payload["pct"] == 5.0