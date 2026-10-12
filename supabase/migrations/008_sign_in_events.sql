-- One row per successful sign-in, so the operator can see a beta member
-- arriving from somewhere they have not been before.
--
-- **This is personal data, and it is the first table in this project that
-- holds any.** The other four answer an operational question about a person
-- who already holds a credential: is the account admitted, has it been
-- withdrawn, did the run happen, who asked for the beta, when was a code
-- sent. This one records a person *doing something* — signing in, from a
-- network, with a browser — which is a shape the published policy did not
-- describe: `/closed-beta` and `docs/architecture/privacy.md` both say the
-- only thing kept about a failed run is a reason code and an account id. The
-- policy text is being amended in the same change. **The amendment is the
-- other half of this migration** — a table nobody told the user about is the
-- surveillance posture rule 1 of `privacy.md` forbids, whatever the column
-- names say.
--
-- One row per **successful** `POST /v1/auth/exchange`. Not per attempt, and
-- not per request for a code: a failed guess is not a sign-in, and counting
-- those would be counting somebody failing at something they are allowed to
-- do. The row is written after the exchange has answered, so the endpoint's
-- answer never waits on the write and a control-plane failure cannot turn a
-- successful sign-in into an error.

create table sign_in_events (
  id         uuid primary key default gen_random_uuid(),
  -- The account the sign-in was for, read off the verified token — never off
  -- the body, which is caller-supplied, exactly as `failure_reports.owner` is.
  --
  -- **Deliberately not a foreign key, and it must never become one.**
  -- `failure_reports.owner` is `references auth.users on delete cascade`, and
  -- the opposite choice is right there: a failure report is about a run that
  -- happened, and the account is the subject of it, so the account's own
  -- deletion takes it. This table is a *record of access*, and the reason it
  -- exists is to answer "who signed in, from where, when" — including about a
  -- period during which the account did not exist or was not being watched. A
  -- cascade here means the record of every sign-in a member ever made is
  -- erased by that member deleting their account: the one act an intrusion
  -- would follow an account theft with is the act that removes the evidence of
  -- the theft. `beta_access.revoked_at` reaches the same conclusion from the
  -- other direction for the same reason — see the note there.
  --
  -- The cost of no FK is that the column can hold an id with no account, which
  -- is precisely the case that matters: after the account is gone this row is
  -- still the answer. `uuid` is the type, so it cannot hold anything that is
  -- not an account id at all.
  owner      uuid not null,
  -- The peer, truncated to a **network** rather than a host — see the type
  -- comment below. Nullable because the honest value is often nothing: a
  -- self-host or a relay behind a proxy that forwards no `X-Forwarded-For`
  -- has no peer, and storing an empty string as though it were an address
  -- would be a row that says "somewhere" and reads as "here".
  ip         cidr,
  -- The browser and OS, which is what actually answers "a new device": two
  -- sign-ins from the same `user_agent` and different networks is a phone
  -- changing wifi, and two from different agents is a laptop that is not this
  -- laptop. Bounded here rather than only in the caller — `ext_version` on
  -- `failure_reports` is bounded the same way — because a durable column is
  -- not a channel until somebody exports the table.
  --
  -- **No spreadsheet-formula guard here, and the reason is where the guard
  -- belongs.** `005` and `006` close `waitlist` because a *stranger* types
  -- into a public form and the operator exports the result into Excel. This
  -- value is an HTTP header on an authenticated exchange: nobody typing a
  -- formula into it is a threat model with a member in it, and adding the
  -- constraint would be the same defence applied where there is no attacker.
  user_agent text not null default '',
  created_at timestamptz not null default now(),

  -- 512 characters is the longest user agent in the wild by a comfortable
  -- margin (the longest Chrome sends is around 300). Past it the value is
  -- something other than a browser identifying itself, and the row is
  -- dropped or refused rather than stored — the same decision
  -- `failure_report.clean_version` makes, and the same reason: truncating
  -- leaves 512 characters of it in the one column a human reads.
  constraint sign_in_events_agent_bounded
    check (char_length(user_agent) <= 512),

  -- `cidr` and not `inet`, and the type does half the work this column needs
  -- done. `inet` stores whatever it is given exactly, so a full IPv4 address
  -- is one cast away and the truncation is only ever a Python convention — a
  -- guard that exists in one place is a guard one rename removes. **`cidr`
  -- refuses any value with bits set to the right of its mask**:
  -- `'192.168.1.55/24'` is rejected outright, so the half-address a careless
  -- caller would write has nowhere to land, including for a row written from
  -- the table editor. The caller masks first (`ip_network(f"{ip}/24",
  -- strict=False)`) and hands over `192.168.1.0/24`.
  --
  -- **The type is not the guarantee, and the CHECK is the other half.** A bare
  -- address is a *valid* `cidr` — Postgres stores `'192.168.1.55'` as
  -- `192.168.1.55/32` and `'2001:db8:abcd::1'` as `/128` — so the one form
  -- this column exists to refuse is accepted by the type alone. That is why
  -- the CHECK pins the mask **exactly** rather than setting a floor: `>= 24`
  -- admits every host route from `/32` down to `/24`, and a `/32` is the full
  -- address this table is not keeping. Equality is also the honest statement
  -- of the rule — the relay masks to one depth and no other — and it means a
  -- `/32` and a `/128` both fail the insert instead of quietly widening what
  -- the column holds.
  --
  -- **Why a network and not the address.** A /24 is a real IPv4 allocation —
  -- a household, an office, a mobile carrier's city-level cell — and it is the
  -- finest granularity that still answers "is this somewhere new?". A /32 is
  -- one connection on one device, which identifies a person far more sharply
  -- than the question asked of it and keeps doing so on every row forever. On
  -- IPv6 the equivalent is /48, the single site a subscriber is allocated; the
  -- /64 default is one household's LAN and /128 is the machine.
  --
  -- IPv4 and IPv6 need different numbers and there is no one comparison, so
  -- this branches on family rather than taking the weaker of the two.
  constraint sign_in_events_ip_is_a_network
    check (ip is null
           or (case when family(ip) = 4 then masklen(ip) = 24
                                  else masklen(ip) = 48 end))
);

-- The one question an operator asks of this table: "what has this account
-- signed in from, most recently". Mirrors `failure_reports_recent`.
create index sign_in_events_by_account on sign_in_events (owner, created_at desc);
-- And the other: "when did anything in the beta last sign in".
create index sign_in_events_recent on sign_in_events (created_at desc);

-- ── nobody but the service role may touch this table ───────────────────
--
-- Same reasoning as `profiles`, and sharper: this table is a sign-in log, so
-- with read access anyone holding the project URL and the *public* anon key
-- could enumerate who uses the beta, from where, and on what — a directory of
-- a closed beta's members and their habits, assembled from a key Supabase
-- designs to be public. RLS with zero policies is deny-all, and the relay
-- writes with the service role, which bypasses RLS by design.
alter table sign_in_events enable row level security;
revoke all on sign_in_events from anon;
revoke all on sign_in_events from authenticated;

-- ── retention, stated rather than faked ─────────────────────────────────
--
-- **There is no `expires_at` here and no column that promises the row will be
-- deleted.** A retention column nothing reads is a promise the database makes
-- on the operator's behalf and does not keep, and it is the same failure
-- `profiles.week_start` was written to avoid: a scheduled thing that quietly
-- stops running, and this time the quiet thing is the deletion of somebody's
-- access history.
--
-- **Nothing prunes this table**, and that is a decision rather than an
-- omission. The rows are small, one per successful exchange, and the reason to
-- keep them grows rather than shrinks: an access record's value is in being
-- old enough to matter. An operator who wants them gone runs
-- `delete from sign_in_events where created_at < now() - interval '90 days';`
-- — one statement, so it either happened or is visibly not happening.
--
-- **And because there is no cascade, an account's own deletion does not erase
-- this.** That is the same choice as the missing foreign key above, seen from
-- the other end: a person who deletes their account still has sign-in history
-- on file. **That is not the same request as deleting your data**, and the
-- two must not be conflated — an erasure request is one more statement from the
-- operator, `delete from sign_in_events where owner = '<uuid>';`, and it needs
-- no column and no trigger to be serviceable. What is not acceptable is the
-- shape where a person's data can only be erased by them giving up their
-- account, which is what a cascade would have made this.