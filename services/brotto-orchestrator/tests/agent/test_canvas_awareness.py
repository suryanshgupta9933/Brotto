"""A canvas-dominated page is blind even when its chrome looks relevant.

A real Google Sheets run — "open excel and create a simple sheet and create
two columns name and age" — completed the task at step 17 (four chars, Tab,
three chars, Enter) and then erased it. Three separate mistakes let that
happen, and each has an assertion here:

1. the screenshot never fired on the Sheet, because `Sheet1` and "Name box"
   matched the task and the accessibility test cannot see an *absence*;
2. stagnation never fired, because page-text length flickered every step and
   reset the counter, so a 23-step loop ran to the user's cancel;
3. an empty `read_page_text` on a canvas page read as "the work is not there",
   which is what sent the agent into the Backspace loop.

`canvasCovered` is the extension's answer to "how much of this page is a
`<canvas>`". A missing value is **unknown**, never "not a canvas", and the
last two tests here pin that: the ordinary readable page must still refuse
the picture.
"""

from __future__ import annotations

import asyncio

from brotto_orchestrator.agent.harness import (
    _CANVAS_COVERED_FLOOR, _execute_action, _is_canvas_page,
    _note_stagnation, _observe_canvas_covered, _sparse_for_task, _AX_NO_CHANGE,
    _STAGNANT_STEPS,
)
from brotto_orchestrator.agent.context import ActionCall, AgentDeps

TASK = "open excel and create a simple sheet and create two columns name and age"

# The chrome of the failing run, verbatim: "Sheet1" and a "Name box" both
# share a content word with the task, which is the whole failure.
SHEET_TEXT = (
    "File Edit View Insert Format Data Tools Extensions Help\n"
    "Untitled spreadsheet  Sheet1   Name box   fx   Σ\n"
    "Clipped view  Normal text  100%   Fill color  Text color  borders\n"
    "A1  1  2  3  4  5  6  7  8  9  10\n"
    "Conditional formatting  Data validation  Protected ranges  Alerts"
)
SHEET_TARGETS = [
    {"name": "Sheet1", "role": "tab"},
    {"name": "Name box", "role": "textbox"},
    {"name": "Add a column", "role": "button"},
    {"name": "File", "role": "menuitem"},
    {"name": "Zoom", "role": "button"},
]


def test_canvas_sheet_fires_even_though_its_chrome_matches_the_task():
    # The test the vocabulary made impossible: every "relevant" word is here.
    assert "sheet" in SHEET_TEXT.lower()
    assert any("name" in t["name"].lower() for t in SHEET_TARGETS)
    # Without the canvas signal this page is NOT sparse — that is what the
    # failing run saw, on every one of its 22 steps on the Sheet.
    assert not _sparse_for_task(TASK, SHEET_TARGETS, SHEET_TEXT, None)
    # With it, the picture is spent, unconditionally.
    assert _sparse_for_task(TASK, SHEET_TARGETS, SHEET_TEXT, 0.92)


def test_canvas_beats_the_page_text_length_check():
    # A canvas app's own chrome can clear _PAGE_TEXT_ENOUGH on its own. The
    # chart/document channel is still invisible, so the length check must not
    # get a veto it does not deserve.
    long_chrome = SHEET_TEXT * 20
    assert len(long_chrome.strip()) >= 400
    assert not _sparse_for_task(TASK, SHEET_TARGETS, long_chrome, None)
    assert _sparse_for_task(TASK, SHEET_TARGETS, long_chrome, 0.6)


def test_unknown_canvas_covered_keeps_the_readable_page_readable():
    # None, a missing relay and a junk value are all "not measured". None of
    # them may read as a canvas, and none may crash.
    for unknown in (None, "0.9", True, [], float("nan")):
        assert not _is_canvas_page(unknown)
    # And the ordinary page still refuses a picture it does not need.
    assert not _sparse_for_task(
        TASK, SHEET_TARGETS, SHEET_TEXT, 0.0)
    assert not _sparse_for_task(
        TASK, SHEET_TARGETS, SHEET_TEXT, _CANVAS_COVERED_FLOOR - 0.01)
    assert _is_canvas_page(_CANVAS_COVERED_FLOOR)


def _deps(canvas_covered=None) -> AgentDeps:
    return AgentDeps(
        user_id="u", task=TASK, cdp=object(), ws_send=None,
        canvas_covered=canvas_covered,
    )


def test_observe_canvas_covered_is_unknown_never_false():
    class NoMethod:
        pass

    class Junk:
        async def get_canvas_covered(self):
            return "0.8"

    class Broken:
        async def get_canvas_covered(self):
            raise RuntimeError("relay down")

    class Good:
        async def get_canvas_covered(self):
            return 1.4  # clamped, not trusted

    async def run(obj):
        deps = _deps()
        deps.cdp = obj
        return await _observe_canvas_covered(deps)

    assert asyncio.run(run(NoMethod())) is None
    assert asyncio.run(run(Junk())) is None
    assert asyncio.run(run(Broken())) is None
    assert asyncio.run(run(Good())) == 1.0


def test_stagnation_accumulates_on_a_canvas_page_whose_text_flickers():
    deps = _deps(canvas_covered=0.9)
    # The failing run's own numbers: the length changes every single step.
    lengths = [10031, 10044, 10046, 10079, 10083, 10136, 10030, 10037]
    fired_at = None
    for i, n in enumerate(lengths):
        # The delta is present every step and says nothing repainted — the
        # grid a 23-step run never moved. The flickering text must not save it.
        deps.canvas_changed = False
        if _note_stagnation(deps, "docs.google.com/spreadsheets", n,
                            _AX_NO_CHANGE):
            fired_at = i
            break
    # The first observation is the baseline the second is measured against,
    # so it is six identical readings in a row that trip the ceiling.
    assert fired_at == 5, "six blind steps in a row must stop the run"


def test_stagnation_still_fires_on_an_ordinary_page():
    # The counter is untouched for a page whose text is real evidence.
    deps = _deps()
    fired = [_note_stagnation(deps, "https://example.com", 900, _AX_NO_CHANGE)
             for _ in range(6)]
    assert fired == [False] * 5 + [True]


def test_canvas_delta_changed_true_is_progress():
    deps = _deps(canvas_covered=0.9)
    _note_stagnation(deps, "docs.google.com/spreadsheets", 10031, _AX_NO_CHANGE)
    deps.stagnant_steps = 4  # four blind steps, then pixels move
    deps.canvas_changed = True
    assert not _note_stagnation(deps, "docs.google.com/spreadsheets", 10044,
                                _AX_NO_CHANGE)
    assert deps.stagnant_steps == 0


def test_canvas_delta_changed_false_is_a_real_negative():
    deps = _deps(canvas_covered=0.9)
    deps.canvas_changed = False
    fired = [_note_stagnation(deps, "docs.google.com/spreadsheets", n,
                              _AX_NO_CHANGE) for n in range(8)]
    assert fired == [False] * 5 + [True, True, True]
    assert deps.stagnant_steps == 7  # the first step is the baseline


def test_an_unknown_canvas_delta_never_stops_a_run():
    """The regression this whole change exists to avoid, twice over."""
    deps = _deps(canvas_covered=0.9)
    # Every delta is None — the capture gate off, or a first observation. A
    # merely unobserved run must not be stopped, and must not be advanced
    # either: the counter is where it was.
    fired = []
    for i, n in enumerate([10031, 10044, 10046, 10079, 10083, 10136] * 4):
        deps.canvas_changed = None
        deps.stagnant_steps = 3  # an older counter to prove it is left alone
        fired.append(_note_stagnation(deps, "docs.google.com/spreadsheets", n,
                                      _AX_NO_CHANGE))
        assert deps.stagnant_steps == 3, i
    assert not any(fired)
    # And from a clean counter it never even climbs.
    deps = _deps(canvas_covered=0.9)
    deps.canvas_changed = None
    for _ in range(_STAGNANT_STEPS * 3):
        assert not _note_stagnation(deps, "docs.google.com/spreadsheets", 10031,
                                    _AX_NO_CHANGE)
    assert deps.stagnant_steps == 0


def test_an_unknown_delta_still_honours_the_url_and_the_ax_diff():
    deps = _deps(canvas_covered=0.9)
    deps.canvas_changed = None
    _note_stagnation(deps, "docs.google.com/spreadsheets", 10031, _AX_NO_CHANGE)
    # The other two terms are untouched by the unknown delta.
    assert not _note_stagnation(deps, "docs.google.com/document/d/1", 10031,
                                _AX_NO_CHANGE)
    assert not _note_stagnation(deps, "docs.google.com/document/d/1", 10031,
                                "[+ button] ~ button, 2 refs new")


def test_the_delta_changes_nothing_on_an_ordinary_page():
    for changed in (True, False, None):
        deps = _deps()
        deps.canvas_changed = changed
        # Text is real evidence here: identical lengths, no delta read at all.
        fired = [_note_stagnation(deps, "https://example.com", 900, _AX_NO_CHANGE)
                 for _ in range(6)]
        assert fired == [False] * 5 + [True], changed


def test_empty_read_on_a_canvas_page_does_not_claim_the_page_is_empty():
    class FakeScratch:
        def next_id(self):
            return "e1"

        def with_entry(self, entry):
            return entry

    deps = _deps(canvas_covered=0.95)
    deps.scratchpad = FakeScratch()

    class Cdp:
        async def read_page_text(self, selector, max_chars=None, around=None):
            return ""

    deps.cdp = Cdp()
    out = asyncio.run(_execute_action(
        ActionCall(action="read_page_text", action_args={}), deps))
    lowered = out.lower()
    assert "cannot" in lowered or "unable" in lowered, out
    assert "not a page with nothing on it" in lowered, out
    # The claim it must not make: that the page has no content.
    for claim in ("page is empty", "no content on", "nothing on the page",
                  "is empty", "0 chars means"):
        assert claim not in lowered, out


def test_empty_read_on_an_ordinary_page_stays_ordinary():
    class FakeScratch:
        def next_id(self):
            return "e1"

        def with_entry(self, entry):
            return entry

    deps = _deps()
    deps.scratchpad = FakeScratch()

    class Cdp:
        async def read_page_text(self, selector, max_chars=None, around=None):
            return ""

    deps.cdp = Cdp()
    out = asyncio.run(_execute_action(
        ActionCall(action="read_page_text", action_args={}), deps))
    assert "canvas" not in out.lower(), out