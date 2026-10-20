"""`type_text` is one `type_at` action and one evaluate, without losing a guard.

Each test names the guard it is pinning, and each is written to fail against
both the pre-collapse three-call sequence and the removal of its own guard — so
a green run means the collapse landed *and* the check still holds.
"""

from __future__ import annotations

import asyncio
import inspect

import pytest

from unittest.mock import AsyncMock  # noqa: E402

from brotto_orchestrator.cdp import relay as relay_mod  # noqa: E402
from brotto_orchestrator.cdp import extension_relay as relay_ext_mod  # noqa: E402
from brotto_orchestrator.cdp.extension_relay import ExtensionCDPRelay  # noqa: E402

FAIL_PREFIX = "Error executing"


def _relay(targets: list[dict]) -> ExtensionCDPRelay:
    relay = ExtensionCDPRelay(
        ws_send=AsyncMock(), obs_queue=asyncio.Queue(), session_id="test",
    )
    relay._cached_obs = {
        "url": "https://docs.google.com/", "title": "Sheet1", "axTargets": targets,
    }
    return relay


def _target(**over) -> dict:
    base = {"ref": "0:7", "role": "textbox", "x": 10, "y": 20, "backendNodeId": 99}
    base.update(over)
    return base


def _drain_obs(relay: ExtensionCDPRelay, n: int = 1) -> None:
    """Queue the post-action observations the extension sends unconditionally."""
    for _ in range(n):
        relay._obs_queue.put_nowait(
            {"url": "https://docs.google.com/", "axTargets": []}
        )


def _actions(relay: ExtensionCDPRelay) -> list[dict]:
    return [
        c.args[0]["action"] for c in relay._ws_send.call_args_list
        if c.args[0].get("type") == "action"
    ]


# ── the collapse itself ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_type_text_sends_exactly_one_action():
    """`focus_ref` and `clear_ref` both dispatched `{"type": "click", …}` at the
    same coordinates with the same `backendNodeId`, and every trip blocks on a
    post-action observation. One keystroke is one frame now."""
    relay = _relay([_target()])
    _drain_obs(relay)
    relay._eval_queue.put_nowait("INPUT[0]")

    out = await relay.type_text_into_ref("0:7", "Name")

    assert not out.startswith(FAIL_PREFIX), out
    assert len(_actions(relay)) == 1, _actions(relay)


@pytest.mark.asyncio
async def test_the_one_frame_carries_the_clear_and_not_a_key_chord():
    """The clear was `Control+a` with a `modifiers` bitmask — an OS question on
    the wire, and "which chord means select-all" is the extension's to answer.
    `backendNodeId` rides along so `verifyTarget`'s `DOM.resolveNode` binding
    still runs inside the press; dropping it is what an unverified type is."""
    relay = _relay([_target()])
    _drain_obs(relay)
    relay._eval_queue.put_nowait("INPUT[0]")

    await relay.type_text_into_ref("0:7", "Name")

    assert _actions(relay) == [{
        "type": "type_at", "x": 10, "y": 20, "backendNodeId": 99,
        "text": "Name", "clear": True,
    }]


@pytest.mark.asyncio
async def test_an_append_ask_is_carried_as_clear_false():
    """`clear` says *replace*, and appending to a field the model asked to empty
    is the same wrong answer as the bare "a" that typed a letter into it."""
    relay = _relay([_target()])
    _drain_obs(relay)
    relay._eval_queue.put_nowait("INPUT[0]")

    await relay.type_text_into_ref("0:7", "more", clear=False)

    assert _actions(relay)[0]["clear"] is False


@pytest.mark.asyncio
async def test_the_server_sends_no_evaluate_but_the_focus_read():
    """One evaluate survives — the focus pre-check. The clear's evaluate is the
    extension's now, inside the action."""
    relay = _relay([_target()])
    _drain_obs(relay)
    relay._eval_queue.put_nowait("INPUT[0]")

    await relay.type_text_into_ref("0:7", "Name")

    evaluates = [
        c for c in relay._ws_send.call_args_list
        if c.args[0].get("type") == "evaluate"
    ]
    assert len(evaluates) == 1, evaluates
    assert evaluates[0].args[0]["expression"] == relay_mod.FOCUS_ID_JS


# ── guards that must survive the collapse ───────────────────────────────────

@pytest.mark.asyncio
async def test_a_ref_the_page_no_longer_has_types_nothing():
    """The HDFC failure class: `_locate` still runs, before anything is sent."""
    relay = _relay([_target()])
    _drain_obs(relay)

    out = await relay.type_text_into_ref("0:99", "Name")

    assert out.startswith(FAIL_PREFIX)
    relay._ws_send.assert_not_called()


@pytest.mark.asyncio
async def test_focus_on_body_types_nothing():
    """Session 445fc36d: a freshly opened Sheet has `activeElement === body`,
    `Input.insertText` is discarded, and the run reported success. The press in
    `type_at` *creates* focus, so this cannot be left to the extension — it is
    the check that asks whether the model meant this field."""
    relay = _relay([_target()])
    _drain_obs(relay)
    relay._eval_queue.put_nowait("body")

    out = await relay.type_text_into_ref("0:7", "Name")

    assert out.startswith(FAIL_PREFIX)
    assert "focus" in out
    assert _actions(relay) == []


@pytest.mark.asyncio
async def test_focus_on_none_types_nothing():
    """`none` is the JS's own "nothing is focusable here", not a tag."""
    relay = _relay([_target()])
    _drain_obs(relay)
    relay._eval_queue.put_nowait("none")

    out = await relay.type_text_into_ref("0:7", "Name")

    assert out.startswith(FAIL_PREFIX)
    assert _actions(relay) == []


@pytest.mark.asyncio
async def test_an_unreadable_focus_read_types_nothing():
    """`_eval_queue` is shared and not request-correlated, so a foreign reply is
    a real possibility (see `parse_focus_id`). Unknown means do not type."""
    relay = _relay([_target()])
    _drain_obs(relay)
    # A reply from another producer: not this evaluate's shape at all.
    relay._eval_queue.put_nowait('{"width": 1512, "height": 800}')

    out = await relay.type_text_into_ref("0:7", "Name")

    assert out.startswith(FAIL_PREFIX)
    assert _actions(relay) == []


@pytest.mark.asyncio
async def test_the_focus_read_is_sent_before_the_action():
    """The pre-check is a *pre*-check. Dispatching first would let the press
    create the focus it then validates."""
    relay = _relay([_target()])
    _drain_obs(relay)
    relay._eval_queue.put_nowait("INPUT[0]")

    await relay.type_text_into_ref("0:7", "Name")

    kinds = [c.args[0].get("type") for c in relay._ws_send.call_args_list]
    assert kinds.index("evaluate") < kinds.index("action"), kinds


@pytest.mark.asyncio
async def test_a_refused_dispatch_reports_the_extension_own_words():
    """`clear-select-noop`, `clear-no-text-field`, `clear-threw`: the extension
    refuses the whole action and the model gets its reason, because it is the
    only side that knows why. Nothing here synthesises a success."""
    relay = _relay([_target()])

    async def _send(frame):
        if frame.get("type") == "action":
            relay._obs_queue.put_nowait(
                {"url": "https://docs.google.com/", "axTargets": []})
            relay.deliver_action_result(
                {"ok": False, "reason": "clear-select-noop"})
        await real_send(frame)
    real_send = relay._ws_send
    relay._ws_send = _send
    relay._eval_queue.put_nowait("INPUT[0]")

    out = await relay.type_text_into_ref("0:7", "Name")

    assert out.startswith(FAIL_PREFIX)
    assert "clear-select-noop" in out
    assert "Typed" not in out


@pytest.mark.asyncio
async def test_the_outcome_names_neither_the_ref_nor_the_focused_element():
    """Both strings reach the audit document and the model's history. Naming
    the ref asserts a destination nothing re-checked; naming the element writes
    a page-chosen id into a file we own."""
    relay = _relay([_target()])
    _drain_obs(relay)
    relay._eval_queue.put_nowait("INPUT#secretish")

    out = await relay.type_text_into_ref("0:7", "Name")

    assert not out.startswith(FAIL_PREFIX)
    assert "0:7" not in out
    assert "secretish" not in out


@pytest.mark.asyncio
async def test_the_page_chosen_id_is_never_logged(caplog):
    """A log sink is a parser input; an id carrying a newline forges a line."""
    relay = _relay([_target()])
    _drain_obs(relay)
    relay._eval_queue.put_nowait("INPUT#a\nFORGED 2026-10-20 ok\n")

    with caplog.at_level("INFO"):
        await relay.type_text_into_ref("0:7", "Name")

    assert "FORGED" not in caplog.text


@pytest.mark.asyncio
async def test_each_phase_reports_its_own_duration(caplog):
    """The 19.9s has never been attributed to anything on disk — no recorded
    `type_text` exceeds 5.2s. Per-phase timing is the only way the next run
    says which trip the seconds are in."""
    relay = _relay([_target()])
    _drain_obs(relay)
    relay._eval_queue.put_nowait("INPUT[0]")

    with caplog.at_level("INFO"):
        await relay.type_text_into_ref("0:7", "Name")

    for phase in ("focus", "type_at"):
        assert f"phase={phase} duration_ms=" in caplog.text, (
            f"no duration for {phase}: {caplog.text!r}"
        )


# ── the server-side clear, gone for good ────────────────────────────────────

def test_the_extension_relay_names_no_server_side_select_all():
    """The clear is the extension's, inside the `type_at` press — it acts on the
    element *that* press focused, not on the `activeElement` from before it.

    `SELECT_ALL_JS` still exists in `relay.py` for the Playwright fallback, so
    "is the symbol gone from the codebase" is the wrong question: that one has
    no answer that can change. This asks the question that can, of the method
    that would send it — a re-imported `SELECT_ALL_JS`, or a `modifiers` chord
    brought back to mean select-all, goes red here. Scoped to `type_text_into_ref`
    because `press_key` legitimately carries a bitmask, and an AST walk, so the
    docstring explaining *why* they are absent is prose and not a failure."""
    import ast
    import textwrap

    tree = ast.parse(textwrap.dedent(inspect.getsource(
        relay_ext_mod.ExtensionCDPRelay.type_text_into_ref)))
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    strings = {
        n.value for n in ast.walk(tree)
        if isinstance(n, ast.Constant) and isinstance(n.value, str)
    }
    assert "SELECT_ALL_JS" not in names | strings
    assert "modifiers" not in names | strings


# ── the harness callsite ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_harness_types_with_one_relay_call():
    """The call site is the collapse. If this reverts to sequencing the three
    methods, the duplicate click is back and no relay test notices."""
    from brotto_orchestrator.agent.harness import _execute_action
    from brotto_orchestrator.agent.context import ActionCall

    cdp = AsyncMock()
    cdp.type_text_into_ref = AsyncMock(return_value="Typed 4 characters")
    deps = SimpleNamespaceDeps(cdp)
    call = ActionCall(action="type_text", action_args={"ref": "0:7", "text": "Name"})

    out = await _execute_action(call, deps)

    assert not out.startswith(FAIL_PREFIX)
    cdp.type_text_into_ref.assert_awaited_once_with("0:7", "Name")
    for old in ("focus_ref", "clear_ref", "type_text_to_ref"):
        assert not [c for c in cdp.mock_calls if c[0] == old], old


def test_the_dev_relay_keeps_its_own_shape():
    """Playwright evaluates in-page and takes no observation, so there is
    nothing there to collapse — it stays the three-trip fallback, and a `clear`
    argument must not silently become a second spelling of `clear_ref`."""
    import inspect

    params = list(inspect.signature(
        relay_mod.CDPRelay.type_text_into_ref).parameters)
    assert params == ["self", "ref", "text"]


def SimpleNamespaceDeps(cdp):
    from types import SimpleNamespace
    return SimpleNamespace(cdp=cdp, step_number=1, user_id="u", result=None,
                           steering=None)