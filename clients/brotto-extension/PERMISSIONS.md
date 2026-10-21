# Permission Justifications

Brotto's single purpose: **let you ask an AI to perform tasks in your own
logged-in browser.** Every permission below exists to serve that one purpose
and nothing else.

This document is written against `manifest.json` as shipped. If the two
disagree, the manifest is correct and this file is a bug.

## Permission overview

| Permission | Grants | Risk |
|---|---|---|
| `debugger` | Chrome DevTools Protocol on the one tab you picked | **High** |
| `<all_urls>` | Host access for that same tab | **High** |
| `scripting` | Read visible text from the tab you are looking at | Medium |
| `storage` | Your server URL and model choice, on this device | Low |
| `notifications` | A desktop alert when a run needs you | Low |
| `sidePanel` | The panel where you talk to it | Low |

---

## `debugger` — driving the tab you picked

### Why it is required

Brotto does not run its own browser. It drives *yours*, through the Chrome
DevTools Protocol, on the single tab you selected — which is what lets it act
inside a session you are already signed in to. `chrome.debugger` is the only
Chrome API that exposes CDP to an extension.

### How it is used

`debugger.attach` is called for one tab id, and only after you select it. The
complete set of CDP methods the extension issues:

| Domain | Method | Used for |
|---|---|---|
| Accessibility | `Accessibility.enable` / `disable` / `getFullAXTree` | Reading the page as a labelled tree of controls |
| Input | `Input.dispatchMouseEvent` | Click, move, scroll |
| Input | `Input.dispatchKeyEvent` | Typing, Enter, Control+A |
| Page | `Page.enable` / `Page.navigate` / `Page.getFrameTree` | Navigation, and enumerating frames |
| Page | `Page.captureScreenshot` | A JPEG of the tab you picked, for pages the accessibility tree is blind to — see below |
| DOM | `DOM.getDocument` / `getAttributes` / `resolveNode` | Resolving a tree ref to a node |
| DOM | `DOM.getBoxModel` / `getNodeForLocation` | Turning a node into clickable coordinates |
| Runtime | `Runtime.evaluate` | Reading page text and stability, and drawing the click marker — see below |

**`Page.captureScreenshot` — one place, and only on request.** The agent
perceives the page through the Accessibility tree first, and your server asks
for a picture only when nothing the harness can see is about the task it was
given — the accessibility tree and the visible page text. That includes a
`<canvas>` (Google Docs, Figma, a chart, a spreadsheet grid) with no
accessibility node and no readable text of its own, and it includes a canvas
app whose *toolbar* gives a rich tree while the content it is drawing is in
none of it. (Several of those apps name a screen-reader shortcut in their own
page text; pressing it puts the *selected cell* back in the tree, which checks
a keystroke without a picture. The picture is still requested on the same
conditions as before and the capture rules below are unchanged by it.) The
extension issues
this command from exactly one call site, in `background.ts`, in response to a
relay frame from your own server. It is not periodic and not automatic: with no
task running, nothing is captured.

**No new permission is involved.** `Page.captureScreenshot` is a CDP method on
the session the already-declared `debugger` permission opens, so it needs
nothing in `manifest.json` that was not already there and adds no entry to the
review queue. It is called out here because "reads the page as text" and
"photographs the page" are different powers, and a reviewer counting the
permissions would not otherwise see the second one.

**Your server decides, and it is off by default.** Whether this command is ever
issued is a setting on the Brotto server — not on the extension, and not in
this panel. Capture happens only when the operator has set
`BROTTO_VISION_CAPTURE` explicitly (`on`, `1`, `true` or `yes`); any other
value, including the variable being absent or misspelled, means no screenshot
is ever captured, on any step, for any page. Independently of the switch, a
page whose domain is on your own blocklist is refused before any capture is
attempted, so turning the switch on cannot turn into photographing a site you
told the agent never to touch. A `*.example.com` entry covers `example.com`
itself as well as its subdomains, and a page with no resolvable domain at all —
an IP address, or a single name like `localhost` — is refused too, because there
is nothing to check against the blocklist. The extension implements none of
these rules and does not need to: it captures when it is told to, and nowhere
else.

The image is JPEG at quality 60, clipped to the visible viewport — a smaller
image to send than PNG, and never a picture of the whole tab history or
another window. It is sent to the Brotto server you configured and handed
straight to the model for that step. It is **not written to disk**: not to the
audit trail, not to a log line, not to the side panel. What the model makes of
it may appear in its summary, exactly as page text already does.

**There is a second screenshot call, and this is where its data ends.** On
every step the extension takes its own capture to compare against the previous
step's — the "page delta" that tells Brotto whether the page changed and where,
on a spreadsheet whose accessibility tree never moves. It is a second, separate
call: it happens whether or not `BROTTO_VISION_CAPTURE` is set, and it is not
counted against the three-screenshot-per-task limit, because no model ever sees
it. Both captures are decoded in the extension, differenced, and dropped. **Not
one pixel of this second capture is sent to the server, written to disk, or put
in the audit trail** — what crosses the wire is about a hundred bytes of
integers: a yes/no and a handful of small rectangles. One frame is held per tab
to compare against, and it is discarded on navigation, on task start, when the
tab closes and when the extension is detached. A caret or selection you are
typing in is painted over before the comparison, so a blinking cursor does not
register as a change.

It is also the one channel that redaction cannot reach — redaction is pattern
matching over strings, and a JPEG is pixels — which is why it sits behind a
switch that stays off until somebody turns it on. See
[PRIVACY.md](https://github.com/suryanshgupta9933/brotto/blob/main/PRIVACY.md).

### `Runtime.evaluate` — seven places, and only one of them is the server's

This runs JavaScript in the page, so it is the one call here that can execute
code rather than read state. Every call site is listed.

**Composed by the server — one place.** A relay frame of type `evaluate`
carries an expression the server built; `background.ts` forwards it to CDP
unchanged. The only action that uses this is `read_page_text`, which composes a
bounded `innerText` read:

```js
(document.querySelector(<selector>) || document.body).innerText.substring(0, <max>)
```

Because that expression arrives from the server, the *mechanism* is not
restricted to that read — holding `AGENT_SECRET` is equivalent to holding your
browser session. See "Known limitations".

**Composed by the extension — six places, hardcoded in the bundle.** These
are not reachable by anything the server sends; they are fixed strings in the
shipped code, and they are the ones that run without the server asking:

| Site | What it evaluates | When |
|---|---|---|
| `observation/index.ts` | `{url, title, text: body.innerText}`, whitespace collapsed, capped at **20,000 characters** | every observation |
| `observation/stability.ts` | installs a `MutationObserver` and reports whether the page has gone still | every observation |
| `observation/supplement.ts` | a probe listing `aria-hidden` controls so they can be hit-tested | when the tree is supplemented |
| `observation/pointer.ts` | draws a `pointer-events: none` click marker and its label — the words set with `textContent` inside a **shadow root** on an `aria-hidden` host, never `innerHTML`, and capped at 80 characters because it is model-authored prose | around a click, before and after the mouse event pair |
| `observation/delta.ts` | one pass returning two things: the text caret — the selection rectangle of a focused `contentEditable` element, or the measured position of the cursor inside a focused `input`/`textarea` — and the rectangles of every visible `<canvas>`. Returns **rectangle geometry only**: `{caret: [{x, y, w, h}], canvases: [{x, y, w, h}], vw, vh}` | every observation; the caret half feeds the page-delta mask, the canvas half becomes the `canvasCovered` fraction on the wire |

The first three run on every observation; the pointer marker only runs around a
click, and **nothing removes it afterwards** — it is the user's only way to see
where the agent is clicking, and a `finally` that took it away made it
invisible in practice, because the mouse pair is dispatched with no delay and a
sub-200ms marker was never seen. The next click *moves* it, and only the page
going away takes it with it. The same `delta.ts` evaluate now also reports each `<canvas>` rectangle; those
are intersected with the viewport and reduced to one number, `canvasCovered`
(0.0–1.0), so the server can tell a canvas-rendered app from a DOM one without
a second round trip and without a pixel leaving the extension. It reads no text
and no image data. The caret half of that pass runs once per page-delta and
returns nothing at all on a page with nothing editable focused; it reads no
text, and unlike the pointer marker its coordinates are
never displayed — they are used only to paint over the caret before two frames
of the page are compared.

The supplement probe is a deliberate narrowing: locating those controls by
hit-test would need a broader privilege than one bounded `Runtime.evaluate`,
so the extension reads them in the page and hit-tests them over CDP instead.

**The per-step page-text read is 20,000 characters, not the 2,000 below.** That
2,000 belongs to the idle-suggestion read under `scripting`, which is a
different code path. What the agent actually sees is smaller again — the
observation is filtered down to an actionability-ranked budget before it
reaches the model. The 20,000 characters do transit your own server, which you
run; page text is not written to disk.

### Security controls

- Attaches to one tab, only the one you selected. There is no
  browser-wide attach and no tab enumeration.
- Detaches when the socket closes.
- The CDP command set is a fixed dispatch table in source, not a
  server-selected method name.

### What this does not give it

Browser settings, other extensions, saved passwords, cookies as a store, the
ability to install content, or any state outside the attached tab.

---

## `<all_urls>` — host access, for the same one tab

### Why it is required

There is no way to know in advance which sites you will want to automate. A
narrow host list would make the extension useless for the authenticated tools
it exists to drive.

### How it is used

Only to attach the debugger to the tab you selected. It is not used to fetch
anything in the background, and there is no content script that runs on every
page.

### Security controls

- No automatic access. You pick the tab; nothing is touched until you do.
- `checkTabSecurity` runs before attaching and warns when the URL matches a
  sensitive pattern — mail, bank, payment processors, coinbase, auth, login,
  signin, account — or when the page is plain HTTP.
- A run is one tab at a time. There is no background or scheduled attachment.

---

## `scripting` — reading the page you are looking at

### Why it is required

When the side panel is open and no task is running, Brotto can suggest tasks
based on the page in front of you. That needs the visible text of the current
page, obtained on demand.

### How it is used

`chrome.scripting.executeScript` reads `document.body.innerText`, capped at
2000 characters, from the active tab — the one whose URL is shown in the
panel. This is the **idle-suggestion** read and nothing else. The page-text
read during a task goes through `Runtime.evaluate` at a 20,000-character cap
instead; see `debugger` above. Nothing else is injected, and no script is ever
executed in the page by this path.

### Security controls

- Read-only, on the active tab, text only.
- Capped at 2000 characters.
- No background polling; it runs when the panel refreshes its idle state.

> **This reads your page with no task in flight.** It is disclosed in the
> [Privacy policy](https://github.com/suryanshgupta9933/brotto/blob/main/PRIVACY.md).
> It is **off by default** — a fresh install reads nothing — and turns on in
> Settings. While a read is in progress the panel shows a "Reading page" badge,
> and the suggestions it produced are labelled afterwards, because those lines
> outlive the badge.

---

## `storage` — remembering your settings

### Why it is required

So you type your server URL once. The panel also remembers your model choice.

### How it is used

- `chrome.storage.local` — server URL, model configuration, feature flags.
- `chrome.storage.session` — your model API key, which is **cleared when the
  browser quits** and never written to disk.

### Security controls

- `chrome.storage.local` only. Never `chrome.storage.sync`, so nothing is
  synced to a Google account.
- Two credentials are stored, and which is which matters. The **model API
  key** is session-only (`chrome.storage.session`, cleared on browser
  restart), so a stolen profile does not yield it. The **`AGENT_SECRET`** —
  the token that authenticates this extension to your Brotto server — *is*
  written to `local` under `settings`, because a self-hoster restarting
  their browser should not have to re-enter it. Holding it is close to
  holding the browser session itself; see the limitations below.
- No browsing history and no task transcripts in the extension. Transcripts
  live in the orchestrator's `logs/sessions/` on your own disk, not here.

---

## `sidePanel` — the UI you talk to it through

### Why it is required

The side panel is where the conversation, the approval prompts and the results
live. Without it you would have to watch a full browser tab.

### How it is used

`chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` at
startup, and `chrome.runtime.sendMessage` from the service worker to push
events to the panel.

### Security controls

The panel is loaded from the extension's own bundle. No remote code, no
third-party scripts, no web origin.

---

## `notifications` — telling you it needs you

### Why it is required

A run can sit waiting on an approval, a sign-in, or a clarification. If the
panel is closed you would not know.

### How it is used

`chrome.notifications.create` / `update` / `clear`. Both kinds are **on by
default** and switchable in settings. Blocking events (approval, sign-in,
clarification) notify whether or not the panel is open. Results notify only
when the panel is not focused — the whole point is that you can start a task
and come back.

### Security controls

The notification body is Brotto's own words about the event: the reason for an
approval, or the run's summary on completion or failure. It is not a copy of
page text, **but the model's summary can quote what was on the page**, so a
notification is page-derived and should be treated as one. Nothing identifying
is added — in particular the domain you were on is not in the notification.

Corrected 2026-10-09: this previously read *"Notification text is the domain and
event type. No page content is included."* The domain was never in there, and
the second half was wrong. It was also the only place in this file that
understated a primitive rather than overstating it, which is the specific
failure this document exists to prevent.

---

## Known limitations

Stated here rather than omitted, because a reviewer or a user should be able
to find them.

1. **The relay is authenticated, and `AGENT_SECRET` is the whole trust
   boundary.** `/ws/ext/{session_id}` requires the secret, and the handshake
   selects a fixed `brotto-v1` subprotocol back rather than echoing the
   credential. A wrong secret gets a close that does not confirm the route
   exists. Anyone who holds the secret can drive the agent against your
   logged-in browser *and*, through `Runtime.evaluate`, run JavaScript in it —
   the same reach your own account has, by design. `docker compose` refuses to
   start without the secret and binds the port to `127.0.0.1`. If you widen
   that bind, who knows the secret is yours to decide.
2. **An unset secret means an open server.** A developer on loopback has no
   secret and needs none, so refusing to start would break every local run. On
   loopback that is correct and nothing else needs it. Anywhere else it
   publishes your transcripts.
3. **Brotto is not a sandbox.** It runs with your permissions, in your
   session. Secure mode and the domain blocklist are the user's, and there is
   no server-side floor.
4. **Brotto is not protected against prompt injection** from page content.
   Treat a hostile page as able to mislead the model. Text and accessibility
   names are wrapped and labelled as untrusted, but that is a fence, not a
   guarantee. **One action is fenced harder than the rest: a page's text can
   direct the agent to press at most one chord, Option/Alt + Z with Command or
   Ctrl, which is inert in a browser.** A page naming ⌘Q, ⌘W, ⌘⇧Q, ⌘L or F4
   gets the key refused, because a chord named on a page is a fact about the
   page and never an order. Keys the model picks for its own navigation are
   its own.
   **A rendered image is the residual case.** If your server has
   screenshot capture enabled and the page draws with a `<canvas>`, the pixels
   carry no wrapper and cannot be fenced at all: instructions can be rendered
   as glyphs, so the agent is told in prose that the words drawn in the image
   are page content too — but the model is still reading a picture of the page
   and is not structurally prevented from obeying what is drawn in it. This is
   the honest statement of what the switch buys you: capture off means a
   canvas page is reported as unseen rather than described, which costs the run
   its eyes and is the safer of the two failure modes.

## Privacy

See [PRIVACY.md](https://github.com/suryanshgupta9933/brotto/blob/main/PRIVACY.md) for the full statement.

**Not accessed:** browsing history, bookmarks, saved passwords or cookies as a
credential store, other extensions' data, system files. No other window, tab
or screen is ever captured. No third-party analytics.

**Accessed, and why:** the accessible tree and visible text of the tab you
selected, while a task runs. Mouse and keyboard input on that tab, while a
task runs. A JPEG of that tab's visible viewport, while a task runs and only
when nothing the browser can read is about the task you gave —
**and only if screenshot capture is switched on on your server, which it is
not by default.** Your server URL and model choice, stored locally. The
visible text of the active page, when the panel is idle and suggesting.

Whether the agent *does* request a screenshot on a given step is a decision
your server makes, and a self-hosted server running this code decides it, not
the extension. Two things decide it in practice: the server-side
`BROTTO_VISION_CAPTURE` switch (`on`, `1`, `true` or `yes` — anything else,
including leaving it unset, means never), and your own domain blocklist, which
refuses a capture regardless of the switch. The extension captures on request
and nowhere else, and adds no setting of its own for it.

**Transmission:** to the Brotto server you configured, over the relay. No
third parties. The audit trail (`logs/sessions/`) stays on your own disk.

**Failure codes, on the hosted relay only.** When a task fails to start, or
starts and then fails, the extension sends one short code from a fixed list
(`offline`, `credential_rejected`, `cannot_complete`, …), the extension version,
and nothing else. No page text, URL, accessibility tree, task, typed input,
session id, or API key — the code that writes the record has no field for them.
The account is read from the sign-in token by the server, not sent by the
browser. Self-hosted installs send none: the relay reports its auth mode on
`/health` and anything but `auth_mode: "jwt"` never enables this path. It is
invisible, never blocks a task, rate limited, and can be switched off server-side
with `BROTTO_FAILURE_REPORTING=off`.

**Chrome Web Store Limited Use:** "The use of information received from Google
APIs will adhere to the Chrome Web Store User Data Policy, including the Limited
Use requirements." Nothing below is collected for any purpose other than the
task you asked for.

## User control

1. Chrome shows every permission at install time.
2. You pick the tab. Nothing attaches before that.
3. Sensitive-site and plain-HTTP warnings are shown before attaching.
4. Approval, clarification and sign-in prompts stop the run and wait for you.
5. A destructive action on an unseen domain is never pre-approved.
6. You can stop a run at any time from the panel. There is no popup and no
   browser-wide toggle — the panel is the whole control surface.
7. Your domain blocklist is yours alone; the server adds no floor.
