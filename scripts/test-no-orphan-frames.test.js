// A server frame the panel has no `case` for is a run that never ends.
//
// The bug this pins: when the harness raised anything the orchestrator hadn't
// handled, main.py sent `{"type": "task_error", "error": …}` from its `finally`.
// sidepanel.js's message switch had no case for it, so the frame was dropped on
// the floor — no stopTimer, no setOutcome, no card cleanup. The ACTIVE clock
// ran forever, OUTCOME sat on WORKING, and the socket close on top of it
// started a reconnect that could never succeed because the server had already
// crashed. Nothing on screen distinguished that from a slow step.
//
// That is an *absence*, which is why it survived review and why it needs a
// test: a missing `case` leaves a diff that reads clean. This one enumerates
// the frames crossing the service-worker → panel boundary and fails if any of
// them is unhandled.
//
//   node scripts/test-no-orphan-frames.test.js

"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src");
const PY = path.join(__dirname, "..", "services", "brotto-orchestrator", "src", "brotto_orchestrator");
const panel = fs.readFileSync(path.join(SRC, "sidepanel.js"), "utf8");
const worker = fs.readFileSync(path.join(SRC, "background.ts"), "utf8");

/** The two server files that emit WS frames. */
const serverSrc = ["main.py", path.join("agent", "harness.py")]
  .map((f) => fs.readFileSync(path.join(PY, f), "utf8"))
  .join("\n");

/** Every `case '<frame>':` label in the panel. */
function panelCases() {
  const out = new Set();
  for (const m of panel.matchAll(/case '([a-z_]+)':/g)) out.add(m[1]);
  return out;
}

/**
 * Every frame the service worker forwards to the panel, found by brace
 * matching each `notifyUi({ … })` call and pulling `type:` out of it. Reading
 * the call site rather than a hand-kept list is the point — a new frame added
 * to background.ts shows up here without anyone updating a test.
 */
function forwardedFrames() {
  const out = new Set();
  for (const m of worker.matchAll(/notifyUi\(\{/g)) {
    let depth = 1;
    for (let i = m.index + m[0].length; i < worker.length && depth; i++) {
      if (worker[i] === "{") depth++;
      else if (worker[i] === "}") depth--;
      if (depth !== 1) continue;
      const t = /^[\s,]*type:\s*["']([a-z_]+)["']/.exec(worker.slice(i));
      if (t) out.add(t[1]);
    }
  }
  return out;
}

// Frames the panel is allowed to drop. Each needs a reason, because "we just
// don't handle that" is the failure this file exists to prevent.
const IGNORED = {
  // Transport-level, never reaches the user. A dropped pong is a dropped ack.
  pong: "keep-alive reply, nothing to render",
};

const cases = panelCases();
const forwarded = forwardedFrames();

let failed = 0;
function check(ok, label, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  failed++;
  console.log(`FAIL  ${label}`);
  if (detail) console.log(`      ${detail}`);
}

console.log(`forwarded frames found: ${[...forwarded].sort().join(", ")}`);
console.log(`panel cases found:     ${[...cases].sort().join(", ")}\n`);

console.log("every frame crossing into the panel is handled");
for (const frame of [...forwarded].sort()) {
  if (IGNORED[frame]) continue;
  check(
    cases.has(frame),
    `${frame} has a case in sidepanel.js`,
    `the panel has no \`case '${frame}':\` — the frame is dropped silently`,
  );
}

console.log("\nthe regression itself");
check(
  cases.has("task_error"),
  "task_error is handled",
  "main.py sends this from its `finally`; without a case the run never ends",
);
check(
  /case 'task_error':[\s\S]*?stopTimer\(\)/.test(panel),
  "the task_error case stops the clock",
  "without stopTimer the ACTIVE time keeps counting after the run is over",
);
check(
  /case 'task_error':[\s\S]*?setOutcome\(/.test(panel),
  "the task_error case sets an outcome",
  "without it OUTCOME stays on WORKING forever",
);
check(
  /case 'task_error':[\s\S]*?settleBlockingCards\(/.test(panel),
  "the task_error case settles blocking cards",
  "an unanswered approval/login card would outlive the run",
);

// This check used to grep for a literal name, which is the whole bug it was
// written to prevent: the call site said `clearBlockingCards` after the
// function was renamed to `settleBlockingCards`, so the handler threw a
// ReferenceError on its first line — no stopTimer, no outcome, no bubble, the
// exact failure above — and this assertion passed on the broken name. A
// textual check cannot see that a name resolves, so assert that it does.
check(
  /function settleBlockingCards\(/.test(panel),
  "the blocking-card helper the cases call is actually defined",
  "every other call site uses it too, so a rename here orphans them all",
);
check(
  !/clearBlockingCards/.test(panel),
  "no call site still uses the old name",
  "an undefined call throws before the rest of the handler runs",
);

console.log("\nserver_unreachable renders in the toast, not the header pill");
const unreachableCase = /case 'server_unreachable':([\s\S]*?)\n\s*break;/.exec(panel);
check(!!unreachableCase, "the server_unreachable case is findable");
if (unreachableCase) {
  const body = unreachableCase[1];
  check(
    /toast\(/.test(body),
    "server_unreachable calls toast()",
    "the retry sentence has to go somewhere the header has room for",
  );
  check(
    !/setConnPill\([^)]*unreachable/i.test(body),
    "server_unreachable does not put the sentence in the pill",
    '"Server unreachable… (retry 1 of 6)" truncated mid-word in the header',
  );
}

// ── The other direction: server → worker ───────────────────────────────────
//
// The same absence, one layer in, and it cost a real debugging session. The
// server refuses a task_start with an unknown provider and sends
// `{"type": "task_failed"}` *directly* — no result to wrap. background.ts had
// no case for it, so the frame was dropped, `taskTerminalEmitted` stayed
// false, and the close that followed read as a lost socket. The panel showed
// "Server unreachable, retrying 1 of 6" against a server that was alive and
// had already said no.
//
// Scoped to TERMINAL frames on purpose. A dropped terminal frame leaves a run
// with a live clock and a reconnect that can never succeed; a dropped
// non-terminal frame loses an update. The first is the one that looks like a
// hang, so it is the one this file holds shut.
const TERMINAL = ["task_result", "task_error", "task_failed", "task_cancelled"];

console.log("\nevery terminal frame the server sends is handled by the worker");
for (const frame of TERMINAL) {
  const emitted = new RegExp(`"type":\\s*"${frame}"`).test(serverSrc);
  check(
    emitted && new RegExp(`case "${frame}":`).test(worker),
    `${frame} has a case in background.ts`,
    emitted
      ? "the server sends it directly; without a case the run never ends"
      : `the server does not emit ${frame} — the list needs updating`,
  );
}

console.log("\na refused task does not become a reconnect loop");
check(
  /if provider_name and provider_name not in PROVIDER_REGISTRY:/.test(
    fs.readFileSync(path.join(PY, "main.py"), "utf8"),
  ),
  "an empty provider is not rejected as unknown",
  "the panel sends provider:'' until Settings is opened; refusing it closed the socket before the resolver ran, so BROTTO_FORCE_ENV_MODEL never got a say",
);
check(
  /const RECONNECT_MAX_ATTEMPTS = 3;/.test(worker),
  "the worker retries three times",
  "six attempts is ~30s of 'retrying' before the panel admits the run is over",
);

// ── Retrying mid-run orphans the run that is already going ─────────────────
//
// The retry button is on every assistant message, so it is clickable while a
// task is in flight. retryLastTask was the one path that resets *before* it
// sends: resetForNewTask() clears the transcript, drops taskInFlight and
// hides Stop, and only then does sendMessage fire the second run — which then
// takes the `if (state.taskInFlight) return` guard sendMessage has, because
// retry just cleared it. The live run's frames kept arriving into a
// transcript that no longer had them, with no Stop button to end it.
//
// Ordering is the whole bug and ordering is invisible in a return value, so
// assert the guard precedes the reset rather than that a guard exists.
console.log("\nretry cannot orphan a run that is already in flight");
const retry = /function retryLastTask\(\)\s*\{([\s\S]*?)\n\}/.exec(panel);
check(!!retry, "retryLastTask is findable");
if (retry) {
  const body = retry[1];
  const guard = body.search(/state\.taskInFlight/);
  const reset = body.search(/resetForNewTask\(\)/);
  check(guard >= 0, "retryLastTask checks for a live run", body.trim());
  check(
    guard >= 0 && reset >= 0 && guard < reset,
    "the check comes before the reset",
    "resetForNewTask clears taskInFlight, so a guard after it always passes",
  );
}

// ── A sign-in timeout suspends, it does not fail ───────────────────────────
//
// The harness waits 300s at a login wall and then suspends the run. That
// arrives as two frames: `login_timeout` first (which carries the url, title
// and task the resume card is drawn from) and then the ordinary `task_result`
// -> `task_failed` that every ended run produces. The failure handler settles
// blocking cards and stamps ERROR, so left alone it undoes the card the frame
// before it just drew — on a run the user is one click from continuing.
//
// Ordering is the whole contract and is invisible in a return value.
console.log("\na suspended run is not turned back into a failure");
const timeoutCase = /case 'login_timeout':([\s\S]*?)\n\s*break;/.exec(panel);
check(!!timeoutCase, "the login_timeout case is findable");
if (timeoutCase) {
  const body = timeoutCase[1];
  check(/stopTimer\(\)/.test(body), "login_timeout stops the clock",
    "nothing else will; the run is over and the socket is closing");
  check(/resume:\s*true/.test(body), "login_timeout asks for a resumable card",
    "the user needs the Resume, not the Continue that pokes a queue nothing reads");
}
check(
  /function appendLoginCard\(\{[^}]*resume/.test(panel),
  "appendLoginCard is what draws the Resume",
  "without the parameter the timeout draws the same card as a live wall, whose button does nothing",
);
const failedCase = /case 'task_failed':([\s\S]*?)\n\s*break;/.exec(panel);
check(!!failedCase, "the task_failed case is findable");
if (failedCase) {
  check(
    /failure_reason === 'login_timeout'[\s\S]*?break;/.test(failedCase[1]),
    "task_failed does not re-settle a suspended run",
    "settleBlockingCards and setPhase('error') undo the resume card the frame before it drew",
  );
}

console.log(
  failed === 0
    ? "\nall checks passed"
    : `\n${failed} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);
