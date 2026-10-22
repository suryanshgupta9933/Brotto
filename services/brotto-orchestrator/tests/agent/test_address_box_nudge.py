"""A run that keeps typing into a grid's ADDRESS BOX is told — once, in
the prompt, and is not stopped.

A measured Google Sheets run typed its two column headers into the name box
and then reported itself done. A word typed there becomes a NAMED RANGE, so
no cell was ever written — the page opened a "Create a named range" panel
instead. Neither existing bound could see it:

  - the word-overlap nudge compares the LAST TWO steps' summaries, and those
    steps differed (type, Enter, click, read), so it never fired;
  - the stagnation bound measures the PAGE, and the agent's own typing
    changed the tree every step, so every step looked like progress.

The address box is identified, not guessed: it is the field that holds a
CELL REFERENCE ("A1"), and only a word that is NOT a reference counts — a
reference typed there is a jump and is legitimate.

No live model, no key, no network.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import (
    ActionCall, AgentDecision, AgentDeps, TaskResult,
)
from brotto_orchestrator.agent.harness import (
    AgentHarness, address_box_nudge,
)
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
import brotto_orchestrator.agent.harness as harness_mod


class _EmptyResult:
    usage = None


def _deps(writes: list[list[str]] | None = None) -> AgentDeps:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[
        SemanticTarget(ref_id="0:5127", tag="input", role="textbox",
                       name="", value="A1")])
    cdp.get_current_url = AsyncMock(return_value="https://example.com/sheet")
    # A page whose text changes every step, so the stagnation bound is not
    # what ends this run — the nudge is the thing under test.
    cdp.get_page_text = AsyncMock(
        side_effect=[f"page {i}" for i in range(20)])
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Sheet")
    cdp.refresh_target_map = AsyncMock()

    async def ws_send(_msg: dict) -> None:
        return None

    deps = AgentDeps(user_id="t", task="write a name", cdp=cdp, ws_send=ws_send)
    if writes is not None:
        deps.address_box_writes = writes
    return deps


# --- the detector -----------------------------------------------------------

def test_two_writes_into_an_address_box_are_named():
    deps = _deps([["0:5127", "0:5127"]])
    out = address_box_nudge(deps)
    assert "CELL REFERENCE" in out
    assert "named range" in out


def test_one_write_is_not_enough():
    """A cell whose own content is a reference can look like an address box."""
    deps = _deps([["0:5127"]])
    assert address_box_nudge(deps) == ""


def test_a_run_that_typed_nothing_is_not_nudged():
    deps = _deps([[], [], [], []])
    assert address_box_nudge(deps) == ""


def test_the_window_is_six_steps():
    """Older than the window is history, not a pattern."""
    deps = _deps([["0:5127", "0:5127"],
                  [], [], [], [], [], []])
    assert address_box_nudge(deps) == ""


def test_one_write_inside_the_window_and_one_outside_is_not_enough():
    deps = _deps([["0:5127", "0:5127"],
                  [], [], [], [], [], ["0:5127"]])
    assert address_box_nudge(deps) == ""


def test_the_nudge_says_what_to_do_instead():
    deps = _deps([["0:5127", "0:5127"]])
    out = address_box_nudge(deps)
    assert "cannot_complete" in out
    assert "press Enter" in out


# --- the content box is not the address box --------------------------------

@pytest.mark.asyncio
async def test_the_measured_content_box_write_is_not_nudged(monkeypatch):
    """The corrected recipe tells the model to type into the CONTENT box. If
    that write tripped the nudge, the fix would stop every cell write.

    The detector keys on the field's shown value, so the two are told apart by
    the same tell the prompt teaches: the address box holds "A1", the content
    box holds the cell's text. Here it holds what the failed run typed.
    """
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[
        SemanticTarget(ref_id="0:9001", tag="div", role="textbox",
                       name="", value="Name")])
    cdp.get_current_url = AsyncMock(return_value="https://example.com/sheet")
    cdp.get_page_text = AsyncMock(side_effect=[f"page {i}" for i in range(20)])
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Sheet")
    cdp.refresh_target_map = AsyncMock()

    warnings: list[str] = []

    async def _fake_execute(call, deps, audit=None, turn=None, **_ignored):
        if call.action == "task_complete":
            deps.result = TaskResult(status="completed", summary="ok")
        return f"{call.action} done"

    async def _fake_plan(deps, turn, agent, audit=None):
        warnings.append(turn.repeat_warning)
        deps.result = None
        if len(warnings) >= 4:
            return AgentDecision(
                reasoning="done", thought="done",
                actions=[ActionCall(action="task_complete",
                                    action_args={"summary": "ok",
                                                 "extracted_data": None})],
            ), 400_000, _EmptyResult()
        # Exactly the measured run: a value typed into the box that holds the
        # cell's content, then Enter.
        return AgentDecision(
            reasoning="s", thought="writing",
            actions=[ActionCall(action="type_text",
                                action_args={"ref": "0:9001", "text": "name"}),
                     ActionCall(action="press_key",
                                action_args={"key": "Enter", "modifiers": 0})],
        ), 400_000, _EmptyResult()

    monkeypatch.setattr(harness_mod, "_execute_action", _fake_execute)
    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)

    async def ws_send(_msg: dict) -> None:
        return None

    deps = AgentDeps(user_id="t", task="write a name", cdp=cdp,
                     ws_send=ws_send)
    await asyncio.wait_for(AgentHarness().run(deps), timeout=10)

    assert not any("CELL REFERENCE" in w for w in warnings), (
        "typing into the content box was mistaken for typing into the "
        "address box")
    assert deps.address_box_writes and all(
        w == [] for w in deps.address_box_writes), (
        "a content-box write was recorded as an address-box write: "
        f"{deps.address_box_writes}")
    assert deps.result is not None and deps.result.status == "completed", (
        "the nudge is a warning, not a kill — a correct write still finishes")


# --- through the loop -------------------------------------------------------

@pytest.mark.asyncio
async def test_the_write_into_the_address_box_is_detected_and_nudged(monkeypatch):
    warnings: list[str] = []

    async def _fake_execute(call, deps, audit=None, turn=None, **_ignored):
        if call.action == "task_complete":
            deps.result = TaskResult(status="completed", summary="ok")
        return f"{call.action} done"

    async def _fake_plan(deps, turn, agent, audit=None):
        warnings.append(turn.repeat_warning)
        deps.result = None
        if len(warnings) == 2:
            # A step that reads rather than types.
            return AgentDecision(
                reasoning="s", thought="reading",
                actions=[ActionCall(action="read_page_text", action_args={})],
            ), 400_000, _EmptyResult()
        if len(warnings) >= 4:
            return AgentDecision(
                reasoning="done", thought="done",
                actions=[ActionCall(action="task_complete",
                                    action_args={"summary": "ok",
                                                 "extracted_data": None})],
            ), 400_000, _EmptyResult()
        # Two headers typed into the field that holds the cell reference —
        # what the measured run did, in one step.
        return AgentDecision(
            reasoning="s", thought="typing",
            actions=[ActionCall(action="type_text",
                                action_args={"ref": "0:5127", "text": "Name"}),
                     ActionCall(action="type_text",
                                action_args={"ref": "0:5127", "text": "Age"})],
        ), 400_000, _EmptyResult()

    monkeypatch.setattr(harness_mod, "_execute_action", _fake_execute)
    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)

    deps = _deps()
    await asyncio.wait_for(AgentHarness().run(deps), timeout=10)

    assert any("CELL REFERENCE" in w for w in warnings), (
        "the model was never told it was typing into the address box")
    # A nudge, not a kill.
    assert deps.result is not None and deps.result.status == "completed"
    # And every step is recorded, so the window counts steps and not the
    # steps that happened to type.
    assert deps.address_box_writes[0] == ["0:5127", "0:5127"]
    assert deps.address_box_writes[1] == [], "the step that typed nothing is a step"
