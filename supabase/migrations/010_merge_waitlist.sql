-- One list, one row per address: who asked, who was granted, who was withdrawn.
--
-- `waitlist` and `beta_access` were two tables with the same key — a normalised
-- email — answering one question between them: where does this address stand in
-- the beta. `public.beta_status(addr)` read both and did the join in a `case`;
-- the relay's sign-in lookup read both and did it again in Python. Two tables,
-- two round trips, and a precedence rule that only existed because the answer
-- was assembled from two rows. The operator's rule is the usual one: a new
-- table needs a solid reason to modularise, and "an email and a timestamp" is
-- not one. Merged here, with the keys spelled out this time.
--
-- ── what a row means now ───────────────────────────────────────────────────
--
--   asked_at    when they asked (the waitlist half); null = never asked
--   approved_at when we granted; null = not granted. **No default** — see below
--   revoked_at  when we withdrew; null = never withdrawn. Wins over both above
--   name, batch the two fields the waitlist form actually asked for
--
-- `beta_status` is the same four answers, derived from one row instead of two:
--
--   'revoked'   revoked_at is not null
--   'admitted'  approved_at is not null
--   'pending'   asked_at is not null
--   'none'      no row
--
-- **A revoked address is `revoked` even if it also asked.** That was `009`'s
-- arm order — `beta_access` wins over `waitlist` — and it is now the order of
-- three `when` arms on one row. The policy did not change: the revocation is
-- the last thing *we* said about them, and a request they submitted themselves
-- cannot speak over a decision the operator made. Reordering the arms
-- reorders the policy.
--
-- ── the row is no longer the invitation; `approved_at` is ──────────────────
--
-- `004` said "a row IS the invitation", and that was true while a row could
-- only come from an operator paste. It is not true any more: a waitlist signup
-- is a row with `asked_at` and no `approved_at`, and it must not sign anybody
-- in. So the invitation moved to one column, and the three readers moved with
-- it — `_listed_for_beta` and `beta_status` now ask for `approved_at`, not for
-- existence. **A lookup that still treats "row exists" as "admitted" hands
-- every waitlist signup a beta account.** That is the one change here that is
-- load-bearing, and it is in the caller rather than in this file.
--
-- ── `approved_at` has no default, and that is the guard ────────────────────
--
-- `004` gave it `default now()`, which was right when the only writer was an
-- operator paste. It is wrong now: the waitlist write path inserts a row and
-- does not name the column, so a default would **grant the beta to every
-- stranger who asked for it**. There is no default, so an insert that omits
-- `approved_at` writes a request and not a grant. The cost lands on the
-- operator's side and is small: `beta-roster.sh add` sets it, and a bulk paste
-- has to fill the column — which the CHECK below makes loud rather than
-- silent. A default is a grant; the absence of one is the refusal.
--
-- **The oracle did not move.** `004` kept the two tables disjoint because
-- anything that turns a waitlist submission into an admission without a human
-- deciding answers "is this person in the beta?" on a route with no
-- credential. That property is now a column rule rather than a table rule: the
-- waitlist write path may set `asked_at`, `name` and `batch` and never
-- `approved_at` or `revoked_at`, and those two are written by
-- `beta-roster.sh` alone. Same boundary, same reason, one table instead of two.
-- A stranger's row becoming an invitation by pipeline is still the bug, and it
-- is still closed — by the columns the unauthenticated path is allowed to name.
--
-- ── keys ──────────────────────────────────────────────────────────────────
--
-- `email` is the primary key, as it was on `beta_access`. `waitlist`'s
-- surrogate `id` goes with the table: nothing read it, and the address is the
-- natural key — a second paste is a 409 whether the row is a request or a
-- grant, and a 409 is the answer for "already here".
--
-- **No foreign keys, and each absence is a decision.** `profiles.id` is an
-- `auth.users` uuid and this table is keyed by address; `004` already refuses
-- the join in the other direction, because `revoked_at` has to outlive the
-- account it was recorded against. `sign_in_codes.email` looks like a
-- reference and is not one: codes are never pruned, so an FK would make the
-- optional `drop` of a roster row start failing as soon as a few codes have
-- been minted, and `007` deliberately lets a code outlive the roster.
-- `sign_in_events.owner` is not an FK by `008`'s own argument. A relationship
-- we do not have is worse than no relationship, because the next reader
-- trusts it.
--
-- What is added is what a merge needs: the formula guards `005` and `006` put
-- on `waitlist` follow the columns onto this table (renamed for the table they
-- now protect — it is the same guard), a CHECK that a row records at least one
-- event, and the batch index. The source table already carried the formula
-- constraints, so every value copied here is clean and there is **no backfill
-- to run** — unlike `005`/`006`, which had to repair rows that predated the
-- constraint they were adding.
--
-- **No normalisation function in SQL.** `email` arrives already normalised
-- from `lower(btrim())` at the write paths, exactly as `004`'s header
-- requires; a second implementation here would be a second thing to keep in
-- step with the first.

-- The invitation is a column now, so it cannot be born filled. Both halves go
-- in one ALTER: the not-null and the default are the same mistake seen from
-- two sides, and a migration that dropped only one of them would leave the
-- other one granting.
alter table beta_access
  alter column approved_at drop not null,
  alter column approved_at drop default;

alter table beta_access
  add column name     text,
  add column batch    text not null default '',
  add column asked_at timestamptz;

-- The two tables meet. Where one address is in both — a member who also asked
-- — the decision columns already on `beta_access` are left alone and only the
-- request columns are filled in, so this statement cannot grant or withdraw
-- anything. `on conflict` rather than a read-then-insert: the dedupe is the
-- primary key, and a race between two writes is not a thing a migration has
-- to survive but a `select` first is still the wrong shape to copy.
insert into beta_access (email, name, batch, asked_at)
select email, name, batch, created_at
  from waitlist
on conflict (email) do update
  set name     = excluded.name,
      batch    = excluded.batch,
      asked_at = excluded.asked_at;

drop table waitlist;

-- The same guards `005` and `006` put on the table these columns just left.
-- CSV is how the operator gets the list out, and Excel and Sheets *run* a
-- leading `=`, `+`, `-` or `@` when they open one. The name is quoted by the
-- caller and the email is refused there; this is what covers a row written by
-- any other path — the table editor, a `psql` session, a future import.
alter table beta_access
  add constraint beta_access_name_no_formula
    check (name is null or name !~ '^[=+\-@\t\r]'),
  add constraint beta_access_email_no_formula
    check (email !~ '^[=+\-@\t\r]');

-- A row records at least one event. A paste that fills none of the three is a
-- mistake, and a row that is neither a request nor a grant nor a withdrawal
-- reads as a correct row forever.
alter table beta_access
  add constraint beta_access_says_something
    check (asked_at is not null
        or approved_at is not null
        or revoked_at is not null);

-- "Which batch did this go out in", same question as before, newest first.
create index beta_access_by_batch on beta_access (batch, asked_at desc);

-- One lookup, four answers, one row. `create or replace` keeps the signature,
-- so the relay's call site does not move; what changes is that the join the
-- `case` used to do is gone and the arm order below *is* the precedence
-- policy — revoked first, because it is the last thing we said.
--
-- `set search_path = public` and the revoke are `007`'s and `009`'s unchanged:
-- a search_path a caller could influence would be a different `beta_access`
-- than the one the roster writes, and a function `PUBLIC` can execute runs
-- with the *caller's* privileges — so this one is the whole answer to "is
-- this address in the beta" handed to anybody holding the project URL and the
-- public anon key, which is the oracle the uniform sign-in reply exists to
-- prevent, restored as a SELECT.
create or replace function public.beta_status(addr text)
returns text
language sql
set search_path = public
as $$
  select coalesce(
    (select case
       when revoked_at  is not null then 'revoked'
       when approved_at is not null then 'admitted'
       when asked_at    is not null then 'pending'
     end
     from beta_access
     where email = addr),
    'none');
$$;

revoke all on function public.beta_status(text)
  from public, anon, authenticated;
