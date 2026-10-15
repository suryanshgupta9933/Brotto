"""A scroll has to report that it moved something.

Three failures, one cause chain, measured in recorded run
a19cf208-96b7-4bbd-a7bc-ecadb3174dd3 (27 steps, six of them scroll-only):

- `compute_ax_diff` compared `name` and `value`, and a scroll changes
  neither — it moves targets across the viewport edge into `blocked`. So every
  scroll-only step reported "(no changes detected)", and a model told its
  scroll accomplished nothing scrolled again.
- The refusal that followed a wasted click was sliced off the end of the
  joined outcome by a right-truncating cap, so the one string that says *why*
  nothing happened never reached the prompt.
- An action planned after a scroll in the same batch used geometry captured
  before it, and was refused for the same reason as the scroll that preceded
  it was not.

No live model, no key, no network.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.ax_diff import MAX_VISIBILITY_LINES, compute_ax_diff
from brotto_orchestrator.agent.context import (
    ActionCall, AgentDecision, AgentDeps, AgentTurn, StepSummary,
)
from brotto_orchestrator.agent.harness import AgentHarness, _summarise_outcome, _turn_to_prompt
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
import brotto_orchestrator.agent.harness as harness_mod


def _t(ref: str, name: str, blocked: str | None = None) -> SemanticTarget:
    return SemanticTarget(
        ref_id=ref, tag="button", role="button", name=name, blocked=blocked,
    )


# --- the diff ------------------------------------------------------------

def test_a_scroll_reports_what_it_brought_into_view():
    """The bug. A scroll moves `blocked`, not name or value."""
    before = [_t("0:1", "Filters", blocked="off-screen"), _t("0:2", "Save")]
    after = [_t("0:1", "Filters"), _t("0:2", "Save")]

    diff = compute_ax_diff(before, after)

    assert diff != "(no changes detected)"
    assert "[0:1]" in diff
    # Actionable, not a bare restatement: it says which way it moved and in
    # the same words ax_filter renders in the tree.
    assert "was off-screen, now visible" in diff


def test_scrolling_away_is_reported_too():
    """The other direction — the model must learn it pushed a target away."""
    before = [_t("0:1", "Filters"), _t("0:2", "Save")]
    after = [_t("0:1", "Filters", blocked="off-screen"), _t("0:2", "Save")]

    assert "was visible, now off-screen" in compute_ax_diff(before, after)


def test_occluded_uses_the_trees_word():
    before = [_t("0:1", "Filters", blocked="occluded")]
    after = [_t("0:1", "Filters")]
    assert "was covered by another element, now visible" in compute_ax_diff(before, after)


def test_an_unchanged_page_still_reads_as_unchanged():
    """The flood guard. Visibility must not turn every step into a diff."""
    same = [_t("0:1", "Filters"), _t("0:2", "Save")]
    assert compute_ax_diff(same, [_t("0:1", "Filters"), _t("0:2", "Save")]) == "(no changes detected)"


def test_a_whole_screenful_of_visibility_changes_does_not_flood():
    """A scroll can reveal 40 targets. Uncapped, that buries the content
    change the step was actually after."""
    before = [_t(f"0:{i}", f"Row {i}", blocked="off-screen") for i in range(40)]
    after = [_t(f"0:{i}", f"Row {i}") for i in range(40)]

    diff = compute_ax_diff(before, after, max_chars=800)

    assert diff.count("  v [") <= MAX_VISIBILITY_LINES
    assert "34 more target(s) that changed visibility" in diff
    assert len(diff) <= 800 + 60


def test_a_target_that_also_changed_text_is_not_reported_twice():
    before = [_t("0:1", "Filters", blocked="off-screen")]
    after = [_t("0:1", "Filters (2)")]
    diff = compute_ax_diff(before, after)
    assert diff.count("[0:1]") == 1
    assert "  ~ " in diff


def test_no_previous_observation_still_returns_empty():
    assert compute_ax_diff([], [_t("0:1", "Save")]) == ""


# --- the refusal reaching the prompt --------------------------------------

def test_a_refusal_survives_the_outcome_cap():
    """The cap cut from the right, so a late refusal was sliced off whole."""
    outcomes = [
        "Clicked [0:1]: ok " + "x" * 200,
        "Error executing click: ref '0:2' is off the visible page — scroll "
        "until you can see it, then click it again",
    ]
    summary = _summarise_outcome(outcomes)

    assert len(summary) <= 120
    assert "off the visible page" in summary


def test_a_clean_step_is_untouched():
    assert _summarise_outcome([]) == "no action"
    assert _summarise_outcome(["Clicked [0:1]: ok"]) == "Clicked [0:1]: ok"
    long = "y" * 400
    assert _summarise_outcome([long]) == long[:120]


def test_a_refusal_is_its_own_section_in_the_prompt():
    turn = AgentTurn(
        task="enable branch protection", step_number=9,
        scratchpad_notes="", scratchpad_entries=[],
        current_url="https://github.com/settings", current_page_title="Settings",
        ax_tree="[0:1] button Save", ax_diff="",
        step_summaries=[StepSummary(
            step=8, url="https://github.com/settings",
            action_taken='click [0:18818] "Enforcement status"',
            outcome="Error executing click: ref '0:18818' is off the visible "
                    "page — scroll until you can see it, then click it again",
        )],
    )

    prompt = _turn_to_prompt(turn)

    assert "## Refused actions" in prompt
    assert "off the visible page" in prompt
    # Last thing before the question, same reasoning as steering: the history
    # block runs twelve lines and the reason scrolls off it.
    assert prompt.index("## Refused actions") < prompt.index("## What is your next action(s)?")


def test_a_clean_step_gets_no_refusal_heading():
    turn = AgentTurn(
        task="t", step_number=2, scratchpad_notes="", scratchpad_entries=[],
        current_url="https://x/", current_page_title="X", ax_tree="[0:1] a", ax_diff="",
        step_summaries=[StepSummary(step=1, url="https://x/", action_taken="scroll down",
                                    outcome="Scrolled down")],
    )
    assert "## Refused actions" not in _turn_to_prompt(turn)


# --- the batch guard ------------------------------------------------------

_COMPLETE = AgentDecision(
    reasoning="done", thought="done",
    actions=[ActionCall(action="task_complete",
                        action_args={"summary": "ok", "extracted_data": None})],
)


class _EmptyResult:
    usage = None


def _deps() -> AgentDeps:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[_t("0:1", "Save")])
    cdp.get_current_url = AsyncMock(return_value="https://example.com/settings")
    cdp.get_page_text = AsyncMock(return_value="nothing to see")
    cdp.get_page_title = AsyncMock(return_value="Settings")
    cdp.refresh_target_map = AsyncMock()

    async def ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="t", task="enable protection", cdp=cdp, ws_send=ws_send)


@pytest.mark.asyncio
async def test_an_action_after_a_scroll_waits_for_the_next_step(monkeypatch):
    """The harness is stateless per step: a click planned after a scroll in
    the same batch uses the geometry captured before it, and the relay
    refuses it. Recorded run a19cf208 lost steps to exactly this."""
    executed: list[str] = []

    async def _fake_execute(call, deps, audit=None, turn=None):
        executed.append(call.action)
        if call.action == "task_complete":
            from brotto_orchestrator.agent.context import TaskResult
            deps.result = TaskResult(status="completed", summary="ok")
        return f"{call.action} done"

    calls: list[int] = []

    async def _fake_plan(deps, turn, agent, audit=None):
        calls.append(1)
        deps.result = None
        if len(calls) > 1:
            return _COMPLETE, 400_000, _EmptyResult()
        return AgentDecision(
            reasoning="scroll then click", thought="scroll then click",
            actions=[
                ActionCall(action="scroll", action_args={"direction": "up", "amount": 300}),
                ActionCall(action="click", action_args={"ref": "0:18986"}),
                ActionCall(action="task_complete",
                           action_args={"summary": "ok", "extracted_data": None}),
            ],
        ), 400_000, _EmptyResult()

    monkeypatch.setattr(harness_mod, "_execute_action", _fake_execute)
    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)

    result = await asyncio.wait_for(AgentHarness().run(_deps()), timeout=10)

    # The click never ran, so the batch ended on the scroll rather than
    # continuing into a pre-scroll coordinate.
    assert executed[0] == "scroll"
    assert "click" not in executed


@pytest.mark.asyncio
async def test_a_batch_without_a_scroll_still_runs_in_full(monkeypatch):
    """The guard must not cost a legitimate multi-action step."""
    executed: list[str] = []

    async def _fake_execute(call, deps, audit=None, turn=None):
        executed.append(call.action)
        if call.action == "task_complete":
            from brotto_orchestrator.agent.context import TaskResult
            deps.result = TaskResult(status="completed", summary="ok")
        return f"{call.action} done"

    async def _fake_plan(deps, turn, agent, audit=None):
        return AgentDecision(
            reasoning="fill then submit", thought="fill then submit",
            actions=[
                ActionCall(action="type_text", action_args={"ref": "0:1", "text": "main"}),
                ActionCall(action="click", action_args={"ref": "0:2"}),
                ActionCall(action="task_complete",
                           action_args={"summary": "ok", "extracted_data": None}),
            ],
        ), 400_000, _EmptyResult()

    monkeypatch.setattr(harness_mod, "_execute_action", _fake_execute)
    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)

    result = await asyncio.wait_for(AgentHarness().run(_deps()), timeout=10)

    assert executed == ["type_text", "click", "task_complete"]
    assert result.status == "completed"