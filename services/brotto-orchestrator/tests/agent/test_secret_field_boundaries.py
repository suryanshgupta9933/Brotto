"""Two false positives that ended a run on a canvas app (Google Sheets).

(a) An unresolvable ref. `_redact_if_secret` returned True — "cannot classify
    means redact" — and the caller latched `run_secrets`, which is RUN-WIDE.
    `redactions` is per-step; a false positive there clears next step, one in
    `run_secrets` does not. Every typed cell on a canvas has a ref that
    resolves to nothing, so the first keystroke killed the pixel delta — the
    only channel a canvas page has — for the rest of the run.

(b) Mid-word matching in `_SECRET_NAME_RE`. `author`, `secretary`,
    `tokenize` and an exported `Session ID` column header are ordinary words
    on a document app, and each one latched the same permanent veto.

The veto rule itself is unchanged: `redactions or run_secrets` still blocks
both the delta and the screenshot (`_capture_page`, `harness.py:2212`). What
changed is that an ABSENCE OF EVIDENCE is no longer promoted to a finding.
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.audit import is_secret_field
from brotto_orchestrator.agent.context import (
    ActionCall, AgentDecision, AgentDeps, TaskResult,
)
from brotto_orchestrator.agent.harness import (
    AgentHarness, _redact_if_secret, _redact_press_key,
)
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
import brotto_orchestrator.agent.harness as harness_mod


# --- (a) the unresolvable ref -------------------------------------------

def _deps_with_targets(targets):
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=targets)
    cdp.get_current_url = AsyncMock(return_value="https://example.com/sheet")
    cdp.get_page_text = AsyncMock(return_value="")
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Untitled spreadsheet")
    cdp.refresh_target_map = AsyncMock()

    async def ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="t", task="type", cdp=cdp, ws_send=ws_send,
                     prev_targets=list(targets))


@pytest.mark.asyncio
async def test_an_unresolvable_ref_redacts_the_value():
    """Fail closed on the VALUE. It could be a password field and nothing
    here can tell it from a spreadsheet cell — this is the same direction
    `type_xy` (no DOM field at all) already fails in."""
    deps = _deps_with_targets([SemanticTarget(ref_id="0:1", tag="button", role="button", name="Save")])
    redact, latch = await _redact_if_secret(deps, "9:999")
    assert redact is True


@pytest.mark.asyncio
async def test_an_unresolvable_ref_does_not_latch_the_run():
    """The second element is a different claim. Absence of evidence is not
    evidence: latching here vetoes the delta and the screenshot for every
    remaining step, and on a canvas app every typed cell looks exactly like
    this."""
    deps = _deps_with_targets([SemanticTarget(ref_id="0:1", tag="button", role="button", name="Save")])
    _redact, latch = await _redact_if_secret(deps, "9:999")
    assert latch is False


@pytest.mark.asyncio
async def test_a_named_secret_field_still_latches_the_run():
    """The other half of the pair. A field we DID see, and whose name says
    password, is a finding — and it stays permanent for the run."""
    deps = _deps_with_targets([
        SemanticTarget(ref_id="0:2", tag="input", role="textbox",
                       name="Password")])
    redact, latch = await _redact_if_secret(deps, "0:2")
    assert redact is True and latch is True


@pytest.mark.asyncio
async def test_a_blank_name_with_no_attrs_still_latches():
    """A field with no accessible name and no DOM signal is unclassifiable,
    and unclassifiable is still a field we saw — the ponytail ceiling in the
    docstring. Only the *ref* is different."""
    deps = _deps_with_targets([SemanticTarget(ref_id="0:2", tag="input", role="textbox", name="")])
    redact, latch = await _redact_if_secret(deps, "0:2")
    assert redact is True and latch is True


@pytest.mark.asyncio
async def test_pressing_a_literal_key_still_latches():
    """`press_key` has no ref, so it is a (True, answer) pair — the shape
    change must not have quietly turned it into a never-latch."""
    deps = _deps_with_targets([])
    deps.cdp.focused_attributes = AsyncMock(return_value={"type": "password"})
    assert await _redact_press_key(deps) is True


@pytest.mark.asyncio
async def test_a_canvas_step_keeps_the_pixel_delta(monkeypatch):
    """End to end, and the reason the whole thing matters: the run types into
    a synthetic ref, and `get_page_delta` is still called on the next step.
    This is the assertion that fails on the old code."""
    calls: list[int] = []

    async def _fake_execute(call, deps, audit=None, turn=None, **_ignored):
        if call.action == "task_complete":
            deps.result = TaskResult(status="completed", summary="ok")
        return f"{call.action} done"

    async def _fake_plan(deps, turn, agent, audit=None):
        calls.append(1)
        deps.result = None
        if len(calls) == 1:
            return AgentDecision(
                reasoning="type", thought="Typing into the cell.",
                actions=[ActionCall(action="type_text",
                                    action_args={"ref": "9:1", "text": "Q3"})],
            ), 400_000, None
        return AgentDecision(
            reasoning="done", thought="done",
            actions=[ActionCall(action="task_complete",
                                action_args={"summary": "ok",
                                             "extracted_data": None})],
        ), 400_000, None

    monkeypatch.setattr(harness_mod, "_execute_action", _fake_execute)
    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)

    deps = _deps_with_targets([SemanticTarget(ref_id="0:1", tag="button", role="button", name="Save")])
    await asyncio.wait_for(AgentHarness().run(deps), timeout=10)

    # The value is still redacted out of the audit — only the run-wide latch
    # was dropped, and the veto on it is untouched.
    written = json.dumps([s.extracted for s in deps.step_summaries])
    assert "Q3" not in written
    # The harness hands `run_secrets` to the relay, which is where the veto
    # lives, so this is the observable that says the run still has a channel.
    assert deps.cdp.get_page_delta.await_count >= 1
    for call_ in deps.cdp.get_page_delta.await_args_list:
        assert not call_.kwargs["run_secrets"], (
            "a ref that resolved to nothing latched the run-wide veto, which "
            "kills the pixel delta — the only channel a canvas page has")


# --- (b) boundaries in _SECRET_NAME_RE -----------------------------------

@pytest.mark.parametrize("label", [
    "Password", "Password1", "Password confirmation", "Passcode",
    "Passphrase", "One-time code", "One time password", "OTP", "PIN",
    "pin code", "API key", "api_key", "Api Key", "Authorization", "Auth",
    "auth token", "AuthToken", "auth_token", "Bearer", "Bearer token",
    "Credential", "credentials", "access_token", "refresh_token",
    "csrf_token", "X-CSRF-Token", "private key", "private_key",
    "Session ID", "session_id", "SessionID", "Recovery code",
    "verification code", "security code", "Confirmation code",
    "backup code", "Client Secret", "clientSecret", "apiToken",
    "myPassword", "secret_key", "user_password", "My Password Field",
])
def test_a_real_secret_label_still_matches(label):
    """A boundary that silences the false positive by also silencing the real
    one is worse than the bug. One entry per rule, plus the compounds."""
    assert is_secret_field(None, label), f"{label!r} stopped matching"


@pytest.mark.parametrize("label", [
    "author", "Authority", "authority", "Authenticated", "authenticate",
    "secretary", "Secretariat", "tokenize", "TokenBucket", "tokenizer",
    "sessionIdentifier", "Session Name",
])
def test_an_ordinary_word_does_not_match(label):
    assert not is_secret_field(None, label), f"{label!r} matched mid-word"


def test_type_password_still_wins_without_any_name():
    """The definitive signal is untouched; the name rules only ever add."""
    assert is_secret_field({"type": "password"}, "")
    assert not is_secret_field({"type": "text"}, "Search")
