"""The two stops a run can end on say two different things.

Both fire the same bound and both report `page_not_responding`, so the only
thing that separates them is the sentence. On the delta-only path the pixels
moved every step while `stagnant_steps` stayed at 0, so the "did not visibly
change" message — which interpolates a count of identical observations the run
never made — is a lie. Driven through `AgentHarness.run` with `_plan_step`
stubbed, same shape as test_stagnation_bound.py.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from brotto_orchestrator.agent.context import (
    ActionCall, AgentDecision, AgentDeps,
)
from brotto_orchestrator.agent.harness import (
    _DELTA_ONLY_STEPS, AgentHarness,
)
import brotto_orchestrator.agent.harness as harness_mod
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget


class _PlanResult:
    usage = None


def _canvas_deps() -> AgentDeps:
    """A Sheet: canvas-covered, and repainting every single step."""
    cdp = AsyncMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(
        return_value=[SemanticTarget(ref_id="r:A", tag="button", role="button",
                                     name="Name box")])
    cdp.get_current_url = AsyncMock(return_value="https://docs.google.com/x")
    cdp.get_page_text = AsyncMock(return_value="Sheet1  Name box  ")
    # The delta reports movement, not a state: an alternating answer is a
    # caret blinking, which credits progress to the delta alone every step.
    tick = {"n": 0}

    async def _delta(*_args):
        tick["n"] += 1
        return {"changed": bool(tick["n"] % 2)}

    cdp.get_page_delta = AsyncMock(side_effect=_delta)
    cdp.get_canvas_covered = AsyncMock(return_value=0.9)
    cdp.get_page_title = AsyncMock(return_value="Sheet1")
    cdp.refresh_target_map = AsyncMock()

    async def ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="t", task="go", cdp=cdp, ws_send=ws_send)


@pytest.mark.asyncio
async def test_a_delta_only_stop_does_not_say_the_page_never_changed(monkeypatch):
    steps: list[int] = []

    async def _fake_plan(deps, turn, agent, audit=None):
        steps.append(turn.step_number)
        return (AgentDecision(
            reasoning="trying", thought="trying",
            actions=[ActionCall(action="click", action_args={"ref": "r:A"})]),
            400_000, _PlanResult())

    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)
    result = await AgentHarness().run(_canvas_deps())

    assert result.status == "failed"
    assert result.failure_reason == "page_not_responding"
    assert len(steps) == _DELTA_ONLY_STEPS, "the delta-only bound is what stopped it"
    assert "did not visibly change" not in result.summary
    assert "came back looking exactly the same" not in result.summary
    # It repainted every step; that is the observation being reported.
    assert "repainted every step" in result.summary
    # The guidance carries over — same situation, same next moves.
    assert "Worth trying:" in result.summary
    # A count it does not have must not appear: 18 is a ceiling, not a tally.
    assert str(_DELTA_ONLY_STEPS) not in result.summary