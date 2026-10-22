"""The plan is tracked by the harness, not by the model."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import ActionCall, AgentDeps
from brotto_orchestrator.agent.harness import _sync_plan
import brotto_orchestrator.agent.harness as harness_mod


def _deps() -> AgentDeps:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[])
    cdp.get_current_url = AsyncMock(return_value="https://example.com/form")
    cdp.get_page_text = AsyncMock(return_value="page")
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Form")
    cdp.refresh_target_map = AsyncMock()
    cdp.type_text_into_ref = AsyncMock(return_value="Typed 4 characters")
    return AgentDeps(user_id="t", task="write a name", cdp=cdp,
                     ws_send=AsyncMock())


async def _run(deps, action, args):
    return await harness_mod._execute_action(
        ActionCall(action=action, action_args=args), deps, audit=None, turn=1)


@pytest.mark.asyncio
async def test_set_plan_replaces_the_plan():
    deps = _deps()
    out = await _run(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]})
    assert len(deps.plan) == 1
    assert deps.plan[0].id == 1
    assert deps.plan[0].status == "pending"
    assert deps.plan[0].target_key == "cell:A1"
    assert "A1" in out


@pytest.mark.asyncio
async def test_a_plan_item_closes_only_from_a_confirmed_ledger_entry():
    deps = _deps()
    await _run(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]})
    # A mismatch: the item must NOT close.
    deps.cdp.get_targets = AsyncMock(return_value=[
        MagicMock(ref_id="0:12", role="textbox", name="Full name", value="age"),
    ])
    deps.cdp.grid_op = AsyncMock(return_value={
        "ok": True, "address": "A1", "value": "age", "state": "ok"})
    deps.cdp.get_current_url = AsyncMock(
        return_value="https://docs.google.com/spreadsheets/d/abc/edit")
    await _run(deps, "write_text", {"target": {"cell": "A1"}, "value": "name"})
    _sync_plan(deps)
    assert deps.plan[0].status == "failed"

    # A confirmed ledger entry closes it.
    deps.ledger[-1].confirmed = True
    deps.ledger[-1].observed = "name"
    _sync_plan(deps)
    assert deps.plan[0].status == "confirmed"


@pytest.mark.asyncio
async def test_a_plan_item_with_no_ledger_entry_stays_pending():
    deps = _deps()
    await _run(deps, "set_plan", {"items": [
        {"intent": "write A1 = name", "target": {"cell": "A1"}, "value": "name"},
    ]})
    _sync_plan(deps)
    assert deps.plan[0].status == "pending"


@pytest.mark.asyncio
async def test_set_plan_refuses_an_item_with_no_intent():
    deps = _deps()
    out = await _run(deps, "set_plan", {"items": [
        {"target": {"cell": "A1"}, "value": "name"},
    ]})
    assert "REFUSED" in out
    assert deps.plan == []


@pytest.mark.asyncio
async def test_set_plan_refuses_a_non_list():
    deps = _deps()
    out = await _run(deps, "set_plan", {"items": "write A1"})
    assert "REFUSED" in out
    assert deps.plan == []