"""An id is never handed out twice, even if an entry is dropped.

Both id sources derived the number from a list length: `Scratchpad.next_id`
was `f"r{len(self.entries) + 1}"` and `AuditTrail._add_message` was
`f"m{len(messages) + 1}"`. Correct only while nothing is ever removed. Drop
the last entry and the next id minted is the dead one — and because `lookup`
returns the *first* match, every later recall on the reused id resolves to a
different page under the same id. A wrong answer, not an error.

Nothing removes entries today. The invariant is the thing worth pinning: the
next prune should not be able to introduce a silent wrong answer.
"""

import pytest

from brotto_orchestrator.agent.audit import AuditTrail
from brotto_orchestrator.agent.context import (MemoryEntry, Scratchpad,
                                               next_serial)


def _entry(i: str) -> MemoryEntry:
    return MemoryEntry(id=i, step=1, selector="page", around=None,
                       digest="d", body="b", was_truncated=False,
                       url="https://a.test/")


# ── the primitive ────────────────────────────────────────────────

def test_next_serial_never_rewinds_past_the_floor():
    assert next_serial("r", ["r1", "r2"], floor=9) == 10


def test_next_serial_continues_past_ids_already_on_disk():
    assert next_serial("r", ["r1", "r2", "r7"]) == 8


def test_next_serial_ignores_other_prefixes_and_junk():
    assert next_serial("r", ["m3", "r2", "notes", "", None or "x"]) == 3


def test_next_serial_on_an_empty_list_is_one():
    assert next_serial("m", []) == 1


# ── Scratchpad ───────────────────────────────────────────────────

def test_dropping_an_entry_does_not_let_a_later_one_reuse_its_id():
    """The guarantee, at the strength the counter can actually give.

    A *live* Scratchpad that has handed out r3 remembers it, so pruning r3
    off its own list still yields r4. The counter is what makes that true;
    the list length is what made it false.
    """
    sp = Scratchpad()
    for i in range(3):
        sp = sp.with_entry(_entry(sp.next_id()))
    assert [e.id for e in sp.entries] == ["r1", "r2", "r3"]

    sp.entries.pop()                      # whatever prune lands here
    assert sp.next_id() == "r4"
    assert sp.lookup("r3") is None, (
        "a removed id must resolve to nothing, not to a different entry"
    )


def test_a_fresh_scratchpad_can_only_know_the_ids_it_was_given():
    """The honest ceiling, pinned so it stays a decision.

    Rebuilt from a truncated on-disk manifest, a Scratchpad has nothing but
    the ids present to go on: r3 was dropped from the manifest too, so no
    counter anywhere could know it existed. Restore-side pruning must keep
    the ids it drops visible (`_manifest_window`'s omission note) rather than
    renumber, or this returns to mashing a live recall onto the wrong page.
    """
    trimmed = Scratchpad(entries=[_entry("r1"), _entry("r2")])
    assert trimmed.next_id() == "r3"


def test_next_id_keeps_counting_after_with_entry():
    sp = Scratchpad()
    first = sp.next_id()
    assert first == "r1"
    # `capture_page` returns a *new* Scratchpad, so the counter has to travel.
    moved = sp.with_entry(_entry(first))
    assert moved.next_id() == "r2"


def test_a_manifest_restored_from_disk_continues_past_its_own_ids():
    restored = Scratchpad(entries=[_entry("r1"), _entry("r2"), _entry("r3")])
    assert restored.next_id() == "r4", (
        "resume appends to a loaded manifest; r4 here would overwrite r4"
    )


def test_existing_ids_are_not_renumbered():
    sp = Scratchpad(entries=[_entry("r1"), _entry("r5")])
    sp.next_id()
    assert [e.id for e in sp.entries] == ["r1", "r5"]


# ── AuditTrail ───────────────────────────────────────────────────

@pytest.fixture
def trail(tmp_path):
    t = AuditTrail("s1", dir=tmp_path)
    t.close()
    return AuditTrail("s1", dir=tmp_path)


def test_message_ids_are_m1_m2_and_do_not_renumber(trail):
    assert trail.add_message(role="user", content="a", task=0, turn=None) == "m1"
    assert trail.add_message(role="assistant", content="b", task=0,
                             turn=None) == "m2"


def test_dropping_a_message_does_not_let_a_later_one_reuse_its_id(trail):
    trail.add_message(role="user", content="a", task=0, turn=None)
    trail.add_message(role="user", content="b", task=0, turn=None)
    trail._doc["messages"].pop()
    third = trail.add_message(role="user", content="c", task=0, turn=None)
    assert third == "m3"
    ids = [m["id"] for m in trail._doc["messages"]]
    assert len(ids) == len(set(ids)), f"reused id in {ids}"


def test_message_ids_continue_past_a_document_that_already_has_some(trail):
    trail._doc["messages"].append({"id": "m4", "role": "user"})
    assert trail.add_message(role="user", content="x", task=0,
                             turn=None) == "m5"