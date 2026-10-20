"""Which `evaluate` callers ask for the isolated world, and what a failed one does.

The `evaluate` frame grew an opt-in `isolatedWorld` flag: absent or false is
the main world and `returnByValue: true`, exactly what shipped; true evaluates
the *same* expression in the tab's isolated world, whose JS globals are the
extension's. The DOM is shared, so `document` and every element are the same
objects either way — only the globals an expression resolves through differ.

So the flag is not a blanket setting, and these tests are what stops it being
read as one: `focus_id` and `probe_xy` take it, `read_page_text` does not, and
the reason for each is in the code at the call site.

The second half is the failure mode. When the extension cannot create the
world it answers `{value: "", error: …}` rather than falling back to the main
world, and `main.py` puts only `value` on `_eval_queue` — so the relay receives
`""`. That has to be a *refusal* on both destructive paths, and it is: `""` is
not in `FOCUS_ID_RE`, and it is not a JSON object for the probe to parse.
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock

import pytest

from brotto_orchestrator.cdp.extension_relay import ExtensionCDPRelay


def _relay() -> ExtensionCDPRelay:
    return ExtensionCDPRelay(ws_send=AsyncMock(), obs_queue=asyncio.Queue(),
                             session_id="test")


async def _evaluate(relay: ExtensionCDPRelay, call, reply: str) -> dict:
    """Run an `evaluate`-based call to completion with `reply` on the queue.

    The queue is fed *after* the frame is sent, because that is the order the
    extension answers in — and it is what makes the shared, uncorrelated
    `_eval_queue` a real hazard rather than a documented one.
    """
    task = asyncio.create_task(call)
    await asyncio.sleep(0)
    sent = relay._ws_send.await_args.args[0]
    relay._eval_queue.put_nowait(reply)
    await task
    return sent


# ---------- who takes the flag ----------

@pytest.mark.asyncio
async def test_focus_id_asks_for_the_isolated_world():
    """A destructive path. The page owns `document`'s globals in the main
    world and could report a focus that is not there; `bindFocus` still refuses
    independently, so this closes a hardening gap rather than a wall."""
    relay = _relay()
    sent = await _evaluate(relay, relay.focus_id(), "INPUT#name")
    assert sent["type"] == "evaluate"
    assert sent["isolatedWorld"] is True


@pytest.mark.asyncio
async def test_probe_xy_asks_for_the_isolated_world():
    """A decision, not a readout. `window.innerWidth`/`innerHeight` are
    page-writable globals, and the bound check they feed is the only thing
    between a model-chosen point and a press; `tag` is what refuses a covered
    canvas."""
    relay = _relay()
    reply = json.dumps({"width": 1512, "height": 900, "tag": "CANVAS"})
    sent = await _evaluate(relay, relay.probe_xy(412, 288), reply)
    assert sent["isolatedWorld"] is True


@pytest.mark.asyncio
async def test_read_page_text_stays_in_the_main_world():
    """The deliberate non-application. What comes back *is* page content and is
    page-controlled in any world; it reads `document.body.innerText`, a DOM
    property shared across worlds, and only feeds the prompt. Isolating it would
    protect the page's text from the page and buy nothing."""
    relay = _relay()
    sent = await _evaluate(relay, relay.read_page_text(), "hello")
    assert sent["type"] == "evaluate"
    assert "isolatedWorld" not in sent


# ---------- the failure mode: a world that cannot be created ----------

@pytest.mark.asyncio
async def test_an_unevaluatable_focus_read_is_unknown_not_a_focus_state():
    """The extension's answer when `Page.createIsolatedWorld` fails:
    `{value: "", error: …}`, and `main.py` forwards only `value`. So the relay
    sees `""` — which is *not* `none` or `body` (the page saying nothing holds
    focus) and is not a usable identity either. It is the extension failing to
    answer, and `parse_focus_id` turns it into `None`."""
    relay = _relay()
    task = asyncio.create_task(relay.focus_id())
    await asyncio.sleep(0)
    relay._eval_queue.put_nowait("")
    assert await task is None


@pytest.mark.asyncio
async def test_a_failed_world_refuses_the_type_rather_than_typing_nothing():
    """The consequence that matters. `type_text_into_ref` gates on focus, so a
    world that could not be created must land on the refusal branch and never
    dispatch the `type_at` frame — a pass here would clear and retype a field
    on the strength of a read nobody performed."""
    relay = _relay()
    relay._cached_obs = {"url": "https://example.com", "axTargets": [
        {"ref": "e1", "tag": "input", "x": 10, "y": 20, "backendNodeId": 7},
    ]}

    async def call():
        task = asyncio.create_task(
            relay.type_text_into_ref("e1", "hello", clear=True))
        await asyncio.sleep(0)
        relay._eval_queue.put_nowait("")  # the extension's error answer
        return await task

    outcome = await call()
    assert outcome.startswith("Error executing:")
    assert "nothing was typed" in outcome
    # No `type_at` was sent — the only frame on the wire is the evaluate.
    assert relay._ws_send.await_count == 1


@pytest.mark.asyncio
async def test_an_unevaluatable_probe_is_empty_rather_than_a_bound():
    """`probe_xy` fails closed the same way: `""` is not JSON, so it parses to
    `{}`, and every caller of `{}` refuses (`width <= 0` in
    `_coordinate_action`). An empty dict is not a viewport, and it must never
    read as one."""
    relay = _relay()
    task = asyncio.create_task(relay.probe_xy(412, 288))
    await asyncio.sleep(0)
    relay._eval_queue.put_nowait("")  # the extension's error answer
    assert await task == {}
