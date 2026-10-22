"""The grid path's wire half: one primitive, one frame, one answer.

The request carries a unique `id` and the answer must echo it. The op name
alone is not enough: two calls of the SAME op — a write's read-back, then the
completion pass — are indistinguishable by name, so a late answer left over
from a timed-out op would be read as this one's, and a write would be graded
against a cell read earlier.

The queue is its own, NOT `_eval_queue`: that slot is a single uncorrelated
`evaluate` answer, and a cell value read out of it is graded against somebody
else's page text.

Nothing here raises. Every failure is `{ok: False, state: "unreadable"}`,
which the harness reads as "could not be read" rather than "the cell is empty".
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock

import pytest

from brotto_orchestrator.cdp import extension_relay  # noqa: E402
from brotto_orchestrator.cdp.extension_relay import ExtensionCDPRelay  # noqa: E402


def _relay(ws_send=None) -> ExtensionCDPRelay:
    return ExtensionCDPRelay(
        ws_send=ws_send or AsyncMock(),
        obs_queue=asyncio.Queue(),
        session_id="test",
    )


def _sent_id(relay: ExtensionCDPRelay) -> str:
    """The id the relay put on the frame it just sent."""
    return str(relay._ws_send.await_args.args[0].get("id", ""))


# ---------- the request frame the extension implements ----------

@pytest.mark.asyncio
async def test_grid_write_sends_the_contract_wire_shape():
    relay = _relay()
    task = asyncio.create_task(relay.grid_op("grid_write_cell", "B7", "hello"))
    await asyncio.sleep(0)
    sent = relay._ws_send.await_args.args[0]
    assert sent["type"] == "grid_write_cell"
    assert sent["address"] == "B7"
    assert sent["value"] == "hello"
    assert sent["id"], "the request carries an id for the answer to echo"
    await relay.deliver_grid_result({"id": _sent_id(relay), "op": "grid_write_cell",
                                     "ok": True, "address": "B7", "value": "hello",
                                     "state": "ok", "mechanism": "content-box",
                                     "error": ""})
    await task

@pytest.mark.asyncio
async def test_grid_read_omits_value_entirely():
    """A read carries no `value` key — `value: ""` on the wire would be a
    value the caller could mistake for one it asked for."""
    relay = _relay()
    task = asyncio.create_task(relay.grid_op("grid_read_cell", "A1"))
    await asyncio.sleep(0)
    sent = relay._ws_send.await_args.args[0]
    assert sent["type"] == "grid_read_cell"
    assert "value" not in sent
    await relay.deliver_grid_result({"id": _sent_id(relay), "op": "grid_read_cell",
                                     "ok": True, "value": "x",
                                     "state": "ok", "mechanism": "", "error": ""})
    await task

@pytest.mark.asyncio
async def test_each_request_carries_its_own_id():
    """Two calls of the same op must not share an id — that is the whole
    reason the id exists."""
    relay = _relay()
    first = asyncio.create_task(relay.grid_op("grid_read_cell", "A1"))
    await asyncio.sleep(0)
    first_id = _sent_id(relay)
    await relay.deliver_grid_result({"id": first_id, "op": "grid_read_cell",
                                     "ok": True, "value": "1", "state": "ok",
                                     "mechanism": "", "error": ""})
    await first
    second = asyncio.create_task(relay.grid_op("grid_read_cell", "A1"))
    await asyncio.sleep(0)
    assert _sent_id(relay) != first_id
    await relay.deliver_grid_result({"id": _sent_id(relay), "op": "grid_read_cell",
                                     "ok": True, "value": "2", "state": "ok",
                                     "mechanism": "", "error": ""})
    await second


# ---------- correlation ----------

@pytest.mark.asyncio
async def test_an_answer_for_another_op_does_not_answer_this_one():
    relay = _relay()
    task = asyncio.create_task(relay.grid_op("grid_write_cell", "B7", "hello"))
    await asyncio.sleep(0)
    request_id = _sent_id(relay)
    await relay.deliver_grid_result({"id": request_id, "op": "grid_read_cell",
                                     "ok": True, "value": "the last cell's contents",
                                     "state": "ok", "mechanism": "", "error": ""})
    await asyncio.sleep(0)
    assert not task.done()
    await relay.deliver_grid_result({"id": request_id, "op": "grid_write_cell",
                                     "ok": True, "mechanism": "grid-editor",
                                     "value": None, "state": "unreadable",
                                     "error": ""})
    assert (await task)["ok"] is True

@pytest.mark.asyncio
async def test_a_stale_answer_with_another_id_is_discarded():
    """The bug the id exists to close: a timed-out op's answer, still in the
    queue, must not be taken for the NEXT op of the same name."""
    relay = _relay()
    stale = asyncio.create_task(relay.grid_op("grid_read_cell", "A1"))
    await asyncio.sleep(0)
    stale_id = _sent_id(relay)
    # The first op times out, leaving its answer in the queue.
    relay._grid.put_nowait({"id": stale_id, "op": "grid_read_cell", "ok": True,
                             "value": "the OLD cell's contents", "state": "ok",
                             "mechanism": "", "error": ""})
    stale.cancel()
    try:
        await stale
    except asyncio.CancelledError:
        pass
    # The next read of the same op must not be answered by the stale frame.
    task = asyncio.create_task(relay.grid_op("grid_read_cell", "A1"))
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert not task.done(), "the stale answer satisfied the new op"
    await relay.deliver_grid_result({"id": _sent_id(relay), "op": "grid_read_cell",
                                     "ok": True, "value": "the new cell",
                                     "state": "ok", "mechanism": "", "error": ""})
    assert (await task)["value"] == "the new cell"

@pytest.mark.asyncio
async def test_an_answer_with_no_id_is_dropped_rather_than_queued():
    """An extension build that predates the request id sends no id. Its
    answer is not ours to answer — and the op then times out, which is how
    the relay learns the build is old."""
    relay = _relay()
    await relay.deliver_grid_result({"op": "grid_read_cell", "ok": True,
                                     "value": "x", "state": "ok"})
    assert relay._grid.empty()

@pytest.mark.asyncio
async def test_the_grid_queue_is_not_the_evaluate_slot():
    """The load-bearing one: a page-text read must never be taken for a cell."""
    relay = _relay()
    task = asyncio.create_task(relay.grid_op("grid_read_cell", "A1"))
    await asyncio.sleep(0)
    await relay._eval_queue.put("the whole page's innerText")
    await asyncio.sleep(0)
    assert not task.done()
    await relay.deliver_grid_result({"id": _sent_id(relay), "op": "grid_read_cell",
                                     "ok": True, "value": "42",
                                     "state": "ok", "mechanism": "", "error": ""})
    assert (await task)["value"] == "42"


# ---------- return shape ----------

@pytest.mark.asyncio
async def test_an_empty_cell_is_ok_and_empty_not_unreadable():
    """The distinction the whole read-back rests on: `""` after a read that
    happened is a fact about the cell; null is a read that did not happen."""
    relay = _relay()
    task = asyncio.create_task(relay.grid_op("grid_read_cell", "A1"))
    await asyncio.sleep(0)
    await relay.deliver_grid_result({"id": _sent_id(relay), "op": "grid_read_cell",
                                     "ok": True, "value": "", "state": "ok",
                                     "mechanism": "", "error": ""})
    assert await task == {"ok": True, "value": "", "state": "ok",
                          "mechanism": "", "error": ""}

@pytest.mark.asyncio
async def test_the_return_carries_exactly_the_five_keys_the_harness_reads():
    relay = _relay()
    task = asyncio.create_task(relay.grid_op("grid_read_cell", "A1"))
    await asyncio.sleep(0)
    await relay.deliver_grid_result({"id": _sent_id(relay), "op": "grid_read_cell",
                                     "ok": True, "address": "A1", "value": "7",
                                     "state": "ok", "mechanism": "m", "error": ""})
    assert set(await task) == {"ok", "value", "state", "mechanism", "error"}


# ---------- failure paths: never a raise, never a fake empty cell ----------

@pytest.mark.asyncio
async def test_a_timeout_is_unreadable_and_never_an_empty_cell(monkeypatch):
    monkeypatch.setattr(extension_relay, "_GRID_TIMEOUT", 0.05)
    relay = _relay()
    out = await relay.grid_op("grid_read_cell", "A1")
    assert out["ok"] is False and out["state"] == "unreadable"
    assert out["value"] is None

@pytest.mark.asyncio
async def test_a_send_failure_is_the_same_failure_shape():
    relay = _relay(AsyncMock(side_effect=RuntimeError("socket closed")))
    out = await relay.grid_op("grid_write_cell", "B7", "x")
    assert out["ok"] is False and out["state"] == "unreadable"
    assert "socket closed" in out["error"]

@pytest.mark.asyncio
async def test_an_unknown_op_is_refused_without_reaching_the_browser():
    relay = _relay()
    out = await relay.grid_op("grid_everything", "A1")
    assert out["ok"] is False and out["state"] == "unreadable"
    relay._ws_send.assert_not_called()


# ---------- an extension build too old to answer ----------

@pytest.mark.asyncio
async def test_one_timeout_latches_the_grid_and_the_next_op_fails_fast(monkeypatch):
    """An extension that predates the grid frames ignores them, so every op
    would wait out its full timeout — a minute of the user's time, and then a
    `cannot_complete` for a reason that has nothing to do with the task. One
    timeout is enough to know."""
    monkeypatch.setattr(extension_relay, "_GRID_TIMEOUT", 0.05)
    relay = _relay()
    first = await relay.grid_op("grid_read_cell", "A1")
    assert first["ok"] is False

    monkeypatch.setattr(extension_relay, "_GRID_TIMEOUT", 30.0)
    started = time.monotonic()
    second = await relay.grid_op("grid_read_cell", "A1")
    elapsed = time.monotonic() - started
    assert second["ok"] is False and second["state"] == "unreadable"
    assert elapsed < 1.0, "the second op waited out the timeout again"
    assert "older build" in second["error"]
    relay._ws_send.assert_called_once(), "the latched op must not reach the browser"
