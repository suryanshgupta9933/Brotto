"""The screenshot capture primitive (W1).

The extension's half is pinned by `scripts/test-screenshot-frames.test.js`;
this is the server's. The behaviour that matters is the *absence* — an image
that should have arrived and did not must come back as `None`, never as an
empty string, because an empty string is an image a vision model will read as
a blank page. And the payload is page content, so it is returned and nothing
more: no log line, no stored state.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from brotto_orchestrator.cdp import extension_relay  # noqa: E402
from brotto_orchestrator.cdp.extension_relay import ExtensionCDPRelay  # noqa: E402


def _relay() -> ExtensionCDPRelay:
    return ExtensionCDPRelay(
        ws_send=AsyncMock(), obs_queue=asyncio.Queue(), session_id="test",
    )


JPEG = "/9j/4AAQSkZJRgABAQ=="


@pytest.mark.asyncio
async def test_screenshot_requests_then_returns_the_base64():
    relay = _relay()

    async def answer(_):
        await relay.deliver_screenshot_result({"type": "screenshot_result", "data": JPEG})
    relay._ws_send.side_effect = answer

    assert await relay.capture_screenshot() == JPEG
    assert relay._ws_send.await_args[0][0] == {"type": "capture_screenshot"}


@pytest.mark.asyncio
async def test_an_error_frame_is_none_not_an_empty_image():
    relay = _relay()

    async def answer(_):
        await relay.deliver_screenshot_result({"error": "no tab attached"})
    relay._ws_send.side_effect = answer

    assert await relay.capture_screenshot() is None


@pytest.mark.asyncio
async def test_a_missing_frame_times_out_to_none(monkeypatch):
    monkeypatch.setattr(extension_relay, "_OBSERVATION_TIMEOUT", 0.01)
    relay = _relay()
    assert await relay.capture_screenshot() is None


@pytest.mark.asyncio
async def test_only_the_newest_image_is_kept():
    """A misbehaving extension sending two images must not grow an unbounded
    queue of 700 KB frames; the second supersedes the first."""
    relay = _relay()
    await relay.deliver_screenshot_result({"data": "old"})
    await relay.deliver_screenshot_result({"data": "new"})
    assert relay._screenshot.qsize() == 1
    assert relay._screenshot.get_nowait()["data"] == "new"