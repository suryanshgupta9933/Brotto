# Extension runtime: storage, policy, notifications, debugger

Read before touching `clients/brotto-extension/src/{background,debugger}.ts`,
`policy/`, or notification behaviour.

## Extension storage

- `model_config` (provider, model, context_window) → `chrome.storage.local` — persists across browser restarts (not sensitive)
- `api_key` → `chrome.storage.session` — in-memory only, cleared on browser restart; mirrors the existing pause-state pattern
- The first read after an extension update runs a one-shot migration that re-saves any legacy `{modelConfig: {model_config, api_key}}` shape into the new layout

## Domain blocking — one list, the user's

The blacklist is whatever the user typed in the panel, whole. There is no
server-side floor, no `policy.json`, no `merge()`.

There was a whole second code path for it and **it rendered nothing**: a
self-hosted install never shipped a `policy.json` for `load_policy()` to find,
so `FLOOR_POLICY` was always an empty `Policy`, and the panel's "Brotto refuses
these too" list always came back empty. Every three-way union
(`floor ∪ user ∪ ?`) and every "source: floor / server / user" label existed to
describe a distinction that never occurred. Deleted: `policy/config.py`,
`merge()`, `FLOOR_POLICY`, the `/health` `policy` key, the `source` block on
`/v1/policy`, and the panel's floor section.

`Policy` / `UserPolicy` stay, and `UserPolicy` is still a `Policy` subclass, so
an old policy file on disk with the removed `whitelist` / `block_blacklisted`
fields still parses — pydantic 2 drops unknown fields rather than rejecting them.
That is pinned by `tests/test_policy_schema.py`.

## Notifications

Two classes, and they gate on **different** things, which is the whole point:

- **Blocking** (`approval_request`, `login_required`, `clarify_request`) —
  always speaks up, panel open or not. The user has usually wandered off
  precisely because the panel looks idle. `notifyBlocking` gates it.
- **Results** (`task_completed`, `task_failed`) — only when nobody is
  watching. `notifyResults` gates it. Default **on**, and this is a product
  judgement worth knowing about: Brotto's premise is that you leave it running
  and come back later, so "the task ended" is the event the whole thing exists
  to deliver. Flip it if that reads as too loud.

"Watching" is a **boolean on the keep-alive port**, not port liveness. A bare
`chrome.runtime.connect` cannot tell an open-and-watched panel from an
open-and-forgotten one, and the second is the normal state for a ten-minute
task. `sidepanel.js` drives it from `focus`/`blur` events — not by polling
`hasFocus()`, which **is forced `true` under CDP focus emulation** and so cannot
be tested in the browser harness at all. Those listeners are registered at
module scope, not inside `connectSwKeepAlive`, which re-runs on every service
worker restart and would accumulate a pair of listeners per reconnect. The
background defaults `panelWatching` to `true`, so a cold service worker reads
"connected" as "watched" and stays quiet rather than guessing.

A notification click focuses `activeWindowId` and clears. It deliberately does
**not** call `chrome.sidePanel.open()` — that needs a user gesture a
notification click does not provide (chromium bug 40929586, still open), and a
click that clears the notification and leaves you where you were is a dead
end. `chrome.windows.update(id, {focused: true})` has no such restriction.

**A setting that is written and read nowhere is worse than no setting.**
`notifyBlocking` was persisted in three places and consulted in zero, so
unchecking it changed nothing at all. Both toggles are now read in
`maybeNotify`.

Not built, and cheap if wanted: a "waiting on you" badge on the panel icon.
`currentPrompt` is already tracked in the background.

## The debugger can vanish mid-run

`chrome.debugger` attachments end on their own and **nothing is raised on the
sending side** — the next `sendCommand` is where it surfaces, as `Debugger is
not attached to the tab with id: N`. Chrome's `onDetach` documents exactly two
reasons, and there are only two: `target_closed` and `canceled_by_user`, the
latter being *"Chrome DevTools is being invoked for the attached tab."* So the
cause of a mid-run drop is DevTools being opened on the driven tab, or the tab
being closed. **Switching to another tab in the same window does not drop
it** — there is no focus-related detach reason, `activeTabId` is pinned for the
run, and there is no `chrome.tabs.onActivated` listener.

The failure looked like a model fault, and the cascade is the reason that
matters:

- Post-action observations are driven by `chrome.webNavigation.onCommitted`,
  not by `Page.enable`. A dead debugger produces no CDP events, so no
  navigation event, so the server's post-action wait ran to its 30s timeout.
- It then handed the model an **empty observation** — `url=""`, 0 targets —
  as if it were a page. MiniMax-M3 failed to produce a valid action from it
  three times, and the document recorded `invalid_decision`.

Two halves, in `debugger.ts` and `background.ts`:

- `sendCommand` catches `/not attached/i`, re-attaches once, re-sends
  `Page.enable`, and retries. A second failure is real and propagates.
- `background.ts` reports a `canceled_by_user` detach during a task with a
  blocking notification, because the re-attach above takes the tab back from
  DevTools and the user deserves to know that's what happened.

**Not fixed, deliberately:** the empty observation is still handed to the
model as a page. The re-attach stops the cascade at its source; teaching the
harness to treat `ax_elements == 0` as a perception failure is a separate
judgment call. Also uncharged: a failed step's `model_plan` seconds and tokens
never reach `timings` or `result.usage`, because both are recorded only when
`planned is not None` — so a 3-attempt failure's ~19s is charged to nothing.

**Not verified in a browser.** Both halves are read-and-reasoned, not run.

## The observation gate waits for quiet, not for the load event

`captureObservation` used to poll `document.readyState` until `"complete"` and
then sleep 400ms. **`readyState` reaches `complete` with the load event, which
on a SPA is *before* the app has rendered anything.** The `auth-slowjs` fixture
`setTimeout(…, 5000)`s its control into existence and measured a
`PERCEPTION_FAILURE`: the page was captured at ~400ms with the control absent
from the tree, and the model was shown a login form with nothing to do.

`observation/stability.ts` replaces it with a mutation-quiet window — one
`Runtime.evaluate` with `awaitPromise: true` that installs a
`MutationObserver` on `document` and resolves once the page has been still for
3s, with a 10s hard deadline.

- **The deadline is the contract, not a fallback.** A live dashboard never
  mutates out. A gate that waits for quiet is a *barrier*; a gate that waits
  for quiet *up to a deadline* is a wait. A hung step costs 30s of orchestrator
  timeout and then an empty page, which is indistinguishable from a perception
  failure in the audit.
- **A rejected evaluate (tab mid-navigation) returns immediately** with
  `waited: false`. Same reasoning: capture whatever is there.
- **3s is paid on every step**, including a static page — the window is
  silence, and a page that loaded a moment ago is silent from `t0`. That is
  the price of not handing the model a half-rendered page. Revisit the number
  if step latency, not correctness, becomes the complaint.
- `scripts/test-observation-stability.test.js` runs the real page-side
  expression against a fake DOM, so "the gate never fires" and "the observer
  leaks" are both caught. Both are absences and read clean in a diff.

The SPA retry underneath it changed condition at the same time. It retried
while `axTargets.length < 3`, which is wrong in both directions: a page that
rendered three useless targets stops retrying, and a merely-dense page burns
all four retries on itself. It now re-reads **twice at most**, stopping at the
first read whose `role|name|value` fingerprint is unchanged.

**The `/run` benchmark path does not use this code.** `run_benchmark.py` POSTs
to `/run`, which drives `dev/playwright_browser.py` — a separate observation
implementation whose `goto` waits on `domcontentloaded` and whose `observe`
takes no stability wait at all. `auth-slowjs` still records
`PERCEPTION_FAILURE` there after this change. A matching gate belongs in
`playwright_browser.py` before the baseline is re-recorded.
