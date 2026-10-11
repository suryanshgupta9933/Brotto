-- Which runs did not happen, and which fixed code says why.
--
-- NOT analytics. `failure_reason` is already a closed set of machine codes
-- the relay writes and the panel translates into a sentence, so the
-- question this table answers is one the codebase could already phrase:
-- *did the run happen, and if not, which of our codes says why?* Analytics
-- would answer *what did the user do* — which pages, which tasks — and that
-- is the surveillance posture `docs/architecture/privacy.md` rule 1 forbids.
--
-- Every column is a version string or a value from the closed vocabulary in
-- `session/failure_report.py`. There is nowhere to put a URL, a task string,
-- a page fragment or typed input, and `build_row` raises on any keyword it
-- does not recognise, so widening this is a change that fails a test.
--
-- Beside `profiles` rather than in a third place: Supabase is already a
-- named processor for the account table, so a new table beside it adds no
-- new one. `CODE` and `STAGE` are deliberately NOT check constraints —
-- restating the vocabulary in SQL would be a second list to drift from the
-- Python one, and the enforcement that matters (a code outside the set is
-- dropped before it gets here) lives where the codes are minted.

create table failure_reports (
  id            uuid primary key default gen_random_uuid(),
  -- The account the failure belongs to. Never sent by the client: the relay
  -- reads it off the verified token, so there is no user id on the wire —
  -- only in a table the operator already holds an identity for in `profiles`.
  -- Cascade, so deleting the account takes its failure history with it.
  owner         uuid not null references auth.users on delete cascade,
  -- 'client' | 'server'. A client row is a run the relay never saw start.
  side          text not null check (side in ('client', 'server')),
  code          text not null,
  -- Where it happened: 'connect' (client) | 'task_refused' | 'task_result'
  -- | 'task_error' (server).
  stage         text not null,
  ext_version   text not null default '',
  relay_version text not null default '',
  created_at    timestamptz not null default now()
);

-- The one query an operator actually runs: "which codes are failing, for
-- whom, in the last day".
create index failure_reports_recent on failure_reports (created_at desc);
create index failure_reports_by_code on failure_reports (code, created_at desc);

-- ── nobody but the service role may touch this table ───────────────────
--
-- Same reasoning as `profiles`, and it is stronger here: with write access
-- anyone holding the project URL and the *public* anon key could insert rows
-- naming codes and reading as an operator's own accounting. RLS with zero
-- policies is deny-all, and the relay writes with the service role, which
-- bypasses RLS by design.
alter table failure_reports enable row level security;
revoke all on failure_reports from anon;
revoke all on failure_reports from authenticated;