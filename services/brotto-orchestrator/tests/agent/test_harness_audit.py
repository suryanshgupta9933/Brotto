"""The audit trail, driven end to end through `AgentHarness.run`.

`agent/audit.py`'s own tests (test_audit.py) cover the writer. These
cover the harness half: that the loop actually opens a turn, records
the model call, records every action, records the prompt the user
answered, and — the one that matters most — never writes a typed
credential to disk.

The runs use `ScriptedPlanner` so there is no model, no key and no
network, exactly like tests/test_agent_e2e.py.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.audit import REDACTED, read
from brotto_orchestrator.agent.context import ActionCall, AgentDeps
from brotto_orchestrator.agent.harness import AgentHarness
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget

PASSWORD = "hunter2"


# ── fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture
def sessions_dir(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    return tmp_path


def _cdp(targets, *, attributes: dict | None = None,
         dead_relay: bool = False, url: str = "https://app.example.com/login") -> MagicMock:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=list(targets))
    cdp.get_current_url = AsyncMock(return_value=url)
    cdp.get_page_text = AsyncMock(return_value="")
    cdp.get_page_title = AsyncMock(return_value="Sign in")
    cdp.refresh_target_map = AsyncMock()
    cdp.focus_ref = AsyncMock()
    cdp.clear_ref = AsyncMock()
    cdp.type_text_to_ref = AsyncMock(return_value="ok")
    cdp.click_ref = AsyncMock(return_value="clicked")
    cdp.get_attributes = AsyncMock(
        # A relay that cannot answer returns {} by contract — that is the
        # case `_redact_if_secret` has to survive, not a crash.
        side_effect=(lambda *_a, **_k: {} if dead_relay else (attributes or {})),
    )
    return cdp


def _target(ref: str, name: str, *, node_id: int | None = 1) -> SemanticTarget:
    return SemanticTarget(ref_id=ref, tag="input", role="textbox", name=name,
                          backend_node_id=node_id)


def _script(steps: list[tuple[str, list[ActionCall]]]):
    from brotto_orchestrator.testing.scripted_planner import ScriptedPlanner, ScriptedStep
    return ScriptedPlanner(
        [ScriptedStep(thought=t, actions=a) for t, a in steps],
        on_exhausted="task_complete",
    )


def _type_then_done(text: str, ref: str = "pw") -> object:
    return _script([
        ("type it", [ActionCall(action="type_text",
                                action_args={"ref": ref, "text": text})]),
        ("done", [ActionCall(action="task_complete",
                             action_args={"summary": "ok", "extracted_data": None})]),
    ])


def _deps(cdp, *, planner, replies=("yes", "yes", "yes", "yes")) -> AgentDeps:
    q: asyncio.Queue = asyncio.Queue()
    for r in replies:
        q.put_nowait(r)

    async def ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="t", task="log in and report", cdp=cdp,
                     ws_send=ws_send, human_input_queue=q,
                     scripted_planner=planner)


def _run_sync(deps: AgentDeps):
    async def _go():
        return await AgentHarness().run(deps)
    return asyncio.new_event_loop().run_until_complete(_go())


# ── the document ────────────────────────────────────────────────────────────


def test_prompt_is_recorded_in_order_under_its_turn(sessions_dir):
    doc = read(_login_and_click(), dir=sessions_dir)
    assert doc["turns"], "the run recorded no turns"
    turn = doc["turns"][0]
    keys = list(turn.keys())
    assert keys.index("model") < keys.index("prompts") < keys.index("actions")


def test_every_turn_carries_token_counts(sessions_dir):
    doc = read(_login_and_click(), dir=sessions_dir)
    for turn in doc["turns"]:
        assert "model" in turn and turn["model"] is not None
        assert turn["model"]["tokens_in"] >= 0
        assert turn["model"]["tokens_out"] >= 0


def test_totals_equal_the_sum_of_the_turns(sessions_dir):
    doc = read(_login_and_click(), dir=sessions_dir)
    assert doc["totals"]["tokens_in"] == sum(
        t["model"]["tokens_in"] for t in doc["turns"] if t.get("model")
    )
    assert doc["totals"]["steps"] == len(doc["turns"])


def test_result_is_recorded(sessions_dir):
    doc = read(_login_and_click(), dir=sessions_dir)
    assert doc["result"]["status"] in {"completed", "failed"}
    assert doc["status"] == doc["result"]["status"]


def test_actions_of_every_turn_are_recorded_not_just_the_first(sessions_dir):
    """log_step wrote one flat row carrying only the first action's args.
    The document carries all of them — that is the difference."""
    doc = read(_login_and_click(), dir=sessions_dir)
    typed = [a for t in doc["turns"] for a in t["actions"]
             if a["action"] == "type_text"]
    assert len(typed) == 2, f"expected both typed values, got {typed}"


# ── approvals ───────────────────────────────────────────────────────────────


def test_approval_records_the_users_answer(sessions_dir):
    doc = read(_denied_critical_click(), dir=sessions_dir)
    prompts = [p for t in doc["turns"] for p in t["prompts"]]
    assert prompts, "an approval was raised but nothing was recorded"
    assert prompts[0]["decision"] == "denied"
    assert prompts[0]["status"] == "answered"
    assert prompts[0]["wait_ms"] is not None
    # And the deny still aborted — the consolidation must not have
    # changed the deny-aborts contract.
    assert doc["result"]["failure_reason"] == "user_denied"


def test_approved_prompt_and_the_action_that_followed_are_both_recorded(sessions_dir):
    doc = read(_login_and_click(), dir=sessions_dir)
    prompts = [p for t in doc["turns"] for p in t["prompts"]]
    clicks = [a for t in doc["turns"] for a in t["actions"]
              if a["action"] == "click"]
    assert prompts and clicks
    assert prompts[0]["decision"] == "approved"
    assert clicks[0]["ok"] is True


# ── redaction ───────────────────────────────────────────────────────────────


def test_typed_password_is_redacted_but_its_length_survives(sessions_dir):
    doc = read(_typing(PASSWORD, attributes={"type": "password"}), dir=sessions_dir)
    typed = [a for t in doc["turns"] for a in t["actions"]
             if a["action"] == "type_text"]
    assert typed, "the scripted task typed nothing"
    assert typed[0]["args"]["text"] == REDACTED
    assert typed[0]["args"]["text_chars"] == len(PASSWORD)
    assert typed[0]["redacted"] is True
    # The literal must not appear anywhere in the file.
    assert PASSWORD not in json.dumps(doc)


def test_password_is_redacted_on_the_accessible_name_alone(sessions_dir):
    """`type=password` is definitive but only exists when the DOM lookup
    answered. The accessible name is the fallback that costs nothing."""
    doc = read(_typing(PASSWORD, attributes={}), dir=sessions_dir)
    typed = [a for t in doc["turns"] for a in t["actions"]
             if a["action"] == "type_text"]
    assert typed[0]["args"]["text"] == REDACTED
    assert PASSWORD not in json.dumps(doc)


def test_redaction_still_happens_when_the_dom_lookup_fails(sessions_dir):
    """Review Focus #4: a blank accessible name AND no attributes is the
    one case where a naive implementation writes a plaintext credential.
    There is no signal left to classify on, so it redacts."""
    doc = read(_typing(PASSWORD, target_name="", dead_relay=True), dir=sessions_dir)
    typed = [a for t in doc["turns"] for a in t["actions"]
             if a["action"] == "type_text"]
    assert typed, "the scripted task typed nothing"
    assert typed[0]["args"]["text"] == REDACTED
    assert PASSWORD not in json.dumps(doc)


def test_ordinary_typed_text_is_not_redacted(sessions_dir):
    doc = read(_typing("dev@example.com", attributes={"type": "email"},
                       target_name="Email"), dir=sessions_dir)
    typed = [a for t in doc["turns"] for a in t["actions"]
             if a["action"] == "type_text"]
    assert typed[0]["args"]["text"] == "dev@example.com"
    assert typed[0]["redacted"] is False


def test_a_redacted_value_never_reaches_the_step_trace(sessions_dir):
    """The trace is the second write path: it formats action_args into a
    StepSummary, which goes into the next step's prompt and into whatever
    a resume replays."""
    doc = read(_typing(PASSWORD, attributes={"type": "password"}), dir=sessions_dir)
    assert REDACTED in json.dumps(doc["turns"][0]["actions"])
    assert PASSWORD not in json.dumps(doc)


def test_step_summary_trace_is_scrubbed(sessions_dir):
    """Same guarantee at the source, not just in the document."""
    doc_id, summaries = _plan_and_capture_summaries()
    doc = read(doc_id, dir=sessions_dir)
    assert summaries, "the run produced no step summaries"
    assert PASSWORD not in json.dumps([s.model_dump() for s in summaries])
    assert PASSWORD not in json.dumps(doc)


# ── the writer must not be able to stop the agent ───────────────────────────


def test_audit_survives_an_unwritable_directory_without_failing_the_task(
    tmp_path, monkeypatch
):
    """A real AuditTrail on a directory it cannot create — the writer's
    every call fails, and the task still finishes."""
    not_a_dir = tmp_path / "afile"
    not_a_dir.write_text("x")
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(not_a_dir))
    deps = _deps(_cdp([_target("ok", "OK")], attributes={"type": "text"}),
                 planner=_script([("done", [ActionCall(
                     action="task_complete",
                     action_args={"summary": "ok", "extracted_data": None})])]))
    result = _run_sync(deps)
    assert result.status == "completed"


# ── scripted runs ───────────────────────────────────────────────────────────
#
# Each helper runs a task and returns the session id, so every test above
# reads a document that was produced by a real `AgentHarness.run`.


def _run_and_return_session_id(deps: AgentDeps) -> str:
    import uuid
    deps.task_id = f"sess-{uuid.uuid4().hex[:8]}"
    _run_sync(deps)
    return deps.task_id


def _login_and_click() -> str:
    """Two typed values and a click, with a critical-action approval in the
    middle. Approve answers are pre-seeded so the run terminates."""
    cdp = _cdp(
        [_target("pw", "Password"), _target("mail", "Email")],
        attributes={"type": "password"},
    )
    planner = _script([
        ("password", [ActionCall(action="type_text",
                                 action_args={"ref": "pw", "text": PASSWORD})]),
        ("delete it", [ActionCall(action="click",
                                  action_args={"ref": "del",
                                               "description": "delete account"})]),
        ("email", [ActionCall(action="type_text",
                              action_args={"ref": "mail", "text": "dev@example.com"})]),
        ("done", [ActionCall(action="task_complete",
                             action_args={"summary": "ok", "extracted_data": None})]),
    ])
    return _run_and_return_session_id(_deps(cdp, planner=planner))


def _denied_critical_click() -> str:
    cdp = _cdp([_target("del", "Delete account")], attributes={"type": "button"})
    planner = _script([
        ("delete it", [ActionCall(action="click",
                                  action_args={"ref": "del",
                                               "description": "delete account"})]),
        ("never reached", [ActionCall(action="task_complete", action_args={})]),
    ])
    return _run_and_return_session_id(_deps(cdp, planner=planner, replies=("no",)))


def _typing(text: str, *, attributes=None, target_name="Password",
            dead_relay: bool = False) -> str:
    cdp = _cdp([_target("pw", target_name)], attributes=attributes,
               dead_relay=dead_relay)
    return _run_and_return_session_id(
        _deps(cdp, planner=_type_then_done(text)))


def _plan_and_capture_summaries() -> tuple[str, list]:
    """Run a scripted type_text and return (session id, the StepSummaries the
    run produced) — the trace is the second write path, so both have to be
    checked from the same run."""
    import uuid
    cdp = _cdp([_target("pw", "Password")], attributes={"type": "password"})
    deps = _deps(cdp, planner=_type_then_done(PASSWORD))
    deps.task_id = f"sess-{uuid.uuid4().hex[:8]}"
    _run_sync(deps)
    return deps.task_id, list(deps.step_summaries)
