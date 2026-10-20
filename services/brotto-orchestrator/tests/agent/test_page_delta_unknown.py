"""A delta read that fails is unknown, not a failed step.

The delta is optional evidence about change detection and it is read outside
the `TabUnreachable` handler, after redaction has run. Today
`ExtensionCDPRelay.get_page_delta` is pure arithmetic over the cached
observation, so it cannot raise — which makes the placement safe by accident
rather than by decision. A round trip added to it tomorrow would take the step
down with it.

Both failures have to look alike to every reader: a veto (the page carries a
typed secret) and a read that blew up both mean *unknown*, and neither may read
as "nothing moved" (`False`). So the same `None` is the answer for both.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from brotto_orchestrator.agent.context import (
    ActionCall, AgentDecision, AgentDeps,
)
import brotto_orchestrator.agent.harness as harness_mod
from brotto_orchestrator.agent.harness import AgentHarness
from brotto_orchestrator.cdp.extension_relay import TabUnreachable
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget


class _PlanResult:
    usage = None


def _deps() -> AgentDeps:
    cdp = AsyncMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(
        return_value=[SemanticTarget(ref_id="r:A", tag="button", role="button",
                                     name="Go")])
    cdp.get_current_url = AsyncMock(return_value="http://example.com/")
    cdp.get_page_text = AsyncMock(return_value="a page with some text")
    cdp.get_page_delta = AsyncMock(
        side_effect=TabUnreachable("the relay lost the tab mid-diff"))
    cdp.get_canvas_covered = AsyncMock(return_value=0.0)
    cdp.get_page_title = AsyncMock(return_value="Example")
    cdp.refresh_target_map = AsyncMock()
    cdp.click_ref = AsyncMock(return_value="Clicked [r:A]")

    async def ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="t", task="go", cdp=cdp, ws_send=ws_send)


async def _run_one_step(monkeypatch, deps: AgentDeps, calls: list | None = None):
    async def _fake_plan(deps_, turn, agent, audit=None):
        if calls is not None:
            calls.append(1)
        return (AgentDecision(
            reasoning="go", thought="go",
            actions=[ActionCall(action="click", action_args={"ref": "r:A"})]),
            400_000, _PlanResult())

    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)
    return await AgentHarness().run(deps)


@pytest.mark.asyncio
async def test_a_delta_read_that_raises_leaves_the_step_running(monkeypatch):
    calls: list = []
    deps = _deps()
    result = await _run_one_step(monkeypatch, deps, calls)

    # Not "status != failed" — a run may legitimately stop stagnant. The
    # claim is narrower: the failure is never the delta read, and the loop
    # kept stepping (the plan was reached again after the raise).
    assert result.failure_reason != "tab_unreachable"
    assert len(calls) > 1, "the step died on the delta read instead of retrying"
    assert deps.canvas_changed is None, (
        "unknown, not False — False reads downstream as 'nothing moved'")


@pytest.mark.asyncio
async def test_a_veto_reads_exactly_the_same_as_a_failed_read(monkeypatch):
    """The asymmetry to preserve: one `None`, no third outcome."""
    vetoed = _deps()
    vetoed.cdp.get_page_delta = AsyncMock(return_value=None)
    vetoed_result = await _run_one_step(monkeypatch, vetoed)

    failed = _deps()
    failed_result = await _run_one_step(monkeypatch, failed)

    assert (vetoed.canvas_changed, failed.canvas_changed) == (None, None)
    assert vetoed_result.status == failed_result.status