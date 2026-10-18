"""The wire type of a coordinate click, and the probe that gates it.

Two trust classes ride the same `action` frame. `click` (line 338) carries
coordinates that came out of `BOX_WALK` and were verified twice; `click_xy`
carries a point the model proposed and nothing vouched for. Sending both as
`{"type": "click"}` conflates them, and the extension cannot tell them apart —
`background.ts` branches on `t === "click" || t === "click_xy"` to take its
bounded/untrusted path, so the conflation makes that branch dead and hands the
model's unverified point the trusted one.

The dev twin is asserted the same way, for the same reason: the two agents that
built against one spec each got half of it, and the missing half was invisible
because nothing read the other side's bytes.
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.cdp.extension_relay import ExtensionCDPRelay


def _relay() -> ExtensionCDPRelay:
    return ExtensionCDPRelay(ws_send=AsyncMock(), obs_queue=asyncio.Queue(),
                             session_id="test")


# ---------- the wire type ----------

async def _sent_action(relay: ExtensionCDPRelay, call) -> dict:
    """The `action` frame for a call that also waits for the post-action
    observation — assert on the frame, then feed it one so it returns."""
    task = asyncio.create_task(call)
    await asyncio.sleep(0)  # let the action go out
    sent = relay._ws_send.await_args.args[0]
    relay._obs_queue.put_nowait({"url": "https://example.com",
                                 "axTargets": []})
    await task
    return sent


@pytest.mark.asyncio
async def test_click_xy_sends_click_xy_not_click():
    relay = _relay()
    sent = await _sent_action(relay, relay.click_xy(412, 288))
    assert sent["type"] == "action"
    assert sent["action"] == {"type": "click_xy", "x": 412, "y": 288}


@pytest.mark.asyncio
async def test_a_ref_derived_click_still_sends_click():
    """Unchanged on purpose: those coordinates are BOX_WALK-verified, and
    re-resolving the ref server-side is a much larger change. The two types
    now differ, and that difference is the point."""
    relay = _relay()
    relay._locate = lambda ref: ({"x": 10, "y": 20}, "")
    sent = await _sent_action(relay, relay.click_ref("7"))
    assert sent["action"] == {"type": "click", "x": 10, "y": 20}


@pytest.mark.asyncio
async def test_the_dev_twin_keeps_the_untrusted_coordinate_distinct():
    """`CDPRelay` has no wire — it drives Playwright — but it is the twin the
    dev path runs on, so its click must be the coordinate one, never the
    ref-resolution helper it delegates for `click_ref`."""
    from brotto_orchestrator.cdp.relay import CDPRelay
    browser = MagicMock()
    browser.page.mouse.click = AsyncMock()
    relay = CDPRelay(browser)
    await relay.click_xy(412, 288)
    browser.page.mouse.click.assert_awaited_once_with(412, 288)
    browser._handle_left_click.assert_not_called()


# ---------- probe_xy: a stolen result must not pass ----------

async def _probe(payload: str) -> dict:
    relay = _relay()
    task = asyncio.create_task(relay.probe_xy(412, 288))
    await asyncio.sleep(0)  # let the request go out
    relay._eval_queue.put_nowait(payload)
    return await task


@pytest.mark.asyncio
async def test_the_probe_key_set_is_exactly_the_viewport_and_the_tag():
    """`probe_xy` reads a shared `_eval_queue`, so a concurrent `evaluate` —
    `select_all`, `read_page_text` — can land its result first. The viewport
    is a security decision, so anything that is not exactly the three keys this
    probe asks for is somebody else's answer and is refused."""
    good = json.dumps({"width": 1512, "height": 982, "tag": "CANVAS"})
    assert await _probe(good) == {"width": 1512, "height": 982, "tag": "CANVAS"}


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [
    # another probe's payload, from a different page state
    '{"width": 800, "height": 600, "tag": "DIV", "url": "https://elsewhere"}',
    # select_all's answer, delivered first
    "select-all",
    '{"width": "1512", "height": 982, "tag": "CANVAS"}',
    '{"width": 1512, "height": 982}',
])
async def test_anything_but_the_probe_payload_is_refused(payload):
    assert await _probe(payload) == {}
