"""A write reports a verdict, not a dispatch."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.closed_loop import CONFIRMED, MISMATCH, UNKNOWN
from brotto_orchestrator.agent.context import ActionCall, AgentDeps
import brotto_orchestrator.agent.harness as harness_mod


def _deps(*, ax_value: str = "A1", grid_value: str = "name") -> AgentDeps:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[])
    cdp.get_current_url = AsyncMock(return_value="https://example.com/form")
    cdp.get_page_text = AsyncMock(return_value="page")
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Form")
    cdp.refresh_target_map = AsyncMock()
    cdp.type_text_into_ref = AsyncMock(return_value="Typed 4 characters")
    cdp.grid_op = AsyncMock(return_value={
        "ok": True, "address": "A1", "value": grid_value,
        "mechanism": "content-box", "state": "ok",
    })
    return AgentDeps(user_id="t", task="write a name", cdp=cdp,
                     ws_send=AsyncMock())


def _call(action: str, args: dict) -> ActionCall:
    return ActionCall(action=action, action_args=args)


async def _run_one(deps: AgentDeps, call: ActionCall) -> str:
    return await harness_mod._execute_action(call, deps, audit=None, turn=1)


@pytest.mark.asyncio
async def test_a_write_to_a_ref_is_confirmed_only_by_a_matching_read_back():
    deps = _deps(ax_value="name")
    cdp = deps.cdp
    cdp.get_targets = AsyncMock(return_value=[
        SimpleNamespace(ref_id="0:12", role="textbox", name="Full name", value="name"),
    ])
    out = await _run_one(deps, _call("write_text", {
        "target": {"ref": "0:12"}, "value": "name"}))
    assert "confirmed" in out
    assert deps.ledger and deps.ledger[0].confirmed
    assert deps.ledger[0].target_key == "ref:textbox:full name"


@pytest.mark.asyncio
async def test_a_write_that_reads_back_something_else_is_a_mismatch():
    deps = _deps(ax_value="age")
    deps.cdp.get_targets = AsyncMock(return_value=[
        SimpleNamespace(ref_id="0:12", role="textbox", name="Full name", value="age"),
    ])
    out = await _run_one(deps, _call("write_text", {
        "target": {"ref": "0:12"}, "value": "name"}))
    assert "NOT confirmed" in out
    assert "age" in out
    assert deps.ledger and not deps.ledger[0].confirmed
    assert deps.ledger[0].observed == "age"


@pytest.mark.asyncio
async def test_a_write_to_a_cell_goes_through_the_grid_primitive():
    deps = _deps(grid_value="name")
    deps.cdp.get_current_url = AsyncMock(
        return_value="https://docs.google.com/spreadsheets/d/abc/edit")
    out = await _run_one(deps, _call("write_text", {
        "target": {"cell": "A1"}, "value": "name"}))
    assert "confirmed" in out
    # The write is the FIRST grid_op of the step; the read-back is the second,
    # and the read-back is what grades it.
    assert deps.cdp.grid_op.await_args_list[0].args[0] == "grid_write_cell"
    assert deps.cdp.grid_op.await_args_list[1].args[0] == "grid_read_cell"
    assert deps.ledger[0].target_key == "cell:A1"


@pytest.mark.asyncio
async def test_an_unreadable_target_is_unknown_and_does_not_escalate():
    deps = _deps()
    deps.cdp.grid_op = AsyncMock(return_value={
        "ok": False, "error": "no formula bar", "state": "unreadable"})
    deps.cdp.get_current_url = AsyncMock(
        return_value="https://docs.google.com/spreadsheets/d/abc/edit")
    out = await _run_one(deps, _call("write_text", {
        "target": {"cell": "A1"}, "value": "name"}))
    assert "could not be read" in out
    assert deps.ledger and deps.ledger[0].observed is None
    assert deps.result is None, "an unreadable target is not an escalation"


@pytest.mark.asyncio
async def test_a_repeat_of_the_same_value_to_the_same_target_is_refused():
    deps = _deps(ax_value="age")
    deps.cdp.get_targets = AsyncMock(return_value=[
        SimpleNamespace(ref_id="0:12", role="textbox", name="Full name", value="age"),
    ])
    await _run_one(deps, _call("write_text", {
        "target": {"ref": "0:12"}, "value": "name"}))
    out = await _run_one(deps, _call("write_text", {
        "target": {"ref": "0:12"}, "value": "name"}))
    assert "REFUSED" in out
    assert len(deps.ledger) == 1, "a refused write is not an attempt"


@pytest.mark.asyncio
async def test_a_different_value_to_the_same_target_is_a_new_attempt():
    deps = _deps(ax_value="")
    deps.cdp.get_targets = AsyncMock(return_value=[
        SimpleNamespace(ref_id="0:12", role="textbox", name="Full name", value=""),
    ])
    await _run_one(deps, _call("write_text", {
        "target": {"ref": "0:12"}, "value": "name"}))
    out = await _run_one(deps, _call("write_text", {
        "target": {"ref": "0:12"}, "value": "age"}))
    assert "REFUSED" not in out
    assert len(deps.ledger) == 2


@pytest.mark.asyncio
async def test_the_third_attempt_on_one_target_is_refused():
    deps = _deps(ax_value="")
    deps.cdp.get_targets = AsyncMock(return_value=[
        SimpleNamespace(ref_id="0:12", role="textbox", name="Full name", value=""),
    ])
    for value in ("name", "age", "city"):
        await _run_one(deps, _call("write_text", {
            "target": {"ref": "0:12"}, "value": value}))
    out = await _run_one(deps, _call("write_text", {
        "target": {"ref": "0:12"}, "value": "note"}))
    assert "REFUSED" in out
    assert len(deps.ledger) == 3


@pytest.mark.asyncio
async def test_the_run_ends_after_three_blocked_attempts():
    deps = _deps(ax_value="")
    deps.cdp.get_targets = AsyncMock(return_value=[
        SimpleNamespace(ref_id="0:12", role="textbox", name="Full name", value=""),
    ])
    for value in ("name", "age", "city"):
        await _run_one(deps, _call("write_text", {
            "target": {"ref": "0:12"}, "value": value}))
    await _run_one(deps, _call("write_text", {
        "target": {"ref": "0:12"}, "value": "note"}))
    out = await _run_one(deps, _call("write_text", {
        "target": {"ref": "0:12"}, "value": "x"}))
    assert "REFUSED" in out
    assert deps.result is not None
    assert deps.result.status == "failed"
    assert deps.result.failure_reason == "cannot_complete"


@pytest.mark.asyncio
async def test_an_empty_value_is_refused():
    deps = _deps()
    out = await _run_one(deps, _call("write_text", {
        "target": {"ref": "0:12"}, "value": "   "}))
    assert "REFUSED" in out
    assert not deps.ledger


@pytest.mark.asyncio
async def test_a_target_that_is_not_ref_cell_or_description_is_refused():
    deps = _deps()
    out = await _run_one(deps, _call("write_text", {
        "target": {"nonsense": 1}, "value": "name"}))
    assert "REFUSED" in out
    assert not deps.ledger


@pytest.mark.asyncio
async def test_read_state_returns_the_observed_value():
    deps = _deps(ax_value="name")
    deps.cdp.get_targets = AsyncMock(return_value=[
        SimpleNamespace(ref_id="0:12", role="textbox", name="Full name", value="name"),
    ])
    out = await _run_one(deps, _call("read_state", {"target": {"ref": "0:12"}}))
    assert "name" in out
    assert not deps.ledger, "a read records nothing"


@pytest.mark.asyncio
async def test_read_state_on_a_cell_uses_the_grid_primitive():
    deps = _deps(grid_value="age")
    deps.cdp.get_current_url = AsyncMock(
        return_value="https://docs.google.com/spreadsheets/d/abc/edit")
    out = await _run_one(deps, _call("read_state", {"target": {"cell": "A1"}}))
    assert "age" in out
    assert deps.cdp.grid_op.await_args.args[0] == "grid_read_cell"


@pytest.mark.asyncio
async def test_type_text_is_refused_with_a_message_naming_write_text():
    deps = _deps()
    out = await _run_one(deps, _call("type_text", {
        "ref": "0:12", "text": "name"}))
    assert "write_text" in out
    deps.cdp.type_text_into_ref.assert_not_called()