"""`beta_access`: the allowlist's shape, and the guard that keeps it private.

A migration file is imported by nothing, so nothing in the Python asserts
these lines — same reasoning as `test_the_waitlist_is_closed_to_the_public_key`
in `test_waitlist.py`. A guard with no test asserting it is the same as no
guard, so the deny-all posture of `004` is pinned here rather than trusted.
"""
from __future__ import annotations

from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[3] / "supabase" / "migrations"


def _sql(name: str) -> str:
    """The statements, with the `--` prose stripped.

    These assertions are about schema, so a word that happens to appear in a
    comment ("a named processor", "created_at" written about a row) must not
    decide one. Comments explain *why*; the SQL below them is what ships.
    """
    return "\n".join(
        line for line in (MIGRATIONS / name).read_text().lower().splitlines()
        if not line.lstrip().startswith("--")
    )


# ── the migration ─────────────────────────────────────────────────────────

def test_the_allowlist_is_closed_to_the_public_key():
    """RLS with no policy is deny-all; the revokes say so out loud.

    With write access, anyone holding the project URL and the public anon key
    appends their own address and walks into the beta.
    """
    sql = _sql("004_beta_access.sql")
    assert "alter table beta_access enable row level security" in sql
    assert "revoke all on beta_access from anon" in sql
    assert "revoke all on beta_access from authenticated" in sql
    assert "create policy" not in sql


def test_a_row_is_an_email_and_nothing_else():
    """A second paste is a no-op, so the key is the address itself.

    `added_by` once sat beside `approved_at` here and is gone — `009` drops it,
    and that migration is what pins the absence. What remains is the address,
    when it was approved, and when it was withdrawn.
    """
    sql = _sql("004_beta_access.sql")
    assert "email" in sql
    assert "primary key" in sql
    assert "approved_at" in sql
    # No identity column to forge: the match is the JWT claim, not a row that
    # says who somebody is.
    assert "owner" not in sql
    assert "references auth.users" not in sql
    # A normalisation function in SQL would be a second implementation of the
    # caller's rule, and a second thing to keep in step with it.
    assert "lower(" not in sql
    assert "create function" not in sql


def test_the_waitlist_write_path_cannot_grant_the_beta():
    """The oracle, and `010` moved it from a table rule to a column rule.

    `004` kept `beta_access` and `waitlist` disjoint so that nothing could turn
    a `POST /v1/waitlist` submission — the one route reachable with no
    credential at all — into an admission without a human deciding. `010` merged
    the two tables, so the boundary is now which columns the unauthenticated
    write path may name: `asked_at`, `name`, `batch`, and never `approved_at` or
    `revoked_at`. Two properties make that safe and both are asserted here:
    `approved_at` carries **no default** (an insert that omits it writes a
    request, not a grant) and the row is allowed to record only a request.

    A default back on `approved_at` is the whole attack: the waitlist insert
    omits the column, so every stranger who asked would be admitted.
    """
    sql = _sql("010_merge_waitlist.sql")
    assert "alter column approved_at drop not null" in sql
    assert "alter column approved_at drop default" in sql
    # A row that is neither a request nor a grant nor a withdrawal is refused.
    assert "beta_access_says_something" in sql
    assert "asked_at is not null" in sql


def test_the_merge_leaves_the_decision_columns_alone():
    """A row already on the roster must keep its grant and its withdrawal.

    The copy fills the request columns and touches nothing else, so an address
    in both tables — a member who also asked — is one row that is still
    `revoked` or still `admitted`, and never a row the merge re-admitted.
    """
    sql = _sql("010_merge_waitlist.sql")
    assert "drop table waitlist" in sql
    # The upsert's SET list is the whole of what it may write.
    upsert = sql.split("on conflict (email) do update")[1].split("drop table")[0]
    for forbidden in ("approved_at", "revoked_at"):
        assert f"set {forbidden}" not in upsert
        assert f"{forbidden} = " not in upsert


def test_the_formula_guards_followed_the_columns():
    """`005` and `006` guarded `waitlist`; the merge must not drop them.

    Same rules, renamed for the table they now protect. A guard that exists in
    only one of two places is a guard one rename removes.
    """
    sql = _sql("010_merge_waitlist.sql")
    assert "beta_access_name_no_formula" in sql
    assert "beta_access_email_no_formula" in sql
    assert "check (name is null or name !~ '^[=+\\-@\\t\\r]')" in sql
    assert "check (email !~ '^[=+\\-@\\t\\r]')" in sql


# ── the waitlist name column ──────────────────────────────────────────────

def test_the_waitlist_gains_a_name_and_nothing_else():
    """Nullable, so a blank field stays absent rather than becoming a string
    the visitor never sent."""
    sql = _sql("005_waitlist_name.sql")
    assert "alter table waitlist add column name text" in sql
    assert "not null" not in sql
    assert "default" not in sql


def test_the_waitlist_name_is_a_new_file_and_not_an_edit_to_003():
    """Migrations are immutable once merged; a database already built from
    `003` is what `005` has to reach."""
    assert "add column" not in _sql("003_waitlist.sql")
    assert "name" not in _sql("003_waitlist.sql")


def test_the_waitlist_name_cannot_carry_a_formula():
    """CSV is how the operator gets the table out, and Excel and Sheets run
    a leading `=`, `+`, `-` or `@` when they open one.

    `build_row` quotes those four characters, and the constraint is what
    covers a row written by any *other* path — the table editor, a `psql`
    session, a future import. Both halves, or the guard is a rename away
    from gone.
    """
    sql = _sql("005_waitlist_name.sql")
    assert "check (name is null or name !~ '^[=+\\-@\\t\\r]')" in sql
    assert "waitlist_name_no_formula" in sql
    # And the backfill, because ADD CONSTRAINT scans the table: a row typed
    # before this constraint existed would fail the ADD and take the whole
    # migration — including the column — down with it.
    assert "update waitlist set name" in sql