"""Every full-recall claim in `<memory_rules>` must be scoped, or gone.

The previous version of this file pinned one removed string literal, so it
passed the moment that literal was reintroduced anywhere else — a tautology,
not a check. This asserts the *property* instead: scan the section, and for
every sentence claiming full recall, require a scoping clause in that same
sentence. A sentence somebody writes later fails whether or not it is the one
that was fixed.

Two guarantees are false without a scope and true with one:

  - **resume** — the bodies sidecar has no writer, so a resumed run's entries
    carry a digest only. `recall_memory` already says so at recall time; the
    prompt must not promise otherwise a step earlier.
  - **capture cap** — `cdp/relay.py` slices page text to `PAGE_TEXT_MAX`
    (20k) before it is ever captured. An entry is never "in full" in the sense
    of "the whole page", only "in full for what we captured".

Also covers `read_scratchpad`, which the prompt advertised as "manifest +
notes": the handler returns ids and digests, and nothing writes notes.
"""

import re

from brotto_orchestrator.agent.prompt import SYSTEM_PROMPT


def _memory_rules() -> str:
    body = SYSTEM_PROMPT[
        SYSTEM_PROMPT.index("<memory_rules>"):SYSTEM_PROMPT.index("</memory_rules>")
    ]
    # Hard-wrapped prose: collapse first, so a clause cannot be split across a
    # newline and read as absent from its own sentence.
    return re.sub(r"\s+", " ", body)


def _sentences() -> list[str]:
    return re.split(r"(?<=[.!?])\s+", _memory_rules())


# Unqualified promises of full recall. Each is true only when scoped.
_CLAIMS = ("in full", "is that page", "fetches full body", "verbatim and in full")

# A clause that makes the claim above true rather than a bare promise.
_SCOPES = (
    re.compile(r"\bonly\b"),
    re.compile(r"\bnot\b"),
    re.compile(r"\bexcept\b"),
    re.compile(r"\bdegraded\b"),
    re.compile(r"\bdigest\b"),
    re.compile(r"\b(capped|truncated)\b"),
    re.compile(r"\bresum(e|ed)\b"),
    re.compile(r"\bsurvived\b"),
    re.compile(r"\bwe (captured|kept)\b"),
)


def _unscoped(sentence: str) -> list[str]:
    """Claim occurrences in `sentence` whose own clause carries no scope.

    The scope has to follow the claim *inside the same sentence*. Sentence-
    wide matching is too loose to be a check — "the manifest holds a digest of
    the page, and recall_memory(id) returns it in full" contains `digest` and
    so passed while promising exactly what it should not. And a scope in the
    *next* sentence is the defect itself, not a fix for it: "…returns it in
    full. One exception: after a resume…" hedged the second promise in the
    pair and left "navigating away loses nothing" standing.
    """
    low = sentence.lower()
    return [
        sentence.strip() for claim in _CLAIMS
        for at in [low.find(claim)]
        if at >= 0 and not any(p.search(low[at + len(claim):]) for p in _SCOPES)
    ]


def test_no_unqualified_full_recall_claim_survives_in_memory_rules():
    unscoped = [s for sent in _sentences() for s in _unscoped(sent)]
    assert not unscoped, (
        "these sentences promise full recall with no scope attached to the "
        "claim; hedge it in the same sentence or drop it:\n  - "
        + "\n  - ".join(unscoped)
    )


def test_the_scope_check_is_not_vacuous():
    """A scoped claim still has to exist, or the test above proves nothing."""
    scoped = [
        s for sent in _sentences() for claim in _CLAIMS
        for s in [sent] if claim in sent.lower() and not _unscoped(sent)
    ]
    assert scoped, (
        "no scoped full-recall claim remains in <memory_rules>; the property "
        "check has nothing to accept and will pass on any future text"
    )


def test_both_false_guarantees_are_still_disclosed():
    rules = _memory_rules().lower()
    assert "resum" in rules, "the resume caveat is true and still has to be here"
    assert re.search(r"\b(capped|captur(ed|ing))", rules), (
        "the page-text capture cap is the other thing that makes 'in full' "
        "false, and it is disclosed nowhere else to the model"
    )


def test_read_scratchpad_is_not_advertised_as_returning_notes():
    line = next(ln for ln in SYSTEM_PROMPT.splitlines()
                if "read_scratchpad()" in ln and "dump" in ln)
    assert "notes" not in line.lower()