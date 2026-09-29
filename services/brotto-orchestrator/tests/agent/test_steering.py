"""Mid-task steering reaches the next turn, and only the next turn.

The WS receive loop writes `deps.steering` while the agent is mid-run. The
harness drains it into the turn immediately before building it. Two
properties matter, and only one of them is the plumbing:

- It must be **cleared**. A drain that copies but does not clear re-sends
  the same correction on every subsequent step, so an agent that accepted
  it in step 2 is told again in step 9 — the model never converges.
- It must be **last-one-wins**, not a queue. "Actually, book Wednesday"
  is a correction of "book Tuesday"; replaying both would hand the model
  two instructions and let the stale one win by being read last.

No live model, no key, no network: `_plan_step` is stubbed and the turn
it receives is captured.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import ActionCall, AgentDecision, AgentDeps, AgentTurn
from brotto_orchestrator.agent.harness import AgentHarness
import brotto_orchestrator.agent.harness as harness_mod


_COMPLETE = AgentDecision(
    reasoning="done", thought="done",
    actions=[ActionCall(action="task_complete",
                        action_args={"summary": "ok", "extracted_data": None})],
)


class _EmptyResult:
    """Stands in for pydantic-ai's RunResult; `.usage` is read by the harness."""

    usage = None


def _deps() -> AgentDeps:
    """Deps whose page is unmistakably not a login, so the guardrail
    does not `continue` past the drain and hide a regression."""
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget

    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(
        return_value=[SemanticTarget(ref_id="lnk", tag="a", role="link", name="Inbox")]
    )
    cdp.get_current_url = AsyncMock(return_value="https://example.com/inbox")
    cdp.get_page_text = AsyncMock(return_value="nothing to see")
    cdp.get_page_title = AsyncMock(return_value="Mail")
    cdp.refresh_target_map = AsyncMock()

    async def ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="t", task="summarise my mail", cdp=cdp, ws_send=ws_send)


def _stub_plan_capturing(monkeypatch, seen: list[AgentTurn]) -> None:
    async def _fake_plan(deps, turn, agent):
        seen.append(turn)
        return _COMPLETE, 400_000, _EmptyResult()

    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)


@pytest.mark.asyncio
async def test_steering_lands_in_next_turn_and_is_cleared(monkeypatch):
    """The turn carries the text, and `deps.steering` is empty afterwards."""
    seen: list[AgentTurn] = []
    _stub_plan_capturing(monkeypatch, seen)
    deps = _deps()
    deps.steering = "actually, the Tuesday flight"

    result = await asyncio.wait_for(AgentHarness().run(deps), timeout=10)

    assert result.status == "completed"
    assert [t.steering for t in seen] == ["actually, the Tuesday flight"]
    # The clear is the real assertion. Without it this exact text is
    # replayed every step and the model loops on step 1's correction.
    assert deps.steering == ""


@pytest.mark.asyncio
async def test_steering_is_last_one_wins(monkeypatch):
    """Two steers before one step: the turn carries only the second.

    `deps.steering` is a plain slot, not a queue — the later message is a
    correction of the earlier one, and a queue would have the harness
    hand the model the stale instruction after the fresh one.
    """
    seen: list[AgentTurn] = []
    _stub_plan_capturing(monkeypatch, seen)
    deps = _deps()
    deps.steering = "book the Tuesday flight"
    deps.steering = "actually, book the Wednesday flight"

    result = await asyncio.wait_for(AgentHarness().run(deps), timeout=10)

    assert result.status == "completed"
    assert [t.steering for t in seen] == ["actually, book the Wednesday flight"]
    assert deps.steering == ""


def test_steering_lands_last_in_the_prompt():
    """The block goes immediately before the question, and is absent when empty.

    Position is load-bearing, not cosmetic: the AX tree above runs to thousands
    of tokens and a correction placed earlier gets read past. The second
    assertion is the cheaper half — an empty "User update" heading every step
    would waste tokens and train the model to skim past the real one.
    """
    from brotto_orchestrator.agent.harness import _turn_to_prompt

    def _turn(steering: str) -> AgentTurn:
        return AgentTurn(
            task="book a flight", step_number=1, scratchpad_notes="", scratchpad_entries=[],
            current_url="https://flights.example/", current_page_title="Flights",
            ax_tree="[1] button Search", ax_diff="", step_summaries=[], steering=steering,
        )

    steered = _turn_to_prompt(_turn("no, Tuesday"))
    heading = steered.index("## User update")
    question = steered.index("## What is your next action(s)?")
    assert heading < question
    assert steered.index("no, Tuesday") < question
    # Close enough to be the last thing read before the question.
    assert question - heading < 200

    assert "User update" not in _turn_to_prompt(_turn(""))


@pytest.mark.asyncio
async def test_no_steering_sends_an_empty_turn_field(monkeypatch):
    """A run the user never steers carries `steering == ""`, so the prompt
    splice stays out of the way instead of shipping an empty heading."""
    seen: list[AgentTurn] = []
    _stub_plan_capturing(monkeypatch, seen)
    deps = _deps()

    result = await asyncio.wait_for(AgentHarness().run(deps), timeout=10)

    assert result.status == "completed"
    assert [t.steering for t in seen] == [""]
