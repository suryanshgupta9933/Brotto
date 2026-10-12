-- The other half of what `005` did for `name`: `email` is guarded here for the
-- same reason, and it was left open while `name` was closed.
--
-- `EMAIL_RE` (`^[^@\s]{1,64}@[^@\s.]+(\.[^@\s.]+)+$`) admits a leading `=`, `+`
-- or `-`, so `+1+1@example.test` is a valid address as far as the form is
-- concerned and was stored as-is. Same table, same CSV export, same operator's
-- machine as the name that `005` stopped running.
--
-- A new file rather than an edit to `005`: migrations are immutable once
-- merged, and a database already created from `005` is what this has to reach.

-- An address a spreadsheet will *run*. CSV is the interchange format for every
-- table editor, and Excel and Google Sheets both execute a leading `=`, `+`,
-- `-` or `@` as a formula when the export is opened — so a stranger typing
-- `=cmd|…/c calc` into a public waitlist form is a thing the operator's own
-- machine executes, on the export they open to send invites from. Tab and CR
-- are here because a row may also have been written by some other tool.
--
-- Backfill first, then constrain: an existing row typed before this constraint
-- existed would otherwise fail the ADD and take the migration with it. An
-- address that begins with one of these characters is not one anybody is going
-- to recognise as their own, so there is nothing to salvage here.
--
-- Unlike `name`, the server **refuses** these rather than neutralising them,
-- and the two columns differ for a reason. A name is text we want back in the
-- export — prefixing it with an apostrophe costs nothing we lose. An email is
-- an identifier that has to round-trip: a stored address that no longer equals
-- the one that person signs in with is not an address, it is a typo with a
-- column name. `session/waitlist.py` raises instead, and this is the same rule
-- enforced where a row can arrive by other routes.
--
-- This class is **wider than anything the server can produce**, on purpose.
-- `EMAIL_RE`'s `[^@\s]` local part rules out `@`, tab and CR, so of the five
-- characters only `=`, `+` and `-` can actually lead — and of those only `+` is
-- a real address (`user+tag@` is fine; only the first character is read).
-- Widening past what is reachable is what covers a row written by the table
-- editor, a `psql` session or a future import, none of which pass through the
-- server at all. Same argument `005` makes for guarding in both places.
--
-- No `email is null or …` arm: the column is `not null`, and a guard for a
-- value the schema cannot hold is one more thing to keep true by hand.
update waitlist set email = '''' || email where email ~ '^[=+\-@\t\r]';

alter table waitlist
  add constraint waitlist_email_no_formula
  check (email !~ '^[=+\-@\t\r]');