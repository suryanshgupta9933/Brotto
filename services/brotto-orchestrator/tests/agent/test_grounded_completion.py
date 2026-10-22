"""task_complete has to show its work."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import ActionCall, AgentDeps
import brotto_orchestrator.agent.harness as harness_mod


def _deps(*, grid_value: str = "age", grid_ok: bool = True) -> AgentDeps:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[])
    cdp.get_current_url = AsyncMock(
        return_value="https://docs.google.com/spreadsheets/d/abc/edit")
    cdp.get_page_text = AsyncMock(return_value="page")
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Sheet")
    cdp.refresh_target_map = AsyncMock()
    cdp.grid_op = AsyncMock(return_value={
        "ok": grid_ok, "address": "A1", "value": grid_value,
        "state": "ok" if grid_ok else "unreadable", "error": "" if grid_ok else "no mirror",
    })
    return AgentDeps(user_id="t", task="write a name", cdp=cdp,
                     ws_send=AsyncMock())


async def _run(deps, action, args):
    return await harness_mod._execute_action(
        ActionCall(action=action, action_args=args), deps, audit=None, turn=1)


@pytest.mark.asyncio
async def test_a_mismatched_plan_item_refuses_the_completion():
    deps = _deps(grid_value="age")
    await _run(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]})
    out = await _run(deps, "task_complete", {"summary": "A1 = name, B1 = age"})
    assert "REFUSED" in out
    assert "age" in out and "name" in out
    assert deps.result is None, "a refused completion does not end the run"


@pytest.mark.asyncio
async def test_an_unreadable_item_refuses_with_different_wording():
    deps = _deps(grid_ok=False)
    await _run(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]})
    out = await _run(deps, "task_complete", {"summary": "done"})
    assert "could not be read back" in out
    assert "REFUSED" in out


@pytest.mark.asyncio
async def test_a_confirmed_plan_is_accepted_as_written():
    deps = _deps(grid_value="name")
    await _run(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]})
    out = await _run(deps, "task_complete", {"summary": "A1 = name"})
    assert "REFUSED" not in out
    assert deps.result is not None
    assert deps.result.status == "completed"
    assert deps.result.summary == "A1 = name"


@pytest.mark.asyncio
async def test_a_second_identical_completion_is_accepted_with_the_discrepancy():
    deps = _deps(grid_value="age")
    await _run(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]})
    await _run(deps, "task_complete", {"summary": "A1 = name"})
    out = await _run(deps, "task_complete", {"summary": "A1 = name"})
    assert "REFUSED" not in out
    assert deps.result is not None
    assert deps.result.status == "completed"
    assert "age" in deps.result.summary, "the discrepancy is appended"


@pytest.mark.asyncio
async def test_a_run_with_no_plan_completes_as_it_did_before():
    deps = _deps(grid_value="age")
    await _run(deps, "task_complete", {"summary": "done"})
    assert deps.result is not None
    assert deps.result.status == "completed"


@pytest.mark.asyncio
async def test_the_verification_reads_one_target_at_a_time():
    deps = _deps(grid_value="name")
    await _run(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
        {"intent": "write B1 = age", "target": {"cell": "B1"}, "value": "age"},
    ]})
    in_flight = 0
    peak = 0

    values = {"A1": "name", "B1": "age"}

    async def _serial(op, address, value=None):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        try:
            return {"ok": True, "state": "ok", "value": values.get(address)}
        finally:
            in_flight -= 1

    deps.cdp.grid_op = AsyncMock(side_effect=_serial)
    out = await _run(deps, "task_complete", {"summary": "done"})
    assert peak == 1, "the relay has one slot; two probes at once cross answers"
    assert deps.result.status == "completed"