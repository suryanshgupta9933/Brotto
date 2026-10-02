"""A key the client cannot resolve must fail, not report success.

Session ad0337c9 sent `ControlOrMeta+a` three times trying to clear a Google
Docs title. It is a Playwright alias; forwarded verbatim it reached Chrome as
a key literally named "ControlOrMeta+a" with no modifier held. Every one came
back "Pressed ControlOrMeta+a: ok" with nothing pressed, and the model — unable
to see the field it was typing into — spent three steps retyping into it.
"""

from __future__ import annotations

import asyncio
import os
from unittest.mock import AsyncMock

import pytest

os.environ.setdefault("ANTHROPIC_API_KEY", "test")
os.environ.setdefault("AGENT_AUTH_DISABLED", "true")

EXEC_FAILURE = "Error executing"


def _relay():
    from brotto_orchestrator.cdp.extension_relay import ExtensionCDPRelay

    return ExtensionCDPRelay(
        ws_send=AsyncMock(),
        obs_queue=asyncio.Queue(),
        session_id="test",
    )


@pytest.mark.asyncio
async def test_a_playwright_alias_key_is_rejected_and_nothing_is_sent():
    relay = _relay()
    result = await relay.press_key("ControlOrMeta+a")

    assert EXEC_FAILURE in result
    assert "ControlOrMeta+a" in result
    # The point of the test: no "ok", and nothing put on the wire that would
    # come back ok regardless of what Chrome did with it.
    relay._ws_send.assert_not_called()


@pytest.mark.asyncio
async def test_the_rejection_names_a_spelling_that_works():
    """A refusal the model cannot act on is just a slower dead end."""
    result = await _relay().press_key("ControlOrMeta+a")
    assert "modifiers" in result
    assert "Enter" in result


@pytest.mark.asyncio
async def test_a_dispatchable_key_is_forwarded_unchanged():
    relay = _relay()

    async def press(key: str, mods: int = 0) -> str:
        # _send_action blocks on the post-action observation the extension
        # auto-sends, so prime it before each press.
        task = asyncio.create_task(relay.press_key(key, mods))
        await relay._obs_queue.put({"url": "", "title": "", "axTargets": []})
        return await task

    assert await press("Enter") == "ok"
    assert await press("Delete", 2) == "ok"

    sent = [c.args[0]["action"] for c in relay._ws_send.await_args_list]
    assert sent[0] == {"type": "key", "key": "Enter", "modifiers": 0}
    assert sent[1] == {"type": "key", "key": "Delete", "modifiers": 2}
