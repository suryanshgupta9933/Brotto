# Brotto Chrome extension

The browser half of Brotto. It attaches to **a tab you choose**, reads that tab's accessibility tree,
and dispatches clicks, typing, keys and scrolling into it on behalf of the orchestrator's agent loop.

It is a side-panel app, not a popup, and it has no accounts, no pairing, and no telemetry. See the
[repository README](../../README.md) for the product and the orchestrator, and
[Privacy policy](https://github.com/suryanshgupta9933/brotto/blob/main/PRIVACY.md) for what leaves your machine.

## Build

```bash
npm ci
npm run build          # esbuild bundle into dist/
npx tsc --noEmit       # type check
```

Then load `dist/` via `chrome://extensions` → Developer mode → **Load unpacked**. The build rasterises
`src/assets/logo.svg` to the 16/32/48/128 icons, so it needs `rsvg-convert` (`librsvg2-bin` on Debian
and Ubuntu — CI installs it).

## What is in `src/`

| File | Role |
|---|---|
| `background.ts` | Service worker. Owns tab lifecycle, debugger attach/detach, the outbound WebSocket relay, the heartbeat, and action dispatch. |
| `debugger.ts` | Thin `chrome.debugger` wrapper. |
| `sidepanel.html` / `sidepanel.js` | The whole UI: task input, step cards, approval and login prompts, settings, cost breakdown, history and replay. |
| `welcome.html` / `welcome.js` | First-run screen. |
| `content.js` | Minimal content script. |
| `model_config.ts` | Provider/model/key storage split — config to `local`, key to `session`. |
| `observation/` | Page observation and stability logic. |

## Permissions, and why each is needed

This is the same table the Chrome Web Store submission uses.

| Permission | Why |
|---|---|
| `debugger` | The only way to read the accessibility tree of a real tab and dispatch synthetic input. Brotto's entire premise is operating *your* logged-in browser, which a `chrome.scripting` injection cannot do. |
| `<all_urls>` (host) | A chore site can be any site. Access is not ambient: the debugger attaches only to a tab you name, only while a task is running, and detaches when it ends. |
| `scripting` | Reads visible page text for the model's context and for the optional idle-page suggestions. |
| `sidePanel` | The chat and step UI lives in the side panel. |
| `storage` | Model configuration, policy, session ID. The API key uses `storage.session` so it is memory-only. |
| `notifications` | Tells you a task needs an approval, needs you to log in, or finished — otherwise you find out by coming back later. |
| `tabs` | Resolving which tab a task is attached to. **Scheduled for removal** — broad host access already implies it, and requesting an unused permission is itself a review finding. |

Not requested, deliberately: `activeTab` and `tabGroups` (neither is used), and `webRequest` / cookies /
history (the agent does not need them).

## What this extension does not do

This is the security argument, and it is structural rather than a promise:

- **It never downloads or evaluates code from the server.** There is no `eval`, no `new Function`, and
  no script tag. Every network call is `fetch` to the orchestrator's own JSON API
  (`/health`, `/context`, `/v1/...`).
- **It executes a fixed set of actions.** The server sends one of exactly five action types —
  `navigate`, `click`, `type`, `scroll`, `key` — each with typed arguments. Model output is parsed into
  that enum and validated in the extension before anything is dispatched. There is no path by which
  model text becomes executed code.
- **`Runtime.evaluate` runs only fixed, locally-defined snippets** written in this repository, to read
  DOM attributes and focused-element state. It never evaluates a string that arrived over the wire.
- **It screenshots the attached tab only when your server asks for one.** There is exactly one
  `Page.captureScreenshot` call site, in `background.ts`, answering a relay frame. The agent asks for a
  picture only when the page's accessibility tree *and* its visible text are both empty — a
  `<canvas>`, which has neither. **Capture is off by default on the server** and is not turned on by
  this extension: without `BROTTO_VISION_CAPTURE=on` in the orchestrator's environment, no frame is ever
  issued, whatever the model asks for. A domain on your own blocklist is never photographed, whatever
  the switch says. The image is JPEG, clipped to the visible viewport, sent to the server you
  configured and handed to the model for that step; it is **never written to disk** — not to the audit
  trail, not to a log line, not to the side panel. And it is the one channel the redaction described in
  the [Privacy policy](../../PRIVACY.md) cannot reach, which is exactly why it is off by default.

## CDP commands used

`Accessibility.enable` / `Accessibility.disable` / `Accessibility.getFullAXTree` · `DOM.getDocument` /
`getBoxModel` / `getAttributes` / `getNodeForLocation` / `resolveNode` · `Input.dispatchMouseEvent` /
`Input.dispatchKeyEvent` · `Page.enable` / `Page.navigate` / `Page.getFrameTree` / `Page.captureScreenshot` · `Runtime.evaluate` /
`Runtime.callFunctionOn`

## Browser support

Chromium 88+. Chrome and Edge are supported. **Firefox is not** — `chrome.debugger` has no Firefox
equivalent, so the product does not function there.

## Troubleshooting

**Nothing happens when I start a task.** Open DevTools on the *Brotto side panel* (right-click →
Inspect) and look for relay errors. The most common cause is a server URL that points at `localhost`
while the orchestrator is on another machine.

**"The debugger can vanish mid-run".** Attaching the Chrome DevTools to a tab Brotto is driving takes
the debugger away; so does closing the tab. Both detach cleanly, and Brotto re-attaches on the next
action.

**The panel says "Reconnecting, attempt N".** The WebSocket dropped. It retries with full jitter from
1s to 30s, six times, reusing the same session, so a task resumes where it stopped.
