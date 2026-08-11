# Changelog

All notable changes to Brotto are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/) and the project
does not yet follow SemVer — the pre-1.0 numbering reflects "open-source
beta, expect breaking changes."

## [Unreleased]

## [0.2.0] - 2026-08-11

### Fixed
- SW termination between tasks (MV3 idle-kill). Added a long-lived
  `chrome.runtime.connect` port from the side panel with an
  `onConnect` listener in the SW. The previous code only used one-shot
  `chrome.runtime.sendMessage`, and the SW's heavy module imports +
  `controller.restore()` could take longer than the message callback
  fired, silently dropping the second task.
- Unchecked `runtime.lastError` warning in the extension console after
  a task ends. The login "Continue" button sent `local_login_complete`
  via `sendMessage` with no callback — switched to the callback form
  with an explicit `void chrome.runtime.lastError` read.
- Stale-action premature termination. Replaced the hard `STAGNATION`
  terminate with a memory-aware nudge. When the agent has facts in
  memory that look like an answer, the nudge tells it to call
  `terminate` NOW instead of clicking around looking for one more
  identifier. The only hard stop left is `MAX_STEPS = 50` plus a 4
  consecutive-nudge cap.
- False `GOAL MATCH` banner on the Gmail inbox. The banner used to fire
  on the inbox page just because an amazon sender was present;
  `hasStructuredFact` now requires a delivery-status keyword, tracking
  ID, or order ID pattern. Senders alone don't count.
- Payment vs delivery confusion in Gmail. Added an "EMAIL TYPE
  DISCRIMINATION" section to the planner system prompt that lists
  payment vs delivery subject keywords and teaches a better Gmail
  search (`from:amazon subject:(delivered OR shipped OR tracking)`).
- False-rejection of clicks inside the same element's bbox.
  `actionSignature` previously resolved click coordinates to a
  targetId, which collapsed distinct clicks on the same element into
  one "ALREADY attempted" signature. Now uses a 20px grid only.
- Auto-correct complexity. Removed the re-dispatch-at-nearest-interactive
  logic from the local driver — it was dead code (the click diagnostic
  was overriding it) and added complexity the user didn't want.
- Wasted first turn navigating from a blank tab. The new tab now
  opens directly at the goal site (gmail, github, amazon, …) based on
  a small keyword map in the local driver, saving one navigation turn.
- Click drift after window resize / zoom. `getBoundingClientRect()`
  captured bboxes are frozen at observation time; if the window
  resized between capture and dispatch, clicks landed wherever those
  coords happened to point after the resize. Added a viewport-stability
  guard at the top of `executeAction` that re-reads
  `window.innerWidth/Height/devicePixelRatio` via `Runtime.evaluate`
  before dispatching. On mismatch (≤4 px tolerance covers DPR
  rounding; 0.01 DPR fraction catches Chrome zoom steps), the click
  is skipped, the result lands in history as
  `viewport_changed (...)`, and the next iteration re-captures.

### Added
- `stable` branch — pins the verified-working extension + local-driver
  state. New development continues on `feature/v2-dom-workflow`.
- `inferStartingUrl(goal)` in the local driver — small keyword → URL
  map for common goal sites. Unknown goals still fall through to
  `about:blank` and the model navigates itself.
- True background mode. `chrome.tabs.captureVisibleTab` rejected when
  the agent tab wasn't the active one — meaning the harness yanked
  focus back to the agent tab every iteration. Added a
  `Page.captureScreenshot` fallback via `chrome.debugger` so the
  screenshot path keeps working when the user has switched tabs.
  Removed `activateAgentTab()` calls and the helper itself; CDP
  commands operate on the attached tab regardless of focus.
- Per-tab `AI` badge on the agent tab via `chrome.action.setBadgeText`.
  The user can see at a glance which tab is busy while the loop runs
  in the background, and the badge clears cleanly across all terminal
  paths (clean finish, threw, cancel, reset).

## [0.1.0] - 2026-08-08

Initial open-source beta. See README.md for the feature matrix.

[Unreleased]: https://github.com/suryanshgupta9933/brotto/compare/stable...HEAD
[0.2.0]: https://github.com/suryanshgupta9933/brotto/compare/v0.1.0...stable
