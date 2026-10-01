"""The page you are looking at has to survive you looking away from it.

`Scratchpad.entries` is the retrieval half of memory — a digest in the
prompt, the body fetched on demand by `recall_memory(id)`. It is the right
shape, and on three consecutive Gmail runs it captured **nothing**: entries=0
every time. `page_text` already ships in the prompt, so the model never
called `read_page_text`, so nothing was ever auto-captured, so the only
memory that existed was `notes` — and with nothing to retrieve, the model
transcribed the inbox into a note instead. 5,093 chars on the terminal step,
which is ~1,300 output tokens, and output tokens are what latency is made of
(25,087 in / 191 out = 4.3s; 25,085 in / 3,612 out = 41.3s, same prompt).

These tests pin that the current page is captured in code, every step,
without the model asking — and that navigating away does not lose it.
"""

from brotto_orchestrator.agent.context import (
    DIGEST_LEN, MemoryEntry, Scratchpad, StepSummary,
)


# ── the page is captured without the model asking ────────────────────────


def test_the_page_under_the_model_is_captured():
    sp = Scratchpad().capture_page(url="https://mail.google.com/mail/u/0/#inbox",
                                   step=0, text="Inbox (661)")
    assert len(sp.entries) == 1
    assert sp.entries[0].body == "Inbox (661)"


def test_an_empty_page_is_not_captured():
    """A run that never loads anything would otherwise fill the manifest
    with empty entries, and the manifest ships in the prompt every step."""
    assert Scratchpad().capture_page(url="about:blank", step=0, text="").entries == []


def test_whitespace_is_not_a_page():
    assert Scratchpad().capture_page(url="x", step=0, text="   \n  ").entries == []


def test_the_entry_carries_the_url_it_came_from():
    """The whole recall use case is 'go back to *that* page'. Three pages
    captured in a run are indistinguishable without it."""
    sp = Scratchpad().capture_page(url="https://a.test/x", step=0, text="alpha")
    assert sp.entries[0].url == "https://a.test/x"


def test_the_digest_is_a_digest_and_the_body_is_the_whole_page():
    """The manifest ships every step; the body ships only on recall. If the
    digest were the body, the whole point of the split is gone."""
    sp = Scratchpad().capture_page(url="u", step=0, text="y" * 5_000)
    e = sp.entries[0]
    assert len(e.digest) == DIGEST_LEN + 1  # + the ellipsis
    assert len(e.body) == 5_000


def test_the_page_capture_does_not_touch_the_notes():
    """They are different things: notes are the model's own synthesis. The
    capture must not overwrite them."""
    sp = Scratchpad(notes="Search bar needs Enter").capture_page(
        url="u", step=0, text="page")
    assert sp.notes == "Search bar needs Enter"


# ── it survives navigating away ───────────────────────────────────────────


def test_a_page_captured_two_steps_ago_is_still_there_after_navigating():
    """The requirement this was built for. Before this, `page_text` was
    live-only: navigate and it is gone, the AX tree is ref-scoped and gone
    too, and the agent's only option was to have written it down."""
    sp = Scratchpad()
    sp = sp.capture_page(url="https://a.test/inbox", step=0, text="the inbox listing")
    sp = sp.capture_page(url="https://a.test/thread/9", step=1, text="the opened thread")
    sp = sp.capture_page(url="https://a.test/compose", step=2, text="the reply form")

    assert [e.body for e in sp.entries] == [
        "the inbox listing", "the opened thread", "the reply form",
    ]
    assert sp.lookup("r1").body == "the inbox listing"


def test_ids_stay_unique_when_reads_and_page_captures_interleave():
    """Both create entries. If they each number from len(entries) at
    different moments, one silently overwrites the other."""
    sp = Scratchpad()
    sp = sp.capture_page(url="a", step=0, text="page 1")
    sp = sp.with_entry(MemoryEntry(
        id=sp.next_id(), step=1, selector="body", around=None,
        digest="d", body="an explicit read", was_truncated=False))
    sp = sp.capture_page(url="b", step=2, text="page 2")

    ids = [e.id for e in sp.entries]
    assert len(set(ids)) == len(ids) == 3
    assert sp.lookup("r2").body == "an explicit read"


# ── the notes are bounded ────────────────────────────────────────────────


def test_a_runaway_note_stops_growing():
    """`append_note` concatenated without limit and the prompt block echoed
    the result in full, so one transcription became a permanent ~1,300-token
    tax on every later step for the life of the session."""
    sp = Scratchpad()
    for _ in range(20):
        sp = sp.append_note("z" * 2_000)
    assert len(sp.notes) <= Scratchpad.NOTES_CAP + 200


def test_the_cap_keeps_the_oldest_and_the_newest():
    """Same head+tail shape as `_conversation_block`: a synthesized note
    states its method first and its findings last, so either end alone
    loses the half the next step asks about."""
    sp = Scratchpad(notes="FIRST-MARKER\n" + "a" * 9_000 + "\nLAST-MARKER")
    assert "FIRST-MARKER" in sp.notes
    assert "LAST-MARKER" in sp.notes


def test_a_note_under_the_cap_is_untouched():
    sp = Scratchpad().append_note("a short finding")
    assert sp.notes == "a short finding"


def test_rewrite_may_exceed_the_cap_but_only_once():
    """`write_scratchpad` replaces rather than accumulates. Capping the
    replacement too would silently discard what the model just decided to
    keep — the cap exists to stop unbounded *growth*, not to editorialize."""
    big = "q" * (Scratchpad.NOTES_CAP * 2)
    assert Scratchpad().write_notes(big).notes == big


# ── the model is told, so it stops transcribing ──────────────────────────


def _prompt(**kw):
    from brotto_orchestrator.agent.context import AgentTurn
    from brotto_orchestrator.agent.harness import _turn_to_prompt
    turn = dict(
        task="t", step_number=1, scratchpad_notes="", scratchpad_entries=[],
        current_url="https://a.test", current_page_title="X", ax_tree="",
        ax_diff="", step_summaries=[StepSummary(step=0, url="u", action_taken="click",
                                                outcome="ok")],
    )
    turn.update(kw)
    return _turn_to_prompt(AgentTurn(**turn))


def test_the_manifest_names_the_url_of_each_captured_page():
    sp = Scratchpad().capture_page(url="https://a.test/thread/9", step=0, text="body")
    p = _prompt(scratchpad_entries=list(sp.entries))
    assert "https://a.test/thread/9" in p
    assert "r1" in p


def test_the_system_prompt_says_the_current_page_is_already_captured():
    """Without this the model cannot know capture happened, so it keeps
    writing the page down — and the write is the expensive part."""
    from brotto_orchestrator.agent.prompt import SYSTEM_PROMPT
    low = SYSTEM_PROMPT.lower()
    assert "page you are looking at" in low
    assert "never write a page's contents into a note" in low


# ── a recalled page must not look complete when it isn't ────────────────


def _recall(sp, entry_id="r1"):
    import asyncio
    from types import SimpleNamespace

    from brotto_orchestrator.agent.context import ActionCall
    from brotto_orchestrator.agent.harness import _execute_action

    deps = SimpleNamespace(scratchpad=sp, user_id="u", cdp=None)
    loop = asyncio.new_event_loop()
    return loop.run_until_complete(_execute_action(
        ActionCall(action="recall_memory", action_args={"entry_id": entry_id}), deps))


def test_recall_returns_the_whole_page_while_the_run_lives():
    body = "subject line\n\nthe body of the message\n" * 200
    sp = Scratchpad().capture_page(url="u", step=0, text=body)
    out = _recall(sp)
    assert body.strip() in out
    assert "digest" not in out.lower()


def test_recall_of_a_resumed_entry_says_it_is_only_the_digest():
    """The sidecar stores digests, not bodies — that is pre-existing and
    unchanged. What must not happen is a resume handing the model 200 chars
    of an 11,000-char page with no marker, which it will happily read as
    the whole page."""
    import asyncio
    from types import SimpleNamespace

    from brotto_orchestrator.agent.context import ActionCall, MemoryEntry
    from brotto_orchestrator.agent.harness import _execute_action

    # What save_scratchpad actually wrote: the digest, ellipsis included.
    digest = ("subject line\n\nthe body of " * 20)[:DIGEST_LEN] + "…"
    sp = Scratchpad(entries=[MemoryEntry(
        id="r1", step=0, selector="page", around=None, digest=digest,
        body=digest, was_truncated=False, url="https://a.test/inbox")])

    out = _recall(sp)
    assert digest in out
    assert "only the digest" in out.lower()
    assert "https://a.test/inbox" in out, "the model needs to know which page to go back to"


def test_a_page_shorter_than_the_digest_is_not_called_degraded():
    """digest == body is also just what a small page looks like in a live
    run. Labelling that as a resume casualty would send the model
    navigating back for no reason."""
    sp = Scratchpad().capture_page(url="https://a.test/ok", step=0, text="OK")
    out = _recall(sp)
    assert out == "OK"


def test_a_long_page_that_was_never_truncated_still_reads_as_complete():
    """The ellipsis is what distinguishes a cut digest from a whole page,
    so a long live page must not pick up the marker either."""
    body = "z" * 900
    sp = Scratchpad().capture_page(url="u", step=0, text=body)
    out = _recall(sp)
    assert out == body
    assert "digest" not in out.lower()
