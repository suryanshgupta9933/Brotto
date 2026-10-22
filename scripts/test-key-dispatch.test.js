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

// `keyCodeFor` and its table sit beside the branch rather than inside it, and
// the branch cannot run without them. Extracted from source for the same
// reason the branch is: a key code that quietly went missing is an absence,
// and an absence reads clean in review.
//
// `dispatchKey` is extracted for a second reason: it is the *shared* press, so
// `type_at`'s clear and the standalone `key` action cannot drift apart. A
// modifier one of them honours and the other drops is the original bug in a
// new place, and it would be invisible in a diff.
function extractDispatchKey() {
  const fn = source.search(/^async function dispatchKey\s*\(/m);
  if (fn < 0) throw new Error("no dispatchKey in background.ts — renamed?");
  const open = source.indexOf("{", fn);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      // The body runs as plain JavaScript, so the signature's annotations come
      // off and only the body ships — same rule as `verifyTarget` and
      // `anyCommand` in pointer.ts.
      const head = source.slice(fn, open).replace(/:\s*[\w<>[\]| ]+/g, "");
      return head + source.slice(open, i + 1);
    }
  }
  throw new Error("unterminated dispatchKey");
}

function extractKeyCodeHelper() {
  const table = source.search(/const KEY_CODES/);
  if (table < 0) throw new Error("no KEY_CODES table in background.ts — renamed?");
  const fn = source.indexOf("function keyCodeFor", table);
  if (fn < 0) throw new Error("no keyCodeFor in background.ts — renamed?");
  const open = source.indexOf("{", fn);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(table, i + 1);
  }
  throw new Error("unterminated keyCodeFor");
}

// One function out of the shipped source, with its signature's TS
// annotations off: these bodies run as plain JavaScript, and a `: type` left
// in one is a syntax error there.
function extractFn(src, name) {
  const re = new RegExp(
    `^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*(?::\\s*[A-Za-z_$][\\w$<>\\[\\]| ]*)?\\s*\\{`,
    "m",
  );
  const m = re.exec(src);
  if (!m) throw new Error(`no function ${name} — renamed?`);
  const open = src.indexOf("{", m.index);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      // The signature is stripped on its own: a rule that ran over the whole
      // function would eat the `: false` in an object literal in the body.
      const head = src.slice(m.index, open)
        .replace(/:\s*[A-Za-z_$][\w$<>\[\]| ]*(\s*[,)])/g, "$1")
        .replace(/:\s*[A-Za-z_$][\w$]*\s*$/, "");
      return head + src.slice(open, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

// The module-level record the shipped code keeps, and the two helpers that
// manage it. Sliced out of the source so the test cannot pass against a
// record the extension does not have.
function extractGridRecord() {
  const decl = source.match(/^let gridWrite.*$/m);
  if (!decl) throw new Error("no gridWrite record in background.ts — renamed?");
  return decl[0].replace(/:.*$/, "") + " = null;";
}

// Runs the extracted branch against a fake dbg and returns the params of
// every Input.dispatchKeyEvent it sent.
//
// `gridWrite` is a **live binding**: it is declared in the same scope as the
// branch, so the branch's own assignment to it is observable afterwards, and
// the record's lifetime is the record's lifetime rather than a copy passed
// in. Passing it by value would have made "cleared on read" untestable, and
// "does not survive into a later task" untestable with it.
function dispatch(action, opts = {}) {
  const sent = [];
  const dbg = {
    sendCommand: async (_tabId, cmd) => {
      if (cmd.method === "Input.dispatchKeyEvent") sent.push(cmd.params);
    },
  };
  // `focusState` answers whether anything that can receive text still holds
  // the focus.
  const focusState = async () => (opts.holding ? { ok: true, reason: "" } : { ok: false, reason: "focus-on-body" });
  let reasserted = 0;
  const reassertGridFocus = async () => { reasserted++; return { ok: true, reason: "" }; };
  const fn = vm.runInNewContext(
    `(async (t, action, dbg, tabId, focusState, reassertGridFocus, initialWrite) => {
       ${extractGridRecord()}
       gridWrite = initialWrite;
       let taskInFlight = false;
       ${extractFn(source, "clearGridWrite")}
       ${extractFn(source, "clearGridWriteUnlessKey")}
       ${extractFn(source, "isCommittingKey")}
       ${extractFn(source, "endTask")}
       ${extractKeyCodeHelper()}
       ${extractDispatchKey()}
       ${extractKeyBranch()}
       return {
         gridWrite,
         // The helpers the branch does not call itself, exposed so a test can
         // drive them against the same live record.
         endTask: () => endTask(),
         clearUnlessKey: (t) => clearGridWriteUnlessKey(t),
       };
     })`,
  );
  return fn("key", action, dbg, 7, focusState, reassertGridFocus, opts.gridWrite ?? null)
    .then((state) => ({ sent, reasserted, ...state }));
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
  const { sent: ctrlA } = await dispatch({ type: "key", key: "a", modifiers: 2 });
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
  const { sent: enter } = await dispatch({ type: "key", key: "Enter" });
  check(
    "an unmodified key sends no bitmask",
    enter[0] && enter[0].modifiers === undefined,
    `Enter params were ${JSON.stringify(enter[0])}`,
  );

  // A key with no key code is an event Chrome can decline to act on — a press
  // that reports success and types nothing. Measured on session ad0337c9,
  // where a nine-step Google Docs run ended on a title field holding
  // "Untitled dbrobrbrottoottobottotodocument".
  check(
    "a named key carries its code",
    enter[0] && enter[0].windowsVirtualKeyCode === 13,
    `Enter keyCode was ${enter[0] && enter[0].windowsVirtualKeyCode}`,
  );
  check(
    "a named key sends no text payload",
    enter[0] && enter[0].text === undefined,
    `Enter text was ${JSON.stringify(enter[0] && enter[0].text)}`,
  );
  check(
    "a character key carries its own code and its text",
    ctrlA[0] && ctrlA[0].windowsVirtualKeyCode === 65,
    `a keyCode was ${ctrlA[0] && ctrlA[0].windowsVirtualKeyCode}`,
  );
  check(
    "a modified key is a rawKeyDown, or the page never sees the shortcut",
    ctrlA[0] && ctrlA[0].type === "rawKeyDown",
    `a type was ${ctrlA[0] && ctrlA[0].type}`,
  );
  check(
    "keyUp is always keyUp, modifier or not",
    enter[1] && enter[1].type === "keyUp" && ctrlA[1] && ctrlA[1].type === "keyUp",
    `up types were ${JSON.stringify([enter[1] && enter[1].type, ctrlA[1] && ctrlA[1].type])}`,
  );

  // The grid is mid-edit and its editor was re-rendered: nothing holds the
  // focus any more, so the Enter that commits has to be handed back to it.
  const orphaned = await dispatch({ type: "key", key: "Enter" },
    { gridWrite: { tabId: 7 }, holding: false });
  check(
    "a key that commits a grid write re-asserts the editor when nothing holds the focus",
    orphaned.reasserted === 1,
    `reasserted ${orphaned.reasserted} times`,
  );
  check(
    "the committing key consumes the record — it is one key, not a standing state",
    orphaned.gridWrite === null,
    `the record was ${JSON.stringify(orphaned.gridWrite)}`,
  );
  // And it never takes the focus from a field the model is typing into — the
  // name-box jump would be typed into a cell instead.
  const holding = await dispatch({ type: "key", key: "Enter" },
    { gridWrite: { tabId: 7 }, holding: true });
  check(
    "a key never takes the focus from a field that holds it",
    holding.reasserted === 0,
    `reasserted ${holding.reasserted} times`,
  );
  const unclaimed = await dispatch({ type: "key", key: "Enter" }, { holding: false });
  check(
    "a key after an ordinary write is not the grid's to claim",
    unclaimed.reasserted === 0,
    `reasserted ${unclaimed.reasserted} times`,
  );

  // An arrow key navigates the grid; it does not commit. It must not spend
  // the record, or the real Enter after it finds nothing and the cell is
  // never committed.
  const arrow = await dispatch({ type: "key", key: "ArrowDown" },
    { gridWrite: { tabId: 7 }, holding: false });
  check(
    "an arrow key does not consume the pending grid write",
    arrow.gridWrite !== null && arrow.gridWrite.tabId === 7,
    `the record was ${JSON.stringify(arrow.gridWrite)}`,
  );
  check(
    "an arrow key does not re-assert the grid's editor",
    arrow.reasserted === 0,
    `reasserted ${arrow.reasserted} times`,
  );

  // A record for another tab is stale: the extension drives one tab at a
  // time, and a key press in this tab is not that tab's commit.
  const otherTab = await dispatch({ type: "key", key: "Enter" },
    { gridWrite: { tabId: 9 }, holding: false });
  check(
    "a record for another tab is dropped, not kept",
    otherTab.gridWrite === null,
    `the record was ${JSON.stringify(otherTab.gridWrite)}`,
  );
  check(
    "a record for another tab never re-asserts anything",
    otherTab.reasserted === 0,
    `reasserted ${otherTab.reasserted} times`,
  );

  // The record belongs to the task that made the write.
  const laterTask = await dispatch({ type: "key", key: "Enter" },
    { gridWrite: { tabId: 7 }, holding: false });
  laterTask.endTask();
  check(
    "the record does not survive the task that made the write",
    laterTask.gridWrite === null,
    `the record was ${JSON.stringify(laterTask.gridWrite)}`,
  );

  // And it is about the next *key*, not about the next action.
  const clicked = await dispatch({ type: "key", key: "Enter" },
    { gridWrite: { tabId: 7 }, holding: false });
  clicked.clearUnlessKey("click");
  check(
    "an action that is not a key ends the pending grid write",
    clicked.gridWrite === null,
    `the record was ${JSON.stringify(clicked.gridWrite)}`,
  );
  const keyed = await dispatch({ type: "key", key: "ArrowDown" },
    { gridWrite: { tabId: 7 }, holding: true });
  keyed.clearUnlessKey("key");
  check(
    "a key does not end the pending grid write",
    keyed.gridWrite !== null,
    `the record was ${JSON.stringify(keyed.gridWrite)}`,
  );

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
