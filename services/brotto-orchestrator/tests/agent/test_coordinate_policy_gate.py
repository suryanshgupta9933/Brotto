"""The policy gate in front of a coordinate action.

There is no local one. `click_xy` reaches the step loop's curated-list guard
like every other action does — `check_sensitive_action` over the verb joined
to `{x, y, label}` — and that is where it is enforced. What this file pins is
that the path does not refuse its way around that guard.

An earlier version of this code refused a coordinate click outright whenever
`sensitive_actions` was non-empty, on the argument that a point the model
chose cannot be matched against the list with any honesty. It cost the
feature: `Policy()` ships twelve patterns, so "non-empty" was true on every
default install and every coordinate click refused. The tests below encode the
rule the rest of the harness already uses.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import ActionCall, AgentDeps
from brotto_orchestrator.agent.guardrails import (
    check_critical_action,
    check_sensitive_action,
)
from brotto_orchestrator.agent.harness import (
    _EXEC_FAILURE,
    _coordinate_action,
)
from brotto_orchestrator.policy.gate import SCREENSHOT_CAPTURE_ENV
from brotto_orchestrator.policy.schema import Policy


@pytest.fixture(autouse=True)
def _enabled(monkeypatch):
    monkeypatch.setenv("BROTTO_COORDINATE_CLICK", "1")
    monkeypatch.setenv(SCREENSHOT_CAPTURE_ENV, "on")


def _deps(policy: Policy | None = None, reply: str = "approve"):
    cdp = MagicMock()
    cdp.probe_xy = AsyncMock(return_value={"width": 800, "height": 600,
                                           "tag": "CANVAS"})
    cdp.get_current_url = AsyncMock(return_value="https://example.com/sheet")
    cdp.click_xy = AsyncMock(return_value="Clicked at (40,60)")
    cdp.focus_xy = AsyncMock(return_value="Focused (40,60)")
    cdp.type_text_at_focus = AsyncMock(return_value="Typed 2 characters")
    cdp.refresh_target_map = AsyncMock()
    cdp.capture_screenshot = AsyncMock(return_value="/9j/fake")

    async def ws_send(_msg):
        return None

    deps = AgentDeps(user_id="u", task="t", cdp=cdp, ws_send=ws_send,
                     policy=Policy() if policy is None else policy)
    deps.human_input_queue.put_nowait(reply)
    return deps


async def _click(policy: Policy | None = None, label: str = "the cell C4"):
    return await _coordinate_action(
        ActionCall(action="click_xy", action_args={"x": 40, "y": 60,
                                                   "label": label}),
        _deps(policy), audit=MagicMock(), turn=0,
    )


@pytest.mark.asyncio
async def test_the_default_policy_does_not_refuse_an_innocent_click():
    """`Policy()` ships twelve patterns, so a gate keyed on list-emptiness
    refuses every coordinate click on every default install — the feature is
    dead on arrival, with no error naming the cause."""
    assert Policy().sensitive_actions, "the default list is not empty"
    out = await _click()
    assert _EXEC_FAILURE not in out, out
    assert out.startswith("Clicked at (40,60)")


@pytest.mark.asyncio
async def test_a_curated_list_does_not_refuse_here_either():
    """Enforcement lives in the step loop, which runs before this function is
    reached. Ref `click` has no second check in `_execute_action` either."""
    out = await _click(Policy(sensitive_actions=["payment"]))
    assert _EXEC_FAILURE not in out, out


def test_an_innocent_label_matches_no_default_pattern():
    """The label is the only prose the upstream scan sees, so it must not match
    on its own for a spreadsheet cell."""
    assert not check_sensitive_action(
        "click_xy", {"x": 40, "y": 60, "label": "the cell C4"}, Policy())
    assert not check_critical_action(
        "click_xy", {"x": 40, "y": 60, "label": "the cell C4"})


def test_a_dangerous_label_is_caught_by_the_upstream_guard():
    """The honest scope of that gate, stated as a test: it is a literal
    substring scan over the model's own words. It catches a model that says
    out loud what it is about to do, in the exact spelling of the pattern —
    `the delete-record button` does NOT match `delete_record`, and a model
    that clicks a delete button and calls it "the cell C4" is not caught at
    all. The crosshair screenshot on the approval card is what stands in
    front of that, not this scan."""
    assert check_sensitive_action(
        "click_xy", {"x": 40, "y": 60, "label": "the delete_record button"},
        Policy())
    assert not check_sensitive_action(
        "click_xy", {"x": 40, "y": 60, "label": "the delete-record button"},
        Policy())
    # `check_critical_action` is the regex pass over the same haystack, so it
    # is the one that catches the hyphenated spelling.
    assert check_critical_action(
        "click_xy", {"x": 40, "y": 60, "label": "the delete-record button"})


@pytest.mark.asyncio
async def test_capture_off_refuses_with_a_legible_reason(monkeypatch):
    monkeypatch.setenv(SCREENSHOT_CAPTURE_ENV, "")
    out = await _coordinate_action(
        ActionCall(action="click_xy",
                   action_args={"x": 1, "y": 2, "label": "cell C4"}),
        _deps(), audit=MagicMock(), turn=0,
    )
    assert _EXEC_FAILURE in out
    assert SCREENSHOT_CAPTURE_ENV in out, out