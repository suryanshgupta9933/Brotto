"""The manifest is windowed in the prompt, never in memory.

One entry is captured per step at ~70 tokens, so an uncapped manifest grew
linearly while the AX-tree budget it competes with decayed. Rendering is
bounded; `deps.scratchpad` is not, and recall_memory still resolves an id
the window left out — which is the whole reason the dropped range is named.
"""


from brotto_orchestrator.agent.context import AgentTurn, MemoryEntry, Scratchpad
from brotto_orchestrator.agent.harness import _manifest_window, _turn_to_prompt


def _entries(n: int, url=lambda i: f"https://a.test/{i}") -> list[MemoryEntry]:
    return [MemoryEntry(id=f"r{i}", step=i, selector="page", around=None,
                        digest=f"page {i}", body=f"body {i}",
                        was_truncated=False, url=url(i))
            for i in range(1, n + 1)]


def _prompt_for(entries: list, current_url: str = "https://a.test/999",
                step_number: int | None = None) -> str:
    return _turn_to_prompt(AgentTurn(
        task="t",
        step_number=len(entries) if step_number is None else step_number,
        scratchpad_entries=entries,
        current_url=current_url, current_page_title="t",
        ax_tree="", ax_diff="", step_summaries=[],
    ))


def test_a_long_run_manifest_stays_bounded():
    prompt = _prompt_for(_entries(200))
    rendered = prompt[prompt.index("<memory_manifest"):prompt.index("</memory_manifest>")]
    assert rendered.count(" step=") <= 13, "one per shown entry plus the gap note"
    assert len(prompt) < 6_000, "the manifest must not scale with the run"


def test_the_dropped_range_is_named_so_recall_is_reachable():
    shown, note = _manifest_window(_entries(40), current_step=40)
    assert "r4–r31" in note
    assert "recall_memory" in note
    assert len(shown) == 12


def test_the_current_pages_entry_survives_the_window():
    entries = _entries(40)
    shown, _ = _manifest_window(entries, current_step=10)
    assert "r10" in [e.id for e in shown]
    assert "THIS PAGE" in _prompt_for(entries, step_number=10)


def test_revisiting_one_url_does_not_grow_the_window():
    """The escape hatch is bounded to one entry, whatever the run does.

    It existed to keep the current page's "do not recall" marker rendering.
    Prepending every same-url entry instead meant a run that stayed on one
    page accumulated entries that all matched, all prepended — the window
    stopped being a window, which is the thing it was added to enforce.
    """
    entries = _entries(60, url=lambda i: "https://a.test/one")
    shown, note = _manifest_window(entries, current_step=20)
    assert len(shown) == 13, "head 3 + tail 9 + one escape entry, not fifty-seven"
    # The ones the hatch did not keep are still accounted for by name.
    assert "47 entries omitted" in note


def test_a_stale_entry_sharing_the_current_url_is_not_marked_current():
    """`THIS PAGE` is a claim about identity, decided by capture step.

    Several entries share a url whenever the user reloads, an SPA swaps
    route, or a site serves one path across a run. Under url equality all of
    them claimed to be the page in front of the model.
    """
    entries = _entries(40, url=lambda i: "https://a.test/one")
    prompt = _prompt_for(entries, current_url="https://a.test/one", step_number=40)
    marked = [ln for ln in prompt.splitlines() if "THIS PAGE" in ln]
    assert len(marked) == 1, f"expected one THIS PAGE marker, got {marked}"
    assert "step=40" in marked[0]


def test_an_omitted_entry_is_still_recallable():
    sp = Scratchpad(entries=_entries(40))
    shown, _ = _manifest_window(sp.entries, current_step=40)
    omitted = next(e for e in sp.entries if e not in shown)
    assert sp.lookup(omitted.id) is omitted
    assert omitted.id not in [e.id for e in shown]


def test_an_omitted_entry_is_still_recallable():
    sp = Scratchpad(entries=_entries(40))
    shown, _ = _manifest_window(sp.entries, current_step=40)
    omitted = next(e for e in sp.entries if e not in shown)
    assert sp.lookup(omitted.id) is omitted
    assert omitted.id not in [e.id for e in shown]

def test_a_gap_made_only_of_the_current_page_does_not_kill_the_prompt():
    """The whole window logic died here, on the step it ran.

    Thirteen entries put the current page alone in the gap, so the escape
    hatch kept the only entry the omission note then had to name.
    """
    es = _entries(13)
    es[3] = MemoryEntry(id="r4", step=99, selector="page", around=None,
                        digest="d", body="b", was_truncated=False,
                        url="http://x")
    shown, note = _manifest_window(es, current_step=99)
    assert "r4" in [e.id for e in shown]
    assert note == "", "nothing was omitted, so nothing is claimed to be"


def test_identical_entries_do_not_hide_each_other():
    """Value equality, not identity — the second bug the index pass removed.

    The escape hatch used `e not in here[-1:]`, and pydantic compares by
    value: an entry identical to the kept one in every field, id included,
    matched it. Two identical entries in the gap therefore left `hidden`
    empty and the note raised. One is kept and named, one is kept and named.
    """
    twin = MemoryEntry(id="r4", step=99, selector="page", around=None,
                       digest="d", body="b", was_truncated=False,
                       url="http://x")
    es = _entries(14)
    es[3] = twin
    es[4] = twin.model_copy()
    shown, note = _manifest_window(es, current_step=99)
    assert note.startswith("  ... 1 entries omitted"), note
    assert len(shown) == 3 + 9 + 1
