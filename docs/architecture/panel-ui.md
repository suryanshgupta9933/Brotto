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
  stack. `appendClarifyCard` removes the prior `.clarify-card.blocking` — only
  the pending one — and a resolved one stays as history.
- The approval card's "Action approved." floating bubble is gone; the decision
  is the card's last line. That also means `approval_resolved` can no longer
  silently do nothing when the card is missing.
- The login bubble still fades on the next step, because there is no orphaned
  reply to strand it and the fade avoids a layout jump. Replayed ones are
  marked `.resolved` so they survive.

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
