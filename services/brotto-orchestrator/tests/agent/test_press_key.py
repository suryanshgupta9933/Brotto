"""The model could type into a search box but never submit it.

Measured on a failed HDFC UPI run: 19 steps, the same six-step loop of
click → type → read → nothing changed. Gmail's search box is a combobox
that only commits on Enter, and `press_key` was not an action the model
could emit — the extension already implemented the key dispatch
(`background.ts`, `t === "key"`) and nothing ever constructed it.

The `scroll` test is the same run: the model asked for `amount: 3` and
the harness read `amount_px`, so every scroll silently became 300px.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from brotto_orchestrator.agent.context import ActionCall, AgentDeps
from brotto_orchestrator.agent.harness import _execute_action


def _run(call: ActionCall, cdp) -> str:
    deps = AgentDeps(user_id="u", task="t", cdp=cdp, ws_send=AsyncMock())
    return asyncio.new_event_loop().run_until_complete(_execute_action(call, deps))


def _cdp() -> AsyncMock:
    cdp = AsyncMock()
    cdp.scroll.return_value = None
    cdp.refresh_target_map.return_value = None
    return cdp


# ---------- the action has to be emittable at all ----------


def test_press_key_survives_output_validation():
    """While this was absent from the Literal, pydantic rejected the call
    before the harness saw it — the model had no way to even ask."""
    call = ActionCall(action="press_key", action_args={"key": "Enter"})
    assert call.action == "press_key"


def test_press_key_reaches_the_relay():
    cdp = _cdp()
    out = _run(ActionCall(action="press_key", action_args={"key": "Enter"}), cdp)
    cdp.press_key.assert_awaited_once()
    assert "Enter" in out


def test_a_modified_key_carries_its_modifier():
    """Control+A is how a field gets cleared. Dropping the modifier
    types a literal "a" instead — which is what the extension did for
    every clear_ref on the run that motivated all of this."""
    cdp = _cdp()
    _run(
        ActionCall(
            action="press_key",
            action_args={"key": "a", "modifiers": 2},
        ),
        cdp,
    )
    args = cdp.press_key.await_args[0]
    assert args == ("a", 2)


# ---------- scroll honoured the argument only by accident ----------


def test_scroll_honours_the_amount_the_model_asked_for():
    cdp = _cdp()
    _run(
        ActionCall(action="scroll", action_args={"direction": "down", "amount": 3}),
        cdp,
    )
    assert cdp.scroll.await_args[0][1] == 3


# ---------- the modifier mask, on the real relay ----------


@pytest.mark.asyncio
async def test_an_undefined_modifier_bit_is_dropped_not_forwarded():
    """Only Alt/Ctrl/Meta/Shift exist. A higher bit is undefined in the
    extension's dispatch, so it is stripped here rather than handed over for
    the browser to interpret."""
    from brotto_orchestrator.cdp.extension_relay import ExtensionCDPRelay

    sent: list[dict] = []

    async def ws_send(msg: dict) -> None:
        sent.append(msg)

    relay = ExtensionCDPRelay(ws_send, asyncio.Queue(), asyncio.Queue(), "t")
    await relay._obs_queue.put({"url": "u", "axTargets": []})

    await relay.press_key("a", modifiers=2 | 4096)

    dispatched = sent[0]["action"]
    assert dispatched["modifiers"] == 2, f"forwarded an undefined bit: {dispatched}"


@pytest.mark.asyncio
async def test_a_non_ascii_letter_is_not_a_shortcut():
    """`str.isalnum()` is true for "é" and "क". CDP would dispatch them."""
    from brotto_orchestrator.cdp.extension_relay import ExtensionCDPRelay

    sent: list[dict] = []

    async def ws_send(msg: dict) -> None:
        sent.append(msg)

    relay = ExtensionCDPRelay(ws_send, asyncio.Queue(), asyncio.Queue(), "t")

    out = await relay.press_key("é", modifiers=2)

    assert out.startswith("Error executing")
    assert not sent
