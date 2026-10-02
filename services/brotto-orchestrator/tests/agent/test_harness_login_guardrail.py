"""The login guardrail is skipped only when a scripted planner is set.

The guardrail exists to ask a *human* to log in, and it waits 300s on
`human_input_queue`. Under a scripted planner there is no human, no model,
and no key — the script carries its own login steps — and `POST /run` has
no reply channel, so nothing ever fills the queue. Left ungated, every
scripted run blocks 300s per step and records a timeout instead of a
measurement.

Both directions are pinned: a scripted planner must not block, and a normal
run must still fire the guardrail (the change is a gate, not a removal).
Neither test sleeps to "prove" a hang — they assert on the return, so the
test suite stays fast either way.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import ActionCall, AgentDecision, AgentDeps
from brotto_orchestrator.agent.harness import AgentHarness
import brotto_orchestrator.agent.harness as harness_mod
import brotto_orchestrator.agent.audit as audit_mod


_COMPLETE = AgentDecision(
    reasoning="done", thought="done",
    actions=[ActionCall(action="task_complete",
                        action_args={"summary": "ok", "extracted_data": None})],
)


class _EmptyResult:
    """Stands in for pydantic-ai's RunResult; `.usage` is read by the harness."""

    usage = None


def _login_deps() -> AgentDeps:
    """Deps whose first observation reads as a login page on every axis
    `check_login_page` consults: title, URL, and AX content."""
    from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget

    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(
        return_value=[SemanticTarget(ref_id="pw", tag="input", role="textbox", name="Password")]
    )
    cdp.get_current_url = AsyncMock(return_value="http://example.com/login")
    cdp.get_page_text = AsyncMock(return_value="")
    cdp.get_page_title = AsyncMock(return_value="Sign in")
    cdp.refresh_target_map = AsyncMock()

    async def ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="t", task="go", cdp=cdp, ws_send=ws_send)


def _stub_plan(monkeypatch) -> None:
    async def _fake_plan(deps, turn, agent, audit=None):
        return _COMPLETE, 400_000, _EmptyResult()

    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)


@pytest.mark.asyncio
async def test_scripted_planner_does_not_block_on_the_login_guardrail(monkeypatch):
    """A login page plus a scripted planner must run to completion.

    `human_input_queue` is never fed. If the guardrail fires it waits 300s,
    so this only returns quickly when the guardrail is skipped — the
    return itself is the assertion, and a regression shows up as a hang or
    a `login_timeout` in the emitted messages rather than a clean pass.
    """
    _stub_plan(monkeypatch)
    deps = _login_deps()
    deps.scripted_planner = object()  # presence is the whole signal
    assert deps.human_input_queue.empty()

    sent: list[dict] = []

    async def ws_send(msg: dict) -> None:
        sent.append(msg)

    deps.ws_send = ws_send

    result = await asyncio.wait_for(AgentHarness().run(deps), timeout=10)

    assert result.status == "completed"
    assert not [m for m in sent if m.get("type") in ("login_required", "login_timeout")]


@pytest.mark.asyncio
async def test_guardrail_still_fires_without_a_scripted_planner(monkeypatch):
    """The gate is a gate, not a deletion: with no planner the guardrail
    still pauses, and the pause is answerable — a queued "skip" ends the
    run with `user_skipped_login` instead of stalling 300s."""
    _stub_plan(monkeypatch)
    deps = _login_deps()
    assert deps.scripted_planner is None

    deps.human_input_queue.put_nowait("skip")

    result = await asyncio.wait_for(AgentHarness().run(deps), timeout=10)

    assert result.status == "failed"
    assert result.failure_reason == "user_skipped_login"


@pytest.mark.asyncio
async def test_the_sign_in_wall_says_where_and_what_for(monkeypatch, tmp_path):
    """The card cannot draw a subject it was never sent.

    `login_required` used to carry one string — "please log in: <title>" —
    and the panel's own fallback label ("this site") was therefore the
    common case, so the wall named no site and no task. Both are on the
    frame now, and both are on the audit prompt, because the transcript a
    session replays is rebuilt from the audit and the live card from the
    frame: a field in only one of them is a card that changes shape the
    moment you reopen the session.
    """
    _stub_plan(monkeypatch)
    sent: list[dict] = []

    deps = _login_deps()
    deps.task = "book the cheapest flight to Lisbon"
    deps.task_id = "login-wall-session"
    deps.human_input_queue.put_nowait("skip")

    async def ws_send(msg: dict) -> None:
        sent.append(msg)

    deps.ws_send = ws_send

    # AuditTrail writes a real file; keep it out of logs/sessions.
    monkeypatch.setattr(audit_mod, "default_dir", lambda: tmp_path)

    await asyncio.wait_for(AgentHarness().run(deps), timeout=10)

    wall = next(m for m in sent if m.get("type") == "login_required")
    assert wall["url"] == "http://example.com/login"
    assert wall["domain"] == "example.com"
    assert wall["page_title"] == "Sign in"
    assert wall["task"] == "book the cheapest flight to Lisbon"

    import json

    doc = json.loads((tmp_path / "login-wall-session.json").read_text())
    prompt = doc["turns"][0]["prompts"][0]
    assert prompt["kind"] == "login_required"
    assert prompt["domain"] == "example.com"
    assert prompt["args"]["url"] == "http://example.com/login"
    assert prompt["args"]["page_title"] == "Sign in"
    assert prompt["args"]["task"] == "book the cheapest flight to Lisbon"
    assert prompt["decision"] == "skipped"


@pytest.mark.asyncio
async def test_a_wall_that_clears_itself_resumes_with_nothing_from_the_user(monkeypatch):
    """The sign-in completed, but nothing told the server.

    The old wait was one `wait_for(queue.get(), 300)` woken by a single
    extension signal, gated on `tabId === activeTabId` *and* on the URL
    changing. A sign-in in an OAuth popup, a second tab, or an SSO form
    that swaps in place trips none of that — the user was signed in and
    the run sat there for the full 300s, which is what "it doesn't continue
    automatically" meant.

    Here nothing is ever put on the queue: the page simply stops looking
    like a login page. This only returns quickly if the server re-checks
    the wall itself, so a regression is a 300s hang rather than a slow
    failure.
    """
    _stub_plan(monkeypatch)
    deps = _login_deps()
    sent: list[dict] = []

    async def ws_send(msg: dict) -> None:
        sent.append(msg)

    deps.ws_send = ws_send

    # The wall is detected, then gone two seconds later. No queue traffic
    # and no user reply at any point.
    reads = {"n": 0}

    async def get_page_title() -> str:
        reads["n"] += 1
        return "Sign in" if reads["n"] <= 1 else "My repositories"

    async def get_current_url() -> str:
        return "http://example.com/login" if reads["n"] <= 1 else "http://example.com/"

    deps.cdp.get_page_title = get_page_title
    deps.cdp.get_current_url = get_current_url

    result = await asyncio.wait_for(AgentHarness().run(deps), timeout=15)

    assert result.status == "completed"
    assert not [m for m in sent if m.get("type") == "login_timeout"]


@pytest.mark.asyncio
async def test_a_stale_resume_cannot_answer_the_next_question():
    """A "resume" the user sent too late must not answer anything.

    `human_input_queue` is shared by the login wall, approvals and
    `ask_human`. The extension pushes "resume" from a navigation event it
    saw; if the server had already resumed by its own page check, that item
    is still queued, and the next approval would read it as a yes. So the
    wait drops an orphan "resume" — and only that, because a "skip" or a
    typed answer in the queue is always a real one.
    """
    from brotto_orchestrator.agent.harness import _await_login

    cdp = MagicMock()
    # Still a wall, so the only way out is the queue — and the queue's
    # "resume" is the orphan that must not count as an answer.
    cdp.get_page_title = AsyncMock(return_value="Sign in")
    cdp.get_current_url = AsyncMock(return_value="http://example.com/login")

    deps = _login_deps()
    deps.cdp = cdp
    deps.human_input_queue.put_nowait("resume")

    # The orphan was dropped, so nothing answers the wall and the wait runs
    # out its own short deadline rather than returning the queued "resume".
    assert await _await_login(deps, cdp, timeout=0.3, poll=0.05) is None

    # A genuine reply is not collateral: it is still there to be read.
    deps2 = _login_deps()
    deps2.cdp = cdp
    deps2.human_input_queue.put_nowait("skip")
    assert await _await_login(deps2, cdp, timeout=5, poll=0.05) == "skip"
