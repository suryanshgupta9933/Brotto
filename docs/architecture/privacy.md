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
| Page text, every step | `logs/sessions/<id>.pages.json`, server | **forever** — nothing prunes it |
| AX tree, page text chars, `ax_diff` | inside the audit document, server | forever |
| Task title, action names, URLs, typed input | inside the audit document, server | forever |
| Model config, `base_url` | `chrome.storage.local`, user | until cleared |
| API key | `chrome.storage.session`, user | until browser restart |
| Secure-mode policy | `logs/user_policies/*.json`, server | forever |
| Audit request bodies | whatever the model provider logs | theirs, not ours |

The `.pages.json` sidecar is the boundary. It exists because page text is
arbitrary content and would corrupt the manifest's line format inside the
audit document — a sound reason — and it is also **the single largest privacy
liability in the codebase**, because it is 200KB of a person's inbox per twenty
pages, unredacted, retained indefinitely.

`ax_diff` is a second copy of the same content in a worse place: it is written
into the audit document itself, so it lands in the *main* record rather than
the sidecar, and it is never scrubbed. It is the reason "the sidecar is the
boundary" is currently a description rather than a guarantee.

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

**3. Redaction is not a privacy boundary.** `is_secret_field` runs at audit-write
time and catches *typed* secrets. It does not catch the page. A `.pages.json`
is unredacted by design, because the model needs to read the page.

**4. Retention is a feature, not a cleanup task.** `_prune_sessions` evicts
in-memory state and never touches disk, so files accumulate forever. A
hosted user currently has no way to delete their own.

## Where this is going: local-first

The target is that the orchestrator holds **no session history at all**.

```
┌─ user's machine ────────────────┐        ┌─ operator's box ──────────┐
│ extension                       │        │ orchestrator             │
│  IndexedDB                      │        │  no state dir            │
│    sessions/<id>.json           │        │  no audit.py             │
│    sessions/<id>.pages.json     │        │  no policy files         │
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
  manifest is a 200-char digest per page. The bodies are the big part, and they
  only ship when the model calls `recall_memory(id)` — which is already rare
  (the write path was deleted entirely, and the prompt tells the model not to
  recall the page it is standing on). A client-side fetch on that call is
  near-free.
- **Resume and panel replay become client-side reads.** Both already rebuild
  from `tasks[]`/`turns[]`/`prompts[]` — `scripts/test-replay.test.js` already
  extracts and evals that code. It is reading a file; it can read an IndexedDB
  record instead.
- **`.pages.json` moves wholesale** into IndexedDB. `chrome.storage.local` is
  ~10MB and needs `unlimitedStorage`; IndexedDB is the right home for hundreds
  of megabytes of page text and needs no permission.

What is lost, honestly: **server-side observability**. We could see a run
crash; now we cannot. That is the trade, and it is the correct trade for a
product whose premise is *it reads your email*. `main.py`'s `scan`/`metrics`
logging stays and still gives us everything except content.

## What is true today, and must not be oversold

**Until the local-first refactor lands, the page text is on the server's disk.**
No amount of documentation changes that. So:

- `PRIVACY.md` describes the *target* and the *current* state honestly, and the
  deletion path is real (delete the files) rather than theoretical.
- The launch gates are partly closed. `/ws/ext` is now gated on
  `AGENT_SECRET`, which is the privacy control — but only when one is set,
  and "no secret" is a warning rather than a refusal so that loopback dev
  still works. A file full of someone's bank statement behind a server
  with no secret set is still the thing to avoid.
- Sequence: **auth** (done 2026-10-03), then **retention and delete**, then
  local-first. Doing local-first first leaves an open door pointed at a
  directory that no longer has the interesting files — which is fine, but
  the door should be closed either way.

## Writing new code here

Before adding a field, an endpoint or a metric, ask: **is this user content,
and where does it land?**

- Content going into an audit document → the sidecar, and it is the user's.
- Content going into a counter → it does not.
- Content going onto the operator's disk at all → it needs a reason that
  survives "would I be comfortable if this leaked".
