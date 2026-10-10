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
| API key | `chrome.storage.session`, user | until browser restart |
| Secure-mode policy | `logs/user_policies/*.json`, server | forever |
| Audit request bodies | whatever the model provider logs | theirs, not ours |

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
- `delete` and `delete_all` read **one** list, `_SESSION_RESIDUE_EXT`
  (`audit.py`). They used to hold separate hand-written ones, and a sidecar
  named in one but not the other was stranded by the one that swept less —
  a `.pages.json` beside a document someone deleted by hand, 76KB of Gmail,
  reported as erased. `delete_all` also returns how many files it could not
  remove, because a file on a read-only mount stays put and the alternative
  was a log line the user will never read standing in for the truth.
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
account, one that does not, and one this project has signups disabled for.
Supabase's own `create_user: false` is what keeps that true, and every response
body is swallowed rather than relayed — its text names whether the address
exists, what the code was worth, and how long the project has been rate limited.
`/v1/auth/exchange` raises a fixed `"invalid or expired code"` for the same
reason. Only an **incomplete call** is reported, because that says nothing about
the address and reporting it is the difference between "check your inbox" and
"nothing is wrong, wait".

**Revocation is checked once per task, and it fails closed.** The JWT says who
you are and nothing about whether you are still welcome, so `profiles` is the
only answer to the second question — and task start is the only moment a
decision is made. Putting it on the request path would make every step of every
run depend on Supabase's uptime. **Failing closed is right here and only here**:
this is the relay where every transcript lands on our disk, and "we could not
check whether this person was revoked" is not a licence to record one more. A
self-host relay never reaches the function.

**Retention now has a default, and only here.** `BROTTO_RETENTION_DAYS`
unset returns 30 on the hosted relay and `None` everywhere else. The reason is
the same asymmetry as everything above: a self-hoster's disk is their own data,
an ephemeral dyno is ours, and nobody was deciding the second one. An explicit
setting still wins, **including `0`**.

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
