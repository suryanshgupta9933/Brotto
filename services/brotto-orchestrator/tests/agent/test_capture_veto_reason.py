"""Which claim closed the shutter, and where the operator can see it.

The recorded Google Sheets run (`81061b7e-9274-46f1-9d90-1b894ab08495`, 14
steps) had the model repeat, verbatim, one sentence: "this page holds
something credential-shaped, and a picture cannot be redacted". That is the
sentence the harness serves when the screenshot is refused — and it does not
say *which* claim refused it. There are three: this step's page text
matched a redaction rule, a field that positively identifies as a credential
was typed into (run-wide), or a value was typed into a field the harness
could not classify (a two-step window). The recorded run's own document
could not tell the last two apart: nine redaction rules over fourteen page
digests found nothing, so it was the third, and nothing said so.

So the rule under test: the claim is named — to the model in words, to the
operator in the record and in the log — and a typed value is in none of it.
A gate that fires silently is a gate nobody can debug.

No live model, no key, no network: the runs are scripted and the vision
fallback is stopped by the veto before it can reach a resolver.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.audit import read
from brotto_orchestrator.agent.context import ActionCall, AgentDeps
from brotto_orchestrator.agent.harness import (
    AgentHarness, _AMBIGUOUS_MARKER, _vision_fallback,
)
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
from brotto_orchestrator.model.capabilities import Capabilities
from brotto_orchestrator.testing.scripted_planner import (
    ScriptedPlanner, ScriptedStep,
)

# The two values the runs type. Neither may reach the note, the log or the
# record: naming the claim is only worth anything if the value is not in it.
CELL_VALUE = "Q3 revenue"
PASSWORD = "hunter2"

# A canvas cell: a ref that resolves to no target at all.
_CELL = "9:999"
# A field that positively identifies as a credential.
_SECRET = "0:2"


# ── what the model is told ────────────────────────────────────────────────

def _deps() -> AgentDeps:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[])
    cdp.get_current_url = AsyncMock(return_value="https://example.com/board")
    cdp.get_page_text = AsyncMock(return_value="")
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Board")
    cdp.refresh_target_map = AsyncMock()
    cdp.capture_screenshot = AsyncMock(return_value="/9j/4AAQSkZJRgABAQ==")

    async def ws_send(_msg: dict) -> None:
        return None

    deps = AgentDeps(user_id="t", task="what does this board say?",
                     cdp=cdp, ws_send=ws_send)
    deps._vision_caps = Capabilities(vision=True, source="catalog")
    return deps


@pytest.mark.asyncio
async def test_the_two_pixel_claims_read_differently_to_the_model():
    """The defect, in the model's own words. One sentence served both
    claims, so the model could not tell a credential from an unclassifiable
    value — and it repeated that one sentence for fourteen steps."""
    ambiguous = await _vision_fallback(_deps(), [], "",
                                        run_secrets=[_AMBIGUOUS_MARKER])
    latched = await _vision_fallback(_deps(), [], "", run_secrets=[PASSWORD])
    assert ambiguous.image == "" and latched.image == ""
    assert ambiguous.note != latched.note


@pytest.mark.asyncio
async def test_the_ambiguous_claim_is_not_reported_to_the_model_as_a_credential():
    """The recorded run's sentence was false. The page held a spreadsheet;
    what closed the shutter was a value the harness could not classify, and
    the note has to say that rather than claim a credential is on the page."""
    out = await _vision_fallback(_deps(), [], "",
                                 run_secrets=[_AMBIGUOUS_MARKER])
    assert "credential-shaped" not in out.note
    assert "classified" in out.note
    # The other claim still says what it is, so the two are not merely
    # different ways of saying nothing.
    latched = await _vision_fallback(_deps(), [], "", run_secrets=[PASSWORD])
    assert "credential" in latched.note


@pytest.mark.asyncio
async def test_a_page_redaction_keeps_its_own_reason():
    """Unchanged: the page's own redaction is a third claim, and the model
    can already see `[redacted:card]` in the text above it."""
    out = await _vision_fallback(_deps(), [], "", redactions={"card": 1})
    assert "credential-shaped" in out.note


@pytest.mark.asyncio
async def test_the_model_is_never_told_a_typed_value():
    """The note is the model's channel and the value is the thing the veto
    exists for. It must not be in the note."""
    out = await _vision_fallback(_deps(), [], "", run_secrets=[PASSWORD])
    assert PASSWORD not in out.note


# ── what the operator is told ─────────────────────────────────────────────

@pytest.fixture
def sessions_dir(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    return tmp_path


def _cdp(targets) -> MagicMock:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=list(targets))
    cdp.get_current_url = AsyncMock(
        return_value="https://docs.google.com/spreadsheets/d/1")
    cdp.get_page_text = AsyncMock(return_value="")
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Sheet1")
    cdp.refresh_target_map = AsyncMock()
    # A relay that cannot answer returns {} by contract — the case
    # `_redact_if_secret` has to survive.
    cdp.get_attributes = AsyncMock(return_value={})
    cdp.focus_ref = AsyncMock(return_value="ok")
    cdp.clear_ref = AsyncMock(return_value="ok")
    cdp.type_text_to_ref = AsyncMock(return_value="ok")
    cdp.click_ref = AsyncMock(return_value="clicked")
    cdp.capture_screenshot = AsyncMock(return_value="/9j/4AAQSkZJRgABAQ==")
    return cdp


def _run(targets, typed_ref: str, text: str, session_id: str) -> None:
    """One task: type a value, then finish. The veto lands on the step
    AFTER the keystroke, which is where the shutter is closed."""
    planner = ScriptedPlanner(
        [ScriptedStep(thought="type it", actions=[
            ActionCall(action="type_text",
                       action_args={"ref": typed_ref, "text": text})]),
         ScriptedStep(thought="done", actions=[
            ActionCall(action="task_complete",
                       action_args={"summary": "ok", "extracted_data": None})])],
        on_exhausted="task_complete")

    async def ws_send(_msg: dict) -> None:
        return None

    deps = AgentDeps(user_id="t", task="fill in the spreadsheet",
                     cdp=_cdp(targets), ws_send=ws_send,
                     scripted_planner=planner)
    deps.task_id = session_id
    asyncio.new_event_loop().run_until_complete(AgentHarness().run(deps))


def _veto_events(doc: dict) -> list[dict]:
    return [e for e in doc.get("policy_events", [])
            if e.get("kind") == "pixel_veto"]


# A canvas page: a toolbar button and nothing that is a cell.
_SHEET = [SemanticTarget(ref_id="0:1", tag="button", role="button", name="Save")]
# A login form: a field whose name says password.
_LOGIN = _SHEET + [SemanticTarget(ref_id=_SECRET, tag="input", role="textbox",
                                  name="Password")]


def test_the_ambiguous_claim_is_recorded_in_the_audit_document(sessions_dir):
    """The record has to name the claim. A document that says only "the
    screenshot was refused" is the defect this file is about."""
    _run(_SHEET, _CELL, CELL_VALUE, "ambiguous")
    doc = read("ambiguous", dir=sessions_dir)
    events = _veto_events(doc)
    assert events, "the run recorded no veto at all"
    assert any("ambiguous_write" in e["decision"] for e in events), events


def test_a_latched_credential_is_recorded_as_a_different_claim(sessions_dir):
    """Positive evidence and absence of evidence are different facts, and
    the record has to keep them apart."""
    _run(_LOGIN, _SECRET, PASSWORD, "latched")
    doc = read("latched", dir=sessions_dir)
    events = _veto_events(doc)
    assert any("latched_secret" in e["decision"] for e in events), events
    assert not any("ambiguous_write" in e["decision"] for e in events), events


def test_no_typed_value_reaches_the_record(sessions_dir):
    """The one that matters. The claim is named; the value is not in it."""
    _run(_SHEET, _CELL, CELL_VALUE, "no-value")
    doc = read("no-value", dir=sessions_dir)
    assert CELL_VALUE not in json.dumps(doc)


def test_the_claim_is_logged(sessions_dir, caplog):
    """The log is the operator's console and it is where a run is read
    while it is still running."""
    with caplog.at_level(logging.INFO):
        _run(_SHEET, _CELL, CELL_VALUE, "logged")
    logged = " ".join(r.getMessage() for r in caplog.records)
    assert "ambiguous_write" in logged
    assert CELL_VALUE not in logged
