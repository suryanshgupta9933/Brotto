-- The sign-in code, once the relay mints it itself.
--
-- Until now this did not exist: `request_login_code` POSTed to Supabase's
-- `auth/v1/otp` and Supabase mailed *its own* template, which is how a beta
-- member received a Supabase-branded "Confirm your email address" mail with a
-- **localhost** link in it. Taking the code over is what removes that, and
-- this table is the whole of what the takeover adds: a code that exists
-- between being minted and being redeemed, and is gone the rest of the time.
--
-- **The code is never stored. A keyed digest of it is.** `code_hash` is a
-- 64-character lowercase hex string and the CHECK below makes that a property
-- of the schema rather than a rule somebody follows: a six-digit code cannot
-- satisfy the pattern, so a plaintext row is not something this table can be
-- talked into holding.
--
-- **Unkeyed would not be enough, and the size is why.** The space is 10^6.
-- A plain `sha256(code)` is a rainbow table of one line — six digits is
-- under a second of brute force against *any* digest an attacker can compute
-- without a secret, so a dump of this table would be a list of live codes
-- whether or not the column is called "hash". The digest therefore has to be
-- keyed with something the relay holds and a table dump does not, and the
-- caller picks the key; this migration pins the *output shape* (32 bytes,
-- hex, lower case) and says nothing about which secret produces it.
--
-- `email` is stored **already normalised** — `lower(btrim())`, which is
-- exactly what `normalize_email()` in `session/jwt_auth.py` does. That is the
-- same rule `profiles.email` (written from `normalize_email(claims.email)` at
-- `approve_at_exchange`) and `beta_access.email` (normalised by
-- `scripts/beta-roster.sh`) are stored under, and it is not a detail: the
-- redemption lookup below is a string equality, so the two spellings of one
-- inbox have to arrive as one value or a code mailed to `A@x.test` is
-- unredeemable by an address the panel sends as `a@x.test`. **No
-- normalisation function in SQL**, for the reason `004` gives — a second
-- implementation is a second thing to keep in step with the first.

create table sign_in_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  code_hash   text not null,
  -- The lifetime is a decision about how much of a mailed code stays useful,
  -- so it is supplied by the minting code and there is **no default here**:
  -- a `default now() + interval '…'` here would be a second place the TTL
  -- lives, and the two would disagree silently.
  expires_at  timestamptz not null,
  -- How many times somebody has tried to redeem this code, wrong or right.
  -- Counted in the database and not in the relay because the relay is a
  -- token bucket in the memory of one Heroku dyno: it resets on a restart and
  -- is one process behind a second one, so it is a courtesy to a person
  -- mistyping and not a bound on an attacker. The 10^6 space and an
  -- unauthenticated `POST /v1/auth/exchange` are what make the counter here
  -- load-bearing — see `redeem_sign_in_code` below.
  attempts    int     not null default 0,
  -- Single use, and the record that it was used. **Not a delete**: a row that
  -- vanished on redemption could not answer "was this code ever spent", and
  -- the answer to that is the difference between a user who mistypes a code
  -- five times and somebody working through the space.
  consumed_at timestamptz,
  -- `clock_timestamp()`, not `now()`, and the reason is this function below.
  -- `now()` is the *transaction* timestamp: two codes issued for one address
  -- in one transaction would tie, and the tie is broken by a random uuid, so
  -- "the newest row" would be a coin flip and the person who clicked *send
  -- again* would keep the code that no longer works. `clock_timestamp()` is
  -- the wall clock and advances inside a transaction, so the tie cannot happen
  -- in the one place it would be reachable.
  created_at  timestamptz not null default clock_timestamp(),

  -- A digest, not a code. See the header: the space is 10^6, so this is the
  -- line between "a dump is a list of live codes" and "a dump is a list of
  -- digests nobody holding it can check".
  constraint sign_in_codes_hash_is_a_digest
    check (code_hash ~ '^[0-9a-f]{64}$'),

  -- A code cannot be born expired. `created_at` defaults to the wall clock, so
  -- a `expires_at` already behind it is an arithmetic mistake at the minting
  -- end, and this refuses it there rather than handing back a row that looks
  -- redeemable and is not.
  constraint sign_in_codes_not_born_expired
    check (expires_at > created_at),

  -- `attempts` only ever moves by `+ 1` in `redeem_sign_in_code`; a negative
  -- value means a row was written by something other than that, and the one
  -- thing a counter is for is knowing how far along it is.
  constraint sign_in_codes_attempts_not_negative
    check (attempts >= 0)
);

-- The redemption lookup: newest live row for one address. The only query the
-- redeem function makes, and the index that answers it.
create index sign_in_codes_by_address on sign_in_codes (email, created_at desc);

-- ── nobody but the service role may touch this table ───────────────────
--
-- Same reasoning as `profiles`, and it is sharper here: this table holds the
-- raw material for signing in as anybody, so a SELECT is the whole attack —
-- with the project URL and the *public* anon key a reader takes any address
-- and any of its live codes. RLS with zero policies is deny-all, and the
-- relay reads and writes with the service role, which bypasses RLS by design.
alter table sign_in_codes enable row level security;
revoke all on sign_in_codes from anon;
revoke all on sign_in_codes from authenticated;

-- ── redeeming a code is one statement, not four ─────────────────────────
--
-- This is the `reserve_task_slot` argument from `001`, for the same reason and
-- with the same shape: the check and the write have to be under one lock, or
-- the guard is a race a parallel caller wins. Read-then-write here is not a
-- rare interleaving — an attacker guessing one code runs every guess
-- concurrently, and "five attempts, each of which read `attempts = 4` first"
-- is five attempts, not one.
--
-- So the **attempt is charged before it is judged**, in a single conditional
-- UPDATE whose predicate is the cap. The order is the design: a wrong code has
-- to cost the same as a right one, and a scheme that compares first and counts
-- afterwards is a scheme that never counts anything.
create or replace function public.redeem_sign_in_code(
  addr text, supplied_hash text, max_attempts int
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  charged_id   uuid;
  charged_hash text;
begin
  -- The newest unconsumed row for this address. **Oldest is not redeemable**:
  -- "send another" inserts a second row and the first stops working, so there
  -- is one live code per address and it is the last one issued. That is a
  -- deliberate choice over letting both work — two live codes per mailbox
  -- means the older one is worth 10^6 guesses too, and it is the one the
  -- person has most likely forgotten mailing.
  update sign_in_codes s
     set attempts = s.attempts + 1
   where s.id = (
           select id
             from sign_in_codes
            where email = addr
              and consumed_at is null
            order by created_at desc, id desc
            limit 1)
     and s.attempts < max_attempts
  returning s.id, s.code_hash into charged_id, charged_hash;

  if not found then
    -- No live code for this address, or this code's budget is gone. The two
    -- are one answer to the caller, exactly as a miss and an unreadable
    -- control plane are one answer to it everywhere else here.
    return false;
  end if;

  -- **Per address as well as per code**, and this is the half a single
  -- counter misses. Asking for another code is free and unauthenticated, so a
  -- per-code cap alone is a cap the attacker resets by pressing *send again*
  -- — N codes times 5 guesses each. The ceiling is applied again across the
  -- codes for this address that could still be redeemed, which makes the
  -- budget per mailbox rather than per mailed envelope. Restricted to live
  -- rows on purpose: an expired code's attempts are spent, and counting them
  -- would only refuse honest people who signed in last week.
  --
  -- **So five wrong guesses on one code, a click on *send another*, and the
  -- right code for the second one is refused — deliberately.** That is the
  -- same budget the relay already enforces in memory: `_signin_allowed` in
  -- `main.py` is five attempts per ten minutes per address, so a person this
  -- column turns away was turned away at the route anyway. Two limits that
  -- agree are one limit described twice; a limit here that were *looser* than
  -- the route's would be the one worth hearing about.
  if (select coalesce(sum(s.attempts), 0)
        from sign_in_codes s
       where s.email = addr
         and s.consumed_at is null
         and s.expires_at > now()) > max_attempts then
    return false;
  end if;

  -- Charged, and wrong. The digest comparison happens inside a service-role
  -- function and every failure above returns the same `false`, so there is no
  -- answer here that says which half was wrong; the attempt cap is the
  -- defence against the space, not the speed of a comparison.
  if charged_hash <> supplied_hash then
    return false;
  end if;

  update sign_in_codes set consumed_at = now() where id = charged_id;
  return true;
end;
$$;

-- Called by the relay's service role, which bypasses RLS; but a function
-- executable by `public` would run with the *caller's* privileges by default,
-- so revoke that explicitly rather than reasoning about it. **The
-- consequence of getting this wrong is the whole table**: anybody holding the
-- public anon key could call this with a guessed digest and burn a code, or
-- learn which address has one outstanding.
revoke all on function public.redeem_sign_in_code(text, text, int)
  from public, anon, authenticated;

-- ── nothing prunes this table ───────────────────────────────────────────
--
-- **No expiry job and no trigger.** The argument `profiles.week_start` makes
-- for resetting a counter on read, applied to a table whose rows are
-- small, whose count is bounded by sign-in attempts rather than by users, and
-- whose history is worth having. An operator who wants it gone runs
-- `delete from sign_in_codes where expires_at < now() - interval '30 days';`,
-- which is a statement that either happens or visibly did not — the opposite
-- of a cron that stops running.