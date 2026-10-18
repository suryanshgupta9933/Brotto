"""A character typed with press_key must not reach the audit document.

Secret redaction was gated on `type_text` alone, in both places that matter:
the classification before the batch runs, and `_scrubbed` on the way to the
record. Advertising press_key as a first-class action made a real fail-open
prominent — `press_key("a")` into a focused password box typed a credential
and wrote it to disk. press_key is a typing action wherever type_text is one.

The other half of the test matters as much: `press_key Enter` — a named key,
no character — must NOT be over-redacted, or every search submission on the
run breaks.
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import (
    ActionCall, AgentDecision, AgentDeps, TaskResult,
)
from brotto_orchestrator.agent.harness import AgentHarness, REDACTED
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
import brotto_orchestrator.agent.harness as harness_mod


class _EmptyResult:
    usage = None


async def _recorded(monkeypatch, actions: list[ActionCall]) -> list[dict]:
    """Run one step; return the actions the audit document recorded."""
    docs: list = []
    calls: list[int] = []

    async def _fake_execute(call, deps, audit=None, turn=None, **_ignored):
        if call.action == "task_complete":
            deps.result = TaskResult(status="completed", summary="ok")
        return f"{call.action} done"

    async def _fake_plan(deps, turn, agent, audit=None):
        docs.append(audit)
        calls.append(1)
        deps.result = None
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
        SemanticTarget(ref_id="0:1", tag="input", role="textbox", name="Card PIN")])
    cdp.get_current_url = AsyncMock(return_value="https://example.com/account")
    cdp.get_page_text = AsyncMock(return_value="")
    cdp.get_page_title = AsyncMock(return_value="Account")
    cdp.refresh_target_map = AsyncMock()

    async def ws_send(_msg: dict) -> None:
        return None

    deps = AgentDeps(user_id="t", task="check the balance", cdp=cdp, ws_send=ws_send)
    await asyncio.wait_for(AgentHarness().run(deps), timeout=10)

    return [a for t in docs[0]._doc.get("turns", []) for a in t.get("actions", [])]


@pytest.mark.asyncio
async def test_a_character_pressed_into_a_password_field_is_not_recorded(monkeypatch):
    actions = await _recorded(monkeypatch, [
        ActionCall(action="press_key", action_args={"key": "q", "modifiers": 0}),
        ActionCall(action="task_complete",
                   action_args={"summary": "ok", "extracted_data": None}),
    ])
    pressed = [a for a in actions if a["action"] == "press_key"]
    assert pressed, "the press_key was not recorded at all"
    assert pressed[0]["args"]["key"] == REDACTED
    assert "q" not in json.dumps(actions)


@pytest.mark.asyncio
async def test_a_named_key_is_not_over_redacted(monkeypatch):
    actions = await _recorded(monkeypatch, [
        ActionCall(action="press_key", action_args={"key": "Enter", "modifiers": 0}),
        ActionCall(action="task_complete",
                   action_args={"summary": "ok", "extracted_data": None}),
    ])
    pressed = [a for a in actions if a["action"] == "press_key"]
    assert pressed[0]["args"]["key"] == "Enter", (
        "masking a named key breaks every search submission"
    )
    assert pressed[0].get("redacted") is not True