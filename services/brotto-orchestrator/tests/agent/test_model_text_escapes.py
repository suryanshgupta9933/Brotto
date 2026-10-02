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


# ── the other half: JSON that doesn't parse at all ─────────────────────
#
# `_unescape` handles the shape that survives — escapes that decode to a
# literal backslash. These handle the one that does not. A recorded run died
# at step 7 with `Invalid JSON: expected `,` or `]` at line 1 column 3301`
# while writing a `task_complete` summary, and 4 of 22 recorded sessions
# ended in `invalid_decision`. The prompt asks for a multi-line markdown
# summary, which is illegal inside a JSON string unless the newlines are
# escaped, and `action_args: dict` gives the output tool's JSON schema no way
# to say so. Hence a prompt contract, pinned here because a dropped
# instruction is an absence and reads clean in review.


def test_the_prompt_tells_the_model_the_summary_is_a_json_string():
    from brotto_orchestrator.agent.prompt import SYSTEM_PROMPT

    low = SYSTEM_PROMPT.lower()
    assert "summary is a json string" in low
    assert "cannot contain a raw newline" in low


def test_the_prompt_names_the_escape_and_not_just_the_problem():
    from brotto_orchestrator.agent.prompt import SYSTEM_PROMPT

    assert "\\n" in SYSTEM_PROMPT  # the fix, not just the prohibition


def test_a_quoted_number_is_accepted_as_a_number():
    from brotto_orchestrator.agent.harness import _as_int

    # what the model actually sent: max_chars: "3000" → TypeError in
    # `text[:max_chars // 2]` on the relay.
    assert _as_int("3000", 2000) == 3000
    assert _as_int(3000, 2000) == 3000


def test_an_unusable_number_falls_back_instead_of_raising():
    from brotto_orchestrator.agent.harness import _as_int

    assert _as_int(None, 2000) == 2000
    assert _as_int("", 2000) == 2000
    assert _as_int("lots", 2000) == 2000
    # bool is an int in Python, and max_chars=True would be a silent 1-char
    # read rather than the fallback the model meant.
    assert _as_int(True, 2000) == 2000


def test_recall_memory_accepts_the_id_spelling_the_manifest_shows():
    """The manifest header read `recall_memory(id) fetches full body` while
    the handler only read `entry_id`, so a model working from the manifest
    sent `{"id": "r2"}`, got `""`, and was told an entry it could see in the
    same breath did not exist."""
    import asyncio
    from types import SimpleNamespace

    from brotto_orchestrator.agent.context import ActionCall, MemoryEntry, Scratchpad
    from brotto_orchestrator.agent.harness import _execute_action

    sp = Scratchpad(entries=[
        MemoryEntry(id="r1", step=0, selector="page", around=None,
                    digest="d", body="the full body", was_truncated=False, url="u"),
    ])
    deps = SimpleNamespace(scratchpad=sp, user_id="u", cdp=None)
    got = asyncio.new_event_loop().run_until_complete(_execute_action(
        ActionCall(action="recall_memory", action_args={"id": "r1"}), deps))
    assert got == "the full body"


def test_a_genuine_miss_is_recorded_as_a_failure_not_a_success():
    """The audit derives `ok` from this marker. A soft-fail return that omits
    it is written as `ok: true` — a recall that read nothing recorded as a
    recall that worked."""
    import asyncio
    from types import SimpleNamespace

    from brotto_orchestrator.agent.context import ActionCall, MemoryEntry, Scratchpad
    from brotto_orchestrator.agent.harness import _EXEC_FAILURE, _execute_action

    sp = Scratchpad(entries=[
        MemoryEntry(id="r1", step=0, selector="page", around=None,
                    digest="d", body="b", was_truncated=False, url="u"),
    ])
    deps = SimpleNamespace(scratchpad=sp, user_id="u", cdp=None)
    got = asyncio.new_event_loop().run_until_complete(_execute_action(
        ActionCall(action="recall_memory", action_args={"entry_id": "r9"}), deps))
    assert _EXEC_FAILURE in got
    assert "r1" in got  # it still says what IS available
