"""One capture per step, not two.

`_send_action` blocks until the extension answers with a solicited post-action
frame. The next step's `get_targets()` then sent `observe` and captured the
same page again — measured on a live Sheets run at ~10s a step, with model
generation at ~2s, so ~90% of wall time was one of two identical captures.

The post-action frame is handed over once instead. The reuse condition has to
be narrow, because the frame that is wrong here is the failure of session
7d567b66: a tree captured before the page it claims to describe rendered.
"""

import asyncio

import pytest

from brotto_orchestrator.cdp.extension_relay import ExtensionCDPRelay


def _relay() -> tuple[ExtensionCDPRelay, asyncio.Queue, list[dict]]:
    sent: list[dict] = []

    async def ws_send(msg: dict) -> None:
        sent.append(msg)

    q: asyncio.Queue = asyncio.Queue()
    return ExtensionCDPRelay(ws_send, q, asyncio.Queue(), "t"), q, sent


def _obs(reason: str | None, url: str, n: int) -> dict:
    frame = {
        "url": url,
        "axTargets": [{"ref": f"0:{i}", "role": "option", "name": f"b{i}",
                       "x": i, "y": i} for i in range(n)],
    }
    if reason is not None:
        frame["reason"] = reason
    return frame


@pytest.mark.asyncio
async def test_one_action_is_one_capture_not_two():
    """The whole point: the next step reuses, so `observe` is never sent."""
    relay, q, sent = _relay()

    q.put_nowait(_obs("observe", "https://sheets.example/1", 5))
    assert len(await relay.get_targets()) == 5

    q.put_nowait(_obs("action", "https://sheets.example/1", 9))
    await relay._send_action({"type": "click", "x": 1, "y": 1})

    assert len(await relay.get_targets()) == 9

    # Step 1 was answered from a primed queue, so the only frames on the wire
    # are the action and — the thing being proved absent — nothing else.
    assert [m["type"] for m in sent] == ["action"], "the step re-captured"


@pytest.mark.asyncio
async def test_a_navigate_must_re_observe():
    """The URL WILL differ after one, so the post-action frame is the old page."""
    relay, q, sent = _relay()

    q.put_nowait(_obs("observe", "https://sheets.example/1", 5))
    await relay.get_targets()

    async def answer() -> None:
        await q.put(_obs("action", "https://sheets.example/2", 3))

    task = asyncio.create_task(answer())
    await relay.navigate("https://sheets.example/2")
    await task

    async def answer2() -> None:
        await q.put(_obs("observe", "https://sheets.example/2", 11))

    task = asyncio.create_task(answer2())
    assert len(await relay.get_targets()) == 11, "reused the previous page's tree"
    await task
    assert [m["type"] for m in sent] == ["action", "observe"]


@pytest.mark.asyncio
async def test_a_navigation_push_since_the_action_blocks_reuse():
    """7d567b66, one step later. The click committed a navigation: the frame
    the click produced describes the page before it, and re-asking is the only
    way to get the page after it."""
    relay, q, sent = _relay()

    q.put_nowait(_obs("observe", "https://app.example.com/old", 2))
    await relay.get_targets()
    q.put_nowait(_obs("action", "https://app.example.com/old", 4))
    await relay._send_action({"type": "click", "x": 1, "y": 1})

    # The commit lands after the action's frame was taken.
    q.put_nowait(_obs("navigated", "https://app.example.com/new", 9))

    async def answer() -> None:
        await q.put(_obs("observe", "https://app.example.com/new", 9))

    task = asyncio.create_task(answer())
    assert len(await relay.get_targets()) == 9
    await task
    assert [m["type"] for m in sent] == ["action", "observe"]


@pytest.mark.asyncio
async def test_a_push_that_arrived_before_the_action_answers_blocks_reuse():
    """The other order. `_send_action` parks it rather than treating it as its
    own answer — so the URL had already moved and the frame it does accept is
    not the page the next step is on."""
    relay, q, sent = _relay()

    q.put_nowait(_obs("observe", "https://app.example.com/old", 2))
    await relay.get_targets()

    async def answer() -> None:
        await q.put(_obs("navigated", "https://app.example.com/new", 5))
        await q.put(_obs("action", "https://app.example.com/new", 5))

    task = asyncio.create_task(answer())
    await relay._send_action({"type": "click", "x": 1, "y": 1})
    await task

    async def answer2() -> None:
        await q.put(_obs("observe", "https://app.example.com/new", 12))

    task = asyncio.create_task(answer2())
    assert len(await relay.get_targets()) == 12
    await task


@pytest.mark.asyncio
async def test_reuse_is_once_only():
    """The flag is spent by the hand-over, so a second look in the same step
    captures for real rather than repeating a frame the page may have left."""
    relay, q, sent = _relay()

    q.put_nowait(_obs("observe", "https://app.example.com/1", 5))
    await relay.get_targets()
    q.put_nowait(_obs("action", "https://app.example.com/1", 5))
    await relay._send_action({"type": "click", "x": 1, "y": 1})

    await relay.get_targets()

    async def answer() -> None:
        await q.put(_obs("observe", "https://app.example.com/1", 6))

    task = asyncio.create_task(answer())
    assert len(await relay.get_targets()) == 6
    await task