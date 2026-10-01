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
is on the page it is reading, so `appendPlanCard` builds the badge, the sites
line and the step numbers with `textContent` and a `createTextNode`, and only
the step body goes through `renderMarkdown`.

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

**The plan card is dead in both paths.** Nothing emits a `plan` event, so
`appendPlanCard` never runs live and has no audit record to replay from. It is
untouched rather than resurrected — reviving it is a feature, not a fix.

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
the bubble still shows something.

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

**Not verified in a browser.** `▛▜▙▟` and `▖▘▝▗` at 11px in Geist Mono are the
two most likely to render as tofu boxes rather than read as motion.
