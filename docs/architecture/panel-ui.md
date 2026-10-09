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
"your conversations are gone".

Two consequences worth naming:

- **A row is matched by `session_id`, never by object identity.** A server row
  is rebuilt from the index on every open, so `filter(s => s !== row)` keeps
  every local row including the one being deleted. `deleteSession` is the only
  caller that learned this.
- **The index has no elapsed time** — only the loop reported that — so a
  server-supplied row shows `—` where a local one shows `2m 10s`.

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

### Header text has a width budget

`SERVER UNREACHABLE… (RETRY 1 OF 6)` in the status pill truncated mid-word and
pushed the rest of the header off screen. The pill carries one word —
`Connected` / `Connecting…` / `Reconnecting` / `Disconnected` / `Idle` — and
anything longer goes in the toast, which is full-width above the composer and is
the same treatment as "Address copied". `toast()` replaces rather than stacks,
which is right for a retry counter: the number updating in place is the
information, and six stacked copies of the same line are just a slower sentence.

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
