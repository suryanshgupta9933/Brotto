"""A pressed character must not reach the audit document or the prompt.

`5df2cc92` established that a character typed with `press_key` can land in a
password field, so the key value can be a secret. The args were already masked
by `_scrubbed`; the outcome string — which becomes `StepSummary.outcome` and is
rendered back into `<step_history untrusted>` next step — echoed it verbatim,
so `press_key("q")` into a focused PIN box wrote the credential to disk.

Two separate guards, so two separate assertions below:
  1. the branch does not echo a single-character key at all;
  2. `_summarise_outcome` substitutes this run's typed secrets, which is what
     catches an arbitrary password `redact_text` has no rule for.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import ActionCall, AgentDeps
from brotto_orchestrator.agent.harness import (
    _execute_action, _history_line, _summarise_outcome, WITHHELD,
)

SECRET = "hunter2"


def _deps() -> AgentDeps:
    cdp = MagicMock()
    cdp.press_key = AsyncMock(return_value="pressed")
    cdp.refresh_target_map = AsyncMock()

    async def ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="t", task="t", cdp=cdp, ws_send=ws_send)


@pytest.mark.asyncio
async def test_a_pressed_character_is_not_echoed_into_the_outcome():
    deps = _deps()
    outcome = await _execute_action(
        ActionCall(action="press_key", action_args={"key": "q", "modifiers": 0}),
        deps)
    assert "q" not in outcome, f"the literal key survived: {outcome!r}"
    assert "character" in outcome


@pytest.mark.asyncio
async def test_a_named_key_is_still_echoed():
    """Over-redaction breaks every search submission — the key is the only
    way the model can tell Enter from Escape."""
    deps = _deps()
    outcome = await _execute_action(
        ActionCall(action="press_key", action_args={"key": "Enter"}), deps)
    assert outcome == "Pressed Enter"


def test_a_run_secret_does_not_reach_the_stored_outcome():
    """An arbitrary password has no pattern for `redact_text` to match; only
    the run-wide list knows it."""
    outcome = _summarise_outcome([f"Pressed {SECRET}"], [SECRET])
    assert SECRET not in outcome
    assert WITHHELD in outcome


def test_a_run_secret_in_the_refusal_tail_is_scrubbed_too():
    """The refusal tail is rebuilt from the raw outcomes and spliced back in
    after the cap — the one place a substitution could be forgotten."""
    long = "x" * 300
    outcome = _summarise_outcome(
        [long, f"Clicked [0:1]: Error executing: refused {SECRET}"], [SECRET])
    assert SECRET not in outcome


def test_the_secret_never_reaches_the_rendered_history_line():
    from brotto_orchestrator.agent.context import StepSummary

    s = StepSummary(step=1, url="https://a.test/",
                    action_taken="press_key",
                    outcome=_summarise_outcome([f"Pressed {SECRET}"], [SECRET]))
    assert SECRET not in _history_line(s)
    assert SECRET not in _summarise_outcome([f"Pressed {SECRET}"], [SECRET])