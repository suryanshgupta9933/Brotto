from __future__ import annotations

from pathlib import Path

import pytest

from brotto_orchestrator.agent.context import (
    AgentDeps,
    AgentTurn,
    ScriptTargetUnresolved,
)
from brotto_orchestrator.agent.harness import _plan_step
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
    # A per-user config is a remembered *model*; the key still has to come
    # from this session, so it comes in as inline creds.
    creds = UserCredentials(api_key="sk-session", base_url=None)
    cfg, out = resolve_model_config("127.0.0.1", None, creds)
    assert cfg == saved
    assert out == creds


def test_bad_provider_keyerror_is_not_a_scripted_target_failure():
    """A bare registry index raises a KeyError, and a KeyError is a
    LookupError — so a handler catching `LookupError` would turn a live
    production misconfiguration into a "scripted target not found"
    TaskResult with no planner in play. The scripted raise must be a
    distinct type that cannot match it.

    The harness no longer *does* the bare index (see
    `test_bad_provider_becomes_a_model_not_found_result`), so this pins the
    type relationship rather than the old crash.
    """
    with pytest.raises(KeyError) as excinfo:
        PROVIDER_REGISTRY["not-a-real-provider"]
    assert not isinstance(excinfo.value, ScriptTargetUnresolved)
    assert not issubclass(ScriptTargetUnresolved, KeyError)
    # Still a LookupError, so the existing scripted-planner contract holds.
    assert issubclass(ScriptTargetUnresolved, LookupError)


def _turn() -> AgentTurn:
    return AgentTurn(
        task="t", step_number=0, scratchpad_notes="", scratchpad_entries=[],
        current_url="http://x/", current_page_title="x", ax_tree="",
        ax_diff="", step_summaries=[],
    )


def _deps(**kw) -> AgentDeps:
    async def _ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="u", task="t", cdp=None, ws_send=_ws_send, **kw)


class _UnresolvingPlanner:
    """Stands in for a ScriptedPlanner whose ref is absent from the AX tree."""

    def next(self, turn):
        raise ScriptTargetUnresolved("ref 'Next' did not resolve")


async def test_bad_provider_becomes_a_model_not_found_result(monkeypatch):
    """An unrecognised provider has to fail the way an unrecognised *model*
    does, because nothing validates the provider string: it arrives from a
    hand-edited per-user JSON file or from `AGENT_MODEL=typo:model` in .env.

    Bare-indexed, the KeyError escaped every handler in `_plan_step` and the
    run loop with it — no TaskResult, no failure_reason, nothing in the
    panel. A user who misspelled a provider in .env got silence.
    """
    monkeypatch.delenv("AGENT_MODEL", raising=False)
    deps = _deps(
        scripted_planner=None,
        # Needs a key, or the resolver falls through the inline config
        # (keyless inline is not honored) and we never reach the registry.
        api_key="sk-whatever",
        model_config=ModelConfig(
            provider="not-a-real-provider", model="m", context_window=1000,
        ),
    )
    assert await _plan_step(deps, _turn(), agent=object()) is None
    assert deps.result.failure_reason == "model_not_found"
    # The name has to survive into the sentence — otherwise the user is
    # told the model is missing when it is the provider that is.
    assert "not-a-real-provider" in deps.result.summary


async def test_an_unknown_provider_is_not_reported_as_a_scripted_target(monkeypatch):
    """The other half of the contract. A KeyError is a LookupError, so a
    handler catching `LookupError` (or a tuple naming it) would still turn a
    production misconfiguration into "scripted target did not resolve"."""
    monkeypatch.delenv("AGENT_MODEL", raising=False)
    deps = _deps(
        scripted_planner=None,
        api_key="sk-whatever",
        model_config=ModelConfig(
            provider="not-a-real-provider", model="m", context_window=1000,
        ),
    )
    await _plan_step(deps, _turn(), agent=object())
    assert "scripted target" not in (deps.result.failure_reason or "")


async def test_unresolved_scripted_target_becomes_failed_result():
    """The other half: the typed handler still does its job, so an
    unresolvable scripted ref is reported as a perception gap rather than
    crashing the run."""
    deps = _deps(scripted_planner=_UnresolvingPlanner())
    assert await _plan_step(deps, _turn(), agent=object()) is None
    assert deps.result.status == "failed"
    assert deps.result.failure_reason == (
        "scripted target did not resolve: ref 'Next' did not resolve"
    )
