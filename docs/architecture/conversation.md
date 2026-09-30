# Audit trail, conversation lifecycle, and resume

Read before touching `agent/audit.py`, the `main.py` WebSocket frame handlers,
resume/reconnect, or anything that renders a past conversation.

## Audit trail

Every run writes one nested-JSON document per session to
`logs/sessions/<session_id>.json`: `turns[]`, each with
`observation → model → prompts[] → actions[]`, plus root-level `totals`,
`policy_events[]`, `errors[]`, and a `scratchpad` snapshot. `GET
/v1/sessions/{id}/audit` serves it and the panel's transcript view renders
it. There is no database; the file is the record.

**Atomic write, and that is the whole durability mechanism.** `json.dump` to
`<id>.json.tmp` then `os.replace`, which is atomic on POSIX — a crash
mid-write leaves the previous valid document, never a truncated one. It was
chosen over append-only JSONL specifically because a JSONL trail does not
form a nested document until a task ends *cleanly*, i.e. it holds nothing
exactly when you want the audit.

Five things that are load-bearing, and each is a way this could have been
quietly wrong:

- **Key order inside a turn is causal and the tests assert it** —
  `model → prompts → actions`, because that is the order they happen in and
  the order a replay walks. Dict ordering survives the JSON round trip
  because `json.dump` does not sort by default.
- **A turn with `ended_at: null` is unfinished, never a resume point.** A
  turn in flight when the socket died describes actions that may or may not
  have run, so it is re-run from scratch rather than half-recorded. This is
  the same reason an approved-but-unexecuted action is not replayed as if it
  had.
- **Writes never raise.** A failed flush increments `dropped_writes`, counts
  into `totals["errors"]`, and logs — the loop never sees an audit failure.
  So the log line carries the exception *type* and not its message: a
  serialization error quotes the value that failed, and that value is the
  document. `pytest` still exercises the failure path by standing a file
  where the sessions directory must be.
- **The scratchpad is per session** (`<session_id>.scratchpad.txt`). `dir`
  is the root that holds *every* session, so a bare `scratchpad.txt` there
  would let concurrent tasks overwrite each other's memory and read each
  other's.
- **`is_secret_field` lives in exactly one place.** A `type=password` check
  misses an API-key field, because those are usually `type=text` or
  `type=email` — so the accessible name is the only signal left, and the
  Playwright relay and the extension relay must not be able to disagree
  about it. Over-redacting costs a replay that says `[redacted]`; under-
  redacting costs a plaintext credential on disk forever, and every
  ambiguous branch resolves toward redact.

A live `AuditTrail` holds the document in memory and rewrites the whole file
on every flush, so a second writer read-modify-writing the path gets clobbered
by the next flush. `append_policy_event` routes through the live instance for
this reason, and `close()` deregisters — only on a terminal path.

### A session is a conversation

`schema_version: 2` splits the document into three collections, because "one
session" used to mean "one run" and now means "one conversation":

- `tasks[]` — one entry per task, i.e. per user message in the conversation.
  This is the segmentation.
- `messages[]` — the transcript a human reads: one entry per user message and
  one per completed turn. This is what the panel renders.
- `turns[]` — the audit, unchanged from v1, each turn carrying `task` (the
  index into `tasks[]`) so the join `messages[].turn → turns[]` and
  `turns[].task → tasks[]` can group a multi-task conversation.

**Who writes `messages[]` matters, and it is not one place.** The user message
is written at `task_start`, not at the first turn, so a run cancelled at step 0
still keeps what the user asked. The assistant message is written when a turn
ends, so an in-flight turn has no answer in the transcript — which is true.

**Every new task calls `begin_task`, including the first one on a fresh
session.** The branch used to be gated on a document already existing, so a
first run recorded no task at all and the *second* run claimed index 0 — the
conversation's own segmentation lost its first task, and the first follow-up
matched nothing in the `task < task_index` filter and answered with no memory
of what it was following up on. Three tests in `test_conversation.py` drive
`run()` twice against one real document rather than a decision function,
because the decision-function tests passed straight over all of it.

**`seq` is restored on adopt.** The counter is per-`AuditTrail` and a trail is
built per run, so a continuation restarted numbering at 1 and a document could
hold three turns called `seq 1` — and `seq` is what a reader sorts on to
replay. `_adopt_document` now takes the previous maximum over `turns[]` and
`errors[]`, which draw on the same counter.

**Both paths carry the conversation, and the prompt caps what a message
contributes.** A resume has `step_summaries` for the run it is continuing, not
for the tasks before it, so it gets the same `task < task_index` filter as a new
task. Per message the prompt truncates at `_CONV_MSG_CHARS` (1200) because the
harness is stateless per step — the block is re-sent on *every* step of the
follow-up, so a long-form answer is thousands of characters times every action.
The stored message is untouched; the cap is a rendering decision, and truncating
the record would lose the answer the transcript exists to preserve.

**`task_start` carries a `resume: bool`, and it is the whole lifecycle fork.**
A frame without it is a follow-up, and defaults to follow-up: an extension
predating the flag never reconnects with resume intent, so defaulting the other
way would let a new task silently restart an approved run. `resume: true` is
crash resume; `resume: false` on a terminal document is a new task appended to
the same conversation. `_conversation_state(session_id, *, resume)` returns
`new_task` / `resume` / `refuse` and is the only place that decides.

Three things that are easy to get wrong and were:

- **`resume_task()` exists because hardcoding `0` is wrong.** A crash in the
  *second* task of a conversation would write its turns and messages into the
  first task's segment. 0 is right for a first task and for a v1 document,
  which is exactly why it survives casual testing.
- **`interrupted` is in `_TERMINAL_DOC_STATUSES`.** It is written only by a
  resume *refusal*, over the terminal status it was refusing to resume from.
  Without it, one refusal made a second attempt resume a finished run.
- **A cancel releases the run, not the conversation.** `stopRelay()` used to
  drop the tab, the session id and the debugger, so a message typed after a
  cancel found nothing to continue and minted a new session. The clean-finish
  path already kept them; the cancel path now matches, and a genuinely new
  conversation detaches in `startRelay`'s mint branch.

**`status: running` on disk is not evidence of a live run.** A dropped socket,
a server restart or a killed process leaves the document `running` with a turn
still open, and `_conversation_state` used to refuse the user's next message
with *"a run on this conversation is still in flight"*. That was both untrue
and a dead end: `main.py` has **already** refused a `task_start` while an agent
is actually driving the session (`duplicate_task_start`, `websocket.close(4009)`),
so by the time `_conversation_state` runs, `running` means *abandoned*. It
re-derived liveness from a stale on-disk field, and the wrong derivation.

It was worse than a wrong message, because the refusal path also stamps the
document `interrupted`: the abandoned run's real status was destroyed on the
way out, and only the *second* attempt got through — so a dropped socket read
as flakiness rather than a bug. A non-terminal document is now a `new_task`,
and the abandoned task is sealed `interrupted` via `audit.seal_task` before the
new one is appended, so the history list stops showing it as in progress. The
record is kept on top, never replaced: the turns and the prompt the user typed
are the only trace of what they asked for.

**What the refusal was actually protecting still holds, by a different
mechanism.** A turn with `ended_at: null` is not history — `_resume_state`
skips it — and a `new_task` starts at step 0 carrying no `step_summaries`, so
an approved-but-unfinished action can never look like it ran. The split (one
path re-enters, one path starts) is what protects it, not a status check.

`tasks[].status` had a second, quieter bug: `begin_task` wrote `"running"` and
**nothing ever updated it**, so every finished task in every document on disk
also read `running`. `_finish` now seals the task it belongs to, which is what
makes the orphaned-task check principled rather than a coincidence.

The resulting matrix, pinned by
`test_a_new_prompt_works_after_any_stop_reason` and
`test_only_an_unfinished_run_can_be_resumed`: a new prompt works after
**every** stop reason (drop, restart, Stop, completed, failed, awaiting
human); resume works only for a genuinely unfinished run, and refuses a
finished or cancelled one, because a cancelled task that resurrects is the
worse bug.

**A v1 document is still un-continuable**, and that is correct — it has no
`tasks[]` to append to. It is checked *before* status, so a v1 document that
was abandoned mid-run is refused on the schema rather than half-migrated. The
22 v1 documents on disk were deleted rather than migrated: 21 were
`fixture:auth-*` test runs and one was a manual check, and none had a
follow-up anyone could add.

**The model sees prior turns through `<conversation>`, not `message_history`.**
First 2 + last 6 messages, rendered as text. The harness is stateless per step,
so this block is the only place prior context enters — and passing
`message_history` *as well* would show the model the same conversation twice
from two sources that could disagree. AX trees are never carried forward; each
step's prompt holds only that step's tree.

**A window is only worth having if there is a way back to what it dropped.**
The block was first 2 + last 6 with a silent elision, and that is a one-way
door: a model told a turn was dropped, with no way to read it, concludes the
answer is unavailable and either guesses or asks the user. `recall_conversation(from_id, to_id)`
is the missing half — the same digest/body shape `recall_memory` already had
for the scratchpad. The block names the id range it dropped; the action fetches
it. **Write, then Select** — the scratchpad got this right first time and the
conversation did not.

**`recall_steps` is the same fix for step summaries, which had the same hole.**
`_HISTORY_WINDOW` is 12 (first 3 + last 9), so any task past step 12 silently
lost its middle — and the elision said only *"...steps omitted"*, naming neither
which ones nor a way to reach them. Both halves are now present: the block says
`... 8 steps omitted (steps 3–10) — recall_steps(from, to) to fetch any ...`,
and `recall_steps(from, to)` returns that range from `deps.step_summaries`,
capped at `_CONV_RECALL_CHARS`. A reversed range reads the same either way
round, and an out-of-range request names what the task actually has.

Two things follow, and the second is the one that was wrong first:

- **Truncation is head+tail, not head.** A `task_complete` summary opens with
  the method ("Here are the top stories:") and closes with the findings, and a
  follow-up is asked about the findings. `content[:1200]` kept the preamble and
  dropped the answer — worse than either end alone. It is now the same shape
  `_turn_to_prompt` already windows step summaries with.
- **The cap costs context, on purpose, and only because there is a fetch.** A
  per-step re-upload of eight full deep-dive answers is a standing tax on every
  action for the rest of the task. The window is the compression; the action is
  what makes the compression safe. The *record* is never truncated — the cap is
  rendering only, and `recall_conversation` returns the full text.

**KV cache.** The cacheable prefix is `SYSTEM_PROMPT + secure_prefix +
<conversation> + ## Task` — contiguous at the front, ~8–9.5K tokens, and
byte-identical across every step of a task. The growing "## Steps completed"
sits *after* that boundary, so history accumulating does not shrink the cache.
The AX tree and page text (~12K tokens) are uncacheable every step and always
were: the page genuinely changes. Nothing here wants reordering — a stable
prefix is already stable.

### Resume

`AgentHarness.run(deps, *, resume_from=0)`. This works because the harness is
**stateless per step**: `agent.run` is called with a freshly rebuilt prompt and
no `message_history`, so `step_summaries` + `scratchpad` ARE the model's entire
history. The document has both, which makes resume a reconstruction rather
than a guess. `visited_domains` is restored from the *approved* first-navigation
events only — re-adding a domain the user never approved would skip the prompt
that exists to ask them.

A stopped task and a dropped socket look identical to the server: the agent
task is cancelled either way, and only one of them may be resumed. So the
client says which it was in a `cancel` frame rather than leaving the server to
infer it from the disconnect, and a user-cancelled run is sealed `cancelled`
(never resumable) while a dropped one is left `running`.

A document that is corrupt, is at another `schema_version`, or belongs to a run
that already ended is reported as `status: "interrupted"` with the reason —
never silently restarted, because a silent restart re-runs actions the user
approved. Two consequences worth keeping: the refusal is recorded **on top of**
the existing record rather than replacing it, and a corrupt file is left
byte-for-byte as found. It is the only copy of a run nobody can read, and "we
cannot read it" is not a reason to delete it.

The extension reconnects with full jitter (1s base, ×2, 30s cap, 6 attempts)
reusing the `session_id`. `stopRelay` and a cancel never reconnect — a
cancelled task must not resurrect.

**Not verified in a browser.** The reconnect path and the offline-history
fallback are unit-tested logic only.
