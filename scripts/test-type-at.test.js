// `type_at` fuses focus + clear + type into one action, so `type_text` pays one
// post-action observation instead of two. Every function below is sliced out of
// the shipped source and run against a fake CDP session, because the failure
// this guards against is an *ordering*: text that lands somewhere other than
// the element the model was shown. A dropped guard is an absence and reads clean
// in a diff.
//
// The three gates, and what each one is for:
//
//   1. `verifyTarget` — the press still resolves `backendNodeId` and refuses when
//      the node is gone. Unchanged from `click`, but it now runs on a type.
//   2. `focusState` — the two-frame version had the server's `focus_id` reading
//      the focused element between the click and the keystroke. Fusing closes
//      that window, so the extension reads focus itself and refuses to type into
//      a document where nothing holds it. Sheets is why this is deliberately
//      not an identity check: a cell's focus lands on a hidden input that is not
//      a descendant of the cell node.
//   3. `clear` is a DOM operation on the focused element, and the focus probe
//      and the clear are one evaluate. It used to be a modifier bitmask on the
//      frame — the shape of the original Gmail bug, where Control+A arrived as
//      a bare "a" and typed a letter. The chord is gone because "which chord
//      means select-all" is an OS question the extension may not ask and the
//      server cannot answer.
//
//   node --test scripts/test-type-at.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXT = path.join(__dirname, "..", "clients", "brotto-extension");
const bgSrc = fs.readFileSync(path.join(EXT, "src", "background.ts"), "utf8");
const ptrSrc = fs.readFileSync(path.join(EXT, "src", "observation", "pointer.ts"), "utf8");

function extractTemplate(src, name) {
  const marker = `const ${name} = \``;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`no template const ${name} — renamed?`);
  const end = src.indexOf("`;", start);
  if (end < 0) throw new Error(`unterminated template ${name}`);
  return src.slice(start + marker.length, end);
}

/** Strip the signature's TS annotations. These bodies run as plain JavaScript,
 *  so they may not carry a `: type`, a return type, or an `as T`.
 *
 *  The signature and the body are handled separately on purpose: a rule that
 *  strips `: false,` would also eat the `: false` in `{ ok: false }`. */
function stripSignature(sig) {
  // A return type can carry its own braces (`Promise<{ ok: boolean; reason:
  // string } | null>`), so it is scanned for its matching angle rather than
  // pattern-matched — a regex stops at the first `{` and leaves half behind.
  let out = sig.replace(/\)\s*:\s*Promise</g, ")<");
  for (let i = out.indexOf(")<"); i >= 0; i = out.indexOf(")<")) {
    let depth = 0;
    let end = -1;
    for (let j = i + 1; j < out.length; j++) {
      if (out[j] === "<") depth++;
      else if (out[j] === ">" && --depth === 0) { end = j; break; }
    }
    if (end < 0) break;
    out = out.slice(0, i + 1) + out.slice(end + 1);
  }
  return out.replace(/:\s*[\w<>[\]| ]+(?=\s*[,)])/g, "");
}

const stripBody = (body) => body.replace(/\s+as\s+[A-Za-z<>\[\]| ]+/g, "");

function extractFn(src, name) {
  const head = new RegExp(`^(export )?(async )?function ${name}\\s*\\(`, "m");
  const start = src.search(head);
  if (start < 0) throw new Error(`no function ${name} — renamed?`);
  // The body opens at the first `{` that ends a line, not the first `{` on
  // screen: a return type can carry its own braces, and counting from one of
  // them closes the function halfway through its own signature.
  const open = src.indexOf("{\n", start);
  if (open < 0) throw new Error(`no body in ${name} — renamed?`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      // One pass over the whole function: a return type straddles the
      // signature/body boundary (`): Promise<void> {`) and splitting first
      // leaves half of it behind.
      return stripSignature(src.slice(start, open)) + stripBody(src.slice(open, i + 1));
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function extractBranch(cond) {
  const start = bgSrc.indexOf(`else if (${cond}) {`);
  if (start < 0) throw new Error(`no \`${cond}\` branch in background.ts — renamed?`);
  const open = bgSrc.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < bgSrc.length; i++) {
    if (bgSrc[i] === "{") depth++;
    else if (bgSrc[i] === "}" && --depth === 0) return stripBody(bgSrc.slice(open + 1, i));
  }
  throw new Error(`unterminated \`${cond}\` branch`);
}

const KEY_CODES = bgSrc.slice(
  bgSrc.indexOf("const KEY_CODES"),
  bgSrc.indexOf("};", bgSrc.indexOf("const KEY_CODES")) + 2,
);

const FOCUS_PROBE = extractTemplate(ptrSrc, "FOCUS_PROBE");

// ── the harness ─────────────────────────────────────────────────────────────

/**
 * Run the shipped `type_at` branch against a fake CDP session.
 *
 * `opts.verify` / `opts.focus` default to passing, so a test states only what
 * it is about; a guard test flips one of them.
 */
function run(action, opts = {}) {
  const sent = [];
  const dbg = {
    sendCommand: async (_tabId, cmd) => { sent.push(cmd); return {}; },
  };
  const deps = {
    dbg,
    tabId: 1,
    action,
    verifyTarget: opts.verify ?? (async () => ({ ok: true, reason: "" })),
    clearCursor: async () => {},
    drawCursor: async () => ({ drawn: true, reason: "" }),
    focusState: opts.focus ?? (async () => ({ ok: true, reason: "" })),
    sleep: async () => {},
    console,
  };
  const names = Object.keys(deps);
  const fn = vm.runInNewContext(
    `(async (${names.join(", ")}) => {
      ${KEY_CODES}
      ${extractFn(bgSrc, "keyCodeFor")}
      ${extractFn(bgSrc, "dispatchKey")}
      ${extractFn(bgSrc, "pressAt")}
      let refusal = null;
      ${extractBranch('t === "type_at"')}
      return refusal ?? { ok: true, reason: "" };
    })`,
  );
  return fn(...names.map((n) => deps[n])).then((result) => ({ result, sent }));
}

const AT = { type: "type_at", x: 100, y: 200, backendNodeId: 42, text: "hello" };

// ── the happy path ──────────────────────────────────────────────────────────

test("one click, one insertText — the whole sequence, in order", async () => {
  const { result, sent } = await run(AT);
  assert.equal(result.ok, true);
  const methods = sent.map((c) => c.method);
  assert.deepEqual(methods, [
    "Input.dispatchMouseEvent", "Input.dispatchMouseEvent", "Input.insertText",
  ], `methods were ${JSON.stringify(methods)}`);
  assert.equal(sent[2].params.text, "hello");
});

test("the text goes in whole, not one call per character", async () => {
  // A 1325-character README is 1325 CDP round trips if it is typed per
  // character, and every "\n" arrives as a literal newline character.
  const { sent } = await run({ ...AT, text: "a\nb" });
  assert.equal(sent.filter((c) => c.method === "Input.insertText").length, 1);
});

// ── gate 1: the target is still there ───────────────────────────────────────

test("a target the page has dropped refuses before anything is dispatched", async () => {
  const { result, sent } = await run(AT, { verify: async () => ({ ok: false, reason: "target-gone" }) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "target-gone");
  assert.equal(sent.length, 0, "no mouse, no key, no text — a refusal dispatches nothing");
});

test("the fused action is gated exactly as `click` is, on the same helper", () => {
  // Both branches must reach one press. A gate copied into the type_at branch
  // would be a second implementation, and the two would drift.
  for (const cond of ['t === "click" || t === "click_xy"', 't === "type_at"']) {
    assert.ok(extractBranch(cond).includes("pressAt("), `${cond} must go through pressAt`);
  }
  assert.ok(extractFn(bgSrc, "pressAt").includes("verifyTarget(tabId, action.backendNodeId, x, y)"),
    "the hit test stays inside the shared press, so both branches are gated");
});

// ── gate 2: something holds focus ───────────────────────────────────────────

test("a click that focused nothing refuses, and types nothing", async () => {
  const { result, sent } = await run(AT, { focus: async () => ({ ok: false, reason: "focus-on-body" }) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "focus-on-body");
  assert.equal(sent.filter((c) => c.method === "Input.insertText").length, 0);
});

test("the focus check runs after the press and before the text", () => {
  const branch = extractBranch('t === "type_at"');
  const press = branch.indexOf("pressAt(");
  const focus = branch.indexOf("focusState(");
  const insert = branch.indexOf(String.raw`method: "Input.insertText"`);
  assert.ok(press > 0 && focus > press && insert > focus,
    "the order is press, then read focus, then type — never type into an unchecked document");
});

// ── gate 3: a clear is a DOM operation, not a chord ─────────────────────────

test("the clear asks for no chord at all — no key event is ever dispatched", async () => {
  // The shape of the original Gmail bug, closed: Control+A arrived as a bare
  // "a" and typed a letter into the field it was meant to empty. There is no
  // "a" left to arrive wrong, because nothing is sent.
  const { result, sent } = await run({ ...AT, clear: true });
  assert.equal(result.ok, true);
  assert.equal(sent.filter((c) => c.method === "Input.dispatchKeyEvent").length, 0,
    "a clear that needs a chord is a clear that means something different per OS");
});

test("a `modifiers` bitmask on the frame is ignored — it is not what clears", async () => {
  // Both bitmasks, both OSes, and the answer is identical. That is the whole
  // acceptance criterion: behaviour must not vary with the modifier, because
  // the modifier is the one thing that varies with the OS.
  for (const modifiers of [2, 4, 0, undefined]) {
    const { result, sent } = await run({ ...AT, clear: true, modifiers });
    assert.equal(result.ok, true, `modifiers=${modifiers}`);
    assert.equal(sent.filter((c) => c.method === "Input.dispatchKeyEvent").length, 0);
  }
});

test("a clear that fails refuses rather than appending to the field it was to empty", async () => {
  for (const reason of ["clear-no-text-field", "clear-threw"]) {
    const { result, sent } = await run({ ...AT, clear: true }, {
      focus: async () => ({ ok: false, reason }),
    });
    assert.equal(result.ok, false, reason);
    assert.equal(result.reason, reason);
    assert.equal(sent.filter((c) => c.method === "Input.insertText").length, 0,
      "`clear: true` means replace; appending is the wrong answer with a new hat on");
  }
});

test("`clear` is passed to the probe as a strict boolean, never a truthy frame value", async () => {
  // `clear: "yes"` from a hand-rolled frame must not reach the probe as-is.
  const seen = [];
  await run({ ...AT, clear: "yes" }, { focus: async (_t, c) => { seen.push(c); return { ok: true, reason: "" }; } });
  assert.equal(seen[0], false, "only a literal true clears");
  await run({ ...AT, clear: true }, { focus: async (_t, c) => { seen.push(c); return { ok: true, reason: "" }; } });
  assert.equal(seen[1], true);
});

test("the clear is selected before the text, or the text lands inside it", async () => {
  // The probe that selects is the same one that refuses to type into nothing,
  // so ordering is structural: it returns before insertText is reached.
  const { sent } = await run({ ...AT, clear: true });
  const methods = sent.map((c) => c.method);
  assert.deepEqual(methods, [
    "Input.dispatchMouseEvent", "Input.dispatchMouseEvent", "Input.insertText",
  ], `insertText must come last, and only one probe between press and text: ${JSON.stringify(methods)}`);
});

test("the branch never dispatches a key, so it can never need to know the OS", () => {
  const branch = extractBranch('t === "type_at"');
  assert.doesNotMatch(branch, /dispatchKey|modifiers|navigator|userAgent|platform/,
    "select-all is a DOM operation; a key here is the per-OS bug it replaced");
  assert.ok(branch.includes("focusState(tabId, action.clear === true)"),
    "the clear rides the focus probe, so it targets what the press focused");
});

// ── the shipped focus probe ─────────────────────────────────────────────────

function runProbe(active, doClear = false) {
  const doc = {
    activeElement: active,
    body: { nodeType: 1 },
    documentElement: { nodeType: 1 },
    getSelection: () => selection,
    createRange: () => ({
      selectNodeContents: (el) => { selection.__contents = el; },
    }),
  };
  const selection = {
    ranges: [],
    removeAllRanges() { this.ranges.length = 0; },
    addRange(r) { this.ranges.push(r); },
  };
  const window = {};
  return { result: vm.runInNewContext(`(${FOCUS_PROBE})`, { document: doc, window }).call(null, doClear), selection };
}

/** A focusable element with the DOM surface `select()` needs. */
const textField = () => ({ nodeType: 1, selected: 0, value: "", select() { this.selected++; } });

/** `input[type=email]` and friends: `select()` is specified to do nothing. */
const noOpSelectField = () => ({
  nodeType: 1, value: "a@b.com", selectionStart: 5, selectionEnd: 5, select() {},
});

test("an element holding focus passes — including one the click did not reach into", async () => {
  // Sheets: the cell node is a <canvas>, the focus lands on a hidden input that
  // is not its descendant. An identity or containment check would refuse here,
  // which is why the probe asks only whether *something* holds focus.
  assert.equal(runProbe({ nodeType: 1 }).result.ok, true);
});

test("body and root are 'nobody is focused', and null is too", () => {
  assert.equal(runProbe(null).result.reason, "no-active-element");
  const doc = { activeElement: { nodeType: 1 }, body: { nodeType: 1 }, documentElement: { nodeType: 1 } };
  const window = {};
  for (const [active, why] of [["body", "focus-on-body"], ["documentElement", "focus-on-root"]]) {
    doc.activeElement = doc[active];
    assert.equal(vm.runInNewContext(`(${FOCUS_PROBE})`, { document: doc, window }).call(null, true).reason, why);
  }
});

test("a clear selects the focused element's own contents, wherever it hangs in the tree", () => {
  const el = textField();
  const { result } = runProbe(el, true);
  assert.equal(result.ok, true);
  assert.equal(el.selected, 1, "select() on the hidden input is the clear");
});

test("a clear with no chord means contenteditable is handled, not skipped", () => {
  // Google Docs: no `select()`, the text is in a contenteditable. A range over
  // the node's contents is the same operation by another route.
  const el = { nodeType: 1, isContentEditable: true };
  const { result, selection } = runProbe(el, true);
  assert.equal(result.ok, true);
  assert.equal(selection.ranges.length, 1);
  assert.equal(selection.__contents, el);
});

test("no clear asked for, nothing is selected", () => {
  const el = textField();
  assert.equal(runProbe(el, false).result.ok, true);
  assert.equal(el.selected, 0);
});

test("a `select()` that silently did nothing refuses — email, number, date", () => {
  // HTMLInputElement.select() is specified to do nothing on a type it does not
  // apply to, and to do nothing rather than throw. Reporting success there is
  // the append bug with the refusal removed.
  assert.equal(runProbe(noOpSelectField(), true).result.reason, "clear-select-noop");
});

test("a real select over a value passes, because the selection actually moved", () => {
  const el = textField();
  el.value = "hello";
  el.selectionStart = 0;
  el.selectionEnd = 0;
  el.select = function () { this.selected++; this.selectionStart = 0; this.selectionEnd = 5; };
  assert.equal(runProbe(el, true).result.ok, true);
});

test("an empty field of a no-op type is not a failed clear — there is nothing to clear", () => {
  const el = noOpSelectField();
  el.value = "";
  el.selectionStart = 0;
  el.selectionEnd = 0;
  assert.equal(runProbe(el, true).result.ok, true);
});

test("an element with neither `select()` nor contenteditable refuses, and types nothing", () => {  // A <canvas> cell whose press focused something untypable. Refusing is the
  // point: insertText would append to whatever text was already there.
  assert.equal(runProbe({ nodeType: 1, tagName: "DIV" }, true).result.reason, "clear-no-text-field");
});

test("a `select()` that throws refuses rather than reporting a clear that did not happen", () => {
  const el = { nodeType: 1, select() { throw new Error("detached"); } };
  assert.equal(runProbe(el, true).result.reason, "clear-threw");
});

test("the probe holds no platform branch and names no element", () => {
  assert.doesNotMatch(FOCUS_PROBE, /navigator|userAgent|platform|dispatchKeyEvent/,
    "which chord means select-all differs per OS, which is why there is no chord");
  assert.doesNotMatch(FOCUS_PROBE, /contains|closest|querySelector/,
    "an identity check would refuse the canvas shape this action exists for");
  // The clear targets `activeElement` and nothing else — not a node id, not a
  // coordinate, not a selector the model could have influenced.
  assert.doesNotMatch(FOCUS_PROBE, /backendNodeId|querySelector|elementFromPoint/);
});

// ── focusState, the CDP wrapper around it ───────────────────────────────────

function loadFocusState(handler) {
  const anyCommand = async (tabId, command) => handler(command);
  const shipped = extractFn(ptrSrc, "focusState").replace(/^export\s+/, "");
  return new Function("anyCommand", "FOCUS_PROBE", `return ${shipped}`)(anyCommand, FOCUS_PROBE);
}

test("the clear flag reaches the page as a literal, not a truthy frame value", async () => {
  const seen = [];
  const capture = async (cmd) => { seen.push(cmd.params.expression); return { result: { value: { ok: true, reason: "" } } }; };
  await loadFocusState(capture)(1, true);
  await loadFocusState(capture)(1, false);
  await loadFocusState(capture)(1);
  assert.match(seen[0], /\)\(true\)$/, `got ${seen[0]}`);
  assert.match(seen[1], /\)\(false\)$/);
  assert.match(seen[2], /\)\(false\)$/, "an absent clear is no clear");
});

test("one evaluate answers both questions — the clear costs no extra round trip", async () => {
  let calls = 0;
  const focusState = loadFocusState(async () => { calls++; return { result: { value: { ok: true, reason: "" } } }; });
  await focusState(1, true);
  assert.equal(calls, 1, "the focus read and the select share one evaluate");
});

test("the probe's verdict survives the round trip", async () => {
  const focusState = loadFocusState(async () => ({ result: { value: { ok: true, reason: "" } } }));
  assert.equal((await focusState(1)).ok, true);
  const refusing = loadFocusState(async () => ({ result: { value: { ok: false, reason: "focus-on-body" } } }));
  assert.equal((await refusing(1)).reason, "focus-on-body");
});

test("a probe that throws refuses — the answer is unknowable, not a pass", async () => {
  const focusState = loadFocusState(async () => { throw new Error("context destroyed"); });
  assert.equal((await focusState(1)).reason, "focus-probe-failed");
});

test("a probe that returns nothing refuses", async () => {
  const focusState = loadFocusState(async () => ({ result: {} }));
  assert.equal((await focusState(1)).reason, "focus-probe-silent");
});

// ── the wire ────────────────────────────────────────────────────────────────

test("the action is additive: an orchestrator that predates it is unaffected", () => {
  // `type_at` arrives inside the existing `action` frame, so nothing about the
  // frame shape moves and no version bump rides on it.
  assert.ok(bgSrc.includes('} else if (t === "type_at") {'));
  assert.match(bgSrc, /const result = await executeAction\(tid, msg\.action\)/,
    "type_at is an action kind, not a new frame type");
});