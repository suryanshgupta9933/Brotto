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

for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 0.5
done
docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 \
  || fail "postgres never became ready"

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
    and (select count(*) from information_schema.columns
      where table_name='waitlist' and column_name='name') = 1
    and (select relrowsecurity from pg_class where relname='beta_access') = true
    and has_table_privilege('anon','beta_access','INSERT') = false
    and has_table_privilege('anon','beta_access','SELECT') = false
    and has_table_privilege('authenticated','beta_access','SELECT') = false;" | tr -d '[:space:]')"

[ "$out" = "t" ] || fail "schema check failed (got '$out') — a column or grant is missing"

# The backfill, run for real rather than merely parsed — replayed in the order
# `005` itself runs it, and using **the statement from the file** rather than a
# copy of it, so fixing the file fixes this and nothing else has to be kept in
# step. The constraint comes off first, because its whole job is to be the
# thing the backfill exists to satisfy.
say "replaying the backfill against a hostile row"
run -d postgres >/dev/null <<'SQL'
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

printf '\033[32mall passed\033[0m\n'