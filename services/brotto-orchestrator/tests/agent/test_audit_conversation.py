"""A session holds every task the user sends into it, not one run.

The document is the record, so these tests read the file back rather than
inspecting the in-memory trail: what survives a crash is the contract.
"""

import json

import pytest

from brotto_orchestrator.agent import audit as audit_mod
from brotto_orchestrator.agent.audit import AuditTrail, list_sessions, read


@pytest.fixture
def trail(tmp_path):
    t = AuditTrail("conv-1", dir=tmp_path / "sessions")
    yield t
    t.close()


def _doc(trail):
    return json.loads(trail.path.read_text())


def test_a_new_document_is_v2_with_the_three_collections(trail):
    # The only test that cannot read the file back: nothing has flushed yet,
    # so there is no file to read. A session that never records anything
    # leaves no file at all, which is the pre-existing behaviour.
    doc = trail.document()
    assert doc["schema_version"] == 2
    assert doc["tasks"] == []
    assert doc["messages"] == []


def test_begin_task_segments_and_titles_the_conversation(trail):
    first = trail.begin_task("research the top 5 repos")
    second = trail.begin_task("write a linkedin post about the top one")
    doc = _doc(trail)
    assert [t["goal"] for t in doc["tasks"]] == [
        "research the top 5 repos",
        "write a linkedin post about the top one",
    ]
    assert [t["index"] for t in doc["tasks"]] == [0, 1]
    # The label is the FIRST task, not the latest — a conversation is named
    # after how it started, which is what the history list shows.
    assert doc["title"] == "research the top 5 repos"
    assert (first, second) == (0, 1)


def test_a_user_message_survives_a_run_cancelled_before_any_turn(trail):
    idx = trail.begin_task("go")
    trail.add_message(role="user", content="go", task=idx, turn=None)
    doc = _doc(trail)
    assert len(doc["messages"]) == 1
    m = doc["messages"][0]
    assert m["role"] == "user" and m["turn"] is None
    assert m["task"] == 0 and m["id"] and m["at"]


def test_an_assistant_message_points_at_the_turn_it_came_from(trail):
    idx = trail.begin_task("go")
    turn = trail.begin_turn(step=0, url="https://x.test", page_title="X",
                            ax_targets=1, ax_chars=10, ax_diff_chars=0,
                            page_text_chars=0)
    mid = trail.add_message(role="assistant", content="found 5 repos",
                            task=idx, turn=turn)
    assert mid
    assert _doc(trail)["messages"][0]["turn"] == 0


def test_message_content_is_capped_like_every_other_field(trail):
    trail.add_message(role="user", content="x" * (audit_mod.MAX_FIELD_CHARS + 500),
                      task=0, turn=None)
    assert len(_doc(trail)["messages"][0]["content"]) <= audit_mod.MAX_FIELD_CHARS


def test_conversation_returns_a_copy_not_the_live_list(trail):
    trail.add_message(role="user", content="hi", task=0, turn=None)
    first = trail.conversation()
    first.append({"role": "user", "content": "tampered"})
    assert len(trail.conversation()) == 1


def test_a_v1_document_is_readable_and_reports_its_version(tmp_path):
    d = tmp_path / "sessions"
    d.mkdir()
    (d / "old.json").write_text(json.dumps(
        {"schema_version": 1, "session_id": "old", "status": "completed",
         "goal": "the old way", "turns": [], "totals": {"steps": 3}}))
    doc = read("old", dir=d)
    assert doc["schema_version"] == 1
    assert doc["goal"] == "the old way"


def test_list_sessions_reports_the_conversation_title_and_task_count(tmp_path):
    d = tmp_path / "sessions"
    t = AuditTrail("conv-2", dir=d)
    t.begin_task("first goal")
    t.begin_task("second goal")
    t.close()
    row = [r for r in list_sessions(dir=d) if r["session_id"] == "conv-2"][0]
    assert row["title"] == "first goal"
    assert row["task_count"] == 2


def test_every_turn_carries_the_task_it_belongs_to(trail):
    """The transcript join is messages[].turn -> turns[] and
    turns[].task -> tasks[]. Without the second hop the panel cannot group
    a two-task conversation, and the gap is invisible in a one-task run."""
    first = trail.begin_task("research")
    t1 = trail.begin_turn(step=0, url="https://a.test", page_title="A",
                          ax_targets=1, ax_chars=1, ax_diff_chars=0, page_text_chars=0)
    trail.end_turn(t1, timings={})
    second = trail.begin_task("write the post")
    t2 = trail.begin_turn(step=0, url="https://b.test", page_title="B",
                          ax_targets=1, ax_chars=1, ax_diff_chars=0, page_text_chars=0)
    trail.end_turn(t2, timings={})
    assert [t["task"] for t in _doc(trail)["turns"]] == [first, second] == [0, 1]


def test_a_resume_points_at_the_task_it_continues(trail):
    """A crash in the second task must not write into the first task's
    segment. `resume_task` reads the document rather than guessing 0."""
    trail.begin_task("research")
    trail.begin_task("write the post")
    assert trail.resume_task() == 1


def test_resume_task_is_zero_on_a_first_conversation(trail):
    assert trail.resume_task() == 0
