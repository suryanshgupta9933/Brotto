"""The pixel shutter: run-wide for a proven secret, two steps for an ambiguous
write.

Splitting `run_secrets` (the scrub list) from the list the pixel vetoes read
was right, and it left one exposure. An *ambiguous* write — a typed value the
harness refused to write because it could not tell a password box from a
spreadsheet cell — is not evidence that the run touched a credential, so it
does not latch the run. But it is not nothing either: a value cannot have been
rendered before it was typed, so the only exposure is the observation taken
after the keystroke, and that observation is exactly what the veto exists to
close. Latching it permanently re-poisoned every canvas run; ignoring it left
the post-keystroke capture open.

So the shutter has two durations. `_PixelVeto` opens it for
`_AMBIGUOUS_PIXEL_WINDOW` steps after an ambiguous write and forever after a
positive one, and it is READ rather than consumed — the reason an early exit
from the step loop cannot shorten it.

No live model, no key, no network.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from brotto_orchestrator.agent.context import (
    ActionCall, AgentDecision, AgentDeps, TaskResult,
)
from brotto_orchestrator.agent.harness import (
    _AMBIGUOUS_MARKER, _AMBIGUOUS_PIXEL_WINDOW, AgentHarness, _PixelVeto,
    _pixel_latch,
)
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget
import brotto_orchestrator.agent.harness as harness_mod


# --- the mechanism -------------------------------------------------------

def test_an_unarmed_run_is_open_for_pixels():
    assert _PixelVeto().open(0) is False


def test_a_latched_secret_vetoes_for_the_whole_run():
    v = _PixelVeto()
    v.latched.append("hunter2")
    for step in range(0, 40):
        assert v.open(step) is True
        assert _pixel_latch(v, step) == ["hunter2"]


def test_an_ambiguous_write_vetoes_then_releases():
    v = _PixelVeto()
    v.arm(4)
    assert [v.open(s) for s in (4, 5, 6)] == [True, True, True]
    assert v.open(7) is False


def test_the_window_is_never_narrower_than_the_two_it_advertises():
    # Two observations AFTER the keystroke, plus the keystroke's own step,
    # which is closed free. Anything less than this is a weaker fix wearing
    # this one's name.
    assert _AMBIGUOUS_PIXEL_WINDOW == 2


def test_a_second_ambiguous_write_re_opens_rather_than_shortens():
    v = _PixelVeto()
    v.arm(0)
    v.arm(1)
    assert v.open(2) is True and v.open(3) is True
    assert v.open(4) is False


def test_the_marker_carries_no_typed_value():
    """The relays read this for truthiness only, so it must never be a value
    someone typed."""
    v = _PixelVeto()
    v.arm(0)
    assert _pixel_latch(v, 1) == [_AMBIGUOUS_MARKER]
    assert _pixel_latch(v, 99) == []


def test_the_window_survives_any_number_of_exits():
    """Nothing decrements the shutter, so a break, a terminal action, an
    `ask_human`, a cancellation or `deps.result` ending the loop cannot
    shorten it. There is no countdown for an exit to eat."""
    v = _PixelVeto()
    v.arm(0)
    for _ in range(3):
        assert v.open(1) is True
        assert v.open(2) is True
    assert v.open(3) is False


# --- driven through the run loop -----------------------------------------

class _EmptyResult:
    usage = None


_CELL = "9:999"          # a canvas cell: a ref that resolves to nothing


def _deps(targets=None) -> AgentDeps:
    cdp = MagicMock()
    cdp.ping = AsyncMock(return_value=True)
    cdp.get_targets = AsyncMock(return_value=targets if targets is not None else [
        SemanticTarget(ref_id="0:1", tag="button", role="button", name="Save")])
    cdp.get_current_url = AsyncMock(return_value="https://example.com/sheet")
    cdp.get_page_text = AsyncMock(return_value="")
    cdp.get_page_delta = AsyncMock(return_value=None)
    cdp.get_page_title = AsyncMock(return_value="Untitled spreadsheet")
    cdp.refresh_target_map = AsyncMock()

    async def ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="t", task="type", cdp=cdp, ws_send=ws_send)


def _script(monkeypatch, batches, deps):
    """Plan step i to emit `batches[i]`; past the end, complete the task."""
    seen: list[int] = []

    async def _fake_execute(call, d, audit=None, turn=None, **_ignored):
        if call.action == "task_complete":
            d.result = TaskResult(status="completed", summary="ok")
        return f"{call.action} done"

    async def _fake_plan(d, turn, agent, audit=None):
        i = len(seen)
        seen.append(1)
        d.result = None
        if i >= len(batches):
            return AgentDecision(
                reasoning="done", thought="done",
                actions=[ActionCall(action="task_complete",
                                    action_args={"summary": "ok",
                                                 "extracted_data": None})],
            ), 400_000, _EmptyResult()
        return AgentDecision(reasoning="ok", thought="ok",
                             actions=batches[i]), 400_000, _EmptyResult()

    monkeypatch.setattr(harness_mod, "_execute_action", _fake_execute)
    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)


def _typed(ref: str, text: str) -> ActionCall:
    return ActionCall(action="type_text", action_args={"ref": ref, "text": text})


def _delta_latches(deps) -> list:
    """Every `run_secrets` the step-observe delta was called with, in order."""
    return [c.kwargs.get("run_secrets")
            for c in deps.cdp.get_page_delta.await_args_list]


def _delta_redactions(deps) -> list:
    """Every `redactions` report the step-observe delta was called with."""
    return [c.kwargs.get("redactions")
            for c in deps.cdp.get_page_delta.await_args_list]


async def _run(monkeypatch, batches, deps=None, timeout=10):
    deps = deps or _deps()
    _script(monkeypatch, batches, deps)
    await asyncio.wait_for(AgentHarness().run(deps), timeout=timeout)
    return deps


@pytest.mark.asyncio
async def test_an_ambiguous_write_vetoes_the_next_observations_then_releases(
        monkeypatch):
    """The fix. Step 0 types into a cell the harness cannot classify; the
    observations after the keystroke must not photograph it, and the one after
    the window closes must."""
    deps = await _run(monkeypatch,
                      [[_typed(_CELL, "Q3 revenue")], [], [], []])

    latches = _delta_latches(deps)
    assert latches[0] == []            # step 0 observed before the keystroke
    assert latches[1] == [_AMBIGUOUS_MARKER]   # the window
    assert latches[2] == [_AMBIGUOUS_MARKER]
    assert len(latches) >= 4
    assert all(l == [] for l in latches[3:])   # released, stays released


@pytest.mark.asyncio
async def test_a_positively_identified_secret_vetoes_for_the_whole_run(
        monkeypatch):
    """The escape hatch on the narrowing: a field we actually saw, whose name
    says password, latches and the shutter never re-opens."""
    deps = _deps(targets=[
        SemanticTarget(ref_id="0:1", tag="button", role="button", name="Save"),
        SemanticTarget(ref_id="0:2", tag="input", role="textbox",
                       name="Password")])
    await _run(monkeypatch, [[_typed("0:2", "hunter2")], [], [], []], deps)

    latches = _delta_latches(deps)
    assert latches[0] == []
    assert latches[1:] == [["hunter2"]] * (len(latches) - 1)


@pytest.mark.asyncio
async def test_a_per_step_redaction_still_vetoes_that_step(monkeypatch):
    """Unchanged: `redactions` is per-step, so a page whose text held a
    credential is vetoed for that step and only that step."""
    deps = _deps()
    reads = {"n": 0}

    async def _page_text(*_a, **_k):
        reads["n"] += 1
        # The second read is step 1's observe.
        return "card 4111 1111 1111 1111" if reads["n"] == 2 else "clean"

    deps.cdp.get_page_text = AsyncMock(side_effect=_page_text)
    await _run(monkeypatch, [[], [], [], []], deps)

    reports = _delta_redactions(deps)
    assert reports[1] == {"card": 1}    # redact_text's own report, passed on
    assert len(reports) >= 3
    # Per-step: it clears on the very next step, unlike a latch.
    assert all(r == {} for r in reports[2:])
    # And it is a veto of its own — no window is opened by it.
    assert _delta_latches(deps)[1:] == [[]] * (len(reports) - 1)


@pytest.mark.asyncio
async def test_the_window_holds_across_an_early_exit_from_the_step_loop(
        monkeypatch):
    """The interesting case. Step 0 types into an unclassifiable cell and then
    takes a scroll, which breaks the batch early; the run goes on to step 1.
    A shutter spent by the early exit would photograph the value on the very
    first observation after the keystroke."""
    batches = [[
        _typed(_CELL, "Q3 revenue"),
        # The break the loop takes: a scroll stops the batch, and the second
        # type_text behind it never runs.
        ActionCall(action="scroll",
                   action_args={"direction": "up", "amount": 300}),
        _typed(_CELL, "more"),
    ], [], [], []]

    deps = await _run(monkeypatch, batches)

    latches = _delta_latches(deps)
    assert latches[0] == []                          # before the keystroke
    assert latches[1] == [_AMBIGUOUS_MARKER]         # survived the break
    assert latches[2] == [_AMBIGUOUS_MARKER]         # and is still open
    assert len(latches) >= 4
    assert all(l == [] for l in latches[3:])
