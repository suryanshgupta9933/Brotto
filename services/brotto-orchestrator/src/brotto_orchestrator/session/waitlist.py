"""The waitlist: addresses that asked for the beta, so the operator can invite.

The first thing this project holds about someone who is **not** an account.
Everything else in `sessions/` belongs to a person who installed the extension
and pointed it at their own browser; this is a stranger who filled in a form on
a marketing page. That difference is the whole design constraint, and it is the
same constraint as everywhere else here, applied to a new category:

> Store the one field that was asked for, and nothing derived from it.

So `build_row` takes an email and nothing else. No referrer, no user agent, no
page URL, no IP — not because they are filtered out, but because there is no
parameter to put them in. `**extra` raises rather than filtering, for the same
reason `failure_report.build_row` does: a filter is something a later commit
widens with a reason that reads well.

**The answer is the same for an address that is new and one that is already
here.** The uniqueness constraint is in the migration, not in a SELECT first,
and a duplicate comes back as a 409 that this module reads as success. That is
deliberate in both halves: a read-then-insert is a race a double-clicked submit
wins, and a route that answers differently for two outcomes is a route that can
be asked *"is this person on the list?"* — which is a directory of strangers'
inbox membership, offered to anyone who can reach a public URL.

**Nothing is logged.** Not the address, not the body, not a PostgREST error
text — a Supabase insert error quotes the row, and the row is the entire
payload. Only the status code crosses into a log line, which is what an
operator needs and is not what the table holds.
"""

from __future__ import annotations

import logging
import os

from .auth import auth_mode

log = logging.getLogger("brotto.waitlist")

#: The columns, and the only keys `build_row` will ever produce. A test asserts
#: a built row has exactly this key set, so a column added without a reason
#: written down fails the build.
COLUMNS = frozenset({"email", "batch"})

#: Which invite round this row went out in. Not user content — it is stamped
#: from this variable, which the operator sets when they send a batch. Empty
#: by default, because an install that never sets it must still accept a signup.
BATCH_ENV = "BROTTO_WAITLIST_BATCH"


def batch() -> str:
    return os.getenv(BATCH_ENV, "").strip()[:64]


def build_row(*, email: str, **extra) -> dict:
    """The row for one signup. Raises on anything it was not asked to store.

    **The boundary.** One named argument, so widening the payload is a code
    change a test fails on rather than a dict comprehension somebody widens with
    the body of the request. The same shape decision as
    `begin_turn(ax_diff_chars: int)`.
    """
    if extra:
        raise ValueError(
            f"a waitlist row takes only {sorted(COLUMNS)}; got extra {sorted(extra)}"
        )
    return {"email": email, "batch": batch()}


def waitlist_enabled() -> bool:
    """Hosted relay only, and it fails shut when there is nowhere to write.

    `auth_mode() == "jwt"` for the same reason `failure_report.reporting_enabled`
    is keyed that way and not on "is a Supabase configured": self-host must
    hold nothing at all, and a self-hoster with a stray `SUPABASE_URL` left over
    from copying the cloud env must not start collecting strangers' addresses
    because they pasted it. A self-hosted box answers 404, which is the same
    answer as a route that does not exist.
    """
    if auth_mode() != "jwt":
        return False
    from .jwt_auth import _service_key, _supabase_url

    return bool(_supabase_url() and _service_key())


async def add(email: str) -> bool:
    """Write one row through the same PostgREST seam as the other two tables.

    True when the row is there — newly written or already present. False when
    Supabase did not take it. Never raises, and never returns anything about
    the address.
    """
    from .jwt_auth import SupabaseUnavailable, _profiles

    row = build_row(email=email)
    try:
        status, _ = await _profiles("POST", "", row, path="rest/v1/waitlist")
    except SupabaseUnavailable:
        log.warning("waitlist insert: control plane unavailable")
        return False
    except Exception as exc:
        # The TYPE, never the message: a PostgREST body quotes the row, and the
        # row is the one field this whole module exists to keep small.
        log.warning("waitlist insert failed: %s", type(exc).__name__)
        return False
    if status == 409:
        # Already on the list. Answered exactly as a first submit is — the
        # duplicate is a success for the caller and a no-op for the table.
        return True
    if status >= 400:
        log.warning("waitlist insert answered %d", status)
        return False
    return True