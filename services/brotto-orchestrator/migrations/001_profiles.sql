-- The hosted relay's one table.
--
-- Auth lives in Supabase's own auth.users; this is the operator's ledger
-- over it: who is in the beta, who has been withdrawn, and how much of
-- their weekly allowance is gone. One table rather than a users table
-- plus a usage table plus a grants table, because invitations are
-- hand-issued SQL and a schema spread across three tables is three
-- statements an on-call operator forgets at 2am.
--
-- role has two values because the operator needs to mint and revoke and
-- nothing else. There is no admin UI and no public signup: a row here is
-- an invitation, and the absence of one is a refusal.

create table profiles (
  id                uuid primary key references auth.users on delete cascade,
  email             text not null,
  role              text not null default 'beta',   -- 'beta' | 'operator'
  revoked_at        timestamptz,                    -- null = active
  week_start        date    not null default current_date,
  tasks_this_week   int     not null default 0
);

-- revoked_at rather than a row delete: "we removed this person" is an
-- audit question, and `on delete cascade` would take the evidence with it
-- — the auth.users row *is* the evidence.
--
-- tasks_this_week resets by comparing week_start to current_date on read.
-- No scheduled job: a cron that resets a counter ten people move a few
-- hundred times is a cron that silently stops running, and the failure
-- mode is one user's beta ending for no visible reason.
--
-- The relay reads this table with the service role key at task start
-- only. There is no write path from this application beyond the task
-- counter, and no column here holds anything the user said.

-- ── nobody but the service role may touch this table ───────────────────
--
-- SUPABASE_ANON_KEY is *public*: it ships to every browser by design and
-- is in the extension's bundle. So the default grants are not a threat
-- model — they are the starting state, and without these lines anyone
-- holding the project URL and that key reads the whole beta roster and,
-- because the table is writable, sets their own `revoked_at` back to
-- null or zeroes their own counter. That is the entire control plane,
-- bypassed without touching the relay at all.
--
-- RLS with zero policies is deny-all, which is exactly right: the relay
-- calls this table with the service role key, which bypasses RLS by
-- design, so no policy is needed for the one caller that must work.
-- The revokes are belt and braces — RLS already covers them — and say
-- the intent out loud for the next reader who wonders whether a table
-- with no policy can still be reached.
alter table profiles enable row level security;
revoke all on profiles from anon;
revoke all on profiles from authenticated;

-- ── the weekly cap, reserved atomically ─────────────────────────────────
--
-- authorize_task_start used to GET the row, compare in Python and PATCH
-- the result, which is a read-then-write race: two task starts for one
-- account both read `used = 9`, both pass the check, both write 10, and
-- one task is granted past the cap. The cap is the control that stops a
-- hosted account spending our compute, so the increment has to be one
-- statement, not two round trips and a comparison in between.
--
-- The predicate is in the WHERE clause and the reset is in the SET, so
-- Postgres does both under one row lock. A zero-row result is the cap
-- (or a revocation that landed between the read and here) and the caller
-- refuses the task.
create or replace function public.reserve_task_slot(uid uuid, cap int)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  granted boolean;
begin
  update profiles
     set tasks_this_week = case
           when week_start = current_date then tasks_this_week + 1
           else 1
         end,
         week_start = current_date
   where id = uid
     and revoked_at is null
     and (week_start <> current_date or tasks_this_week < cap)
  returning true into granted;
  return coalesce(granted, false);
end;
$$;

-- Called by the relay's service role, which bypasses RLS; but a function
-- executable by `public` would run with the *caller's* privileges by
-- default, so revoke that explicitly rather than reasoning about it.
revoke all on function public.reserve_task_slot(uuid, int) from public, anon, authenticated;