"""The no-progress bound: N unchanged observations stop the run, and only that.

Driven through `AgentHarness.run` with `_plan_step` stubbed, so no model, no
key and no network — same shape as test_harness_token_accounting.py. The unit
cases on `_note_stagnation` pin the counter; the loop cases pin that the
counter is actually consulted, because a bound nobody calls reads exactly like
a bound that works.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import (
    ActionCall, AgentDecision, AgentDeps,
)
from brotto_orchestrator.agent.harness import (
    _AX_NO_CHANGE, _STAGNANT_STEPS, AgentHarness, _note_stagnation,
)
import brotto_orchestrator.agent.harness as harness_mod
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget


def _t(name: str) -> SemanticTarget:
    return SemanticTarget(ref_id=f"r:{name}", tag="button", role="button", name=name)


_CLICK = AgentDecision(
    reasoning="trying again", thought="trying again",
    actions=[ActionCall(action="click", action_args={"ref": "r:A"})],
)
_DONE = AgentDecision(
    reasoning="done", thought="done",
    actions=[ActionCall(action="task_complete",
                        action_args={"summary": "ok", "extracted_data": None})],
)


class _PlanResult:
    usage = None


def _stub_plan(monkeypatch, decision: AgentDecision) -> list[int]:
    """Every step plans `decision`; returns a list of the steps that ran."""
    steps: list[int] = []

    async def _fake_plan(deps, turn, agent, audit=None):
        steps.append(turn.step_number)
        return decision, 400_000, _PlanResult()

    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)
    return steps


def _deps(targets: list[SemanticTarget], text: str = "") -> AgentDeps:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=targets)
    cdp.get_current_url = AsyncMock(return_value="http://example.com")
    cdp.get_page_text = AsyncMock(return_value=text)
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Example Page")
    cdp.refresh_target_map = AsyncMock()

    async def ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="t", task="go", cdp=cdp, ws_send=ws_send)


# --- the counter itself -----------------------------------------------------

def test_n_identical_observations_stop_the_run():
    deps = _deps([_t("A")])
    # The first observation has nothing to be identical to, so the bound
    # fires on the one after N unchanged repeats.
    for _ in range(_STAGNANT_STEPS):
        assert not _note_stagnation(deps, "u", 0, _AX_NO_CHANGE)
    assert _note_stagnation(deps, "u", 0, _AX_NO_CHANGE)


def test_a_changing_tree_never_trips_it():
    deps = _deps([_t("A")])
    for i in range(_STAGNANT_STEPS * 3):
        assert not _note_stagnation(deps, "u", 0, f"  + [r:x] button \"row {i}\"")


def test_a_new_url_resets_the_counter():
    deps = _deps([_t("A")])
    for _ in range(_STAGNANT_STEPS - 1):
        _note_stagnation(deps, "u", 0, _AX_NO_CHANGE)
    assert not _note_stagnation(deps, "other", 0, _AX_NO_CHANGE)
    assert deps.stagnant_steps == 0


def test_page_text_growing_is_progress():
    """A slow render appends to innerText long before the tree is rebuilt."""
    deps = _deps([_t("A")])
    for i in range(_STAGNANT_STEPS * 3):
        assert not _note_stagnation(deps, "u", i, _AX_NO_CHANGE)


def test_progress_resets_mid_run():
    deps = _deps([_t("A")])
    for _ in range(_STAGNANT_STEPS - 1):
        _note_stagnation(deps, "u", 0, _AX_NO_CHANGE)
    _note_stagnation(deps, "u", 0, "  ~ [r:A] button \"A\" → \"B\"")
    assert deps.stagnant_steps == 0
    for _ in range(_STAGNANT_STEPS - 1):
        assert not _note_stagnation(deps, "u", 0, _AX_NO_CHANGE)


# --- through the loop -------------------------------------------------------

@pytest.mark.asyncio
async def test_the_loop_stops_a_run_that_changes_nothing(monkeypatch):
    steps = _stub_plan(monkeypatch, _CLICK)
    result = await AgentHarness().run(_deps([_t("A")]))
    assert result.status == "failed"
    assert result.failure_reason == "page_not_responding"
    # One fewer step than the counter needs to fill: the bound stops the run
    # before it pays for another model call.
    assert len(steps) == _STAGNANT_STEPS
    # And the user is told what was seen, not what was concluded.
    assert "did not visibly change" in result.summary
    assert "cannot read" in result.summary


@pytest.mark.asyncio
async def test_read_only_steps_are_not_a_loop(monkeypatch):
    """A run that spends its steps reading is slow, not stuck: nothing was
    dispatched, so an unchanged page is the expected reading."""
    read = AgentDecision(
        reasoning="reading", thought="reading",
        actions=[ActionCall(action="read_page_text", action_args={"selector": "body"})],
    )
    steps: list[int] = []

    async def _fake_plan(deps, turn, agent, audit=None):
        steps.append(turn.step_number)
        decision = read if turn.step_number < _STAGNANT_STEPS + 3 else _DONE
        return decision, 400_000, _PlanResult()

    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)
    result = await AgentHarness().run(_deps([_t("A")]))
    assert result.status == "completed"
    assert len(steps) > _STAGNANT_STEPS


@pytest.mark.asyncio
async def test_a_page_that_changes_runs_to_completion(monkeypatch):
    """Same page shape, one new target arriving every step — a slow load."""
    page = [_t("A")]

    def _page(i: int) -> list[SemanticTarget]:
        """A new target lands on every step — a page still rendering."""
        return [_t("A")] + ([_t(f"row {i}")] if i < 2 else [])

    cdp_deps = _deps(page)
    cdp_deps.cdp.get_targets = AsyncMock(
        side_effect=lambda *_: _page(cdp_deps.step_number)
    )
    steps: list[int] = []

    async def _fake_plan(deps, turn, agent, audit=None):
        steps.append(turn.step_number)
        # A slow renderer finishes on step 3; after that the agent is done.
        decision = _CLICK if turn.step_number < 3 else _DONE
        return decision, 400_000, _PlanResult()

    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)
    result = await AgentHarness().run(cdp_deps)
    assert result.status == "completed"
    assert len(steps) == 4
