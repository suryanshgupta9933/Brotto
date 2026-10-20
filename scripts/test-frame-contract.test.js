const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const bg = fs.readFileSync(path.join(ROOT, "clients/brotto-extension/src/background.ts"), "utf8");

// The payload assignment is `const payload: Record<string, unknown> = { ... };`
// with a type annotation, so `lastIndexOf('{', i)` finds the object literal.
// Conditional assignments AFTER the literal (payload.model_config = ...) are
// read by scanning the whole send function, so they are not lost.
function taskStartKeys(src) {
  const i = src.indexOf('type: "task_start"');
  assert.ok(i !== -1, "task_start payload not found");

  // Start of the object literal.
  const open = src.lastIndexOf("{", i);
  let depth = 0;
  let end = -1;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) { end = j; break; }
    }
  }
  assert.ok(end !== -1, "unbalanced braces in task_start payload");

  // End at the send of THIS payload. The call is `ws!.send(JSON.stringify(payload))`
  // — the non-null `!` means searching for "ws.send" misses it, and the region
  // runs on into unrelated frames where a removed key can still be found.
  const send = src.indexOf("JSON.stringify(payload)", end);
  assert.ok(send !== -1, "send of task_start payload not found");
  const region = src.slice(open, send).replace(/\/\/.*$/gm, "");

  const keys = new Set();
  for (const m of region.matchAll(/\b(?:payload\.)?([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) {
    keys.add(m[1]);
  }
  for (const m of region.matchAll(/payload\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) {
    keys.add(m[1]);
  }
  // Shorthand property (`session_id,`) carries no colon.
  for (const m of region.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*$/gm)) {
    keys.add(m[1]);
  }
  keys.delete("Record"); // the type annotation
  return keys;
}

// The contract as of 0.2.0. A REMOVED key is a breaking change: minor bump,
// plus a server that still accepts the old shape for one minor. An ADDED key
// does not touch the existing entries.
const TASK_START_KEYS_V0_2 = [
  "type", "task", "session_id", "resume", "user_policy", "device_id",
  "ext_version", "model_config", "api_key",
];

test("task_start still carries every key the 0.2.0 contract names", () => {
  const keys = taskStartKeys(bg);
  for (const k of TASK_START_KEYS_V0_2) {
    assert.ok(keys.has(k),
      `task_start lost "${k}" — breaking, needs a minor bump and one minor of back-compat`);
  }
});

// `action_result` is the extension's answer to the action it was handed: the
// dispatch-time hit test refuses a click whose coordinate no longer holds the
// element the ref resolved to, and before this frame existed a refused click
// read as `Clicked [7]` and was audited `ok: true`. It is a frame one side
// sends and the other does not read if they ever disagree — a refused action
// nobody hears about. Both halves are asserted in one test on purpose: the
// server is shipped first and reads the frame for a minor before any extension
// sends it, so the two are allowed to be out of step in time but never in
// existence.
test("action_result is sent by the extension and read by the server", () => {
  const main = fs.readFileSync(
    path.join(ROOT, "services/brotto-orchestrator/src/brotto_orchestrator/main.py"), "utf8");
  assert.ok(bg.includes('type: "action_result"'),
    "background.ts no longer sends action_result — the server's refusal report is now dead");
  assert.ok(/t == "action_result"/.test(main),
    "main.py no longer routes action_result — every refusal is now audited ok: true");
});

// The one grow-only addition to an *inbound* frame. `evaluate` gained an
// optional `isolatedWorld` flag; it is not a new frame and not a shape change,
// so the only thing the contract can require is that the default is untouched
// — a caller that does not pass the flag must reach the main world with the
// same params as before. The behavioural half lives in
// `test-evaluate-isolated-world.test.js`; this is the place a reader checking
// the grow-only set will look.
test("evaluate's optional isolatedWorld flag leaves the default shape alone", () => {
  const branch = bg.slice(bg.indexOf('case "evaluate":'));
  assert.match(branch, /msg\.isolatedWorld === true/,
    "the flag must be read as an explicit true, so absence and false are one path");
  assert.match(branch, /returnByValue: true/,
    "returnByValue is the contract's half — the isolated world shares the DOM, so the value is the same");
});
