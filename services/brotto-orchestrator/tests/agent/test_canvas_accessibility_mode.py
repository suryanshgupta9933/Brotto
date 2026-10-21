"""A canvas app that exposes an accessibility mode gives back the grid.

Sheets renders the grid as a pure `<canvas>`: no `[role=gridcell]` in the DOM,
no `.ss-grid`, and so 60-odd AX targets describing the application's chrome and
none of its content. That is what made a recorded run type the column headers
into the FORMULA BAR — a textbox that is in the tree — and report success.

The fix is not another gate and not a new action. Sheets' own page text says
how to turn on screen-reader support ("press ⌘+Option+Z"), `press_key` already
speaks CDP's modifier bitmask, and the extension already captures `node.value`
so the name box's cell ADDRESS and the cell's CONTENT both reach the model as
`textbox value="..."`. Press the chord and the canvas stops being blind — for
the cell you are in.

So the prompt has to name the chord, name the bitmask, and correct its own
earlier claim that a keyboard step can only ever be confirmed by a picture.
Without that correction the prompt contradicts itself and the model follows the
paragraph that forbids verification.

No live model, no key, no network.
"""

from __future__ import annotations

from brotto_orchestrator.agent.prompt import SYSTEM_PROMPT


def _canvas_section() -> str:
    start = SYSTEM_PROMPT.index("## When a page looks empty")
    return SYSTEM_PROMPT[start:]


def test_the_shortcut_the_page_names_must_be_pressed():
    """The page already told us how to see itself; ignoring it is a wasted task."""
    s = _canvas_section()
    assert "screen reader" in s.lower(), "the accessibility mode is not named"
    assert "press_key" in s, "the chord is pressed with the action we already have"


def test_the_modifier_bitmask_is_spelled_as_numbers():
    """The model cannot send a chord it cannot spell — same reason Home is 2 and 4."""
    s = _canvas_section()
    assert "Meta=4" in s and "Alt=1" in s
    assert "modifiers=5" in s, "Meta+Alt is 4|1 and must be given as that number"


def test_the_tree_then_carries_the_cell_address_and_content():
    s = _canvas_section()
    assert "name box" in s.lower(), "the name box is where the address comes from"
    assert 'value="' in s, "the content arrives as an AX textbox value"


def test_the_keyboard_claim_is_corrected_not_left_contradictory():
    """The old text said a key press is UNVERIFIED by construction, forever.

    That is true of a page with no accessibility mode and false of one with it,
    and two paragraphs disagreeing is worse than either alone — so the ceiling is
    restated as the limit it really is.
    """
    s = _canvas_section()
    assert "keyboard step is UNVERIFIED by construction" not in s, (
        "the unconditional claim is now wrong for accessibility-mode pages"
    )
    assert "UNVERIFIED" in s, "the limit still holds where no accessibility mode exists"


def test_the_ceiling_is_scoped_to_one_cell():
    """Do not claim the whole sheet. The mode reports the selected cell."""
    s = _canvas_section().lower()
    assert "cell you are in" in s or "current cell" in s