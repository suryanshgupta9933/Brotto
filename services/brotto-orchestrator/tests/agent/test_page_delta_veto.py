"""The page delta is gated on the same knowledge the screenshot is.

`_capture_page` vetoes when `redactions or run_secrets` — the harness's own
knowledge that the page holds a typed secret, which redaction cannot reach in
pixels. `get_page_delta` reads the same pixels for change detection and must
take the same veto; today it does not store or log them (tile rectangles and a
boolean), so nothing leaks, but the gate should not depend on that staying
true. The relay's own gate is `brotto-conversation`'s; this asserts the values
reach it.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from brotto_orchestrator.agent.context import (
    ActionCall, AgentDecision, AgentDeps,
)
import brotto_orchestrator.agent.harness as harness_mod
from brotto_orchestrator.agent.harness import AgentHarness
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget


class _PlanResult:
    usage = None


def _deps(page_text: str, seen: list) -> AgentDeps:
    cdp = AsyncMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(
        return_value=[SemanticTarget(ref_id="r:A", tag="button", role="button",
                                     name="Go")])
    cdp.get_current_url = AsyncMock(return_value="http://example.com/")
    cdp.get_page_text = AsyncMock(return_value=page_text)
    cdp.get_page_delta = AsyncMock(
        side_effect=lambda *a, **k: (seen.append(k) or {"changed": False}))
    cdp.get_canvas_covered = AsyncMock(return_value=0.0)
    cdp.get_page_title = AsyncMock(return_value="Example")
    cdp.refresh_target_map = AsyncMock()
    cdp.click_ref = AsyncMock(return_value="Clicked [r:A]")
    cdp.click_ref = AsyncMock(return_value="Clicked [r:A]")

    async def ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="t", task="go", cdp=cdp, ws_send=ws_send)


async def _run_one_step(monkeypatch, deps: AgentDeps) -> None:
    async def _fake_plan(deps_, turn, agent, audit=None):
        return (AgentDecision(
            reasoning="go", thought="go",
            actions=[ActionCall(action="click", action_args={"ref": "r:A"})]),
            400_000, _PlanResult())

    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)
    await AgentHarness().run(deps)


@pytest.mark.asyncio
async def test_the_delta_call_is_given_this_steps_redactions_and_secrets(
    monkeypatch,
):
    seen: list[dict] = []
    await _run_one_step(monkeypatch, _deps("card 4111 1111 1111 1111", seen))

    assert seen, "the delta was never read"
    kwargs = seen[0]
    assert kwargs["redactions"], "a page whose text was redacted must reach the veto"
    assert "redactions" in kwargs and "run_secrets" in kwargs


@pytest.mark.asyncio
async def test_an_empty_redactions_report_is_still_passed_through(monkeypatch):
    """Not a permission: an empty dict means no detector fired, and the relay
    is the thing that gets to decide what that means."""
    seen: list[dict] = []
    await _run_one_step(monkeypatch, _deps("nothing sensitive here", seen))

    assert seen[0]["redactions"] == {}
    assert seen[0]["run_secrets"] == []