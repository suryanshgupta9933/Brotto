-- The addresses that asked for the beta, so the operator can invite them.
--
-- **One column, because the form asked for one.** This is the first table in
-- the project that holds data from *strangers* rather than from accounts the
-- operator invited by hand, and the discipline is the same one the other two
-- follow: store the field that was asked for and nothing derived from it. No
-- referrer, no user agent, no page URL, no IP — the relay does not read any of
-- them, and there is nowhere to put them if it later wanted to.
--
-- `batch` is the one addition and it is not user content: it is stamped from
-- `BROTTO_WAITLIST_BATCH` by the relay so the operator can answer "who went
-- out in the second invite?" while the batches are still overlapping. Empty by
-- default, because an install that never sets it must still be able to accept
-- a signup. It is a label the operator writes, not anything the visitor sent.
--
-- Beside `profiles` and `failure_reports` rather than in a fourth place:
-- Supabase is already a named processor for the two of them, and its table
-- editor exports to CSV, which is what the operator actually asked for. No new
-- vendor, no new database, no new credential.

create table waitlist (
  id         uuid primary key default gen_random_uuid(),
  -- Unique, so a second click is a no-op rather than a second row. The
  -- relay normalises before it writes (strip, lower case) so this compares
  -- the same address written two ways; a functional index on `lower(email)`
  -- would be tidier but PostgREST names a *column* for `on_conflict`, and
  -- nothing here upserts — a 409 is simply the answer for "already here".
  email      text not null unique,
  batch      text not null default '',
  created_at timestamptz not null default now()
);

-- The dedupe is a constraint and not an application check, because a
-- read-then-insert is two requests landing in the same millisecond, which is
-- exactly what a double-clicked submit is. The guard lives here, where it
-- cannot be raced, and the endpoint answers a duplicate exactly as it answers
-- a first submit — so it is not an oracle about who is already on the list.

-- "Which batch did this go out in", and it is read newest-first because that
-- is the only question anybody asks of a waitlist.
create index waitlist_by_batch on waitlist (batch, created_at desc);

-- ── nobody but the service role may touch this table ───────────────────
--
-- Same reasoning as `profiles`, and it is stronger here: with write access
-- anyone holding the project URL and the *public* anon key could read the
-- entire waitlist — a list of addresses that have not signed up for anything
-- except a beta invite. RLS with zero policies is deny-all, and the relay
-- writes with the service role, which bypasses RLS by design.
alter table waitlist enable row level security;
revoke all on waitlist from anon;
revoke all on waitlist from authenticated;