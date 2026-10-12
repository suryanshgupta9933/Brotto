# Privacy and data

Where the user's data physically is, why that is the whole privacy story, and
where it is going.

## The one fact everything else follows from

**The agent loop runs on the operator's machine. The browser runs on the
user's.** The extension drives the user's own Chrome over CDP and streams
observations back to the orchestrator, so the orchestrator necessarily
transits the full visible text of every page the agent reads, every step.

That is not a bug and BYOB does not fix it. BYOK means the *model key* is the
user's; the *pages* still come to us. Anything that claims otherwise is wrong.

So the privacy posture is not "we do not collect your data". It is:

> Your data transits our box for as long as the task runs, and **stops there**.
> What persists is on your machine, and the things we keep forever contain
> none of it.

## What lives where, today

| Data | Where | Lifetime |
|---|---|---|
| Page digests (200 chars each) | `logs/sessions/<id>.scratchpad.txt`, server | until deleted |
| AX-tree sizes, page-text chars, changed-element chars | inside the audit document, server | until deleted |
| Task title, action names, URLs, typed input | inside the audit document, server | until deleted |
| Model config, `base_url` | `chrome.storage.local`, user | until cleared |
| API key | `chrome.storage.local`, user | until the user clears it |
| Secure-mode policy | `logs/user_policies/*.json`, server | forever |
| Which account owns a session (`<id>.owner`) | beside the session, server | with the session |
| Waitlist signup (a name, an email, a batch label, a timestamp) | `waitlist` table in Supabase, server | until the operator drops it |
| Beta allowlist (an email, the row's insert timestamp, and a withdrawal timestamp once one is set) | `beta_access` table in Supabase, server | until the operator drops it |
| Waitlist confirmation (the address, in transit and in Resend's request logs) | `api.resend.com` | theirs, not ours |
| Audit request bodies | whatever the model provider logs | theirs, not ours |

The waitlist is the one row in that table that came from **a stranger** rather
than from an account, and it is covered by "Writing new code here" below —
see *The waitlist is the first data from someone who is not an account*.

**`beta_access` and `waitlist` must stay disjoint.** The allowlist
(`supabase/migrations/004_beta_access.sql`) is the same *admission decision* a
`profiles` row records, entered by address so the operator can bulk-paste a list —
and it stays a table the operator writes by hand. **Removing a row from it does
not revoke anyone** — see *The roster admits; `revoked_at` withdraws* below.
**Of its four columns only `email` and `revoked_at` are ever read**:
`_listed_for_beta` selects `select=email,revoked_at`, and the second is the
withdrawal — see *The roster admits; `revoked_at` withdraws* below.
`approved_at` exists because the table is a
ledger someone will ask "when", and it is filled by the column default rather
than by any path here; **`added_by` is written by nobody** — no code path
supplies it, so the column that looks like an author field is empty for every
row that exists. The moment
anything copies a
waitlist submission into it without a human deciding, `POST /v1/waitlist` — the
one route reachable with **no credential at all** — answers "is this person in
the beta?" to anyone who posts an address. A stranger's row becoming an
invitation by pipeline is that route turned into a membership oracle; the same
reason the waitlist answers a duplicate exactly as it answers a first submit.

**Resend is a third party for waitlist addresses and for nothing else here.**
An account's identity is Supabase's, and Supabase's own mail (the sign-in code)
is configured as a custom SMTP provider — that is a second, unbuilt use of
Resend and it is not this one. This one is `session/waitlist_email.py`: our own
HTTP call to `api.resend.com` carrying a stranger's address, because a signup is
confirmed by an email we send. So the address crosses **two** processors rather
than one, and the difference is worth stating rather than folding into the
Supabase line above: it is the only field in the project that is handed to a
party that has no table of ours to look it up in. Two consequences, both
deliberate. **The address is never written to a log line here**, on any path,
including the failure paths — a transport exception quotes the request body, and
the request body is the address, so only the exception's TYPE crosses into a
log. And **the address appears in exactly one field of the request we send**,
`to`: no header, no tag, no `List-Unsubscribe` value carries it. There is no way
to make a third-party mail API not see the recipient; there is a way to stop it
being the thing we paste into their logs ourselves. (There *was* a third copy,
in an `Idempotency-Key` hashed from the address — removed 2026-10-12 because
that header refused a legitimately new signup as a `409`, which is a delivery
failure bought for a duplicate-send guarantee the unique constraint already
gave. See "What the waitlist table guarantees" in `waitlist.py`.)

Page text itself is **not** written to disk, and neither is the AX diff that
used to quote it. The `.pages.json` sidecar that was meant to hold page bodies
lost its last writer, and `ax_diff` went the same way in 2026-10-03: both were
counts and short digests, never content. Two tests hold that line —
`test_persisting_a_scratchpad_writes_no_page_text` and
`test_the_audit_document_holds_no_page_content`. The model still reads the page;
the record only says how much of it there was.

**A sidecar written before that still exists on an upgrading user's disk**, and
it holds what the current code no longer writes: tens of kilobytes of real page
text per session. It has no writer, so nothing updates or appends to it — but
nothing lists it either, which is the hazard. `delete()` names it alongside the
session it belongs to, and `delete_all()` sweeps it as an orphan; a user who
deletes the `.json` by hand strands it. Someone debugging "where did this disk
usage come from" on an upgraded install should look for `*.pages.json` beside
the session files. This repo's own `logs/sessions/` carried two, from Gmail
runs.

## The four rules

**1. Count events, never pages.** `tasks_run`, `active_users`, `signup` are
fine. Anything derived from an AX tree, page text, a URL, typed input or a task
title is not. The moment a counter is derived from what the agent *read*,
"monitoring activity numbers" becomes surveillance and cannot honestly be
described in a privacy policy or a Chrome Web Store disclosure.

**2. A document is the user's, not ours.** `logs/sessions/` is user data. It is
not telemetry, it is not a log, it is not something an endpoint may enumerate.
`GET /v1/sessions` currently returns every session's task title to any caller —
that is rule 2 violated in code, and it is closed by the auth work, not by a
docstring.

**2a. The transcript also lives in the user's browser.** The server's copy is
the only *complete* one, and on a hosted orchestrator that disk is ephemeral — a
dyno restart or a deploy wipes every transcript the user has, silently. So
`session_store.js` mirrors each audit document into IndexedDB, and
`historyEntries` unions the server's list with the mirror and with the panel's
own 20-row array. **The mirror lands as a mirror first**: the server stays
authoritative, the mirror is consulted only when the server cannot answer
(network failure, 404, or a 200 with `found: false` — which is what a wiped
dyno says about every session it ever ran). A full local-first move, where the
operator keeps nothing, is a separate and still-unbuilt change.

Three consequences, all deliberate. A delete calls
`brottoSessionStore.remove` (and `clear` for delete-all), because a mirror
left holding the only copy that outlives the server is the one deletion a user
cannot verify. No manifest permission is added: `chrome.storage.local` caps at
~10MB and would want `unlimitedStorage`, and OPFS may not be reachable from an
MV3 service worker at all — if it isn't, every write routes through a side panel
that is closed most of the time and the mirror stops recording exactly when a
background run ends. And the document is stored **verbatim**, because the replay
path wants the server's bytes and re-serialising is one more way for the two
copies to differ. Pinned by `scripts/test-session-mirror.test.js`.

**3. Redaction is not a privacy boundary.** `is_secret_field` runs at audit-write
time and catches *typed* secrets. It does not catch the page. What keeps the
page off disk is not redaction — it is that the write path for page content was
removed, which is a shape decision, and one that can be undone by a well-meaning
`begin_turn(..., ax_diff=…)`.

The shape, precisely: `begin_turn` takes `ax_diff_chars: int` — a **length**,
not the diff. The caller measures; the audit document stores the number. The
`.pages.json` sidecar that held the bodies lost its last writer when the
scratchpad moved to a manifest, and `ax_diff` went with it. What is left per
page is a 200-char digest. Two tests hold the line and both are load-bearing:
`test_persisting_a_scratchpad_writes_no_page_text` and
`test_the_audit_document_holds_no_page_content`. A signature that takes the
content back puts it all on disk again, and no amount of `is_secret_field`
behaviour catches it.

**3a. `redact_text` had one call site, and the README's Privacy section promised two.** The policy
says page text is redacted "on every task, with no setting to turn it off". That
was true of `harness.py` and false of `suggest.py`: the idle-suggestions path
reads a page with **no task in flight** and shipped its text to the provider
raw. Not a subtle leak — a card number visible on a checkout page, sent by a
feature the user never turned on for that page.

The lesson is the shape, not the missing call: **a promise made in a published
policy is an invariant that has exactly as many call sites as the code has
paths.** `grep -rn redact_text src/` returned one hit and read like a complete
answer. It is the same class as the auth work above — a control named in public
prose, implemented in one place, with the second place unbuilt. Both are now
pinned by a test that asserts the secret is absent from the prompt that would be
sent, not that a function was called.

**3c. And the tool path was a third, with a second step to reach it.** Fixing
3a made `grep -rn redact_text src/` return two hits, and both were step-shaped:
the per-step `get_page_text` and `suggest.py`. Neither is the whole set of paths
page text takes, and the missing one was the one the **system prompt itself
advertises** — `prompt.py` tells the model to call `read_page_text`. That handler
took the CDP text raw, stored it raw as the memory body, and `recall_memory`
handed the raw body back on any later step. `guardrails.py` exempts
`read_page_text` from the sensitive-action gate, so the model could reach it
without approval.

The guarantee was bypassable by a model that simply called the tool on a second
step — which the prompt tells it to do. The handler now calls the same
`redact_text` the step path does, and **the redacted form is what is stored**, so
the recall path is covered by construction rather than by a second call site.
That is the part worth keeping: redacting on the way out but storing the raw
string would have left the text sitting in memory for a later step to fetch.

Two things did *not* change, deliberately. There is still no setting — the
per-step path's comment about secure mode applies identically here, and a
credential is a credential whether the page arrived in the prompt or through a
tool. And redaction is still **best-effort pattern matching**, not a guarantee
that no sensitive string reached the provider; it misses a novel identifier
format and occasionally eats an order number. The policy page says "best-effort"
for that reason, and nothing here moves it toward "guaranteed".

The lesson is 3a's again, one level on: **grep found every call site of the
function and none of the paths**, because the two are not the same list. The
question is never "where is this called" but "every way does this text get
here" — and for page text that is per-step observation, the tool, the recall,
and the suggestions path. Pinned by three tests in `test_memory_capture.py`
asserting a known card number is absent from the recalled body, from the stored
body and from the digest.

**3b. The policy said "one deployment" and there were two.** `PRIVACY.md` opened
with *"Brotto has one deployment. You run the orchestrator… There is no
Brotto-operated service, we run no servers"* and closed out each section with a
claim scoped to that: *"None of this reaches us"*, *"we do not receive your
data"*, *"the machine holding them is yours"*, *"Deletion is entirely yours, and
it is immediate"*. Then `agent.brotto.dev` shipped and every one of those became
false at the same time — **not one line of code changed**. The operator flipped;
the prose did not follow, because prose is not covered by the scan, the ratchet,
or any test.

The shape is the same as 3a inverted. 3a is *a control named in prose that the
code implements once*; 3b is *a fact stated in prose that the code stopped
obeying*. Neither is a bug in the code, so neither would have been caught by
anything written against the code. What catches 3b is re-reading the policy
against the deployment list before a listing ships — and `notifications` is the
same class one over: a permission in `manifest.json`, on by default in
`background.ts`, that the Security section never named, so the CWS per-permission
justification had nothing to answer with.

What 3b is *not*: a reason to weaken the self-host story. Every fix scoped a
claim to a deployment. "There is no operator between the agent and your
documents" is still the whole argument on self-host, and it still gets said —
as a property of that deployment rather than as a universal.

**4. Retention is a feature, not a cleanup task.** `_prune_sessions` evicts
in-memory state and never touches disk. The user can now delete a session or
all of them (`DELETE /v1/sessions/{id}`, `DELETE /v1/sessions`, both behind
`AGENT_SECRET`), and the panel exposes it behind a confirmation.
`BROTTO_RETENTION_DAYS` is **built** — an hourly sweep in `main.py` ages
sessions out, and it is off unless the operator sets the variable. (An earlier
note here said "still unbuilt", which was true when written and stopped being
true; the README's Privacy section has been right the whole time, which is why the public doc
gets the last word when the two disagree.)

Note that deletion is scoped to sessions. `logs/user_policies/` and
`logs/user_models/` are keyed by install id and survive it — and the policy
file is the one holding the approved-sites list. The README's Privacy section now says so, but
there is still no "delete everything" path.

## Where this is going: local-first

The target is that the orchestrator holds **no session history at all**.

```
┌─ user's machine ────────────────┐        ┌─ operator's box ──────────┐
│ extension                       │        │ orchestrator             │
│  IndexedDB                      │        │  no state dir            │
│    sessions/<id>.json           │        │  no audit.py             │
│    sessions/<id>.scratchpad.txt│        │  no policy files         │
│  chrome.storage.local           │        │                          │
│    model_config, policy, prefs  │        │  per step:               │
│                                  │        │    in  page + history    │
│  step N ────────────────────────┼───────▶│    out decision          │
│  step N+1 ◀─────────────────────┼────────│    (no history retained) │
└──────────────────────────────────┘        └──────────────────────────┘
```

**The harness is already stateless per step.** Every `agent.run` is a freshly
built prompt with no `message_history` — `step_summaries` + `scratchpad` *are*
the model's entire history. They are server-side state today purely by
accident of where the loop runs. Move the loop's *state* to the client and the
client sends it up each step; the server keeps nothing.

Why this is cheap rather than a rewrite:

- The history is **small**. `step_summaries` is a digest per step; the scratchpad
  manifest is a 200-char digest per page. Neither carries page content — that
  was already true before the relocation, so what moves is metadata, not
  bodies.
- **Resume and panel replay become client-side reads.** Both already rebuild
  from `tasks[]`/`turns[]`/`prompts[]` — `scripts/test-replay.test.js` already
  extracts and evals that code. It is reading a file; it can read an IndexedDB
  record instead.
- **The audit document moves wholesale** into IndexedDB. `chrome.storage.local`
  is ~10MB and needs `unlimitedStorage`; IndexedDB is the right home for an
  unbounded transcript history and needs no permission.

What is lost, honestly: **server-side observability**. We could see a run
crash; now we cannot. That is the trade, and it is the correct trade for a
product whose premise is *it reads your email*. `main.py`'s `scan`/`metrics`
logging stays and still gives us everything except content.

## What is true today, and must not be oversold

**Until the local-first refactor lands, the run's shape is on the server's
disk.** No page text, no page bodies, no AX diff — but the URLs, the titles,
the task text, the action names and the typed input are. So:

- The README's Privacy section describes the *current* state honestly, and the deletion path
  is real: `DELETE /v1/sessions/{id}` takes the document, the scratchpad and
  the pages sidecar together, so there is no "part of it survived".
- `delete` and `delete_all` read **one** list, `_SESSION_EXT` (`audit.py`) —
  and there used to be two, which is the same bug twice. First they held
  separate hand-written lists and a sidecar named in one but not the other was
  stranded by the one that swept less: a `.pages.json` beside a document
  someone deleted by hand, 76KB of Gmail, reported as erased. Then, after that
  was fixed, the list was still read *differently* by different callers —
  `delete` read "the document plus the sidecars" and got it right, while the
  residue sweep and the retention prune read `_SESSION_RESIDUE_EXT`, which is
  the **sidecars only**, and so never tested the `.json` at all. One list,
  read three ways, is not one list. `delete_all` also returns how many files
  it could not remove, because a file on a read-only mount stays put and the
  alternative was a log line the user will never read standing in for the
  truth.
- The launch gates are partly closed. `/ws/ext` and the session endpoints are
  gated on `AGENT_SECRET`, which is the privacy control — but only when one is
  set. On **loopback** "no credential" stays a *warning* so dev still works; on a
  **non-loopback bind it is a refusal** (`cli.py`, keyed on `auth_mode() ==
  "open"`, so the hosted relay — which sets no `AGENT_SECRET` — is not refused
  by the check written to protect it). A file full of someone's browsing behind
  a reachable server with no credential is still the thing to avoid.
- Sequence: **auth** (done 2026-10-03), **delete** (done 2026-10-03), then
  **retention**, then local-first. Doing local-first first leaves an open door
  pointed at a directory that no longer has the interesting files — which is
  fine, but the door should be closed either way.

## The hosted relay turns "no operator" into "an operator", in code

3b was a prose failure: `agent.brotto.dev` shipped and **not one line of code
changed**. The account layer changes that, and it changes the same three things
3b found false — what we hold, who can read it, and when it is gone.

**We hold a table of who is in the beta, and nothing they said.** `profiles`
holds an email, a role, a revocation timestamp and a task counter. No column
holds content, and the relay writes exactly one field from the application —
the counter — at task start. The email is there so the operator can answer
*"who is this?"* at 2am, which is a different question from *"what did they do?"*.

**The two sign-in routes are open by definition, so they must not leak.** They
are how a credential comes into existence; gating them on one is a closed door.
That makes them the one place a route can become **a directory of the beta**:
`POST /v1/auth/request-code` returns the same answer for an address that has an
account, one that does not, and one on the beta roster — this route consults
nothing that knows who is in the beta, and every response body is swallowed
rather than relayed. Supabase's text names whether the address exists, what the
code was worth, and how long the project has been rate limited.
`/v1/auth/exchange` raises a fixed `"invalid or expired code"` for the same
reason. Only an **incomplete call** is reported, because that says nothing about
the address and reporting it is the difference between "check your inbox" and
"nothing is wrong, wait".

**And `create_user` is `True` — it is not allowed to become conditional.**
There used to be no signup path at all, and that is not a neutral choice:
`profiles.id` is an FK into `auth.users`, so a profile *cannot* be pre-seeded
for an address that has no auth account, and the roster check could therefore
only ever land on the unauthenticated route — turning "check your inbox" into
"are you on the list?" for anyone who can reach a public URL. So the roster is
read at `/v1/auth/exchange` instead, which is safe for one reason and one only:
**by then the caller has read a code out of an inbox it controls**, and that is
the gate `request-code` cannot verify. Pinned by
`test_request_code_consults_no_allowlist`.

## The roster admits; `revoked_at` withdraws

`beta_access` is read in **exactly one place** — `_listed_for_beta`, called from
`approve_at_exchange` — and only to decide whether to *create* a `profiles` row.
`ensure_on_roster`, the gate every use path and task start now shares, reads
`profiles` and never consults the roster again. So the absence of a roster row
is a refusal **only for somebody who has not been admitted yet**. Deleting one
for an already-approved member changes nothing they can observe.

**The withdrawal is two writes, and neither is sufficient alone.** Set
`beta_access.revoked_at` *and* `profiles.revoked_at`, in one transaction, with
the address passed through `lower(btrim(...))` — both tables store email already
normalised, so an un-normalised `where email = '…'` matches zero rows, reports
success, and withdraws nobody. The runnable form, guard and all, is at the top
of `004`.

**The `profiles` half is keyed on the account id.** `profiles.email` is written
once, by `approve_at_exchange`, from the verified JWT claim at first sign-in,
and is never updated afterwards — a member who changes their Supabase email
leaves the old spelling on the row permanently, so an address-keyed update
matches zero rows, reports success, and withdraws nobody. So the procedure
resolves the rostered address to its `auth.users` row and updates by
`profiles.id`, which is the stable key. The `if found` is not a swallowed
error: a rostered address that never signed up has no `auth.users` row and no
profile, so there is nothing to withdraw.

The first refuses *re-admission* at sign-in; the second is what
`authorize_task_start` reads at task start, and **that function never consults
the roster**, so the roster write alone withdraws nobody who is already signed
in. The failure mode is silent in both directions and worth naming: run only
the first and a member keeps a working beta account until they happen to sign
out, with a withdrawal on record saying otherwise.

`beta_access.revoked_at` is not a second copy of `profiles.revoked_at` for
tidiness; it is the only one of the two a cascade cannot erase.
`profiles.id` references
`auth.users` **on delete cascade**, so when the auth account goes — the person
deletes it, Supabase purges it, a test fires the cascade — the `profiles` row
and its `revoked_at` go with it. They sign up again, the address is still on the
roster, and `approve_at_exchange` inserts a fresh, unrevoked profile.
**Revocation was not durable**, and the cascade walked straight around the
insert-if-absent that exists precisely to stop a withdrawn member reinstating
themselves. The evidence has to outlive the account it was recorded against, so
`beta_access.revoked_at` is **not a foreign key and must never become one**, and
`_listed_for_beta` refuses an address whose `revoked_at` is set.

**A 409 on a paste says "already there", not "admitted".** With `revoked_at`
in play, already-there is either **granted** (`revoked_at is null`) or
**withdrawn** (set), and the primary key answers identically for both. One line
separates them — `select email, revoked_at from beta_access where email =
lower(btrim('…'))` — and the operator has to read it; no code path may infer
which from the response. **Re-admission is its own two-statement step**, the
same pair with the values nulled and the roster write first, resolving the
`profiles` half through `auth.users` to `profiles.id` in the same way, because
`authorize_task_start` reads only `profiles`.

Deleting the roster row afterwards remains optional housekeeping — now it
*closes* the door rather than re-opening it, and it withdraws nobody on its own.
There is no `AFTER DELETE` trigger joining anything: a trigger fires on a
*delete*, and a withdrawal is an `UPDATE` that deliberately leaves its evidence
in place.

The operational consequence is the whole point: **an operator who removes a
roster row instead of setting `revoked_at` has handed someone a working beta
account while believing they took it away.** The migration file states this at
the top of `004`, where an operator pasting a list will read it.

## A valid signature is not a place in the beta

`create_user` being `True` has a consequence that is easy to miss: **every person
who signs up now holds a token that verifies.** A signature proves an account
exists; it says nothing about the roster. So the six routes that gated on
`_authed` — `POST /v1/model/check`, `GET /v1/policy`, `POST /v1/sessions`,
`POST /v1/policy_ack`, `POST /v1/reports`, `POST /v1/suggestions` — were
answering anyone who signed up, and two of them spend the operator's model
credits.

They now go through `_approved`, which is `ensure_on_roster` (existence plus
`revoked_at`; no cap, no reservation) applied to every HTTP route that acts. The
sign-in path keeps its own answer — a token is minted for anyone, on purpose,
because that is what lets the panel offer somebody the waitlist instead of a
bare failure. **Minting is open; using is not.** That split is the design, not
a gap in it.

`ensure_on_roster` is also the first half of `authorize_task_start`, which adds
the cap and the reservation on top. One lookup, two callers: a second copy of
the "no row means `not_invited`" rule would be two things to keep in step and
one of them would drift. It **fails closed**, for the reason task start already
did — an unreachable control plane is a refusal, not a licence to serve, and on
two of these routes the alternative makes a third party's outage into an
access-control decision.

Two codes, deliberately. A **bad key is 404** — 403 confirms the route is worth
probing, and this server holds the user's transcripts. A **403** means the
credential is real and the *account* is not on the roster: an answer about an
account, not about a probe.

The ownership-scoped reads (`GET /v1/sessions`, `GET /v1/sessions/{id}/audit`,
`DELETE …`) are roster-gated too. They were briefly exempted, on the reasoning
that they are filtered by owner and an unapproved person owns no sessions —
**true for `not_invited`, false for `revoked`.** A withdrawn member ran tasks
before the withdrawal, so `registry.owns` is still true for those ids
(`owns()` is fail-closed only for ids it has never seen), and the exemption let
a revoked account read its own transcript and erase its own sessions
indefinitely. Revocation that leaves the transcript readable is not revocation.

**One gate, one name, no exemptions.** The recurring failure here was a route
picking a different gate than its neighbour *looks* like it should, and every
pair of same-behaviour-different-name helpers is an invitation to the next one.
`_approved` now gates every route that authenticates; `_auth` survives only as
its own first step. Ownership scoping is a **second** question, not an
alternative to the first: the gate says *this account may use the relay*, and
`owns()` says *this session is one of theirs*. Both apply, in that order.

The cost is one control-plane hop per delete, which is why it was exempted —
and it is the right trade anyway, because the hop buys a withdrawn member's
transcript otherwise. `ensure_on_roster` reaches Supabase **only** through
`isinstance(auth.claims, Claims)`, which is never true in `secret` or `open`
mode, so self-host pays nothing.

## Self-approval is an insert, never an upsert

The invitation is now a pre-loaded row in `beta_access`, and the `profiles` row
is written by the relay at exchange. That puts the whole risk onto one
statement, because the natural way to write "this account is approved" against
a table with a primary key is an **upsert** — and an upsert on this path is a
revocation erased from the record. A member the operator deliberately withdrew
(`revoked_at` set) signs back in, the upsert nulls their revocation, and nothing
anywhere records that it happened. So the write is
`POST /profiles?on_conflict=id` with `Prefer: resolution=ignore-duplicates`:
PostgREST declines to touch a row that is already there, and the code
**re-reads the row afterwards** rather than trusting the insert — "already
there" *is* the revoked case. `revoked_at` is not in the insert body and is not
written by any path here. Pinned by
`test_a_revoked_member_keeps_the_revocation_by_signing_in_again`.

The email is read from the **verified JWT claims** and never from the submitted
body: the body is caller-supplied and this is the only function that acts on it.

`approved` in the exchange response is a report and not the gate. It is safe to
return for the inbox-control reason above, and it is only a report because
`authorize_task_start` asks the same question again at task start — a member
revoked between signing in and starting a task is still refused, pinned by
`test_the_second_wall_still_stands_after_an_approved_sign_in`. Every failure in
the approval path answers `false` rather than raising: the credential is real
either way, and failing the whole exchange would sign a valid person out
because Supabase's REST side blinked.

**A waitlist row is now an email, a bounded name, and the operator's batch.**
The name is the one field the visitor typed that is not an address, and it is
there for one reason: the operator is about to send these people an invite and
cannot say their name without it. `build_row`'s named-argument shape is
unchanged, so there is still nowhere for a referrer, a user agent, a URL or a
note to land, and a name that grew past `NAME_MAX_CHARS` is truncated rather
than costing the signup. The answer is still `{"ok": true}` whatever the body
said.

**The name is also neutralised for a spreadsheet, in the code and in the
table.** The sink is not the row, it is the CSV export: the operator opens
the table in whatever admin UI, exports, and that file lands in Excel or
Sheets — and both execute a leading `=`, `+`, `-` or `@` as a formula. A
stranger typing into a public form would then be running on the machine of
the person who opens the export to send invites from. `build_row` prefixes
those four characters with the apostrophe both spreadsheets read as "text",
so the name still reads as the name the visitor typed. The **migration's
CHECK** covers a row written by any path that is not the server's — the
table editor, a `psql` session, a future import — and it is the half that
cannot be renamed away. Both halves, or one of them is a guard waiting for
a refactor.

**Revocation is checked per request and per task, and it fails closed.** The
JWT says who you are and nothing about whether you are still welcome, so
`profiles` is the only answer to the second question. The *decision* — the cap,
the reservation — is made once, at task start, so putting that on the request
path would make every step of every run depend on Supabase's uptime. The
*existence and revocation* question is asked on every route that acts (see
*A valid signature is not a place in the beta*), because a signature no longer
distinguishes a beta member from anyone who signed up. **Failing closed is
right on both**: this is the relay where every transcript lands on our disk and
the operator's credits are spent, and "we could not check whether this person
was revoked" is not a licence to serve them. A self-host relay never reaches
the function — no `Claims` object exists there.

**Retention now has a default, and only here.** `BROTTO_RETENTION_DAYS`
unset returns 30 on the hosted relay and `None` everywhere else. The reason is
the same asymmetry as everything above: a self-hoster's disk is their own data,
an ephemeral dyno is ours, and nobody was deciding the second one. An explicit
setting still wins, **including `0`**.

## One operator per server was an assumption, and four things were built on it

"Exactly one operator" is why `AGENT_SECRET` was a *credential* and never an
*identity*. It held the enumeration shut, and it held it shut for free. Ten beta
accounts broke it, and the breakage is not one bug — it is the same assumption
showing up in four places that each looked closed on their own.

**Ownership is recorded at mint time and checked everywhere, and a mismatch is
404.** `POST /v1/sessions` writes the caller's `sub` onto the session; the
registry is the only place it lives. `GET /v1/sessions` filters to the caller's
own, the audit read and the delete refuse, the relay closes **4004**, and
delete-all is scoped to the caller's own ids — the residue sweep globs `*<ext>`,
so unscoped it would unlink another user's scratchpad while counting something
else. A session with **no recorded owner belongs to nobody**: fail-closed, so a
stale id or an evicted registry entry cannot become an open door. The close code
is 4004 rather than 4001 for the same reason the routes answer 404 rather than
403: a distinct answer confirms the id is real, and confirming that is the whole
of what the id is worth. On self-host `owner` is `None`, which means *one
shared identity*, and every route behaves exactly as it did before.

**Ownership had to leave the process, and it had to leave `_sessions`, because
erase-all was lying in two ways.** A restart was the visible one: the registry
is in-memory, Heroku restarts the dyno daily, and after a restart
`owned_sessions()` returned nothing — so `DELETE /v1/sessions` answered
`{"deleted": 0, "residue": 0}` with every transcript still on disk. But
**restart was not the only way in, and the other way had no restart in it.**
Ownership had been stored in `_sessions`, which `_prune_sessions` evicts at
`MAX_TRACKED_SESSIONS` (256). Everything else in a `SessionState` is per-run
runtime — a sequence tracker, a task handle, a cached policy — and ownership is
not. So at the cap, eviction dropped entries, `owned_sessions()` shrank, and a
scoped `DELETE /v1/sessions` gave the identical untruthful answer, at a scale
threshold where nothing looks wrong and no operator is watching a restart. That
is why the fix is not only durability.

So: ownership lives in its own **non-evictable** `_owners` dict. The mint path
writes `<session_id>.owner` beside the session (`audit.record_owner`),
`lifespan` hydrates `_owners` from those files before anything can answer about
ownership, and the sidecar is in `_SESSION_RESIDUE_EXT` so `delete` takes it
and `delete_all` sweeps it. `forget_owner` drops the entry when the files are
erased — not a memory optimisation, because an erased session left in `_owners`
would be reported as the caller's own by a scoped *erase all*, and the count
would describe a file that is no longer there. **A restart and an eviction are
now the same class of failure and neither one reaches the answer**, because the
only thing that can empty `_owners` is erasure.

It is a sidecar rather than a field in the audit document because the document
is written by the harness's `AuditTrail` while this is written at mint time —
before a run exists, and so before any document does. Self-host writes nothing:
`None` is one shared identity and needs no record. Pinned by
`tests/test_session_ownership.py` (first coverage this guard ever had), which
covers the restart half and the sidecar's life.
`test_ownership_survives_eviction_at_the_tracking_cap` covers the eviction
half: it mints six sessions for one owner with `MAX_TRACKED_SESSIONS` at 3,
**asserts the eviction actually happened** (without that the test would pass
against the old code and prove nothing), then asserts `owned_sessions()` still
returns all six, `owns()` answers for each, and a scoped `DELETE /v1/sessions`
reports `deleted: 6` with every document gone from disk. Against ownership read
back out of `_sessions` it goes red on exactly that count.

**Ownership is released only by a finished erasure.** Every way of losing an
`.owner` while one of its files is still on disk ends the same way: the file
outlives the handle, `owned_sessions()` cannot name it, and no account can ever
erase it again. So there is one rule in four places, and each of them is a
place that already existed. Three of them were live and wrong for a week on
the relay before anyone looked; what they shared was a second, narrower
reading of "the files a session owns".

- `DELETE /v1/sessions/{id}` keeps the registry entry when `audit.delete`
  reports a file it could not unlink. `delete` gained a `leftover` out-param
  for exactly this — it knows which unlinks raised, and the route was
  throwing that away by forgetting unconditionally.
- `DELETE /v1/sessions` skips `forget_owner` entirely when `residue` is
  non-zero. The entries go as a batch, so an unguarded loop strands every
  unremovable file at once.
- `delete` and `delete_all` unlink the owner sidecars **last**, and only if
  nothing before them failed — otherwise the retry the kept ownership exists
  to enable would find no sidecar to scope itself by.

The retention sweep is the fourth door and works the other way: it ages out an
`.owner` only when **every file in `_SESSION_EXT` is gone** — the document
first, not merely the sidecars. Both narrower readings were wrong, and they
were wrong in the direction that strands files:

- Checking the document *alone* let a hand-deleted `.json` strand a scratchpad
  and take the account's ability to erase it with it.
- Checking `_SESSION_RESIDUE_EXT` alone — the sidecars, which is what this
  sweep originally did — is the same lie with the sides flipped. It strands the
  commonest shape of all: a `.json` that is **fresh** (an active or
  recently-closed run) beside an `.owner` written 40 days ago at mint time and
  never touched since. `.owner` is written once and never updated, so its
  mtime is the *start* of the run while the document's is the last activity.
  The sweep dropped the owner, `owned_sessions()` stopped naming the session,
  and the transcript became permanently unreachable — the file most worth
  deleting, the one the erasure machinery exists to delete.

Both halves are pinned: `test_an_orphaned_residue_keeps_the_owner_that_can_still_erase_it`
(hand-deleted document, stranded sidecar) and
`test_a_surviving_document_keeps_the_owner_that_can_still_erase_it` (fresh
document, aged owner) — the second went green only when the sweep started
reading the document, and its two guards above it were passing the whole time.

The sweep's own gate went with it. It read `if ext in owner_exts and residue`
— a **process-global** counter, so one session's stuck scratchpad suppressed
the `.owner` sweep for every *other* session in the directory, each of them
losing a handle to files the sweep was about to remove perfectly well. The
condition is about one file belonging to one stem, so it is tested that way
(`_still_owns`), and the check excludes the other owner extension: `.owner` and
`.owner.tmp` are the same account id, erased together or not at all, so left in
the list they certify each other and an interrupted `record_owner` makes both
of them immortal. Pinned by
`test_an_owner_and_its_staging_file_do_not_keep_each_other_alive`.

**And `delete_all` reported the erasure finished when it had not.** The
document loop was a `sum(...)` over `delete()`'s boolean, so it discarded the
`leftover` out-param that already listed which unlinks raised — and the residue
sweep, globbing the sidecars only, never saw the `.json` either. A transcript
that would not unlink (held open, read-only mount) was counted by nobody, so
the route answered `{"deleted": 0, "residue": 0}`, dropped ownership, and told
the user their mail was erased. `residue` counts from the sweep alone, which
is a strict superset of the document loop — it globs the same `_SESSION_EXT`
in the same directory and runs after — so adding `.json` to that glob is what
closes it. Counting in both places counted every file on a read-only mount
twice. Pinned by
`test_a_document_that_would_not_unlink_is_counted_as_residue` and
`test_erase_all_keeps_the_ownership_when_the_document_would_not_unlink`.

The remaining pins are `test_an_owner_with_nothing_left_to_erase_is_still_pruned`
(the guard is not a leak in the other direction), `test_a_delete_that_could_not_finish_keeps_the_ownership`
and `test_erase_all_that_left_residue_keeps_the_ownership`.

**`?token=` is refused in jwt mode and nowhere else.** A URL reaches this
server's access log, every proxy's log ahead of it, and the browser history. A
self-hoster's `AGENT_SECRET` is one secret on their own box; a hosted JWT is a
*person's* account, and there the query spelling writes a credential down. The
WebSocket subprotocol is the header spelling and is what the extension already
uses.

**The cap is one statement, not a comparison.** `authorize_task_start` used to
read the row, compare in Python and write the result — two concurrent starts
both read `used = 9`, both pass, both write 10, one task free. The cap is the
control that stops a hosted account spending our compute, so the predicate moved
into the `WHERE` clause of the `UPDATE` (`reserve_task_slot`). The read stays,
because revocation and invitation are genuinely reads; only the increment had to
be atomic.

**The two open sign-in routes are metered, and the limiter cannot become the
oracle the routes were written not to be.** They are unauthenticated by
definition, so they are a way to drive outbound email to arbitrary third-party
addresses through our Resend account. The bucket keys on the peer (the forwarded
hop, because behind a proxy `client.host` is the proxy for everybody and the
limit would be five sign-ins per ten minutes for the whole beta) and on the
**normalised** address the caller typed. It never consults anything that knows
who is in the beta, so there is no branch in it that *could* differ between a
rostered address and a stranger's — pinned by a test that drives both and
compares the answers.

## Failure reports are the operator's question, asked without a page

The operator needs to answer one thing: *did the run happen, and if not, which
of our fixed codes says why?* That is not analytics — analytics answers *what
did the user do*, which is the posture rule 1 forbids — and the difference is
entirely in whether the vocabulary is closed. `failure_reason` already is: the
relay writes it, the panel turns it into a sentence (`FAILURE_NOTE`). So the
report is the same code, and nothing else.

**`build_row` is the boundary, and it raises.** It takes named scalars and
`**extra` is a `ValueError`, not a filter — a filter is something a later commit
widens with a reason that reads well. This is the same decision as
`begin_turn(ax_diff_chars: int)`, and `test_failure_reports.py` posts a body
carrying a task, a URL, page text, typed input, an email, a user id and a model
key, then asserts none of them appear in the built row. It passes because
`build_client_rows` has *no parameter* for them. The test failing is the
guarantee; the test passing is only evidence.

**The client never sends who it is.** `owner` is read off the verified token by
the relay, the same identity `profiles` already holds. So no user id is on the
wire — only in a table we already had a row for.

**A relay that is down cannot receive a report about being down.** So the codes
queue in `chrome.storage.local` and flush on the next `ws.onopen`: the first
moment the relay is answering *and* the credential has been accepted. Three
things fall out of that one choice. A refused sign-in still gets reported, once
the user signs in again — which is when it is worth having. Self-host is
structurally excluded twice over, because `/health` says `open` or `secret` and
never sets `relayIsCloud`, and because the route answers 404 unless
`reporting_enabled()`. And **no CORS change was needed at all**: the extension
already POSTs to the same relay origin, and `allow_origin_regex` already permits
exactly `chrome-extension://<id>`.

**Five codes are deliberately not reported, and the reason is written next to
each.** `CANCELLED` is the user pressing stop — counting it counts what the user
chose to do. `TASK_ERROR` and `WS_ERROR` are already counted from the relay as
`internal` and `CONNECTION_LOST`, so counting them from both ends makes one
outage look like two. `scripts/test-failure-reasons.test.js` requires every code
the extension writes to be either in `CLIENT_CODES` or in `NOT_REPORTED`, because
an omission is an *absence* and an absence reads clean in review.

**What the operator must do by hand:** run
`supabase/migrations/002_failure_reports.sql` on the Supabase
project, or `/v1/reports` answers 500 on every insert and the code says only that
a PostgREST call failed.

## The waitlist is the first data from someone who is not an account

Every row above belongs to a person who installed the extension and pointed it
at their own browser. `POST /v1/waitlist` is the exception: a visitor on a
public marketing page, no credential, no account, and an address they typed
into a form. That makes it the one place the operator holds data about someone
who has not decided to give us anything — and it applies exactly the same
discipline the rest of this file applies.

**The route does not exist on a self-hosted box.** `waitlist_enabled()` is
`auth_mode() == "jwt"` *and* a configured service key, and the answer is 404 —
not "does nothing". The gate is `auth_mode()` rather than "is a Supabase
configured" for the reason `failure_report.reporting_enabled()` is: a self-hoster
with a stray `SUPABASE_URL` pasted out of the cloud env must not start
collecting strangers' addresses because they copied it.

**The row is one field, and the shape is what enforces it.** `build_row(email)`
has no parameter for a referrer, a user agent, a page URL or an IP, and
`**extra` **raises** rather than filtering. `batch` is the one addition and it
is not user content: the operator stamps it from `BROTTO_WAITLIST_BATCH` when
they send an invite round. This is `begin_turn(ax_diff_chars: int)` and
`failure_report.build_row` again — the boundary is a signature, not a habit.

**The answer is the same whether the address is new.** The uniqueness
constraint lives in the migration and a duplicate arrives as a 409, which the
route reads as success. A read-then-insert would be a race a double-clicked
submit wins, and — the reason this is worth stating — a route that answered
differently for the two outcomes is a route anyone with a public URL can ask
*"is this address on your list?"*.

**The confirmation made that guard load-bearing rather than tidy, and it is the
one place where the distinction exists internally.** A signup is confirmed by
mail, and the mail belongs to a *first* signup — a second submit is a no-op on
the table and must not be a second email to a stranger. So `add` returns
`Signup.CREATED` / `DUPLICATE` / `REFUSED` rather than a bare bool, and the
route maps the first two onto one identical `200 {"ok": true}`. The distinction
is real, it is internal, and nothing outside this process can read it: not the
body, not a header, not a status code.

**The send is a background task, and that is the same guard rather than a
performance choice.** Awaiting it inside the route would answer a duplicate in
ten milliseconds and a new address in however long Resend and a page fetch
take — the same oracle, delivered through a stopwatch instead of a string, and
the one a caller can measure without being told anything. Starlette sends the
response first and runs the task after it, so the visitor's answer cannot
depend on Resend existing, being reachable, or being configured at all.
Pinned by `test_the_response_is_sent_before_the_mail_is_attempted`, which holds
Resend open on a gate and waits for the 200 to reach the wire, and by
`test_a_duplicate_is_answered_identically_and_sends_nothing`.

**A mail failure is not a signup failure, and there is no rollback to reach
for.** The row is written before the mail is attempted, so a Resend 500, a
timeout, or a dead writing page changes nothing the visitor can see and nothing
the table holds. Every failure path ends in a log line carrying a type and
nothing else.

**Nothing about the address is logged, ever.** Not on success, and not on
failure: a PostgREST insert error quotes the row, and the row is the entire
payload. Only a status code crosses into a log line. The response on a broken
control plane is a fixed 502 — see 3b's lesson that a promise made in a
published policy is an invariant with one call site per code path.

**It is metered on the sign-in limiter**, reused rather than duplicated: the
socket peer, the forwarded hop and the normalised address, and it consults
nothing that knows who is on the list, so a stranger and a beta user are
metered for the same reason after the same number of attempts. The form is
open by definition and there is no key to put in front of it.

**The peer key is the socket, not the header — and the header was the whole
bug.** It used to be the first hop of `X-Forwarded-For`, which the caller
sets: rotating it minted a fresh bucket per request, and on an open form the
submitted address is chosen by the attacker too, so both halves of the limit
were the thing being varied rather than a backstop. CORS does not help — a
cross-origin POST is still sent, it just cannot be read back. Trusting the
header is only correct behind a proxy that *overwrites* it; trusting the
socket alone collapses every visitor behind one NAT (and every beta user
behind one Heroku router) into a single bucket. So both are charged, at
different capacities, and the socket one is the bound because it is the one
the caller cannot forge. `ponytail:` the honest ceiling is written beside it
in `main.py` — 20 writes per ten minutes per router address, and an attacker
who keeps that bucket drained starves whoever shares the address. The upgrade
is a bot check in front of the route, not a bigger bucket.

**CORS is scoped to a sub-application, because an allowlist entry is not a
grant of access to one route.** `https://brotto.dev` and its GitHub Pages
host used to sit in the *global* `allow_origin_regex`, added so the marketing
form could reach `/v1/waitlist`. The effect was that those two origins could
read every CORS-protected route on every install — `GET /v1/sessions`,
`GET /v1/sessions/{id}/audit`, `DELETE /v1/sessions` — including an
open-mode self-host, where `validate_token` passes for everyone. Chrome's
Private Network Access hid part of it and Firefox and Safari implement
neither, so what stood between the entry and a transcript was a browser
mitigation rather than a guard.

Starlette has no per-route CORS; middleware is per-application. So the
waitlist is its own `FastAPI()` mounted at `/v1`, carrying its own allowlist,
and the global one names only `chrome-extension://<id>` and loopback. Two
consequences that are not obvious and are both pinned by tests in
`test_cors_scope.py`: the mount is at `/v1` and **not** at `/v1/waitlist`,
because the latter compiles to a regex the form's exact URL does not match
and answers 307; and the global middleware answers the sub-app's **preflight**
before the sub-app ever sees it, so it skips that one path entirely rather
than refusing the form's preflight with a 400.

## Writing new code here

Before adding a field, an endpoint or a metric, ask: **is this user content,
and where does it land?**

- Content going into a counter → it does not.
- Content going onto the operator's disk at all → it needs a reason that
  survives "would I be comfortable if this leaked".

Note what is *not* on that list any more: "content going into an audit
document → the sidecar." The sidecar had no writer before this rule stopped
being true, and following it would put page bodies back on disk behind a
privacy document that promises they never land there. Audit documents carry
counts and digests; anything that needs the body is fetched from the page
again, because the page is still there.
