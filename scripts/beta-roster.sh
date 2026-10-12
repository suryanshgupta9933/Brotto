#!/usr/bin/env bash
# The closed-beta roster: add, list, withdraw, re-admit, drop addresses.
#
# A row in `beta_access` IS the invitation. Until one exists, sign-in mints a
# valid token but `approve_at_exchange` refuses, and `POST /v1/auth/exchange`
# answers `approved: false` — the panel offers the waitlist and `task_start`
# refuses. So adding an address is the entire act of inviting somebody.
#
#   ./scripts/beta-roster.sh add you@example.com them@example.com
#   ./scripts/beta-roster.sh list
#   ./scripts/beta-roster.sh revoke someone@example.com
#   ./scripts/beta-roster.sh unrevoke someone@example.com
#   ./scripts/beta-roster.sh drop someone@example.com
#
# **This is a local operator tool, not an endpoint.** There is deliberately no
# admin route on the relay: an HTTP route that appends addresses is an
# unauthenticated or weakly-authenticated write into the front door of the
# hosted beta, and no amount of "it's behind a token" makes that the same
# thing. This runs on your machine, over the Supabase CLI's own linked-project
# credentials, so there is nothing to compromise remotely.
#
# `revoke` and `unrevoke` write **two** tables and refuse if the address is not
# on the roster. Both are required and neither is sufficient alone:
# `beta_access.revoked_at` refuses re-admission and survives the auth account
# being deleted, while `profiles.revoked_at` is what `authorize_task_start`
# actually reads at every step and is erased by the `auth.users` cascade. Do one
# without the other and you have withdrawn nothing.
#
# Neither refuses when the address *is* on the roster but has no account yet —
# there is genuinely nothing to mark — because aborting there would roll back
# the roster write, which is the half that survives an account being deleted.
# That case warns instead. The two are told apart by whether the update
# matched a row at all, because a mistyped address and a never-signed-in one
# otherwise produce the identical silence.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\033[2m%s\033[0m\n' "$*"; }
die() { printf '\033[31merror\033[0m %s\n' "$*" >&2; exit 1; }
usage() {
  # Print the header comment block, however long it grows. A hardcoded line
  # range goes stale the first time anyone adds a paragraph to it, and a usage
  # message that stops mid-sentence reads like a broken script.
  sed -n '2,/^[^#]/p' "${BASH_SOURCE[0]}" | grep '^#' | sed 's/^# \{0,1\}//'
  exit 1
}

command -v supabase >/dev/null || die "the supabase CLI is not installed"
[ -f "$ROOT/supabase/.temp/project-ref" ] || die "run 'supabase link' first"

# ── Addresses ───────────────────────────────────────────────────────────────
#
# Validated here because every one of these is interpolated into SQL. The
# allowance is deliberately narrow and deliberately not the same regex the
# server uses (`EMAIL_RE` in `jwt_auth.py`) — this one has to be safe to
# interpolate, not merely plausible as an address. `lower(btrim(...))` is then
# applied inside the SQL itself, so the normalisation the control plane assumes
# happens even if this script's own reader gets the case wrong.
#
# An operator who mistypes a withdrawal address revoking nobody is the exact
# failure `revoke` below is built to make loud, so the parse is strict and the
# error names the offending input rather than failing somewhere in Postgres.
EMAIL_RE='^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'

norm_sql() { printf "lower(btrim('%s'))" "$1"; }

check_email() {
  local addr="$1"
  [[ "$addr" =~ $EMAIL_RE ]] || die "not an address I will interpolate into SQL: '$addr'"
}

# `supabase db query --file` takes a path and does not accept `-` for stdin,
# so SQL on stdin goes through a temp file. `mktemp` + trap rather than a
# fixed name under /tmp: two terminals running `add` at once must not share a
# file, and a predictable path in /tmp is a path somebody else can write.
SQLFILE="$(mktemp -t brotto-roster.XXXXXX.sql)"
trap 'rm -f "$SQLFILE"' EXIT

# q < sql          — run SQL, print the CSV rows
q() { cat >"$SQLFILE"; supabase db query --linked --output csv --file "$SQLFILE"; }

# One value out of a CSV result, for the `[ "$x" = "y" ]` comparisons below.
# `sed` rather than `grep -v` because a zero-row result is *empty*, and `grep`
# exits 1 on no input — which under `set -o pipefail` killed the script at the
# assignment, before it could print why. The header row is dropped because the
# value is the last line and the header never is.
last() { sed -e '/^[[:space:]]*$/d' | tail -n 1; }

cmd="${1:-}"; shift || usage
case "$cmd" in
  add|revoke|unrevoke|drop) ;;
  list|-l|--list) cmd=list ;;
  *) usage ;;
esac

if [ "$cmd" = "list" ]; then
  # Left-padded by hand rather than with \x1b: piping this somewhere should not
  # drag escape codes along with it.
  q <<'SQL'
select case when revoked_at is null then 'admitted' else 'withdrawn' end as state,
       email,
       coalesce(added_by, '') as added_by,
       approved_at::date as approved
  from beta_access
 order by approved_at desc, email;
SQL
  exit 0
fi

[ "$#" -ge 1 ] || die "$cmd needs at least one address"
for addr in "$@"; do check_email "$addr"; done

case "$cmd" in
  add)
    for addr in "$@"; do
      n="$(norm_sql "$addr")"
      # `do nothing`, never `do update`: an `add` that cleared `revoked_at`
      # would override a withdrawal the operator may have made deliberately,
      # which is the same half-procedure trap `drop` is guarded against. A
      # withdrawn address has to be re-admitted with `unrevoke`, on purpose.
      state="$(q <<SQL | last
insert into beta_access (email, added_by, revoked_at)
values ($n, '$(whoami)', null)
on conflict (email) do nothing
returning 'admitted';
SQL
)"
      case "$state" in
        *admitted*) say "+ $addr  admitted" ;;
        *)
          prior="$(q <<SQL | last
select case when revoked_at is null then 'admitted' else 'withdrawn' end
  from beta_access where email = $n;
SQL
)"
          if [ "$prior" = "withdrawn" ]; then
            die "$addr is WITHDRAWN and add will not undo that. To re-admit: ./scripts/beta-roster.sh unrevoke $addr"
          fi
          say "= $addr  already admitted, unchanged"
          ;;
      esac
    done
    say ""
    say "They can now sign up with that address. No email is sent — the panel"
    say "offers the waitlist to anyone the roster does not list."
    ;;

  revoke)
    for addr in "$@"; do
      n="$(norm_sql "$addr")"
      # **No raise on an unresolved account**, and that is the whole design
      # here. `beta_access.revoked_at` is the half that is durable — it
      # survives the auth account being deleted — so a procedure that aborts
      # when the account cannot be found throws away the part that matters and
      # keeps the part that would have been overwritten anyway. Instead the
      # roster write always lands and the operator is told which half was
      # skipped and what to type instead.
      #
      # Two lookups, because they fail on different typos: `profiles.email` is
      # the spelling the address was *admitted* under and is frozen there, so
      # it answers for somebody who has since changed their Supabase email;
      # `auth.users.email` is the live spelling and is not normalised by
      # Supabase, hence btrim/lower on our side.
      resolved="$(q <<SQL | last
with resolved as (
  select coalesce(
           (select id from profiles where email = $n),
           (select id from auth.users where lower(btrim(email)) = $n)
         ) as uid
),
written as (
  update beta_access set revoked_at = now() where email = $n returning 1
),
marked as (
  update profiles set revoked_at = now()
   where id = (select uid from resolved) returning 1
)
select case
         when (select count(*) from written) = 0 then 'none'
         when (select count(*) from marked)  = 1 then 'profile'
         else 'roster'
       end;
SQL
)"
      case "$resolved" in
        none)
          die "$addr is not on the roster, so there was nothing to withdraw.
    A withdrawal that withdrew nobody is the one failure this command exists to
    prevent. If they signed in under a different spelling, revoke that too."
          ;;
        *profile*)
          say "- $addr  withdrawn"
          ;;
        *)
          say "- $addr  withdrawn from the roster"
          say "  ! no account found for that address, so there was no profile"
          say "    row to mark. They cannot sign in, and cannot be"
          say "    re-admitted without an explicit 'unrevoke'. If they had"
          say "    signed in under a different spelling, withdraw that too."
          ;;
      esac
    done
    say ""
    say "Withdrawal is effective at their next request. A task already in"
    say "flight runs to completion; nothing cancels it."
    ;;

  unrevoke)
    for addr in "$@"; do
      n="$(norm_sql "$addr")"
      resolved="$(q <<SQL | last
with resolved as (
  select coalesce(
           (select id from profiles where email = $n),
           (select id from auth.users where lower(btrim(email)) = $n)
         ) as uid
),
written as (
  update beta_access set revoked_at = null where email = $n returning 1
),
marked as (
  update profiles set revoked_at = null
   where id = (select uid from resolved) returning 1
)
select case
         when (select count(*) from written) = 0 then 'none'
         when (select count(*) from marked)  = 1 then 'profile'
         else 'roster'
       end;
SQL
)"
      case "$resolved" in
        none)
          die "$addr is not on the roster, so there was nothing to re-admit.
    If they signed in under a different spelling, unrevoke that too."
          ;;
        *profile*)
          say "+ $addr  re-admitted"
          ;;
        *)
          say "+ $addr  re-admitted on the roster"
          say "  ! no account found, so there was no profile row to clear."
          say "    Nothing else to do — they can now sign in."
          ;;
      esac
    done
    ;;

  drop)
    # Real, but fenced. `drop` removes the roster row and nothing else: a
    # member with a live profiles row keeps working, and re-adding them later
    # re-admits them silently. That is what makes it the wrong tool for a
    # withdrawal and the right one for cleaning up somebody who never signed
    # in — so it exists, and it makes you say so out loud first.
    say "drop removes the ROSTER ROW ONLY. It does not withdraw anybody:"
    say "  · a member with a live profiles row keeps working"
    say "  · adding them back later re-admits them silently"
    say ""
    say "To withdraw somebody, use instead:  revoke $*"
    # Every address, not just the first. The loop below drops all of "$@", so
    # confirming only "$1" would type one address and delete three.
    printf 'Type all %d address(es) again, space-separated, to confirm: ' "$#"
    read -r confirm
    [ "$confirm" = "$*" ] || die "did not match, nothing dropped"

    for addr in "$@"; do
      n="$(norm_sql "$addr")"
      q >/dev/null <<SQL
do \$\$
declare
  v text := $n;
  u uuid;
begin
  if exists (select 1 from profiles p where p.email = v)
     or exists (select 1 from auth.users u where lower(btrim(u.email)) = v) then
    raise exception 'refusing to drop %: they have an account', v
      using hint = 'use: ./scripts/beta-roster.sh revoke ' || v;
  end if;
  delete from beta_access where email = v;
end \$\$;
SQL
      say "x $addr  roster row removed"
    done
    ;;
esac