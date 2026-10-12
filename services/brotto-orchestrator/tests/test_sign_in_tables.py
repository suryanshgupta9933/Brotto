"""The relay's own sign-in code (`007`), the sign-in log (`008`), and `009`.

Three migrations around one change: Supabase used to mail the code and hold
the account, and now the relay mails it, so there is somewhere to put a code
and somewhere to record that somebody signed in. `009` adds the single lookup
that classifies an address into the four answers the sign-in screen gives, and
drops `added_by` from `beta_access`.

A migration file is imported by nothing, so nothing in the Python asserts
these lines — the same reasoning as `test_the_waitlist_is_closed_to_the_public_key`
in `test_waitlist.py`. The behaviour is settled for real against a database in
`scripts/test-migrations.sh`; what is pinned here is the handful of properties
a **comment can claim and only the SQL settles**, and which a later commit
would otherwise remove without a failing test.

The two that matter most are absences, and both are the reason these tables
are shaped this way:

* **a code is never stored**, so `code_hash` cannot hold one and there is no
  column that could;
* **sign-in history is not a cascade**, so deleting an account does not erase
  the record that it was ever used.

`009` contributes a third: **`beta_status` is not executable by a caller**,
because it is the whole answer to "is this address in the beta" and an
executable one hands that to the public anon key.
"""
from __future__ import annotations

from pathlib import Path

from brotto_orchestrator.session.jwt_auth import normalize_email

MIGRATIONS = Path(__file__).resolve().parents[3] / "supabase" / "migrations"
CODES = "007_sign_in_codes.sql"
EVENTS = "008_sign_in_events.sql"
STATUS = "009_beta_status.sql"


def _sql(name: str) -> str:
    """The statements, with the `--` prose stripped.

    Same helper as `test_beta_access.py`: these assertions are about schema, so
    a word that appears only in a comment must not decide one. Comments explain
    *why*; the SQL below them is what ships.
    """
    return "\n".join(
        line for line in (MIGRATIONS / name).read_text().lower().splitlines()
        if not line.lstrip().startswith("--")
    )


def _raw(name: str) -> str:
    """The whole file, comments included. For assertions about prose."""
    return (MIGRATIONS / name).read_text().lower()


# ── 007: the code ─────────────────────────────────────────────────────────

def test_a_sign_in_code_is_not_readable_with_the_public_key():
    """RLS with no policy is deny-all, and the revokes say so out loud.

    Sharper here than on any other table: this one holds the raw material for
    signing in as anybody, so a `SELECT` is the whole attack.
    """
    sql = _sql(CODES)
    assert "alter table sign_in_codes enable row level security" in sql
    assert "revoke all on sign_in_codes from anon" in sql
    assert "revoke all on sign_in_codes from authenticated" in sql
    assert "create policy" not in sql


def test_the_redeem_function_is_not_executable_by_a_caller():
    """A function `PUBLIC` can execute runs with the *caller's* privileges.

    So this one is as sensitive as the codes behind it: reachable, an attacker
    burns any address's attempt budget on demand, which is the guard against
    the 10^6 space turned into a 10^6 request budget.
    """
    sql = _sql(CODES)
    assert "revoke all on function public.redeem_sign_in_code(text, text, int)" in sql
    assert "from public, anon, authenticated" in sql


def test_the_column_cannot_hold_a_code():
    """The digest shape, in the schema rather than in a caller's discipline.

    A six-digit code cannot satisfy `^[0-9a-f]{64}$`, so a plaintext row is
    not something this table can be talked into holding. And there is no second
    column an un-hashed copy could sit in.
    """
    sql = _sql(CODES)
    assert "code_hash" in sql
    assert "code_hash ~ '^[0-9a-f]{64}$'" in sql
    assert " code " not in sql, "a column literally named `code` is a plaintext code"


def test_a_code_is_issued_to_an_address_that_need_not_have_an_account():
    """The code is minted before any account exists.

    `request_login_code` stores a row for an address with no `auth.users`
    entry; the account is created later, at `exchange`, once inbox control
    is proved. A foreign key from the code to the account would refuse to
    store the code that creates the account.
    """
    assert "references auth.users" not in _sql(CODES)


def test_sending_another_code_does_not_need_the_old_row_deleted():
    """No unique constraint on the address, deliberately.

    A `unique` would make "send another" an upsert, and an upsert needs the
    writer to name a conflict target — while the row it would overwrite is the
    only record that the earlier code was ever issued.
    """
    assert "unique" not in _sql(CODES)


def test_the_address_is_normalised_by_one_rule_and_not_two():
    """The stored address must equal what `normalize_email()` produces.

    The redemption lookup is a string equality, so a code mailed to
    `A@x.test` is unredeemable by the `a@x.test` the panel sends unless both
    spellings arrive as one value. There is deliberately **no normalisation
    function in SQL** — `004` makes the same argument — so the rule lives in
    exactly one place, and this is that place.
    """
    assert normalize_email("  Beta@Example.TEST \n") == "beta@example.test"
    sql = _sql(CODES)
    assert "lower(" not in sql
    assert "btrim(" not in sql


def test_the_attempt_is_charged_before_it_is_judged():
    """The ordering is the whole brute-force guard.

    If the digest were compared before the counter moved, a wrong guess would
    cost nothing and the count would only ever rise on success — which is a
    counter that never bounds anything. Asserted as an ordering, not as
    arithmetic: the arithmetic is settled for real in `test-migrations.sh`.
    """
    body = _sql(CODES)
    charge = body.index("set attempts = s.attempts + 1")
    judge = body.index("charged_hash <> supplied_hash")
    assert charge < judge


def test_the_consumed_code_is_not_deleted():
    """`consumed_at`, not a delete.

    A row that vanished on redemption could not answer "was this code ever
    spent", and that is the difference between somebody who mistyped a code
    and somebody working through the space.
    """
    assert "consumed_at" in _sql(CODES)
    assert "delete" not in _sql(CODES)


# ── 008: the sign-in event ────────────────────────────────────────────────

def test_sign_in_events_is_closed_to_the_public_key():
    """Same posture, sharper reason: this is a sign-in log.

    With read access, the project URL and the public anon key — a pair
    Supabase designs to be public — are a directory of who uses the beta, from
    where, and on what.
    """
    sql = _sql(EVENTS)
    assert "alter table sign_in_events enable row level security" in sql
    assert "revoke all on sign_in_events from anon" in sql
    assert "revoke all on sign_in_events from authenticated" in sql
    assert "create policy" not in sql


def test_sign_in_history_is_not_a_cascade():
    """The account may be deleted; the record of its use may not.

    `failure_reports.owner` cascades, and that is right there — a report is
    about a run, and the account is its subject. This table is a record of
    *access*, and a cascade means the one act an intrusion would follow an
    account theft with is the act that removes the evidence of it.
    """
    sql = _sql(EVENTS)
    assert "references auth.users" not in sql
    assert "on delete cascade" not in sql


def test_the_address_is_stored_as_a_network_and_not_as_a_host():
    """`cidr`, and a CHECK that pins the mask exactly.

    `cidr` alone would not be enough — a bare address is a *valid* `cidr` and
    is stored as `/32` — so the guarantee is the pair, and `test-migrations.sh`
    asserts both halves against a real database. This pins the types, which is
    what a reviewer reads.
    """
    sql = _sql(EVENTS)
    assert "ip" in sql and "cidr" in sql
    assert "inet" not in sql, "`inet` stores the full address the table is not keeping"
    assert "masklen(ip) = 24" in sql
    assert "masklen(ip) = 48" in sql


def test_nothing_retires_the_rows_and_nothing_claims_to():
    """No retention column, no trigger, no scheduled job.

    A `expires_at` nothing reads is the database promising on the operator's
    behalf, and a cron that stops running fails quietly — which is the whole
    argument `profiles.week_start` is built on. The rows stay until somebody
    runs a `delete`.
    """
    sql = _sql(EVENTS)
    for forbidden in ("expires_at", "deleted_at", "retention", "trigger", "cron", "schedule"):
        assert forbidden not in sql, f"{forbidden!r} is a promise nothing keeps"


def test_the_row_is_a_sign_in_and_not_a_survey():
    """The absence that matters, in the shape `test_waitlist.py` pins.

    There is nowhere to put a task, a page, a URL, a session or a title — not
    because they are filtered out, but because no column exists for them. This
    is the first table here holding personal data, so it is the one where a
    column added without a reason written down would do real harm.
    """
    sql = _sql(EVENTS)
    for forbidden in ("task", "url", "session", "prompt", "page", "domain", "title"):
        assert forbidden not in sql, f"{forbidden!r} has a column now"


def test_the_file_says_why_the_rows_outlive_the_account():
    """The absence is only safe while the reason is written down.

    `004`'s `beta_access.revoked_at` and `002`'s cascade pull in opposite
    directions, and the next reader of this file needs the argument, not just
    the shape — otherwise "add the foreign key for consistency" looks tidier
    than it is.
    """
    prose = _raw(EVENTS)
    assert "not a foreign key" in prose
    assert "erasure request" in prose


# ── 009: the classification ──────────────────────────────────────────────

def test_beta_status_is_not_executable_by_a_caller():
    """A function `PUBLIC` can execute runs with the *caller's* privileges.

    Sharper here than on `redeem_sign_in_code`: that one burns an attempt
    budget, and this one **is** the answer to "is this address in the beta" —
    the oracle the uniform sign-in reply exists to prevent, restored as a
    SELECT. The relay calls it with the service role and nothing else may.
    """
    sql = _sql(STATUS)
    assert "revoke all on function public.beta_status(text)" in sql
    assert "from public, anon, authenticated" in sql


def test_beta_status_has_exactly_four_answers():
    """The screen says one of four things, so the schema offers one of four.

    Asserted as the literals rather than as a type: a fifth arm, or one of
    these renamed, is what the panel will render and what a caller switch will
    match on.
    """
    sql = _sql(STATUS)
    for answer in ("'admitted'", "'revoked'", "'pending'", "'none'"):
        assert answer in sql, f"beta_status lost the answer {answer}"


def test_a_revocation_is_not_spoken_over_by_the_waitlist():
    """`beta_access` wins over `waitlist`, in the order of the `case` arms.

    A revoked member who is also on the waitlist is `revoked`, not `pending`:
    the revocation is the last thing *we* said about them, and a waitlist row
    they submitted themselves cannot speak over a decision the operator made.
    Asserted as ordering, because a `case` reordered to put the waitlist arm
    first passes every single-table assertion and still answers wrong here.
    """
    body = _sql(STATUS)
    admitted = body.index("'admitted'")
    revoked = body.index("'revoked'")
    pending = body.index("'pending'")
    assert admitted < revoked < pending


def test_the_classification_does_not_normalise():
    """The caller normalises, same as every other write path.

    The columns compared here are stored already normalised (`lower(btrim())`
    at the write paths — `004`'s header), so this is a string equality. A
    normalisation function in SQL would be a second implementation of the
    caller's rule and a second thing to keep in step with the first; `004`
    refuses one and so does this.
    """
    sql = _sql(STATUS)
    assert "lower(" not in sql
    assert "btrim(" not in sql


def test_the_classification_is_a_read():
    """`language sql`, and nothing that writes.

    No write means no race, which is why this is not the `reserve_task_slot`
    shape from `001`: two callers asking what an address is cannot interfere,
    and a function that looked like it might write would be a function a
    reviewer has to reason about for no benefit.
    """
    sql = _sql(STATUS)
    assert "language sql" in sql
    for forbidden in ("insert", "update", "delete"):
        assert forbidden not in sql, f"{forbidden!r} in a function that only classifies"


def test_added_by_is_dropped():
    """An operator identity nothing writes is a column the table editor shows
    and a reader believes.

    `004` made it nullable because a bulk paste has no single author, which
    was already the answer: there is no honest value for it. Dropped in a new
    migration rather than by editing `004`, which merged databases already
    have.
    """
    sql = _sql(STATUS)
    assert "alter table beta_access drop column added_by" in sql