# Deployment

How to run the orchestrator yourself, and what the container deliberately
does not contain.

## The one idea that makes the image small

Brotto's product path is the **Chrome extension driving the user's own
browser** over the DevTools Protocol. The server holds the agent loop and
reasons about what the browser reports. The server never launches a browser.

Playwright is therefore a **test-only** dependency: it lives in
`requirements-dev.txt` and the `dev` dependency-group in `pyproject.toml`,
and is not installed by the `Dockerfile`. The previous image ran
`playwright install chromium --with-deps`, which added a browser and its OS
dependencies to an image that is a documented self-host quickstart
(`README.md`, "Try it"). Dropping it is most of the size difference.

The runtime dependency list is 7 pure-Python packages.

The image lands at ~510 MB, and it is worth saying where that goes so nobody
re-adds a browser chasing the number: `python:3.12-slim` is the base, and
`pip install` of the provider SDKs is 193 MB of it, with 29 MB of wheels in
the builder layer. There was a 145 MB figure here for a while. It was Docker's
*shared size* column read as the image size, and `docker images` prints both.

## Sizing a VM

The memory ceiling is one in-flight model call streaming out of the
process. It is not a Chromium per tab, because there is no Chromium. A
2-vCPU / 2–4 GB VM is comfortable for a handful of concurrent users; below
1 GB works for one or two. Cost at that size is a few euros a month on any
common provider.

Under bring-your-own-key the operator pays orchestration CPU and never
model tokens — the model bill belongs to the person using the extension.
That is what keeps a small VM viable.

## Running it

```bash
export AGENT_SECRET="$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')"
docker compose up -d
```

Or straight from the image:

```bash
docker build -t brotto .
docker run -p 127.0.0.1:8000:8000 -e AGENT_SECRET="$AGENT_SECRET" brotto
```

Both refuse to start without `AGENT_SECRET`, and refusing is the point:
`${AGENT_SECRET:?…}` in `docker-compose.yml` is a readable error rather than a
bare `stat .env: no such file`, and the CLI refuses a non-loopback `--host`
with no credential at all. It will not generate a secret for you, because one
that changed on every container restart would force a re-paste into the
extension each time — a worse failure than the one it removes.

State lives on a named volume at `/data`. All three directories must be on it
or session history and security policy are lost on every restart:

| Variable | Default | Holds |
|---|---|---|
| `BROTTO_SESSIONS_DIR` | `logs/sessions` | Per-session audit documents, scratchpads |
| `BROTTO_USER_POLICY_DIR` | `logs/user_policies` | The user's secure-mode policy |
| `BROTTO_USER_MODEL_DIR` | `logs/user_models` | The user's remembered model config |

The volume is named `brotto-data` explicitly rather than left to compose's
default. Compose otherwise namespaces it as `<project>_brotto-data`, where the
project is **the checkout directory's name** — so cloning into `~/brotto`
instead of `~/work/brotto` starts a fresh, empty `/data`, and every session
document reads as gone with nothing anywhere saying why.

## Running it from source is a *development* server

The README offers a from-source path next to `docker compose up`, and it is the
one most likely to be followed by someone working on Brotto rather than
deploying it. Run exactly as that path used to read and you get a dev server,
because `BROTTO_ENV` is unset and unset means dev:

```bash
BROTTO_ENV=prod \
AGENT_SECRET="$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')" \
  PYTHONPATH=services/brotto-orchestrator/src \
  .venv/bin/python -m brotto_orchestrator.cli --port 8000
```

Measured, not inferred — booting the old form and reading `/health` back:

```json
{"status":"ok","service":"brotto-orchestrator","version":"2.0.0",
 "model":"minimax:MiniMax-M3","auth_mode":"open"}
```

`auth_mode: open` is the dev default rather than a bug, and `model` naming
`minimax:MiniMax-M3` is the dev pre-seed — a model nobody on this install chose,
pointed at whatever `ANTHROPIC_AUTH_TOKEN` the developer's shell happens to
carry, because dev propagates it into `ANTHROPIC_API_KEY`. **A self-hoster
reading that field would think they had configured something.** The container
sets `BROTTO_ENV=prod` in `ENV` and again in compose's `environment:`; nothing
sets it on this path.

The second difference is where state lands. With no volume, the three
directories fall back to `logs/sessions`, `logs/user_policies` and
`logs/user_models` **relative to the working directory**, so they are inside
the checkout — and `rm -rf` on a re-clone takes the user's session history with
it. The container's named volume is what makes the state survive a directory
being deleted.

This is why the two paths are not interchangeable in the docs, and why the
one-command installer being planned is a *shortening* of the container path and
not a replacement for it. See the README's Self-host section.

## Moving from `python main.py` to the container

Nothing is lost and nothing needs converting; the files are copied as they
are. **Session history is not caller-keyed**, so it transfers untouched — but
the two policy/model stores *are* keyed, and that is the one thing to read
before you start.

```bash
docker compose build
docker run --rm -v brotto-data:/data -v "$PWD/services/brotto-orchestrator/logs:/src:ro" \
  brotto-orchestrator sh -c '
    mkdir -p /data/sessions /data/user_policies /data/user_models
    cp -a /src/sessions/. /data/sessions/
    cp -a /src/user_policies/. /data/user_policies/
    cp -a /src/user_models/. /data/user_models/'
docker compose up -d
```

The container is not up while this runs, so nothing is writing to the source
tree. Copy *before* the first `up`, not after: the container creates the three
directories on startup, so a later copy lands in a directory the running
server already owns.

**The policy and model stores are keyed by the extension's install id, not by
anything the container can see.** They used to be keyed by the peer address,
which a container sees as the docker gateway — so a user moving from a local
server, where the key was `127.0.0.1`, lands in a different file and silently
starts again with an empty blocklist. The id is generated by the browser, so
there is no value to rename the file to ahead of time; the first task after
the update writes the new one. Anything worth keeping has to be re-approved
once. See `extension.md`, "The install id is the user".

## Retention

`BROTTO_RETENTION_DAYS` ages sessions out. It is **unset by default**, and that
is deliberate: the disk is the user's own, and a self-hoster who has never
heard of the variable should keep everything.

```
BROTTO_RETENTION_DAYS=30     # drop anything untouched for a month
BROTTO_RETENTION_DAYS=0      # off — and NOT "delete everything"
BROTTO_RETENTION_DAYS=thirty # nonsense, logged, sweep skipped
```

The sweep runs once at startup and hourly after that. Startup is the part that
matters: a setting that only took effect after the next task would arrive long
after the disk filled up. A session with a live agent loop is never pruned at
any age, and a pruned session takes its scratchpad with it — a document that
outlives its own digests is worse than no retention.

Age is the document's mtime, which the atomic rewrite bumps on every step, so
this measures last activity rather than when the session started.

**A second pass sweeps the orphaned `*.owner` sidecars** (`_prune_orphan_owners`).
The pass above is document-driven — it globs `*.json` — so a `<session_id>.owner`
whose document is gone was invisible to it, and on the hosted relay retention is
on by default at 30 days, which made the promise a file type it was silently not
covering. **The condition is "the document is absent", not age**, and that
distinction is load-bearing: `.owner` is written once at mint and never touched
again, so its mtime is the *start* of the run while the document's is the last
activity. A month-long session has a fresh document beside a 40-day-old sidecar,
and sweeping on age would silently drop a live session out of a scoped *erase
all*. Live sessions are skipped for the same reason the document loop skips
them. Operationally: the 30-day promise on the relay now covers the sidecars,
and it is the sidecar that says whose transcript a file was.

**The hosted relay is the one exception, and it is an exception because the disk
is ours.** Left unset, `BROTTO_RETENTION_DAYS` returns `HOSTED_RETENTION_DAYS`
(30) when `auth_mode() == "jwt"` and `None` everywhere else. A self-hoster's disk
is their own data and nothing expires until they ask; an ephemeral dyno would
otherwise keep every beta transcript for the life of the filesystem with nobody
deciding that. **An explicit setting always wins, including `0`.**

## `BROTTO_VISION_CAPTURE` opens the one channel redaction cannot see

When nothing the browser can read is about the task — a `<canvas>`, a chart,
Google Docs, a spreadsheet whose grid has no accessibility representation — the
agent has nothing to work from, and with this set it asks the extension for a
JPEG of the visible viewport. That is broader than an empty page: a page with a
full toolbar and a couple of hundred characters of chrome photographs too.

```
BROTTO_VISION_CAPTURE=on     # capture
BROTTO_VISION_CAPTURE=true   # same
BROTTO_VISION_CAPTURE=false  # refused
BROTTO_VISION_CAPTURE=0      # refused
BROTTO_VISION_CAPTURE=yes    # capture
BROTTO_VISION_CAPTURE        # unset — refused
```

**Off unless explicitly on**, and only those four spellings turn it on. That is
the same safe reading as `AGENT_SECRET` and `BROTTO_RETENTION_DAYS`: a stray
`BROTTO_VISION_CAPTURE=false` in a `.env` is a *refusal*, and anything
unparseable is off rather than a decision somebody meant. The asymmetry is the
point — capture is a **new egress channel**, where redaction having no off
switch only ever narrows what leaves.

It is unset everywhere by default, self-host and relay alike, so a fresh
install cannot photograph anything. The user's own domain blocklist refuses a
capture regardless of this switch, and the domain check is deliberately second,
so a run with capture off is not told anything about the URL it was on.

Do **not** set it in the deployment `.env` beside `docker-compose.yml` on the
operator's behalf. The reasoning — and the case for a URL denylist having been
rejected — is in `privacy.md`, "A screenshot is a gate, not a redaction pass".

## The hosted relay

The same image, the same extension, one build. `agent.brotto.dev` is a Heroku
dyno running this container with Supabase in front of the credential check.

**The relay is the alternative, not the successor.** Self-hosting — everything
above — stays free, needs no account, carries no cap, and puts no operator
between the agent and the user's documents; the relay trades that last property
for reach. Anything describing this file as a migration toward the relay has
that backwards.

**A hosted relay is one env var away from a downgrade, and the variable that
makes it a downgrade is `AGENT_SECRET`.** `SUPABASE_JWT_SECRET` set →
`auth_mode()` is `jwt` and every `AGENT_SECRET` in the world is ignored. That
precedence is deliberate: a hosted relay that still accepted `AGENT_SECRET`
would hand every beta user a shared secret, and it would do so *quietly*,
because both variables being set looks like a config mistake rather than a
downgrade. **If a hosted deployment is rejecting valid sign-ins, check for a
stray `AGENT_SECRET` first.**

| Variable | Required | Holds |
|---|---|---|
| `SUPABASE_JWT_SECRET` | hosted | The project's JWT secret. **Its presence is what selects `jwt` mode** — there is no `BROTTO_AUTH_MODE`. |
| `SUPABASE_URL` | hosted | `https://<project>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | hosted | Reads `profiles` at task start (revocation + cap) |
| `SUPABASE_ANON_KEY` | hosted | The two sign-in routes only |
| `BROTTO_RETENTION_DAYS` | optional | Defaults to **30** on the hosted relay, off elsewhere |
| `BROTTO_BETA_TASK_CAP` | optional | Weekly per-person task cap; defaults to 10 |
| `BROTTO_WAITLIST_BATCH` | optional | Label stamped on waitlist signups, so the operator can tell which invite round a row went out in. Empty by default |
| `RESEND_API_KEY` | optional | Sends the waitlist confirmation. **Unset means no mail is ever sent**, and the route behaves exactly as it did before the feature existed |
| `RESEND_FROM` | optional | Defaults to `Brotto <hello@brotto.dev>`. Also supplies `reply_to` and `List-Unsubscribe` |
| `BROTTO_VISION_CAPTURE` | optional | **Leave it unset on the relay.** When set, a canvas page the tree cannot read is photographed and sent unredacted to the provider; the operator cannot see it per user, cannot bound it per user, and every per-user policy is only a domain blocklist |

All four Supabase values are in Project Settings → API, and none of them belong
in `.env.example` — which is why that file ships them **commented out**, which
also means the file is not a place a hosted operator looks first.

**`SUPABASE_JWT_SECRET` is verified locally, per request, with stdlib `hmac`.**
Not by calling Supabase. A network hop there would make the liveness of every
agent loop depend on a third party's uptime, and resolving an opaque token
against a claims map would be the server-side session state D9 rules out. The
alg check happens *before* the signature comparison: a token naming `none`, or
naming RS256 and carrying a public key as HMAC material, must never reach
`compare_digest`. The secret decides which algorithm is acceptable, not the token.

### Run the migration before the first deploy

The relay reads one table, and it is not created by the application:

```bash
psql "$SUPABASE_URL" -f supabase/migrations/001_profiles.sql
```

There is no migration runner. `profiles` is the operator's ledger **over**
`auth.users` — who is in the beta, who has been withdrawn, how much of their
weekly allowance is gone — and **a row is the invitation**. Absent one, a
perfectly valid JWT is refused `not_invited`. That is the whole gate, and it is
one table rather than a users table plus a usage table plus a grants table,
because invitations are hand-issued SQL and a schema spread across three tables
is three statements an on-call operator forgets at 2am.

`revoked_at` is a column, not a row delete: *"we removed this person"* is an
audit question, and `on delete cascade` would take the evidence with it — the
`auth.users` row *is* the evidence. **But the column is not itself durable**:
because `profiles.id` cascades from `auth.users`, deleting the auth account
deletes this `revoked_at` too, and a re-signup on the same address is admitted
fresh. That is why the withdrawal also lands on `beta_access.revoked_at`, which
is not a foreign key — see *The roster admits; `revoked_at` withdraws*.
`tasks_this_week` resets by **comparing
`week_start` to `current_date` on read**, with no scheduled job: a cron that
resets a counter ten people move a few hundred times is a cron that quietly
stops running, and the failure mode is one user's beta ending for no visible
reason.

**The same file enables RLS and defines `reserve_task_slot`.** Two things that
are not optional, both added before any beta database was stood up:

- **`alter table profiles enable row level security` with zero policies, plus
  revokes on `anon` and `authenticated`.** `SUPABASE_ANON_KEY` is *public* by
  Supabase's own design — it is the key every browser client is expected to
  ship, and the two sign-in routes here read it server-side; **the extension
  bundle does not contain it** — so the default grants are not a
  threat model, they are the starting state. Without this, the project URL and that key are
  enough to read the beta roster and write to it: set your own `revoked_at`
  back to null, or zero your own counter, without touching the relay at all.
  The relay needs no policy because it reads and writes with the **service role
  key**, which bypasses RLS by design.
- **`reserve_task_slot(uid, cap)`** is the weekly cap's only write path, because
  read-then-write is a race: two task starts for one account both read
  `used = 9`, both pass, both write 10, and one task is granted past the cap.
  It is a single conditional `UPDATE … WHERE … tasks_this_week < cap RETURNING`,
  with the week reset in the `SET`, so Postgres does both under one row lock. A
  zero-row result is `task_cap_reached`.

**If a database was created from an earlier copy of this file, drop and re-run
it** — there is no migration runner, so editing `001` in place only reaches a
database that has not been created yet.

### The other two migrations, run by hand the same way

```bash
psql "$SUPABASE_URL" -f supabase/migrations/002_failure_reports.sql
psql "$SUPABASE_URL" -f supabase/migrations/003_waitlist.sql
```

**Every migration is applied by hand, before the deploy — `001` through `010`.**
There is no migration
runner and no GitHub integration that applies them on merge — `scripts/test-migrations.sh`
runs them against a throwaway local Supabase in CI to prove they parse, and
nothing applies them to the real project. That is the whole reason the "edit
`001` in place" warning above is there, and it is why the ordering in the file
names is the ordering you type.

Same posture as `profiles`: no migration runner, RLS with zero policies plus
revokes on `anon` and `authenticated`, written only by the service role.
`003` created a `waitlist` table with a `unique` on `email`, because a
double-clicked submit must not create two rows and a read-then-insert is a race
a double-click wins. **`010` later dropped `waitlist` and merged it into
`beta_access`** — see the last section of this runbook — so on a database that
has run `010` there is no `waitlist` table and the unique is the `beta_access`
primary key. **Without `003` (or `010`) run, `POST /v1/waitlist` answers 502 on
every signup** and the log says only that an insert was refused — the marketing
page will report a success-looking failure. See `docs/architecture/privacy.md`.

### The allowlist, and the waitlist's name column

```bash
psql "$SUPABASE_URL" -f supabase/migrations/004_beta_access.sql
psql "$SUPABASE_URL" -f supabase/migrations/005_waitlist_name.sql
psql "$SUPABASE_URL" -f supabase/migrations/006_waitlist_email.sql
```

Three files rather than one `004`, because they are unrelated: `004` creates a
table, `005` and `006` each alter an existing one, and lumping them couples
three changes whose rollback should not be coupled. `004` and `005` are additive
and neither touches a row.

`004` is `profiles`' admission decision expressed as an **address** instead of an
account id, so the operator bulk-pastes a list instead of minting one
`auth.users` row per person. `email text primary key`, already normalised by the
caller — no normalisation function in SQL, so there is one rule to keep in step,
not two. It carries **no `owner` column**: the address is matched against the
`email` claim on a verified JWT, never against a body field. `approved_at` was
filled by a column default in `004` and is written by `beta-roster.sh` alone as
of `010`, which also dropped that default — a default is a grant. (`added_by` was
a fourth column and is gone as of `009` — only `beta-roster.sh` ever wrote it,
and nobody read it.)

**Admitting and withdrawing a member is `scripts/beta-roster.sh`, and it is
deliberately not an HTTP route.** An admin route that appends addresses is an
unauthenticated or weakly-authenticated write into the front door of the hosted
beta, and no amount of "it's behind a token" makes that the same thing; the
script runs on your own machine over the Supabase CLI's linked-project
credentials, so there is nothing remote to compromise. It is also the *only*
way an address enters or leaves the roster:

```bash
./scripts/beta-roster.sh add you@example.com them@example.com
./scripts/beta-roster.sh list
./scripts/beta-roster.sh revoke someone@example.com
./scripts/beta-roster.sh unrevoke someone@example.com
./scripts/beta-roster.sh drop someone@example.com
```

**A withdrawal sets `revoked_at` on *both* tables, as one SQL statement.**
Neither write is sufficient alone:

- The `beta_access` write refuses *re-admission* at sign-in — a different job
  from stopping a working member. `authorize_task_start` is the thing that
  actually stops a working member at every step, and it reads
  `profiles.revoked_at` and **never consults the roster**, so the roster write
  alone withdraws nobody who is already signed in, and leaves a withdrawal on
  record that says otherwise.
- The `profiles` write is the only one of the two that **survives the auth
  account being deleted**: `profiles.id` is `on delete cascade` from
  `auth.users`, so deleting the account deletes the profile *and* its
  `revoked_at`, and a re-signup on the same address would otherwise be
  re-admitted fresh. A cascade erases only the second, which is why it cannot be
  the whole procedure.

One statement rather than a transaction with a guard, because that is what makes
skipping the `profiles` half safe: the roster write is never in doubt, so a
withdrawal that missed a profile cannot leave a torn pair behind.

**The refusal is on the roster lookup, and only the roster lookup.** Both tables
store email already normalised — the caller strips and lower-cases before
writing — so a bare `where email = 'Foo@Bar.com'` matches **zero rows, reports
success, and withdraws nobody**, with nothing in any log to say so.
`lower(btrim(...))` is written into the SQL rather than left as prose, and an
address that is **not on the roster at all** dies there with nothing to undo,
because a mistyped address withdrawing nobody is the one failure the command
exists to prevent. Only the roster is where a wrong address is still wrong.

**The `profiles` half is keyed on the account id, not on the address.**
`profiles.email` is written once, by `approve_at_exchange`, from the verified
JWT claim at first sign-in, and is never updated afterwards — if the member
changes their Supabase email that column keeps the old spelling for good, and
`update profiles … where email = v` silently matches nothing. So the procedure
resolves the address to an id and updates by `profiles.id`, which is the stable
key, in **two lookups in order**: `profiles` first, because that is the spelling
the address was *admitted* under and therefore the spelling on your own list;
then `auth.users`, whose `email` is written by Supabase's signup path rather than
by us and so is the only one of the three not stored normalised, which is why it
alone carries the `lower(btrim(...))`.

**Neither resolving warns rather than raising, and that is a correction.** The
procedure this replaced raised `no account for <address>` whenever the two
lookups both came back empty, on the reasoning that a rostered address which
never signed in is indistinguishable from a mistyped one. **The raise threw away
the half that matters.** `beta_access.revoked_at` is the only part of a
withdrawal that outlives the auth account, so a raise — which aborts the
transaction — rolled back the roster write, the one write that would still have
been standing had the account been deleted a month later, and kept the one the
cascade recreates unrevoked. Every exit from that branch left the member *less*
withdrawn than you asked, while looking like a loud, correct refusal. So the
roster write now always lands and the script names which half it skipped. The
failure the raise was trying to prevent is still prevented, and more cheaply:
the script reports which of the two rows the statement matched. Silence would be
the bug; the raise was not the fix.

**A duplicate paste answers 409, and that no longer means "admitted".** Since
`010`, already-there means *asked* (`asked_at` only — a waitlist signup),
*granted* (`approved_at` set, `revoked_at` null) or *withdrawn*, and all three
return the same 409. One line tells them apart:

```sql
select email, asked_at, approved_at, revoked_at from beta_access
 where email = lower(btrim('x@example.com'));
```

Only `approved_at` set with `revoked_at` null is a live grant; a waitlist row
needs `beta-roster.sh add` to become one, and a timestamp on `revoked_at` is a
withdrawal already on record, pasting which changes nothing —
`_listed_for_beta` refuses a row whose `revoked_at` is set or whose `approved_at`
is null, and `add` refuses to clear `revoked_at` for you
and points at `unrevoke` rather than reinstating somebody on purpose.
**Re-admission is `beta-roster.sh unrevoke`** — the same two writes with the
values nulled, roster first, same two-lookup order, because
`authorize_task_start` reads only `profiles`. **It skips the raise for the same
reason the withdrawal does, and here skipping is the whole point**: the account
is frequently *gone* by the time anybody re-admits, and raising would abort the
transaction and leave them **withdrawn**, the one state you asked to leave.
`004`'s header carries all of this in full.

Deleting the roster row afterwards is optional housekeeping and withdraws
nobody on its own; do it before the `revoked_at` update and you have closed a
door that was never locked. See `docs/architecture/privacy.md` § *The roster
admits; `revoked_at` withdraws*.

**A pipeline must never turn a waitlist signup into a grant.** `POST /v1/waitlist`
is reachable with no credential at all; it may set `asked_at`, `name` and
`batch` and never `approved_at` or `revoked_at`, which `beta-roster.sh` alone
writes. That used to be "the two tables must never be joined"; `010` made them
one table, so the boundary is the columns the unauthenticated path may name.
A stranger's row becoming an invitation by pipeline is still the membership
oracle. See `docs/architecture/privacy.md`.

`005` adds a `name`, nullable and with no default, so a blank field
stays absent rather than becoming a string the visitor never sent.

`006` is the same spreadsheet guard `005` gave `name`, applied to the column
`005` left open. **It backfills before it constrains**, so a row typed before
the constraint existed cannot fail the `ADD` and take the migration with it.
Unlike the name, the server **refuses** a triggering address rather than
quoting it: a name is text we want back in the export, but an email is an
identifier that has to round-trip, and a stored `'+tag@example.test` is no
longer the mailbox that person signs in with. Nothing is lost by the refusal —
a `+tag` address and the base address are the same mailbox, so the visitor
submits the plain one. See `docs/architecture/privacy.md`.
(`005`/`006` guarded the old `waitlist` table; `010` carried both formula
CHECKs onto `beta_access`, renamed for the table they now protect.)

### `010` merges `waitlist` into `beta_access` — one list, one row per address

```bash
psql "$SUPABASE_URL" -f supabase/migrations/010_merge_waitlist.sql
```

**`waitlist` is gone; run this after `003`–`006` on an existing project, or
just in order on a fresh one.** The two tables had the same key and answered one
question between them, with the join done twice — in `beta_status`'s `case` and
again in the relay's sign-in lookup. One table now, and the row carries
`asked_at` (they asked), `approved_at` (we granted), `revoked_at` (we withdrew),
plus `name` and `batch`. `public.beta_status(addr)` keeps its signature and
derives the same four answers from one row — `revoked` beats `admitted` beats
`pending` beats `none`, which is `009`'s arm order and is the policy, not a
detail.

**Two things in it are load-bearing and easy to miss.** `approved_at` has **no
default** — a default is a grant, and the waitlist write path inserts a row
without naming the column, so a default would hand every stranger who asked the
beta. And the readers ask for `approved_at`, not for row existence: since a row
can be a mere request, "a row is the invitation" stopped being true in `010` and
**a lookup that still treats existence as admission hands every waitlist signup
a beta account**. The header of the migration is the design record. See
`docs/architecture/privacy.md`.

### The confirmation email, and the two variables that switch it on

A signup is confirmed by an email we send ourselves, through Resend's HTTP API
(`session/waitlist_email.py`). It is **not** Supabase's mail — Supabase's own
email caps at 2/hour and is scoped separately as an Auth SMTP provider, which is
unbuilt and is a different change.

| Variable | Default | Effect |
|---|---|---|
| `RESEND_API_KEY` | unset | **Unset is the whole off switch.** No key, no socket opened, no attempt made — a self-hosted box must not send anything at all, so this is not a degraded mode, it is the mode it is always in |
| `RESEND_FROM` | `Brotto <hello@brotto.dev>` | The `From` header, and the source of both `reply_to` and `List-Unsubscribe`. `brotto.dev` is verified on Resend |

Both are read at call time, not at import, for the same reason `AGENT_SECRET` is
— `load_dotenv()` runs during startup and several tests set the environment
after import.

**Nothing about the confirmation can fail a signup.** The row is written first,
so a Resend 500, a timeout, or a dead writing page leaves the response and the
table exactly as they were. `POST /v1/waitlist` still answers `200 {"ok": true}`
and the send hangs off a background task that runs after the response is on the
wire — which is also what keeps the two possible answers (new address or
duplicate) identical in time as well as in body. Neither the visitor's answer nor
a log line reveals which one happened; see the oracle rule in `privacy.md`.

**A mail is confirmed to nobody twice**: `List-Unsubscribe` is a
`mailto:` header, and there is deliberately **no `List-Unsubscribe-Post`** —
there is no one-click endpoint, and advertising one that 404s is worse than not
having it. The footer carries the same `mailto:` as a one-word link.

**The mark is an inline CID attachment, not a remote `<img>`.** Gmail blocks
remote images until a human clicks, which would put a broken-image box in the
masthead, so `brotto-mark.png` is attached with a `content_id` the HTML
references as `cid:brotto-mark`. The file lives in the package
(`brotto_orchestrator/session/`) and `pyproject.toml` ships it as package data —
**the extension's `dist/icons/` cannot serve here**, because `dist/` is a
gitignored build artifact and the Dockerfile copies `src` only. Verified by
building the wheel; if it is ever missing the mail still sends, with the
wordmark and a gap where the mark was.

### `BROTTO_BETA_TASK_CAP` is a rollout knob, not a policy number

The cap exists because the rollout is **batched off a waitlist**, and the first
batch is not the last batch. The superseded "start at 10" and the reasoning that
spent it are in `docs/product/decisions/2026-10-11-waitlist-and-batched-rollout.md`
(gitignored — a clone has none of this). What must not change is the property
the cap was protecting: every invited person is a row the operator can see,
revoke and count, and revoking one is one command with no UI to rebuild.
**Watch for "the list grew" becoming the reason to build an admin screen — the
honest trigger is forgetting twice.**

### A wide bind with no credential is a refusal

`cli.py` refuses to start on a non-loopback `--host` when `auth_mode() ==
"open"`. This is the pair that makes the startup warning safe to keep as a
warning, and the check lives there because **it is the only layer that knows the
bind address** — the server is handed a port, so it can report "no credential"
but never "no credential AND reachable from the internet". Both shipped launch
paths (the Dockerfile `CMD`, the `Procfile`) go through this CLI.

It keys on `auth_mode() == "open"`, not on "is `AGENT_SECRET` set", because the
hosted relay sets no `AGENT_SECRET` at all and the older check refused to boot
the one deployment that *does* have a credential.

## `BROTTO_PRO` switches the paid half on; cost is off without it

Per-run cost and the per-task ceiling are paid features. The free build has
both the code and no way in: `BROTTO_PRO` is unset, `_catalog_for` returns
`None`, and since that is the only path by which the loop reaches a price, the
turn goes unpriced, `TaskResult.cost_usd` stays `None`, and the panel renders
nothing because it only draws a cost it was handed.

| `BROTTO_PRO` | what the orchestrator does |
|---|---|
| unset | no pricing, no cost shown, no ceiling |
| `1` / `true` / `yes` / `on` | every turn priced from `model/catalog.py`, cost shown in the panel, `BROTTO_MAX_TASK_COST_USD` honoured |

**One gate, not three.** Pricing, the panel line and the ceiling are the three
things that have to be off together, and they are all downstream of
`_catalog_for`. A second guard in the panel or in `_close` would be a second
place for a free build to leak one of them.

Pricing comes from `model/catalog.py` rather than from the model's own usage
record — pydantic-ai has no cost calculation for `AnthropicModel`, so on Claude
and MiniMax that field is always `0`.

Under Pro, set `BROTTO_MAX_TASK_COST_USD=0.50` to stop a run that crosses it.
The check sits at a step boundary, after the step was billed and recorded but
before its actions dispatch, and seals the run with
`failure_reason="budget_exhausted"` and both amounts in the summary. A
`BROTTO_MAX_TASK_COST_USD` that arrives **without** `BROTTO_PRO` is refused
with a warning rather than half-honoured — a free build that can be capped is
still a build that knows what things cost.

**The ceiling is unset even under Pro, and that is deliberate.** Brotto is
self-hosted, the key belongs to the user, and on a subscription the money is
theirs too — a default ceiling would spend their tokens for them. Set it when
the key is one whose bill is not theirs to decide. A non-positive or
unparseable value arms nothing and logs a warning.

**A ceiling cannot bound what nothing can price, or what nothing costs.** A
model the catalogue has no entry for is not automatically unpriceable —
`AGENT_INPUT_PER_MTOK` / `AGENT_OUTPUT_PER_MTOK` (or the per-user
`logs/user_models/<ip>.json`) state a rate the catalogue lacks, and a
**catalogue rate always beats a stated one**; `model-config.md` owns all of it.
What still arms nothing is a model priced at `$0.00` — a local box genuinely
costs its user nothing per token, and `BROTTO_MAX_TASK_COST_USD` cannot be
crossed by zero. `pricing.is_unenforceable()` detects that case and the harness
**warns at task start**, because the operator is the one who has to know their
cap is not live. Neither case is passed over in silence.

## `BROTTO_ENV=prod` is a cost control
`BROTTO_ENV` defaults to `dev`, and dev pre-seeds
`AGENT_MODEL=minimax:MiniMax-M3` and propagates `ANTHROPIC_AUTH_TOKEN` into
`ANTHROPIC_API_KEY`. A user who connects without pasting a key therefore
resolves a working model **on the operator's key** and spends the operator's
credits. It does not error; it looks like a successful run.

The `Dockerfile` and `docker-compose.yml` both set it. The same reasoning is
why no model key is ever baked into the image: image layers are recoverable
even after a later layer is deleted, so a key in a layer is a published key.

Note there are two `.env` files and they are not interchangeable — the
deployment one beside `docker-compose.yml` holds only `AGENT_SECRET`;
`services/brotto-orchestrator/.env` is the development one and contains a
model key. `.dockerignore` excludes both from the build context.

## Reverse proxy and TLS

The extension needs a `wss://` URL. Put Caddy or nginx in front for TLS.
`AGENT_SECRET` gates `/ws/ext` and the session endpoints, so widening the
bind to `0.0.0.0` is only safe once one is actually set — with an unset
secret every caller is trusted, and the startup log says so. The extension
carries the secret in Settings → Connection; the relay sends it as a
WebSocket **subprotocol**, not a query parameter, because `?token=` writes
it in plain text into the access log of this server and of any proxy in
front of it, permanently. The server selects the protocol *name* back
(`brotto-v1`) rather than echoing the secret.

### One worker, and it is an invariant rather than a tuning knob

`SessionRegistry` is a plain in-process dict. `POST /v1/sessions` mints the
session id into whichever worker served that request, and the WebSocket the
extension opens next is load-balanced independently — so on two workers
roughly half of all runs die on "session not found". Shared state has to move
to Redis before the ceiling moves.

Hosted platforms set `WEB_CONCURRENCY` themselves rather than asking: Heroku
sends 2. uvicorn reads that as "restart me", refuses an app object with
*"You must pass the application as an import string"* and exits **3**, which
reads as a crash with no cause in the log. Passing the import string is the
wrong fix — it would have started two workers and produced the failure above.
`cli.py` passes `workers=1` so the ceiling holds on every host, including
Docker, instead of relying on a deploy config that is not in the repo.

### The advertised address is the caller's, not `localhost`

`/v1/sessions` returns a `websocket_url`, and `background.ts` dials it
**verbatim** whenever it starts with `ws`. A hardcoded `ws://localhost:8000`
therefore hands a remote client a socket pointed at its own machine, and the
run dies silently on connect with nothing in either log. Both URLs are derived
from the request instead, with the scheme taken from `X-Forwarded-Proto` and
mapped to `wss://` — behind a TLS terminator a bare `ws://` will not handshake.

`Host` and `X-Forwarded-Proto` are caller-supplied and both reach a URL that
gets dialled, so the scheme is narrowed to `http`/`https` and netloc passes
`_HOST`, the same one-safe-alphabet discipline as `_UUID`. Colons are in that
set because Starlette builds an IPv6 netloc **unbracketed** (`::1:8000`, not
`[::1]:8000`) — a stricter alphabet answers 400 to every IPv6 self-host. What
the filter actually keeps out is CR, LF, space and `/`. The URL is no longer
logged at all; the session id is the correlation handle.

### A refused key looks like a missing route

A wrong `AGENT_SECRET` is answered **404, not 403** — 403 would confirm the
route is worth probing — so on its own it is indistinguishable from "no such
endpoint", which is what every extension caller used to report. The panel
spent three retries and three "Server unreachable" toasts telling a
self-hoster to debug a server that was running perfectly.

`/health` is the separator, and it works only because it is
**unauthenticated**: the Docker healthcheck needs it, and it is the one probe
that answers when the server is up and throws when it is not. An
authenticated 404 plus a live `/health` means the key. Three call sites read
that pair — session create (`describeAuthFailure`, `background.ts`), the
Settings save (`sidepanel.js`) and the first-run wizard (`welcome.js`) — and
each *stops* rather than retrying, because attempt 3 returns the same refusal
as attempt 1.

The startup warning names the `.env` beside `docker-compose.yml` for the
same reason. No secret is generated for the user on purpose: an ephemeral one
would change on every container restart and force a re-paste each time, which
is a worse failure than the one it removes. The wizard collects it once and
stores it in `settings.agentSecret` — `storage.local`, not `storage.session`,
because it is a property of the server the user chose rather than of the
session. (The *model* key is a different key, also in `storage.local`.)

### A custom domain does not get a certificate on its own

Heroku serves `*.herokuapp.com` from a wildcard that is already there. A
custom domain is not covered by it, and Heroku will not issue for one until
**Automatic Certificate Management is switched on for the app**:

```
$ heroku certs:auto
=== Automatic Certificate Management is disabled on brotto-orchestrator
```

That is Settings → SSL Certificate → Automatic Certificate Management →
Enable, in the dashboard. **There is no CLI command to enable it** —
`heroku certs:auto` only reports status, and `certs:generate` produces a
self-signed pair you then have to install on the app yourself. So the failure
mode is a correct CNAME and a healthy dyno with no certificate, and
`curl https://…` exits 35 with no server log line at all to explain it.

DNS resolving is necessary but not sufficient, and the two get confused: the
CNAME was right and verified (`heroku domains:wait` returned done) while the
cert never appeared. Add the domain *after* DNS resolves, or remove and
re-add it, if Heroku cached a pre-DNS check.

### Removing and re-adding a domain mints a new DNS target

The re-add trick above has a cost: **`domains:remove` followed by
`domains:add` assigns a fresh `*.herokudns.com` target and retires the old
one immediately.** The record still in DNS then points at a name that no
longer resolves, so the domain is not merely uncertificated — it is gone,
with no error on the Heroku side beyond `Unable to resolve DNS for …`.

```
$ dig +short round-mayflower-….herokudns.com A     # empty — retired
$ heroku domains
agent.brotto.dev  CNAME  clear-pig-….herokudns.com
```

Read the target back out of `heroku domains` **after** any re-add, and treat
it as the only authority on what DNS should say. Forcing a recheck is not
worth breaking a working name: check `heroku certs:auto` first, because ACM
being off is a dashboard toggle and never needed the re-add.

### `heroku config:get -s` still prints the variable name

```
$ heroku config:get AGENT_SECRET -s
AGENT_SECRET=wCtJm9ClXzBQYtGxEZHgaRZztlVLMuXaXHLrKQxW
```

The value is 43 characters; that line is 56. Sent as a bearer token it is the
wrong key by a 13-character prefix — which, per the section above, answers
**404**, the same status as a route that does not exist and the same status as
a dyno that is simply not there. Strip it:

```bash
heroku config:get AGENT_SECRET -s | sed 's/^AGENT_SECRET=//' | tr -d '\n'
```

**And never read the secret into an assistant transcript**, which is the
whole reason rotating is fiddly at all: the value only has to be read by the
person who will paste it. Run the command yourself, in your own terminal.

## What still needs doing before this is publicly reachable

Nothing is open. Each of these was a launch gate and each is closed as of
2026-10-03:

| Gate | Closed by |
|---|---|
| `/ws/ext` accepted any caller | `AGENT_SECRET`, sent as a WS subprotocol |
| `GET /v1/sessions` enumerated every task title | the same secret, 404 not 403 |
| Session deletion did not exist, or was partial | `DELETE /v1/sessions[/{id}]` |
| Nothing on disk ever expired | `BROTTO_RETENTION_DAYS`, swept at startup |
| `POST /run` launched a headless browser for anyone | refused outright when `BROTTO_ENV=prod` |
| `ax_diff` wrote page text into the audit document | a character count, and nothing else |
| `/v1/policy_ack` wrote a file under any key a caller chose | the same secret; the id is a uuid or it is not honoured |

Tests: `tests/test_agent_auth.py`, `tests/test_session_delete.py`,
`tests/test_retention.py`, `tests/test_run_refused_in_prod.py`,
`tests/test_caller_key.py`.

**The one dependency to keep in mind:** prod is what the *image* sets, not
what the code defaults to. `BROTTO_ENV` unset means dev — no secret required,
`/run` open, `AGENT_MODEL` pre-seeded. That is right for `python main.py` and
wrong for a box on a network, so `Dockerfile` and `docker-compose.yml` both
carry `BROTTO_ENV: prod` and a test asserts both. A hand-rolled install that
skips them is a development server, and the startup log says so.

## This image did not build until 2026-10-03

`docker compose up` from a clean clone — the quickstart the README leads with
— failed on the first step: the builder stage ran `pip wheel -r
requirements.txt` without ever copying that file in. The runtime stage below it
did copy it, which is exactly why the omission read clean in review. The build
had only ever been exercised against a working tree.

So: **a Dockerfile that has never been built from a clone has not been
verified.** The no-Chromium image, the empty `GET /v1/sessions`, the
404s without the secret, the state surviving `docker restart`, the retention
sweep firing at startup and `DELETE` taking the scratchpad with the document
were all measured on a fresh clone, and those are the only measurements in
this file that count.

CI now builds the image on every push and PR (`docker-build` in
`.github/workflows/ci.yml`), from the checked-out tree with no working-tree
state, which is the condition that was violated here. The omission survived
review because a build step and a reviewed file are different artefacts; the
job removes the gap between them. It builds but does not run the container —
`docker compose up` and the healthcheck are still verified by hand.

## The suite passed by accident, and coverage is what found out

Seven test files opened with `os.environ.setdefault("AGENT_AUTH_DISABLED",
"true")`. That runs at **import**, so it mutates `os.environ` for the whole
session and only in the order pytest happens to collect. Alphabetically
`test_agent_e2e.py` landed before `test_ws_protocol.py`, which is the only
reason the latter passed — and `main.py`'s `load_dotenv()` had already put a
real `AGENT_SECRET` from the developer's `.env` into the environment, so
`auth_enabled()` returned True for everything collected before the first
`setdefault`.

Turning on coverage is what surfaced it. `--cov` reorders the imports, 51
tests failed, and the honest reading was **not** "coverage breaks the suite"
but "the suite never depended on anything but collection order". A single
run reproduces it without any tooling:

```bash
AGENT_SECRET=whatever pytest tests/test_ws_protocol.py   # 13 failed
pytest tests/test_ws_protocol.py                          # 15 passed
```

The fix is one autouse fixture in `conftest.py` that clears `AGENT_SECRET`
and `AGENT_AUTH_DISABLED` per test, alongside the `BROTTO_FORCE_ENV_MODEL`
and `BROTTO_SESSIONS_DIR` fixtures that were already there for this class of
leak. It clears rather than pins them open: a test that needs auth *on* sets
both itself (`test_caller_key.py`, `test_agent_auth.py`), and a fixture that
forced them shut silently overrode exactly those.

Coverage is 77%. CI prints it and ratchets `--cov-fail-under=75` so it fails
on a *drop*; there is no target to climb to, and no test was written to move
the number.

## Deleting a session

`audit.delete(session_id)` takes the document, the scratchpad and the pages
sidecar together, and drops the session from the live registry. Two details
are the difference between a delete that works and one that looks like it
does:

- `Path.unlink(missing_ok=True)` returns `None` whether or not the file was
  there, so the first version of this reported success for a session that
  never existed. Catch `FileNotFoundError` instead.
- The agent loop holds an `AuditTrail` **reference**, not a registry lookup,
  so popping `_LIVE` does not stop its next flush from recreating the file.
  Every mutation goes through `_record`, so one `_deleted` flag there is the
  whole fix.

`DELETE` on a session that is already gone answers `200 {"deleted": false}`
rather than an error: a second delete is not a failure the user has to
understand. An unauthenticated one answers 404, like every other session
route — this server holds the user's own transcripts, and a 403 confirms
there is something worth probing.
