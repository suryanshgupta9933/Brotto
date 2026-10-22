"""A canvas app is driven by keyboard, because a coordinate is a guess.

The same Sheets run that `test_canvas_awareness.py` records spent its steps
clicking the Name Box five times: a grid has no element to name, so a click
into it is a guess at which cell that pixel is, and a wrong guess is
indistinguishable from a right one until the task is already wrong.

Every spreadsheet and canvas app has a keyboard-native path and Brotto
already ships the primitive — `press_key`, with CDP's modifier bitmask —
but nothing ever told the model it had one. So the prompt is the only place
this can be fixed.

The assertions are about what the model is *told*, and about what it is not
told to do:

  - the movement keys, with the modifier bitmask spelled as numbers, because
    the model cannot send a chord it cannot spell;
  - Home sent as one key two ways rather than as an OS branch, since a
    `sys.platform`-style choice is banned in the tree and is no less a
    platform branch to ask the model to make;
  - the honest limits: a key press is UNVERIFIED by construction and reports
    nothing about the page, so the picture is still what confirms a move.

No live model, no key, no network.
"""

from __future__ import annotations

from brotto_orchestrator.agent.prompt import SYSTEM_PROMPT


def _canvas_section() -> str:
    start = SYSTEM_PROMPT.index("## When a page looks empty")
    return SYSTEM_PROMPT[start:]


def test_canvas_moves_by_key_not_by_pixel():
    s = _canvas_section()
    assert "with the keyboard rather than with coordinates" in s, (
        "a canvas page must tell the model the keyboard beats a coordinate"
    )
    # The pixel sentence it corrects is still in the tree and still claims
    # coordinates are the way onto a canvas.
    assert "click_xy / focus_xy / type_xy" in s


def test_movement_keys_are_named_with_their_codes():
    s = _canvas_section()
    for key in ("ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight",
                "Enter", "Escape", "Tab", "Home"):
        assert key in s, f"{key} is not named in the canvas guidance"


def test_home_is_one_key_sent_two_ways_not_an_os_branch():
    """Which modifier means Home is the app's and the keyboard's business.

    A prompt that says "Cmd on a Mac, Ctrl elsewhere" is the platform branch
    the project forbids, moved from code into the model. Two spellings of one
    key, tried in order, is not a branch.
    """
    s = _canvas_section()
    assert "Home with Ctrl" in s and "Home with Meta" in s
    assert "modifiers=2" in s and "modifiers=4" in s
    for banned in ("on a Mac", "on macOS", "Windows", "on Linux", "platform:"):
        assert banned not in s, f"{banned!r} is a platform branch in the prompt"


def test_the_name_box_is_the_jump_without_a_guess():
    s = _canvas_section()
    assert "name box" in s.lower()


def test_what_a_keystroke_cannot_tell_the_model():
    """Honesty about the ceiling, or the guidance makes things worse."""
    s = _canvas_section()
    assert "UNVERIFIED" in s, "a key press confirms nothing; say so"
    assert "picture" in s, "the picture is still what confirms a move"