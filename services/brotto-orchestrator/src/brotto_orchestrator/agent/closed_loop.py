"""The vocabulary the closed loop is written against.

A write that reports a dispatch is not a write. This module holds everything
that decides whether a write LANDED — the ledger entry, the plan item, which
frame to call for which app, the canonical target key, and the comparison that
produces the verdict — and nothing that talks to a browser. That separation is
what makes the rest of the loop testable without a relay.

Pure: no I/O, no relay, no dependencies.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlsplit

# The three verdicts a read-back can produce. `UNKNOWN` is the only one that
# is not a statement about the target: it means the read could not be
# performed, so the write is unverified rather than wrong.
CONFIRMED = "confirmed"
MISMATCH = "mismatch"
UNKNOWN = "unknown"

# A target gets three tries, and a run gets three blocked writes before the
# harness ends it. Both are here rather than in the harness so the numbers are
# one fact, not two copies.
MAX_ATTEMPTS_PER_TARGET = 3
MAX_BLOCKED_ATTEMPTS = 3


@dataclass
class WriteAttempt:
    """One write, and what the target said when it was read back.

    `intended` and `observed` are typed values, so this is user data: it is
    redacted on the way into the session file and compared in memory on the
    real value. `target_key` is structural (`cell:A1`, `ref:textbox:name`) and
    is not redacted.
    """

    target_key: str
    intended: str
    observed: str | None
    confirmed: bool
    mechanism: str
    step: int


@dataclass
class PlanItem:
    """One declared step of the task.

    An item closes only from a confirmed ledger entry — never from the model
    saying so. `target_key` is None for a plan step that is not a write, and
    such an item is never closed by the ledger.
    """

    id: int
    intent: str
    target_key: str | None
    value: str | None
    status: str  # "pending" | "confirmed" | "failed"


@dataclass
class AppAdapter:
    """How the server drives one application's write and read.

    The DOM knowledge lives in the extension (spec §5.6); this says only WHICH
    frame to call. The grid's write ladder runs in the extension for the same
    reason, and the server still grades the result by reading back itself.
    """

    app: str
    origin: str
    path_prefix: str
    write_op: str
    read_op: str


ADAPTERS: list[AppAdapter] = [
    AppAdapter(
        app="google-sheets",
        origin="https://docs.google.com",
        path_prefix="/spreadsheets/",
        write_op="grid_write_cell",
        read_op="grid_read_cell",
    ),
]

DEFAULT_ADAPTER = AppAdapter(
    app="default",
    origin="",
    path_prefix="",
    write_op="ref",
    read_op="ax",
)


def adapter_for(url: str | None) -> AppAdapter:
    """The adapter for a page, or the default. Never None.

    Origin AND path prefix, both: docs.google.com hosts documents and
    presentations as well as sheets, and a path prefix alone is not a
    boundary — any host can serve /spreadsheets/.
    """
    if not url:
        return DEFAULT_ADAPTER
    try:
        parts = urlsplit(url)
    except ValueError:
        return DEFAULT_ADAPTER
    origin = f"{parts.scheme}://{parts.netloc}" if parts.scheme else ""
    for a in ADAPTERS:
        if a.origin != origin:
            continue
        if not parts.path.startswith(a.path_prefix):
            continue
        return a
    return DEFAULT_ADAPTER


def normalise_value(value: str) -> str:
    """Trim, collapse internal whitespace, casefold.

    The comparison is about the same value, not the same bytes: a grid's
    read-back trims, and a user's trailing space is not a different name.
    """
    return " ".join(str(value).split()).casefold()


def canonical_target_key(target: dict, *, resolved: str | None = None) -> str:
    """The stable identity of a target.

    A raw string is not a key: the model may write `A1`, `a1` or `cell A1`,
    and an AX ref changes on every step. A ref therefore keys on its RESOLVED
    description when there is one — `ref:textbox:Search` — and falls back to the
    ephemeral ref only when nothing resolved.
    """
    if not isinstance(target, dict):
        raise ValueError("a target is a ref, a cell, or a description")
    if "cell" in target:
        raw = str(target["cell"] or "")
        if not raw.strip():
            raise ValueError("a cell target needs a reference, e.g. A1")
        return "cell:" + "".join(raw.split()).upper()
    if "description" in target:
        phrase = " ".join(str(target["description"] or "").split()).casefold()
        if not phrase:
            raise ValueError("a description target needs a phrase")
        return "desc:" + phrase
    if "ref" in target:
        ref = str(target["ref"] or "").strip()
        if not ref:
            raise ValueError("a ref target needs an id")
        return "ref:" + (resolved or ref)
    raise ValueError("a target is a ref, a cell, or a description")


def compare_observed(observed: str | None, intended: str) -> str:
    """One of CONFIRMED / MISMATCH / UNKNOWN.

    A None observed is the ONLY unknown — an empty string is a read that
    happened and found nothing, which is a definite fact and a real mismatch.
    This distinction is the spec's §5.7 warning made operational: a target
    that cannot be read must not fail a run the way a wrong value does.
    """
    if observed is None:
        return UNKNOWN
    if normalise_value(observed) == normalise_value(intended):
        return CONFIRMED
    return MISMATCH


def render_ledger(ledger: list[WriteAttempt]) -> str:
    """The ledger as the model reads it: one line per attempt, oldest first."""
    if not ledger:
        return "(no writes yet)"
    lines = [f"{len(ledger)} write attempt(s):"]
    for a in ledger:
        if a.confirmed:
            state = "confirmed"
            detail = f'observed "{a.observed}"'
        elif a.observed is None:
            state = "could not be read back"
            detail = "the write is unverified"
        else:
            state = "NOT confirmed"
            detail = f'observed "{a.observed}"'
        lines.append(
            f'{a.target_key}  intended "{a.intended}"  {detail}  '
            f"{state}  (step {a.step}, {a.mechanism})"
        )
    return "\n".join(lines)


def render_plan(plan: list[PlanItem]) -> str:
    """The plan as the model reads it: one line per item, oldest first."""
    if not plan:
        return "(no plan declared)"
    return "\n".join(
        f"{item.id}. {item.intent}  [{item.status}]" for item in plan
    )