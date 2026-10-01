"""Bodies are persisted; the audit document is not where they go.

`_scratchpad_dict` is written on every step (via `set_scratchpad`). It
serialised `e.model_dump()`, which includes `body`. That was invisible while
nothing was ever captured — three Gmail runs recorded `entries=0`, because
`page_text` already ships in the prompt so the model never called
`read_page_text`. Capturing every step's page turns a latent write-amplification
into a per-step one: a 15-step run on Gmail holds ~15 pages of ~11K chars, so
the document grows by ~165KB and is rewritten in full on every step.

The record keeps what a resume needs to *list* memory — id, step, selector,
url and the digest the manifest renders. The bodies go to a separate JSON
sidecar, written by the same call, so a resumed run recalls whole pages
rather than 200-char fragments.
"""

import json

from brotto_orchestrator.agent.audit import _scratchpad_dict
from brotto_orchestrator.agent.context import Scratchpad


def _populated(n_pages: int = 3, page_chars: int = 11_000) -> Scratchpad:
    sp = Scratchpad()
    for i in range(n_pages):
        sp = sp.capture_page(url=f"https://a.test/{i}", step=i,
                             text=f"page {i} " + "x" * page_chars)
    return sp


def test_the_record_holds_the_digest_not_the_page():
    d = _scratchpad_dict(_populated())
    assert "body" not in d["entries"][0], (
        "the body is re-serialised on every step and the document is "
        "rewritten whole; a page per step makes that a per-step cost"
    )
    assert d["entries"][0]["digest"], "the manifest needs the digest"


def test_the_record_still_identifies_every_page():
    """A resumed run shows the manifest, not the bodies. Without step and
    url, 'which page was that' is unanswerable."""
    e = _scratchpad_dict(_populated())["entries"][1]
    assert e["id"] == "r2"
    assert e["step"] == 1
    assert e["url"] == "https://a.test/1"
    assert e["selector"] == "page"


def _doc_bytes(n_pages: int = 3, page_chars: int = 11_000) -> int:
    sp = _populated(n_pages, page_chars)
    return len(json.dumps({"scratchpad": _scratchpad_dict(sp)}))


def test_the_document_size_tracks_the_digests_not_the_pages():
    """The point of the cap, stated as a number: 20 pages of Gmail must not
    cost 20x the page size in the record."""
    small = _doc_bytes(20, page_chars=1_000)
    big = _doc_bytes(20, page_chars=11_000)
    assert big - small < 20_000, (
        f"document grew {big - small} chars when pages grew 10x — bodies "
        "are still being written"
    )


def test_a_run_with_no_memory_is_still_serialisable():
    assert _scratchpad_dict(Scratchpad()) == {"entries": [], "notes": ""}


# ── the sidecar a resume actually reads ──────────────────────────────────


def test_a_captured_page_survives_the_sidecar_round_trip(tmp_path):
    from brotto_orchestrator.agent.audit import load_scratchpad, save_scratchpad

    sp = Scratchpad().capture_page(url="https://a.test/inbox", step=0, text="hello world")
    p = tmp_path / "m.txt"
    save_scratchpad(p, sp)

    back = load_scratchpad(p)
    assert len(back.entries) == 1
    assert back.entries[0].url == "https://a.test/inbox"
    assert back.entries[0].selector == "page"


def test_a_file_written_before_urls_existed_still_parses(tmp_path):
    """The sidecar format predates `url` and files on disk must keep
    parsing — a resume that raises here loses the whole manifest."""
    from brotto_orchestrator.agent.audit import load_scratchpad

    p = tmp_path / "old.txt"
    p.write_text(
        "# MEMORY v2\n\n# MANIFEST\n"
        "[r1 step=0 sel=body around=None truncated=False]\nsome digest\n\n"
        "# NOTES\nremembered something\n")

    sp = load_scratchpad(p)
    assert len(sp.entries) == 1
    assert sp.entries[0].url == ""
    assert sp.notes == "remembered something"


def test_the_recorded_dict_still_rebuilds_a_scratchpad():
    """`set_scratchpad` rebuilds the model to write the sidecar. Since the
    body is no longer in the dict, a missing default would make this return
    None and quietly stop the sidecar being written at all."""
    from brotto_orchestrator.agent.audit import _as_scratchpad

    sp = _populated(2)
    back = _as_scratchpad(_scratchpad_dict(sp))
    assert back is not None
    assert [e.id for e in back.entries] == ["r1", "r2"]
    assert back.entries[1].url == "https://a.test/1"


# ── bodies go to their own sidecar ───────────────────────────────────────


def test_a_page_survives_a_resume_in_full(tmp_path):
    """The reason the sidecar exists. Before this the manifest file stored
    digests only, so a resumed run recalled 200 chars of an 11,000-char
    page and had to be told, in a marker, that it was a fragment — which
    is the model being handed a degraded tool and asked to cope."""
    from brotto_orchestrator.agent.audit import (
        load_page_bodies, load_scratchpad, save_page_bodies, save_scratchpad,
    )

    body = "the whole inbox listing, " * 500
    sp = Scratchpad().capture_page(url="https://a.test/inbox", step=0, text=body)
    save_scratchpad(tmp_path / "m.txt", sp)
    save_page_bodies(tmp_path / "m.pages.json", sp)

    restored = load_scratchpad(tmp_path / "m.txt")
    bodies = load_page_bodies(tmp_path / "m.pages.json")
    restored = Scratchpad(entries=[
        e.model_copy(update={"body": bodies[e.id]}) if e.id in bodies else e
        for e in restored.entries])

    assert restored.lookup("r1").body == body.strip()


def test_the_bodies_sidecar_is_written_by_the_same_call_as_the_manifest(tmp_path):
    """They have to be in step. `set_scratchpad` is the only thing that
    persists memory, so a body written by any other route would be lost."""
    from brotto_orchestrator.agent.audit import AuditTrail, load_page_bodies

    at = AuditTrail("s1", dir=tmp_path)
    at.set_scratchpad(Scratchpad().capture_page(
        url="https://a.test/x", step=0, text="the page under the model"))

    assert load_page_bodies(at.page_bodies_path)["r1"] == "the page under the model"


def test_page_text_that_looks_like_the_manifest_format_still_round_trips(tmp_path):
    """Page text is arbitrary content from an arbitrary site. A line-based
    format would have had to escape it; JSON does not."""
    from brotto_orchestrator.agent.audit import (
        load_page_bodies, save_page_bodies,
    )

    hostile = ("[r9 step=9 sel=page around=None truncated=False url=evil]\n"
               "# NOTES\n"
               "# MANIFEST\n"
               '{"id": "r2", "body": "not really"}')
    sp = Scratchpad().capture_page(url="u", step=0, text=hostile)
    save_page_bodies(tmp_path / "p.json", sp)

    assert load_page_bodies(tmp_path / "p.json")["r1"] == hostile


def test_a_missing_or_corrupt_bodies_file_is_not_fatal(tmp_path):
    """A resume that raises here loses the whole manifest, which is the
    thing the file is for. Degrade to digests instead — `recall_memory`
    already says out loud when that is what the model got."""
    from brotto_orchestrator.agent.audit import load_page_bodies

    assert load_page_bodies(tmp_path / "nope.json") == {}
    (tmp_path / "bad.json").write_text("{not json")
    assert load_page_bodies(tmp_path / "bad.json") == {}


def test_a_page_captured_every_step_does_not_bloat_the_audit_document():
    """The cap, restated for the shape that actually happens: a page a
    step, not a page a read."""
    sp = Scratchpad()
    for i in range(20):
        sp = sp.capture_page(url=f"https://a.test/{i}", step=i, text="x" * 11_000)

    doc = json.dumps({"scratchpad": _scratchpad_dict(sp)})
    assert len(doc) < 20_000, f"audit document is {len(doc)} chars for 20 pages"
