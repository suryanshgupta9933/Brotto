"""The ledger and the plan survive a resume.

The document is the record a resumed run rebuilds them from, so a run that
writes and then reconnects must come back with what it wrote — and a run
that reconnects onto a document written by an older server must not be
refused for it.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent import audit as audit_mod
from brotto_orchestrator.agent.audit import AuditTrail, read
from brotto_orchestrator.agent.closed_loop import CONFIRMED, MISMATCH, UNKNOWN
from brotto_orchestrator.agent.context import ActionCall, AgentDeps
import brotto_orchestrator.agent.harness as harness_mod


# ── fakes ───────────────────────────────────────────────────────────────────

def _cdp(*, grid_value: str = "name") -> MagicMock:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[])
    cdp.get_current_url = AsyncMock(
        return_value="https://docs.google.com/spreadsheets/d/abc/edit")
    cdp.get_page_text = AsyncMock(return_value="page")
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Sheet")
    cdp.refresh_target_map = AsyncMock()
    cdp.grid_op = AsyncMock(return_value={
        "ok": True, "address": "A1", "value": grid_value, "state": "ok",
        "mechanism": "content-box", "error": "",
    })
    return cdp


def _deps(cdp: MagicMock) -> AgentDeps:
    return AgentDeps(user_id="t", task="write a name", cdp=cdp,
                     ws_send=AsyncMock())


async def _run_one(deps: AgentDeps, action: str, args: dict, audit=None) -> str:
    return await harness_mod._execute_action(
        ActionCall(action=action, action_args=args), deps, audit=audit, turn=1)


def _done_script():
    from brotto_orchestrator.testing.scripted_planner import (
        ScriptedPlanner, ScriptedStep,
    )
    return ScriptedPlanner(
        [ScriptedStep(thought="done", actions=[ActionCall(
            action="task_complete", action_args={"summary": "ok"})])],
        on_exhausted="task_complete",
    )


def _run_harness(deps: AgentDeps) -> "object":
    async def _go():
        return await harness_mod.AgentHarness().run(deps, resume=True)
    return asyncio.new_event_loop().run_until_complete(_go())


@pytest.fixture
def sessions_dir(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    return tmp_path


def _doc(session_id: str, *, schema_version: int = 4, tasks=None,
         turns=None) -> dict:
    return {
        "schema_version": schema_version,
        "session_id": session_id,
        "status": "running",
        "tasks": tasks if tasks is not None else [{
            "index": 0, "goal": "write a name", "status": "running",
            "started_at": "2026-01-01T00:00:00.000+00:00", "ended_at": None,
            "steps": 0,
        }],
        "turns": turns if turns is not None else [{
            "step": 0, "ended_at": "2026-01-01T00:00:00.000+00:00",
            "observation": {"url": "https://docs.google.com/spreadsheets/d/abc/edit"},
            "actions": [{"action": "navigate", "outcome": "Navigated"}],
        }],
        "messages": [], "errors": [], "policy_events": [],
    }


def _write_doc(sessions_dir: Path, session_id: str, doc: dict) -> None:
    (sessions_dir / f"{session_id}.json").write_text(json.dumps(doc))


# ── 1. the write is persisted ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_write_is_persisted_into_the_document(tmp_path):
    """The document is what a resumed run rebuilds the ledger from, so the
    ledger has to be ON it, not only in memory."""
    trail = AuditTrail(session_id="s1", dir=tmp_path)
    trail.begin_task("write a name")
    deps = _deps(_cdp())
    await _run_one(deps, "write_text",
                   {"target": {"cell": "A1"}, "value": "name"}, audit=trail)
    doc = json.loads((tmp_path / "s1.json").read_text())
    assert doc["tasks"][0]["ledger"][0]["target_key"] == "cell:A1"
    assert doc["tasks"][0]["ledger"][0]["confirmed"] is True


@pytest.mark.asyncio
async def test_the_plan_is_persisted_into_the_document(tmp_path):
    trail = AuditTrail(session_id="s1", dir=tmp_path)
    trail.begin_task("write a name")
    deps = _deps(_cdp())
    await _run_one(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"},
         "value": "name"},
    ]}, audit=trail)
    doc = json.loads((tmp_path / "s1.json").read_text())
    assert doc["tasks"][0]["plan"][0]["target_key"] == "cell:A1"
    assert doc["tasks"][0]["plan"][0]["status"] == "pending"


@pytest.mark.asyncio
async def test_the_document_holds_the_current_state_not_a_history(tmp_path):
    """The ledger is replaced on disk, not appended to: a resumed run reads
    it as the state of the run, and an append-only copy would replay every
    earlier verdict."""
    trail = AuditTrail(session_id="s1", dir=tmp_path)
    trail.begin_task("write a name")
    deps = _deps(_cdp())
    await _run_one(deps, "write_text",
                   {"target": {"cell": "A1"}, "value": "name"}, audit=trail)
    deps.cdp.grid_op = AsyncMock(return_value={
        "ok": True, "address": "A1", "value": "age", "state": "ok",
        "mechanism": "content-box", "error": ""})
    await _run_one(deps, "write_text",
                   {"target": {"cell": "A1"}, "value": "age"}, audit=trail)
    doc = json.loads((tmp_path / "s1.json").read_text())
    assert len(doc["tasks"][0]["ledger"]) == 2
    last = doc["tasks"][0]["ledger"][-1]
    # The VALUE does not go to disk — a cell's contents are user data. What
    # goes to disk is the verdict and the target, plus how long the value was.
    assert audit_mod.is_redacted_value(last["intended"])
    assert last["intended_chars"] == 3
    assert last["target_key"] == "cell:A1"


# ── 2. the resume rehydrates ────────────────────────────────────────────────

def _crashed_run_with_a_ledger(session_id: str, sessions_dir: Path) -> None:
    """A document as a socket death leaves it: a task with a ledger and a
    plan, and one finished turn."""
    t = AuditTrail(session_id, dir=sessions_dir)
    t.begin_task("write a name")
    t.record_ledger(step=1, attempts=[{
        "target_key": "cell:A1", "intended": "name", "observed": "age",
        "confirmed": False, "mechanism": "content-box", "step": 1,
    }])
    t.record_plan(items=[{
        "id": 1, "intent": "write A1 = name", "target_key": "cell:A1",
        "value": "name", "status": "failed",
    }])
    turn = t.begin_turn(step=0, url="https://example.com", page_title="Example",
                        ax_targets=1, ax_chars=1, ax_diff_chars=0,
                        page_text_chars=0)
    t.record_action(turn, action="navigate", args={}, outcome="Navigated",
                    ok=True, redacted=False, duration_ms=1)
    t.end_turn(turn, timings={})
    t.close()


def test_a_resumed_run_comes_back_with_the_ledger_and_the_plan(sessions_dir):
    """Without them the repeat block and the completion pass silently
    switch off, and the run is back to lying."""
    _crashed_run_with_a_ledger("r1", sessions_dir)
    deps = _deps(_cdp())
    deps.task_id = "r1"
    deps.scripted_planner = _done_script()
    _run_harness(deps)
    assert len(deps.ledger) == 1
    assert deps.ledger[0].target_key == "cell:A1"
    assert deps.ledger[0].confirmed is False
    assert len(deps.plan) == 1
    assert deps.plan[0].target_key == "cell:A1"


def test_a_resumed_run_counts_its_blocked_writes_again(sessions_dir):
    """The bound on blocked writes is per run, and a resumed run that lost
    the count would spend another three."""
    _crashed_run_with_a_ledger("r2", sessions_dir)
    deps = _deps(_cdp())
    deps.task_id = "r2"
    deps.scripted_planner = _done_script()
    _run_harness(deps)
    assert deps.blocked_attempts == 1


def test_a_new_task_starts_with_an_empty_ledger(sessions_dir):
    """The rehydration belongs to the RESUME path only: a new task's writes
    are not the previous task's history."""
    _crashed_run_with_a_ledger("r3", sessions_dir)
    deps = _deps(_cdp())
    deps.scripted_planner = _done_script()
    deps.task_id = "r3-new"
    asyncio.new_event_loop().run_until_complete(
        harness_mod.AgentHarness().run(deps, resume=False))
    assert deps.ledger == []
    assert deps.plan == []


# ── 3. the schema gate ──────────────────────────────────────────────────────

def test_a_document_from_schema_three_still_resumes(sessions_dir):
    """The schema-4 change is ADDITIVE. Refusing an older document would
    break every run that exists today."""
    _write_doc(sessions_dir, "s3", _doc("s3", schema_version=3))
    deps = _deps(_cdp())
    deps.task_id = "s3"
    deps.scripted_planner = _done_script()
    result = _run_harness(deps)
    assert result.status == "completed"
    # And the document this server now writes is the current schema.
    assert read("s3", dir=sessions_dir)["schema_version"] == 4


def test_a_document_from_a_future_schema_is_refused(sessions_dir):
    _write_doc(sessions_dir, "s99", _doc("s99", schema_version=99))
    deps = _deps(_cdp())
    deps.task_id = "s99"
    deps.scripted_planner = _done_script()
    result = _run_harness(deps)
    assert result.failure_reason == "task_refused"
    assert "99" in result.summary


# ── 4. a redacted value is unknown, not a mismatch ──────────────────────────

@pytest.mark.asyncio
async def test_a_redacted_plan_value_is_unknown_not_a_mismatch(tmp_path):
    """A cell value that looked like a secret was redacted on the way to
    disk. Comparing the redacted value against the real cell would accuse
    the page of holding the wrong value, and comparing it loosely would
    claim a confirmation nobody can prove."""
    trail = AuditTrail(session_id="s1", dir=tmp_path)
    trail.begin_task("write a card number")
    deps = _deps(_cdp(grid_value="4111111111111111"))
    await _run_one(deps, "set_plan", {"items": [
        {"intent": "write A1 = card", "target": {"cell": "A1"},
         "value": "4111111111111111"},
    ]}, audit=trail)
    doc = json.loads((tmp_path / "s1.json").read_text())
    item = audit_mod.read_plan(doc)[0]
    assert audit_mod.is_redacted_value(item.value)

    deps.plan = [item]
    verdicts = await harness_mod._verify_plan(deps)
    assert verdicts[0][1] == UNKNOWN
    assert verdicts[0][1] != MISMATCH
    assert verdicts[0][1] != CONFIRMED


@pytest.mark.asyncio
async def test_a_live_plan_value_still_verifies_against_the_cell(tmp_path):
    """The value is masked ON DISK, not in the run: a plan the model is
    working with right now still compares against the cell, which is the
    whole point of the completion pass."""
    trail = AuditTrail(session_id="s2", dir=tmp_path)
    trail.begin_task("write a name")
    deps = _deps(_cdp(grid_value="name"))
    await _run_one(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]}, audit=trail)
    verdicts = await harness_mod._verify_plan(deps)
    assert verdicts[0][1] == CONFIRMED


@pytest.mark.asyncio
async def test_a_resumed_plan_is_never_confirmed_from_a_historical_verdict(tmp_path):
    """A masked value cannot be compared against a cell, and a HISTORICAL
    verdict is not a substitute: it describes the cell as it was when the
    write happened, and the page may have changed under it since. The
    honest verdict is UNKNOWN — never a confirmation nobody can prove."""
    trail = AuditTrail(session_id="s3", dir=tmp_path)
    trail.begin_task("write a name")
    deps = _deps(_cdp(grid_value="name"))
    await _run_one(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]}, audit=trail)
    await _run_one(deps, "write_text",
                   {"target": {"cell": "A1"}, "value": "name"}, audit=trail)
    doc = json.loads((tmp_path / "s3.json").read_text())
    resumed = _deps(_cdp(grid_value="name"))
    resumed.plan = audit_mod.read_plan(doc)
    resumed.ledger = audit_mod.read_ledger(doc)
    assert audit_mod.is_redacted_value(resumed.plan[0].value)
    # The write WAS confirmed when it happened — and it still cannot be
    # promoted to a confirmation now.
    assert resumed.ledger[0].confirmed is True
    verdicts = await harness_mod._verify_plan(resumed, resumed.plan)
    assert verdicts[0][1] == UNKNOWN
    assert verdicts[0][1] != CONFIRMED


@pytest.mark.asyncio
async def test_a_resumed_run_is_graded_on_what_it_wrote_again(tmp_path):
    """A resumed run re-verifies by WRITING again: the completion pass
    grades the ledger's items — the values THIS process wrote — against a
    fresh read of the cell. The write is the evidence, and the read is
    current."""
    trail = AuditTrail(session_id="s5", dir=tmp_path)
    trail.begin_task("write a name")
    deps = _deps(_cdp(grid_value="name"))
    await _run_one(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]}, audit=trail)
    await _run_one(deps, "write_text",
                   {"target": {"cell": "A1"}, "value": "name"}, audit=trail)
    doc = json.loads((tmp_path / "s5.json").read_text())

    # The resume: the plan and the ledger come back from the document.
    resumed = _deps(_cdp(grid_value="name"))
    resumed.plan = audit_mod.read_plan(doc)
    resumed.ledger = audit_mod.read_ledger(doc)
    # ...and the run writes the target again, so the ledger holds a value
    # this process wrote.
    await _run_one(resumed, "write_text",
                   {"target": {"cell": "A1"}, "value": "name"}, audit=trail)

    targets = harness_mod._completion_targets(resumed)
    assert targets, "the completion pass has something to grade"
    assert not any(audit_mod.is_redacted_value(t.value) for t in targets)
    verdicts = await harness_mod._verify_plan(resumed, targets)
    assert verdicts[0][1] == CONFIRMED


@pytest.mark.asyncio
async def test_a_resumed_run_that_writes_nothing_cannot_claim_a_confirmation(tmp_path):
    """No fresh write, no value to compare, no confirmation. The run ends
    with the truth rather than with a claim."""
    trail = AuditTrail(session_id="s6", dir=tmp_path)
    trail.begin_task("write a name")
    deps = _deps(_cdp(grid_value="name"))
    await _run_one(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]}, audit=trail)
    await _run_one(deps, "write_text",
                   {"target": {"cell": "A1"}, "value": "name"}, audit=trail)
    doc = json.loads((tmp_path / "s6.json").read_text())
    resumed = _deps(_cdp(grid_value="name"))
    resumed.plan = audit_mod.read_plan(doc)
    resumed.ledger = audit_mod.read_ledger(doc)
    targets = harness_mod._completion_targets(resumed)
    verdicts = await harness_mod._verify_plan(resumed, targets)
    assert verdicts[0][1] == UNKNOWN


@pytest.mark.asyncio
async def test_a_resumed_run_with_no_ledger_at_all_is_still_checked(tmp_path):
    """A resumed run whose ledger is empty has nothing to re-verify — so
    the pass falls back to the plan, whose masked value grades UNKNOWN. It
    must not grade NOTHING: an empty verdict list accepts the model's own
    claim, which is the fail-open this pass exists to stop."""
    trail = AuditTrail(session_id="s7", dir=tmp_path)
    trail.begin_task("write a name")
    deps = _deps(_cdp(grid_value="name"))
    await _run_one(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]}, audit=trail)
    doc = json.loads((tmp_path / "s7.json").read_text())
    resumed = _deps(_cdp(grid_value="name"))
    resumed.plan = audit_mod.read_plan(doc)
    resumed.ledger = audit_mod.read_ledger(doc)
    assert resumed.ledger == []
    targets = harness_mod._completion_targets(resumed)
    assert targets, "the completion pass has something to grade"
    verdicts = await harness_mod._verify_plan(resumed, targets)
    assert verdicts[0][1] == UNKNOWN
    # And the pass refuses the completion rather than accepting it.
    out = await _run_one(resumed, "task_complete",
                         {"summary": "A1 is confirmed"}, audit=trail)
    assert "REFUSED" in out


@pytest.mark.asyncio
async def test_a_resumed_run_keeps_every_plan_requirement_in_the_grading(tmp_path):
    """The plan named two targets; only one was ever written.

    The ledger is a PARTIAL collection, so a target the plan named and the
    run never attempted exists in the plan alone. Grading the ledger drops
    it, and a dropped requirement fails open exactly as an unchecked one
    does — so the plan's shape is graded and B1 grades UNKNOWN.
    """
    trail = AuditTrail(session_id="s8", dir=tmp_path)
    trail.begin_task("write two names")
    deps = _deps(_cdp(grid_value="name"))
    await _run_one(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
        {"intent": "write B1 = age", "target": {"cell": "B1"}, "value": "age"},
    ]}, audit=trail)
    # A1 only: B1 is a requirement the run never attempted.
    await _run_one(deps, "write_text",
                   {"target": {"cell": "A1"}, "value": "name"}, audit=trail)
    doc = json.loads((tmp_path / "s8.json").read_text())

    resumed = _deps(_cdp(grid_value="name"))
    resumed.plan = audit_mod.read_plan(doc)
    resumed.ledger = audit_mod.read_ledger(doc)
    # The resumed run rewrites A1 and nothing else.
    await _run_one(resumed, "write_text",
                   {"target": {"cell": "A1"}, "value": "name"}, audit=trail)

    targets = harness_mod._completion_targets(resumed)
    assert len(targets) == 2, "a plan requirement went missing from the grading"
    verdicts = await harness_mod._verify_plan(resumed, targets)
    by_target = {v[0].target_key: v[1] for v in verdicts}
    assert by_target["cell:A1"] == CONFIRMED, "the rewritten target is verified"
    assert by_target["cell:B1"] == UNKNOWN, "the untouched requirement is not claimed"


@pytest.mark.asyncio
async def test_a_resumed_plan_with_no_verdict_stays_unknown(tmp_path):
    """No ledger entry, no value, no verdict: the honest answer is still
    UNKNOWN. The resume does not invent a confirmation."""
    trail = AuditTrail(session_id="s4", dir=tmp_path)
    trail.begin_task("write a name")
    deps = _deps(_cdp(grid_value="name"))
    await _run_one(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]}, audit=trail)
    doc = json.loads((tmp_path / "s4.json").read_text())
    resumed = _deps(_cdp(grid_value="name"))
    resumed.plan = audit_mod.read_plan(doc)
    resumed.ledger = audit_mod.read_ledger(doc)
    verdicts = await harness_mod._verify_plan(resumed)
    assert verdicts[0][1] == UNKNOWN


# ── 5. the completion refusal is persisted ──────────────────────────────────

@pytest.mark.asyncio
async def test_a_refused_completion_is_written_to_the_document(tmp_path):
    trail = AuditTrail(session_id="s1", dir=tmp_path)
    trail.begin_task("write a name")
    deps = _deps(_cdp(grid_value="age"))
    await _run_one(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]}, audit=trail)
    out = await _run_one(deps, "task_complete", {"summary": "done"}, audit=trail)
    assert "REFUSED" in out
    doc = json.loads((tmp_path / "s1.json").read_text())
    assert doc["tasks"][0]["completion_refused"] is True


def test_a_resumed_run_still_accepts_the_second_completion(sessions_dir):
    """A run that was refused a completion and then reconnected must still
    accept the second one — the flag comes back with the document."""
    doc = _doc("c1")
    doc["tasks"][0]["completion_refused"] = True
    doc["tasks"][0]["plan"] = [{
        "id": 1, "intent": "write A1 = name", "target_key": "cell:A1",
        "value": "name", "status": "pending",
    }]
    _write_doc(sessions_dir, "c1", doc)
    deps = _deps(_cdp(grid_value="name"))
    deps.task_id = "c1"
    deps.scripted_planner = _done_script()
    _run_harness(deps)
    # Rehydrated from the document, not set by this run: the plan matched,
    # so nothing was refused here.
    assert deps.completion_refused is True
