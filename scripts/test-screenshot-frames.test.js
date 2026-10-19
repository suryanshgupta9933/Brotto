// W1 — the screenshot path is mostly an absence, so it needs a test.
//
// The failure that matters is not "the wrong quality" — it is an observation
// that should have carried an image and did not, or a base64 string that was
// truncated on the way and decodes to a corrupt picture a vision model reads
// as a page. Both read clean in a diff. So the branch is extracted from
// `background.ts` by brace matching and run against a fake socket, exactly
// like `test-key-dispatch.test.js`, and the relay's half is extracted from
// `extension_relay.py` the same way.
//
// It also pins two decisions that are otherwise free to drift: JPEG at q60
// (PNG is ~10x the tokens per step for no benefit) and no `notifyUi` in the
// branch — a frame forwarded to a panel with no `case` for it is a run that
// never ends (`test-no-orphan-frames.test.js`).

//   node scripts/test-screenshot-frames.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const bg = fs.readFileSync(
  path.join(ROOT, "clients", "brotto-extension", "src", "background.ts"), "utf8");
const relay = fs.readFileSync(
  path.join(ROOT, "services", "brotto-orchestrator", "src", "brotto_orchestrator",
    "cdp", "extension_relay.py"), "utf8");

/** The `case "capture_screenshot":` body, with TypeScript annotations stripped. */
function extractBranch() {
  const start = bg.search(/case "capture_screenshot":/);
  if (start < 0) throw new Error('no `case "capture_screenshot"` — renamed?');
  const open = bg.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < bg.length; i++) {
    if (bg[i] === "{") depth++;
    else if (bg[i] === "}" && --depth === 0) {
      return bg.slice(open + 1, i)
        .replace(/ as \{[^}]*\}/g, "")   // `x as { data?: unknown }`
        .replace(/ as [A-Za-z<>\[\]| ]+;/g, "")
        .replace(/ws!/g, "ws")          // the non-null assertion
        .replace(/^\s*break;\s*$/m, ""); // the switch's, with no switch here
    }
  }
  throw new Error("unterminated capture_screenshot branch");
}

/** Run the branch against a fake socket and a fake debugger. */
function runBranch({ sendCommand, tid = 1 }) {
  const sent = [];
  const ctx = {
    tid,
    ws: { send: (s) => sent.push(JSON.parse(s)) },
    dbg: { sendCommand },
    MAX_SCREENSHOT_CHARS: 4000000,
  };
  vm.createContext(ctx);
  const body = extractBranch();
  vm.runInContext(`(async () => {${body}})()`, ctx);
  return new Promise((resolve) => {
    ctx.__done = resolve;
    // The branch resolves before its own promise is awaited; poll-free
    // because `run` returns synchronously once the last send has happened.
    setTimeout(() => resolve(sent), 10);
  });
}

const JPEG = "/9j/4AAQSkZJRgABAQAAAQ==";
let failed = 0;
function check(ok, label, detail) {
  console.log(ok ? `  ok  ${label}` : `FAIL  ${label}`);
  if (!ok) {
    failed++;
    if (detail) console.log(`      ${detail}`);
  }
}

(async () => {
  console.log("the capture command is JPEG at quality 60, clipped to the viewport");
  const calls = [];
  const sent = await runBranch({
    sendCommand: (tab, cmd) => {
      calls.push([tab, cmd]);
      return Promise.resolve({ data: JPEG });
    },
  });
  check(calls.length === 1, "one CDP command is issued");
  check(calls[0] && calls[0][1].method === "Page.captureScreenshot",
    "the method is Page.captureScreenshot",
    calls[0] && `got ${calls[0][1].method}`);
  const p = (calls[0] && calls[0][1].params) || {};
  check(p.format === "jpeg", "format is jpeg, not png — ~10x the tokens per step");
  check(p.quality === 60, "quality is 60");
  check(p.clip === undefined, "no clip: the default viewport, not a full-page shot");

  console.log("\nthe answer is one screenshot_result frame carrying base64");
  check(sent.length === 1 && sent[0].type === "screenshot_result",
    "exactly one screenshot_result is sent");
  check(sent[0] && sent[0].data === JPEG, "the base64 arrives intact");
  check(sent[0] && sent[0].error === undefined,
    "a success carries no error key — the server's branch tests for it");

  console.log("\nthe branch is never forwarded to the panel");
  check(!/notifyUi/.test(extractBranch()),
    "no notifyUi in the capture branch",
    "the panel has no `case 'screenshot_result'`, and forwarding it is a run " +
      "that never ends; the image is for the server");

  console.log("\nan absent or corrupt image is refused, never half-sent");
  const empty = await runBranch({ sendCommand: () => Promise.resolve({ data: "" }) });
  check(empty.length === 1 && empty[0].error && empty[0].data === "",
    "an empty capture answers with an error, not a blank page");

  const huge = "A".repeat(4000001);
  const big = await runBranch({ sendCommand: () => Promise.resolve({ data: huge }) });
  check(big.length === 1 && /too large/.test(big[0].error || ""),
    "an oversized capture is refused — truncated base64 decodes to a corrupt image");

  const threw = await runBranch({
    sendCommand: () => Promise.reject(new Error("detached")),
  });
  check(threw.length === 1 && threw[0].error && threw[0].data === "",
    "a CDP failure answers with an error rather than silence");

  const noTab = await runBranch({
    tid: null,
    sendCommand: () => Promise.reject(new Error("should not be called")),
  });
  check(noTab.length === 1 && !!noTab[0].error,
    "no attached tab answers with an error rather than hanging the caller");

  console.log("\nthe frame contract is additive — nothing was renamed or removed");
  check(/case "evaluate":/.test(bg), "the evaluate frame still exists");
  check(/evaluate_result/.test(bg), "the extension still answers evaluate_result");

  console.log("\nthe relay half asks, waits, and returns the base64");
  for (const sig of [
    "async def capture_screenshot(self)",
    "async def deliver_screenshot_result(self, message: dict)",
    'await self._ws_send({"type": "capture_screenshot"})',
  ]) {
    check(relay.includes(sig), `extension_relay.py has ${sig}`);
  }
  // The base64 must not reach a log line or the relay's cached state.
  // Scoped to the function body, not to a run of neighbours: a region between
  // two method names silently widens every time a method is added between them.
  const method = relay.slice(
    relay.indexOf("async def capture_screenshot"),
    relay.indexOf("\n    async def ", relay.indexOf("async def capture_screenshot") + 1));
  check(!/log\.(info|debug|warning)\([^)]*data\b/.test(method),
    "the relay never logs the payload — the log line would be the picture on disk");
  check(!/self\._cached_obs/.test(method),
    "the image is not stored on the relay — transit only");

  console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
})();