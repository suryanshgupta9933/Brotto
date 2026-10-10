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