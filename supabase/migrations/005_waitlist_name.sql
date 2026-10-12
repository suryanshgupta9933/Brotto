-- A name on the waitlist form, so a reply can address a person.
--
-- Nullable and no default: a visitor who leaves it blank is a stranger who
-- filled in what the form asked for, and inventing a placeholder would store
-- something they never said. Existing rows are untouched and stay null.
--
-- Nothing else widens. `waitlist` stores the field the form asked for and
-- nothing derived from it — no referrer, no user agent, no URL — and a name is
-- user content, so the caller owns the two rules that make that safe:
-- `session/waitlist.py`'s `build_row` still **raises** on an unrecognised
-- keyword rather than dropping it, so a field nobody wrote a reason for is a
-- code change this suite fails on.
--
-- A new file rather than an edit to `003`: migrations are immutable once
-- merged, and a database already created from `003` is what this has to reach.

alter table waitlist add column name text;