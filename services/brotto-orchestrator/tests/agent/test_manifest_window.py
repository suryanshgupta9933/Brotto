"""The manifest is windowed in the prompt, never in memory.

One entry is captured per step at ~70 tokens, so an uncapped manifest grew
linearly while the AX-tree budget it competes with decayed. Rendering is
bounded; `deps.scratchpad` is not, and recall_memory still resolves an id
the window left out — which is the whole reason the dropped range is named.
"""


from brotto_orchestrator.agent.context import AgentTurn, MemoryEntry, Scratchpad
from brotto_orchestrator.agent.harness import _manifest_window, _turn_to_prompt


def _entries(n: int) -> list[MemoryEntry]:
    return [MemoryEntry(id=f"r{i}", step=i, selector="page", around=None,
                        digest=f"page {i}", body=f"body {i}",
                        was_truncated=False, url=f"https://a.test/{i}")
            for i in range(1, n + 1)]


def _prompt_for(entries: list, current_url: str = "https://a.test/999") -> str:
    return _turn_to_prompt(AgentTurn(
        task="t", step_number=len(entries), scratchpad_entries=entries,
        current_url=current_url, current_page_title="t",
        ax_tree="", ax_diff="", step_summaries=[],
    ))


def test_a_long_run_manifest_stays_bounded():
    prompt = _prompt_for(_entries(200))
    rendered = prompt[prompt.index("<memory_manifest"):prompt.index("</memory_manifest>")]
    assert rendered.count(" step=") <= 13, "one per shown entry plus the gap note"
    assert len(prompt) < 6_000, "the manifest must not scale with the run"


def test_the_dropped_range_is_named_so_recall_is_reachable():
    shown, note = _manifest_window(_entries(40), current_url="")
    assert "r4–r31" in note
    assert "recall_memory" in note
    assert len(shown) == 12


def test_the_current_pages_entry_survives_the_window():
    entries = _entries(40)
    current = entries[10]  # inside the dropped middle
    shown, _ = _manifest_window(entries, current_url=current.url)
    assert current.id in [e.id for e in shown]
    assert "THIS PAGE" in _prompt_for(entries, current_url=current.url)


def test_an_omitted_entry_is_still_recallable():
    sp = Scratchpad(entries=_entries(40))
    shown, _ = _manifest_window(sp.entries, current_url="")
    omitted = next(e for e in sp.entries if e not in shown)
    assert sp.lookup(omitted.id) is omitted
    assert omitted.id not in [e.id for e in shown]