"""The ledger survives a resume, and a cell value is redacted on disk."""

from __future__ import annotations

import json
from pathlib import Path

from brotto_orchestrator.agent import audit as audit_mod
from brotto_orchestrator.agent.audit import AuditTrail
from brotto_orchestrator.agent.closed_loop import PlanItem, WriteAttempt


def _trail(tmp_path: Path) -> AuditTrail:
    return AuditTrail(session_id="s1", dir=tmp_path)


def test_the_schema_version_is_bumped():
    assert audit_mod.SCHEMA_VERSION == 4


def test_a_cell_value_that_looks_like_a_secret_is_redacted_on_disk(tmp_path):
    trail = _trail(tmp_path)
    trail.begin_task("write a card number")
    trail.record_ledger(step=1, attempts=[{
        "target_key": "cell:A1", "intended": "4111111111111111",
        "observed": "4111111111111111", "confirmed": True,
        "mechanism": "content-box", "step": 1,
    }])
    text = (tmp_path / "s1.json").read_text()
    assert "4111111111111111" not in text
    assert "cell:A1" in text, "the target key is structural, not content"


def test_the_plan_is_written(tmp_path):
    trail = _trail(tmp_path)
    trail.begin_task("write a name")
    trail.record_plan(items=[{
        "id": 1, "intent": "write A1 = name", "target_key": "cell:A1",
        "value": "name", "status": "pending",
    }])
    doc = json.loads((tmp_path / "s1.json").read_text())
    assert doc["tasks"][0]["plan"][0]["intent"] == "write A1 = name"


def test_the_ledger_rehydrates(tmp_path):
    trail = _trail(tmp_path)
    trail.begin_task("write a name")
    trail.record_ledger(step=1, attempts=[{
        "target_key": "cell:A1", "intended": "name", "observed": "age",
        "confirmed": False, "mechanism": "content-box", "step": 1,
    }])
    doc = json.loads((tmp_path / "s1.json").read_text())
    attempts = audit_mod.read_ledger(doc)
    assert len(attempts) == 1
    assert attempts[0].target_key == "cell:A1"
    assert attempts[0].confirmed is False


def test_the_plan_rehydrates(tmp_path):
    trail = _trail(tmp_path)
    trail.begin_task("write a name")
    trail.record_plan(items=[{
        "id": 1, "intent": "write A1 = name", "target_key": "cell:A1",
        "value": "name", "status": "pending",
    }])
    doc = json.loads((tmp_path / "s1.json").read_text())
    items = audit_mod.read_plan(doc)
    assert len(items) == 1
    assert items[0].target_key == "cell:A1"


# ── the rest of the story, pinned ───────────────────────────────

def test_the_redaction_keeps_the_structural_fields_readable(tmp_path):
    """The key names the cell, the mechanism names the route, the number
    counts the step — none of them are content, and a reader (or the
    harness, on a resume) cannot work with a verdict whose target it
    cannot name."""
    trail = _trail(tmp_path)
    trail.begin_task("write a card number")
    trail.record_ledger(step=7, attempts=[{
        "target_key": "cell:A1", "intended": "4111111111111111",
        "observed": "4111111111111111", "confirmed": True,
        "mechanism": "content-box", "step": 3,
    }])
    doc = json.loads((tmp_path / "s1.json").read_text())
    entry = doc["tasks"][0]["ledger"][0]
    assert entry["target_key"] == "cell:A1"
    assert entry["mechanism"] == "content-box"
    assert entry["step"] == 3
    assert entry["confirmed"] is True
    assert doc["tasks"][0]["ledger_step"] == 7


def test_a_redacted_value_is_recognisable_on_the_way_back(tmp_path):
    """A resumed run compares a rehydrated value against a fresh one, and
    a redacted value cannot be compared: the honest verdict for it is
    `unknown`, never a confirmation."""
    trail = _trail(tmp_path)
    trail.begin_task("write a card number")
    trail.record_ledger(step=1, attempts=[{
        "target_key": "cell:A1", "intended": "4111111111111111",
        "observed": "4111111111111111", "confirmed": True,
        "mechanism": "content-box", "step": 1,
    }])
    doc = json.loads((tmp_path / "s1.json").read_text())
    attempt = audit_mod.read_ledger(doc)[0]
    assert audit_mod.is_redacted_value(attempt.intended)
    assert not audit_mod.is_redacted_value("name")


def test_the_plan_value_is_redacted_and_the_key_is_not(tmp_path):
    trail = _trail(tmp_path)
    trail.begin_task("write a card number")
    trail.record_plan(items=[{
        "id": 1, "intent": "write A1 = name", "target_key": "cell:A1",
        "value": "4111111111111111", "status": "pending",
    }])
    text = (tmp_path / "s1.json").read_text()
    assert "4111111111111111" not in text
    doc = json.loads(text)
    item = doc["tasks"][0]["plan"][0]
    assert item["target_key"] == "cell:A1"
    assert item["status"] == "pending"
    assert item["id"] == 1
    assert audit_mod.is_redacted_value(item["value"])


def test_an_intent_that_quotes_a_value_is_redacted(tmp_path):
    """The intent is the model's own prose and can carry the value it is
    about to write; redacting it costs nothing for the intents that are
    not quoting one."""
    trail = _trail(tmp_path)
    trail.begin_task("write a card number")
    trail.record_plan(items=[{
        "id": 1, "intent": "write 4111111111111111 to A1",
        "target_key": "cell:A1", "value": "4111111111111111",
        "status": "pending",
    }])
    assert "4111111111111111" not in (tmp_path / "s1.json").read_text()


def test_a_document_written_before_schema_four_still_reads(tmp_path):
    """An older document has no ledger and no plan. It is not an error —
    it is a run that had not written yet, and it must still resume."""
    doc = {"schema_version": 3, "session_id": "s1", "status": "running",
           "tasks": [{"index": 0, "goal": "g", "status": "running"}]}
    assert audit_mod.read_ledger(doc) == []
    assert audit_mod.read_plan(doc) == []


def test_a_document_with_no_tasks_reads_empty(tmp_path):
    assert audit_mod.read_ledger({"tasks": []}) == []
    assert audit_mod.read_plan({}) == []
    assert audit_mod.read_ledger({"tasks": "not a list"}) == []


def test_only_the_last_task_block_is_read(tmp_path):
    """A resume continues the LAST task the document was running. An
    earlier task's ledger belongs to a different run, and adopting it
    would refuse a write the user is entitled to make."""
    doc = {"tasks": [
        {"index": 0, "ledger": [{"target_key": "cell:A1", "intended": "a",
                                 "observed": "a", "confirmed": True,
                                 "mechanism": "content-box", "step": 1}]},
        {"index": 1},
    ]}
    assert audit_mod.read_ledger(doc) == []


def test_a_ledger_written_before_a_task_exists_writes_nothing(tmp_path):
    trail = _trail(tmp_path)
    trail.record_ledger(step=1, attempts=[{
        "target_key": "cell:A1", "intended": "name", "observed": "name",
        "confirmed": True, "mechanism": "content-box", "step": 1,
    }])
    doc = json.loads((tmp_path / "s1.json").read_text())
    assert "ledger" not in (doc.get("tasks") or [{}])[0]


def test_the_readers_return_the_shapes_the_harness_uses(tmp_path):
    """The harness compares a rehydrated attempt against a fresh one, so
    the field names are the dataclass field names and nothing else."""
    trail = _trail(tmp_path)
    trail.begin_task("write a name")
    trail.record_ledger(step=1, attempts=[{
        "target_key": "cell:A1", "intended": "name", "observed": None,
        "confirmed": False, "mechanism": "content-box", "step": 4,
    }])
    doc = json.loads((tmp_path / "s1.json").read_text())
    attempt = audit_mod.read_ledger(doc)[0]
    assert isinstance(attempt, WriteAttempt)
    assert attempt.observed is None
    assert attempt.step == 4
