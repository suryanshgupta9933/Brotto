"""The page delta reaches the prompt, and its absence says nothing.

Three properties, in the order they matter:

1. A delta is reported to the model.
2. **No delta produces no claim at all** — not "no change", not "unchanged".
   Two missing measurements are not a measurement, and the model cannot tell
   our silence from a quiet page. This is the regression: a reassuring line
   here is a statement about the page dressed as a statement about our
   plumbing.
3. Reading a delta costs no screenshot budget.

Driven through `AgentHarness.run` with `_plan_step` stubbed — no model, no
key, no network — same shape as test_stagnation_bound.py.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import ActionCall, AgentDecision, AgentDeps
from brotto_orchestrator.agent.harness import (
    AgentHarness, _delta_section, _turn_to_prompt,
)
import brotto_orchestrator.agent.harness as harness_mod
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget

DELTA = {
    "changed": True,
    "tiles": [{"x": 64, "y": 64, "w": 32, "h": 32, "pct": 14.4}],
}

_DONE = AgentDecision(
    reasoning="done", thought="done",
    actions=[ActionCall(action="task_complete",
                        action_args={"summary": "ok", "extracted_data": None})],
)


class _PlanResult:
    usage = None


# --- the renderer -----------------------------------------------------------

def test_a_delta_names_the_regions_that_moved():
    out = _delta_section(DELTA)
    assert "x=64 y=64 w=32 h=32" in out
    assert "14.4%" in out
    # D2: a tile is a region, never a target.
    assert "never aim" in out


def test_an_absent_delta_renders_as_nothing_at_all():
    assert _delta_section(None) == ""
    assert _delta_section({}) == ""


def test_a_quiet_page_says_it_was_measured_quiet():
    out = _delta_section({"changed": False, "tiles": []})
    assert "differ in no region" in out
    # Changed is not succeeded, and did-not-change is not failure.
    assert "nothing worked" not in out


# --- through the loop -------------------------------------------------------

@pytest.mark.asyncio
async def test_a_delta_is_surfaced_and_costs_no_screenshot(monkeypatch):
    prompts: list[str] = []

    async def _fake_plan(deps, turn, agent, audit=None):
        prompts.append(_turn_to_prompt(turn))
        return _DONE, 400_000, _PlanResult()

    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)

    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[
        SemanticTarget(ref_id="r:A", tag="button", role="button", name="A")])
    cdp.get_current_url = AsyncMock(return_value="http://example.com")
    cdp.get_page_text = AsyncMock(return_value="")
    cdp.get_page_title = AsyncMock(return_value="Example Page")
    cdp.get_page_delta = AsyncMock(return_value=DELTA)
    cdp.capture_screenshot = AsyncMock(return_value=None)
    cdp.refresh_target_map = AsyncMock()

    async def ws_send(_msg: dict) -> None:
        return None

    deps = AgentDeps(user_id="t", task="go", cdp=cdp, ws_send=ws_send)
    result = await AgentHarness().run(deps)

    assert result.status == "completed"
    assert len(prompts) == 1
    assert "x=64 y=64 w=32 h=32" in prompts[0]
    # The delta is read, not captured: a screenshot budget spent here would
    # buy an image the model cannot use, against a cap of three per task.
    assert deps.screenshots_taken == 0
    assert deps.cdp.capture_screenshot.await_count == 0


@pytest.mark.asyncio
async def test_an_absent_delta_claims_nothing_about_the_page(monkeypatch):
    """The regression that matters most.

    With the switch off — the default — the gate withholds the delta on every
    step. A model that reads "nothing changed" there is being told the page is
    dead while we simply never looked.
    """
    prompts: list[str] = []

    async def _fake_plan(deps, turn, agent, audit=None):
        prompts.append(_turn_to_prompt(turn))
        return _DONE, 400_000, _PlanResult()

    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)

    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[
        SemanticTarget(ref_id="r:A", tag="button", role="button", name="A")])
    cdp.get_current_url = AsyncMock(return_value="http://example.com")
    cdp.get_page_text = AsyncMock(return_value="")
    cdp.get_page_title = AsyncMock(return_value="Example Page")
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.refresh_target_map = AsyncMock()

    async def ws_send(_msg: dict) -> None:
        return None

    deps = AgentDeps(user_id="t", task="go", cdp=cdp, ws_send=ws_send)
    await AgentHarness().run(deps)

    prompt = prompts[0]
    assert "page_delta" not in prompt
    for phrase in ("no change", "nothing changed", "unchanged",
                   "did not change", "no visual"):
        assert phrase not in prompt.lower()