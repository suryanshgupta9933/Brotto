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
| DOM | `DOM.getDocument` / `getAttributes` / `resolveNode` | Resolving a tree ref to a node |
| DOM | `DOM.getBoxModel` / `getNodeForLocation` | Turning a node into clickable coordinates |
| Runtime | `Runtime.evaluate` | Reading page text and stability — see below |

**There is no `Page.captureScreenshot` anywhere in this extension.** The agent
perceives the page through the Accessibility tree, not through images. It
never screenshots, so it never has access to a picture of your screen.

### `Runtime.evaluate` — four places, and only one of them is the server's

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

**Composed by the extension — three places, hardcoded in the bundle.** These
are not reachable by anything the server sends; they are fixed strings in the
shipped code, and they are the ones that run on every observation:

| Site | What it evaluates | When |
|---|---|---|
| `observation/index.ts` | `{url, title, text: body.innerText}`, whitespace collapsed, capped at **20,000 characters** | every observation |
| `observation/stability.ts` | installs a `MutationObserver` and reports whether the page has gone still | every observation |
| `observation/supplement.ts` | a probe listing `aria-hidden` controls so they can be hit-tested | when the tree is supplemented |

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

`chrome.notifications.create` / `update` / `clear`. Blocking events always
notify. Results notify only when the panel is not focused — the whole point is
that you can start a task and come back.

### Security controls

Notification text is the domain and event type. No page content is included.

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
   Treat a hostile page as able to mislead the model.

## Privacy

See [PRIVACY.md](https://github.com/suryanshgupta9933/brotto/blob/main/PRIVACY.md) for the full statement.

**Not accessed:** browsing history, bookmarks, saved passwords or cookies as a
credential store, other extensions' data, system files. No screenshots are
taken at any point. No third-party analytics.

**Accessed, and why:** the accessible tree and visible text of the tab you
selected, while a task runs. Mouse and keyboard input on that tab, while a
task runs. Your server URL and model choice, stored locally. The visible text
of the active page, when the panel is idle and suggesting.

**Transmission:** to the Brotto server you configured, over the relay. No
third parties. The audit trail (`logs/sessions/`) stays on your own disk.

## User control

1. Chrome shows every permission at install time.
2. You pick the tab. Nothing attaches before that.
3. Sensitive-site and plain-HTTP warnings are shown before attaching.
4. Approval, clarification and sign-in prompts stop the run and wait for you.
5. A destructive action on an unseen domain is never pre-approved.
6. You can stop a run at any time from the panel. There is no popup and no
   browser-wide toggle — the panel is the whole control surface.
7. Your domain blocklist is yours alone; the server adds no floor.
