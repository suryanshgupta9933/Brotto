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
    return _drive(session_id, task, resume=False)


def _first_run(sessions, session_id, task):
    """Drive a real run() at a session that has nothing on disk yet."""
    return _drive(session_id, task, resume=False)


def _resume(sessions, session_id, task="carrying on"):
    """Drive a real run() as a crash resume — `resume=True` on the wire."""
    return _drive(session_id, task, resume=True)


def _drive(session_id, task, *, resume):
    import asyncio

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
        return await AgentHarness().run(deps, resume=resume)

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


# ── what a run actually writes ──────────────────────────────────────────────
# Every test above drives a decision function or a hand-built document. The
# three below drive `run()` twice against one real document, because each of
# them was a live defect that all of the above passed straight over.


def test_the_first_task_of_a_fresh_session_is_recorded(sessions):
    """A brand-new session still gets tasks[0], and a title.

    The branch used to require an existing document, so a first run wrote no
    task at all — which left the *second* run to claim index 0 and pushed the
    first task out of the conversation's own segmentation.
    """
    _first_run(sessions, "n1", "research the top 5 repos")
    doc = _doc(sessions, "n1")
    assert [t["index"] for t in doc["tasks"]] == [0]
    assert doc["tasks"][0]["goal"] == "research the top 5 repos"
    assert doc["title"] == "research the top 5 repos"


def test_a_followup_to_the_first_task_is_given_that_task(sessions):
    """The first follow-up is the case the empty-task bug broke.

    With no tasks[0], the follow-up's task_index was 0, the
    `task < task_index` filter matched nothing, and the model answered a
    follow-up with no memory of the exchange it was following up on.
    """
    _first_run(sessions, "n2", "research the top 5 repos")
    _, deps = _followup(sessions, "n2", "write a post about the top one")
    assert [m["content"] for m in deps.conversation] == [
        "research the top 5 repos", "ok",
    ]


def test_seq_keeps_climbing_across_runs_in_one_session(sessions):
    """`seq` is the document's ordering key, so it cannot restart.

    One AuditTrail is built per run and its counter starts at 0, so without
    adopting the previous maximum, two runs both write a turn called seq 1 and
    a reader sorting on seq interleaves them.
    """
    _first_run(sessions, "n3", "first goal")
    _followup(sessions, "n3", "second goal")
    doc = _doc(sessions, "n3")
    seqs = [t["seq"] for t in doc["turns"]]
    assert len(seqs) == len(set(seqs)), seqs
    assert seqs == sorted(seqs), seqs


def test_a_resume_carries_the_conversation_that_came_before_it(sessions):
    """`step_summaries` covers the run being continued, not the earlier tasks.

    A crash in the second task used to resume with step summaries and nothing
    else, so the model forgot the first task entirely.
    """
    from brotto_orchestrator.agent.audit import AuditTrail as _AT
    t = _AT("n4", dir=sessions)
    t.begin_task("first goal")
    t.add_message(role="user", content="first goal", task=0, turn=None)
    turn = t.begin_turn(step=0, url="https://x.test", page_title="X",
                        ax_targets=1, ax_chars=1, ax_diff="", page_text_chars=0)
    t.add_message(role="assistant", content="the answer", task=0, turn=turn)
    t.end_turn(turn, timings={})
    t.begin_task("second goal")
    t.add_message(role="user", content="second goal", task=1, turn=None)
    t.set_status("running")
    t.close()

    # Left `running` with an unfinished turn, which is what a dropped socket
    # leaves behind — the one state a resume is allowed to act on.
    result, deps = _resume(sessions, "n4")
    assert result.status == "completed"
    assert [m["content"] for m in deps.conversation] == [
        "first goal", "the answer",
    ]


def test_a_long_answer_is_capped_in_the_prompt_but_not_on_disk(sessions):
    """The harness re-sends this block on EVERY step, so it cannot be the
    model's full long-form answer. The stored message is untouched — the cap
    is a rendering decision, and truncating the record would lose the answer
    the transcript exists to preserve."""
    from brotto_orchestrator.agent.harness import _CONV_MSG_CHARS, _conversation_block

    long_answer = "x" * (_CONV_MSG_CHARS * 4)
    block = _conversation_block(
        [{"role": "assistant", "content": long_answer, "task": 0, "turn": 0}],
        current_task=1)
    assert "truncated" in block
    assert len(block) < _CONV_MSG_CHARS * 2


def test_a_capped_answer_keeps_its_end_not_just_its_head():
    """A follow-up is asked about the findings, and they are at the bottom.

    Head-only truncation kept the model's "Here are the top stories:" and
    dropped the stories — the preamble without the answer, which is worse
    than either end alone. Same head+tail shape `_turn_to_prompt` already
    uses for step summaries.
    """
    from brotto_orchestrator.agent.harness import _CONV_MSG_CHARS, _conversation_block

    body = "PREAMBLE " + ("filler " * 900) + "THE-ACTUAL-ANSWER-IS-42"
    block = _conversation_block(
        [{"id": "m2", "role": "assistant", "content": body,
          "task": 0, "turn": 0}],
        current_task=1)
    assert "THE-ACTUAL-ANSWER-IS-42" in block
    assert "PREAMBLE" in block
    # And it says how to get the rest, by name.
    assert "recall_conversation('m2')" in block
    assert len(block) < _CONV_MSG_CHARS * 2


def _recall(args, messages):
    import asyncio

    from brotto_orchestrator.agent.context import ActionCall, AgentDeps
    from brotto_orchestrator.agent.harness import _execute_action

    deps = AgentDeps(user_id="u", task="t", cdp=None, ws_send=None,
                     conversation=messages)
    return asyncio.new_event_loop().run_until_complete(
        _execute_action(ActionCall(action="recall_conversation",
                                  action_args=args), deps))


def test_recall_conversation_fetches_what_the_window_dropped():
    msgs = [{"id": f"m{i}", "role": "user" if i % 2 else "assistant",
             "content": f"msg{i}", "task": 0, "turn": None}
            for i in range(1, 21)]
    out = _recall({"from_id": "m5", "to_id": "m7"}, msgs)
    assert "msg5" in out and "msg7" in out
    assert "msg4" not in out and "msg8" not in out


def test_recall_conversation_takes_a_reversed_span_and_an_overshoot():
    msgs = [{"id": f"m{i}", "role": "assistant", "content": f"msg{i}",
             "task": 0, "turn": None} for i in range(1, 6)]
    assert "msg3" in _recall({"from_id": "m4", "to_id": "m2"}, msgs)
    # Overshooting the end is how a model says "from here to the end".
    assert "msg5" in _recall({"from_id": "m4", "to_id": "m99"}, msgs)


def test_recall_conversation_on_a_bad_id_says_what_exists():
    msgs = [{"id": "m1", "role": "user", "content": "hi", "task": 0,
             "turn": None}]
    out = _recall({"from_id": "m9"}, msgs)
    assert "not found" in out and "m1" in out


def test_recall_conversation_cannot_smuggle_the_whole_history():
    """The window's ceiling, or a fetch becomes a way around the window."""
    from brotto_orchestrator.agent.harness import _CONV_RECALL_CHARS

    msgs = [{"id": f"m{i}", "role": "assistant", "content": "y" * 4000,
             "task": 0, "turn": None} for i in range(1, 8)]
    out = _recall({"from_id": "m1", "to_id": "m7"}, msgs)
    assert "span too large" in out
    assert len(out) < _CONV_RECALL_CHARS + 100


def test_recall_conversation_with_nothing_earlier_is_not_an_error():
    from brotto_orchestrator.agent.context import AgentDeps
    from brotto_orchestrator.agent.context import ActionCall
    from brotto_orchestrator.agent.harness import _execute_action
    import asyncio

    deps = AgentDeps(user_id="u", task="t", cdp=None, ws_send=None,
                     conversation=[])
    out = asyncio.new_event_loop().run_until_complete(
        _execute_action(ActionCall(action="recall_conversation",
                                   action_args={"from_id": "m1"}), deps))
    assert "No earlier messages" in out


def test_a_capped_answer_is_still_whole_on_disk(sessions):
    """The cap is a rendering decision. Truncating the record would lose the
    answer the transcript exists to preserve — and it is the only copy."""
    from brotto_orchestrator.agent.harness import _CONV_MSG_CHARS

    long_answer = "x" * (_CONV_MSG_CHARS * 4)
    t = AuditTrail("n5", dir=sessions)
    t.begin_task("deep dive")
    turn = t.begin_turn(step=0, url="https://x.test", page_title="X",
                        ax_targets=1, ax_chars=1, ax_diff="", page_text_chars=0)
    t.add_message(role="assistant", content=long_answer, task=0, turn=turn)
    t.close()
    assert _doc(sessions, "n5")["messages"][-1]["content"] == long_answer


def test_step_0_is_budgeted_against_the_model_that_will_read_it(monkeypatch):
    """The AX budget is read at the top of a step; the window is set at the
    bottom of one. Left alone, step 0 budgeted against `budget_for_window(None)`
    — the 6K floor — and step 1 onward against the model's real window, so the
    step that decides what a task tries first saw a tenth of the page."""
    from brotto_orchestrator.agent import ax_filter
    from brotto_orchestrator.agent.harness import _resolve_model

    class _Cfg:
        context_window = 1_000_000

    monkeypatch.setattr(
        "brotto_orchestrator.agent.harness.resolve_model_config",
        lambda **_kw: (_Cfg(), None),
    )
    monkeypatch.setenv("AGENT_MODEL", "minimax:MiniMax-M3")

    class _Deps:
        client_ip = "127.0.0.1"
        model_config = None
        api_key = None
        context_window = None

    deps = _Deps()
    # Before the fix: 6000, the MAX_CHARS floor.
    assert ax_filter.budget_for_window(deps.context_window) == ax_filter.MAX_CHARS

    deps.context_window = _resolve_model(deps)[0].context_window
    assert ax_filter.budget_for_window(deps.context_window) == 50_000
