-- The addresses allowed to be in the beta, pasted in by the operator.
--
-- **A row IS the invitation**, exactly as in `profiles`: there is no invited
-- flag and no batch of pending requests. This is the same control plane,
-- entered by the address rather than by the account id, so an operator can
-- bulk-paste a list instead of minting one `auth.users` row per person by hand.
--
-- ── the withdrawal, and the step that used to be half of it ──────────────
--
-- **To withdraw a member, run one statement:**
--
--   update beta_access set revoked_at = now() where email = '<address>';
--
-- That is the withdrawal. It is one statement, it takes effect at their next
-- sign-in, and **it survives the auth account being deleted** — which is why
-- it is here and not only on `profiles`.
--
-- **Why it cannot live on `profiles` alone.** `profiles.id` references
-- `auth.users` on delete cascade, so deleting the auth account deletes the
-- profile *and its `revoked_at` with it*. They sign up again, the roster still
-- holds the address, and `approve_at_exchange` inserts a fresh, unrevoked
-- `profiles` row. Revocation was never durable, and the cascade walks straight
-- around the insert-if-absent that exists to stop a withdrawn member
-- reinstating themselves. The evidence has to outlive the account it was
-- recorded against, so `revoked_at` here is **not a foreign key and must never
-- become one.**
--
-- **Absence of a row is still the refusal for somebody not admitted yet.**
-- `_listed_for_beta` refuses an address that is absent *or* that has
-- `revoked_at` set, so deleting the roster row after withdrawing closes the
-- door for good rather than re-opening it — the difference is that deleting
-- alone withdraws nobody. Withdraw first; deleting the row is optional
-- housekeeping.
--
-- **Do the `profiles` write alongside it, and it is not sufficient on its
-- own.** `update profiles set revoked_at = now() where email = '<address>'` is
-- what `authorize_task_start` actually reads at task start, so without it a
-- member who is already signed in keeps working until their next sign-in. It
-- is also **the only one of the two writes a cascade can erase**, which is
-- exactly why it cannot be the whole procedure. Two statements, in this order:
--   1. update beta_access  set revoked_at = now() where email = '<address>'
--   2. update profiles     set revoked_at = now() where email = '<address>'
--
-- No `AFTER DELETE` trigger ties them: a trigger fires on a *delete*, and a
-- withdrawal is an `UPDATE` that deliberately leaves its evidence in place.
--
-- `email` is the primary key, which is what makes a second paste a no-op: a
-- duplicate arrives as a 409 and is the operator's confirmation that the
-- address was already in, not an error to retry. It is stored **already
-- normalised** — the caller strips and lower-cases before the insert, so the
-- key compares one spelling of an address with itself. There is no
-- normalisation function here on purpose: the same rule is applied by the
-- waitlist write, and a second implementation in SQL is a second thing to keep
-- in step with the first.
--
-- The address is matched against the **`email` claim on a verified JWT**, never
-- against a body field, a query parameter or anything else a caller sent — the
-- same rule the `profiles` lookup obeys at task start, and the reason this
-- table has no `owner` column to be forged.
--
-- **This table must stay disjoint from `waitlist`.** `POST /v1/waitlist` is the
-- one route reachable with no credential at all, so anything that copies a
-- waitlist submission into here without a human in the loop turns that route
-- into an oracle: submit an address, and whether you are let into the beta
-- answers *is this person already in it*. The founder pasting a list is a
-- decision; a pipeline moving strangers' rows is that decision made by
-- everybody.
--
-- Beside `profiles` rather than in a fourth place, for the reason the other two
-- are: Supabase is already a named processor, and its table editor exports to
-- CSV, which is what an allowlist is read with.

create table beta_access (
  email       text primary key,
  approved_at timestamptz not null default now(),
  -- Who put it there. Nullable, because a bulk paste arrives with no single
  -- author and an empty string is a worse answer than an absent one. It is
  -- the operator's identifier — never the address's.
  added_by    text,
  -- The withdrawal, and the only durable record of one. Nullable with no
  -- default because a new row is always a *grant*: there is nothing to
  -- backfill, and a `default now()` would revoke every roster row on the day
  -- the column was added. null = never withdrawn.
  --
  -- Deliberately **not** a foreign key and never to become one — `profiles`
  -- is `on delete cascade` from `auth.users`, and a revocation that a deleted
  -- account takes with it is not a revocation. See the header.
  revoked_at  timestamptz
);

-- ── nobody but the service role may touch this table ───────────────────
--
-- Same reasoning as `profiles`, and it is sharper here: this table is the
-- front door of the hosted relay, so with write access anyone holding the
-- project URL and the *public* anon key could append their own address and
-- walk themselves into the beta. RLS with zero policies is deny-all, and the
-- relay reads and writes with the service role, which bypasses RLS by design.
alter table beta_access enable row level security;
revoke all on beta_access from anon;
revoke all on beta_access from authenticated;