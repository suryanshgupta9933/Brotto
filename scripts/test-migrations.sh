#!/usr/bin/env bash
# Every migration, applied in order, against a real Postgres.
#
# There is no migration runner. The relay's control plane is created by
# `psql -f`, once, by a human, on an afternoon when nothing else is wrong.
# So a statement that is only ever executed at that moment gets **no** other
# execution — `tests/` covers the Python that reads these tables and never the
# SQL that makes them, and a self-hoster rebuilding a database from
# `supabase/migrations/` hits the same file we did.
#
# That gap is not hypothetical. `005_waitlist_name.sql` shipped a backfill
# written `''' || name`, which is a syntax error: `'''` is a complete string
# literal containing one quote, so the `||` and the `WHERE` land outside it and
# the whole migration aborts. Every test was green. The public waitlist would
# have 502'd on the deploy, and a self-hoster would have been unable to build a
# database at all.
#
#   ./scripts/test-migrations.sh
#
# Needs Docker. Nothing is written outside the throwaway container.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_IMAGE="postgres:17-alpine"
CONTAINER="brotto-migrations-test"
PORT="${BROTTO_MIGRATIONS_TEST_PORT:-55433}"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

say() { printf '\033[2m%s\033[0m\n' "$*"; }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || fail "docker is not installed"

say "starting $PG_IMAGE"
docker run -d --rm --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=postgres \
  -p "127.0.0.1:$PORT:5432" \
  "$PG_IMAGE" >/dev/null

# Not `pg_isready`: it answers on the temporary init server that
# postgres-alpine runs before restarting into the real one, so the first
# bootstrap connection gets "terminating connection due to administrator
# command". A real query is the only probe that means *this* server is up.
ready() { docker exec "$CONTAINER" psql -U postgres -d postgres -c 'select 1' >/dev/null 2>&1; }
for _ in $(seq 1 60); do
  ready && break
  sleep 0.5
done
ready || fail "postgres never became ready"

run() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -q "$@"; }

# ── The bootstrap Supabase provides and a bare Postgres does not ────────────
#
# `001_profiles.sql` puts a foreign key on `auth.users` and revokes from two
# roles that only exist inside the Supabase project. Both are stubbed here so
# the migrations can run anywhere — which is the point: a self-hoster does not
# have Supabase.
say "bootstrapping auth.users and the two roles"
run -d postgres <<'SQL'
create schema if not exists auth;
create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;
SQL

# ── Every migration, in filename order ──────────────────────────────────────
#
# Sorted, not globbed by shell: `10_` must run after `09_`, and `sort -V` is
# what gets that right rather than `sort` or the shell's own ordering.
fail_count=0
while IFS= read -r file; do
  name="$(basename "$file")"
  say "applying $name"
  if ! run -d postgres -f - <"$file"; then
    printf '\033[31mFAIL\033[0m %s did not apply\n' "$name" >&2
    fail_count=$((fail_count + 1))
  fi
done < <(find "$ROOT/supabase/migrations" -name '*.sql' -type f | sort -V)

[ "$fail_count" -eq 0 ] || fail "$fail_count migration(s) did not apply"

# ── The properties the code assumes, asserted against the built schema ──────
#
# Read the queries rather than the migration text: a comment can claim anything,
# and the three tests that would have caught the `005` backfill bug are all
# statements that must merely *parse*.
say "checking the schema the relay reads"
out="$(run -tA -d postgres -c "
  select
    (select count(*) from information_schema.columns
      where table_name='beta_access' and column_name='revoked_at') = 1
    -- 010 merges the waitlist in: the request columns sit beside the decision
    -- ones, and the old table is gone rather than left beside the new one.
    and (select count(*) from information_schema.columns
      where table_name='beta_access' and column_name='asked_at') = 1
    and (select count(*) from information_schema.columns
      where table_name='beta_access' and column_name='name') = 1
    and (select count(*) from information_schema.columns
      where table_name='waitlist') = 0
    -- The invitation is `approved_at`, and it must carry no default: the
    -- waitlist write path omits the column, so a default would grant the beta
    -- to every stranger who asked for it. The column has to be nullable, or a
    -- request could not be a row at all.
    and (select column_default is null from information_schema.columns
          where table_name='beta_access' and column_name='approved_at') = true
    and (select is_nullable = 'YES' from information_schema.columns
          where table_name='beta_access' and column_name='approved_at') = true
    and (select relrowsecurity from pg_class where relname='beta_access') = true
    and has_table_privilege('anon','beta_access','INSERT') = false
    and has_table_privilege('anon','beta_access','SELECT') = false
    and has_table_privilege('authenticated','beta_access','SELECT') = false
    and (select relrowsecurity from pg_class where relname='sign_in_codes') = true
    and (select relrowsecurity from pg_class where relname='sign_in_events') = true
    and (select count(*) from pg_policies
          where tablename in ('sign_in_codes','sign_in_events')) = 0
    and has_table_privilege('anon','sign_in_codes','SELECT') = false
    and has_table_privilege('anon','sign_in_codes','INSERT') = false
    and has_table_privilege('authenticated','sign_in_codes','SELECT') = false
    and has_table_privilege('anon','sign_in_events','SELECT') = false
    and has_table_privilege('authenticated','sign_in_events','SELECT') = false
    -- A function PUBLIC can execute runs with the *caller's* privileges, so
    -- redeem_sign_in_code is as sensitive as the codes behind it: an
    -- executable one would burn any address's attempts on demand.
    -- (No backticks anywhere in this string: bash would run one.)
    and has_function_privilege('public',
          'public.redeem_sign_in_code(text,text,int)','EXECUTE') = false
    and has_function_privilege('anon',
          'public.redeem_sign_in_code(text,text,int)','EXECUTE') = false
    -- beta_status answers the oracle question outright, so the same rule and
    -- a sharper reason: executable, it hands "is this address in the beta" to
    -- anybody with the public anon key.
    and has_function_privilege('public',
          'public.beta_status(text)','EXECUTE') = false
    and has_function_privilege('anon',
          'public.beta_status(text)','EXECUTE') = false
    -- 009 drops it: an operator identifier nothing writes is a column the
    -- table editor shows and a reader believes.
    and (select count(*) from information_schema.columns
          where table_name='beta_access' and column_name='added_by') = 0;" | tr -d '[:space:]')"

[ "$out" = "t" ] || fail "schema check failed (got '$out') — a column or grant is missing"

# The backfill, run for real rather than merely parsed — replayed in the order
# `005` itself runs it, and using **the statement from the file** rather than a
# copy of it, so fixing the file fixes this and nothing else has to be kept in
# step. The constraint comes off first, because its whole job is to be the
# thing the backfill exists to satisfy.
#
# `010` dropped `waitlist`, so the replay rebuilds a scratch one of the `003` +
# `005` + `006` shape and drops it again afterwards: the statement in `005`
# says `update waitlist`, and renaming it to run would stop testing the line
# that ships. This is a property of a *historical* file, not of the live
# schema — which is why the scratch goes away before anything else is asserted.
say "replaying the backfill against a hostile row"
run -d postgres >/dev/null <<'SQL'
create table waitlist (
  email      text not null unique,
  batch      text not null default '',
  name       text,
  constraint waitlist_name_no_formula
    check (name is null or name !~ '^[=+\-@\t\r]'),
  constraint waitlist_email_no_formula
    check (email !~ '^[=+\-@\t\r]')
);
alter table waitlist drop constraint waitlist_name_no_formula;
insert into waitlist (email, batch, name) values
  ('hostile@example.test','test','=cmd|...'),
  ('plus@example.test','test','+1+1'),
  ('clean@example.test','test','Ada');
SQL

backfill="$(grep -E '^[[:space:]]*update waitlist set name' "$ROOT/supabase/migrations/005_waitlist_name.sql")"
[ -n "$backfill" ] || fail "no backfill statement found in 005_waitlist_name.sql"
printf '%s;\n' "$backfill" | run -d postgres >/dev/null \
  || fail "the backfill statement in 005 does not run"

out="$(run -tA -d postgres -c "
  select count(*) from waitlist
   where name is null or name ~ '^[=+\-@\t\r]';" | tr -d '[:space:]')"
[ "$out" = "0" ] || fail "$out row(s) still carry a formula prefix after the backfill"

# The backfill must not touch a name that was already safe.
out="$(run -tA -d postgres -c "select name from waitlist where email='clean@example.test'" | tr -d '[:space:]')"
[ "$out" = "Ada" ] || fail "the backfill rewrote a safe name (got '$out')"

say "re-adding the constraint"
run -d postgres >/dev/null <<'SQL'
alter table waitlist add constraint waitlist_name_no_formula
  check (name is null or name !~ '^[=+\-@\t\r]');
SQL

# ── `006`: the same backfill-then-constrain shape, for `email` ─────────────
#
# `005` guarded the name and left the address, which the same export would
# have run. The server now refuses a formula-leading email rather than
# prefixing it — an identifier has to round-trip — so this constraint is the
# only thing standing between a row written by the table editor and the
# operator's spreadsheet.
say "replaying the email backfill against a hostile row"
run -d postgres >/dev/null <<'SQL'
alter table waitlist drop constraint waitlist_email_no_formula;
insert into waitlist (email, batch) values
  ('=cmd|...@example.test','test'),
  ('+1+1@example.test','test'),
  ('clean2@example.test','test');
SQL

backfill="$(grep -E '^[[:space:]]*update waitlist set email' "$ROOT/supabase/migrations/006_waitlist_email.sql")"
[ -n "$backfill" ] || fail "no backfill statement found in 006_waitlist_email.sql"
printf '%s;\n' "$backfill" | run -d postgres >/dev/null \
  || fail "the backfill statement in 006 does not run"

out="$(run -tA -d postgres -c "
  select count(*) from waitlist
   where email ~ '^[=+\-@\t\r]';" | tr -d '[:space:]')"
[ "$out" = "0" ] || fail "$out email row(s) still carry a formula prefix after the backfill"

# The backfill must not touch an address that was already safe.
out="$(run -tA -d postgres -c "select email from waitlist where email='clean2@example.test'" | tr -d '[:space:]')"
[ "$out" = "clean2@example.test" ] || fail "the backfill rewrote a safe email (got '$out')"

say "re-adding the email constraint"
run -d postgres >/dev/null <<'SQL'
alter table waitlist add constraint waitlist_email_no_formula
  check (email !~ '^[=+\-@\t\r]');
SQL

# The scratch table has done its job. From here on every assertion is about
# the schema `001`–`010` actually built, and a leftover `waitlist` would make
# the two-table questions below answer about the wrong thing.
say "dropping the scratch waitlist"
run -d postgres >/dev/null <<'SQL'
drop table waitlist;
SQL

# ── `007`: a code that cannot be stored, guessed, or reused ───────────────
#
# The properties here are all things a comment can claim and only Postgres can
# settle: that a six-digit code does not fit `code_hash`, that a wrong guess
# costs an attempt whether or not it was wrong, and that the newest code for an
# address is the only live one.
expect() {  # expect <sql> <expected> <message>
  local got
  if ! got="$(run -tA -d postgres -c "$1" | tr -d '[:space:]')"; then
    fail "$3 — the query itself failed"
  fi
  [ "$got" = "$2" ] || fail "$3 (got '$got', wanted '$2')"
}

# `set -e` would abort the whole script on an error these *want*, so an
# expected refusal has to be a condition rather than a command whose status is
# read afterwards.
refuses() {  # refuses <message>; SQL on stdin, which Postgres must reject
  if run -d postgres >/dev/null 2>&1; then
    fail "$1 — Postgres accepted it"
  fi
}

say "a plaintext code does not fit the column"
refuses "a six-digit code fit sign_in_codes.code_hash" <<'SQL'
insert into sign_in_codes (email, code_hash, expires_at)
  values ('plaintext@example.test', '123456', now() + interval '10 min');
SQL

say "a code cannot be born expired, and cannot go negative"
refuses "an already-expired code was stored" <<'SQL'
insert into sign_in_codes (email, code_hash, expires_at)
  values ('stale@example.test', repeat('a', 64), now() - interval '1 min');
SQL
refuses "a negative attempt count was stored" <<'SQL'
insert into sign_in_codes (email, code_hash, expires_at, attempts)
  values ('negative@example.test', repeat('a', 64), now() + interval '10 min', -1);
SQL

say "a wrong guess is charged, a right one is consumed, a replay is neither"
run -d postgres >/dev/null <<'SQL'
truncate sign_in_codes;
insert into sign_in_codes (email, code_hash, expires_at)
  values ('a@example.test', repeat('a', 64), now() + interval '10 min');
SQL
expect "select redeem_sign_in_code('a@example.test', repeat('b', 64), 5)" \
  "f" "a wrong digest was accepted"
expect "select attempts from sign_in_codes" "1" "a wrong digest was not charged"
expect "select redeem_sign_in_code('a@example.test', repeat('a', 64), 5)" \
  "t" "the right digest was refused"
expect "select consumed_at is not null from sign_in_codes" \
  "t" "a redeemed code was not marked consumed"
expect "select redeem_sign_in_code('a@example.test', repeat('a', 64), 5)" \
  "f" "a code was redeemable twice"
expect "select attempts from sign_in_codes" \
  "2" "a replayed code charged an attempt"

say "the cap is charged before it is judged"
run -d postgres >/dev/null <<'SQL'
truncate sign_in_codes;
insert into sign_in_codes (email, code_hash, expires_at)
  values ('cap@example.test', repeat('c', 64), now() + interval '10 min');
SQL
expect "select count(*) from generate_series(1, 5)
         where redeem_sign_in_code('cap@example.test', repeat('d', 64), 5)" \
  "0" "a wrong digest was accepted"
expect "select attempts from sign_in_codes" "5" "the five wrong guesses were not all charged"
expect "select redeem_sign_in_code('cap@example.test', repeat('c', 64), 5)" \
  "f" "the cap did not hold past the fifth attempt"

say "only the newest code for an address is redeemable"
run -d postgres >/dev/null <<'SQL'
truncate sign_in_codes;
insert into sign_in_codes (email, code_hash, expires_at)
  values ('again@example.test', repeat('e', 64), now() + interval '10 min');
insert into sign_in_codes (email, code_hash, expires_at)
  values ('again@example.test', repeat('f', 64), now() + interval '10 min');
SQL
expect "select redeem_sign_in_code('again@example.test', repeat('e', 64), 5)" \
  "f" "the superseded code was still redeemable"
expect "select redeem_sign_in_code('again@example.test', repeat('f', 64), 5)" \
  "t" "the newest code was refused"

say "the budget is per address, so sending another does not reset it"
run -d postgres >/dev/null <<'SQL'
truncate sign_in_codes;
insert into sign_in_codes (email, code_hash, expires_at)
  values ('addr@example.test', repeat('1', 64), now() + interval '10 min');
insert into sign_in_codes (email, code_hash, expires_at)
  values ('addr@example.test', repeat('2', 64), now() + interval '10 min');
SQL
expect "select count(*) from generate_series(1, 5)
         where redeem_sign_in_code('addr@example.test', repeat('9', 64), 5)" \
  "0" "a wrong digest was accepted"
expect "select redeem_sign_in_code('addr@example.test', repeat('2', 64), 5)" \
  "f" "a fresh code reset the address's attempt budget"

# ── `008`: the address is truncated by the schema, not by the caller ───────
#
# `cidr` alone is not enough — a bare address is a *valid* `cidr` and is stored
# as `/32` — so the CHECK is what refuses the one form this table exists not to
# keep, and both halves are asserted rather than only the ones that pass.
say "a network is stored, a host route is not"
run -d postgres >/dev/null <<'SQL'
truncate sign_in_events;
insert into sign_in_events (owner, ip, user_agent)
  values (gen_random_uuid(), '192.168.1.0/24', 'Mozilla/5.0 (Macintosh) Chrome/141');
insert into sign_in_events (owner, ip)
  values (gen_random_uuid(), '2001:db8:abcd::/48');
insert into sign_in_events (owner, ip) values (gen_random_uuid(), null);
SQL
expect "select count(*) from sign_in_events where masklen(ip) in (24, 48)" \
  "2" "a masked network was not stored"
for host_route in '192.168.1.55' '203.0.113.9/32' '2001:db8:abcd::1/128'; do
  if ! run -d postgres >/dev/null 2>&1 -c \
      "insert into sign_in_events (owner, ip) values (gen_random_uuid(), '$host_route');"; then
    :
  else
    fail "sign_in_events stored the host route $host_route"
  fi
done

say "a user agent is bounded, and an account may have no address at all"
refuses "a 513-character user agent was stored" <<'SQL'
insert into sign_in_events (owner, user_agent) values (gen_random_uuid(), repeat('x', 513));
SQL
expect "select count(*) from sign_in_events where ip is null" \
  "1" "a sign-in with no forwarded peer could not be recorded"

say "sign-in history outlives the account"
expect "select count(*) from pg_constraint
         where conrelid = 'sign_in_events'::regclass and contype = 'f'" \
  "0" "sign_in_events has a foreign key — account deletion would erase it"

# ── `009`/`010`: one lookup, four answers ─────────────────────────────────
#
# The classification is the whole of what the sign-in screen will say, so each
# of the four arms is asserted rather than the one this address happens to be
# in. The precedence case is the one that rots silently: a revoked address that
# also asked must read `revoked`, and a `case` reordered to put `pending` first
# changes that without breaking any single-address test. `010` folded the two
# tables into one row, so the precedence is now the order of three `when` arms
# rather than the order of two `exists` branches — the policy is the same and
# the trap is the same.
say "an address is classified into exactly one of the four answers"
run -d postgres >/dev/null <<'SQL'
insert into beta_access (email, approved_at, revoked_at)
  values ('admitted@example.test', now(), null);
insert into beta_access (email, approved_at, revoked_at)
  values ('revoked@example.test', now(), now());
insert into beta_access (email, batch, asked_at)
  values ('pending@example.test', 'test', now());
-- One row carrying both a request and a withdrawal: the reason the `when`
-- arms are ordered. The revocation is the last thing we said about them, so
-- a request they submitted themselves does not speak over it.
insert into beta_access (email, batch, asked_at, approved_at, revoked_at)
  values ('both@example.test', 'test', now(), now(), now());
SQL
expect "select beta_status('admitted@example.test')" \
  "admitted" "an un-withdrawn grant was not 'admitted'"
expect "select beta_status('revoked@example.test')" \
  "revoked" "a withdrawn grant was not 'revoked'"
expect "select beta_status('pending@example.test')" \
  "pending" "a request that was never granted was not 'pending'"
expect "select beta_status('nobody@example.test')" \
  "none" "an address with no row was not 'none'"
expect "select beta_status('both@example.test')" \
  "revoked" "the request spoke over a revocation — that arm is out of order"

# ── `010`: the invitation is a column, and it has no default ──────────────
#
# The merge is only safe if a waitlist write cannot grant. `004`'s
# `default now()` on `approved_at` would have done exactly that the moment the
# two tables became one, because the waitlist path inserts a row and does not
# name the column. So this is the guard the whole migration rests on, and it is
# asserted as behaviour rather than as a clause.
say "a request cannot become a grant by accident"
run -d postgres >/dev/null <<'SQL'
insert into beta_access (email, batch, asked_at)
  values ('asked@example.test', 'test', now());
SQL
expect "select approved_at is null from beta_access where email='asked@example.test'" \
  "t" "inserting a request filled approved_at — the column has a default again"
expect "select beta_status('asked@example.test')" \
  "pending" "a request read as something other than 'pending'"

say "a row that is neither a request nor a grant nor a withdrawal is refused"
refuses "an empty row was stored" <<'SQL'
insert into beta_access (email) values ('bare@example.test');
SQL

say "the formula guards followed the columns onto the merged table"
refuses "a name a spreadsheet would run was stored" <<'SQL'
insert into beta_access (email, name, asked_at)
  values ('named@example.test', '=cmd|.../c calc', now());
SQL
refuses "an email a spreadsheet would run was stored" <<'SQL'
insert into beta_access (email, asked_at)
  values ('=cmd|...@example.test', now());
SQL

say "no foreign key reaches the roster from the transient tables"
expect "select count(*) from pg_constraint
         where conrelid in ('sign_in_codes'::regclass, 'sign_in_events'::regclass)
           and contype = 'f'" \
  "0" "a transient or audit table grew a foreign key — a delete would follow it"

printf '\033[32mall passed\033[0m\n'