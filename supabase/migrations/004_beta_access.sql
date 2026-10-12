-- The addresses allowed to be in the beta, pasted in by the operator.
--
-- **A row IS the invitation**, exactly as in `profiles`: there is no invited
-- flag and no batch of pending requests, and the absence of a row is the
-- refusal. This is the same control plane, entered by the address rather than
-- by the account id, so an operator can bulk-paste a list instead of minting
-- one `auth.users` row per person by hand.
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
  added_by    text
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