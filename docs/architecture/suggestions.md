# Idle-page suggestions

Read before touching `agent/suggest.py`, `POST /v1/suggestions`, or the idle
panel's suggestion box.

The three task suggestions on the idle panel are **written by the model**, not
by a table. `POST /v1/suggestions` → `agent/suggest.py` → a standalone
`Agent` with no `output_type`, given the page's URL, title, and **visible page
text**.

Three hand-written versions came and went first: a 17-hostname table, then a
bigger one (15 page classes × 6 lines, 20 object kinds × 2 lines, ~130 lines of
copy). Both were correct on the sites someone had thought of and generic
everywhere else — the same failure, twice, at two scales. **The moment you
want to improve these, fix the prompt. Adding a site table is the bug.**

A third version was model-written but still **URL and title only**, and that was
the same bug in different clothes. On a new tab and on `chrome://extensions`
the generator received a page *class* and nothing else, so it wrote each page's
own manual back as a task — "List every installed extension along with its
current enabled or disabled state" is `chrome://extensions` described to itself.
Absence of signal rendered as confident specificity.

Five things that are load-bearing:

- **HTTP, not the WebSocket.** The socket is created in `startRelay`
  (`background.ts:505`) and only exists while a task is in flight — which is
  exactly when the panel does *not* need suggestions. `/v1/policy_ack` set the
  precedent for idle-time actions.
- **Page text, read on demand.** `chrome.scripting.executeScript` from the
  panel, which needs the `scripting` permission. Not a permanent content script
  (`host_permissions` is `<all_urls>`, so that means Brotto inside every site
  the user visits) and **not the debugger** — that raises Chrome's "debugging
  this browser" banner, a heavy thing to show someone who opened a panel to
  read a list. `chrome://` pages refuse the script; that arrives as
  `context_used: false` and the prompt tells the model the text is
  unavailable, so it must not invent a subject to fill the slot.
- **A standalone Agent**, not the harness's. That one is bound to
  `AgentDecision` with a `SYSTEM_PROMPT` whose identity is "you are not a
  chatbot" — wrong for a suggestion writer, which is why `SUGGESTION_PROMPT` is
  a separate constant rather than a section of `SYSTEM_PROMPT`.
- **The fallback stays site-agnostic.** Three lines in `FALLBACK_SUGGESTIONS`.
  The good path is a cache hit most of the time, so if the fallback grew a site
  table the failure would be invisible — it would just look like a cache.
- **Two filters between the model and the button.** `_is_destructive` drops a
  line that opens by proposing a change — deleting, disabling, sending, paying
  — because a destructive task offered as a casual one-liner is how it happens
  by accident. `_is_declining` drops the model's refusal. Both anchor on the
  leading word, since a suggestion is an imperative and the first token is the
  verb; matching anywhere in the line would throw away "summarise the thread
  about deleting the old branch".

**Declining had to become a closed set, which took two attempts.** The prompt
allows fewer than three and none at all. Told it may return nothing, the model
returns *prose about declining* — truncated to the panel's width, "I can't
return anything for this page, it's the browser's own extensions settings…"
rendered as a clickable button. It came back in three different shapes across
three runs, so matching prose was a losing game. The prompt now asks for a
literal `NONE` (a closed set, one comparison) and the prose openers are kept
only as a named backstop for a model that ignores the sentinel. **An empty list
is a correct outcome**: the panel already treats it as "keep your own fallback".

Cache key is `host + pathShape + YYYY-MM-DD` in `chrome.storage.local`, with
numeric and UUID path segments collapsed to `:id`, capped at 40. Entries carry
a TTL, and **it is short when page text was used**: "three emails from your
manager" is page content, and a day-long entry is that content left on disk.
Ten minutes context-derived, a day for URL-and-title-only, chosen from the
server's `context_used` rather than guessed at from whether the read
succeeded. The panel paints the fallback first and swaps in the generated set
when it lands, so the box is never empty and never waits on a model call.

**This reads the user's page with no task in flight.** That is a real
escalation from "the user asked for something" to ambient, and it is the one
default here that was chosen rather than tested.

It is now **off by default**, and that default is enforced in one place:
`contextSuggestionsEnabled()` accepts only an explicit `true`. A fresh install
reads nothing at all. Turning it on is a disclosure problem, not a settings
problem, and it needs **two** disclosures because the two have different
lifetimes:

- **`contextBadge`**, for the duration of the read — the seconds the text is
  actually being fetched.
- **A caption under the buttons**, after the lines land — because the lines
  outlive the badge by minutes, and a badge alone leaves the most of the time
  the user is looking at the result undisclosed.

The caption's flag is the **server's** `context_used`, not the client's guess,
and it is carried through the cache as `hit.context`. That matters because the
common path is a cache replay: a line set that said "from this page" when it
was generated and says nothing when it is re-shown an hour later is a caption
that lies for most of what a user sees. Pinned by
`scripts/test-suggestion-source.test.js`, since a caption that only appears on
a fresh fetch is invisible in a diff and wrong for most of what a user sees.

The cache key is `host + pathShape + YYYY-MM-DD` in `chrome.storage.local`,
with numeric and UUID path segments collapsed to `:id`, capped at 40. Entries
carry a TTL, and **it is short when page text was used**: "three emails from
your manager" is page content, and a day-long entry is that content left on
disk. Ten minutes context-derived, a day for URL-and-title-only, chosen from
the server's `context_used` rather than guessed at from whether the read
succeeded. The panel paints the fallback first and swaps in the generated set
when it lands, so the box is never empty and never waits on a model call.

**Read the real output before believing a change here.** Diff inspection found
nothing wrong with either table version, and nothing wrong with the
URL-and-title version either. All three were only caught by running suggestions
against real page shapes and reading the sentences.
