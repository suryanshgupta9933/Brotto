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

-- A name a spreadsheet will *run*. CSV is the interchange format for every
-- table editor, and Excel and Google Sheets both execute a leading `=`, `+`,
-- `-` or `@` as a formula when the export is opened — so a stranger typing
-- `=cmd|…/c calc` into a public waitlist form is a thing the operator's own
-- machine executes, on the export they open to send invites from. Tab and CR
-- are here because a name may also be the *second* column of a row some other
-- tool wrote.
--
-- `build_row` neutralises the same four characters with a leading apostrophe,
-- which is what both spreadsheets read as "text, not formula". Both halves are
-- deliberate: this constraint is what covers a row written by any path other
-- than the server's — the table editor, a `psql` session, a future import —
-- and a guard that exists in only one of two places is a guard that one rename
-- removes.
--
-- Backfill first, then constrain: an existing row typed before this constraint
-- existed would otherwise fail the ADD and take the migration with it. A name
-- that begins with one of these four characters is not a name anybody is going
-- to recognise as their own, so there is nothing to salvage here.
update waitlist set name = '''' || name where name ~ '^[=+\-@\t\r]';

alter table waitlist
  add constraint waitlist_name_no_formula
  check (name is null or name !~ '^[=+\-@\t\r]');