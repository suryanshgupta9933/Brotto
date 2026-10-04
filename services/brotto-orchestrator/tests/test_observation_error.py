"""A tab Brotto cannot read must fail, not arrive as an empty page.

`main.py` answers an `observation_error` frame by putting something on the
observation queue. It used to be `{"url": "", "title": "", "axTargets": []}` —
structurally indistinguishable from a page that genuinely rendered nothing, so
the harness built a step from it and handed the model a site with no controls
on it. A debugger Chrome had ended under the run read as a website that had
not loaded, and the model was asked to work out what to do about it.

The frame is a marker now, and the one consumer that could have mistaken it
for a page raises instead. This is worth pinning because the failure it
prevents is invisible: nothing crashes, and the resulting run looks like an
ordinary step on an ordinary (blank) site.
"""

from __future__ import annotations

import asyncio

import pytest

from brotto_orchestrator.cdp.extension_relay import (
    ExtensionCDPRelay, TabUnreachable,
)


def _relay(obs_queue: asyncio.Queue) -> ExtensionCDPRelay:
    return ExtensionCDPRelay(
        ws_send=asyncio.sleep, obs_queue=obs_queue, session_id="test",
    )


@pytest.mark.asyncio
async def test_an_observation_error_is_not_a_page():
    q: asyncio.Queue = asyncio.Queue()
    q.put_nowait({"__error__": "Command failed: not attached"})
    with pytest.raises(TabUnreachable):
        await _relay(q)._get_observation()


@pytest.mark.asyncio
async def test_a_real_observation_still_comes_back_intact():
    q: asyncio.Queue = asyncio.Queue()
    page = {"url": "https://x.test/", "title": "X", "axTargets": [{"ref": "[0:1]"}]}
    q.put_nowait(page)
    assert await _relay(q)._get_observation() is page
