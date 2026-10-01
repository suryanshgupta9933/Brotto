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
const panel = fs.readFileSync(path.join(SRC, "sidepanel.js"), "utf8");
const worker = fs.readFileSync(path.join(SRC, "background.ts"), "utf8");

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
  /case 'task_error':[\s\S]*?clearBlockingCards\(\)/.test(panel),
  "the task_error case clears blocking cards",
  "an unanswered approval/login card would outlive the run",
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

console.log(
  failed === 0
    ? "\nall checks passed"
    : `\n${failed} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);
