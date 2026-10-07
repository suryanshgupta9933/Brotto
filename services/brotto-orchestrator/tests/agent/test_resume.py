"""Resume: a reconnect picks the run back up instead of starting it again.

The basis of all of this is one fact about the harness: `agent.run` is
handed a freshly built prompt and no `message_history`, so
`deps.step_summaries` and `deps.scratchpad` ARE the model's entire
history. The audit document holds both, which is what makes a resume a
reconstruction rather than a guess.

Two things this must never do, and the tests below are mostly about them:
re-run an action the user already approved, and resurrect a task the user
cancelled.

The first four tests come from the plan and pin the document-level
invariants the resume code reads. The rest exercise the resume itself.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.audit import AuditTrail, read
from brotto_orchestrator.agent.context import ActionCall, AgentDeps
from brotto_orchestrator.agent.harness import (
    AgentHarness, _resume_state, mark_cancelled,
)

# ── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def sessions_dir(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    return tmp_path

# ── document invariants (from the plan) ──────────────────────────────────────

def test_resume_state_is_reconstructible_from_the_document(sessions_dir):
    # The whole basis of resume: agent.run is called with a rebuilt prompt
    # and no message_history, so the summaries ARE the history, and a
    # session interrupted at turn 3 can continue at turn 3.
    t = AuditTrail("s1", dir=sessions_dir)
    t.set_goal("find it")
    for step in range(3):
        turn = t.begin_turn(step=step, url=f"u{step}", page_title="t",
                            ax_targets=1, ax_chars=1, ax_diff_chars=0,
                            page_text_chars=0)
        t.record_model(turn, thought=f"step {step}", reasoning="r",
                       tokens_in=1, tokens_out=1, context_pct=0.0,
                       latency_ms=1)
        t.end_turn(turn, timings={})
    doc = read("s1", dir=sessions_dir)
    completed = [x for x in doc["turns"] if x["ended_at"] is not None]
    assert len(completed) == 3
    assert [x["step"] for x in completed] == [0, 1, 2]

def test_an_unfinished_turn_is_not_a_resume_point(sessions_dir):
    # Review Focus #3: a turn that was in flight when the socket died
    # must be re-run, not half-recorded.
    t = AuditTrail("s1", dir=sessions_dir)
    t.set_goal("g")
    a = t.begin_turn(step=0, url="u", page_title="t", ax_targets=1,
                     ax_chars=1, ax_diff_chars=0, page_text_chars=0)
    t.end_turn(a, timings={})
    t.begin_turn(step=1, url="u", page_title="t", ax_targets=1,
                 ax_chars=1, ax_diff_chars=0, page_text_chars=0)  # never ended
    doc = read("s1", dir=sessions_dir)
    assert doc["turns"][1]["ended_at"] is None
    assert [x["step"] for x in doc["turns"] if x["ended_at"]] == [0]

def test_approved_but_unexecuted_action_is_not_replayed(sessions_dir):
    t = AuditTrail("s1", dir=sessions_dir)
    t.set_goal("g")
    turn = t.begin_turn(step=0, url="u", page_title="t", ax_targets=1,
                        ax_chars=1, ax_diff_chars=0, page_text_chars=0)
    pid = t.record_prompt(turn, kind="critical_action", action="click",
                          args={}, domain=None, reason="…")
    t.resolve_prompt(pid, decision="approved", response="yes", wait_ms=10)
    # Socket died here: approved, but no action record was written.
    doc = read("s1", dir=sessions_dir)
    p = doc["turns"][0]["prompts"][0]
    assert p["decision"] == "approved"
    assert doc["turns"][0]["actions"] == []

def test_a_corrupt_document_resumes_as_interrupted_not_restarted(sessions_dir):
    p = sessions_dir / "s1.json"
    p.write_text('{"schema_ver')
    from brotto_orchestrator.agent.audit import read as _read
    doc = _read("s1", dir=sessions_dir)
    assert doc.get("corrupt") is True
    # The caller marks it interrupted with the reason rather than
    # silently running the task again from step 0.

# ── what resume rebuilds ────────────────────────────────────────────────────

def _crashed_run(session_id: str, *, completed: int = 3, sessions_dir: Path,
                 in_flight: int = 1, approved_domain: str | None = None) -> None:
    """A document as a socket death leaves it: N finished turns, one open."""
    t = AuditTrail(session_id, dir=sessions_dir)
    t.set_goal("find the thing")
    for step in range(completed):
        turn = t.begin_turn(step=step, url=f"https://example.com/{step}",
                            page_title="Example", ax_targets=1, ax_chars=1,
                            ax_diff_chars=0, page_text_chars=0)
        t.record_action(turn, action="navigate",
                        args={"url": f"https://example.com/{step}"},
                        outcome=f"Navigated to https://example.com/{step}",
                        ok=True, redacted=False, duration_ms=5)
        t.end_turn(turn, timings={})
    if approved_domain:
        t.record_policy(step=0, kind="first_navigation", domain=approved_domain,
                        action="navigate", decision="require_approval",
                        user_decision="approved")
    for step in range(completed, completed + in_flight):
        # begun, never ended — the socket died mid-step
        t.begin_turn(step=step, url=f"https://example.com/{step}",
                     page_title="Example", ax_targets=1, ax_chars=1,
                     ax_diff_chars=0, page_text_chars=0)
    t.close()

def test_completed_turns_become_step_summaries(sessions_dir):
    _crashed_run("r1", sessions_dir=sessions_dir)
    state = _resume_state("r1")
    assert state["why"] == ""
    assert [s.step for s in state["summaries"]] == [0, 1, 2]
    assert state["summaries"][0].action_taken == "navigate"
    assert "example.com/1" in state["summaries"][1].outcome

def test_an_in_flight_turn_is_re_run_not_half_recorded(sessions_dir):
    _crashed_run("r2", sessions_dir=sessions_dir, completed=3, in_flight=1)
    state = _resume_state("r2")
    # Step 3 was in flight: no history for it, and the loop restarts there.
    assert [s.step for s in state["summaries"]] == [0, 1, 2]
    assert state["first_step"] == 3

def test_only_approved_domains_are_restored(sessions_dir):
    _crashed_run("r3", sessions_dir=sessions_dir, approved_domain="github.com")
    assert _resume_state("r3")["visited"] == {"github.com"}

def test_a_fresh_session_has_nothing_to_resume(sessions_dir):
    state = _resume_state("never-ran")
    assert state["summaries"] == []
    assert state["first_step"] == 0
    assert state["why"] == ""

def test_a_cancelled_run_is_never_resumed(sessions_dir):
    """The other half of the correctness bar: stop means stop."""
    _crashed_run("r4", sessions_dir=sessions_dir)
    t = AuditTrail("r4", dir=sessions_dir)
    t.set_status("cancelled")
    t.close()
    state = _resume_state("r4")
    assert state["summaries"] == []
    assert "cancelled" in state["why"]

# ── through the harness ──────────────────────────────────────────────────────

def _cdp() -> MagicMock:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[])
    cdp.get_current_url = AsyncMock(return_value="https://example.com/3")
    cdp.get_page_title = AsyncMock(return_value="Example")
    cdp.get_page_text = AsyncMock(return_value="")
    return cdp

def _done_script():
    from brotto_orchestrator.testing.scripted_planner import (
        ScriptedPlanner, ScriptedStep,
    )
    return ScriptedPlanner(
        [ScriptedStep(thought="done", actions=[ActionCall(
            action="task_complete", action_args={"summary": "ok"})])],
        on_exhausted="task_complete",
    )

def _run_sync(deps: AgentDeps):
    # resume=True: every caller here is exercising the crash-resume path. The
    # default (resume=False) now means "a follow-up task", which starts at
    # step 0 and refuses a document whose run is still in flight.
    async def _go():
        return await AgentHarness().run(deps, resume=True)
    return asyncio.new_event_loop().run_until_complete(_go())

def _deps(cdp, *, task_id: str) -> AgentDeps:
    async def ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="t", task="find the thing", cdp=cdp,
                     task_id=task_id, ws_send=ws_send,
                     scripted_planner=_done_script())

def test_the_loop_continues_at_the_resumed_step(sessions_dir):
    _crashed_run("h1", sessions_dir=sessions_dir, approved_domain="github.com")
    deps = _deps(_cdp(), task_id="h1")
    result = _run_sync(deps)

    assert result.status == "completed"
    # The three restored summaries plus the one the resumed loop added, and
    # the new one is step 3 — not a second run from step 0.
    assert [s.step for s in deps.step_summaries] == [0, 1, 2, 3]
    assert deps.visited_domains == {"github.com", "example.com"}
    # The prior turns survive the resume: a reader must still see what the
    # user approved before the socket died.
    doc = read("h1", dir=sessions_dir)
    assert [t["step"] for t in doc["turns"]] == [0, 1, 2, 3, 3]

def test_a_corrupt_document_runs_nothing(sessions_dir):
    broken = '{"schema_version": 1, "turns": ['
    (sessions_dir / "h2.json").write_text(broken)
    cdp = _cdp()
    deps = _deps(cdp, task_id="h2")
    result = _run_sync(deps)

    assert result.failure_reason == "task_refused"
    assert "corrupt" in result.summary
    # Left exactly as found. It is the only copy of a run nobody can read,
    # and rewriting it would replace that with a valid empty document —
    # reporting "interrupted" by destroying the thing being reported on.
    assert (sessions_dir / "h2.json").read_text() == broken
    assert read("h2", dir=sessions_dir)["corrupt"] is True
    # The whole point: not one action re-run from a document we can't read.
    cdp.get_targets.assert_not_called()
    assert deps.step_summaries == []

def test_a_document_from_another_schema_version_runs_nothing(sessions_dir):
    (sessions_dir / "h3.json").write_text(json.dumps({
        "schema_version": 99, "status": "running", "turns": [
            {"step": 0, "ended_at": "2026-01-01T00:00:00.000+00:00",
             "observation": {"url": "https://example.com"},
             "actions": [{"action": "navigate", "outcome": "Navigated"}]},
        ],
    }))
    cdp = _cdp()
    deps = _deps(cdp, task_id="h3")
    result = _run_sync(deps)

    assert result.failure_reason == "task_refused"
    assert "99" in result.summary
    doc = read("h3", dir=sessions_dir)
    assert doc["status"] == "interrupted"
    # The refusal is recorded ON TOP of the record, not instead of it. The
    # document is the only copy of this run, and "we cannot read it" is not a
    # reason to delete the turns that are in it.
    assert [t["step"] for t in doc["turns"]] == [0]
    assert doc["errors"][0]["code"] == "task_refused"
    cdp.get_targets.assert_not_called()

def test_a_finished_run_keeps_its_turns_when_a_resume_is_refused(sessions_dir):
    """The same, for the ordinary case: a run that already completed and is
    then re-entered with its own session id."""
    t = AuditTrail("h4", dir=sessions_dir)
    t.set_goal("find the thing")
    for step in range(2):
        turn = t.begin_turn(step=step, url=f"https://example.com/{step}",
                            page_title="Example", ax_targets=1, ax_chars=1,
                            ax_diff_chars=0, page_text_chars=0)
        t.record_action(turn, action="navigate", args={}, outcome="Navigated",
                        ok=True, redacted=False, duration_ms=1)
        t.end_turn(turn, timings={})
    t.finish({"status": "completed", "summary": "found it"})
    t.close()

    result = _run_sync(_deps(_cdp(), task_id="h4"))

    assert result.failure_reason == "task_refused"
    doc = read("h4", dir=sessions_dir)
    assert doc["status"] == "interrupted"
    assert [x["step"] for x in doc["turns"]] == [0, 1]
    assert doc["result"]["summary"] == "found it"

# ── stopped vs dropped ──────────────────────────────────────────────────────
#
# A dropped socket and a user cancel look identical to the server: the agent
# task is cancelled either way. These two tests are the pair that keeps them
# apart, and they fail in opposite directions if the flag is wrong.

def _run_then_cancel(task_id: str) -> AgentDeps:
    """Run the harness and cancel its task, the way a closed socket does."""
    cdp = _cdp()
    # Park the loop on its first observation, so the cancel lands mid-step
    # instead of racing a scripted run that finishes in microseconds.
    gate = asyncio.Event()

    async def _never(*_a, **_k):
        await gate.wait()

    cdp.get_targets = AsyncMock(side_effect=_never)
    deps = _deps(cdp, task_id=task_id)

    async def _go() -> AgentDeps:
        task = asyncio.ensure_future(AgentHarness().run(deps, resume=True))
        await asyncio.sleep(0.01)  # let it reach the loop
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await asyncio.sleep(0.01)  # let the sealing callback run
        return deps

    return asyncio.new_event_loop().run_until_complete(_go())

def test_a_dropped_socket_leaves_the_run_resumable(sessions_dir):
    _crashed_run("k1", sessions_dir=sessions_dir)
    _run_then_cancel("k1")
    assert read("k1", dir=sessions_dir)["status"] == "running"
    assert _resume_state("k1")["first_step"] == 3

def test_a_user_cancelled_run_is_sealed_and_never_resumed(sessions_dir):
    _crashed_run("k2", sessions_dir=sessions_dir)
    mark_cancelled("k2")
    _run_then_cancel("k2")
    assert read("k2", dir=sessions_dir)["status"] == "cancelled"
    state = _resume_state("k2")
    assert state["summaries"] == []
    assert "cancelled" in state["why"]

# ── one agent per live session ──────────────────────────────────────────────

@pytest.fixture
def harness_calls(monkeypatch):
    """Stub the harness so a run never ends, and record every invocation."""
    from brotto_orchestrator import main as main_mod
    from brotto_orchestrator.agent import harness as harness_mod

    calls: list[AgentDeps] = []

    async def stub(self, deps, **kwargs):
        calls.append(deps)
        await asyncio.sleep(3600)

    monkeypatch.setattr(harness_mod.AgentHarness, "run", stub)
    monkeypatch.setattr(main_mod.harness, "run", stub.__get__(main_mod.harness))
    return calls

def _drain_until(ws, target_type: str, max_msgs: int = 50) -> dict:
    for _ in range(max_msgs):
        msg = ws.receive_json()
        if msg.get("type") == target_type:
            return msg
    raise AssertionError(f"never saw {target_type!r} after {max_msgs} messages")

def test_a_reconnect_does_not_start_a_second_agent(sessions_dir, harness_calls, session_id):
    """A second socket for a live session is refused, not doubled.

    Two harness.runs on one browser is two agents clicking one tab, each
    seeing half the page. The reconnect that reaches here raced the first
    socket's teardown, so the client cannot prevent it.
    """
    from fastapi.testclient import TestClient

    from brotto_orchestrator import main as main_mod

    with TestClient(main_mod.app) as client:
        with client.websocket_connect(f"/ws/ext/{session_id("dup-live")}") as first:
            first.send_text(json.dumps({"type": "task_start", "task": "go"}))
            # policy_effective is sent after the agent task is registered, so
            # seeing it means the session already has a live agent.
            _drain_until(first, "policy_effective")

            with client.websocket_connect(f"/ws/ext/{session_id("dup-live")}") as second:
                second.send_text(json.dumps({"type": "task_start", "task": "go"}))
                refused = _drain_until(second, "task_failed")
                assert refused["failure_reason"] == "duplicate_task_start"
                assert refused["status"] == "interrupted"
                # And the first agent is still the only one.
                first.send_text(json.dumps({"type": "ping"}))
                assert _drain_until(first, "pong") == {"type": "pong"}

    assert len(harness_calls) == 1

def test_the_refusal_is_recorded_in_the_session_document(sessions_dir, harness_calls, session_id):
    from fastapi.testclient import TestClient

    from brotto_orchestrator import main as main_mod

    # A live agent has flushed at least once, so there is a document for the
    # refusal to land in. (With no document there is nothing to write to —
    # the writer drops events for sessions it has never seen.)
    live = AuditTrail(session_id("dup-logged"), dir=sessions_dir)
    live.set_goal("go")
    live.close()

    with TestClient(main_mod.app) as client:
        with client.websocket_connect(f"/ws/ext/{session_id("dup-logged")}") as first:
            first.send_text(json.dumps({"type": "task_start", "task": "go"}))
            _drain_until(first, "policy_effective")
            with client.websocket_connect(f"/ws/ext/{session_id("dup-logged")}") as second:
                second.send_text(json.dumps({"type": "task_start", "task": "go"}))
                _drain_until(second, "task_failed")

    events = read(session_id("dup-logged"), dir=sessions_dir).get("policy_events", [])
    assert any(e.get("kind") == "duplicate_task_start" for e in events), events

def test_a_reconnect_beat_ing_the_old_socket_is_accepted(sessions_dir, monkeypatch, session_id):
    """A teardown that has begun is not a rival agent.

    The refused case above is two sockets with one healthy agent. This is
    the other shape: the first socket is already unwinding, and the
    reconnect arrives before that unwind finishes — which is what the
    extension's backoff does every time, because a close and an accept
    race. Refusing here would kill the one run that was recoverable.
    """
    from fastapi.testclient import TestClient

    from brotto_orchestrator import main as main_mod
    from brotto_orchestrator.agent import harness as harness_mod

    calls: list[AgentDeps] = []

    async def stub(self, deps, **kwargs):
        calls.append(deps)
        if len(calls) == 1:
            # Self-cancel, then swallow it and stay alive: exactly the state
            # a task is in between socket close and its finally block.
            asyncio.current_task().cancel()
            try:
                await asyncio.sleep(3600)
            except asyncio.CancelledError:
                await asyncio.sleep(3600)
        await asyncio.sleep(3600)

    monkeypatch.setattr(harness_mod.AgentHarness, "run", stub)
    monkeypatch.setattr(main_mod.harness, "run", stub.__get__(main_mod.harness))

    with TestClient(main_mod.app) as client:
        with client.websocket_connect(f"/ws/ext/{session_id("race-live")}") as first:
            first.send_text(json.dumps({"type": "task_start", "task": "go"}))
            _drain_until(first, "policy_effective")
            with client.websocket_connect(f"/ws/ext/{session_id("race-live")}") as second:
                second.send_text(json.dumps({"type": "task_start", "task": "go"}))
                # policy_effective, not task_failed: the guard let it through.
                _drain_until(second, "policy_effective")

    assert len(calls) == 2

def test_a_cancel_frame_marks_the_session_as_user_stopped(sessions_dir, harness_calls, monkeypatch, session_id):
    """The extension says goodbye before closing; the server believes it.

    A closed socket alone cannot say whether the run should be resumable,
    so the intent travels as a frame. This pins both halves of that
    contract from this side: the frame is routed, and it marks the session
    the same document is keyed by.
    """
    from fastapi.testclient import TestClient

    from brotto_orchestrator import main as main_mod

    marked: list[str] = []
    monkeypatch.setattr(main_mod, "mark_cancelled", marked.append)

    with TestClient(main_mod.app) as client:
        with client.websocket_connect(f"/ws/ext/{session_id("cancel-say")}") as ws:
            ws.send_text(json.dumps({"type": "task_start", "task": "go"}))
            _drain_until(ws, "policy_effective")
            ws.send_text(json.dumps({"type": "cancel"}))
            ws.send_text(json.dumps({"type": "ping"}))
            assert _drain_until(ws, "pong") == {"type": "pong"}

    assert marked == [session_id("cancel-say")]
