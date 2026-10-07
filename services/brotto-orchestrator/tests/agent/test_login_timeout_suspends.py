"""The five-minute sign-in wait has to end the run, not restart the question.

`_await_login` gives the user 300 seconds to sign in. On timeout the loop used
to `continue`, which re-ran the observation, re-raised the same wall and asked
again — and again, up to MAX_STEPS — so walking away from a sign-in bought a
re-prompt every five minutes against a clock nobody was watching.

The fix suspends instead, which only works if three things hold together, and
none of them is visible from a single function:

  * the loop *returns* rather than continuing;
  * `suspended` is a status the panel can name, and
  * `suspended` is NOT in `_TERMINAL_DOC_STATUSES`, or `_resume_state` refuses
    the very document the Resume button exists to continue.

The third is the one that reads clean in review — it is an absence in a set
literal, and adding it would look like tidying.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.audit import AuditTrail, read
from brotto_orchestrator.agent.context import ActionCall, AgentDeps
from brotto_orchestrator.agent.harness import (
    _TERMINAL_DOC_STATUSES,
    AgentHarness,
    _resume_state,
)


@pytest.fixture
def sessions_dir(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setenv("BROTTO_SESSIONS_DIR", str(tmp_path))
    return tmp_path


def _login_cdp() -> MagicMock:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[])
    cdp.get_current_url = AsyncMock(return_value="https://app.example.com/login")
    cdp.get_page_text = AsyncMock(return_value="")
    # What `check_login_page` keys on. It has to stay true for the whole run
    # or the loop walks straight past the wall this test is about.
    cdp.get_page_title = AsyncMock(return_value="Sign in")
    cdp.refresh_target_map = AsyncMock()
    return cdp


async def _run_until_login_times_out(monkeypatch):
    """One run that hits the wall and times out on the first step.

    No scripted planner: the guardrail is skipped when there is one, by
    design — there is no human to ask. That is convenient here, because the
    wall is detected in the observe phase, before any model is resolved, so
    this reaches the branch with no key and no network.
    """
    from brotto_orchestrator.agent import harness as H
    from brotto_orchestrator.agent.audit import default_dir

    sent: list[dict] = []

    async def ws_send(msg: dict) -> None:
        sent.append(msg)

    async def _timed_out(*_a, **_k):
        return None

    # The 300s is the real wait; shortened so the test does not spend five
    # minutes proving the harness can count to 300.
    monkeypatch.setattr(H, "_await_login", _timed_out)

    deps = AgentDeps(
        user_id="t", task="log in and report", cdp=_login_cdp(),
        ws_send=ws_send, human_input_queue=asyncio.Queue(),
    )
    result = await AgentHarness().run(deps)
    # Found rather than named, so this does not rot when the id scheme moves.
    files = sorted(default_dir().glob("*.json"))
    return result, sent, files


async def test_a_wall_the_user_walked_away_from_suspends_the_run(monkeypatch):
    result, sent, _ = await _run_until_login_times_out(monkeypatch)

    assert result.status == "suspended", result
    assert result.failure_reason == "login_timeout", result
    # One wall, one timeout. The old `continue` re-raised this every step the
    # user stayed away, so the count is the bug.
    assert len([m for m in sent if m.get("type") == "login_required"]) == 1
    assert len([m for m in sent if m.get("type") == "login_timeout"]) == 1


async def test_the_timeout_frame_carries_what_the_resume_card_needs(monkeypatch):
    _, sent, _ = await _run_until_login_times_out(monkeypatch)
    frame = next(m for m in sent if m["type"] == "login_timeout")
    # The panel draws the card from these. With the prose `message` alone —
    # which is what the frame used to send — it had a subject and nothing
    # else, the same defect `login_required` had before it started sending
    # url and task.
    for key in ("url", "domain", "page_title", "task"):
        assert frame.get(key), f"login_timeout is missing {key}: {frame}"


async def test_a_suspended_run_leaves_a_document_resume_will_take(monkeypatch):
    _, _, files = await _run_until_login_times_out(monkeypatch)
    # Found rather than named, so this does not rot when the id scheme moves.
    assert len(files) == 1, [f.name for f in files]
    session_id = files[0].stem

    doc = read(session_id)
    assert doc["status"] == "suspended", doc["status"]
    # The contract itself: `_resume_state` refuses a terminal document and
    # trusts nothing else it can parse.
    assert "suspended" not in _TERMINAL_DOC_STATUSES
    assert _resume_state(session_id)["why"] == ""


@pytest.mark.parametrize("status", sorted(_TERMINAL_DOC_STATUSES))
def test_every_other_status_stays_refusable(sessions_dir, status):
    """The other half of the pair above. Without it, "just drop the set"
    would read as the fix: a run that ended must still refuse a resume."""
    trail = AuditTrail("s2", dir=sessions_dir)
    trail.set_goal("g")
    trail.begin_turn(step=0, url="u", page_title="t", ax_targets=1,
                     ax_chars=1, ax_diff_chars=0, page_text_chars=1)
    trail.set_status(status)
    trail.close()

    assert _resume_state("s2")["why"] != "", status