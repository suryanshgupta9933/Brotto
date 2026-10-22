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


def test_the_two_boxes_are_told_apart_by_value_and_by_position():
    s = _canvas_section()
    assert "address box" in s.lower(), "the address box is not named"
    assert "content box" in s.lower(), "the content box is not named"
    # The tell that actually works on a canvas: the value, not the label —
    # both boxes are anonymous in the tree.
    assert "cell reference" in s, "the address box is told apart by its value"
    assert "far left" in s, "position is the second tell"
    assert "wide one" in s, "the content box is the wide one"


def test_content_must_never_be_typed_into_the_address_box():
    """The sentence the failed run got wrong, in as many words."""
    s = _canvas_section()
    assert "Never type content into the address box" in s
    # A word there creates a named range; a reference there is a jump.
    assert "named range" in s, "what a word typed there actually does is not said"
    assert "jump" in s, "a reference typed there is a jump, and is said to be"


def test_the_write_path_is_named_as_two_steps_and_a_read():
    s = _canvas_section()
    assert 'press_key("Enter")' in s, (
        "the commit key is named — and on one line, so the model reads it "
        "character for character")
    assert "read the content box's value again" in s, (
        "the verification is a read of the box, not a picture")


def test_a_page_with_no_content_box_is_a_cannot_complete():
    """The 'know it cannot do something' rule."""
    s = _canvas_section()
    assert "no accessibility mode, no formula bar" in s
    assert "cannot_complete" in s, (
        "a page that exposes no field for a cell's content is a "
        "cannot_complete, not a guess")


def test_the_chord_and_its_allowlist_survive():
    """The new rules are added beside the shortcut, not over it."""
    s = _canvas_section()
    assert "Meta=4" in s and "Alt=1" in s
    assert "modifiers=5" in s
    assert "only chord" in s.lower()
    assert "Read them before your next move and read them again after a" in s
