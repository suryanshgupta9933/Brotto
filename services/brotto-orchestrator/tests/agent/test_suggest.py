"""The model's output is trimmed to what the panel can render.

This is the one thing a language model is reliably bad at: returning exactly
the shape asked for. It leads with a preamble, returns four suggestions
instead of three, and runs long when it has something to say. The panel is
narrow and has no defence of its own, so `generate` trims.

`_normalise` is the whole contract, so it is tested directly. No model, no
key, no network.
"""

from __future__ import annotations

from brotto_orchestrator.agent.suggest import (
    MAX_CHARS,
    MAX_LINES,
    _normalise,
    _parse,
)


def test_numbered_and_bulleted_lines_lose_their_marker():
    """The prompt forbids markers, but a panel rendering "1. Summarise the
    open pull requests" looks broken, and stripping it costs nothing."""
    assert _parse("1. Read the changelog\n- Check the open issues\n* Compare the two") == [
        "Read the changelog",
        "Check the open issues",
        "Compare the two",
    ]


def test_blank_lines_do_not_become_suggestions():
    assert _parse("Read the changelog\n\n\n  \nCheck the open issues") == [
        "Read the changelog",
        "Check the open issues",
    ]


def test_whitespace_is_collapsed():
    assert _normalise(["  Summarise   the\tthread\n"]) == ["Summarise the thread"]


def test_blank_lines_are_dropped():
    assert _normalise(["", "   ", "Read the changelog."]) == ["Read the changelog."]


def test_capped_at_three():
    lines = _normalise(["one", "two", "three", "four", "five"])
    assert lines == ["one", "two", "three"]
    assert len(lines) == MAX_LINES


def test_a_long_line_is_cut_on_a_word_boundary():
    # The failure this guards: "…and flag anything" → "…and flag anythi",
    # which is not shorter, it is wrong.
    out = _normalise(["word " * 60])
    assert len(out[0]) <= MAX_CHARS
    assert not out[0].endswith(("anythi", "an", "a"))


def test_trailing_punctuation_goes_with_the_cut():
    out = _normalise(["Compare the pricing tiers carefully, " + "and " * 40])
    assert not out[0].endswith((" ", ",", ";", ":"))


def test_everything_blank_yields_nothing_rather_than_a_placeholder():
    # The panel keeps its own fallback on an empty result, so returning
    # something here would overwrite the one path that always works.
    assert _normalise(["", "  ", "\n"]) == []
