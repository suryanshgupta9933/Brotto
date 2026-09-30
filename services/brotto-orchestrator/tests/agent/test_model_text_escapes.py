"""Model prose arrives with literal backslash-escapes instead of newlines.

Measured on a completed job-alerts run: the task_complete summary and an
append_scratchpad line both decoded to a backslash followed by 'n' rather than
a newline, and the panel rendered the summary as one unbroken wall of text.
The thoughts on those same turns were clean, so this is the model writing
JSON-shaped prose inside a JSON string argument it was already inside.
"""

from brotto_orchestrator.agent.harness import _unescape


def test_a_double_escaped_summary_comes_back_as_real_newlines():
    raw = "Here is your shortlist.\\n\\nFORD — 5 roles\\n- Engineer — /job/71235"
    assert _unescape(raw) == (
        "Here is your shortlist.\n\nFORD — 5 roles\n- Engineer — /job/71235"
    )


def test_tabs_and_carriage_returns_also_unescape():
    assert _unescape("a\\tb\\rc") == "a\tb\rc"


def test_a_backslash_before_anything_else_is_left_alone():
    """A Windows path or a regex is not an escape sequence, and mangling it
    would corrupt real content the model read off a page."""
    assert _unescape(r"C:\Users\brotto") == r"C:\Users\brotto"
    assert _unescape(r"match \d+ digits") == r"match \d+ digits"


def test_text_with_no_backslash_is_returned_unchanged():
    # ponytail: the early return is what keeps the common path allocation-free
    plain = "Here is your shortlist."
    assert _unescape(plain) is plain


def test_a_trailing_backslash_does_not_raise():
    assert _unescape("ends with a backslash \\") == "ends with a backslash \\"
