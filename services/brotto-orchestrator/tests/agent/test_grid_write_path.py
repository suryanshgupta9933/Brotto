"""A grid app's two boxes, and which one takes a cell's content.

A measured Google Sheets run typed a name and an age into the NAME BOX six
times and reported itself done. The tree there carries two anonymous
textboxes side by side that look the same: one holds the current cell's
address (`A32`), the other holds the cell's content. A word typed into the
address box is not a cell write — Sheets takes it as a named range — so the
typing succeeded, the cell stayed empty, and the run finished with nothing
written and no error anywhere.

So the prompt has to say which box is which, and has to say what a word typed
in the address box does. The rule is stated for grid apps in general, with
Sheets as the example: the tell is the box's VALUE, and position is the
second tell.

No live model, no key, no network.
"""

from __future__ import annotations

from brotto_orchestrator.agent.prompt import SYSTEM_PROMPT


def _canvas_section() -> str:
    start = SYSTEM_PROMPT.index("## When a page looks empty")
    return SYSTEM_PROMPT[start:]


def _flat(section: str) -> str:
    """Line-wrapped prose: a phrase that spans a wrap is one phrase to the
    model, so the assertions must not depend on where the wrap fell."""
    return " ".join(section.split())


def test_the_two_boxes_are_told_apart_by_value_and_by_position():
    s = _flat(_canvas_section())
    assert "address box" in s.lower(), "the address box is not named"
    assert "content box" in s.lower(), "the content box is not named"
    # The tell that actually works on a canvas: the value, not the label —
    # both boxes are anonymous in the tree.
    assert "cell reference" in s, "the address box is told apart by its value"
    assert "far left" in s, "position is the second tell"
    assert "wide one" in s, "the content box is the wide one"


def test_content_must_never_be_typed_into_the_address_box():
    """The sentence the failed run got wrong, in as many words."""
    s = _flat(_canvas_section())
    assert "Never type content into the address box" in s
    # A word there creates a named range; a reference there is a jump.
    assert "named range" in s, "what a word typed there actually does is not said"
    assert "jump" in s, "a reference typed there is a jump, and is said to be"


def test_the_write_path_is_named_as_two_steps_and_a_read():
    s = _flat(_canvas_section())
    assert 'press_key("Enter")' in s, (
        "the commit key is named — and on one line, so the model reads it "
        "character for character")
    assert "read the content box's value then" in s, (
        "the verification is a read of the cell, not a picture")


def test_the_content_box_is_the_editing_surface_not_a_read_only_view():
    """A measured Sheets run typed two headers into the formula bar, pressed
    Enter after each, and reported itself done. Nothing was written: the
    second value replaced the first in the box and neither reached the cell.
    The model cannot see that — so the prompt has to say what the box is.

    The naming must not contradict the recipe. An earlier draft called the
    content box a MIRROR and then taught type_text into it, which is the
    ambiguity that let the run report an unwritten cell as written."""
    s = _flat(_canvas_section())
    assert "content box is the grid's EDITING SURFACE" in s, (
        "the content box is where the edit is made, and the model is told so")
    assert "not a read-only view of the cell" in s, (
        "it is not a picture of the cell, so the recipe does not contradict "
        "the naming")
    assert "follows the selection" in s, (
        "the box moves with the selection, which is why the immediate "
        "re-read proves nothing")
    assert "WHICH cell the content box is showing" in s, (
        "the address box and the content box are a pair")
    # The one thing the prompt must NOT say: that the box it types into is
    # not the thing it types into.
    assert "MIRROR of the selected cell" not in s, (
        "a mirror is not an editing surface, and the two read as a "
        "contradiction")


def test_the_offscreen_textbox_is_the_same_edit_seen_from_inside():
    s = _flat(_canvas_section())
    assert "a textbox the tree marks off-screen is the grid's own" in s
    assert "SAME edit seen from inside the grid" in s, (
        "it is the edit viewed from the grid's side, not a second target")
    assert "not a second place to type" in s, (
        "it has no point on screen, so it is not a place to type")


def test_a_write_that_did_not_land_is_not_reported_as_done():
    """The half of the measured failure that cost the run: it claimed a
    write nobody could see."""
    s = _flat(_canvas_section())
    assert "the write did not land" in s
    assert "do not report the cell as written" in s
    # And the retry the model must not make: a second write through the same
    # path replaces the first edit, which is how one run wrote neither.
    assert "replaces it rather than adding to" in s
    # The escape is the closed vocabulary, not a guess.
    assert "cannot_complete" in s
    assert "which cell you tried to write" in s


def test_the_fallback_names_no_focusable_target_rather_than_a_third_try():
    """The off-screen editor is not a fallback you can type into.

    It has no viewport point, so `type_at` refuses it
    (point-out-of-viewport) and it has no ref the model can name; the only
    route to it is a focusable target. A fallback that mechanically fails
    and then blames the write is worse than no fallback."""
    s = _flat(_canvas_section())
    assert "there is no third target" in s, (
        "the off-screen editor is not offered as a third write target")
    assert "cannot be pressed or typed into" in s, (
        "it has no point on screen, so it is neither pressed nor typed into")
    assert "no per-cell node to name" in s, (
        "with the mode on there is no per-cell node, only a coordinate")
    assert "type_xy at that coordinate" in s, (
        "the one further attempt, and it is a coordinate one")
    assert "no focusable target for the cell at all" in s, (
        "with no focusable target there is no further attempt")
    assert "ordinary insertion that can fail the same way" in s, (
        "the coordinate write is not a guarantee")


def test_the_write_that_did_not_land_is_scoped_to_a_page_that_has_a_content_box():
    """Distinct from the older rule: no content box at all is a different
    situation, and the new paragraph must not swallow it."""
    s = _flat(_canvas_section())
    assert "the tree HAS a content box and your value is not in it" in s, (
        "the new paragraph means a content box existed and the value is not "
        "in it")
    assert "the tree carries NO content box at all" in s, (
        "the older rule is scoped to a page with no content box")
    assert "different situation from a write that went to a content box" in s, (
        "the two rules are told apart explicitly")


def test_a_page_with_no_content_box_is_a_cannot_complete():
    """The 'know it cannot do something' rule."""
    s = _flat(_canvas_section())
    assert "no accessibility mode, no formula bar" in s
    assert "cannot_complete" in s, (
        "a page that exposes no field for a cell's content is a "
        "cannot_complete, not a guess")


def test_the_chord_and_its_allowlist_survive():
    """The new rules are added beside the shortcut, not over it."""
    s = _flat(_canvas_section())
    assert "Meta=4" in s and "Alt=1" in s
    assert "modifiers=5" in s
    assert "only chord" in s.lower()
    assert "the address box says WHICH cell the content" in s
