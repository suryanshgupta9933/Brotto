"""A secret typed into a secret field must not survive into what the model
reads back next step.

The loop breaks a batch early — on a terminal action, on `ask_human`, on
`scroll`, once `deps.result` is set — and `typed_secrets` used to be filled as
a side effect of *executing* the batch. So a `type_text` into a secret field
placed after that break was executed into the page and never recorded: the
value went back into the next prompt and onto disk. A control whose coverage
depends on execution order fails open, which is the wrong direction for a
secret-scrubbing path. Classification now happens before execution.

No live model, no key, no network.
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import (
    ActionCall, AgentDecision, AgentDeps, TaskResult,
)
from brotto_orchestrator.agent.harness import AgentHarness
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
import brotto_orchestrator.agent.harness as harness_mod


_SECRET = "hunter2"


class _EmptyResult:
    usage = None


def _deps() -> AgentDeps:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    # 0:2 is the secret field the type_text actions below aim at. It used to
    # be unresolvable, which _redact_if_secret treated as a secret verdict —
    # absence of evidence read as evidence, and a run that typed into a
    # synthetic-ref canvas app latched run_secrets on every cell. The field is
    # now a real target whose NAME says password, which is the actual case.
    cdp.get_targets = AsyncMock(return_value=[
        SemanticTarget(ref_id="0:1", tag="button", role="button", name="Save"),
        SemanticTarget(ref_id="0:2", tag="input", role="textbox",
                       name="Password")])
    cdp.get_current_url = AsyncMock(return_value="https://example.com/account")
    cdp.get_page_text = AsyncMock(return_value="nothing to see")
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Account")
    cdp.refresh_target_map = AsyncMock()

    async def ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="t", task="sign in", cdp=cdp, ws_send=ws_send)


async def _run_batch(monkeypatch, actions: list[ActionCall],
                     thought: str):
    """Run one step with a scripted batch; return the stored step summaries.

    Also returns the audit document the run left behind: the narration scrub
    and the audit write are separate sinks, so one passing says nothing about
    the other.
    """
    calls: list[int] = []

    async def _fake_execute(call, deps, audit=None, turn=None, **_ignored):
        if call.action == "task_complete":
            deps.result = TaskResult(status="completed", summary="ok")
        return f"{call.action} done"

    audit_doc = []

    async def _fake_plan(deps, turn, agent, audit=None):
        audit_doc.append(audit)
        calls.append(1)
        deps.result = None
        if len(calls) > 1:
            return AgentDecision(
                reasoning="done", thought="done",
                actions=[ActionCall(action="task_complete",
                                    action_args={"summary": "ok",
                                                 "extracted_data": None})],
            ), 400_000, _EmptyResult()
        return AgentDecision(reasoning=thought, thought=thought,
                             actions=actions), 400_000, _EmptyResult()

    monkeypatch.setattr(harness_mod, "_execute_action", _fake_execute)
    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)

    deps = _deps()
    await asyncio.wait_for(AgentHarness().run(deps), timeout=10)
    return deps.step_summaries, (audit_doc[0] if audit_doc else None)


@pytest.mark.asyncio
async def test_a_secret_typed_after_a_scroll_is_still_scrubbed(monkeypatch):
    """The bug. The scroll break stops the batch, so the type_text after it
    executed but was never collected — and the narration kept the value."""
    summaries, _audit = await _run_batch(monkeypatch, [
        ActionCall(action="scroll", action_args={"direction": "up", "amount": 300}),
        ActionCall(action="type_text", action_args={"ref": "0:2", "text": _SECRET}),
        ActionCall(action="task_complete",
                   action_args={"summary": "ok", "extracted_data": None}),
    ], f"Typed {_SECRET} into the password field after scrolling.")

    assert _SECRET not in summaries[0].extracted
    assert "[typed into a secret field]" in summaries[0].extracted


@pytest.mark.asyncio
async def test_a_secret_typed_after_a_terminal_action_is_still_scrubbed(monkeypatch):
    """Same fail-open through the other break."""
    summaries, _audit = await _run_batch(monkeypatch, [
        ActionCall(action="task_complete",
                   action_args={"summary": "ok", "extracted_data": None}),
        ActionCall(action="type_text", action_args={"ref": "0:2", "text": _SECRET}),
    ], f"Filled the form with {_SECRET}.")

    assert _SECRET not in summaries[0].extracted


@pytest.mark.asyncio
async def test_a_legitimate_search_query_is_not_over_scrubbed(monkeypatch):
    """The cost of the fix must be paid somewhere: a search box is not a
    secret field, and the model's own query is its thread back to itself."""

    async def _fake_execute(call, deps, audit=None, turn=None, **_ignored):
        if call.action == "task_complete":
            deps.result = TaskResult(status="completed", summary="ok")
        return f"{call.action} done"

    async def _fake_plan(deps, turn, agent, audit=None):
        deps.result = None
        return AgentDecision(
            reasoning="s", thought="Searching for blue widget in the search box",
            actions=[
                ActionCall(action="type_text",
                           action_args={"ref": "0:2", "text": "blue widget"}),
                ActionCall(action="task_complete",
                           action_args={"summary": "ok", "extracted_data": None}),
            ],
        ), 400_000, _EmptyResult()

    monkeypatch.setattr(harness_mod, "_execute_action", _fake_execute)
    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)
    # The search box is not a password box.
    monkeypatch.setattr(harness_mod, "_redact_if_secret",
                        AsyncMock(return_value=(False, False)))

    deps = _deps()
    await asyncio.wait_for(AgentHarness().run(deps), timeout=10)

    assert "blue widget" in deps.step_summaries[0].extracted

@pytest.mark.asyncio
async def test_a_secret_quoted_back_later_never_reaches_the_audit_document(monkeypatch):
    """The narration scrub covered one sink, and only the step that typed.

    `record_model` writes the thought *before* the step's actions execute, so
    it cannot see this step's own typed secrets — and `redact_text` has no
    rule for an arbitrary password. A step that reads the password back off
    the page and names it is the realistic case, and it is the audit document
    that keeps it: a value redacted out of the prompt and left on disk is not
    redacted.
    """
    calls: list[int] = []

    async def _fake_execute(call, deps, audit=None, turn=None, **_ignored):
        if call.action == "task_complete":
            deps.result = TaskResult(status="completed", summary="ok")
        return f"{call.action} done"

    audit_doc: list = []

    async def _fake_plan(deps, turn, agent, audit=None):
        audit_doc.append(audit)
        calls.append(1)
        deps.result = None
        if len(calls) == 1:
            return AgentDecision(
                reasoning="fill the password", thought="Filling the form.",
                actions=[
                    ActionCall(action="type_text",
                               action_args={"ref": "0:2", "text": _SECRET}),
                ],
            ), 400_000, _EmptyResult()
        return AgentDecision(
            reasoning="signed in",
            thought=f"Signing in with the password {_SECRET} worked.",
            actions=[ActionCall(action="task_complete",
                                action_args={"summary": "ok", "extracted_data": None})],
        ), 400_000, _EmptyResult()

    monkeypatch.setattr(harness_mod, "_execute_action", _fake_execute)
    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)

    deps = _deps()
    await asyncio.wait_for(AgentHarness().run(deps), timeout=10)

    assert audit_doc, "the run wrote no audit document to check"
    written = json.dumps([a.document() for a in audit_doc])
    assert _SECRET not in written, "the typed secret survived into the audit document"
