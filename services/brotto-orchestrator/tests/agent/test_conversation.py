"""A follow-up task continues the conversation; a crash resumes the run.

These two share a document and today share a code path, which is the bug:
one must re-run the unfinished turn, the other must start a new one.
"""

import json

import pytest

from brotto_orchestrator.agent import harness as harness_mod
from brotto_orchestrator.agent.audit import AuditTrail, read


@pytest.fixture
def sessions(tmp_path, monkeypatch):
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path / "sessions"))
    return tmp_path / "sessions"


def _finished_run(sessions, session_id, goal, status="completed", summary="done"):
    """A session that already ended, written the way a real run writes it."""
    t = AuditTrail(session_id, dir=sessions)
    idx = t.begin_task(goal)
    t.add_message(role="user", content=goal, task=idx, turn=None)
    turn = t.begin_turn(step=0, url="https://x.test", page_title="X",
                        ax_targets=1, ax_chars=10, ax_diff="", page_text_chars=0)
    t.add_message(role="assistant", content=summary, task=idx, turn=turn)
    t.end_turn(turn, timings={})
    t.set_status(status)
    t.finish({"status": status, "summary": summary, "timing": {"wall_s": 1.0}})
    t.close()


def _doc(sessions, session_id):
    return json.loads((sessions / f"{session_id}.json").read_text())


def _cdp():
    from unittest.mock import AsyncMock, MagicMock
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[])
    cdp.get_current_url = AsyncMock(return_value="https://x.test")
    cdp.get_page_title = AsyncMock(return_value="X")
    cdp.get_page_text = AsyncMock(return_value="")
    return cdp


def _followup(sessions, session_id, task):
    """Drive a real run() at an existing session as a follow-up message."""
    import asyncio
    from unittest.mock import AsyncMock

    from brotto_orchestrator.agent.context import ActionCall, AgentDeps
    from brotto_orchestrator.agent.harness import AgentHarness
    from brotto_orchestrator.testing.scripted_planner import (
        ScriptedPlanner, ScriptedStep,
    )

    async def ws_send(_msg: dict) -> None:
        return None

    planner = ScriptedPlanner(
        [ScriptedStep(thought="posted it", actions=[ActionCall(
            action="task_complete", action_args={"summary": "ok"})])],
        on_exhausted="task_complete",
    )
    deps = AgentDeps(user_id=session_id, task=task, cdp=_cdp(),
                     task_id=session_id, ws_send=ws_send,
                     scripted_planner=planner)

    async def _go():
        return await AgentHarness().run(deps)

    return asyncio.new_event_loop().run_until_complete(_go()), deps


def test_a_followup_appends_a_task_instead_of_resuming(sessions):
    """Review focus 1: the second goal is answered on the first's findings."""
    _finished_run(sessions, "c1", "research the top 5 repos")
    assert read("c1", dir=sessions)["status"] == "completed"

    # The decision itself, which is what the harness consults.
    state = harness_mod._conversation_state("c1", resume=False)
    assert state["action"] == "new_task"
    assert state["task_index"] == 1
    assert state["why"] == ""


def test_a_followup_run_lands_in_the_same_document(sessions):
    """The whole point, through a real run: both tasks, one transcript."""
    _finished_run(sessions, "c9", "research the top 5 repos")
    result, deps = _followup(sessions, "c9", "write a post about the top one")

    assert result.status == "completed"
    doc = _doc(sessions, "c9")
    assert [t["goal"] for t in doc["tasks"]] == [
        "research the top 5 repos", "write a post about the top one",
    ]
    # The first task's exchange, then the follow-up, then what it did.
    assert [(m["role"], m["task"]) for m in doc["messages"]] == [
        ("user", 0), ("assistant", 0), ("user", 1), ("assistant", 1),
    ]
    # And the model is handed the earlier task's exchange, minus its own goal.
    assert [m["content"] for m in deps.conversation] == [
        "research the top 5 repos", "done",
    ]


def test_a_followup_after_a_failed_run_is_allowed(sessions):
    """Review focus 2: a failure still leaves a usable transcript."""
    _finished_run(sessions, "c2", "research", status="failed")
    state = harness_mod._conversation_state("c2", resume=False)
    assert state["action"] == "new_task"
    assert state["why"] == ""


def test_a_followup_into_a_v1_document_is_refused_with_a_reason(sessions):
    """Review focus 4: readable refusal, not a crash and not truncation."""
    sessions.mkdir(parents=True, exist_ok=True)
    (sessions / "c3.json").write_text(json.dumps(
        {"schema_version": 1, "session_id": "c3", "status": "completed",
         "goal": "old", "turns": [], "totals": {"steps": 1}}))
    state = harness_mod._conversation_state("c3", resume=False)
    assert state["action"] == "refuse"
    assert "v1" in state["why"] or "schema" in state["why"]


def test_a_followup_into_a_live_run_is_refused(sessions):
    """Review focus 5: a crashed run's approval is not replayed silently."""
    t = AuditTrail("c4", dir=sessions)
    t.begin_task("go")
    t.begin_turn(step=0, url="https://x.test", page_title="X",
                 ax_targets=1, ax_chars=10, ax_diff="", page_text_chars=0)
    t.close()
    state = harness_mod._conversation_state("c4", resume=False)
    assert state["action"] == "refuse"
    assert "running" in state["why"]


def test_a_crash_resume_still_resumes(sessions):
    t = AuditTrail("c5", dir=sessions)
    t.begin_task("go")
    t.begin_turn(step=0, url="https://x.test", page_title="X",
                 ax_targets=1, ax_chars=10, ax_diff="", page_text_chars=0)
    t.end_turn(0, timings={})
    t.close()
    state = harness_mod._conversation_state("c5", resume=True)
    assert state["action"] == "resume"
    assert state["first_step"] == 1


def test_a_resume_of_a_finished_run_is_refused(sessions):
    _finished_run(sessions, "c6", "done")
    state = harness_mod._conversation_state("c6", resume=True)
    assert state["action"] == "refuse"


def test_interrupted_is_terminal_so_a_second_resume_still_refuses(sessions):
    """Review focus 7: the stamp a refusal leaves behind must not reopen the run."""
    _finished_run(sessions, "c7", "done")
    _finished_run(sessions, "c7", "done")
    # First attempt: refused, and it stamps `interrupted` over `completed`.
    doc = read("c7", dir=sessions)
    doc["status"] = "interrupted"
    (sessions / "c7.json").write_text(json.dumps(doc))
    second = harness_mod._conversation_state("c7", resume=True)
    assert second["action"] == "refuse"


def test_the_prompt_window_names_what_it_dropped():
    from brotto_orchestrator.agent.harness import _conversation_block
    messages = [{"role": "user" if i % 2 == 0 else "assistant",
                 "content": f"m{i}", "task": 0, "turn": None}
                for i in range(20)]
    block = _conversation_block(messages, current_task=1)
    assert "12 earlier messages omitted" in block
    assert "m0" in block and "m19" in block
    assert "m5" not in block


def test_a_first_task_prompt_is_unchanged():
    """Review focus 9: task 0 sees exactly the prompt it saw before."""
    from brotto_orchestrator.agent.harness import _conversation_block
    assert _conversation_block([], current_task=0) == ""


def test_the_conversation_block_excludes_the_current_task():
    """The current goal is in `## Task` already; showing it twice is noise."""
    from brotto_orchestrator.agent.harness import _conversation_block
    block = _conversation_block(
        [{"role": "user", "content": "earlier", "task": 0, "turn": None},
         {"role": "user", "content": "this one", "task": 1, "turn": None}],
        current_task=1)
    assert "earlier" in block and "this one" not in block


def test_a_resume_of_a_later_task_keeps_its_turns_in_the_right_segment(sessions):
    """A crash in task 1 resumes into task 1, not into task 0.

    Goes through the harness's own adopt step, because that is the only way
    an AuditTrail ever learns what is already on disk — a fresh instance
    starts with an empty document and would answer 0 for anything.
    """
    t = AuditTrail("c8", dir=sessions)
    t.begin_task("research")
    t.begin_task("write the post")
    t.begin_turn(step=0, url="https://x.test", page_title="X",
                 ax_targets=1, ax_chars=1, ax_diff="", page_text_chars=0)
    t.close()

    assert harness_mod._conversation_state("c8", resume=True)["action"] == "resume"

    reopened = AuditTrail("c8", dir=sessions)
    harness_mod._adopt_document(reopened, read("c8", dir=sessions))
    assert reopened.resume_task() == 1
    nxt = reopened.begin_turn(step=1, url="https://x.test", page_title="X",
                              ax_targets=1, ax_chars=1, ax_diff="",
                              page_text_chars=0)
    reopened.add_message(role="assistant", content="posted", task=1, turn=nxt)
    reopened.close()
    doc = _doc(sessions, "c8")
    assert doc["turns"][-1]["task"] == 1
    assert doc["messages"][-1]["task"] == 1
