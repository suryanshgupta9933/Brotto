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
