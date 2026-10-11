"""Failure reports: which run did not happen, and which code says why.

This is deliberately **not analytics**. Analytics answers *what did the user
do* — which pages, which tasks — and that is the surveillance posture rule 1
of `docs/architecture/privacy.md` forbids. What this answers is one question:

> Did the run happen, and if not, which of our fixed codes says why?

`failure_reason` is already a closed set of machine codes the relay writes and
the panel translates into a sentence (`FAILURE_NOTE` in `sidepanel.js`). So
the vocabulary exists; this is the ledger for it.

Two reporters, because the cases the operator most needs are the ones the
relay never sees — see `REPORTABLE` for the split.

**Nothing here is a channel for anything the user said or read.** No page
text, no AX tree, no URL or domain, no task string or title, no typed input,
no session id, no email, no model key. `build_row` is the boundary: it takes
named scalars from a closed vocabulary and **raises** on any keyword it does
not recognise, so widening the payload is a code change that
`tests/test_failure_reports.py` fails on.

Two more shapes hold the line, and they are the reason this is not written as
"just log it":

* **The caller never sends who it is.** `owner` is read off the verified
  token by the relay — the same identity `profiles` already holds — so no
  user id is on the wire, only in the table.
* **Self-host sends nothing, ever.** `reporting_enabled()` is
  `auth_mode() == "jwt"`. A self-hoster's box is the product; there is no
  operator between it and them and this must not become one.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any

from .auth import auth_mode

log = logging.getLogger("brotto.failure_report")

# ---------------------------------------------------------------------------
# The vocabulary
# ---------------------------------------------------------------------------
#
# Every code that may reach the table, union of both reporters. The server's
# half is the `failure_reason` vocabulary; the client's half is the subset of
# client-side conditions the extension can *know* about without the relay.
#
# It is a closed set on purpose: "which of our fixed codes says why" is only
# answerable if the codes are fixed. A free-text reason here would put the
# agent's own prose — which can quote the page — into a table we hold forever,
# which is the exact shape rule 3 forbids.
#
# `scripts/test-failure-reasons.test.js` enumerates both halves out of the
# source and fails if a code it finds is missing here, so this cannot quietly
# fall behind a new `failure_reason`.

#: Codes only the extension can raise, because only the extension sees them:
#: a relay that was down, or a handshake the relay refused before `accept()`.
CLIENT_CODES = frozenset({
    "offline",
    "connect_failed",
    "credential_missing",
    "credential_rejected",
    "CONNECTION_LOST",
})

#: Where in the run it happened. Also closed — an open stage would let a
#: future caller invent a descriptive one.
CLIENT_STAGE = frozenset({"connect", "task"})

#: The stage each client code belongs to, which is not one value for all of
#: them. `offline`/`connect_failed`/`credential_missing`/`credential_rejected`
#: are all raised around the handshake, before a run exists. **`CONNECTION_LOST`
#: is the exception: `background.ts` queues it from `cleanup()` and only
#: inside its `lost` branch** — `taskInFlight && !taskTerminalEmitted` — so the
#: socket died with a task running. Filing that under `connect` made every row
#: claim it happened before the run it was reported *about*, which is the one
#: question this table exists to answer. Pinned by
#: `test_connection_lost_is_reported_as_mid_task`.
CLIENT_CODE_STAGE = dict.fromkeys(
    sorted(CLIENT_CODES - {"CONNECTION_LOST"}), "connect"
) | {"CONNECTION_LOST": "task"}

SERVER_STAGES = frozenset({"task_refused", "task_result", "task_error"})

#: Filled in by the test that cross-checks both sources; kept empty here
#: because restating the server half would be a second list to drift. Read
#: `main.py`'s `_REFUSAL_REASON` and the two task-failure sites for the
#: server's own literals.
REPORTABLE: frozenset[str] = CLIENT_CODES | frozenset({
    "user_denied",
    "policy_blocked",
    "policy_preflight",
    "model_not_found",
    "auth_failed",
    "invalid_decision",
    "model_http",
    "internal",
    "task_error",
    "cdp_preflight_failed",
    "tab_unreachable",
    "scripted_target_unresolved",
    "cannot_complete",
    "budget_exhausted",
    "runaway_backstop",
    "task_refused",
    "duplicate_task_start",
    "user_skipped_login",
    "login_timeout",
    "revoked",
    "not_invited",
    "task_cap_reached",
    "control_plane_unavailable",
})

#: Client-side conditions we deliberately do **not** report. Listed rather
#: than omitted: `scripts/test-failure-reasons.test.js` requires every code
#: the extension writes to be either here or in `CLIENT_CODES`, so "we
#: decided not to" reads differently from "nobody thought about it".
#:
#: * `CANCELLED` — the user pressed stop. Reporting it counts what the user
#:   chose to do, which is the thing rule 1 is about.
#: * `TASK_ERROR` / `WS_ERROR` — the relay already records `internal` /
#:   `task_error` and the socket death as `CONNECTION_LOST`. Counting them
#:   from both ends would make one outage look like two failures.
#: * `START_FAILED` — carries a free-text reason from this worker, and the
#:   two causes behind it are a settings read failing and a crash, neither of
#:   which the operator can act on without the panel's own sentence.
#: * `NO_ACTIVE_TAB` — there is no tab because the user closed it or the
#:   window had none. It is an event, not a fault.
NOT_REPORTED = frozenset({
    "CANCELLED", "TASK_ERROR", "WS_ERROR", "START_FAILED", "NO_ACTIVE_TAB",
})

# ---------------------------------------------------------------------------
# The shape
# ---------------------------------------------------------------------------

#: The columns, and the only keys `build_row` will ever produce. A test
#: asserts a stored row has exactly this key set, so a column added without
#: a reason written down fails the build.
COLUMNS = frozenset({
    "owner", "side", "code", "stage", "ext_version", "relay_version",
})

MAX_EXT_VERSION_CHARS = 32
MAX_PER_REQUEST = 5


def build_row(
    *,
    code: str,
    stage: str,
    side: str,
    owner: str | None,
    ext_version: str | None = None,
    relay_version: str | None = None,
    **extra: Any,
) -> dict | None:
    """One table row, or None when the code is outside the vocabulary.

    **The boundary.** Every argument is a named scalar with a closed value
    space, and `**extra` makes the set exhaustive by construction: a caller
    that tries to carry a task, a URL or a summary raises here instead of
    quietly persisting it. That is the shape decision `begin_turn(ax_diff_chars=
    int)` makes on the audit side, and it is the reason this is a function
    with a whitelist rather than a dict comprehension over a request body.
    """
    if extra:
        raise ValueError(
            "a failure report row takes only "
            f"{sorted(COLUMNS)}; got extra {sorted(extra)}"
        )
    if code not in REPORTABLE:
        return None
    if not owner:
        return None
    if side == "client":
        # The halves are disjoint, not nested: a client code says the relay
        # was never reached, so the relay cannot be the one writing it.
        if code not in CLIENT_CODES or stage not in CLIENT_STAGE:
            return None
    elif side == "server":
        if code in CLIENT_CODES or stage not in SERVER_STAGES:
            return None
    else:
        return None
    return {
        "owner": owner,
        "side": side,
        "code": code,
        "stage": stage,
        # Version strings are the one free-form value allowed on this table:
        # they are how an operator knows which build emitted a code, and they
        # carry nothing about the user. Anything longer than a version is not
        # a version.
        "ext_version": (ext_version or "")[:MAX_EXT_VERSION_CHARS],
        "relay_version": (relay_version or "")[:MAX_EXT_VERSION_CHARS],
    }


def clean_version(value: object) -> str:
    """A version string, or "". Anything else is not one."""
    return value.strip()[:MAX_EXT_VERSION_CHARS] if isinstance(value, str) else ""


# ---------------------------------------------------------------------------
# When it happens at all
# ---------------------------------------------------------------------------

DISABLE_ENV = "BROTTO_FAILURE_REPORTING"

#: Reports per account per hour. One bad install — a loop on a dropped
#: socket, a laptop that sleeps and wakes — must not be able to write a row
#: per reconnect for a day.
_REPORT_CAPACITY = 20.0
_REPORT_REFILL_PER_SECOND = 20.0 / 3600.0
_REPORT_BUCKETS: dict[str, tuple[float, float]] = {}
_REPORT_SWEEP_AT = 0.0


def reporting_enabled() -> bool:
    """Cloud only, and an operator can switch it off entirely.

    `auth_mode()` not "is a Supabase configured": self-host must send
    nothing whatever, and a self-hoster with a copy of the cloud env would
    otherwise start writing to a table that outlives the run.
    """
    return auth_mode() == "jwt" and os.getenv(DISABLE_ENV, "").strip().lower() != "off"


def report_allowed(account: str) -> bool:
    """Token bucket per account. Mirrors the sign-in limiter's shape."""
    global _REPORT_SWEEP_AT
    now = time.monotonic()
    if now >= _REPORT_SWEEP_AT:
        _REPORT_SWEEP_AT = now + 300.0
        for key in [k for k, (_, ts) in _REPORT_BUCKETS.items() if now - ts > 3600.0]:
            del _REPORT_BUCKETS[key]
    tokens, seen = _REPORT_BUCKETS.get(account, (_REPORT_CAPACITY, now))
    tokens = min(_REPORT_CAPACITY, tokens + (now - seen) * _REPORT_REFILL_PER_SECOND)
    _REPORT_BUCKETS[account] = (tokens - 1.0, now)
    return tokens >= 1.0


# ---------------------------------------------------------------------------
# The write
# ---------------------------------------------------------------------------

def relay_version() -> str:
    from ..main import app

    return clean_version(getattr(app, "version", ""))


# Strong references to in-flight inserts. A bare `create_task` can be garbage
# collected before it runs, and the failure mode is a report that silently
# stops being written.
_PENDING: set[asyncio.Task] = set()


async def _insert(row: dict) -> int:
    """Write one row through the same PostgREST seam as `profiles`.

    Returns how many were accepted, so an endpoint can answer with the count
    rather than guessing. Every failure is swallowed by type: this is a
    durability nicety, and a Supabase outage must not become a run failure.
    """
    from .jwt_auth import _profiles

    status, text = await _profiles("POST", "", row, path="rest/v1/failure_reports")
    if status >= 400:
        log.warning("failure report insert answered %d", status)
        return 0
    return len(row)


async def record(rows: list[dict]) -> int:
    """Persist already-built rows. Never raises."""
    if not rows:
        return 0
    try:
        stored = 0
        for row in rows:
            stored += await _insert(row)
        if stored:
            log.info("failure reports  written=%d", stored)
        return stored
    except Exception as exc:
        # The TYPE, never the message: a PostgREST body echoes the row, and
        # the row is the thing this whole module exists to keep small.
        log.warning("failure report write failed: %s", type(exc).__name__)
        return 0


def note_failure(code: str, stage: str, claims, ext_version: str = "") -> None:
    """Record one relay-side failure. Fire-and-forget; never blocks a run.

    Called from the frame-building paths, not from the agent loop, so the
    cost is never on the step the user is watching. `claims` is the verified
    token's, never a body field.
    """
    if not reporting_enabled() or claims is None or code not in REPORTABLE:
        return
    owner = getattr(claims, "sub", None)
    if not owner or not report_allowed(owner):
        return
    row = build_row(
        code=code, stage=stage, side="server", owner=owner,
        ext_version="", relay_version=relay_version(),
    )
    if row is None:
        return
    spawn(record([row]))


def spawn(coro) -> None:
    try:
        task = asyncio.ensure_future(coro)
    except RuntimeError:
        # No running loop (startup, a test): a report is never worth
        # raising the relay for.
        coro.close()
        return
    _PENDING.add(task)
    task.add_done_callback(_PENDING.discard)


def build_client_rows(
    body: Any, owner: str | None, relay_version: str = ""
) -> tuple[list[dict], int]:
    """Rows from a `POST /v1/reports` body. Returns (rows, offered).

    **Only `code` and `ext_version` are read.** Everything else in the body —
    a `task`, a `url`, a `summary`, a `session_id` someone helpfully added —
    is not a field this function has, so it cannot be persisted. That is the
    guarantee the test pins, and it is a *shape*, not a filter that could be
    widened later without anyone noticing.

    An unknown code is dropped rather than refused: a newer extension against
    an older relay must not break its run over a report it does not need.
    """
    if not isinstance(body, dict):
        return [], 0
    raw = body.get("reports")
    if not isinstance(raw, list):
        return [], 0
    offered = 0
    rows: list[dict] = []
    for item in raw[:MAX_PER_REQUEST]:
        if not isinstance(item, dict):
            continue
        offered += 1
        row = build_row(
            code=str(item.get("code", "")),
            # Per code, not one value for all of them — see
            # `CLIENT_CODE_STAGE`. An unknown code maps to nothing and is
            # dropped by `build_row` below, exactly as it was.
            stage=CLIENT_CODE_STAGE.get(str(item.get("code", "")), "connect"),
            side="client",
            owner=owner,
            ext_version=clean_version(item.get("ext_version")),
            relay_version=relay_version,
        )
        if row is not None:
            rows.append(row)
    return rows, offered