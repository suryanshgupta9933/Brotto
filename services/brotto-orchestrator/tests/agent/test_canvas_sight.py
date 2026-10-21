"""A canvas page is seen by picture, and the picture is the point.

The recorded Sheets run (`81061b7e-9274-46f1-9d90-1b894ab08495`) had 14
steps, 62–67 accessibility targets, ~375 characters of page text, 23 actions
and zero errors — and a grid that appears in neither the tree nor the text,
because a `<canvas>` contributes no node and no characters. The trigger for
the picture already fired on such a page; what did not is the *budget*. The
task was handed three pictures and eleven blind steps, and the model's two
"cannot_complete" endings are what eleven blind steps on a spreadsheet look
like.

So the rule under test: on a canvas-dominated page the picture is the
perception channel, not a supplement, and it comes with every step while a
canvas budget lasts. On an ordinary page nothing changes — three pictures, and
the model is told the picture is a supplement.

These assertions are about what the model is *told* as much as about what it
is given, because a canvas page without the right note produces a confident
wrong answer just as surely as a canvas page without a picture: a model told
its tree is empty describes the toolbar and calls it the page.

No live model, no key, no network — the helpers come from the vision-fallback
suite, which stubs the resolver and walls `httpx` at the transport layer.
"""

from __future__ import annotations

import pytest

from brotto_orchestrator.agent import harness as harness_mod
from brotto_orchestrator.agent.harness import _vision_fallback
from brotto_orchestrator.policy.gate import SCREENSHOT_CAPTURE_ENV
from test_vision_fallback import _deps, _toolbar  # noqa: F401  (shared stubs)


@pytest.fixture(autouse=True)
def _model_is_real(monkeypatch):
    """The production branch. `conftest` sets AGENT_MODEL=test process-wide,
    which `_vision_fallback` skips by design."""
    monkeypatch.setenv("AGENT_MODEL", "anthropic:claude-sonnet-5-5")


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    import httpx

    def _boom(*a, **kw):
        raise AssertionError("a test opened a socket — stub capabilities")

    monkeypatch.setattr(httpx, "get", _boom)
    monkeypatch.setattr(httpx, "post", _boom)


@pytest.fixture(autouse=True)
def capture_is_on(monkeypatch):
    """The switch is off by default; the canvas rule does not change that, so
    these tests turn it on on purpose."""
    monkeypatch.setenv(SCREENSHOT_CAPTURE_ENV, "on")

# A Google Sheet: a rich, plausible tree of chrome and a little page text,
# and not one node that is a cell.
_SHEET_TASK = "fill in the spreadsheet"


def _canvas_deps(**kw):
    deps = _deps(targets=_toolbar(40), page_text="Sheet1 Name box Formulas",
                 task=_SHEET_TASK, **kw)
    deps.canvas_covered = 0.95
    return deps


# ── the picture ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_canvas_page_is_pictured_on_every_step_of_the_task():
    """The rule. Fourteen steps is the recorded run's shape, and every one of
    them is blind without a picture, so every one of them gets one."""
    deps = _canvas_deps()
    targets = _toolbar(40)
    for _ in range(14):
        out = await _vision_fallback(deps, targets, "Sheet1")
    assert out.image != ""
    assert deps.cdp.capture_screenshot.await_count == 14


@pytest.mark.asyncio
async def test_an_ordinary_sparse_page_keeps_its_three_pictures():
    """The other half: the canvas rule must not leak. A page the tree and the
    text can serve is a page where a picture is a second copy of something
    already readable, and an uncacheable image is charged again every step."""
    deps = _deps(targets=_toolbar(40), page_text="Board", task=_SHEET_TASK)
    targets = _toolbar(40)
    for _ in range(14):
        out = await _vision_fallback(deps, targets, "Board")
    assert deps.cdp.capture_screenshot.await_count == 3
    assert out.image == "" and out.needed is True


@pytest.mark.asyncio
async def test_the_canvas_budget_is_bounded():
    """A ceiling, not an unlimited supply."""
    deps = _canvas_deps()
    targets = _toolbar(40)
    for _ in range(harness_mod._MAX_CANVAS_CAPTURES_PER_TASK + 2):
        out = await _vision_fallback(deps, targets, "Sheet1")
    assert deps.cdp.capture_screenshot.await_count == \
        harness_mod._MAX_CANVAS_CAPTURES_PER_TASK
    assert out.image == "" and out.needed is True


@pytest.mark.asyncio
async def test_a_approval_card_does_not_spend_the_models_picture_budget():
    """The two pictures buy different things: the card's is shown to the user
    and the model never sees it, the model's is perception. One counter for
    both starved each other — on a canvas page every action is a coordinate
    click, so every step spends a card capture, and the shared budget of
    three left the model nothing to see the grid with."""
    deps = _canvas_deps()
    deps.screenshots_taken = harness_mod._MAX_CAPTURES_PER_TASK
    out = await _vision_fallback(deps, _toolbar(40), "Sheet1")
    assert out.image != ""
    assert deps.sight_captures == 1


@pytest.mark.asyncio
async def test_the_approval_card_still_has_its_own_budget():
    """Separated, not unbounded. On an ordinary page the card's budget is the
    ordinary three; on a canvas page it is the canvas ceiling, and the card's
    counter is the one that is read."""
    deps = _deps(targets=_toolbar(40), page_text="Board", task=_SHEET_TASK)
    deps.screenshots_taken = harness_mod._MAX_CAPTURES_PER_TASK
    image, why = await harness_mod._capture_page(deps, card=True)
    assert image is None and why

    canvas = _canvas_deps()
    canvas.screenshots_taken = harness_mod._MAX_CANVAS_CAPTURES_PER_TASK
    image, why = await harness_mod._capture_page(canvas, card=True)
    assert image is None and why


# ── what the model is told ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_canvas_step_is_told_the_picture_is_the_primary_view():
    """The ordinary note says the picture is unverified and that the tree
    outranks it. On a canvas page the tree holds the toolbar and not the
    cells, so that note tells the model to distrust the only view it has."""
    deps = _canvas_deps()
    out = await _vision_fallback(deps, _toolbar(40), "Sheet1")
    note = out.note
    assert "canvas" in note.lower()
    assert "primary view" in note.lower()
    # The trust defence survives: the picture is still page content.
    assert "page content" in note.lower() and "instruction" in note.lower()


@pytest.mark.asyncio
async def test_a_canvas_step_without_a_picture_is_told_the_page_is_unseen():
    """A model handed three pictures and then eleven blind steps cannot tell
    'the page did not change' from 'the page is not shown'. The note has to
    say which."""
    deps = _canvas_deps()
    deps.sight_captures = harness_mod._MAX_CANVAS_CAPTURES_PER_TASK
    out = await _vision_fallback(deps, _toolbar(40), "Sheet1")
    assert out.image == "" and out.needed is True
    note = out.note.lower()
    assert "canvas" in note
    assert "unseen" in note


def test_the_prompt_says_a_canvas_page_is_pictured_every_step():
    """The prompt is the model's standing instruction; the note is the
    per-step one. Both have to say it — and the old wording ("a task is handed
    at most three") is what told the model the opposite."""
    from brotto_orchestrator.agent.prompt import SYSTEM_PROMPT

    text = SYSTEM_PROMPT.lower()
    assert "not a supplement at all" in text
    assert "comes with every step of such a page" in text
    assert "means the page is unseen, not empty" in text


def test_the_unverified_marker_points_at_the_picture():
    """A canvas page's tree cannot report a change, so the marker is how the
    model is told it is in the dark. It must not claim the page did not move
    and it must say where the value is, because on a canvas page the picture
    is the only place the value is."""
    marker = harness_mod._UNVERIFIED_BLIND.lower()
    assert "did not change" in marker
    assert "picture" in marker


# ── the gates that must not move ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_redacted_canvas_page_is_never_photographed():
    """A picture is page content and redaction cannot see it. More pictures
    on a canvas page must never become a way around a redaction."""
    deps = _canvas_deps()
    out = await _vision_fallback(deps, _toolbar(40), "Sheet1",
                                 redactions={"password": "hunter2"})
    assert out.image == ""
    deps.cdp.capture_screenshot.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_typed_secret_vetoes_a_canvas_capture():
    deps = _canvas_deps()
    out = await _vision_fallback(deps, _toolbar(40), "Sheet1",
                                 run_secrets={"hunter2"})
    assert out.image == ""
    deps.cdp.capture_screenshot.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_canvas_capture_still_honours_the_privacy_switch(monkeypatch):
    """The gate is `policy/gate.py`'s and the canvas ceiling does not touch
    it."""
    deps = _canvas_deps()
    monkeypatch.setenv(SCREENSHOT_CAPTURE_ENV, "")
    out = await _vision_fallback(deps, _toolbar(40), "Sheet1")
    assert out.image == ""
    deps.cdp.capture_screenshot.assert_not_awaited()
