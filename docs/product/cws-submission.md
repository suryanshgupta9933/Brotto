# Chrome Web Store — submission material

Everything the store dashboard asks for, written out. The dashboard's field limits are noted per item.
Source: [CWS Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies).

**Status: not submitted.** Two things below are still placeholders — the privacy-policy URL and the
store screenshots. Both are launch blockers.

## The single purpose statement

> **Let you ask an AI to perform tasks in your own logged-in browser.**

This exact sentence must appear in three places, because the policies allow broad access only where it
is "required for a user-facing feature described prominently in the Product's Chrome Web Store page and
in the Product's user interface":

1. the store listing (below),
2. the extension's first-run screen (`clients/brotto-extension/src/welcome.html`),
3. the privacy policy ([PRIVACY.md](../../PRIVACY.md)).

One purpose, three surfaces. If they disagree, that is the rejection.

## Listing fields

**Name** (≤45 chars)

```
Brotto — AI agent in your own browser
```

**Short description** (≤132 chars)

```
Run an AI agent in the Chrome you are already logged into. Reads the accessibility tree, not screenshots. Your own API key.
```
*(117 characters)*

**Category:** Productivity

**Language:** English

**Detailed description** (≤16,000 chars)

```
Brotto runs an AI agent inside the tab you are already signed in to.

Most browser agents run in a cloud browser you have never logged into. They re-authenticate, get
flagged by bot detection, and read pages as screenshots. Brotto works in your own Chrome session, so
it uses your existing login, and it reads the accessibility tree instead of an image — cheaper, faster,
and it understands the same structure a screen reader does.

What it is good at
- Repetitive chores on sites behind a login: an inbox, a booking flow, an internal admin console
- Anything where a screenshot-based agent breaks three steps in
- Bringing your own model: Claude, OpenAI or MiniMax, swappable per task

What it does not do
- Take screenshots of your pages
- Send or run any code downloaded from a server
- Work in a cloud browser or a headless profile
- Store your model API key to disk

You stay in control
- Secure mode asks for approval before sensitive actions: sending email, payments, deletes,
  publishing, changing a password, and similar
- Optional first-time prompt before acting on a site
- A domain blocklist that is entirely yours, with no server-side floor
- Every run writes a per-session record of what it observed and did, which you can open and read

Bring your own key
Your model API key is held in memory by the extension and is never written to disk by Brotto. It is
sent to the Brotto orchestrator you are connected to, because the orchestrator is what calls your
model provider on your behalf. Self-host the orchestrator and it never leaves your machine. See the
privacy policy for exactly what goes where.

Requirements
- Chrome or Edge 88+
- A Brotto orchestrator, self-hosted or hosted
- Your own model provider API key

Not supported: Firefox. chrome.debugger has no equivalent there.
```

## Permission justifications

The dashboard asks for a justification per permission. Write them in terms of **the user-facing
feature**, not the API. The full table, which this document shares with the extension README, is in
[`clients/brotto-extension/README.md`](../../clients/brotto-extension/README.md#permissions-and-why-each-is-needed).

| Permission | Justification to paste |
|---|---|
| `debugger` | Reads the accessibility tree of a tab the user has chosen for a task, and dispatches clicks, typing, key presses and scrolling into it. This is the feature: performing the task in the user's own session. The extension attaches only to a tab the user names, only while a task is running, and detaches when it ends. |
| `<all_urls>` | The user chooses which site the task is for, and that site is arbitrary — an inbox, a portal, a booking flow. Access is not ambient or silent: nothing is read until the user starts a task on a tab they selected. |
| `scripting` | Reads the visible text of the page the task is on, so the model has the page's words and not only its control structure. Used for task context and, if the user enables it, for suggestions on an idle page. |
| `sidePanel` | The task interface, live step view, and approval prompts. |
| `storage` | Remembers your model configuration and your secure-mode policy between sessions. The API key uses `chrome.storage.session`, which is memory-only and is not written to disk. |
| `notifications` | Tells the user when a task needs an approval, needs them to log in, or has finished. Without it the user has no way to know an agent is waiting on them. |

Deliberately **not** requested: `cookies`, `history`, `webRequest`, `bookmarks`, `clipboardRead`,
`desktopCapture`, `tabGroups`, `activeTab`. None are needed, and requesting them would be a finding.

## Review notes

Paste this into the "notes for the reviewer" field. The three known rejection risks are
`chrome.debugger` + broad hosts, remote-code policy, and the wrapper-appearance rule.

```
Brotto is a local AI browser agent, not a website viewer. It performs actions on third-party sites
(Gmail, booking flows, internal consoles) on the user's instruction. It does not render any page
owned by us, and our own UI appears only in the side panel.

1. WHY chrome.debugger AND <all_urls> ARE NECESSARY
The product is specifically "an agent that works in the user's already-authenticated browser". That is
the entire differentiator: a cloud browser cannot reuse the user's existing login, and screenshot-based
agents break on long flows. The only way to read a real tab's accessibility tree and dispatch synthetic
input into it is chrome.debugger.
Access is user-initiated and bounded:
  - The extension attaches to a tab ONLY after the user selects it and starts a task.
  - It detaches when the task ends, the user cancels, or the tab closes.
  - Nothing is read at rest, at startup, or in the background.
  - There is no browser-wide or silent attachment, and no list of pre-attached sites.

2. THIS IS NOT A REMOTE-CODE INTERPRETER
The extension contains no eval(), no new Function(), and never loads a script from a remote origin.
All network calls are fetch() to the orchestrator's own JSON API (/health, /context, /v1/...).
The server sends exactly five action types, each with typed arguments:
    navigate | click | type | scroll | key
Model output is parsed into that closed enum and validated inside the extension before anything is
dispatched. There is no code path by which model or server text becomes executed code. The only
JavaScript the extension evaluates is fixed, locally-defined source in this repository, used to read
DOM attributes and focused-element state.

3. NOT A WRAPPER
Screenshots in this listing show the agent driving a third-party site. Brotto's own UI is the side
panel, and it is not a WebView of any site we control.

4. SUGGESTIONS ON AN IDLE PAGE
The extension can optionally read the visible text of the current page when no task is running, to
suggest something the user might want to do. This is off unless the user enables it, takes no action,
and is declared in the privacy policy and in the extension's first-run screen. It can be turned off
permanently in settings.

5. HOW TO TEST
A working orchestrator and credentials will be provided on request. The reviewer needs to:
  - install the extension, open the side panel, set the server URL
  - choose a provider and paste a key
  - start a task on any page
  - observe: a live step list, an approval card on a sensitive action, and a completed result
A sample task is pre-loaded in the first-run screen.
```

## Data-use declarations

Be exact. Over-claiming and under-claiming are both findings.

| Declaration | Answer | Note |
|---|---|---|
| Does the extension collect or use user data? | **Yes** | See below. |
| Browsing activity (page URL, title, DOM/AX content) | **Collected** | Required for the single declared purpose. Sent to the user's chosen model provider. |
| Authentication information | **Collected** | The user's own model-provider API key, transmitted to the orchestrator it is connected to. Never written to disk by Brotto. |
| User activity / website content while idle | **Collected, optionally** | The suggestions feature. Off by default, declared, disablable. |
| Purpose | **App functionality** | Only. |
| Sold, shared for ads, or used for creditworthiness / lending | **No** | No third party receives page data except the model provider the user selects. |
| Collected when the user is *not* using the agent | **Yes, optionally** — suggestions | Must be declared or the feature gated behind a visible opt-in. |
| Remote code | **None** | No `eval`, no `new Function`, no remote script, no WASM. |
| Human review of data | **No** | No staff access to user data. |

## Still missing before submitting

- [ ] Privacy policy at a **live public URL**. GitHub renders `PRIVACY.md` once the repo is public, so
      this is unblocked by making the repo public. Do not link it from the listing *description* — a
      privacy-policy link in the description is itself a documented rejection. Put the URL in the
      dashboard's privacy-policy field.
- [ ] Store screenshots, 1280×800 or 640×400, showing a real run on a third-party site.
- [ ] A 30-second promo video. Optional, and it is the single best-converting listing asset.
- [ ] The single purpose sentence added to `welcome.html` and to `PRIVACY.md`.
- [ ] Reviewer test instructions with a live server URL and credentials.
- [ ] **Decide the suggestions question.** Either declare it as above, or ship it off by default with a
      visible in-panel indicator. Ambient page reads are the one genuinely disclosable behaviour in the
      product, and it is easier to ship it off than to defend it.

## Sequencing

Submit **unlisted**. It costs one review, installs and auto-updates from a URL, and has no public
listing page to get wrong. The public listing is a later edit — and listing copy can be changed
afterwards without triggering re-review, since only code, manifest and packaged resources do. So do
not over-polish the copy before submitting; iterate it after approval.
