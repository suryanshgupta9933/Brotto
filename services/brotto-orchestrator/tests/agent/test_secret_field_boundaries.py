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

(c) A blank accessible name with no attributes, which is what a canvas cell
    looks like: the same absence of evidence as (a), reaching the latch
    through a different branch, and it poisoned the run the same way.

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
    _AMBIGUOUS_PIXEL_WINDOW, AgentHarness, _redact_if_secret,
    _redact_press_key,
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
async def test_a_blank_name_with_no_attrs_redacts_the_value():
    """A canvas cell: no accessible name, no DOM signal. Fail closed on the
    VALUE — a canvas can be a password widget and nothing here can tell it
    from a spreadsheet cell."""
    deps = _deps_with_targets([SemanticTarget(ref_id="0:2", tag="input", role="textbox", name="")])
    redact, _latch = await _redact_if_secret(deps, "0:2")
    assert redact is True


@pytest.mark.asyncio
async def test_a_blank_name_with_no_attrs_does_not_latch_the_run():
    """The live-run bug. Latching here vetoed the page delta and the
    screenshot for every remaining step of a Sheets run, because every typed
    cell on a canvas lands in this branch. Absence of evidence is not
    evidence — the same line the unresolvable ref draws."""
    deps = _deps_with_targets([SemanticTarget(ref_id="0:2", tag="input", role="textbox", name="")])
    _redact, latch = await _redact_if_secret(deps, "0:2")
    assert latch is False


@pytest.mark.asyncio
async def test_a_password_typed_by_its_type_still_latches():
    """The escape-hatch check on that narrowing: `type="password"` is the
    definitive signal and it still reaches the latch, named or not. A blank
    name cannot suppress it."""
    deps = _deps_with_targets([
        SemanticTarget(ref_id="0:3", tag="input", role="textbox", name="",
                       backend_node_id=42)])
    deps.cdp.get_attributes = AsyncMock(return_value={"type": "password"})
    redact, latch = await _redact_if_secret(deps, "0:3")
    assert redact is True and latch is True


@pytest.mark.asyncio
async def test_pressing_a_literal_key_still_latches():
    """`press_key` has no ref, so it is a pair: no focused-element signal
    redacts, and a `type="password"` focused field latches."""
    deps = _deps_with_targets([])
    deps.cdp.focused_attributes = AsyncMock(return_value={"type": "password"})
    redact, latch = await _redact_press_key(deps)
    assert redact is True and latch is True


@pytest.mark.asyncio
async def test_pressing_a_literal_key_with_no_signal_does_not_latch():
    """No relay implements `focused_attributes()` yet, so every Enter key on
    a canvas has no signal — latching there is the same poisoned run."""
    deps = _deps_with_targets([])
    del deps.cdp.focused_attributes
    redact, latch = await _redact_press_key(deps)
    assert redact is True and latch is False


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
        if len(calls) <= 2 + _AMBIGUOUS_PIXEL_WINDOW:
            return AgentDecision(
                reasoning="look", thought="Looking.",
                actions=[],
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
    assert deps.cdp.get_page_delta.await_count > _AMBIGUOUS_PIXEL_WINDOW
    latches = [c.kwargs["run_secrets"]
               for c in deps.cdp.get_page_delta.await_args_list]
    assert not latches[0], (
        "step 0 observed before the keystroke; nothing was typed yet")
    assert latches[1:], (
        "a ref that resolved to nothing latched the run-wide veto, which "
        "kills the pixel delta — the only channel a canvas page has")
    # ...but an ambiguous write is not nothing. A value cannot have been
    # rendered before it was typed, so the shutter is shut for the step the
    # keystroke happened on and the `_AMBIGUOUS_PIXEL_WINDOW` steps after it,
    # and then it opens. See `_PixelVeto`.
    assert all(latches[1:1 + _AMBIGUOUS_PIXEL_WINDOW])
    assert not any(latches[1 + _AMBIGUOUS_PIXEL_WINDOW:]), (
        "the window never closed — a canvas run loses its only channel")


# --- (b) boundaries in the secret-name matcher ----------------------------

# ONE declared set, asserted in both directions by the property test below.
# Every label here is a decision, so a boundary change cannot quietly move
# one without failing a single assertion.

TRUE_POSITIVES = [
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
    # The regression: a trailing boundary fires after the SHORT alternative
    # (`session[-_ ]?id` inside "identifier", `pin` inside "pinNumber"), so
    # these four shapes were false negatives in a credential detector.
    "Session identifier", "sessionIdentifier", "SESSION_IDENTIFIER",
    "authorizationCode", "Authorization code", "pinNumber", "PIN number",
    "one-time code", "OneTimeCode", "apiKey", "API key", "access_token",
    # Not a bare field name: the clarify question reaches here whole, so a
    # compound has to be found inside a run of words, not across the label.
    "what's the verification code?",
]

NEGATIVES = [
    "author", "Authority", "authority", "Authenticated", "authenticate",
    "secretary", "Secretariat", "tokenize", "TokenBucket", "tokenizer",
    "Session Name", "Name", "Age", "Cell A1",
]


@pytest.mark.parametrize("label", TRUE_POSITIVES)
def test_a_real_secret_label_still_matches(label):
    """A boundary that silences the false positive by also silencing the real
    one is worse than the bug. One entry per rule, plus the compounds."""
    assert is_secret_field(None, label), f"{label!r} stopped matching"


@pytest.mark.parametrize("label", NEGATIVES)
def test_an_ordinary_word_does_not_match(label):
    assert not is_secret_field(None, label), f"{label!r} matched mid-word"


def test_positives_and_negatives_hold_in_one_place():
    """The property: the two declared lists are the whole contract, checked
    in both directions by one test, so the suite goes red if EITHER side
    drifts. Parametrised tests above fail identically; this fails first and
    names the class of failure — a shape that is neither caught nor cleared.
    """
    missed = [n for n in TRUE_POSITIVES if not is_secret_field(None, n)]
    overmatched = [n for n in NEGATIVES if is_secret_field(None, n)]
    assert not missed, f"secret fields no longer caught: {missed}"
    assert not overmatched, f"ordinary words now matched: {overmatched}"


def test_every_declared_label_is_in_exactly_one_list():
    """The lists are a partition. An overlap means a label is asserted
    twice in opposite directions, and a gap means someone added a case
    without saying which side it is on."""
    both = set(TRUE_POSITIVES) & set(NEGATIVES)
    assert not both, f"listed as both: {sorted(both)}"


def test_type_password_still_wins_without_any_name():
    """The definitive signal is untouched; the name rules only ever add."""
    assert is_secret_field({"type": "password"}, "")
    assert not is_secret_field({"type": "text"}, "Search")
