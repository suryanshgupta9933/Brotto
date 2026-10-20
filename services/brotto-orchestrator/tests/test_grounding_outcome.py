"""A ref the model hallucinated must be recorded as a failure, not a success.

`harness.py` computes `ok=not outcome.startswith("Error executing")`. A relay
that returns a friendly sentence for an unresolvable ref therefore writes
`ok: true` into the audit — which is how the grounding failure rate came to be
unmeasurable: every number derived from it was a tautology of the bug.
"""

from __future__ import annotations

import asyncio
import re

import pytest

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
async def test_type_text_refuses_when_nothing_holds_focus():
    """Session 445fc36d: a newly navigated Google Sheet has no selected cell,
    `document.activeElement` is `body`, and `Input.insertText` is discarded —
    but the run reported "Typed into [0:10050]" and completed on an empty
    sheet. A ref resolving is not a place the text lands."""
    relay = _relay([{"ref": "0:7", "role": "textbox", "x": 1, "y": 2}])
    relay.focus_id = AsyncMock(return_value="body")

    out = await relay.type_text_to_ref("0:7", "Name")

    assert out.startswith(FAIL_PREFIX)
    assert "focus" in out
    relay._ws_send.assert_not_called()


@pytest.mark.asyncio
async def test_type_text_refuses_when_focus_is_unreadable():
    """`None` is unknown, not "no focus" — the press_key guard already
    refuses on it, and typing is no safer than a key press."""
    relay = _relay([{"ref": "0:7", "role": "textbox", "x": 1, "y": 2}])
    relay.focus_id = AsyncMock(return_value=None)

    out = await relay.type_text_to_ref("0:7", "Name")

    assert out.startswith(FAIL_PREFIX)
    relay._ws_send.assert_not_called()


@pytest.mark.asyncio
async def test_type_text_never_echoes_the_focused_element():
    """The success string asserted a destination it never checked, and its
    second half named an id the *page* chose. That outcome goes to the audit
    document and to the model's history — page content in a file we own — so
    the element is reported as unnamed. It stays a success (no `Error
    executing:` prefix) so `ok` is still derived true."""
    relay = _relay([{"ref": "0:7", "role": "textbox", "x": 1, "y": 2}])
    relay.focus_id = AsyncMock(return_value="DIV[3]")
    await relay._obs_queue.put({"url": "https://app.example.com/", "axTargets": []})

    out = await relay.type_text_to_ref("0:7", "Name")

    assert not out.startswith(FAIL_PREFIX)
    assert "[0:7]" not in out
    assert "DIV[3]" not in out


@pytest.mark.asyncio
async def test_type_text_does_not_log_the_page_chosen_id(caplog):
    """A log sink is a parser input. An id carrying a newline or an ANSI
    escape would write lines into our own logs, so the id is never logged."""
    relay = _relay([{"ref": "0:7", "role": "textbox", "x": 1, "y": 2}])
    relay.focus_id = AsyncMock(return_value="INPUT#a\nFORGED 2026-10-20 ok\n")
    await relay._obs_queue.put({"url": "https://app.example.com/", "axTargets": []})

    with caplog.at_level("INFO"):
        await relay.type_text_to_ref("0:7", "Name")

    assert "FORGED" not in caplog.text


def test_a_page_chosen_id_outside_the_grammar_is_not_a_focus_id():
    """Shape-validated at the boundary, so forging is impossible rather than
    unlikely. Anything `FOCUS_ID_JS` cannot produce reads as unknown — which
    is what every caller refuses on."""
    from brotto_orchestrator.cdp.relay import parse_focus_id

    # What the JS can return, and nothing rejected.
    for real in ("none", "body", "DIV[3]", "INPUT#name", "A#a.b:c-d_9"):
        assert parse_focus_id(real) == real

    for forged in (
        # A bare tag is not a safe identity — every `<div>` shares one — so
        # `FOCUS_ID_JS` can never return it. If the grammar admits it anyway,
        # a foreign reply shaped `DIV` reads as a real focus answer.
        "DIV",
        # `FOCUS_ID_JS` builds the ordinal from a JS array index, which is
        # ASCII-only, so `INPUT[٣]` is not a value the producer can return.
        # Python's `\d` is Unicode by default and would have admitted it.
        "INPUT[٣]",
        "INPUT#a\nFORGED line",
        "INPUT#a\x1b[31mred",
        "INPUT#a b",
        "INPUT#" + "x" * 65,
        "DIV[9999999]",
        '{"json": true}',          # a foreign evaluate reply
        "the page moved focus",
        None,
        "",
    ):
        assert parse_focus_id(forged) is None, forged


def test_focus_id_js_rejects_an_exotic_id_before_concatenating_it():
    """The same grammar, in JS, because that is where the untrusted string is
    joined onto a tag name."""
    from brotto_orchestrator.cdp.relay import FOCUS_ID_JS

    assert "^[A-Za-z0-9_.:-]{1,64}$" in FOCUS_ID_JS


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
        {"type": "action", "action": {"type": "click", "x": 10, "y": 20, "backendNodeId": None}}
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
    that reported failure, or the text goes to a field the model never named.

    The relay owns the whole sequence now — one call, and the click/clear/
    focus checks inside it — so this pins that a refusal it returns still
    reaches the audit as `ok: false` rather than being read as a success. The
    "did not type" half is pinned at the relay, in
    `test_type_text_fast_path.py`, where the dispatch actually is."""
    from brotto_orchestrator.agent.harness import _execute_action
    from brotto_orchestrator.agent.context import ActionCall

    cdp = AsyncMock()
    cdp.type_text_into_ref = AsyncMock(
        return_value="Error executing: ref '0:99' is not in the current AX tree")

    deps = SimpleNamespace(
        cdp=cdp, step_number=3, user_id="u", result=None, steering=None,
    )
    call = ActionCall(action="type_text", action_args={"ref": "0:99", "text": "hello"})

    out = await _execute_action(call, deps)

    assert out.startswith(FAIL_PREFIX)
    # Exactly one relay call: re-sequencing the steps here is what put the
    # duplicate click back.
    assert [c for c in cdp.mock_calls if c[0] == "type_text_into_ref"]
    assert not [c for c in cdp.mock_calls
                if c[0] in ("focus_ref", "clear_ref", "type_text_to_ref")]

def test_a_wrapped_failure_is_still_recorded_as_not_ok(tmp_path):
    """`ok` is derived by membership of `Error executing`, not by prefix, so a
    failure records as a failure whatever it is wrapped in. The harness used to
    wrap click outcomes as `Clicked [ref]: <result>` and no longer does; this
    is what stops that being re-introduced and a click that never happened
    being written as ok=True — which is exactly what a live Gmail run did."""
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
    cdp.get_page_delta = AsyncMock(return_value=None)
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

    docs = [p for p in (tmp_path / "sessions").glob("*.json")
            if not p.name.endswith(".pages.json")]
    assert len(docs) == 1, f"expected one audit document, got {docs}"
    doc = json.loads(docs[0].read_text())
    clicks = [a for t in doc["turns"] for a in t["actions"] if a["action"] == "click"]
    assert clicks, "no click was recorded"
    assert clicks[0]["ok"] is False, (
        f"grounding failure recorded as ok=True: {clicks[0]['outcome']!r}"
    )

@pytest.mark.asyncio
async def test_a_bare_node_id_resolves_to_its_composite_ref():
    """The model drops the frame prefix, and did so 4/4 times on a live Gmail
    run: the tree renders `[0:149099]` and the action carried `ref: 149099`.
    Every click failed, so every step was spent re-deciding an unchanged page.

    This could not be fixed in the prompt. The bare-number anti-examples were
    removed and the prompt test above still passes — the model emits the
    digits anyway, on every element, every time. So the relay tolerates it.
    """
    relay = _relay([
        {"ref": "0:149099", "role": "link", "x": 30, "y": 40},
        {"ref": "0:149317", "role": "link", "x": 50, "y": 60},
    ])
    await relay._obs_queue.put({"url": "https://app.example.com/", "axTargets": []})

    out = await relay.click_ref("149099")

    assert not out.startswith(FAIL_PREFIX), f"recorded as ok=False: {out!r}"
    relay._ws_send.assert_called_once_with(
        {"type": "action", "action": {"type": "click", "x": 30, "y": 40, "backendNodeId": None}}
    )

@pytest.mark.asyncio
async def test_a_bare_node_id_resolves_for_every_ref_taking_action():
    """`_locate` is the one place every one of these routes through, so one case
    per method: `type_text` into a bare ref must not silently retype into whatever
    holds focus, which is the HDFC failure class."""
    # `backendNodeId` because `type_text_into_ref` refuses a ref with a position
    # and no identity — the subject here is the bare-ref *format*, so the target
    # is otherwise a complete one.
    relay = _relay([{"ref": "0:7", "role": "textbox", "x": 1, "y": 2,
                     "backendNodeId": 99}])
    # One post-action observation per method, queued as each is reached: the
    # extension answers every action it is handed with one, and each of these
    # methods now waits for it — that frame is also how the relay learns
    # whether the dispatch was refused (`action_result`).
    async def _obs():
        await relay._obs_queue.put({"url": "https://app.example.com/", "axTargets": [
            {"ref": "0:7", "role": "textbox", "x": 1, "y": 2}]})
    # Both typing paths read focus before dispatch; answer on that channel.
    await relay._eval_queue.put("INPUT[0]")
    await relay._eval_queue.put("INPUT[0]")

    for method, args in (
        (relay.type_text_into_ref, ("7", "hello")),
        (relay.type_text_to_ref, ("7", "hello")),
    ):
        await _obs()
        out = await method(*args)
        assert not out.startswith(FAIL_PREFIX), f"{method.__name__}: {out!r}"

@pytest.mark.asyncio
async def test_a_bare_node_id_present_in_two_frames_is_refused_not_guessed():
    """nodeId is unique only within a frame, so `42` can name a real element in
    two of them. Guessing would click the wrong one and record ok=True — the
    exact failure the two-state split above exists to keep separable."""
    relay = _relay([
        {"ref": "0:42", "role": "button", "x": 1, "y": 1},
        {"ref": "1:42", "role": "button", "x": 2, "y": 2},
    ])

    out = await relay.click_ref("42")

    assert out.startswith(FAIL_PREFIX)
    assert "ambiguous" in out, f"refusal does not say why: {out!r}"
    assert "0:42" in out, f"refusal does not name the real refs: {out!r}"
    relay._ws_send.assert_not_called()

@pytest.mark.asyncio
async def test_a_hallucinated_bare_node_id_is_still_a_grounding_failure():
    """The fallback must not become a hole: a number the page has never seen
    resolves to nothing, exactly as before."""
    relay = _relay([{"ref": "0:7", "role": "button", "x": 10, "y": 20}])

    out = await relay.click_ref("999999")

    assert out.startswith(FAIL_PREFIX)
    assert "not in the current AX tree" in out
    relay._ws_send.assert_not_called()

@pytest.mark.asyncio
async def test_an_exact_composite_ref_wins_over_the_bare_fallback():
    """A page can hold `0:5` and `1:05`; the model naming `1:05` exactly must
    get `1:05`, not whichever suffix match the scan saw first."""
    relay = _relay([
        {"ref": "0:5", "role": "button", "x": 1, "y": 1},
        {"ref": "1:05", "role": "button", "x": 2, "y": 2},
    ])
    await relay._obs_queue.put({"url": "https://app.example.com/", "axTargets": []})

    out = await relay.click_ref("1:05")

    assert not out.startswith(FAIL_PREFIX), f"recorded as ok=False: {out!r}"
    relay._ws_send.assert_called_once_with(
        {"type": "action", "action": {"type": "click", "x": 2, "y": 2, "backendNodeId": None}}
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



# ── A control that has a box and cannot be clicked ───────────────────────────
#
# Session a7328461: on GitHub's "new branch protection rule" page the agent
# clicked Create ten times across four attempts. Every ref resolved, every
# click was audited ok: true, and the page never changed. The button was past
# the fold of a long form — it had a bounding box, so the relay dispatched a
# coordinate over an empty viewport, and dispatch is the only thing any layer
# knew how to report.
#
# The fix is upstream of this file: the extension hit-tests each centre in the
# page and ships the *reason* with the target. What is pinned here is that a
# reason is never converted into a coordinate, and that the sentence the model
# gets names the next action — an error it cannot act on reproduces the same
# retry loop a silent success does.


@pytest.mark.asyncio
async def test_an_off_screen_control_is_refused_not_clicked():
    relay = _relay([{"ref": "0:7", "role": "button", "blocked": "off-screen"}])

    out = await relay.click_ref("0:7")

    assert out.startswith(FAIL_PREFIX)
    assert "scroll" in out, f"refusal does not say what to do: {out!r}"
    relay._ws_send.assert_not_called()


@pytest.mark.asyncio
async def test_a_covered_control_is_refused_and_names_what_to_dismiss():
    """Occlusion and off-screen want opposite actions. Telling the model to
    scroll when something is on top is a step spent to learn nothing."""
    relay = _relay([{"ref": "0:7", "role": "button", "blocked": "occluded"}])

    out = await relay.click_ref("0:7")

    assert out.startswith(FAIL_PREFIX)
    assert "scroll" not in out, f"an occluded control was sent off to scroll: {out!r}"
    assert "banner" in out, f"refusal does not name the usual culprits: {out!r}"
    relay._ws_send.assert_not_called()


@pytest.mark.asyncio
async def test_a_disabled_control_is_refused_and_points_at_the_form():
    """A disabled Create button is the most useful line on a form: it is
    telling you which field above it is not accepted yet."""
    relay = _relay([{"ref": "0:7", "role": "button", "disabled": True}])

    out = await relay.click_ref("0:7")

    assert out.startswith(FAIL_PREFIX)
    assert "disabled" in out and "form" in out, f"refusal is not actionable: {out!r}"
    relay._ws_send.assert_not_called()


@pytest.mark.asyncio
async def test_disabled_is_answered_before_off_screen():
    """Both can be true. No amount of scrolling changes a disabled button, so
    the answer that costs the model nothing has to win."""
    relay = _relay([
        {"ref": "0:7", "role": "button", "disabled": True, "blocked": "off-screen"},
    ])

    out = await relay.click_ref("0:7")

    assert "disabled" in out, f"scroll was offered for a disabled control: {out!r}"


@pytest.mark.asyncio
async def test_a_blocked_control_stops_type_text_as_well_as_click():
    """`type_text` into a covered field lands in whatever the page decides is
    on top, which for an occluded control is the thing covering it. `_locate`
    is the one gate all four ref-taking methods route through, and this is
    that claim measured."""
    relay = _relay([
        {"ref": "0:7", "role": "textbox", "x": 1, "y": 2, "blocked": "occluded"},
    ])

    out = await relay.type_text_to_ref("0:7", "hello")

    assert out.startswith(FAIL_PREFIX)
    relay._ws_send.assert_not_called()


@pytest.mark.asyncio
async def test_a_target_with_a_box_and_no_reason_still_clicks():
    """The refusal must not become a veto. Anything the extension did not
    flag keeps the pre-existing behaviour, or this change trades a dead click
    for a page where nothing can be clicked at all."""
    relay = _relay([{"ref": "0:7", "role": "button", "x": 10, "y": 20}])
    await relay._obs_queue.put({"url": "https://app.example.com/", "axTargets": []})

    out = await relay.click_ref("0:7")

    assert not out.startswith(FAIL_PREFIX)
    relay._ws_send.assert_called_once_with(
        {"type": "action", "action": {"type": "click", "x": 10, "y": 20, "backendNodeId": None}}
    )


@pytest.mark.asyncio
async def test_the_press_key_refusal_does_not_log_the_page_chosen_id(caplog):
    """The same page-chosen id reaches the harness's own guard, and its
    WARNING line is the other log sink."""
    from brotto_orchestrator.agent.harness import AgentDeps, _focus_refusal

    deps = AgentDeps(
        cdp=SimpleNamespace(focus_id=AsyncMock(
            return_value="INPUT#a\nFORGED 2026-10-20 ok\n")),
        user_id="u", task="t", ws_send=AsyncMock(),
    )
    deps.step_focus = "INPUT#other"

    with caplog.at_level("WARNING"):
        out = await _focus_refusal(deps)

    assert out.startswith(FAIL_PREFIX)
    assert "FORGED" not in caplog.text
    assert "named -> named" in caplog.text


@pytest.mark.asyncio
async def test_type_text_outcome_is_the_relays_own_verdict():
    """The harness used to synthesise `Typed into [0:10183]` — naming the
    destination the relay never checked — on top of a relay that had already
    reported only "focused element". The relay's string is what was verified,
    and it is what the audit document and the model's history get.

    The ref must not reappear in any shape: `0:10183`, `[0:10183]` or
    `Typed into [`, because a bare substring would pass while the decoration
    moved the bracket.
    """
    from brotto_orchestrator.agent.harness import _execute_action
    from brotto_orchestrator.agent.context import ActionCall

    verdict = "Typed 9 characters into the focused element"
    cdp = AsyncMock()
    cdp.type_text_into_ref = AsyncMock(return_value=verdict)

    deps = SimpleNamespace(cdp=cdp, step_number=2, user_id="u")
    call = ActionCall(action="type_text",
                      action_args={"ref": "0:10183", "text": "name"})

    out = await _execute_action(call, deps)

    assert out == verdict
    for shape in ("0:10183", "[0:10183]", "Typed into ["):
        assert shape not in out, f"{shape!r} is a destination claim"


@pytest.mark.asyncio
async def test_a_refused_type_reaches_the_caller_unchanged():
    """The refusal must survive the decoration too: a wrapped `Error
    executing:` is the bug `test_a_wrapped_failure_is_still_recorded_as_not_ok`
    exists for, and the string the model reads has to name the recovery."""
    from brotto_orchestrator.agent.harness import _execute_action
    from brotto_orchestrator.agent.context import ActionCall

    refusal = ("Error executing: ref '0:10183' resolved, but nothing on the "
               "page holds focus, so nothing was typed. Click the element you "
               "meant to type into first, then type again.")
    cdp = AsyncMock()
    cdp.type_text_into_ref = AsyncMock(return_value=refusal)

    deps = SimpleNamespace(cdp=cdp, step_number=2, user_id="u")
    call = ActionCall(action="type_text",
                      action_args={"ref": "0:10183", "text": "name"})

    out = await _execute_action(call, deps)

    assert out == refusal


@pytest.mark.asyncio
async def test_a_click_outcome_reaches_the_caller_unchanged():
    """The click path wrapped the relay's verdict as `Clicked [ref]: <result>`,
    which asserted a destination a second time — and asserted one the relay
    never checked. Session 3dab5bb6: on a canvas page the model clicked a node
    it read as a cell, the text went to the formula bar, and both the history
    line and the audit document said `Clicked [0:10183]: Clicked [0:10183]`.
    Same class as the `type_text` decoration fixed in 11fa5fff."""
    from brotto_orchestrator.agent.harness import _execute_action
    from brotto_orchestrator.agent.context import ActionCall

    verdict = "Clicked [0:10183]"
    cdp = AsyncMock()
    cdp.click_ref = AsyncMock(return_value=verdict)
    cdp.refresh_target_map = AsyncMock()

    deps = SimpleNamespace(cdp=cdp, step_number=2, user_id="u", policy=None)
    call = ActionCall(action="click", action_args={"ref": "0:10183"})

    out = await _execute_action(call, deps)

    assert out == verdict, f"the harness restated the verdict: {out!r}"
    assert out.count("0:10183") == 1, "the ref is asserted twice"


@pytest.mark.asyncio
async def test_a_refused_click_reaches_the_caller_unchanged():
    """`ok` is derived by membership, so the refusal still records as a
    failure — but the string the model reads must carry the relay's reason,
    not a success-shaped prefix in front of it."""
    from brotto_orchestrator.agent.harness import _execute_action, _EXEC_FAILURE
    from brotto_orchestrator.agent.context import ActionCall

    refusal = ("Error executing: ref '0:10183' is not in the current AX tree")
    cdp = AsyncMock()
    cdp.click_ref = AsyncMock(return_value=refusal)
    cdp.refresh_target_map = AsyncMock()

    deps = SimpleNamespace(cdp=cdp, step_number=2, user_id="u", policy=None)
    call = ActionCall(action="click", action_args={"ref": "0:10183"})

    out = await _execute_action(call, deps)

    assert out == refusal
    assert _EXEC_FAILURE in out
