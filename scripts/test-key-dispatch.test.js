// The key handler dropped its modifiers, so "clear this field" typed a
// literal "a" instead of selecting all.
//
// Measured on a failed 19-step run: six iterations of
// click → clear → type a query → nothing submitted, each one appending
// another "a" to Gmail's search box. The relay was sending
// `modifiers: 2` (Control) the whole time; `background.ts` never read it.
//
// The branch is extracted from source rather than copied, so this cannot
// drift from what ships — the failure was invisible in a diff, because
// the dropped field is an absence, not a wrong value.
//
//   node scripts/test-key-dispatch.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src", "background.ts");
const source = fs.readFileSync(SRC, "utf8");

// The `key` branch sits inside the big action dispatcher, so brace
// matching runs from the branch condition rather than a function header.
// Returns the branch *body* — the `else if` wrapper is not a legal block
// of its own, so it cannot be evaluated on its own.
function extractKeyBranch() {
  const start = source.search(/else if \(t === "key"\)/);
  if (start < 0) throw new Error('no `t === "key"` branch in background.ts — renamed?');
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("unterminated `key` branch");
}

// Runs the extracted branch against a fake dbg and returns the params of
// every Input.dispatchKeyEvent it sent.
function dispatch(action) {
  const sent = [];
  const dbg = {
    sendCommand: async (_tabId, cmd) => {
      if (cmd.method === "Input.dispatchKeyEvent") sent.push(cmd.params);
    },
  };
  const body = extractKeyBranch();
  const fn = vm.runInNewContext(
    `(async (t, action, dbg, tabId) => { ${body} })`,
  );
  return fn("key", action, dbg, 7).then(() => sent);
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}\n      ${detail}`);
  }
}

(async () => {
  // Control+A — the shape clear_ref sends. modifiers is the whole point:
  // CDP treats a key event as bare unless the bitmask says otherwise.
  const ctrlA = await dispatch({ type: "key", key: "a", modifiers: 2 });
  check(
    "keyDown carries the modifier bitmask",
    ctrlA[0] && ctrlA[0].modifiers === 2,
    `keyDown params were ${JSON.stringify(ctrlA[0])}`,
  );
  check(
    "keyUp carries the same bitmask",
    ctrlA[1] && ctrlA[1].modifiers === 2,
    `keyUp params were ${JSON.stringify(ctrlA[1])}`,
  );
  check(
    "the named key survives alongside the modifier",
    ctrlA[0] && ctrlA[0].key === "a",
    `key was ${ctrlA[0] && ctrlA[0].key}`,
  );

  // A bare key with no modifier must not gain one.
  const enter = await dispatch({ type: "key", key: "Enter" });
  check(
    "an unmodified key sends no bitmask",
    enter[0] && enter[0].modifiers === undefined,
    `Enter params were ${JSON.stringify(enter[0])}`,
  );

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
