# Side panel rendering: cards, markdown, and history replay

Read before touching `sidepanel.js` rendering, `renderMarkdown`, the clarify /
approval / login cards, or the history list.

## Cards answer in place

Clarify, approval and login cards used to be **removed** once answered, and the
user's reply was appended as an ordinary user bubble. The transcript then read
as the user having said something to nobody.

The card is the record of what the agent wanted; what changes on answering is
that it is no longer *waiting*. So `resolveCard` drops the controls, adds the
answer or the decision where they were, and clears `.blocking` — the left rule
stops breathing because the agent is running again. The reply goes **inside**
the card, not beside it, so the exchange reads as one exchange.

Consequences worth knowing:

- The clarify card is no longer removed on submit, so a *second* question would
  stack. `appendClarifyCard` settles the prior `.clarify-card.blocking` with
  "Brotto moved on without an answer." — it was still asked, and the replay
  draws from the audit, which never knew about the deletion. Replayed ones are
  marked `.resolved` so they survive.
- The approval card's "Action approved." floating bubble is gone; the decision
  is the card's last line. That also means `approval_resolved` can no longer
  silently do nothing when the card is missing.
- The login card settles the same way. The fade-out and the `.removing`
  keyframe it used went with it; `clearLoginPrompt(outcome)` writes the outcome
  into `.login-required-outcome` and nothing is removed. `@keyframes msg-leave`
  stays — `.toast.leaving` still uses it.
- **The sign-in Continue button is a sibling of the card, not a child.** It is
  appended to the message list, so `resolveCard`'s `card.querySelectorAll(
  '.login-continue-btn')` never reached it and the card resolved *with the
  button still on screen* — a settled sign-in that still looked live. The card
  is the record and it stays; the button is not part of it. `resolveCard` now
  walks forward from the card and drops the sibling. Removing it in
  `clearLoginPrompt` instead would leave the same gap open for any other card
  that grows an out-of-card control.
- **`fitModelPill` counted the handoff padding twice.** `offsetWidth` on the
  track's span already contains its `padding-right: 20px`, and the fit test
  added the same 20px again — so every model name overflowed by exactly one gap
  and *every* pill marqueed, including names that fit. The measurement is
  `offsetWidth > clientWidth` now. The two-copy track stays: it is what makes
  the travel seamless for a name that genuinely does not fit.

### A `type_xy` card must show the value it will write

`reasoning` used to be the preview of what a coordinate action types, capped at
120 characters — so a human could approve 120 characters and have 4,000 land in
the cell. Worse, the value sat inside that sentence's curly quotes, so a value
containing `”` closed them and spoke as harness prose on a consent surface.

The server now puts **no part of the value** in `reasoning`; it says only "the
text shown below this card". That makes the value block the promise the card
has to keep, so it is drawn for **every frame carrying a value, whatever
happened to the screenshot**, and it coerces anything non-null — the server
types `str(args.get("text") or "")`, so a `text: 123` from a model would
otherwise be invisible on the card and typed as "123".

`appendApprovalTarget` — the screenshot, crosshair and label — deliberately
knows nothing about the value and **bails out before drawing anything** when
the capture failed. A value drawn only inside it would leave a card promising
"the text shown below this card" with nothing below it: approvable, and
unreadable. The block belongs to the caller, which is why it is `appendApprovalValue`.

**A replayed card must not claim to show a value it cannot render.** Replay
draws from the audit document, where `_scrubbed` masks `text` to `REDACTED`
alongside a `text_chars` length. Rendering the mask under a heading promising
the whole of it is worse than showing nothing. `approvalValueUnavailable`
treats either signal — `text_chars`, or a whole-string `/^\[redacted…\]$/`
match — as not available, and the mask test is whole-string so a value that
merely *starts* with the word ("[redacted] is what it says") is still real text
that gets typed.

**A missing `args` is not a masked value.** `canonical_approval` sends no args
at all; treating that as a mask auto-denied every coordinate approval with a
dead card. Absence of args means the heading has to say there is nothing to
show, and nothing more.

**The value is shown with `textContent`, always.** `splitInvisible` splits it
into runs of ordinary text and runs of bidi controls, zero-width joiners,
tag-block codepoints and the rest of `INVISIBLE_CP`, marking the hidden runs
rather than dropping them — because **the full original string is what gets
typed**, so the card's job is to *show* characters it cannot faithfully render,
not to sanitise them. The set is enumerated rather than inverted for a
concrete reason: "everything outside L/N/P/S is invisible" would placeholder
`U+200D`, a legitimate zero-width joiner inside an emoji sequence, and would
mangle ordinary emoji on a consent surface.

Pinned by `scripts/test-coordinate-approval.test.js` (the live frame, the masked
replay, the `text: 123` coercion and the invisible runs) and
`scripts/test-approval-notification.test.js`.

## A card outlives the run that asked it

`clearBlockingCards` deleted every unanswered prompt on a terminal event. That
was right about approvals — the controls were dead — and wrong about
everything else: **a question Brotto asked is part of what happened.** Deleting
it left a hole in the transcript, and a worse one on a reopened session, where
the replay rebuilt from the audit and therefore redrew the question the panel
had just erased. An unanswered prompt is itself the record.

`settleBlockingCards(outcome)` resolves each outstanding card in place, and
every terminal path passes its own sentence — `setPhase` on done/error,
`stopTask`, `task_completed`, `task_failed` — so the card records *which* ending
arrived rather than a generic "resolved". It is one function with five callers,
not five deletions.

### A `completed` card is the agent's report, and the card says so

`REPORTED_NOTE` sits on **every** completed task, unconditionally, and reads
back that Brotto *reports* the task done — what it did, not a check of the
result.

`task_complete` is self-asserted: the harness records success the moment the
model says it is done, with nothing behind it. A click that silently did nothing
produces exactly the same card as a click that worked, and the panel was
rendering the two identically. **Nothing in the loop verifies success.** The one
thing that is verified is the *stop* decision — a step is only allowed to end the
run when the evidence says it should, which is a different claim in a different
direction. That asymmetry is the whole reason the note is unconditional: if the
note were conditional on a verification that does not exist, it would render on
the runs where a check happened to pass and be silent everywhere else, which is
a worse failure than saying it always.

**Verification is not being deferred here; it is refused, and the refusal is the
design.** There is nothing in the browser to inspect for most side effects — a
purchase, a send, a delete leaves no local trace — and a canvas app has no DOM to
ask. Any verifier that claimed confidence there would be the same
silence-is-not-a-measurement error the rest of these docs exist to prevent, in
the one place a user acts on the answer.

So the card stops implying otherwise rather than growing a check that would be
faked. Unconditional, because nothing is verified today. Pinned by
`scripts/test-completion-honesty.test.js`.

#### The note is collapsed, not removed — and it is a native `<details>`

It was a permanent line **above** every completed answer, and at 320px that
displaced the thing the user came to read: a run that genuinely worked was
rendered as a success wearing a disclaimer. It is now **below** the answer,
above the toolbar, and closed.

**Why it cannot be conditional (option 3).** The obvious improvement is to show
it only when the run had a reason to doubt itself, and **there is no such
signal on the wire.** `task_completed` carries `summary`, `steps` and
`finalAnswer` and nothing about doubt; the panel sees no canvas-dominance
measure and no refused step. Building one is a two-sided frame change and
`brotto-conversation`'s to make — and it would be the wrong change anyway,
because it re-introduces the exact failure the unconditional wording was chosen
against: a note that renders on the runs where the check happened to pass is
silent everywhere else, which is a *worse* failure than saying it always.

**Why `<details>` and not a hover glyph.** Option 1's risk is real: an affordance
that only answers to `:hover` is invisible on touch and to a screen-reader user
who does not hover. `<details>`/`<summary>` is the platform's answer to
"collapsed, opens in place" — click, Enter, and the screen reader's own
expand/collapse semantics, with no JS and no state to keep in sync. **The
summary is the accessible name, so it has to carry the claim on its own**:
`REPORTED_SUMMARY` ("Reported, not verified") names both halves of the sentence
below it, because it is the only part a reader who never opens anything meets.

**The full sentence is in the DOM either way.** The disclosure is a
presentation choice; it is not a licence to drop the text until asked. The
assertions on the structure (a native `details`, the summary naming the claim,
no mouse-only event handler, the sentence still inside the done branch) live in
`scripts/test-completion-honesty.test.js` alongside the four copy rules.

### The failure vocabulary is bidirectional, and both directions are code

`failureNote(code)` returns a sentence and a next step for every failure code, and
the contract it implements is **symmetric**:

- **No code in `REPORTABLE` may be missing from `FAILURE_NOTE`.** `REPORTABLE` in
  `session/failure_report.py` is 29 codes, and it — not the `failure_reason=`
  assignment sites — is the authoritative vocabulary. Six codes reach the panel
  *only* through it: `task_cap_reached` and its siblings are built into the
  relay's answer rather than assigned, so a check driven by grepping for
  `failure_reason=` looked complete while four user-facing codes had no sentence
  at all. Deleting `task_cap_reached` from the panel left that check green.
- **No code in `NOT_REPORTED` may appear in `FAILURE_NOTE`.** `NOT_REPORTED` is
  the five client-side conditions (`CANCELLED`, `TASK_ERROR`, `WS_ERROR`,
  `START_FAILED`, `NO_ACTIVE_TAB`) that never reach the operator's
  `failure_reports` ledger. An entry for one of those is a sentence about a
  failure nobody recorded, so the reverse direction is a real constraint and not
  tidiness.

**Why it had to be bidirectional: the failure mode of a missing code is a false
claim, not a blank.** `failureNote`'s fallthrough is *"Something went wrong. The
details are in Brotto's log."* A code that silently falls out of the table does
not render as nothing — it renders as a confident statement that there is a log
holding the reason. For `CANCELLED` that log does not exist at all: the user
cancelled, there is no Brotto log, and the panel told them to go read one. And
a code silently falling *out* of the ledger is equally invisible, because the
operator asking "did the run happen, and if not which of our codes says why"
gets a row with no code in it.

**An absence reads clean in review, which is why the test enumerates codes and
not sentences.** The check is `scripts/test-failure-reasons.test.js`, and it
reads both sets out of the source rather than restating them: `FAILURE_NOTE`
keys by brace-matching the table in `sidepanel.js`, `REPORTABLE` /
`NOT_REPORTED` by slicing the two `frozenset` literals in `failure_report.py`,
and the server's codes by finding every `failure_reason` assignment. A new code
shows up in the output the moment someone writes it, without anyone remembering
this file. It also asserts the reverse of the natural reading — that no
`NOT_REPORTED` code has grown a sentence — and that `failure_reason` is always a
literal, because a code that is not a constant cannot be looked up and the
model's own prose belonged in `summary`.

## The composer is the answer box

The clarify card used to carry its own text field. There is already one text
box in the panel, and two is worse than one: the card's copy was seeded at an
arbitrary focus, and a reply typed there looked like it had been sent when the
composer next read as empty. The question goes in the transcript; the answer
goes in the box the user is already looking at.

- **`sendUserMessage` branches first.** A pending `state.pendingClarifyId` means
  the send is an answer, not a task. Starting a task there would abandon the run
  that is blocked waiting for it. A `{"success": false}` from the resolver — the
  run moved on while the user was typing — puts the words back rather than
  dropping them.
- **One writer, two entry points.** `answerPendingClarify(answer)` is the only
  thing that resolves a card and posts the reply; the composer's send and the
  card's Skip both call it. They used to each do it themselves, which is how
  they drifted: Skip said "Skipped" in the transcript while the audit recorded
  an empty response.
- **The composer re-enables only for a clarify pause.** `setPhase` unlocks
  `sendBtn` when `state.pendingClarifyId` is set, and `clarify_request`
  therefore appends the card *before* setting the phase — reversed, `pendingClarifyId`
  is still null and nothing re-runs `setPhase`, leaving the run blocked on a
  question the panel would not accept an answer to. An approval pause stays
  locked; that one is answered by its own buttons.

## The sign-in card names the site and the task

`login_required` used to carry one string — "please log in: <title>" — and the
panel's fallback label ("this site") was therefore the common case, so the wall
named no site and no task. `harness.py` now sends `url`, `domain`, `page_title`
and `task` on the frame, and records the same four into `turns[].prompts[].args`.
Both, deliberately: the live card is built from the frame and the replayed one
from the audit, so a field present in only one is a card that changes shape the
moment you reopen the session.

The card draws the task as a subject line (`.login-required-task`), the page
title as the body, and the URL as `.login-required-url`. All three are
`textContent` — the task string is the model's and the title is the site's, both
steerable by page content — and the `<a href>` is set **only** for `http(s)`,
the same guard `renderMarkdown` applies, because the current URL is whatever
the page last set.

`.login-required-outcome` is a fourth class, not a reuse of
`.login-required-body`: the title line owns that one, and `resolveCard` takes
the first match, so reusing it would have overwritten the title.

## New chat is hidden while a run is live

The `+ New chat` button shows when there is a conversation to leave *and*
nothing is running. A session id alone was enough, which left the one button
that ends a run sitting next to a live one — clicking it mid-task reset the
session out from under the agent.

`connecting` counts as running: it is the window between accepting a send and
`task_started`, and a task is already committed by then. A paused run still
holds the button, because the only ways out of a pause are the card or Stop.
The one exception is a stop in flight (`stopping` + `paused`), where the
outcome cell already reads STOPPED BY YOU — a stop mid-pause may never draw a
terminal event, so holding on there would strand the user in a run they killed.

## Markdown in the panel

`renderMarkdown` is hand-rolled, escape-first, and parses in **two passes where
the order is the point**: blocks are parsed from the raw lines, so a `#` inside
a fence is a fence rather than a heading, and each block's text then goes
through `renderInline` on its own. The previous version ran the inline regexes
over the joined HTML, which meant `**` inside a code span was bolded, an
unclosed `**` ran past the end of its block, and a bare URL inside a generated
tag was fair game. Real model output hit all three, and **none of them are
visible in a diff** — they were found by running the old renderer against real
output and reading the result.

**Code spans are pulled out first and restored last**, via a NUL-delimited
placeholder. A printable delimiter is not safe: a bare space-delimited index
would eat a real " 12 " in a price. Nothing inside a code span is emphasis, a
link, or a URL.

**A link href must match `https?://` explicitly**, so `javascript:` and its
case variants fail the test and stay visible text rather than becoming a dead
link. The autolink's `(?<![">])` lookbehind is what keeps a bare URL off the
href and label of the anchors the link pass already made.

Task-list checkboxes are **drawn in CSS** (`.md-box`), not glyphs — `☑`/`☒`
are rounded and would be the only non-square shapes in the panel. Tables get a
horizontal scroll wrapper because the panel is 320px and a wide table squeezed
into it is two characters per column.

**Not one string reaches `innerHTML` unescaped, and this is a security
property, not tidiness.** The model's own words are steerable by whatever text
is on the page it is reading, so every card that draws them — the approval
card, the clarify card, the sign-in card — builds its label, its body and its
metadata with `textContent` and a `createTextNode`, and only prose the user
would have typed goes through `renderMarkdown`. (The deleted plan card held the
same rule; the rule outlived it.)

## The server's index is the history

`renderHistory` reads `GET /v1/sessions` and renders what comes back. The
`chrome.storage.local` array is still written by `saveSession`, but only as the
**fallback** for a panel opened when the orchestrator cannot be reached — the
server being down, or a secret that does not match.

It is the source of truth because it is the only copy that is complete. The
local array caps at 20 rows and records only what *this browser* watched
finish, so a run on another machine, or one the cap pushed out, was on disk and
invisible — and a conversation the user cannot see is a conversation they cannot
delete. `historyEntries` returns `local` on any failure rather than an empty
list, because a history that empties itself when the server hiccups reads as
"your conversations are gone". **The mirror half is scoped to one server** — see
`privacy.md`, which owns that invariant.

Three consequences worth naming:

- **A row is matched by `session_id`, never by object identity.** A server row
  is rebuilt from the index on every open, so `filter(s => s !== row)` keeps
  every local row including the one being deleted. `deleteSession` is the only
  caller that learned this.
- **The index has no elapsed time** — only the loop reported that — so a
  server-supplied row shows `—` where a local one shows `2m 10s`.
- **The merged list is sorted newest-first and deduped by session id.**
  `mergeHistory` concatenated server rows, mirrored rows and the local array in
  that order, so the newest conversation was whichever the *first* source
  happened to hold — usually the server's oldest — and the same run appeared
  once per source that kept a copy. `sortHistory()` orders by `started_at`
  descending and keeps the first row per `session_id`; the sort runs inside
  `mergeHistory` so every caller is fixed at once. Pinned by
  `scripts/test-history-sort.test.js`.

### The list says where it came from

Falling back to the mirror on every failure is right and it is also how
"the server refused us" came to look exactly like "the server has no sessions":
**a bad `AGENT_SECRET` is a 404 by design** (`privacy.md` owns that), so one
wrong credential 404s `/v1/sessions`, `/v1/suggestions` and `/v1/policy` at
once, and the list still rendered — from local copies — with nothing marking
the difference.

`historyEntries` therefore records where its rows came from —
`server` / `rejected` (a 404) / `unreachable` (anything else) — and
`renderHistory` raises a card above the composer through `appendFailureBubble`,
the same failure card the model-not-set notice uses. **404 and unreachable get
different sentences because they have different fixes**: a 404 names the
credential, an unreachable names the server, and one sentence covering both
sends the reader to debug the wrong machine. A card rather than a header badge,
because the pill is gone (below) and this is a claim about a list they are
reading rather than ambient state. Pinned by
`scripts/test-history-source.test.js`.

## Reopening a conversation from history

Clicking a history row replays it into the normal chat bubbles rather than
opening a read-only audit view. A history row *is* a conversation, so opening
one has to leave the composer live and let the next message continue it.

**The replay rebuilds the conversation out of `tasks[]` / `turns[]` /
`prompts[]`, not `messages[]` alone.** Walking `messages[]` filtered to
user+assistant was the first version and it flattened the thread: step bubbles
lost their address rows, every question the agent asked was gone, and the
final answer read as an ordinary reply. The audit already held all of it — the
panel was the only thing not using it. Document order is causal order
(`tasks[]`, `turns[]` and each turn's `prompts[]`/`actions[]` are all
append-only), so the replay sorts nothing.

Three mappings are load-bearing:

- **A turn draws a step bubble only if it had an external action.** That is
  the same filter the harness applies before it emits `step_progress`
  (`_INTERNAL_ACTIONS`), so a scratchpad-only turn has to draw none — but its
  thought is still the only record of what happened, so it goes in as a plain
  bubble.
- **A turn's thought is the step bubble's title**, and `messages[]` holds the
  same string. Rendering both would say everything twice, so the step title
  wins and the message is dropped.
- **A task's final answer is the last assistant message of that task** — that
  is what `_close` writes `result.summary` as, and it is what the live panel
  marked with the done bubble. The exception is an aborted turn, which never
  reaches `_close` and so ends on a thought; that is told apart by the content
  matching `turns[].model.thought`.

`actionTarget` follows the harness rule rather than being read off the action:
only a `navigate` has a destination address worth drawing.

**A v1 document has no `messages[]` at all** — it recorded turns only — and
for those the run's own `goal` and `result.summary` stand in, because for a
v1 document the goal *is* the whole conversation.

**The failure path puts the task back in the composer, not an error screen.**
Losing the ability to re-run something is a regression, not a degradation. A
row written before the panel ever saw a session id has nothing to fetch and
does exactly what the row always did — refill the box.

**Continuing a replayed session is a background fix, not a panel fix.**
`startRelay` required `activeTabId !== null` to continue a session, and a
reopened one has no attached tab: the run that owned it finished long ago and
the debugger was released when it did. Panel-only, the follow-up would have
silently minted a *new* session while the panel showed the old thread with the
new results merged into it. Session id reuse (`keepSession`) and tab reuse are
now separate conditions, the `POST /v1/sessions` mint is guarded, and the
service worker adopts `message.session_id` when the panel sends
`continueSession`. Both the id and the tab have to be right or the conversation
splits.

`clearMessages({keepTranscript})` re-creates the idle placeholder, which is
what triggers `refreshEmptyState` → a suggestions model fetch. A panel holding
a conversation is not idle, so the placeholder is now skipped outright on that
path — it was previously being dropped into the middle of a replayed thread
*and* firing a model call for a panel that had work on screen.

**A replayed sign-in wall is not swept by a live prompt.** `clearLoginPrompt`
removes `.login-required-msg`, which a replayed card also carries, so the
resolved ones are marked and excluded — the history behind a live prompt must
not fade out because a new one arrived.

**The plan card was deleted, not left dead.** Nothing emitted a `plan` event,
so `appendPlanCard` never ran live and had no audit record to replay from. It
went on 2026-10-07 along with its `case 'plan':` handler and ~30 lines of CSS
grouped against the live approval and clarify cards. The argument for keeping
it was "untouched rather than resurrected — reviving it is a feature, not a
fix", and that argument only ever covered *reviving* it; a handler nothing can
reach is a claim the panel makes about itself and does not keep. This is the
second instance of the same shape after `canonical_step`: fully built, fully
reviewed, never run. Nothing in a diff points at a missing producer, so a test
cannot force one to appear — the only reliable check is that the code is not
there.

**Not verified in a browser.** The replay rendering and the follow-up
appending to the same server document both need a real pass. What *is* checked
is `scripts/test-replay.test.js`, which extracts the real functions out of
`sidepanel.js` by brace matching (so it cannot drift from what ships) and
asserts the shape: both task boundaries, two done bubbles, URLs on the step
bubbles, a scratchpad turn drawing no step, no duplicated thought, and all
three prompt kinds replayed resolved.

## The working line (and why it is not a stream)

A step is ~30s, and observe (~11.8s) plus `model_plan` (~13.8s) both complete
**before** `step_progress` fires. That gap is the whole problem: ~25s of a step
produces no frame at all, and the panel reads as hung even though the server is
busy.

**Streaming would not have fixed it**, on three independent grounds:

1. `AgentDecision` is structured JSON — `thought` plus `actions[]`. There is no
   prose token stream, and `thought` is ~10 tokens. There is nothing to render
   incrementally.
2. The latency is in **silence, not text**. The slow part happens before any
   model output exists, so a token stream would have nothing to carry.
3. Panel-closed forbids it structurally. No socket means no stream, and
   reopening replays a finished record. The feature has to work identically
   with the panel shut, which streaming by definition cannot.

**What ships instead: a frame at each phase boundary.** `harness.py` emits
`{"type": "canonical_step", "kind": "observe" | "plan"}` at the two boundaries;
`background.ts` forwards it verbatim; `sidepanel.js` maps the key to a line from
`WORKING_LINES`. A machine key rather than a sentence — the wording is
presentation, it lives where rendering lives, and a line edit never needs a
server deploy. An unrecognised `kind` falls back to the server's own text, so
the bubble still shows something. The frame is not audited — it is a progress
signal, not a record of anything the agent did.

**The real bug was a wired feature nobody sent.** `canonical_step` had a panel
handler, a bubble builder and a closer function, and had never once run —
`finishAssistantMessage` had no call site, so its caret blinked for the life of
the panel. The "it looks stuck" complaint was not a missing feature, it was a
missing producer.

### The parts that fail silently

- **The 700ms hold.** `setWorkingText` defers a line arriving inside the window
  rather than dropping it, and a burst inside one hold collapses to the last
  line. A cached page answers in under a second and both phase lines would
  otherwise flash past unread — which reads as *more* broken than the silence
  this replaced.
- **Teardown order.** `dropWorkingMessage` calls `stopSpinner` **before** the
  null check on the bubble. After it, the interval outlives the node it animates
  and writes frames into a detached element every 90ms. It fires from `setPhase`
  (any phase but `executing`), `step_card`, and `context_update` — the last
  because the server sends it *instead of* `step_progress` when a step had no
  visible action, so leaving the bubble up would claim the agent is busy through
  the whole next observe window.
- **Two identical lines in a row.** `workingLine` never repeats. Plain random
  repeats about one time in ten, and two identical lines running is precisely
  what reads as a stuck animation — the exact problem the varied wording exists
  to fix. The two phases draw independently, so an observe line and a plan line
  may legitimately collide.

### The spinner set is data

`SPINNER_FRAMES` is `{frames, ms, back}` per set, five of them, randomly picked,
so a new look is a new entry rather than new code. Three rules keep a sixth
honest, and all three are asserted rather than commented:

- **No two sets share a cadence.** Same shape at the same speed reads as one
  spinner seen five times, which defeats the variety.
- **Every frame is Block, Braille or Arrow** (`0x2580–0x259f`,
  `0x2800–0x28ff`, `0x2190–0x21ff`) — **no curves**. The sheet sets
  `border-radius: 0 !important` globally, so a circle is the one shape this
  panel has no vocabulary for, and a decorative star is not square either.
  Two sets were cut (`half`, `spokes`) for exactly this.
- **Every frame is a single character**, and `.working-spinner` carries a fixed
  `width: 1em`. That width is load-bearing, not tidiness: the glyphs are
  different widths, so without it the line reflows on every frame.

`back: true` ping-pongs at the ends instead of wrapping, so the motion reverses
rather than snapping from last back to first. `bar` needs it — wrapping would
snap a full block straight back to an empty one, which reads as a glitch.

`prefers-reduced-motion` is honoured in **JS** via `matchMedia`, not only in
the stylesheet, because the sheet's reduced-motion block cannot reach a ticker.
Reduced motion still gets a frame; it just stops ticking.

### Test

`scripts/test-working-line.test.js`, 49 checks. It stubs `Math.random` to walk
all five sets deterministically: the picker is a coin toss, so testing only the
drawn set leaves four of five unexercised most runs, and both motion branches
need covering every time.

**Verified in a browser 2026-10-03.** `▛▜▙▟` and `▖▘▝▗` render as real
quarter-block shapes, not tofu. This was a live risk while the face came from
`fonts.googleapis.com`: the glyphs live in a **separate `symbols` subset** of
Geist Mono, loaded on demand and therefore the one most likely to be absent
when a spinner starts drawing. Bundling every subset closed it — the check is
that `document.fonts.load("400 16px 'Geist Mono'", "▛▜▙▟▖▘▝▗")` resolves with
that face in `loaded`, which it does not if the subset is missing.

**The font is bundled, not fetched.** Geist and Geist Mono live in
`src/assets/*.woff2` with `@font-face` in `panel-tokens.css`, and the build
copies `woff2` alongside the other asset extensions. They came from
`fonts.googleapis.com` on every side-panel open, which told Google your IP and
that Brotto was installed — on every use of a product whose claim is that your
pages reach only the model you chose. Adding a webfont again reopens it.

## Which Brotto is this? ask the server, not the URL

The panel renders the server address read-only when the user is on Brotto
Cloud, and hides the `AGENT_SECRET` field in favour of the email + 6-digit code
sign-in. **That decision comes from `GET /health`'s `auth_mode`, not from
comparing the address against a constant.** The earlier `HOSTED_SERVER_URL` did
the comparison, and a comparison against text the user typed is a guess: a
trailing slash, a typed `http://`, or a case difference each read as self-host
and each hid the sign-in UI on a server that speaks `jwt`. The server knows
which one it is, so `applyAuthMode()` renders from `state.authMode`
(`'open' | 'secret' | 'jwt'`, null = not asked or not reachable, treated as
self-host because that is what every server said before `auth_mode` existed).

**`CLOUD_SERVER_URL` survives as a default value, never as the mode test.** It
is what a blank field resolves to when the server has said `jwt`, and what the
wizard writes into a read-only input. It is not how the panel decides anything.

**The mode is re-derived, not remembered.** The address can change under the
panel — the user edits the field in Settings — so every `input` clears
`state.authMode` to `null` and the `blur` handler re-probes. Probing per
keystroke would be a request per character; not clearing it would leave the
panel describing the address that *was* there. Until the probe lands the field
is editable, which is what someone pasting their own localhost must find.

**Nothing downstream branches on which credential is in the slot.** A cloud
access token is written into `settings.agentSecret` — the same key, the same
`Bearer` header, the same reader as a self-hoster's `AGENT_SECRET` — and the
extension never parses it. Signed-in therefore means *the slot is non-empty*,
read from storage, so there is no second flag that can disagree.

**Signing out is not "clear the field".** A stale token left in the slot is a
server refusing every call with a 404 — which reads exactly like a wrong
`AGENT_SECRET`, and sends the user to inspect a `.env` that never existed. So
the way out is the way in: `signOutOfCloud()` clears the slot and reopens the
wizard, which asks which Brotto this is.

**Six `FAILURE_NOTE` entries came with the cloud and none of them is a socket
failure.** `credential_missing` / `credential_rejected` are the client refusing
to run without a usable credential; `not_invited`, `revoked`,
`task_cap_reached` and `control_plane_unavailable` are the relay answering a
request it *did* authenticate. Neither group is fixed by sending the task again.
Pinned by `scripts/test-failure-reasons.test.js`.

**The wizard's status lines are toasts; the panel's are still inline.** Every
error and notification in `welcome.*` goes through a copy of the side panel's
`toast()` — fixed, square, 3px left rule for the kind, one at a time. The
three writers (`setCloudStatus` / `setServerStatus` / `setWaitlistStatus`) are
thin wrappers so call sites and extraction tests keep their names. **The sink
is `textContent` either way** — a typed email address lands in that text, and
the no-unescaped-`innerHTML` rule applies to a toast exactly as it applies to
a card.

**`POST /v1/auth/request-code` names the roster state.** It answers
`{"sent": true}` or `{"sent": false, "reason": "not_on_list" | "pending" |
"revoked" | "try_again"}`, always HTTP 200. Both surfaces map those to one
sentence each and only open the code box on `sent: true` — the box is still
the user's click asking for a code, and it stays shut when the server says no
mail is coming. **The wizard is the only caller of both `request-code` and
`exchange`**: sign-in is wizard-only, so there is no second surface left to
drift from the mapping.

## `approved` is a report, and the token is stored either way

`POST /v1/auth/exchange` answers `{access_token, approved, account_id}`.
**The wizard is now the only caller** — sign-in moved to the wizard, so
`welcome.js` `exchangeCode` reads `approved` at `welcome.js:429` and
`sidepanel.js` has no `exchange` call at all. The rule below is about how the
one reader treats the field, not about two agreeing readers.

**It is additive, so it is compared against `false`, never by truthiness.** A
relay too old to send the field omits it, and an omitted field is *not* a
refusal. Reading it as truthy would tell every user on an older relay they are
"not on the list", which is a sentence about a table they have never heard of.

**`approved: false` arrives with a valid token and a 200.** It means *we could
not confirm you are on the list*, which includes `beta_access` being
unreachable — an unreachable control plane and an absent row are the same
answer upstream, deliberately. So it is a **report, not a gate**: the real gate
is `not_invited` at task start, and a wrong answer here costs one confusing
sentence rather than an unauthorised run.

**The token is stored regardless, and there is no second flag.** `false` sets a
local variable that changes only the status sentence and prefills the waitlist
box; it never reaches `storeAgentSecret` (or `$agentSecret.value`). So
`cloudSignedIn()` stays *"the `settings.agentSecret` slot is non-empty"* —
adding an `approved` flag beside it would be a second source of truth that
could disagree with the first. **Someone approved later must start working
without signing in again**, and that is the whole reason the refusal is not
stored.

**Consequence: the refusal state is not persisted.** Reopening Settings says
"Signed in to Brotto Cloud" for an address that was refused. That is correct,
not a bug: the token really is there and really works. The beta state surfaces
where it is actually decided — **at the first task, as `not_invited`**, whose
copy was repointed at this block instead of at sign-in.

`prefillWaitlist(email)` is **offered, never sent**, in both surfaces. The user
has just read a code out of the inbox it prefills, which is why offering here
is consented rather than a capture.

## Cloud is the default; the address is proved before it is trusted

The wizard's first step is a radio, and **cloud is the one pre-selected** —
self-host is the deliberate opt-out. `initialEdition(storedServerUrl)` decides
what it opens on, and it decides on **the stored address**, which is the only
evidence there is: no stored address is a new install (cloud), the cloud
address is a signed-out cloud user (cloud), anything else is somebody who has
already answered and keeps their answer. **An existing self-host install is not
migrated, and is not re-asked** — `settings.onboarded`, written by `finish()`
on the Start button *and* on Skip, is what keeps the wizard off a panel that has
finished it. Inverting a default is only safe because that gate exists; a
default that re-asks somebody who answered once is worse than either default.
The cloud address is still written in from `CLOUD_SERVER_URL` and appears in no
markup.

**Blur is advice; save is the moment the address becomes true.** `checkServer()`
runs on blur *and* is called by Start before `finish()` writes anything,
because a dead address saved is the "find out on your first real task" failure
this screen exists to prevent. It returns what it found as well as writing it,
through one `setServerStatus`, so the line and the decision cannot disagree.

**Three answers, not one.** Reachable / reachable-but-the-key-was-refused (the
404 from an authenticated route) / no answer at all are three different things
to go and fix, and collapsing them is what sends people to debug the wrong
machine. A fourth — the origin refusal from `credentialFor` — arrives through
the same return.

**A failing save does not save; Skip still does.** The wizard is not a gate, so
Skip is unchanged: it writes the address without asking the server anything.
That is deliberate, and it is covered by the check below.

## A task is sent after the server has answered, once per address

`ensureConnected()` used to `fetch('/health')` itself, **unbounded**, on every
send. Two problems: a TCP blackhole hung the composer forever with no way out,
and a happy-path send paid for a request it did not need. It now asks the
service worker (`probe_server`), which runs the existing `serverIsAlive()` and
its `SERVER_PROBE_MS` — the bound is the reason there is one probe and not two,
and `serverIsAlive(url)` takes the address because the worker's module variable
is only assigned inside `startRelay`.

**The result is cached against the address, and that is the whole cost
argument.** First task on an address probes it; later tasks on the *same*
address make no request, so a transient blip during task 7 cannot refuse task
8. A failure is not cached, so the next send asks again. Editing the address in
Settings re-arms it, which is exactly the case the check is for.

**The credential check comes first and reuses the sentence.** `forUrl` is asked
before the probe, so a self-host address that does not match the credential's
recorded origin is caught with the *existing* refusal rather than a new one, and
the probe never runs. `ensureConnected` therefore returns a sentence instead of
throwing: a refusal dressed as a network error sends the user to debug the
wrong machine, which is the whole reason the two copies of `forUrl` exist.

## The credential belongs to the server that issued it

`settings.agentSecret` is one slot holding two things — a self-hoster's
`AGENT_SECRET` and, on the cloud path, a Supabase access token that is a real
account identity — and it used to ride to whatever address the settings field
held. So a mistyped host, an imported settings blob, or a colleague's
self-host received the user's Brotto Cloud token and the relay honoured it as
that account. `background.ts` binds it with `settings.agentSecretOrigin`,
recorded by whoever wrote the token.

**The panel had three more forwarding sites, not zero.** `authHeaders()` sends
that slot to `serverBase()` on eleven call sites — history, delete, audit,
policy, suggestions — and `welcome.js`'s `checkServer()` sends it to the same
user-typed address from the wizard. The wizard is the sharper one: it
**pre-fills** the stored credential into the field the user is about to be
asked about, so the key sitting there may be a cloud token they never typed.

- **`credential.js` is the panel's copy of the rule**, and there are two copies
  because the worker is a TS bundle and the panel is a plain script — they
  cannot share one function. Two copies drift, so
  `scripts/test-panel-credential.test.js` extracts *both* (`forUrl` and
  `credentialFor`) and runs them against one table; the first answer that
  differs fails the file. Re-implementing the origin comparison inline in
  `authHeaders` is how they would.
- **A refusal is surfaced, not swallowed.** A header that is quietly absent
  reads as a server that is not answering and sends the user to debug the
  wrong machine, so `authHeaders` toasts the refusal once per address.
- **The wizard's `typed` case.** A key just typed on the screen asking has no
  recorded issuer, and binding it would refuse the ordinary self-host case;
  a value *equal to the stored one* is bound.
- **Settings Save was a fifth writer nobody named.** That object replaces
  `settings` wholesale, so an origin it omitted was a credential the service
  worker then refused everywhere — including for the user who had just pressed
  Save. It records the address on that screen.

**The cloud address was not one-way.** `applyEdition`'s comment said the cloud
address is written on the way in and *never restored*, and the second half was
simply false: it writes into a user-editable input, so coming back to
self-host left `agent.brotto.dev` in a form about to be saved as `serverUrl`.
The prior value is snapshotted and put back.

## A frame with no case is a run that never ends

The panel's WS message switch is a bare `switch (message.type)` with a
`default:` that logs and drops. That is the right default for a frame the panel
genuinely does not care about — and it is exactly what made a bug invisible.

`main.py` sends `{"type": "task_error", "error": str(exc)}` from its `finally`,
for any exception the harness raised and nothing handled: an unresolvable model
config, a resolver raise, a bug. **`sidepanel.js` had no `case 'task_error'`.**
So the frame was dropped: `stopTimer()` never ran, `setOutcome()` never ran,
`clearBlockingCards()` never ran. The ACTIVE clock counted forever and OUTCOME
sat on WORKING while the server was already dead — indistinguishable from a slow
step. The socket close on top of it then tripped `scheduleReconnect()`, so the
header showed "retry 1 of 6" against a server that had crashed and could never
resume it. The two symptoms looked like one bug and were two.

**This is the failure mode of an absence.** A missing `case` leaves a diff that
reads clean — there is nothing in the change to question. So
`scripts/test-no-orphan-frames.test.js` enumerates the frames crossing the
service-worker → panel boundary (brace-matching every `notifyUi({…})` call in
`background.ts`, not a hand-kept list) and fails on any the panel does not
handle. Transport frames the panel is allowed to drop go in an `IGNORED` map
with a reason, because an unexplained exemption is the same hole wearing a
label. Verified to fail: excising the `task_error` case from a copy of the panel
turns four checks red and exits 1.

The rule for the next frame author: **a server frame is either rendered, or
listed in `IGNORED` with a reason.** There is no third state.

### There is no connection pill

The top bar carried one: a renderer, its CSS, and six mutators that repainted
it on every phase change. It is deleted, all of it — the header keeps only the
model pill. **Nothing was promoted into its place.**

The reason is what it cost rather than what it showed. It was the panel's only
ambient state, so every error the product had gained a voice for over the
previous weeks — a refused credential, a failed reconnect, a model that will not
pre-flight — was written into a strip of header text that is always visible and
always about something else. `SERVER UNREACHABLE… (RETRY 1 OF 6)` truncated
mid-word and pushed the rest of the header off screen; the width budget that
fixed it (`### Header text has a width budget`, now gone with the pill) was
maintained forever to keep a status line inside a header. A card is the panel's
own vocabulary for "this went wrong, and here is what to do", and it costs no
new CSS because `appendFailureBubble` already exists.

**An error surfaces as a card above the composer, or as nothing.** A socket that
reconnects on its own is not the user's problem yet, and a pill that says
`Reconnecting` three times a minute trains the reader to skip the one surface
that matters. Reachability that is *settled* — the answer to the `/health` probe
the panel already makes — is `state.serverReachable`, and it has its own
`serverBanner` mirroring the model-check banner. See `extension.md` for how that
answer is reached. Pinned by `scripts/test-no-conn-pill.test.js`.

### The API-key field is a pure function of storage

Three writers of the model-API-key slot live on three paths — Settings' Save,
the worker's `setStoredModelConfig`, and the wizard — and each one that removed
the
key left the field showing `KEY_MASK` over nothing behind it. That is not
cosmetic: **Save treats the mask as "unchanged, write nothing"**, so pressing it
after a removal stored nothing and the only way back was clearing the field by
hand.

`repaintKeyField()` reads storage and writes the mask or the empty string; it
runs after Save and on opening Settings, which is also how a wizard-side removal
reaches the panel. **Never let a writer announce its own change** — the two
writers outside this file are exactly the ones a local repaint cannot see. A
value that is neither the mask nor empty is a draft the user is typing and is
left alone, or re-opening Settings would eat what they pasted.
Pinned by `scripts/test-key-mask.test.js`.

## Local state is scoped by account, and only when there is one

Two cloud accounts in one Chrome profile shared **everything local**, because
the only separator was the server address — and the address is the same for
every account on the hosted relay. History, provider, model and the saved API
key were one flat slot each. The key is the one that mattered: account A's run
silently paid with account B's credential.

The relay now names the account — `account_id` on `POST /v1/auth/exchange`,
and on an authenticated `GET /v1/account` for a panel opened days later that
holds a stored token and has no exchange in this session (`privacy.md` owns
the route; `conversation.md` the two response shapes). **`state.accountId` is
that field, and nothing else.** It is never read off the token: decoding a
credential is the rule the whole design refuses, and a server that hands an id
over *as a field* is what makes scoping possible without breaking it.

### The self-host namespace must not move, and is pinned literally

`namespaceFor(base, accountId)` folds the id in as an **inner** key — the
address stays the outer one, `${ns}#${accountId}` — and **only when there is
one**. Every shape the server can answer with on a self-hoster's machine means
"no account", not "an account called nothing": `/v1/account` answers
`account_id: null`, a degraded `exchange` answers `""`, a 404 or an unreachable
server leaves it unset. All of them leave the namespace **byte-identical** to
what it has always been, because a self-hoster's mirrored rows were written
under those exact bytes and any change silently empties their History.

That is why `scripts/test-mirror-namespace.test.js` pins the literal string
rather than "different from something":

```js
check("self-host's namespace is the bare address, byte for byte",
  nsFor(SELF) === "http://localhost:8000", nsFor(SELF));
```

All six panel call sites pass `state.accountId` explicitly rather than letting
the store read storage, so the rule is visible at each site instead of being
inferred from module state. An account never leaks into another server's
namespace either — `namespaceFor(self, "acc-a") !== namespaceFor(cloud,
"acc-a")` is asserted, because the id means nothing without its address.

### The model config and the key carry the account too, and nothing migrates

`model_keys.js` (panel and wizard) and `model_config.ts` (the worker) hold one
`modelKeys(accountId)` each: `modelConfig:<id>` / `modelApiKey:<id>` with an id,
the flat `modelConfig` / `modelApiKey` without one. **Self-host is on the flat
keys, byte for byte what every install before accounts used** — the same
invariance as the namespace, for the same reason.

The worker is a TS bundle and the panel a plain script, so they cannot share
one function. `scripts/test-model-keys.test.js` runs both against one table
because two copies of a namespace rule that must agree is how one drifts.

**Nothing is migrated, and that is the decision, not an oversight.** A flat
`modelApiKey` written before this change belongs to whoever was signed in when
it was written and **nothing records which**. Copying it into whichever account
signs in next hands that account a credential that may be someone else's —
exactly the harm the split removes. So the cloud path ignores the flat key
entirely and a cloud user re-pastes once, into their own slot, after which the
two never meet. Self-host reads the flat key exactly as before, which is why
the cost is invisible to everyone who did not ask for accounts.

Sign-out and the expired-credential sweep both run one helper,
`dropCredential()`, which **deletes the account id with the token** *and the
account's artifacts*: `modelApiKey:<id>`, `modelConfig:<id>` and the mirror
namespace `${base}#${id}`. Left behind, the next sign-in as a different
account would inherit the previous one's history and settings, and the previous
one's provider key would sit on disk as a live credential with nothing left to
name it.

**The id is its own `chrome.storage.local` key, not a field in `settings`.** A
field means every writer reconstructs the whole blob from a snapshot taken
before an `await`, and anything that wrote `settings` in that window is
silently clobbered — `learnAccountId()` did exactly that to a server-url edit.
`welcome.js` `finish()` migrates a legacy `settings.accountId` once; the panel
does the same on its next open.

**One accessor: `accountScope()`.** Every namespace and every model-key name
goes through it, and it answers from storage when `state.accountId` is null —
so the scoping **cannot depend on a network call**. That was the bug: the id was
assigned only inside `learnAccountId()`, which sits inside the `try` wrapping
`/health` and returns early unless the mode is `jwt`, so a panel opened before
that probe settled read the **shared** namespace — the exact cross-account
disclosure the split removes.

**With a credential and no id on the cloud, the panel fails closed.** An
unqualified namespace is the shared one, so `accountScope()` resolves that case
to a namespace nothing has ever written and History reads empty. Empty is the
right answer to "whose history is this?" when we cannot tell; shared hands a
stranger's transcript to someone else. Self-host keeps the flat namespace
byte-identical, including while its server is unreachable, because the
discriminator is `auth_mode` off `/health` and never the address.

**A degraded cloud exchange does not store the model key.** `brottoModelKeys("")`
is the *flat* slot, so a sign-in that got a token but no account id would have
written this account's provider key into the shared one — the credential
crossover arriving through the failure path. The token is still stored (it is
the credential we hold, and the panel re-learns the id from `/v1/account`), the
key is not, and the user is told: *"Signed in, but we could not identify this
account, so your model key was not saved."*

### The clock reads in the units a run is measured in

`renderElapsed` printed `83.0s` — a number the reader has to convert, on the one
run worth reading slowly. `formatElapsed` renders `1m23s` / `1h23m26s` and keeps
the tenths **under** a minute, because a step is ~30s and there the tenths are
the difference between a fetch and a stall.

`resetForNewTask` called `stopTimer()` where it meant `clearTimer()`. The
distinction is load-bearing: `stopTimer` deliberately preserves `state.startTime`
so a finished run's time stays on screen, and a reset has no finished run to
preserve — the surviving base time made the replay guard refuse to rebase, so
the next run counted from the previous run's start. **Stopping a timer and
clearing one are different operations; a reset clears.** Pinned by
`scripts/test-timer.test.js`.

### Sharing a run replaces the thumbs

The thumbs up/down wrote a rating into `localStorage` that nothing ever read,
so the panel looked like it was reporting feedback and was not. Deleted with
its icons and CSS. What replaced it is a prefilled GitHub Discussions post: a
Markdown body composed from the run, put on the **clipboard**, with the bare
Discussions URL opened so the user pastes it. **No account, no backend, no
operator, and the same link on self-host as on the relay.**

The reason it is the clipboard and not the wire is the whole rule: task text is
user content, and a query string would put it in a URL — referrer headers,
history, proxies. The Markdown is fenced and escaped before it is copied, for
the same reason `renderMarkdown` is escape-first. Pinned by
`scripts/test-share-run.test.js`.

### The model pill is a settings button, and it is not a mode selector

`#modelPill` is a `div role="button"` that opens Settings. When no model is
chosen it used to read `Default` — a word that reads as a settled value, and in
the header was mistaken for a leftover normal/secure selector. It now reads
`Server default` and takes a dashed border via `.model-pill.no-model`, because
this browser chose nothing and the server decides. **The panel cannot see the
server's resolved config** — not the env var, not the per-user file — which is
why the label names the source rather than claiming a value.

An unset model therefore **warns and starts the run**, never blocks:
`BROTTO_FORCE_ENV_MODEL=1` makes an empty *panel* model entirely legitimate, and
refusing to start would break the ordinary case where the server is configured
and the browser isn't. The notice reuses `appendFailureBubble`, so it is the
theme's own failure card and costs no new CSS.

### The panel renders headless, so assets are never hand-built

`demo/tools/panel_shot.py` loads the shipped `sidepanel.html` in Chromium behind
a `chrome` shim and drives it through **the real `chrome.runtime.onMessage`
listener** — the same entry point a relay frame arrives at. Nothing in it
re-implements a card. This is the only way to get a panel screenshot that does
not start lying the day the panel changes; a mock would be a second copy of the
UI, and every marketing still is a place it can drift.

Three things that are not obvious and cost a run each:

- **Seed `chrome.storage`, then stub the server.** A `file://` origin gets CORS
  failures that are indistinguishable from a stopped server, so every shot
  carries the "server unreachable" toast until five `page.route()` endpoints
  answer. `state.serverReachable` is set from the *policy* call's body, not from
  `/health`.
- **`/v1/sessions` must return server-shaped rows.** `historyEntries()` prefers
  the server's list over the seeded local array, so seeding `sessions` alone
  renders an empty history. It also reads `row.dataset.status` off the panel's
  own vocabulary (`done` / `error`), not the server's (`completed` / `failed`) —
  wrong status, missing icon, no error.

The frames are the ones the relay really sends, and **every number in the shot
is the panel's own arithmetic** — `startedAt` seeds its clock, `index` counts its
steps, `context.pct` is what it draws as CONTEXT. The harness writes frames and
never touches the DOM, which is what keeps the screenshot evidence rather than
decoration.

The one DOM read is `getBoundingClientRect()`, for the callout anchors. That
is the exception that proves the rule: a hand-placed anchor drifts the moment the
panel's padding changes, and it drifts *silently* — the label keeps drawing,
pointing at whatever moved into its place. Those rects go into a **generated
`demo/src/seq.ts`**, not a JSON sidecar and not a list in the composition, because
a hand-kept frame order is a second copy that drifts exactly like the three model
catalogues did.

**The same session can read the panel's accessibility tree**, which is how the
second short cut shows a real `[0:98] button "APPROVE PLAN"` rather than a typed
one. `Accessibility.getFullAXTree` over the CDP session the harness is already
driving, formatted by the same rules as `agent/ax_filter.py`, and each node's
rect resolved with `DOM.getBoxModel({backendNodeId})` — **`backendNodeId`
directly, no `DOM.resolveNode` first**: that call returns an `object` handle with
no `node` key, and feeding it straight into `getBoxModel` fails with *"Either
nodeId, backendNodeId or objectId must be specified"*, which is thirteen null
boxes and a cut that points at nothing.

Line and box come from one `getFullAXTree` response, so the ref printed in the
video and the rectangle it lights are provably the same node. **It is also why
the listitems come back nameless** — Chrome puts a row's text in a child
`StaticText`, which `KEEP_ROLES` drops because `page_text` already carries it.
That is faithful to the product rather than a capture fault, and it moved the
cut's argument to the ref/element correspondence, which is the moat anyway.

**An anchor is only as good as the frame it is anchored to.** The Reads beat used
to lead its callout at `RUN_FRAMES - 40`, by which point the plan card it names
had left the screen and the approval card was standing where the rect said the
plan card was — so the label read "per-site consent" while pointing at "approval
needed". The plan card is on screen for the first 18 frames of the run, so the
lead is 3. Measuring the rect correctly does not help if the *frame* is wrong,
and a wrong frame is a semantic error, not a pixel one.

#### A panel screenshot is only evidence if it is legible

The first short cut staged the panel at its 420px CSS width, and the shots were
captured at 2x. Downscaling an 840px image into a 420px slot put the panel's own
11px body text at **five pixels** on a 1920px frame — the reviewer saw texture
and reported "the screenshots look so off", which is exactly the right thing to
report about a screenshot that cannot be read. Drawing the shot 1:1 at 840x1080
fixed it and made the panel the hero it was supposed to be.

**Capture, shot size and draw size are therefore one 2x pixel space** —
`VIEW_W`/`VIEW_H`/`DPR` in the harness, `PANEL_W`/`PANEL_H` in the composition,
and the callout rects all in it. Change one and the callouts land at the wrong
offset. The window is **420x540 CSS px of a ~1080px panel**: a full column is a
ninth of a 16:9 frame and cannot be shown at a readable size at all, so the
capture takes the top — status bar, claim card, composer — and a beat whose
evidence is lower scrolls the panel first.

**The panel follows the run.** Every append sets `scrollTop = scrollHeight`, so
by step 14 the status bar (steps / active / context — the part that visibly
counts) has scrolled out of the viewport entirely. Correct behaviour, wrong for
a video; the harness pins `#messages` to the top before each capture, and lets
the approval and answer frames scroll to their card instead, because there the
content matters more than the chrome.

#### `opacity: 0` is not a bug a still-frame skim catches

`Shot` and `RunPanel` took their frame as an `at` prop. Every call site passed
the literal `0`, and `panelIn(0)` is `opacity: 0` — so the panel was invisible
for the entire cut while the callouts, which read `useCurrentFrame()`, drew
normally. The composition rendered "correctly": type in the left column, a box
around a card, and nothing in between. It read as bad staging rather than as a
missing image, and no single still shows that the difference between
"deliberately empty panel" and "panel at zero opacity" is invisible.

They call `useCurrentFrame()` themselves now. **A prop a caller has to remember
is a prop a caller gets wrong**, and the failure mode of getting this one wrong
is indistinguishable from a design choice.

#### A callout label is in the gutter, and the gutter is not where you put it

Three short cuts share `demo/src/stage.tsx`, so the staging is one module and one
2x pixel space rather than three copies of the constants. That is the fix for
most of it.

The one thing the shared layout still had to learn is that **the label does not
choose its own position — the anchor does.** `Callout` derives it from
`min(left - LEAD - 18, PANEL_X)`, and the clamp is load-bearing: DELETE ALL sits
at x≈700 of 840, so a right-aligned label in the 280px gutter starts at ≈1384,
which is *inside* the panel. The result was "DELETE EVERYTHING" drawn across the
history drawer's own title bar — text on top of the thing it names, in both the
first cut and the third.

The leader takes up the slack and runs the long way to the element, 690px across
the panel's header. That looks like a lot of rule, and it is still the cheap
option: a routed leader is a drawing, and a label that overlaps its own target is
a semantic error that a still-frame skim reads as a styling choice.
