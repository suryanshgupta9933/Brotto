"""A run must never end as "completed" while a verdict is unresolved."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import ActionCall, AgentDeps
import brotto_orchestrator.agent.harness as harness_mod


def _deps(*, cells: dict[str, str] | None = None) -> AgentDeps:
    """A grid whose cell values the test holds: `cells` maps A1 -> value."""
    values = dict(cells or {})

    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[])
    cdp.get_current_url = AsyncMock(
        return_value="https://docs.google.com/spreadsheets/d/abc/edit")
    cdp.get_page_text = AsyncMock(return_value="page")
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Sheet")
    cdp.refresh_target_map = AsyncMock()

    async def _grid(op, address, value=None):
        if op == "grid_write_cell":
            values[str(address).upper()] = str(value)
            return {"ok": True, "address": address, "state": "ok", "error": ""}
        return {"ok": True, "address": address,
                "value": values.get(str(address).upper()),
                "state": "ok", "error": ""}

    cdp.grid_op = AsyncMock(side_effect=_grid)
    return AgentDeps(user_id="t", task="write a name", cdp=cdp,
                     ws_send=AsyncMock())


async def _run(deps, action, args):
    return await harness_mod._execute_action(
        ActionCall(action=action, action_args=args), deps, audit=None, turn=1)


# --- the completion rule -------------------------------------------------

@pytest.mark.asyncio
async def test_two_unresolved_completions_end_the_run_as_failed():
    deps = _deps(cells={"A1": "age"})
    await _run(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]})
    await _run(deps, "task_complete", {"summary": "A1 = name"})
    out = await _run(deps, "task_complete", {"summary": "A1 = name"})

    assert deps.result is not None
    assert deps.result.status != "completed"
    assert deps.result.status == "failed"
    assert deps.result.failure_reason == "cannot_complete"
    # The user must be able to read what the page actually holds.
    assert "age" in deps.result.summary
    assert "not confirmed" in deps.result.summary
    assert "closed as failed" in out


@pytest.mark.asyncio
async def test_a_fresh_write_that_lands_lets_the_run_finish():
    deps = _deps(cells={"A1": "age"})
    await _run(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]})
    first = await _run(deps, "task_complete", {"summary": "A1 = name"})
    assert "REFUSED" in first
    assert deps.result is None

    # The model fixes the cell...
    await _run(deps, "write_text",
               {"target": {"cell": "A1"}, "value": "name"})
    # ...and the fresh read confirms it.
    out = await _run(deps, "task_complete", {"summary": "A1 = name"})

    assert "REFUSED" not in out
    assert deps.result is not None
    assert deps.result.status == "completed"
    assert deps.result.summary == "A1 = name"


@pytest.mark.asyncio
async def test_the_first_unresolved_completion_does_not_end_the_run():
    deps = _deps(cells={"A1": "age"})
    await _run(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]})
    out = await _run(deps, "task_complete", {"summary": "A1 = name"})
    assert "REFUSED" in out
    assert deps.result is None


