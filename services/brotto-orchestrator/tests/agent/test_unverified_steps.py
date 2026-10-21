"""A step whose effect nothing could see must not read as a step that worked.

The Sheets run re-clicked one cell seven times across steps 3–9. Each step's
record claimed the click landed, so re-trying looked identical to progressing.
The record is the only history the harness has — it is stateless per step — so
"nothing confirmed this" has to be written into the record, at the point the
next observation proves it.

What counts as "nothing could see it" is the whole question. A page that
exposes its content to the accessibility tree HAS a channel, and its silence
is a reading the model can already see in the diff block. A canvas app does
not: the tree holds the chrome, and the content is painted. That is the only
case where the record has to say "cannot tell" — and it says it once per
page, because the fact is a property of the page.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from brotto_orchestrator.agent.context import (
    ActionCall, AgentDecision, AgentDeps, StepSummary,
)
from brotto_orchestrator.agent.harness import (
    _AX_NO_CHANGE, _history_line, _is_mutating, _mark_unverified, AgentHarness,
)
import brotto_orchestrator.agent.harness as harness_mod
from brotto_orchestrator.agent.prompt import SYSTEM_PROMPT
from brotto_orchestrator.dev.ax_tree_extractor import SemanticTarget


class _PlanResult:
    usage = None


def _summary(**kw) -> StepSummary:
    base = dict(step=3, url="http://x/", action_taken="click [r:A]",
                outcome="Clicked [r:A]", mutated=True)
    base.update(kw)
    return StepSummary(**base)


# --- the rule ------------------------------------------------------------


def test_a_blind_canvas_step_is_marked():
    """The incident. A canvas page: the tree is static and the pixels were
    withheld, so the click's effect is genuinely unknown."""
    s = _summary()
    _mark_unverified([s], ax_diff=_AX_NO_CHANGE, canvas=True, pixels=None)
    assert "UNVERIFIED" in s.unverified


def test_a_tree_that_moved_is_not_marked():
    s = _summary()
    _mark_unverified([s], ax_diff="- name: 'Save' → 'Save all'",
                     canvas=True, pixels=None)
    assert s.unverified == ""


def test_a_measured_pixel_delta_is_not_marked():
    """`False` is a reading, not an absence: the page was compared and did
    not move. That is the model seeing a negative, not a blind step."""
    s = _summary()
    _mark_unverified([s], ax_diff=_AX_NO_CHANGE, canvas=True, pixels=False)
    assert s.unverified == ""


def test_a_measured_pixel_change_is_not_marked():
    s = _summary()
    _mark_unverified([s], ax_diff=_AX_NO_CHANGE, canvas=True, pixels=True)
    assert s.unverified == ""


def test_an_ordinary_page_is_not_marked():
    """A page that exposes its content to the tree HAS a channel, and the
    tree's silence is a reading the model already has in the diff block.
    Marking it would put a line on every step of an ordinary run — and the
    diff is coarse (a checkbox toggle changes no name and no value), so it
    would be wrong as often as it was right."""
    s = _summary()
    _mark_unverified([s], ax_diff=_AX_NO_CHANGE, canvas=False, pixels=None)
    assert s.unverified == ""


def test_a_read_only_step_is_never_marked():
    """Five steps of reading must not each cost an unverified line."""
    s = _summary(action_taken="read_page_text", outcome="…", mutated=False)
    _mark_unverified([s], ax_diff=_AX_NO_CHANGE, canvas=True, pixels=None)
    assert s.unverified == ""


def test_a_scroll_is_not_a_mutation():
    """`compute_ax_diff` documents that a scroll changes no name and no
    value, so a scroll is silent on a page that scrolled perfectly well."""
    assert _is_mutating("scroll") is False
    assert _is_mutating("click") is True
    assert _is_mutating("read_page_text") is False
    assert _is_mutating("task_complete") is False


def test_the_page_says_it_once():
    """The fact is a property of the page, not of each step. A second line
    on every step of a blind run is noise the model learns to skip."""
    first = _summary(step=1)
    second = _summary(step=2)
    _mark_unverified([first], ax_diff=_AX_NO_CHANGE, canvas=True, pixels=None)
    _mark_unverified([first, second], ax_diff=_AX_NO_CHANGE, canvas=True,
                     pixels=None)
    assert first.unverified
    assert second.unverified == ""


def test_a_new_page_says_it_again():
    """A different URL is a different page, and the blindness is its own."""
    first = _summary(step=1, url="http://x/")
    second = _summary(step=2, url="http://y/")
    _mark_unverified([first], ax_diff=_AX_NO_CHANGE, canvas=True, pixels=None)
    _mark_unverified([first, second], ax_diff=_AX_NO_CHANGE, canvas=True,
                     pixels=None)
    assert second.unverified


def test_an_empty_history_is_a_no_op():
    _mark_unverified([], ax_diff=_AX_NO_CHANGE, canvas=True, pixels=None)


# --- the record and the vocabulary ---------------------------------------


def test_the_marker_reaches_the_history_line():
    s = _summary()
    _mark_unverified([s], ax_diff=_AX_NO_CHANGE, canvas=True, pixels=None)
    assert "UNVERIFIED" in _history_line(s)


def test_the_prompt_teaches_the_model_what_the_marker_means():
    """A marker the model has no action for is a marker it clicks anyway."""
    assert "UNVERIFIED" in SYSTEM_PROMPT
    assert "A step that could not be verified" in SYSTEM_PROMPT


# --- the wiring ----------------------------------------------------------


def _deps(*, canvas_covered: float, delta) -> AgentDeps:
    cdp = AsyncMock()
    cdp.ping = AsyncMock(return_value=True)
    # The same target every step: the tree genuinely never moves.
    cdp.get_targets = AsyncMock(
        return_value=[SemanticTarget(ref_id="r:A", tag="button", role="button",
                                     name="Name box")])
    cdp.get_current_url = AsyncMock(return_value="https://docs.google.com/x")
    cdp.get_page_text = AsyncMock(return_value="Sheet1  Name box  ")
    cdp.get_page_delta = AsyncMock(return_value=delta)
    cdp.get_canvas_covered = AsyncMock(return_value=canvas_covered)
    cdp.get_page_title = AsyncMock(return_value="Sheet1")
    cdp.refresh_target_map = AsyncMock()
    cdp.click_ref = AsyncMock(return_value="Clicked [r:A]")

    async def ws_send(_msg: dict) -> None:
        return None

    return AgentDeps(user_id="t", task="go", cdp=cdp, ws_send=ws_send)


async def _run_capture_summaries(monkeypatch, deps) -> list[StepSummary]:
    async def _fake_plan(deps_, turn, agent, audit=None):
        return (AgentDecision(
            reasoning="trying", thought="trying",
            actions=[ActionCall(action="click", action_args={"ref": "r:A"})]),
            400_000, _PlanResult())

    monkeypatch.setattr(harness_mod, "_plan_step", _fake_plan)
    # Four steps is enough to exercise the chain and costs four seconds; the
    # backstop is 150 and a blind run never stops on its own.
    monkeypatch.setattr(AgentHarness, "MAX_STEPS", 4)
    await AgentHarness().run(deps)
    return deps.step_summaries


@pytest.mark.asyncio
async def test_a_blind_run_records_the_first_blind_step_only(monkeypatch):
    """Wiring, not just the helper: the marker has to reach the record the
    next step's prompt is built from."""
    summaries = await _run_capture_summaries(
        monkeypatch, _deps(canvas_covered=0.9, delta=None))
    assert len(summaries) == 4, "the run recorded every step it planned"
    assert all(s.mutated for s in summaries)
    # The FIRST step is judged at the second step's observe — the first
    # moment the evidence exists — and the page says it once.
    assert summaries[0].unverified
    assert not any(s.unverified for s in summaries[1:])


@pytest.mark.asyncio
async def test_a_readable_page_records_no_unverified_steps(monkeypatch):
    summaries = await _run_capture_summaries(
        monkeypatch, _deps(canvas_covered=0.0, delta={"changed": False}))
    assert summaries and not any(s.unverified for s in summaries)


@pytest.mark.asyncio
async def test_a_canvas_page_with_a_measured_delta_records_no_unverified_steps(
        monkeypatch):
    """The page repainted and said so. That is a reading, not a blind step."""
    summaries = await _run_capture_summaries(
        monkeypatch, _deps(canvas_covered=0.9, delta={"changed": True}))
    assert summaries and not any(s.unverified for s in summaries)
