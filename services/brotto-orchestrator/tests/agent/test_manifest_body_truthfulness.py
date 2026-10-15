"""The manifest must not promise a full body it does not hold.

Nothing writes page text to disk — `audit.py` still names `*.pages.json` so a
file left by an older build gets deleted, but no current build writes it — so
a run that is interrupted and resumed loads entries carrying a digest only.
`recall_memory` has always said so at recall time; the manifest header and
the gap note, which render *before* it, promised the opposite.

The header renders on every step of every run. A live run has nothing
degraded, so a permanent caveat there would be a false statement paid for in
tokens on the step that can least afford them. The state is detectable, so
the header states the weaker guarantee only when the weaker guarantee is the
true one.
"""

from brotto_orchestrator.agent.context import AgentTurn, MemoryEntry, Scratchpad
from brotto_orchestrator.agent.harness import _is_degraded, _manifest_window, _turn_to_prompt


def _live(n: int) -> list[MemoryEntry]:
    """Entries as a live run captures them: body held, digest a truncated prefix.

    The body is long enough that the digest carries its `…`, which is what a
    degraded entry also has — so these two differ only in `body == digest`,
    which is the predicate actually under test.
    """
    sp = Scratchpad()
    for i in range(1, n + 1):
        sp = sp.capture_page(url=f"https://a.test/{i}", step=i,
                             text=f"page {i} " + "body text " * 40)
    return list(sp.entries)


def _resumed(n: int) -> list[MemoryEntry]:
    """Entries as a resumed run loads them: digest only, body == digest."""
    out = []
    for i in range(1, n + 1):
        digest = f"page {i}…"[:200]
        out.append(MemoryEntry(id=f"r{i}", step=i, selector="page", around=None,
                               digest=digest, body=digest, was_truncated=False,
                               url=f"https://a.test/{i}"))
    return out


def _prompt(entries: list, step_number: int = 3) -> str:
    return _turn_to_prompt(AgentTurn(
        task="t", step_number=step_number, scratchpad_entries=entries,
        current_url="https://a.test/3", current_page_title="t",
        ax_tree="", ax_diff="", step_summaries=[],
    ))


def _manifest(prompt: str) -> str:
    return prompt[prompt.index("<memory_manifest"):prompt.index("</memory_manifest>")]


def test_the_live_header_promises_the_full_body_it_actually_has():
    m = _manifest(_prompt(_live(3)))
    header = m.splitlines()[1]
    assert "fetches full body" in header
    assert "digest" not in header, "no caveat is owed on a live run"


def test_a_resumed_manifest_header_does_not_promise_a_full_body():
    m = _manifest(_prompt(_resumed(3)))
    assert "fetches full body" not in m
    assert "only a digest" in m, (
        "the header must state the weaker guarantee when the weaker guarantee "
        "is the true one"
    )


def test_the_gap_note_does_not_promise_a_body_it_cannot_hold():
    _, note = _manifest_window(_resumed(40), current_step=40, degraded=True)
    assert "in full" not in note
    assert "degraded ones say so" in note


def test_the_live_gap_note_is_unchanged():
    _, note = _manifest_window(_live(40), current_step=40)
    assert "fetches any of them in full" in note


def test_a_short_page_is_not_called_degraded():
    """digest == body is the whole truth when the page is shorter than the
    digest length — a marker there would itself be a lie."""
    entries = list(Scratchpad().capture_page(
        url="https://a.test/s", step=1, text="tiny").entries)
    assert not _is_degraded(entries[0])
    assert "fetches full body" in _manifest(_prompt(entries, step_number=1))


def test_the_header_decides_on_omitted_entries_too():
    """The gap note promises an omitted entry is fetchable, so a degraded
    entry the window dropped still makes the header's promise false."""
    entries = _live(40)
    entries[20] = entries[20].model_copy(update={"body": entries[20].digest})
    assert "only a digest" in _manifest(_prompt(entries, step_number=40))