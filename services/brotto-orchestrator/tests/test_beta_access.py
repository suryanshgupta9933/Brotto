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
    """A second paste is a no-op, so the key is the address itself."""
    sql = _sql("004_beta_access.sql")
    assert "email" in sql
    assert "primary key" in sql
    assert "approved_at" in sql and "added_by" in sql
    # No identity column to forge: the match is the JWT claim, not a row that
    # says who somebody is.
    assert "owner" not in sql
    assert "references auth.users" not in sql
    # A normalisation function in SQL would be a second implementation of the
    # caller's rule, and a second thing to keep in step with it.
    assert "lower(" not in sql
    assert "create function" not in sql


def test_the_allowlist_and_the_waitlist_stay_separate_tables():
    """The oracle. Auto-copying a waitlist row here would let anyone ask
    `POST /v1/waitlist` "is this address in the beta?" — the one route that is
    reachable with no credential at all.
    """
    beta = _sql("004_beta_access.sql")
    # A submission arriving by itself: a batch label and a creation time are
    # how a waitlist row carries itself, and neither belongs on an allowlist
    # row a human wrote.
    assert "batch" not in beta
    assert "created_at" not in beta
    # And no second table: this file creates one table and only one.
    assert beta.count("create table") == 1
