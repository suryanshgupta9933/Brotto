# Conversation Sessions — Design

> Status: draft, awaiting review. Supersedes nothing; extends
> `2026-09-29-audit-trail-design.md`, whose document shape is the base.

## The problem

A session today is one task. The user sends "research X", the agent researches,
the run ends, and the session is closed. Sending "now write a LinkedIn post
about it and post it" starts a *brand new* session: a new `session_id`, a new
document, a model with no memory of the research it just did.

That is the opposite of how the product is used. The real shape is one long
automation the user drives, in which they can intervene at any point:

```
user      research the top 5 repos for suryansh
assistant opened the star-sorted view, found 5 repos, listed them
user      now write a LinkedIn post about the top one and post it
assistant drafted the post, asked before publishing, posted it
```

Today that second line is impossible without re-explaining everything. This
spec makes one session a conversation that holds every task in it.

## What a session becomes

**A session is a conversation, not a run.** `session_id` is minted once, when
the user starts a conversation, and reused for every task they send in it. The
audit document is that conversation: one file, one timeline, all of it.

This is a direct consequence of "a single session with all the audit trail and
metadata". It changes what the panel's history list means, which is the one
visible cost, and it is unavoidable under this model.

## The document, v2

`schema_version` goes to **2**. The shape changes materially and a v1 reader
must not silently misread it.

```jsonc
{
  "schema_version": 2,
  "session_id": "…", "created_at": "…", "updated_at": "…",
  "status": "completed",              // the conversation's current state
  "title": "research the top 5 repos…",// first task's goal — history-list label
  "client": {…}, "model": {…}, "policy": {…},
  "totals": {…},                      // summed across every task

  "tasks": [                          // NEW — one per thing the user asked for
    { "index": 0, "goal": "…", "started_at": "…", "ended_at": "…",
      "status": "completed", "result": {…}, "steps": 5,
      "message_ids": ["m1", "m2"] }
  ],

  "messages": [                       // NEW — the chatbot transcript
    { "id": "m1", "role": "user",      // "user" | "assistant"
      "content": "research the top 5…", "at": "…",
      "task": 0, "turn": null }        // turn = GLOBAL index into turns[], user msgs have null
  ],

  "turns": [ { "task": 0, "step": 0, "observation": …, "model": …,
               "prompts": […], "actions": […], … } ],   // now carries "task"
  "errors": […], "policy_events": […], "scratchpad": {…}, "result": {…}
}
```

Three things are deliberately kept apart:

- **`messages[]` is the transcript.** Role, content, timestamp. This is what a
  human reads and what the panel renders. It is the chatbot surface.
- **`turns[]` is the audit.** Observations, thoughts, approvals and their
  decisions, actions and outcomes, timings, tokens. Unchanged from v1 apart
  from the `task` index.
- **`tasks[]` is the segmentation.** So a twenty-task conversation is still
  navigable, and the transcript can show which task each stretch belongs to.

The join is `messages[].turn` → `turns[]` (a **global** index into `turns[]`,
not per-task), and `turns[].task` → `tasks[]`.

## Who writes `messages[]`

Two writers, at two moments, and the timing is load-bearing:

- **The user message is written when `task_start` arrives**, before the first
  turn. A run cancelled at step 0 has no turns, so a message appended per turn
  would lose the prompt the user actually typed.
- **The assistant message is written when a turn is completed**, from that
  turn's outcome — its result, or its final thought when the run ended on
  `cannot_complete`. One assistant message per turn, not per action.

Both are appended by the harness through `AuditTrail`, so a crashed run leaves
the same conversation behind as a clean one.

## ChatMessage

New, in `agent/context.py` beside the other models:

```python
class ChatMessage(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    at: str                      # ISO8601
    task: int = 0                # which task it belongs to
    turn: int | None = None      # index into turns[], for assistant messages
```

The panel already has `appendUserMessage({role: 'user'})` and an
`appendMessage` shape of the same kind, so the UI vocabulary is not new.

## How the model gets the conversation

`message_history` is available on pydantic-ai 2.31 and was verified to replay
correctly, including history containing real `ToolCallPart`/`ToolReturnPart`
pairs against our `AgentDecision` structured output. **We are not using it.**

The reason: the prompt already embeds `step_summaries`, so passing history as
well would show the model the same conversation twice, in two different
shapes, from two sources that could disagree. One representation, derived from
the transcript a human can read, is worth more than fidelity to the provider's
message format. So the transcript is rendered into a `<conversation>` block in
the prompt, immediately before the current task, and that block is built from
`messages[]`.

## Context

The user's concern, answered precisely:

- **Older AX trees are already not carried forward.** Each step's prompt holds
  that step's tree. There is no accumulating tree anywhere.
- **`step_summaries` is already windowed** — `_HISTORY_WINDOW = 12`, first 3 +
  last 9, with a `… N steps omitted …` marker.
- **`messages[]` is the one new thing that grows**, so it gets its own window:
  the **first 2 and last 6 messages** — 8 in the prompt, with an explicit
  `… N earlier messages omitted …` marker naming the count. A conversation
  message is a whole exchange rather than one step's summary, so a
  message-shaped window is much smaller than `_HISTORY_WINDOW = 12`; the goal
  is for the model to remember what the user asked first and what just
  happened, not to re-read the transcript.

**Auto-compaction is not built now.** The ceiling is a session whose transcript
outgrows the window; a dropped earlier turn is stated to the model rather than
silently lost, and the full text is always on disk in the document, so
compaction can be added later without data loss. That is the honest scope: no
summarisation model, no threshold machinery, until a real session needs it.

## Task lifecycle — the fork that matters

`run()` today refuses a finished document. That is the resume guard that stops
a crashed run from re-running actions the user approved, and it is load-bearing.

A follow-up task has to be told apart from a resume, because they do opposite
things with the same document. `task_start` grows one explicit field:

```jsonc
{ "type": "task_start", "goal": "…", "resume": false }
```

| document state | `resume` | behaviour |
|---|---|---|
| absent | either | new conversation, task 0 — there is nothing to resume, so `resume: true` is answered the same way |
| `running`, turn open | `true` | **resume** at last completed turn |
| `running`, no task in flight | `false` | resume refused; report, never silently restart |
| terminal (`completed`/`failed`/`cancelled`/`interrupted`) | `false` | **new task** appended as a new `tasks[]` entry |
| terminal | `true` | refused — the run already ended |
| `schema_version` 1 | `false` | refused with a readable reason (Migration) |
| any | — with a second live agent | refused, as today |

The `running, turn open` + `true` row is the only one that continues an
existing turn, and it is the only one that writes no new `tasks[]` entry. Every
other `true` row is a refusal, and every other `false` row either starts task 0
or appends a task.

**`interrupted` has to join `_TERMINAL_DOC_STATUSES`.** It is written only on
a resume refusal (`harness.py:1185`), which *overwrites* the terminal status it
was refusing to resume from. So a completed run that got a resume attempt
against it is stamped `interrupted`, and because `interrupted` is not in the
set, a second resume attempt sees a non-terminal document with a closed final
turn and resumes a run that already ended. The resume path is invisible to a
user today because the extension only sets `resume: true` from a socket drop;
conversation continuation routes more traffic through it, so the set is
corrected in the same change.

The resume path and the new-task path stop sharing a code path. That is what
makes both safe: a follow-up task can never resume into a half-finished step,
and a crash resume can never append a new task onto a live run.

## Interrupting and continuing

- **Mid-run, the composer already steers.** `{"type":"steer"}` drains into the
  next turn. Unchanged.
- **A cancelled run keeps its transcript.** `messages[]` is appended per
  completed turn, so stopping a run leaves the conversation readable up to
  that point; the follow-up task continues from it.
- **A cancelled run is still never resumed.** Cancelled stays terminal. The
  `cancel` frame and the sealing callback are unchanged.

## Panel

- **History list → conversations.** One row per session: title, task count,
  last activity. This is the visible cost of "one session per conversation".
- **Transcript** shows the full conversation: every `user` message, every
  `assistant` message, and the audit detail for the turns behind them, grouped
  by task.
- **"+ New task" → new conversation.** The button already exists and already
  clears session state; it becomes the "start a new conversation" action.
  Sending a message does **not** clear the session any more — that is the
  whole change on the client.

## Extension

- `startRelay` reuses the existing `session_id` when the user sends a follow-up
  message, and mints a new one only for a new conversation. `resume: true` is
  set only by the reconnect path, exactly as today.
- A reconnect keeps the same session and resumes; a cancel seals it and the
  next message starts a new task in that same conversation.

## Migration

Documents already on disk are v1 and stay readable, but are **not** opened for
new tasks: a follow-up into a v1 document would have to invent a `tasks[]`
segmentation that was never recorded. Opening a new conversation is one click;
backfilling is not worth the code. `read()` reports the version and the
new-task path refuses a v1 document with a clear reason.

## Review focus

The failure modes a person using this would hit, most likely first. Each gets a
test pinned to the task that owns the code.

1. **Follow-up task after a completed run** — the second goal must be answered
   with the first task's findings, and the document must contain both, in
   order.
2. **Follow-up after a *failed* run** — the transcript up to the failure is
   still valid context; the new task continues from it rather than being
   refused as terminal.
3. **Follow-up sent while a run is still live** — must be a steer or a
   refusal, never a second agent on one browser.
4. **A v1 document on disk** — a follow-up into it is refused with a readable
   reason, not a crash and not a silent truncation.
5. **A crashed run's approval, then a follow-up** — the follow-up is *refused*
   with the crash reported, and the approved-but-unexecuted action is not
   replayed. Resuming a crashed run is a separate, explicit reconnect, never
   something a typed message triggers.
6. **Transcript with a dropped window** — the omission marker names the count,
   and the full text is still on disk.
7. **A second resume attempt after a refused one** — the document is still
   terminal, and the second attempt is refused the same way. This is the
   `interrupted` hazard above, seen from the user's side.

## Not built

- **Auto-compaction** (above): a stated ceiling, not a silent one.
- **Conversation search across sessions.** The list is newest-first with no
  filtering.
- **Multi-tab conversations.** One session drives one tab; that is unchanged.
