# Audit Trail — design

**Date:** 2026-09-29
**Branch:** `feat/audit-trail`
**Status:** approved in conversation; written spec for review

## What this is

One nested JSON document per session, written by the server, that is the single
source of truth for a run: ordered turns, every prompt the user was asked and
how it was answered, timestamps, and token usage per turn and per session. It
must be able to replay a session and drive the side-panel history UI in the same
order.

No database. Files under `logs/sessions/`, plus a small index in
`chrome.storage.local`.

## Why it replaces the existing logs

The server already persists per-run data in `agent/run_logger.py`:
`logs/runs/<task_id>/{steps.jsonl, policy.log, scratchpad.txt}`. On the extension
path `task_id == session_id`, so a per-session key already exists. This feature
**replaces** `steps.jsonl` and `policy.log` with the nested document. Keeping
both would mean two formats kept in sync by hand and two artifacts that can
disagree about what happened.

`scratchpad.txt` stays. It has a separate job — the agent re-reads it to restore
its own memory across a restart, and it has a documented plain-text format with a
legacy-compat parse. It is also folded into the audit JSON as a snapshot.

The panel's `chrome.storage.local['sessions']` list stays, but demoted to an
**index**: enough to render the list with zero network calls, not enough to be a
second source of truth.

## Decisions this spec rests on

1. **The server owns the canonical record.** It is the only side that sees
   per-turn token counts, model id, `policy_mode`, and `final_url`. The panel
   receives a context *percentage* from `step_progress`, never `usage`.
2. **Verbatim content, with password-field redaction.** Thoughts, reasoning,
   action args, and page text are stored as the run produced them. The exception
   is `type_text` into a field the DOM or its accessible name marks as secret.
3. **The audit writer can never break a task.** Every write is wrapped; a failure
   is counted, logged, and recorded in the document's own `errors` array. It is
   never raised into the agent loop.
4. **Part A lands before Part B.** Reconnect/resume reads its state out of the
   audit document, so building it first would mean inventing a second state
   format and deleting it a week later.

## Part A — the audit trail

### A.1 Write strategy

The writer holds the whole session document in memory. Every `record_*` call
mutates it and flushes:

```
json.dump(doc) -> logs/sessions/<session_id>.json.tmp
os.replace(tmp, logs/sessions/<session_id>.json)
```

`os.replace` is atomic on POSIX. That single stdlib call is the entire durability
story: a crash or a kill mid-write leaves the *previous* valid file, never a
truncated one. There is no window in which the file is unparseable.

The consequence that matters: the file is **always** a complete nested document,
so `GET /v1/sessions/{id}/audit` works mid-task. That is what makes it usable for
monitoring, and it is why append-only JSONL was rejected — under JSONL the
document the user asked for does not exist until the task ends cleanly, so a
crashed task, which is exactly when an audit trail matters, leaves nothing.

**Ceiling.** A 30-step session is roughly 100–300 KB rewritten ~40 times, which
costs nothing. If sessions grow to megabytes — per-step full page text would do
it — this becomes append-JSONL plus compaction at task end.

**Read tolerance.** A truncated or hand-edited file must still open. `read()`
catches `JSONDecodeError` and returns a stub document carrying `corrupt: true`
and whatever `schema_version` it can salvage, so the panel renders a broken
session rather than a blank screen.

**Size cap.** A single scalar is capped on write (`MAX_FIELD_CHARS`, 8 KB) to stop
one pathological page from producing a multi-megabyte document. The cap is
recorded: the field keeps its first `MAX_FIELD_CHARS` and gains
`"…truncated": true`.

### A.2 Document shape

`schema_version` is present from day one so Part B can read a file written by an
older build.

```jsonc
{
  "schema_version": 1,
  "session_id": "uuid",
  "created_at": "2026-09-29T10:00:00.000Z",
  "updated_at": "2026-09-29T10:04:12.880Z",
  "status": "running",              // running|completed|failed|cancelled|interrupted
  "goal": "find my most starred repo",

  "client": { "ip_hash": "sha256:...", "extension_version": "1.0.0" },

  "model": {
    "provider": "minimax", "model": "MiniMax-M3",
    "context_window": 1000000, "source": "env"   // inline|user_file|env
  },

  "policy": {
    "mode": "secure", "blacklist": ["mail.google.com"],
    "sensitive_actions": ["send_email"],
    "source": { "floor": [...], "user": [...] }
  },

  "totals": {
    "turns": 7, "steps": 7, "prompts": 2, "actions": 9,
    "tokens_in": 41230, "tokens_out": 3140,
    "wall_s": 42.3, "errors": 0
  },

  "turns": [
    {
      "seq": 1,                      // monotonic across the session
      "step": 0,
      "started_at": "...", "ended_at": "...",

      "observation": {
        "url": "https://github.com/", "page_title": "GitHub",
        "ax_targets": 41, "ax_chars": 12345, "ax_diff": "…",
        "page_text_chars": 890
      },

      "model": {
        "provider": "minimax", "model": "MiniMax-M3",
        "thought": "Open the star-sorted view.",
        "reasoning": "…",
        "tokens_in": 1500, "tokens_out": 220,
        "context_pct": 0.15, "latency_ms": 1820
      },

      "prompts": [                    // in the order they were raised
        {
          "seq": 3, "kind": "first_time_seen",   // first_navigation |
                                                   // cross_domain_click |
                                                   // sensitive_action |
                                                   // critical_action |
                                                   // ask_human | login
          "status": "answered",       // answered|timeout|abandoned
          "raised_at": "...", "answered_at": "...", "wait_ms": 4210,
          "action": "click", "args": {"ref": "…"},
          "domain": "github.com",
          "reason": "First time on github.com: the agent wants to click something.",
          "decision": "approved",     // approved|denied|timeout|resumed|skipped
          "response": "yes"
        }
      ],

      "actions": [
        {
          "action": "navigate", "args": {"url": "…"},
          "outcome": "Navigated to …", "ok": true,
          "started_at": "...", "ended_at": "...", "duration_ms": 812,
          "redacted": false           // true when args were scrubbed
        }
      ],

      "timings": {"observe": 0.31, "filter": 0.02, "model_plan": 1.82, "execute": 0.44},
      "error": null
    }
  ],

  "result": {                        // present once terminal
    "status": "completed", "summary": "…",
    "extracted_data": {}, "failure_reason": null, "tried": [],
    "final_url": "…", "policy_mode": "secure", "timing": { }
  },

  "errors": [                        // writer failures AND run failures
    { "seq": 12, "at": "...", "error_id": "a1b2c3",
      "code": "ws_send_failed", "where": "harness.run.execute",
      "message": "…", "detail": {} }
  ],

  "scratchpad": { "entries": [], "notes": "" }   // snapshot at task end
}
```

**Ordering is causal, not incidental.** Within a turn: `model` → `prompts` →
`actions`. A first-time-seen approval is raised after the model decides and
before the click executes, so that is where it sits. The panel replays a turn by
walking that order.

`seq` is monotonic across the whole session and survives a partial read, so the
panel can detect a gap rather than silently rendering a short transcript.

### A.3 `AuditTrail` writer

New module `agent/audit.py`. Replaces `RunLogger`'s `log_step` and
`log_policy`; keeps the `Scratchpad` load/save methods, which move across intact
because their format is unchanged.

The harness already holds `run_log` and calls it at the right places, so the
diff is mostly a signature change plus the new record types:

| Existing call | Becomes |
|---|---|
| `run_log.log_step(step, url, action, args, reasoning, thought, outcome)` | `audit.record_turn(...)` — one call per step, with the full nested turn |
| `run_log.log_policy(step, kind, domain, action, decision, user_decision)` | `audit.record_policy(...)` — the flat cases (blocks, preflight) |
| — | `audit.record_prompt(...)` — at the seven prompt sites |
| — | `audit.record_error(...)` |
| `run_log.save_scratchpad(...)` | unchanged |

`record_turn` is called once, after the step's actions complete, so the turn
object is whole. Mid-step granularity is carried by `prompts[].seq` and
`actions[].started_at`, which is why `prompts` is written during the step but the
turn is flushed after it.

### A.4 Centralising the prompt sites

`harness.py:57` already claims *"every user-prompt site routes through these
helpers"* — no such helper exists. There are seven hand-duplicated blocks, each
of which sends a prompt, blocks on `human_input_queue.get()`, branches on
approve/deny, logs policy, and sets `deps.result`:

| Line | Kind | Notes |
|---|---|---|
| 464 | `first_navigation` | inside `_execute_action` (navigate) |
| 552 | `cross_domain_click` | inside `_execute_action` (click) |
| 724 | `ask_human` | inside `_execute_action`; question, not approval |
| 995 | `login_required` | **different contract** — see below |
| 1082 | `sensitive_action` | secure mode only |
| 1130 | `critical_action` | regex `CRITICAL_PATTERNS` |
| 1195 | `first_time_seen` | secure mode only |

A helper `_ask_user(...)` is built for real, and it approves-or-denies **and**
writes the prompt record in one place. That is a smaller diff than adding seven
audit calls, and it removes an existing inconsistency instead of layering on it.

`login_required` at 995 keeps its own path: it has a 300 s timeout that
`continue`s the loop rather than aborting, and a `skip` that aborts. Forcing it
through the approve/deny helper would mean growing that helper with a mode flag
to describe a contract it does not have. It calls `record_prompt` directly.

### A.5 Password redaction

The problem is real and pre-existing: `log_step` writes full `action_args`, and
`logs/runs/*/steps.jsonl` on this machine already contains
`"text": "hunter2"`. Login is a normal agent action, so whatever the user asks
the agent to type lands on disk. The audit trail would formalise that rather
than introduce it.

Detection, in order, resolved **only when a `type_text` fires**:

1. **Definitive.** `ref` → `backendNodeId` → `DOM.getAttributes` →
   `type == "password"`. The extension already has `node.backendDOMNodeId` in
   hand (`background.ts` `extractAx`) and already calls `DOM.getBoxModel` per
   target, so sending the id is free. One extra round trip per *typed action* —
   not per target, not per step. The loop is latency-bound, so the cost is
   deliberately not paid on every observation.
2. **Fallback.** The AX node's accessible name matches
   `password|passcode|passphrase|one-time|otp|pin`. This is what covers the dev
   Playwright path, which does not wire `backendNodeId`, and any target the
   definitive path misses.

When either fires, `args.text` is replaced with `"[redacted:password]"`,
`redacted: true` is set, and `text_chars` records the original length so the
replay can show *that* something was typed.

Emails, search queries, and page text are still written. That is the accepted
trade: the file lives on the user's own disk beside every page URL and page
text they already caused the agent to read.

Wiring needed: `SemanticTarget` gains `backend_node_id`; `_to_semantic`
(`cdp/extension_relay.py:210`) maps it; the extension includes `backendNodeId` in
each `axTargets` entry; `ExtensionCDPRelay` and the Playwright relay both gain a
`get_attributes(backend_node_id)` returning a dict.

### A.6 Reading it back

```
GET /v1/sessions            → list of {session_id, task, status, steps, started_at}
GET /v1/sessions/{id}/audit → the full document
```

Both unauthenticated, matching the existing `/health` and `/v1/policy` posture.
The audit document is the user's own data on their own server; it is not more
sensitive than the run it describes. A future auth layer gates all of them
together. The `client.ip_hash` field is a salted SHA-256 — the policy store
already persists hashed IPs (`main.py`, "keyed by IP so it survives a session
restart"), so this matches existing practice.

Unknown `session_id` → 404 with `{"error": "unknown session"}`, never a 500.
A corrupt document → 200 with `"corrupt": true` set, so the panel can render
"this session is damaged" rather than an error.

### A.7 The panel

`chrome.storage.local['sessions']` entries gain `session_id`:

```js
{ task, status, steps, elapsed, startedAt, session_id }
```

Dedupe moves to `session_id` with `startedAt` retained as the fallback for rows
written before this change, so an existing list does not duplicate on upgrade.

The panel has never received the server's `session_id` — the comment at
`sidepanel.js:275` says so explicitly. So the background adds it to the
`task_started` panel event (one field, alongside the existing `startedAt`).

**Click behaviour changes.** Today a row click refills the composer. Under this
spec a row click opens the transcript, and the transcript header carries a
**Re-run** button that refills the composer. Nothing is lost — the capability
moves one level deeper — and "history" stops meaning "a list of strings you can
retype". The transcript is rendered from the JSON in `seq` order: goal bubble,
then per turn a step card, then any prompt card (approval or ask) nested under
its turn in the order it was raised, then the result bubble. Terminal errors show
their `error_id`.

Fetching needs a failure path: server unreachable on a row click shows a toast and
leaves the row's composer-refill working, so a detail view never costs the user
the capability they already had.

### A.8 Error handling

**The writer never raises into the loop.** Every `record_*` and `_flush` is
wrapped. On failure: increment a dropped-write counter, log at WARNING, and append
to the document's own `errors` array with a generated `error_id`. A full disk
degrades the audit trail; it does not stop the agent. Since a failed flush cannot
persist its own error entry, the counter is reported at task end on the console
and in the `task_result` frame.

**Error correlation ids.** Every error the audit records gets a short
`error_id` (`base36`, 6 chars). It appears in the audit document, in the
structured log line, and in the panel's failure bubble. A user reporting a failure
can quote six characters, and that resolves to the exact turn, the exact error,
and the full document.

**Server.** Three endpoints call `await request.json()` unguarded
(`/v1/suggestions`, `/v1/policy_ack`, `/run`); a malformed body is an unhandled
500 today. Each gets a guarded parse returning 400. An app-level exception
handler returns a JSON envelope carrying an `error_id` instead of FastAPI's
default HTML traceback page. `SessionRegistry._sessions` grows without bound —
sessions are never evicted — so a cap with LRU eviction is added.

**Extension.** The failures found while tracing, all in `background.ts`:

| Site | Failure |
|---|---|
| `:588` | `if (!activeTabId) return;` at the top of the WS handler drops **every** server message, including `task_result`, silently |
| `:730` | `ws.onerror` carries no event detail; a fixed string is reported |
| `:785` | `cleanup()` wipes all of `chrome.storage.session` including `panelLog`, so a run ending via WS close loses its replay log |
| `:575` | `getStoredModelConfig()` failure in `onopen` is unhandled — no `task_start` is sent and nothing reports it |
| `:727` | unknown WS `msg.type` falls out of the switch silently |
| `:131` | approval/clarify resolvers live in in-memory Maps, so a card replayed after service-worker eviction is unanswerable and `submit_approval` returns `{success: false}` |
| `:370` | `notifyUi` swallows every send failure with `.catch(() => undefined)` |

All seven are in Part A. The `notifyUi` one is deliberate for a dead panel, but
it must not also swallow a *live* panel's failed delivery of a terminal event, so
it distinguishes the two.

## Part B — reconnect and resume

Depends on Part A. Every input below is already in the document.

### B.1 Why resume is tractable

`harness.py:773` calls `agent.run(_turn_to_prompt(turn), deps=deps)` with a
**single rebuilt prompt string and no `message_history`**. The model never sees a
message list; each step's context is reconstructed from `step_summaries` plus the
scratchpad. The harness is therefore already stateless per step, and resuming
loses nothing the original run had — the original only ever saw the summaries
too.

Resume state is: the step counter, `step_summaries`, `scratchpad`,
`visited_domains`, `seen_first_time`. All are in the audit document and in
`scratchpad.txt`.

### B.2 Reconnect

Extension side: on an **unexpected** WS close during a live task, reconnect with
exponential backoff and jitter (1 s base, ×2, cap 30 s, full jitter), reusing the
existing `session_id`. The server's `SequenceTracker` (D9) already dedupes
replayed observations for a reused `session_id`, so a reconnect is already a
supported shape server-side.

**The gap this must close:** `websocket_extension` currently starts a fresh
`harness.run` per accepted socket, so a reconnect for a live `session_id` would
start a *second* agent driving the same browser. The server must track live
`session_id`s and, on a `task_start` for a session that already has a live task,
cancel the old task and resume from the audit document rather than starting
over.

`stopRelay` and `policy_preflight` closes are not unexpected and must not
reconnect. A user-cancelled task must not resurrect.

### B.3 Resume

On reconnect with a resumable session: reload `step_summaries` and the scratchpad
from the document, set the step counter to the last completed turn, and continue
the loop. The turn sequence in the document is the resume point, so a turn that
was in flight when the socket died is re-run rather than half-recorded — the
resume counter comes from *completed* turns only.

A session whose state is not resumable (corrupt document, schema version
mismatch) is reported as `interrupted` with the reason, not silently restarted.

## Testing

One runnable check per non-trivial piece, per the project's testing agreement.

**Audit writer**
- Atomicity: simulate a failure mid-`json.dump` and assert the previous file is
  still valid JSON.
- Corruption tolerance: truncate a written file at a random byte, assert `read()`
  returns a stub with `corrupt: true` rather than raising.
- Writer-never-raises: point the writer at an unwritable path and assert every
  `record_*` returns normally and increments the dropped counter.
- Ordering: run the scripted planner through an approval and assert the prompt
  lands in `prompts` with a `seq` between the turn's `model` and its `actions`.

**Redaction**
- A scripted `type_text` into a target whose attributes say `type=password` and
  one that does not; assert the first is redacted and the second is not, and that
  `text_chars` survives in both.
- Name fallback: a target with no attributes available but an accessible name of
  "Password".

**Endpoint**
- Unknown `session_id` → 404. Corrupt document → 200 with `corrupt: true`.
  Malformed body to `/v1/suggestions` and `/v1/policy_ack` → 400, not 500.

**Harness refactor**
- The existing e2e suite covers all seven prompt sites by deny. That suite must
  pass unchanged through the `_ask_user` refactor — the deny-aborts contract and
  every `log_policy` row are observable assertions, so it is a real regression net
  for the consolidation.

**Panel**
- `session_id` present in the saved index; dedupe survives a replayed
  `task_started`; a row click with the server down still refills the composer.

**Resume**
- A session interrupted at turn 3 resumes at turn 3, and the model call count
  for turns 0–2 is not repeated.

**Manual** (no browser in the loop, so these are called out, not claimed):
- Live approval card ordering in the panel transcript.
- Password redaction against a real login form through the extension.
- Reconnect mid-task with a real network drop.

## What this does not do

- **No offline history.** A row click needs the server. The list still renders
  offline; the transcript does not. Mirroring the document into
  `chrome.storage.local` was considered and rejected: two copies of every run
  that can silently diverge, needing invalidation rules, against a 5 MB quota.
- **No database, no indexing, no query language.** One JSON file per session,
  read whole. A directory listing is the index.
- **No cost accounting.** `tokens_in`/`tokens_out` are recorded; per-model
  pricing is not applied. `cost_usd` is a `null` placeholder.
- **No retention or pruning policy.** Sessions accumulate. A cap is a
  follow-on; deleting a user's audit trail without being asked is worse than
  disk use.
- **No auth.** Matching the existing posture, and the future auth layer gates
  these endpoints with the rest.
- **The dev Playwright path's redaction is name-based only.** The definitive
  attribute check is wired for the extension path; the Playwright relay gains the
  `get_attributes` method but wiring its extractor is a follow-on.
