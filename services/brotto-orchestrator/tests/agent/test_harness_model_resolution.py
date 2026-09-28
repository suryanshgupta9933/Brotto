from __future__ import annotations

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
    cfg, _ = resolve_model_config("127.0.0.1", None, None)
    assert cfg == saved


def test_bad_provider_keyerror_is_not_a_scripted_target_failure():
    """A bad provider reaches PROVIDER_REGISTRY[cfg.provider] unguarded.

    The KeyError it raises is a LookupError, so a bare `except LookupError`
    in the harness turns a live production misconfiguration into a
    "scripted target not found" TaskResult with no planner in play. The
    scripted raise must be a distinct type that cannot match it.
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


async def test_bad_provider_propagates_keyerror(monkeypatch):
    """A bad provider reaches PROVIDER_REGISTRY[cfg.provider] unguarded.

    The KeyError it raises is a LookupError, so a handler that caught
    LookupError (or a tuple naming it) would turn a live production
    misconfiguration into a "scripted target not found" TaskResult. Pins
    that the plan step does not swallow it.
    """
    monkeypatch.delenv("AGENT_MODEL", raising=False)
    deps = _deps(
        scripted_planner=None,
        model_config=ModelConfig(
            provider="not-a-real-provider", model="m", context_window=1000,
        ),
    )
    with pytest.raises(KeyError):
        await _plan_step(deps, _turn(), agent=object())


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
