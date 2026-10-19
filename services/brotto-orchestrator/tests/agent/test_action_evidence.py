"""What the audit says an action aimed at, and what actually happened.

Three properties, and the middle one is the one that matters:

- `target` is the ref or the point, not the model's sentence about it.
- `changed` is the extension's pixel delta and **never** anything the model
  said. D5: a model claiming "I clicked submit" is not evidence about a
  page; that claim already has a home, which is `outcome`.
- A `press_key` whose keystroke would land somewhere the step did not start
  focused on is refused. `press_key` takes no ref, so it types into
  `document.activeElement` — and the user is free to click their own email
  draft while the model is thinking. Irreversible, and every layer above it
  recorded `ok: true`.

The last two are guards, and a guard with no test asserting it is the same as
no guard, so the direction of each is pinned: the agent's OWN click-then-Enter
must not trip the focus guard, and a model claim must not reach `changed`.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import (
    ActionCall, AgentDecision, AgentDeps, TaskResult,
)
from brotto_orchestrator.agent.harness import AgentHarness, _action_target
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
import brotto_orchestrator.agent.harness as harness_mod


class _EmptyResult:
    usage = None


async def _run_one_step(monkeypatch, actions: list[ActionCall], *,
                        focus: list | None = None,
                        canvas_changed: bool | None = None,
                        refused: set[str] | None = None,
                        plan_moves_focus: str | None = None) -> tuple[list[dict], MagicMock]:
    """Run one step. Returns (recorded actions, the relay mock).

    `focus` is consumed one entry per `focus_id()` call — the capture at the
    top of the step, then one per guarded press_key.

    `refused` names actions the page rejects, which come back with the
    `_EXEC_FAILURE` prefix both relays emit and dispatch nothing.
    `plan_moves_focus` moves focus *during* `_plan_step` — after the top of
    the step capture, before any action — which is the window a user clicks
    into while the model thinks.
    """
    docs: list = []
    calls: list[int] = []
    refused = refused or set()
    # One list, shared with the relay mock: `plan_moves_focus` rewrites it
    # from inside `_fake_plan` and the mock reads from the same object.
    plan = list(focus) if focus is not None else None

    async def _fake_execute(call, deps, audit=None, turn=None, **_ignored):
        if call.action == "task_complete":
            deps.result = TaskResult(status="completed", summary="ok")
        if call.action in refused:
            return (f"Error executing {call.action}: the page refused it — "
                    "nothing was dispatched")
        # The model's own account of what it did. Deliberately assertive:
        # nothing the model says may reach `changed`.
        return f"{call.action} done — the page updated and the submit landed"

    async def _fake_plan(deps, turn, agent, audit=None):
        docs.append(audit)
        calls.append(1)
        deps.result = None
        if plan_moves_focus is not None and plan is not None:
            plan[0] = plan_moves_focus
        deps.canvas_changed = canvas_changed
        if len(calls) > 1:
            return AgentDecision(
                reasoning="done", thought="done",
                actions=[ActionCall(action="task_complete",
                                    action_args={"summary": "ok",
                                                 "extracted_data": None})],
            ), 400_000, _EmptyResult()
        return AgentDecision(reasoning="r", thought="t", actions=actions), 400_000, _EmptyResult()

    monkeypatch.setattr(harness_mod, "_execute_action", _fake_execute)
    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)

    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[
        SemanticTarget(ref_id="0:1", tag="input", role="textbox", name="Search")])
    cdp.get_current_url = AsyncMock(return_value="https://example.com/")
    cdp.get_page_text = AsyncMock(return_value="")
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Home")
    cdp.refresh_target_map = AsyncMock()
    cdp.press_key = AsyncMock(return_value="ok")
    if focus is None:
        cdp.focus_id = AsyncMock(return_value="input#q")
    else:
        cdp.focus_id = AsyncMock(side_effect=plan)

    async def ws_send(_msg: dict) -> None:
        return None

    deps = AgentDeps(user_id="t", task="search for brotto", cdp=cdp,
                     ws_send=ws_send)
    await asyncio.wait_for(AgentHarness().run(deps), timeout=10)

    recorded = [a for t in docs[0]._doc.get("turns", [])
                for a in t.get("actions", [])]
    return recorded, cdp


def _one(recorded: list[dict], action: str) -> dict:
    matching = [a for a in recorded if a["action"] == action]
    assert matching, f"{action} was not recorded at all: {recorded}"
    return matching[0]


# ── target ──────────────────────────────────────────────────────────

def test_the_ref_an_action_aimed_at_is_recorded():
    call = ActionCall(action="click", action_args={"ref": "0:13829"})
    assert _action_target(call) == "0:13829"


def test_a_coordinate_action_records_the_point():
    call = ActionCall(action="click_xy", action_args={"x": 412, "y": 88})
    assert _action_target(call) == "412,88"


def test_an_action_with_nothing_to_point_at_records_no_target():
    assert _action_target(ActionCall(action="press_key",
                                     action_args={"key": "Enter"})) is None


@pytest.mark.asyncio
async def test_a_ref_reaches_the_document(monkeypatch):
    recorded, _ = await _run_one_step(monkeypatch, [
        ActionCall(action="click", action_args={"ref": "0:13829"}),
        ActionCall(action="task_complete",
                   action_args={"summary": "ok", "extracted_data": None}),
    ])
    assert _one(recorded, "click")["target"] == "0:13829"


# ── changed ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_changed_is_the_page_delta(monkeypatch):
    recorded, _ = await _run_one_step(
        monkeypatch,
        [ActionCall(action="click", action_args={"ref": "0:1"}),
         ActionCall(action="task_complete",
                    action_args={"summary": "ok", "extracted_data": None})],
        canvas_changed=False,
    )
    assert _one(recorded, "click")["changed"] is False


@pytest.mark.asyncio
async def test_a_model_claiming_the_page_changed_does_not_land_in_changed(monkeypatch):
    # The fake executor's outcome asserts the page updated on every action.
    # D5: that sentence is not evidence and must not become `changed`.
    recorded, _ = await _run_one_step(
        monkeypatch,
        [ActionCall(action="click", action_args={"ref": "0:1"}),
         ActionCall(action="task_complete",
                    action_args={"summary": "ok", "extracted_data": None})],
        canvas_changed=None,
    )
    entry = _one(recorded, "click")
    assert entry["changed"] is None, (
        "an unmeasured page was recorded as having changed because the model "
        "said so"
    )
    assert "updated" in entry["outcome"], (
        "the claim belongs in the outcome, which is where the model was told"
    )


# ── the press_key focus guard ───────────────────────────────────────

@pytest.mark.asyncio
async def test_a_key_pressed_after_the_user_moved_focus_is_refused(monkeypatch):
    # Capture reads the search box; by the time the key is dispatched the
    # user has clicked their own draft.
    recorded, cdp = await _run_one_step(
        monkeypatch,
        [ActionCall(action="press_key", action_args={"key": "Enter"}),
         ActionCall(action="task_complete",
                    action_args={"summary": "ok", "extracted_data": None})],
        focus=["input#q", "textarea#draft"],
    )
    cdp.press_key.assert_not_called()
    entry = _one(recorded, "press_key")
    assert entry["ok"] is False
    assert "focus has moved" in entry["outcome"]


@pytest.mark.asyncio
async def test_the_agents_own_click_then_enter_is_not_refused(monkeypatch):
    # The direction that matters: the agent focused the field itself, so the
    # focus that changed is its own doing and the keystroke must go through.
    recorded, cdp = await _run_one_step(
        monkeypatch,
        [ActionCall(action="click", action_args={"ref": "0:1"}),
         ActionCall(action="press_key", action_args={"key": "Enter"}),
         ActionCall(action="task_complete",
                    action_args={"summary": "ok", "extracted_data": None})],
        focus=["body", "input#q"],
    )
    entry = _one(recorded, "press_key")
    assert entry["ok"] is True, entry["outcome"]
    assert "focus" not in entry["outcome"]


@pytest.mark.asyncio
async def test_a_press_key_whose_focus_cannot_be_read_is_refused(monkeypatch):
    recorded, cdp = await _run_one_step(
        monkeypatch,
        [ActionCall(action="press_key", action_args={"key": "Enter"}),
         ActionCall(action="task_complete",
                    action_args={"summary": "ok", "extracted_data": None})],
        focus=[None, None],
    )
    cdp.press_key.assert_not_called()
    assert _one(recorded, "press_key")["ok"] is False


@pytest.mark.asyncio
async def test_an_unchanged_focus_presses_the_key(monkeypatch):
    recorded, _ = await _run_one_step(
        monkeypatch,
        [ActionCall(action="press_key", action_args={"key": "Enter"}),
         ActionCall(action="task_complete",
                    action_args={"summary": "ok", "extracted_data": None})],
        focus=["input#q", "input#q"],
    )
    assert _one(recorded, "press_key")["ok"] is True


@pytest.mark.asyncio
async def test_a_refused_click_does_not_disarm_the_focus_guard(monkeypatch):
    # The fail-open case. A click the hit-test refused dispatched nothing, so
    # the focus that changed is the *user's*, and the Enter behind it must be
    # refused rather than landing in their draft.
    recorded, cdp = await _run_one_step(
        monkeypatch,
        [ActionCall(action="click", action_args={"ref": "0:1"}),
         ActionCall(action="press_key", action_args={"key": "Enter"}),
         ActionCall(action="task_complete",
                    action_args={"summary": "ok", "extracted_data": None})],
        focus=["body", "textarea#draft"],
        refused={"click"},
    )
    cdp.press_key.assert_not_called()
    assert _one(recorded, "press_key")["ok"] is False


@pytest.mark.asyncio
async def test_focus_moving_during_the_plan_is_caught(monkeypatch):
    # The baseline is read at the top of the step, so the ~30s the model
    # spends generating is not a hole: a focus move inside that window —
    # the user clicking their own draft while the agent thinks — is caught.
    # The ordering matters here. With the baseline read *after* the plan it
    # would already record the user's element and see nothing move, so the
    # first read is the pre-plan one and the second is what the key meets.
    recorded, cdp = await _run_one_step(
        monkeypatch,
        [ActionCall(action="press_key", action_args={"key": "Enter"}),
         ActionCall(action="task_complete",
                    action_args={"summary": "ok", "extracted_data": None})],
        focus=["body", "textarea#draft"],
        plan_moves_focus="textarea#draft",
    )
    cdp.press_key.assert_not_called()
    assert _one(recorded, "press_key")["ok"] is False


@pytest.mark.asyncio
async def test_focus_is_read_on_every_step_whether_or_not_it_presses(monkeypatch):
    # Unconditional by design: a baseline captured on only some steps is a
    # guard that exists on only some steps, and the steps it would skip are
    # the ones that press a key.
    _, cdp = await _run_one_step(
        monkeypatch,
        [ActionCall(action="click", action_args={"ref": "0:1"}),
         ActionCall(action="task_complete",
                    action_args={"summary": "ok", "extracted_data": None})],
        focus=["body"],
    )
    assert cdp.focus_id.call_count >= 1