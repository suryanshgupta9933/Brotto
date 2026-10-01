"""A ref the model hallucinated must be recorded as a failure, not a success.

`harness.py` computes `ok=not outcome.startswith("Error executing")`. A relay
that returns a friendly sentence for an unresolvable ref therefore writes
`ok: true` into the audit — which is how the grounding failure rate came to be
unmeasurable: every number derived from it was a tautology of the bug.
"""

from __future__ import annotations

import asyncio
import os
import re

import pytest

os.environ.setdefault("ANTHROPIC_API_KEY", "test")
os.environ.setdefault("AGENT_AUTH_DISABLED", "true")

from unittest.mock import AsyncMock  # noqa: E402
from types import SimpleNamespace  # noqa: E402

from brotto_orchestrator.cdp.extension_relay import ExtensionCDPRelay  # noqa: E402


def _relay(targets: list[dict]) -> ExtensionCDPRelay:
    relay = ExtensionCDPRelay(
        ws_send=AsyncMock(), obs_queue=asyncio.Queue(), session_id="test",
    )
    relay._cached_obs = {
        "url": "https://app.example.com/", "title": "Home", "axTargets": targets,
    }
    return relay


# The string harness.py keys `ok` off. Named so a refactor that breaks the
# contract fails here rather than silently re-recording failures as successes.
FAIL_PREFIX = "Error executing"


@pytest.mark.asyncio
async def test_a_ref_absent_from_the_tree_is_a_failure():
    """The whole point: a ref the model made up is a grounding failure."""
    relay = _relay([{"ref": "0:7", "role": "button", "x": 10, "y": 20}])

    out = await relay.click_ref("0:99")

    assert out.startswith(FAIL_PREFIX), f"recorded as ok=True: {out!r}"
    assert "0:99" in out
    relay._ws_send.assert_not_called()


@pytest.mark.asyncio
async def test_absent_and_offscreen_are_distinguishable():
    """One `None` used to mean both, so a hallucination and an off-screen
    element were the same line in the audit."""
    offscreen = _relay([{"ref": "0:7", "role": "button"}])

    out = await offscreen.click_ref("0:7")

    assert out.startswith(FAIL_PREFIX)
    assert "not in the current AX tree" not in out
    assert "off-screen" in out, f"off-screen read as absent: {out!r}"


@pytest.mark.asyncio
async def test_a_ref_with_coordinates_still_clicks():
    relay = _relay([{"ref": "0:7", "role": "button", "x": 10, "y": 20}])
    # _send_action blocks on the post-action observation the extension pushes
    # back; nothing drives it here, so queue the one it is waiting for.
    await relay._obs_queue.put({"url": "https://app.example.com/", "axTargets": []})

    out = await relay.click_ref("0:7")

    assert not out.startswith(FAIL_PREFIX)
    relay._ws_send.assert_called_once_with(
        {"type": "action", "action": {"type": "click", "x": 10, "y": 20}}
    )


@pytest.mark.asyncio
async def test_type_text_into_a_hallucinated_ref_does_not_type():
    """The HDFC failure class: focus silently no-ops, then the text lands in
    whatever was focused before. The ref is the only signal that it missed."""
    relay = _relay([{"ref": "0:7", "role": "textbox", "x": 1, "y": 2}])

    out = await relay.type_text_to_ref("0:99", "hello")

    assert out.startswith(FAIL_PREFIX)
    relay._ws_send.assert_not_called()


@pytest.mark.asyncio
async def test_the_harness_stops_type_text_when_focus_failed():
    """Belt to the relays' braces: the harness must not type after a focus
    that reported failure, or the text goes to a field the model never named."""
    from brotto_orchestrator.agent.harness import _execute_action
    from brotto_orchestrator.agent.context import ActionCall

    cdp = AsyncMock()
    cdp.focus_ref = AsyncMock(return_value="Error executing: ref '0:99' is not in the current AX tree")
    cdp.clear_ref = AsyncMock(return_value="ok")
    cdp.type_text_to_ref = AsyncMock(return_value="ok")

    deps = SimpleNamespace(
        cdp=cdp, step_number=3, user_id="u", result=None, steering=None,
    )
    call = ActionCall(action="type_text", action_args={"ref": "0:99", "text": "hello"})

    out = await _execute_action(call, deps)

    assert out.startswith(FAIL_PREFIX)
    cdp.clear_ref.assert_not_awaited()
    cdp.type_text_to_ref.assert_not_awaited()


def test_a_wrapped_failure_is_still_recorded_as_not_ok(tmp_path):
    """The harness decorates the relay's outcome as `Clicked [ref]: <result>`,
    which puts a success-shaped prefix in front of the failure marker. A
    derivation that only looks at the *start* of the string then writes
    ok=True for a click that never happened — which is exactly what a live
    Gmail run recorded."""
    import json

    from brotto_orchestrator.agent.context import ActionCall, AgentDeps
    from brotto_orchestrator.agent.harness import AgentHarness
    from brotto_orchestrator.testing.scripted_planner import ScriptedPlanner, ScriptedStep

    planner = ScriptedPlanner(
        [ScriptedStep(thought="open it", actions=[ActionCall(
            action="click", action_args={"ref": "0:13829"})])],
        on_exhausted="task_complete",
    )
    cdp = AsyncMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=[])
    cdp.get_current_url = AsyncMock(return_value="https://app.example.com/")
    cdp.get_page_title = AsyncMock(return_value="Home")
    cdp.get_page_text = AsyncMock(return_value="")
    cdp.refresh_target_map = AsyncMock()
    # What extension_relay.click_ref really returned on the live run.
    cdp.click_ref = AsyncMock(
        return_value="Error executing: ref 13829 is not in the current AX tree")

    q: asyncio.Queue = asyncio.Queue()
    q.put_nowait("yes")
    deps = AgentDeps(
        user_id="t", task="read my mail", cdp=cdp,
        ws_send=AsyncMock(), human_input_queue=q, scripted_planner=planner,
    )

    async def _go():
        return await AgentHarness().run(deps)
    asyncio.new_event_loop().run_until_complete(_go())

    docs = list((tmp_path / "sessions").glob("*.json"))
    assert len(docs) == 1, f"expected one audit document, got {docs}"
    doc = json.loads(docs[0].read_text())
    clicks = [a for t in doc["turns"] for a in t["actions"] if a["action"] == "click"]
    assert clicks, "no click was recorded"
    assert clicks[0]["ok"] is False, (
        f"grounding failure recorded as ok=True: {clicks[0]['outcome']!r}"
    )


def test_the_prompt_does_not_demonstrate_a_bare_number_as_a_ref():
    """Live Gmail run: the model emitted `ref: 13829` instead of `0:13829`,
    twice. The prompt's own anti-examples were the source — two "Bad:" lines
    reading `clicking ref 42` / `ref 28863`, which is the format it then
    copied. A bare number is not a ref; nothing can resolve it."""
    from brotto_orchestrator.agent.prompt import SYSTEM_PROMPT

    offenders = [
        line.strip() for line in SYSTEM_PROMPT.splitlines()
        if re.search(r"\bref \d", line)
    ]
    assert not offenders, (
        "prompt shows a bare-number ref, which teaches the model to emit one:\n  "
        + "\n  ".join(offenders)
    )

