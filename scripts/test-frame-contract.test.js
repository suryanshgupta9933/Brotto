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
