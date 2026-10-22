"""The model must not be told that its typing was swallowed.

Run 81061b7e on a spreadsheet: the agent's own notes said it was "navigating
to [typed into a secret field]" and its action line said
`text=[redacted:password]`, and it concluded — out loud — that "the system is
redacting any short text I try to type, treating it as a potential password".
It was not. The text was typed; the harness only refused to write the value
down, because the field (a canvas cell with no accessible name) could not be
told apart from a password box and redaction fails closed.

Two things were wrong, and both are the model reading a marker that no one
had defined:

  1. the markers themselves claimed "password" and "secret field" — a claim
     about a *field*, read by the model as a claim about its *input*; and
  2. nothing in the prompt said what either marker meant, so the model filled
     the gap with the worst reading available.

The fix keeps the guarantee (the value never reaches the record, the sidecar
or the prompt) and makes the marker say what happened. These tests pin the
model-facing half; the privacy half is pinned by
`test_typed_secret_capture.py`, `test_press_key_outcome_redaction.py` and
`test_harness_audit.py`.

One known gap, NOT closed here and NOT introduced here: the audit's record
of the model's own THOUGHT for the step that typed a CREDENTIAL. The thought
is recorded before the step's actions are classified, so a thought that names
the credential it is about to type reaches the document in the clear
(harness.py, the `run_secrets` comment says so). Closing it means classifying
the batch before the approval gates, which reads the DOM before the user has
had time to move the page — a worse direction for a path that fails closed.
The action args and the trace are closed for every typed value, and the
narration is closed for a value that was positively identified as a
credential. A value that merely could not be CLASSIFIED is ordinary data —
the model's own words about it are its own — and the action args still
withhold it.

No live model, no key, no network.
"""

from __future__ import annotations

import asyncio
import json
import re
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import (
    ActionCall, AgentDecision, AgentDeps, TaskResult,
)
from brotto_orchestrator.agent.harness import AgentHarness
from brotto_orchestrator.agent.prompt import SYSTEM_PROMPT, WITHHELD
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
import brotto_orchestrator.agent.harness as harness_mod


# The value the agent typed into the name box. Not a secret — and the harness
# cannot know that, so it withholds it either way.
_VALUE = "A1"


class _EmptyResult:
    usage = None


def _deps() -> AgentDeps:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    # A cell on a canvas: it resolves, and it has no accessible name and no
    # backend node, so nothing can tell it from a password box. Redaction
    # fails closed on the VALUE; it does not claim the run touched a
    # credential (that claim is `pixel_veto`'s, and it is not made here).
    cdp.get_targets = AsyncMock(return_value=[
        SemanticTarget(ref_id="0:1", tag="button", role="button", name="Save"),
        SemanticTarget(ref_id="0:2", tag="input", role="textbox", name="")])
    cdp.get_current_url = AsyncMock(return_value="https://docs.google.com/spreadsheets/d/1")
    cdp.get_page_text = AsyncMock(return_value="nothing to see")
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Sheet1")
    cdp.refresh_target_map = AsyncMock()

    async def ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="t", task="fill the headers", cdp=cdp, ws_send=ws_send)


async def _run_step(monkeypatch):
    """One scripted step that types into the unclassifiable cell.

    Returns (step summary, audit document, the calls that were dispatched).
    """
    dispatched: list[ActionCall] = []

    async def _fake_execute(call, deps, audit=None, turn=None, **_ignored):
        dispatched.append(call)
        if call.action == "task_complete":
            deps.result = TaskResult(status="completed", summary="ok")
        return f"{call.action} done"

    audits = []

    async def _fake_plan(deps, turn, agent, audit=None):
        audits.append(audit)
        deps.result = None
        return AgentDecision(
            reasoning=f"Navigating to {_VALUE} in the name box.",
            thought=f"Navigating to {_VALUE} in the name box.",
            actions=[
                ActionCall(action="type_text",
                           action_args={"ref": "0:2", "text": _VALUE}),
                ActionCall(action="task_complete",
                           action_args={"summary": "ok",
                                                "extracted_data": None}),
            ]), 400_000, _EmptyResult()

    monkeypatch.setattr(harness_mod, "_execute_action", _fake_execute)
    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)

    deps = _deps()
    await asyncio.wait_for(AgentHarness().run(deps), timeout=10)
    return deps.step_summaries[0], audits[0].document(), dispatched


@pytest.mark.asyncio
async def test_the_action_line_the_model_reads_does_not_claim_a_password(monkeypatch):
    """The model reads the action line and believes it.

    "[redacted:password]" said the input was treated as a password, and a
    model that has just been told its typing is being classified as a secret
    stops typing.
    """
    summary, _doc, _dispatched = await _run_step(monkeypatch)

    assert WITHHELD in summary.action_taken
    assert "[redacted:password]" not in summary.action_taken
    assert _VALUE not in summary.action_taken


@pytest.mark.asyncio
async def test_the_narration_the_model_reads_does_not_claim_a_secret_field(monkeypatch):
    """The narration is the model's own thread back to itself.

    "[typed into a secret field]" is a claim about the FIELD, and it was read
    as a claim about the INPUT: the agent decided the system had swallowed
    the text and went looking for a way around it.

    The value itself stays in the narration, because a cell that could not be
    told apart from a password box is not the same as a cell BEING one — a
    cell reference is ordinary data, and the model's own words about it are
    its own (PRIVACY.md: the model's prose survives in full, and only
    credential-shaped fields are masked). The action line still withholds the
    value; that is the per-action `redact` flag.
    """
    summary, _doc, _dispatched = await _run_step(monkeypatch)

    assert "[typed into a secret field]" not in summary.extracted
    assert _VALUE in summary.extracted


@pytest.mark.asyncio
async def test_the_value_still_reaches_the_page(monkeypatch):
    """The prompt now says "the text was typed". That has to be true.

    The record is built from a scrubbed copy of the call; the dispatch gets
    the original. If that ever changes, the prompt is lying and the model is
    back to being told its input was blocked — by us.
    """
    _summary, _doc, dispatched = await _run_step(monkeypatch)

    typed = [c for c in dispatched if c.action == "type_text"]
    assert typed and typed[0].action_args["text"] == _VALUE


@pytest.mark.asyncio
async def test_the_value_never_reaches_the_recorded_action(monkeypatch):
    """The guarantee the marker exists for. Unchanged by any of this.

    The recorded ACTION is the one the marker stands in for: the value is
    replaced by the record's own marker and only its length is kept.
    """
    _summary, doc, _dispatched = await _run_step(monkeypatch)

    recorded = json.dumps(doc["turns"][0]["actions"])
    assert _VALUE not in recorded


def test_the_prompt_explains_the_marker():
    """An undefined token is a design bug: the model cannot reason about one,
    and it fills the gap with the worst reading available."""

    flat = re.sub(r"\s+", " ", SYSTEM_PROMPT)

    assert WITHHELD in flat
    assert "The text was typed." in flat
    # And it says the marker is about the record, not about delivery.
    assert "never as a fact about delivery" in flat
