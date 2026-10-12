"""The waitlist: addresses that asked for the beta, so the operator can invite.

The first thing this project holds about someone who is **not** an account.
Everything else in `sessions/` belongs to a person who installed the extension
and pointed it at their own browser; this is a stranger who filled in a form on
a marketing page. That difference is the whole design constraint, and it is the
same constraint as everywhere else here, applied to a new category:

> Store the fields that were asked for, and nothing derived from them.

So `build_row` takes an email, a bounded display name, and nothing else. No
referrer, no user agent, no page URL, no IP, no free-text note — not because
they are filtered out, but because there is no parameter to put them in.
`**extra` raises rather than filtering, for the same reason
`failure_report.build_row` does: a filter is something a later commit
widens with a reason that reads well.

**The answer is the same for an address that is new and one that is already
here.** The uniqueness constraint is in the migration, not in a SELECT first,
and a duplicate comes back as a 409 that this module reads as success. That is
deliberate in both halves: a read-then-insert is a race a double-clicked submit
wins, and a route that answers differently for two outcomes is a route that can
be asked *"is this person on the list?"* — which is a directory of strangers'
inbox membership, offered to anyone who can reach a public URL.

**`add` therefore reports which one happened, and the route still does not.**
This is the oracle guard, and it is the whole reason `add` returns a `Signup`
rather than a bare `True`: a confirmation email must go to an address that was
*just* added and not to one that was already here, so the distinction has to
exist somewhere — and it is made here, **internally**, where only this process
can read it. The route maps both `CREATED` and `DUPLICATE` to the same
`200 {"ok": true}`, and the send is a background task hanging off that same
answer, so neither the body nor the time-to-first-byte carries the fact. Widening
the response to distinguish them (or waiting on the send before answering, which
is the same leak through a stopwatch) hands a public URL a membership oracle
with a slow path on it. `test_a_duplicate_is_answered_identically_and_sends_nothing`
is the pin.

**What the waitlist table guarantees, and why nothing downstream re-checks
it.** `email` is `unique`, so an address is one row for the life of the table,
and `CREATED` is returned only on a 2xx — a second submission can therefore
only ever be a `DUPLICATE`, which by design never sends. That is the whole
argument for the mail API sending **no idempotency key**: there is no retry
loop, no queue re-drive and no second caller (`send_confirmation` has exactly
one, on the request that performed the insert), so there is no path on which
one address produces two mails. An `Idempotency-Key` derived from the address
protected against nothing the constraint had not already made impossible, and
Resend holds one for 24 hours — so it silently refused a *legitimately new*
signup for anyone mailed the day before. If a re-drive path is ever added, it
needs a key keyed on the inserted row's `id`, not the address, and that is the
moment this argument stops holding.

**Nothing is logged.** Not the address, not the body, not a PostgREST error
text — a Supabase insert error quotes the row, and the row is the entire
payload. Only the status code crosses into a log line, which is what an
operator needs and is not what the table holds.
"""

from __future__ import annotations

import enum
import logging
import os
import re

from .auth import auth_mode

log = logging.getLogger("brotto.waitlist")

#: The columns, and the only keys `build_row` will ever produce. A test asserts
#: a built row has exactly this key set, so a column added without a reason
#: written down fails the build.
COLUMNS = frozenset({"email", "name", "batch"})

#: How much of a typed name is kept. 64 characters is a person; a paragraph is
#: the form being used as storage. Truncated rather than rejected, the same way
#: `batch` is — a long name is not a reason to lose the signup.
NAME_MAX_CHARS = 64

#: Which invite round this row went out in. Not user content — it is stamped
#: from this variable, which the operator sets when they send a batch. Empty
#: by default, because an install that never sets it must still accept a signup.
BATCH_ENV = "BROTTO_WAITLIST_BATCH"


class Signup(enum.Enum):
    """What `add` did — and what it must never tell a caller.

    `CREATED` and `DUPLICATE` are both successes, and the route answers both
    with one identical response. Only `REFUSED` is an error. The distinction
    exists because the confirmation email belongs to a first signup alone; it
    is an internal signal, not a status code.
    """

    CREATED = "created"
    DUPLICATE = "duplicate"
    REFUSED = "refused"

    @property
    def ok(self) -> bool:
        return self is not Signup.REFUSED


def batch() -> str:
    return os.getenv(BATCH_ENV, "").strip()[:64]


#: A name a spreadsheet will *run*. CSV is the interchange format for every
#: table editor, and Excel and Google Sheets both execute a leading `=`, `+`,
#: `-` or `@` as a formula when the export is opened. The operator exports the
#: waitlist to invite from it, so a stranger's name is a thing they can hand
#: this operator's shell. Not a refactor of the leading space — a prefix, and
#: the same four characters the migration's CHECK refuses.
_NAME_FORMULA_RE = re.compile(r"\A[=+\-@\t\r]")


def _safe_name(name: str) -> str:
    """The name as stored, truncated and stripped of a formula prefix.

    An apostrophe is what both spreadsheets read as "this cell is text",
    so `=cmd|…` is stored as `'=cmd|…` and displays without it. It is not
    stripped rather than quoted because a visitor whose name genuinely
    begins with a dash should still see their own name in the export.
    """
    name = name[:NAME_MAX_CHARS]
    if _NAME_FORMULA_RE.match(name):
        name = "'" + name
    return name


def build_row(*, email: str, name: str = "", **extra) -> dict:
    """The row for one signup. Raises on anything it was not asked to store.

    **The boundary.** Named arguments, so widening the payload is a code change
    a test fails on rather than a dict comprehension somebody widens with the
    body of the request. The same shape decision as
    `begin_turn(ax_diff_chars: int)`.

    `name` is the one field the visitor typed that is not an address, and it is
    here for one reason: the operator invites these people by mail and cannot
    say their name without it. It is a display name, bounded at
    `NAME_MAX_CHARS` and neutralised for a spreadsheet — see `_safe_name` — and
    there is still no parameter for a referrer, a user agent, a URL or a note,
    which is the guarantee that matters, and which
    `test_the_row_cannot_carry_a_referrer_a_url_or_a_typed_field` holds.

    **The formula guard is here AND in the migration** (`005`'s CHECK). This is
    the path every caller goes through today; the constraint is what covers a
    row written by anything else — the table editor, a `psql` session, a future
    import — and a guard that only exists in one of two places is a guard that
    one rename removes.
    """
    if extra:
        raise ValueError(
            f"a waitlist row takes only {sorted(COLUMNS)}; got extra {sorted(extra)}"
        )
    return {"email": email, "name": _safe_name(name), "batch": batch()}


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


async def add(email: str, name: str = "") -> "Signup":
    """Write one row through the same PostgREST seam as the other two tables.

    Which of the three happened — written, already there, or refused. Never
    raises, and never returns anything about the address. The caller decides
    what a `Signup` means to the outside world; see the module docstring for
    why the one thing it must not mean is "this address was new".
    """
    from .jwt_auth import SupabaseUnavailable, _profiles

    row = build_row(email=email, name=name)
    try:
        status, _ = await _profiles("POST", "", row, path="rest/v1/waitlist")
    except SupabaseUnavailable:
        log.warning("waitlist insert: control plane unavailable")
        return Signup.REFUSED
    except Exception as exc:
        # The TYPE, never the message: a PostgREST body quotes the row, and the
        # row is the one field this whole module exists to keep small.
        log.warning("waitlist insert failed: %s", type(exc).__name__)
        return Signup.REFUSED
    if status == 409:
        # Already on the list. Answered exactly as a first submit is — the
        # duplicate is a success for the caller and a no-op for the table.
        return Signup.DUPLICATE
    if status >= 400:
        log.warning("waitlist insert answered %d", status)
        return Signup.REFUSED
    return Signup.CREATED