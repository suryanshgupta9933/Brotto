-- One lookup, four answers: why this address cannot sign in.
--
-- Until now the sign-in route said one thing — "if you are in the beta, a code
-- is on its way" — and said it identically to a member and to a stranger,
-- because a reply that differs is an account-existence oracle on an
-- unauthenticated URL. That uniformity is still the route's rule and nothing
-- here loosens it: what the operator wants is for the *sign-in screen* to stop
-- telling somebody who was never admitted to go and check their inbox. Four
-- distinct answers, one round trip, one function to ask for them.
--
-- ── the four answers, and which one wins ─────────────────────────────────
--
--   'admitted'  the roster holds the address, never withdrawn
--   'revoked'   the roster holds the address, withdrawn
--   'pending'   no roster row, but the waitlist holds the address
--   'none'      neither table has it
--
-- **`beta_access` wins over `waitlist`, and a revoked member on the waitlist is
-- `revoked`.** The order of the `case` arms is that precedence and nothing
-- else: the revocation is the last thing *we* said about them, and a waitlist
-- row they submitted themselves cannot speak over a decision the operator
-- made. Reordering the arms reorders the policy.
--
-- **No normalisation function in SQL.** The two columns compared here are
-- stored already normalised — `lower(btrim())` at the write paths, see `004`'s
-- header — so this is a string equality and the caller normalises first, same
-- as everywhere else. A second implementation of the rule is a second thing to
-- keep in step with the first; `004` refuses one and so does this.
--
-- ── service role only, and the reason is the oracle itself ───────────────
--
-- A function `PUBLIC` can execute runs with the *caller's* privileges, so this
-- one is revoked from `public, anon, authenticated` exactly as
-- `redeem_sign_in_code` is in `007`. The reason is sharper here than there:
-- this function **is** the whole answer to "is this address in the beta", and
-- an executable one hands that answer to anybody holding the project URL and
-- the public anon key — the oracle the uniform reply exists to prevent,
-- restored as a SELECT. The relay calls it with the service role, which
-- bypasses RLS and is the only caller that should ever reach it.
--
-- `language sql` because it only reads: no write, no race, and the whole thing
-- is one statement. `set search_path = public` for the same reason `007`'s
-- function pins it — a search_path a caller could influence would be a
-- different `beta_access` than the one the roster writes.

create or replace function public.beta_status(addr text)
returns text
language sql
set search_path = public
as $$
  select case
    when exists (select 1 from beta_access
                  where email = addr and revoked_at is null)
      then 'admitted'
    when exists (select 1 from beta_access
                  where email = addr and revoked_at is not null)
      then 'revoked'
    when exists (select 1 from waitlist where email = addr)
      then 'pending'
    else 'none'
  end;
$$;

revoke all on function public.beta_status(text)
  from public, anon, authenticated;

-- ── `added_by` is gone ───────────────────────────────────────────────────
--
-- It recorded who pasted the row, which is an attribution nothing asked for
-- and no code path ever wrote: the server never touched it, and
-- `scripts/beta-roster.sh` filled it with `whoami` on a tool whose bulk paste
-- has no single author — which is exactly the case `004`'s own comment named
-- when it made the column nullable. A column that is wrong half the time and
-- empty the rest is worse than an absent one: the table editor shows it, and a
-- reader believes it. Dropped rather than left alone, because the operator
-- looked at it and said it makes no sense.
alter table beta_access drop column added_by;
