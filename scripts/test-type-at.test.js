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
//   2. `bindFocus` — *who* holds focus. `focusState` alone proved only that
//      something did, so `select()` ran against whatever `activeElement` was
//      and a missed press emptied some other field. `bindFocus` names the
//      focused node from the engine (`DOM.getFocusNode`, which no page script
//      can answer) and binds it to the node the press was verified against,
//      with a narrow exemption for the canvas shape identity cannot serve.
//   3. `focusState` — the two-frame version had the server's `focus_id` reading
//      the focused element between the click and the keystroke. Fusing closes
//      that window, so the extension reads focus itself and refuses to type into
//      a document where nothing holds it. It evaluates in an **isolated world**,
//      so a page cannot override `document.activeElement` or `select()`.
//   4. `clear` is a DOM operation on the focused element, and the focus probe
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
  // An arrow-typed parameter carries its own `Promise<T>` and its own `(...)`,
  // and neither the `)<` rule below nor the scalar rule after it reaches inside
  // one — so it goes first, whole.
  let out = sig
    .replace(/:\s*\([^()]*\)\s*=>\s*Promise<[^<>]*>/g, "")
    .replace(/\)\s*:\s*Promise</g, ")<");
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
  // `[<(]` and not `\\(`: a generic function carries a parameter list, as
  // `withWorld<T>(` does, and a signature rule that only knows `(` cannot find it.
  const head = new RegExp(`^(export )?(async )?function ${name}\\s*[<(]`, "m");
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
      return stripSignature(src.slice(start, open)).replace(/<[A-Za-z]\w*>\(/, "(")
        + stripBody(src.slice(open, i + 1));
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

// The canvas bound, read from the source rather than copied, so a test that
// trips it cannot drift from the constant that trips it.
const MAX_CANVAS_CHARS_SRC = bgSrc.includes("const MAX_CANVAS_CHARS")
  ? bgSrc.slice(bgSrc.indexOf("const MAX_CANVAS_CHARS"),
    bgSrc.indexOf(";", bgSrc.indexOf("const MAX_CANVAS_CHARS")) + 1)
  : "";
const MAX_CANVAS_CHARS = Number((MAX_CANVAS_CHARS_SRC.match(/\d+/) || ["0"])[0]);

const FOCUS_PROBE = extractTemplate(ptrSrc, "FOCUS_PROBE");
const IDENTITY_PROBE = extractTemplate(ptrSrc, "IDENTITY_PROBE");

// The grid focus probe is a template literal, so it is *cooked* before it is
// run: the source text carries `\\s+` and the string the page sees carries
// `\s+`. A raw slice would split the class list on a literal backslash.
//
// Lazy on purpose: a source without the probe must fail the tests that need
// it, not the whole file — otherwise a missing feature breaks the *other*
// tests' harness instead of failing its own.
let _gridFocusProbe = null;
function gridFocusProbe() {
  if (_gridFocusProbe === null) {
    _gridFocusProbe = vm.runInNewContext("`" + extractTemplate(ptrSrc, "GRID_FOCUS_PROBE") + "`");
  }
  return _gridFocusProbe;
}

// The delivery probe is a template literal too, and is cooked the same way.
let _gridDeliveryProbe = null;
function gridDeliveryProbe() {
  if (_gridDeliveryProbe === null) {
    _gridDeliveryProbe = vm.runInNewContext("`" + extractTemplate(ptrSrc, "GRID_DELIVERY_PROBE") + "`");
  }
  return _gridDeliveryProbe;
}

// The recognised grid editors, read from the source rather than copied, so a
// test cannot pass against an adapter list the code does not have.
const GRID_ADAPTERS_SRC = ptrSrc.slice(
  ptrSrc.indexOf("export const GRID_ADAPTERS"),
  ptrSrc.indexOf("];", ptrSrc.indexOf("export const GRID_ADAPTERS")) + 2,
).replace("export const", "const");

/** The identity the recognised Sheets grid presents: the app's own origin, the
 *  path the app is served under, the app's own editor container id, and the
 *  app's own editor class. The path matters as much as the origin: one origin
 *  serves Google Docs, Drive and Sheets alike. */
const SHEETS = {
  origin: "https://docs.google.com",
  path: "/spreadsheets/d/1/edit",
  focusScope: "waffle-rich-text-editor",
  focusClass: "cell-input",
};

// ── the harness ─────────────────────────────────────────────────────────────

/**
 * Run the shipped `type_at` branch against a fake CDP session.
 *
 * `opts.verify` / `opts.focus` default to passing, so a test states only what
 * it is about; a guard test flips one of them.
 */
function run(action, opts = {}) {
  const sent = [];
  const state = { clears: 0, focusClears: [] };
  // The grid path reads the editor's content twice — before and after the
  // keystrokes — and the default models a grid that took them: empty, then
  // not.
  let editorReads = 0;
  const dbg = {
    sendCommand: async (_tabId, cmd) => { sent.push(cmd); return {}; },
  };
  const deps = {
    dbg,
    tabId: 1,
    action,
    boundedPoint: opts.point ?? (async (_t, x, y) => ({ x: Math.round(x), y: Math.round(y) })),
    verifyTarget: opts.verify ?? (async () => ({ ok: true, reason: "" })),
    bindFocus: opts.bind ?? (async () => ({ ok: true, reason: "same-node" })),
    // Counts any call that removes the marker. The cursor is the user's only
    // way to see where the agent is clicking, so a call here is a defect; the
    // assertion that says so lives with the cursor.
    clearCursor: async () => { state.clears++; },
    drawCursor: async () => ({ drawn: true, reason: "" }),
    // The focus probe, with the *clear* argument recorded: whether the page
    // was asked to select-all is the whole of the clear's behaviour, and a
    // clear that is silently dropped is an absence.
    focusState: opts.focus ?? (async (_tabId, doClear) => {
      state.focusClears.push(doClear === true);
      return { ok: true, reason: "" };
    }),
    // The focus re-read on the grid path: the same node, unless a test says
    // otherwise.
    focusNode: opts.focusNode ?? (async () => ({ ok: true, backendNodeId: 42 })),
    // The binding, re-made before every keystroke on the grid path. It holds
    // by default; a test that is about a focus steal says otherwise.
    reassertGridFocus: opts.reassert ?? (async () => ({ ok: true, reason: "" })),
    editorText: opts.editorText ?? (async () => ({ ok: true, text: editorReads++ === 0 ? "" : "typed" })),
    // Where the typed text ended up, when the grid replaced its own editor and
    // the two reads are no longer comparable. The default models the ordinary
    // case: the grid's own scope holds it.
    gridDelivery: opts.delivery ?? (async () => ({ ok: true, state: "in-grid" })),
    sleep: async () => {},
    console,
  };
  const names = Object.keys(deps);
  // The canvas helper is optional, so that a source without it still builds the
  // harness — otherwise a missing feature breaks the *other* tests' harness
  // instead of failing its own.
  const canvasHelper = bgSrc.includes("function typeIntoCanvas")
    ? extractFn(bgSrc, "typeIntoCanvas") : "";
  const fn = vm.runInNewContext(
    `(async (${names.join(", ")}) => {
      ${KEY_CODES}
      ${MAX_CANVAS_CHARS_SRC}
      ${extractFn(bgSrc, "keyCodeFor")}
      ${extractFn(bgSrc, "dispatchKey")}
      ${canvasHelper}
      ${extractFn(bgSrc, "pressAt")}
      let refusal = null;
      let gridWrite = null;
      ${extractBranch('t === "type_at"')}
      return refusal ?? { ok: true, reason: "" };
    })`,
  );
  return fn(...names.map((n) => deps[n])).then((result) => ({ result, sent, state }));
}

const AT = { type: "type_at", x: 100, y: 200, backendNodeId: 42, text: "hello" };

/** The focus a grid's own cell editor takes: recognised origin, and the app's
 *  editor, so both the keystroke delivery and the focus re-assert are on. */
const GRID_BIND = async () => ({
  ok: true, reason: "canvas-grid-editor", focusId: 42, grid: true, gridEditor: true,
});

/** The focus on a grid page that is NOT the cell editor — the formula bar, or
 *  the name box. Keystrokes, yes; the focus is never taken from it. */
const GRID_FIELD_BIND = async () => ({
  ok: true, reason: "same-node", focusId: 42, grid: true, gridEditor: false,
});

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

// ── gate 0: the coordinate is a point in the live viewport ───────────────────

test("a coordinate outside the live viewport refuses before anything is dispatched", async () => {
  // Finding 1. `type_at` used to press and then run a *destructive* clear on
  // whatever the press focused, with the wire's x/y checked by nobody.
  const { result, sent } = await run(AT, { point: async () => null });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "point-out-of-viewport", "the reason `click_xy` already uses");
  assert.equal(sent.length, 0, "no press, no clear, no text");
});

test("the bounded point is what is pressed, verified and bound", async () => {
  // Not the sent point: the sent point is what the sender believed about a
  // window that may have been resized since. The hit test in `pressAt` asks
  // `elementFromPoint` about the point that is *dispatched*, so the two must be
  // the same number or the check describes a different click.
  const seen = { verify: null, bound: null };
  const { sent } = await run({ ...AT, x: 100.4, y: 200.6 }, {
    point: async () => ({ x: 100, y: 201 }),
    verify: async (_t, _id, x, y) => { seen.verify = [x, y]; return { ok: true, reason: "" }; },
    bind: async (_t, _id, x, y) => { seen.bound = [x, y]; return { ok: true, reason: "same-node" }; },
  });
  assert.deepEqual(seen.verify, [100, 201], "the hit test is asked about the dispatched point");
  assert.deepEqual(seen.bound, [100, 201], "and the focus is bound to it too");
  const [press, release] = sent;
  assert.equal(press.params.x, 100);
  assert.equal(release.params.y, 201);
});

test("the bounding runs before the press, and both verbs share one helper", () => {
  const typeAt = extractBranch('t === "type_at"');
  const click = extractBranch('t === "click" || t === "click_xy"');
  assert.ok(typeAt.indexOf("boundedPoint(") > 0 && typeAt.indexOf("boundedPoint(") < typeAt.indexOf("pressAt("),
    "an unbounded press is a destructive press");
  for (const [name, src] of [["type_at", typeAt], ["click", click]]) {
    assert.ok(src.includes("boundedPoint(tabId, action.x, action.y)"),
      `${name} must bound the wire coordinate the same way`);
    assert.ok(src.includes('reason: "point-out-of-viewport"'),
      `${name} must refuse in the same words`);
  }
  assert.ok(typeAt.includes("pressAt(tabId, action, x, y)"),
    "the bounded pair is what is dispatched");
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

test("no keystroke on any path carries a modifier, so no path needs to know the OS", async () => {
  // The clear is a DOM operation, so the ordinary path sends no key at all; the
  // canvas path sends character keys, and a chord is the per-OS bug the clear
  // was moved away from. Both facts are the same fact: no modifier, ever.
  for (const reason of ["same-node", "canvas-grid-editor"]) {
    const { sent } = await run({ ...AT, text: "ab" }, {
      bind: async () => ({ ok: true, reason }),
    });
    for (const k of sent.filter((c) => c.method === "Input.dispatchKeyEvent")) {
      assert.ok(!k.params.modifiers, `${reason}: a chord means something different per OS`);
    }
  }
  const { sent } = await run({ ...AT, clear: true });
  assert.equal(sent.filter((c) => c.method === "Input.dispatchKeyEvent").length, 0,
    "the ordinary path types by insertion, and the clear is not a chord");
  const branch = extractBranch('t === "type_at"');
  assert.ok(branch.includes("focusState(tabId, action.clear === true)"),
    "the clear rides the focus probe, so it targets what the press focused");
});

// ── the canvas grid path ─────────────────────────────────────────────────────

test("a canvas grid is typed, one keystroke per character — an insertion never reaches a cell", async () => {
  // A grid starts editing on the *keystroke*: `Input.insertText` fires no
  // keydown, so the cell would show a caret with nothing in it. That is the
  // reported failure — the cell was selected, and the text never arrived.
  const { result, sent } = await run({ ...AT, text: "ab" }, {
    bind: GRID_BIND,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(sent.filter((c) => c.method === "Input.insertText").length, 0,
    "an insertion fires no keydown, and a grid starts editing on the keydown");
  const keys = sent.filter((c) => c.method === "Input.dispatchKeyEvent");
  assert.equal(keys.length, 4, "two characters, each a keyDown and a keyUp");
  assert.equal(keys[0].params.type, "keyDown");
  assert.equal(keys[0].params.text, "a");
  assert.equal(keys[1].params.type, "keyUp");
  assert.equal(keys[2].params.text, "b");
});

test("a newline on the grid path is a Return key, not a newline character", async () => {
  const { sent } = await run({ ...AT, text: "a\nb" }, {
    bind: GRID_BIND,
  });
  const downs = sent.filter((c) => c.method === "Input.dispatchKeyEvent" && c.params.type !== "keyUp");
  assert.deepEqual(downs.map((c) => c.params.key), ["a", "Enter", "b"]);
});

test("text longer than the canvas bound is refused, and nothing is typed", async () => {
  const { result, sent } = await run({ ...AT, text: "x".repeat(MAX_CANVAS_CHARS + 1) }, {
    bind: GRID_BIND,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "canvas-text-too-long");
  assert.equal(sent.filter((c) => c.method === "Input.dispatchKeyEvent").length, 0,
    "a refusal types nothing");
});

test("the ordinary path is unchanged — one insertion, no keystrokes", async () => {
  const { sent } = await run(AT, { bind: async () => ({ ok: true, reason: "same-node" }) });
  assert.equal(sent.filter((c) => c.method === "Input.insertText").length, 1);
  assert.equal(sent.filter((c) => c.method === "Input.dispatchKeyEvent").length, 0);
});

// ── the grid path reports its own delivery ───────────────────────────────────

test("a focus steal that cannot be corrected refuses, and types nothing", async () => {
  // The editor was verified a moment ago; the page may have moved focus since.
  // The binding is re-made before the keystroke, and if it cannot be re-made
  // the text is not typed at all — a field nobody verified must not receive
  // it, and the refusal says which field it was.
  const { result, sent } = await run({ ...AT, text: "ab" }, {
    bind: GRID_BIND,
    reassert: async () => ({ ok: false, reason: "focus-changed" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "focus-changed");
  assert.equal(sent.filter((c) => c.method === "Input.dispatchKeyEvent").length, 0,
    "a refusal types nothing");
});

test("a grid whose editor did not change reports the text as not delivered", async () => {
  // The editor still says exactly what it said before the keystrokes, and it
  // does not contain what was typed — so the text did not land in the cell.
  // Reported, not swallowed: the old path said "ok" and the model believed it.
  let reads = 0;
  const { result, sent } = await run({ ...AT, text: "ab" }, {
    bind: GRID_BIND,
    editorText: async () => { reads++; return { ok: true, text: "" }; },
  });
  assert.equal(reads, 2, "the editor is read before and after the keystrokes");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "grid-text-not-delivered");
  assert.ok(sent.filter((c) => c.method === "Input.dispatchKeyEvent").length > 0,
    "the text was typed — it simply did not land");
});

test("a grid whose editor changed reports success", async () => {
  let reads = 0;
  const { result } = await run({ ...AT, text: "ab" }, {
    bind: GRID_BIND,
    editorText: async () => ({ ok: true, text: reads++ === 0 ? "" : "ab" }),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("an editor that cannot be read is not a failure — it is not measured", async () => {
  // `ok: false` from the read means the node is gone or the page went away. A
  // check that cannot read must not report a delivery it did not observe.
  const { result } = await run({ ...AT, text: "ab" }, {
    bind: GRID_BIND,
    editorText: async () => ({ ok: false, text: "" }),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("a grid that replaced its editor mid-typing is not a failed delivery", async () => {
  // The editor node the text was typed into is gone — the grid re-rendered the
  // cell. The old node's text is not evidence about the new one, so the two
  // reads are not comparable and nothing is claimed either way.
  const { result } = await run({ ...AT, text: "ab" }, {
    bind: GRID_BIND,
    // The only focus read left on this path is the after-read, and it names
    // the replacement editor — so the two reads are not comparable.
    focusNode: async () => ({ ok: true, backendNodeId: 99 }),
    editorText: async () => ({ ok: true, text: "" }),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("text that is already in the cell is not a failed delivery", async () => {
  // The cell already said "ab" and the agent typed "ab": the editor did not
  // change, and nothing is wrong. The check must not call that a failure.
  const { result } = await run({ ...AT, text: "ab" }, {
    bind: GRID_BIND,
    editorText: async () => ({ ok: true, text: "ab" }),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});

// ── a keystroke that went to another editor ──────────────────────────────────
//
// A key event is focus-global: it goes to whatever holds the focus when the
// browser processes it. The re-assert puts the grid's editor back before every
// keystroke, so at most one keystroke can go astray per focus steal — but one
// is one character of the user's text in somebody else's field, and the old
// path reported that as a plain success.

test("a keystroke that went to another editor is a misdelivery, not a success", async () => {
  // The re-assert found a *text-entry surface* that is not the grid's own
  // holding the focus: the previous keystroke may have gone there. The grid's
  // editor did not change, so the text did not land in the cell either.
  let calls = 0;
  const { result } = await run({ ...AT, text: "ab" }, {
    bind: GRID_BIND,
    reassert: async () => { calls++; return { ok: true, reason: "", drift: calls === 2 ? "suspect" : "benign" }; },
    editorText: async () => ({ ok: true, text: "" }),
  });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, "grid-text-misdelivered",
    "a keystroke that reached another editor is named as such");
});

test("a focus move that is not to a text field is not a misdelivery", async () => {
  // The grid's own re-render moves the focus to the body, and a commit moves
  // it to the grid's canvas. Neither can receive the text, so neither is a
  // misdelivery — the plain "did not land" reason is the honest one.
  let calls = 0;
  const { result } = await run({ ...AT, text: "ab" }, {
    bind: GRID_BIND,
    reassert: async () => { calls++; return { ok: true, reason: "", drift: "benign" }; },
    editorText: async () => ({ ok: true, text: "" }),
  });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, "grid-text-not-delivered");
});

test("the editor replaced mid-typing, with a keystroke that went elsewhere, is a misdelivery", async () => {
  // The grid re-rendered its editor, so the two reads are not comparable and
  // the old path skipped the check — and reported a success. The page is
  // asked where the text is instead: not in the grid's own scope, so it went
  // somewhere the press was never aimed at.
  let calls = 0;
  const { result } = await run({ ...AT, text: "ab" }, {
    bind: GRID_BIND,
    reassert: async () => { calls++; return { ok: true, reason: "", drift: calls === 2 ? "suspect" : "benign" }; },
    focusNode: async () => ({ ok: true, backendNodeId: 99 }),
    editorText: async () => ({ ok: true, text: "" }),
    delivery: async () => ({ ok: true, state: "unknown" }),
  });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, "grid-text-misdelivered");
});

test("the editor replaced mid-typing, and the grid has the text, is a success", async () => {
  // The same shape, with the text where it belongs: the grid's own scope
  // holds it, so the re-render is the grid's business and nothing is wrong.
  let calls = 0;
  const { result } = await run({ ...AT, text: "ab" }, {
    bind: GRID_BIND,
    reassert: async () => { calls++; return { ok: true, reason: "", drift: calls === 2 ? "suspect" : "benign" }; },
    focusNode: async () => ({ ok: true, backendNodeId: 99 }),
    editorText: async () => ({ ok: true, text: "" }),
    delivery: async () => ({ ok: true, state: "in-grid" }),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("the editor replaced mid-typing, with nothing wrong, is still a success", async () => {
  // No keystroke went astray, so the page is not even asked: the old
  // behaviour — nothing measured, nothing claimed — is kept.
  let asked = 0;
  const { result } = await run({ ...AT, text: "ab" }, {
    bind: GRID_BIND,
    focusNode: async () => ({ ok: true, backendNodeId: 99 }),
    editorText: async () => ({ ok: true, text: "" }),
    delivery: async () => { asked++; return { ok: true, state: "unknown" }; },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(asked, 0, "the page is only asked when a keystroke may have gone elsewhere");
});

// ── the binding on the grid path ─────────────────────────────────────────────
//
// A grid cell is *typed*, not inserted. `Input.insertText` fires no keydown,
// and a grid starts editing on the keystroke, so the text has to arrive as key
// events — and a key event is not bound to a node: it goes to whatever holds
// focus when the browser processes it. So the binding cannot be made in the
// dispatch. It is made in the page, immediately before each dispatch, and it
// is made by *putting the focus back* rather than by observing that it left.
//
// Reading the focus and comparing ids is not a binding. The read says what
// was true when it answered; a page that moves focus between the read and
// the keystroke gets the text anyway. That is the finding, and it is why
// this path now changes the page instead of only reading it.

test("the binding is re-made before every keystroke, not once per string", async () => {
  // Per character, because a key event is a round trip: one check would leave
  // a window spanning every keystroke in the string, and a page that takes the
  // focus after the first character would receive the rest of it.
  let calls = 0;
  const { result } = await run({ ...AT, text: "abc" }, {
    bind: GRID_BIND,
    reassert: async () => { calls++; return { ok: true, reason: "" }; },
  });
  assert.equal(calls, 3, "one binding per character");
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("nothing sits between the binding and the key event", async () => {
  // The review named this: a read between the final focus check and the
  // insertion is a round trip of window with nothing in it.
  const fn = extractFn(bgSrc, "typeIntoCanvas");
  const i = fn.indexOf("await beforeChar()");
  const j = fn.indexOf("await dispatchKey(");
  assert.ok(i > 0 && j > i, "the binding comes first");
  const between = fn.slice(i, j);
  assert.equal((between.match(/await /g) || []).length, 1,
    "the only await between the binding and the key event is the binding itself");
});

test("the editor is read before the binding, not between it and the text", async () => {
  // It is a "before" reading, so it belongs there — and a read that sits
  // between the last check and the keystroke is the window the review named.
  const branch = extractBranch('t === "type_at"');
  const firstRead = branch.indexOf("editorText(");
  const typing = branch.indexOf("typeIntoCanvas(");
  assert.ok(firstRead > 0 && typing > firstRead,
    "the before-read must precede the binding, not interrupt it");
});

test("a focus steal that is corrected does not stop the text", async () => {
  // The whole point of re-asserting rather than observing: the page took the
  // focus, the extension took it back, and the text still lands in the grid.
  let calls = 0;
  const { result, sent } = await run({ ...AT, text: "ab" }, {
    bind: GRID_BIND,
    reassert: async () => { calls++; return { ok: true, reason: "" }; },
  });
  assert.equal(calls, 2);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(sent.filter((c) => c.method === "Input.dispatchKeyEvent").length, 4,
    "two characters, each a keyDown and a keyUp");
});

test("a focus steal in the middle of the string stops the typing where it happened", async () => {
  // The binding broke on the second character, so the second character is not
  // typed — and the refusal is reported, not swallowed.
  let calls = 0;
  const { result, sent } = await run({ ...AT, text: "abc" }, {
    bind: GRID_BIND,
    reassert: async () => {
      calls++;
      return calls === 1 ? { ok: true, reason: "" } : { ok: false, reason: "focus-changed" };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "focus-changed");
  assert.equal(sent.filter((c) => c.method === "Input.dispatchKeyEvent").length, 2,
    "one character was typed before the binding broke, and no more");
});

// ── the probe that holds the focus ───────────────────────────────────────────

/** A DOM small enough to run the shipped grid focus probe against. */
function gridDom({ origin = SHEETS.origin, path = SHEETS.path, withEditor = true } = {}) {
  const state = { focusCalls: [], active: null };
  const el = (o) => ({
    nodeType: 1,
    tagName: o.tag || "DIV",
    isContentEditable: o.editable !== false,
    className: o.className || "",
    id: o.id || "",
    scope: o.scope || null,
    closest() { return this.scope ? this.scope : (this.id ? this : null); },
    focus(opts) { state.focusCalls.push({ el: this, opts }); state.active = this; },
  });
  const container = el({ id: SHEETS.focusScope, editable: false });
  const editor = el({ className: SHEETS.focusClass, scope: container });
  container.querySelectorAll = (sel) => (withEditor && sel === "." + SHEETS.focusClass ? [editor] : []);
  const doc = {
    get activeElement() { return state.active; },
    getElementById: (id) => (id === SHEETS.focusScope ? container : null),
  };
  // Something else holds the focus: a field the user can see, and no part of
  // the grid.
  const stranger = el({ className: "user-field", editable: false });
  // A field that can *receive* text — the one shape a keystroke can go into.
  const otherField = el({ className: "other-field", tag: "INPUT", editable: false });
  // The engine's "nobody holds the focus".
  const body = el({ className: "body", tag: "BODY", editable: false });
  return { state, document: doc, location: { origin, pathname: path }, container, editor, stranger, otherField, body };
}

const ADAPTERS = vm.runInNewContext(`${GRID_ADAPTERS_SRC}; GRID_ADAPTERS`);

function runGridProbe(dom) {
  const fn = vm.runInNewContext("(" + gridFocusProbe() + ")", {
    document: dom.document,
    location: dom.location,
  });
  return fn.call(dom.document, ADAPTERS);
}

test("the grid's editor already holds the focus — the probe touches nothing", async () => {
  const dom = gridDom();
  dom.state.active = dom.editor;
  const r = runGridProbe(dom);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.outcome, "already-focused");
  assert.equal(dom.state.focusCalls.length, 0, "the focus is not moved when it is already right");
});

test("a stolen focus is taken back — and the page is not scrolled", async () => {
  // The editor is parked at y = -9998, so a plain `focus()` scrolls the user's
  // viewport to the top of the document. `preventScroll` is the difference
  // between a correction and a yank.
  const dom = gridDom();
  dom.state.active = dom.stranger;
  const r = runGridProbe(dom);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.outcome, "refocused");
  assert.equal(dom.state.focusCalls.length, 1);
  assert.deepEqual(dom.state.focusCalls[0].opts, { preventScroll: true },
    "the focus is taken back without scrolling the user's page");
  assert.equal(dom.state.active, dom.editor, "the focus is the grid's own editor");
});

test("a focus that cannot be taken back refuses", async () => {
  // There is no editor to take it back to, so the text is not typed.
  const dom = gridDom({ withEditor: false });
  dom.state.active = dom.stranger;
  const r = runGridProbe(dom);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "focus-changed");
});

test("a page that is not the application is refused", async () => {
  // The origin is the part a page cannot forge, and it is the part the probe
  // looks the adapter up by — so a page that is not the grid gets no binding.
  const dom = gridDom({ origin: "https://attacker.example" });
  dom.state.active = dom.editor;
  const r = runGridProbe(dom);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "grid-editor-unrecognised");
});

test("the probe takes the focus back with preventScroll, in the source", () => {
  assert.match(gridFocusProbe(), /focus\(\{ preventScroll: true \}\)/,
    "the editor is off-screen; a plain focus() scrolls the user's viewport away");
});

test("a focus that was on another text field is reported as suspect", () => {
  // The drift is classified, not just noticed: a *text-entry surface* that is
  // not the grid's own is the one shape a keystroke can go into, so the
  // keystroke before it may have gone there. The caller needs to know.
  const dom = gridDom();
  dom.state.active = dom.otherField;
  const r = runGridProbe(dom);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.outcome, "refocused");
  assert.equal(r.drift, "suspect", "another field held the focus");
});

test("a focus that was on the body, or on the grid's own surface, is benign", () => {
  // The grid replaces its own editor when it re-renders a cell, and the focus
  // lands on the body; a commit lands it on the grid's canvas. Neither can
  // receive text, so neither is a misdelivery.
  for (const which of ["body", "stranger"]) {
    const dom = gridDom();
    dom.state.active = dom[which];
    const r = runGridProbe(dom);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.drift, "benign", `${which} cannot receive the text`);
  }
});

/** A DOM small enough to run the shipped delivery probe against. */
function deliveryDom({ origin = SHEETS.origin, path = SHEETS.path, scopeText = "", foreign = [] } = {}) {
  const el = (o) => ({
    nodeType: 1,
    tagName: o.tag || "DIV",
    isContentEditable: o.editable === true,
    className: o.className || "",
    value: o.value,
    textContent: o.text ?? "",
  });
  const scope = el({ id: SHEETS.focusScope, text: scopeText });
  scope.contains = (n) => n === scope;
  scope.querySelectorAll = () => [];
  const doc = {
    getElementById: (id) => (id === SHEETS.focusScope ? scope : null),
    querySelectorAll: () => foreign,
  };
  return { document: doc, location: { origin, pathname: path }, scope };
}

function runDeliveryProbe(dom, text) {
  const fn = vm.runInNewContext("(" + gridDeliveryProbe() + ")", {
    document: dom.document,
    location: dom.location,
  });
  return fn.call(dom.document, ADAPTERS, text);
}

test("the delivery probe finds the text in the grid's own scope", () => {
  const dom = deliveryDom({ scopeText: "hello world" });
  const r = runDeliveryProbe(dom, "hello");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.state, "in-grid");
});

test("the delivery probe finds the text in another editor", () => {
  // The case the review named: the text reached an editor the press was never
  // aimed at.
  const other = { nodeType: 1, tagName: "INPUT", isContentEditable: false, value: "hello" };
  const dom = deliveryDom({ scopeText: "", foreign: [other] });
  const r = runDeliveryProbe(dom, "hello");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.state, "foreign");
});

test("the delivery probe finds nothing when the text is nowhere", () => {
  const dom = deliveryDom({ scopeText: "" });
  const r = runDeliveryProbe(dom, "hello");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.state, "unknown", "nothing was found, and nothing is claimed");
});

test("the delivery probe refuses a page that is not the application", () => {
  const dom = deliveryDom({ origin: "https://attacker.example", scopeText: "hello" });
  const r = runDeliveryProbe(dom, "hello");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "grid-editor-unrecognised");
});

/** The shipped `reassertGridFocus`, with the shipped world plumbing around it. */
function loadReassert(fx, adapters = ADAPTERS) {
  const shipped = extractFn(ptrSrc, "reassertGridFocus").replace(/^export\s+/, "");
  const body = ["isolatedWorld", "withWorld", "topFrameId"]
    .map((n) => extractFn(ptrSrc, n).replace(/^export\s+/, ""))
    .join("\n");
  const prelude = 'const IDLE_WORLD = "brotto-idle";\nconst worldIds = new Map();\n';
  return new Function("anyCommand", "GRID_ADAPTERS", "GRID_FOCUS_PROBE",
    `${prelude}${body}\nreturn ${shipped}`)(fx.anyCommand, adapters, gridFocusProbe());
}

test("the re-assert runs in the isolated world, with the adapter list in the expression", async () => {
  const seen = [];
  const anyCommand = async (_t, c) => {
    seen.push(c);
    if (c.method === "Page.getFrameTree") return { frameTree: { frame: { id: "F" } } };
    if (c.method === "Page.createIsolatedWorld") return { executionContextId: 9 };
    return { result: { value: { ok: true, outcome: "already-focused" } } };
  };
  const r = await loadReassert({ anyCommand })(1);
  assert.equal(r.ok, true, JSON.stringify(r));
  const evaluate = seen.find((c) => c.method === "Runtime.evaluate");
  assert.equal(evaluate.params.contextId, 9, "the page must not be able to answer the question");
  assert.match(evaluate.params.expression, /docs\.google\.com/,
    "the adapter list rides in the expression, so the test cannot drift from the code");
});

test("a re-assert that cannot answer refuses — the answer is unknowable, not a pass", async () => {
  const r = await loadReassert({ anyCommand: async () => { throw new Error("context destroyed"); } })(1);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "focus-changed");
});

// ── the cursor stays where it was put ────────────────────────────────────────

test("nothing in the extension removes the marker — the cursor is always visible", async () => {
  // The cursor is the user's only way to see where the agent is clicking. A
  // path that removes it — a `finally`, a timer, a redraw that starts from
  // scratch — puts the user back to a click they cannot see.
  const { state, sent } = await run(AT);
  assert.equal(state.clears, 0, "the marker was removed after the click");
  assert.ok(!bgSrc.includes("clearCursor"), "the extension has no path that removes the marker");
  assert.ok(!ptrSrc.includes("CLEAR_CURSOR"), "and no snippet removes it either");
  assert.equal(sent.filter((c) => c.method === "Input.insertText").length, 1,
    "the run still did its work");
});

// ── the shipped focus probe ─────────────────────────────────────────────────
//
// `FOCUS_PROBE` decides "is this a text field" with `instanceof` against the
// extension's own prototypes. That is only sound because the probe runs in an
// isolated world, and it is only *testable* if the fixture is built in the same
// realm as the classes it is tested against — an `instanceof` across two vm
// contexts is false for every fixture, so a `runInNewContext` harness with
// plain-object fixtures would report the predicate as always refusing and would
// pass for entirely the wrong reason. The fixture is therefore built by
// evaluating source *inside* the probe's own context.

const REALM = `
  class HTMLInputElement {
    constructor(v) {
      this.nodeType = 1; this.tagName = "INPUT";
      this.value = v === undefined ? "" : v;
      this.selectionStart = 0; this.selectionEnd = 0; this.selects = 0;
    }
    // The native behaviour select() is specified to have: it covers the value.
    select() { this.selects++; this.selectionStart = 0; this.selectionEnd = this.value.length; }
  }
  class HTMLTextAreaElement extends HTMLInputElement {
    constructor(v) { super(v); this.tagName = "TEXTAREA"; }
  }
  class HTMLElement {
    constructor() { this.nodeType = 1; this.tagName = "DIV"; }
  }
  class HTMLIFrameElement extends HTMLElement {
    constructor() { super(); this.tagName = "IFRAME"; }
  }
  // input[type=email|number|date|time]: select() is specified to do NOTHING.
  class NoOpSelectInput extends HTMLInputElement {
    select() { this.selects++; this.selectionStart = this.value.length; this.selectionEnd = this.value.length; }
  }
  // A page that patches select on the element the probe will call it on.
  class PatchedSelectInput extends HTMLInputElement {
    select() { this.paged++; }
    constructor(v) { super(v); this.paged = 0; }
  }
  class ThrowingSelectInput extends HTMLInputElement {
    select() { throw new Error("detached"); }
  }
  class ContentEditable extends HTMLElement {
    constructor(text) { super(); this.isContentEditable = true; this.textContent = text === undefined ? "" : text; }
  }
  let __rangeText = "";
  const __sel = {
    rangeCount: 0, ranges: [],
    removeAllRanges() { this.rangeCount = 0; this.ranges.length = 0; },
    addRange(r) { this.ranges.push(r); this.rangeCount = this.ranges.length; },
    getRangeAt() { return { toString() { return __rangeText; } }; },
  };
  const document = {
    body: { nodeType: 1 }, documentElement: { nodeType: 1 }, activeElement: null,
    createRange() { return { selectNodeContents(el) { __rangeText = el.textContent || ""; } }; },
    getSelection() { return __sel; },
  };
`;

/**
 * Run the shipped probe over an element built from `src` in the probe's own
 * realm. `patch` is optional realm-level source applied first (to break
 * something the page could break). Returns the verdict *and* the element, so a
 * test can assert what the probe did to it.
 */
function runProbe(src, doClear = false, patch = "") {
  const ctx = vm.createContext({});
  vm.runInContext(REALM, ctx);
  if (patch) vm.runInContext(patch, ctx);
  const active = vm.runInContext(`__active = (${src})`, ctx);
  // `document` is a lexical global of the realm, not a property of the context
  // object — it is assigned from inside, for the same reason the fixture is.
  vm.runInContext("document.activeElement = __active", ctx);
  const probe = vm.runInContext(`(${FOCUS_PROBE})`, ctx);
  return { result: probe.call(null, doClear), active, ctx };
}

test("a text field holding focus passes on both paths", () => {
  for (const doClear of [false, true]) {
    assert.equal(runProbe('new HTMLInputElement("hello")', doClear).result.ok, true, `clear=${doClear}`);
    assert.equal(runProbe('new HTMLTextAreaElement("hello")', doClear).result.ok, true, `clear=${doClear}`);
    assert.equal(runProbe('new ContentEditable("hello")', doClear).result.ok, true, `clear=${doClear}`);
  }
});

test("body and root are 'nobody is focused', and null is too", () => {
  assert.equal(runProbe("null").result.reason, "no-active-element");
  for (const [which, why] of [["body", "focus-on-body"], ["documentElement", "focus-on-root"]]) {
    const ctx = vm.createContext({});
    vm.runInContext(REALM, ctx);
    vm.runInContext(`document.activeElement = document.${which}`, ctx);
    assert.equal(vm.runInContext(`(${FOCUS_PROBE})`, ctx).call(null, true).reason, why);
  }
});

test("a clear selects the focused element's own contents, wherever it hangs in the tree", () => {
  // Sheets: the cell node is a <canvas>, the focus is a hidden input that is not
  // its descendant, so there is nowhere to walk to — `select()` works the same
  // wherever the element hangs, because it selects *that element's* contents.
  const { result, active } = runProbe('new HTMLInputElement("hello")', true);
  assert.equal(result.ok, true);
  assert.equal(active.selects, 1, "select() on the hidden input is the clear");
});

test("a clear with no chord means contenteditable is handled, not skipped", () => {
  // Google Docs: no `select()`, the text is in a contenteditable. A range over
  // the node's contents is the same operation by another route.
  const { result, ctx } = runProbe('new ContentEditable("hello")', true);
  assert.equal(result.ok, true);
  assert.equal(vm.runInContext("document.getSelection().rangeCount", ctx), 1);
});

test("no clear asked for, nothing is selected", () => {
  const { result, active } = runProbe('new HTMLInputElement("hello")', false);
  assert.equal(result.ok, true);
  assert.equal(active.selects, 0);
});

// ── the clear is confirmed, not inferred ────────────────────────────────────

test("a `select()` that silently did nothing refuses — email, number, date", () => {
  // HTMLInputElement.select() is specified to do nothing on a type it does not
  // apply to, and to do nothing rather than throw. Reporting success there is
  // the append bug with the refusal removed.
  assert.equal(runProbe('new NoOpSelectInput("a@b.com")', true).result.reason, "clear-select-noop");
});

test("a partial selection refuses, where a collapsed one was the whole test before", () => {
  // Finding 2. `selectionStart === selectionEnd` only catches the *no-op*. A
  // select() that covers some of the value clears some of it and leaves the
  // rest — the field the model asked to empty is now half-full and the text
  // appends after what is left.
  const src = `(function () {
    var el = new HTMLInputElement("hello");
    el.select = function () { this.selects++; this.selectionStart = 0; this.selectionEnd = 2; };
    return el;
  })()`;
  assert.equal(runProbe(src, true).result.reason, "clear-select-noop");
});

test("a `selectionStart` the type cannot answer refuses, rather than being read as 0", () => {
  // The getter is null on email/number/date/time. A `typeof === "number"`
  // guard is what makes null a refusal instead of a NaN comparison that
  // happens to pass.
  const src = `(function () {
    var el = new HTMLInputElement("hello");
    el.select = function () {};
    el.selectionStart = null; el.selectionEnd = null;
    return el;
  })()`;
  assert.equal(runProbe(src, true).result.reason, "clear-select-noop");
});

test("a real select over a value passes, because the selection actually moved", () => {
  assert.equal(runProbe('new HTMLInputElement("hello")', true).result.ok, true);
});

test("an empty field of a no-op type is not a failed clear — there is nothing to clear", () => {
  // Also the Sheets cell case: an empty cell's hidden editor holds no value, so
  // the strict check must not read a selection that the type cannot report.
  assert.equal(runProbe('new NoOpSelectInput("")', true).result.ok, true);
});

test("an empty contenteditable is not a failed clear", () => {
  assert.equal(runProbe('new ContentEditable("")', true).result.ok, true);
});

test("a contenteditable whose range never materialised refuses", () => {
  const silent = `document.getSelection = function () {
    return { rangeCount: 0, removeAllRanges() {}, addRange() {} };
  };`;
  assert.equal(runProbe('new ContentEditable("hello")', true, silent).result.reason, "clear-select-noop");
});

test("an element with neither `select()` nor contenteditable refuses, and types nothing", () => {
  // A <div> that took the click. Refusing is the point: insertText would append
  // to whatever text was already there, or go nowhere and still report success.
  assert.equal(runProbe("new HTMLElement()", true).result.reason, "clear-no-text-field");
});

test("the duck type is gone — a non-field with a `select()` method is still refused", () => {
  // `typeof a.select === "function"` was the old evidence, and any element can
  // carry a `select`. A div with one is not a text field.
  const src = `(function () {
    var el = new HTMLElement();
    el.value = "hello"; el.selects = 0;
    el.select = function () { this.selects++; this.selectionStart = 0; this.selectionEnd = 5; };
    return el;
  })()`;
  assert.equal(runProbe(src, true).result.reason, "clear-no-text-field");
  assert.equal(runProbe(src, false).result.reason, "focus-no-text-field");
});

test("a `select()` that throws refuses rather than reporting a clear that did not happen", () => {
  assert.equal(runProbe('new ThrowingSelectInput("hello")', true).result.reason, "clear-threw");
});

// ── the no-clear path must not report a typed-into-nowhere success ───────────

test("a focused <iframe> refuses on both paths, rather than typing into the frame", () => {
  // Finding 3. `Input.insertText` against a focused iframe lands in *that*
  // document — which no observation in this run covered, and which the user is
  // not looking at.
  for (const doClear of [false, true]) {
    assert.equal(runProbe("new HTMLIFrameElement()", doClear).result.reason, "focus-on-frame");
  }
});

test("a focused element that cannot receive text refuses on the no-clear path", () => {
  // The old answer was `{ok: true}` for *anything* focused, so a <div> that
  // took the click reported a successful type into nothing.
  assert.equal(runProbe("new HTMLElement()", false).result.reason, "focus-no-text-field");
});

test("the two paths share one predicate, so they cannot disagree about what a text field is", () => {
  const field = 'new HTMLInputElement("hello")';
  assert.equal(runProbe(field, false).result.ok, runProbe(field, true).result.ok);
  const notField = "new HTMLElement()";
  assert.equal(runProbe(notField, false).result.ok, runProbe(notField, true).result.ok);
  assert.match(extractTemplate(ptrSrc, "FOCUS_PROBE"), /var field = a instanceof HTMLInputElement/);
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

function loadFocusState(handler, log = []) {
  const anyCommand = async (tabId, command) => {
    log.push(command);
    // The world has to exist before the probe can be evaluated in it; these are
    // the plumbing calls, not answers.
    if (command.method === "Page.getFrameTree") return { frameTree: { frame: { id: "F" } } };
    if (command.method === "Page.createIsolatedWorld") return { executionContextId: 77 };
    return handler(command);
  };
  const shipped = extractFn(ptrSrc, "focusState").replace(/^export\s+/, "");
  // `withWorld` too: it is what makes a cached context id self-correcting, and
  // stubbing it away here would leave `focusState` unevaluated.
  const plumbing = ["topFrameId", "isolatedWorld", "withWorld"]
    .map((n) => extractFn(ptrSrc, n).replace(/^export\s+/, "")).join("\n");
  const cache = "const worldIds = new Map();\n";
  const src = `${cache}\nconst IDLE_WORLD = "brotto-idle";\n${plumbing}\nreturn ${shipped}`;
  return new Function("anyCommand", "FOCUS_PROBE", src)(anyCommand, FOCUS_PROBE);
}

/** The fake CDP session for `bindFocus`: named commands, a real-ish protocol
 *  shape, so a wall that stops being called is a *missing answer*, not a
 *  function that quietly passes. The world's plumbing has real answers too,
 *  because `bindFocus` resolves its nodes into it. */
const PLUMBING = {
  "Page.getFrameTree": { frameTree: { frame: { id: "F" } } },
  "Page.createIsolatedWorld": { executionContextId: 9 },
  "Page.getLayoutMetrics": { cssLayoutViewport: { clientWidth: 1000, clientHeight: 800 } },
};

/** The engine's answers to "name the focused node", in the shape the shipped
 *  `focusNode` asks for: an isolated-world read of `document.activeElement`,
 *  then the engine's own description of the node that read points at.
 *  `DOM.getFocusNode` is not in it — Chrome removed that method, and asking
 *  for it is what made every `type_at` refuse. */
function focusAnswers(overrides = {}) {
  return {
    "DOM.enable": {},
    "Runtime.evaluate": { result: { objectId: "focus-obj" } },
    "DOM.describeNode": { node: { backendNodeId: 77, nodeName: "DIV" } },
    ...overrides,
  };
}

function engine(answers = {}) {
  const calls = [];
  const table = { ...PLUMBING, ...answers };
  const anyCommand = async (_tabId, command) => {
    calls.push(command);
    if (!(command.method in table)) throw new Error(`unexpected CDP call: ${command.method}`);
    const answer = table[command.method];
    return typeof answer === "function" ? answer(command) : answer;
  };
  return { anyCommand, calls, methods: () => calls.map((c) => c.method) };
}

/** The shipped `bindFocus`, with the shipped `focusNode`/`isolatedWorld`/`box`
 *  around it — a test that stubs them away would not be testing the walls. */
function loadBindFocus(fx) {
  const shipped = extractFn(ptrSrc, "bindFocus").replace(/^export\s+/, "");
  const body = ["focusNode", "isolatedWorld", "withWorld", "topFrameId", "box", "liveViewport", "gridAdapter", "gridApp", "pathMatches"]
    .map((n) => extractFn(ptrSrc, n).replace(/^export\s+/, ""))
    .join("\n");
  const prelude = 'const IDLE_WORLD = "brotto-idle";\nconst worldIds = new Map();\n' +
    'const TEXT_INPUT_TAGS = new Set(["INPUT", "TEXTAREA"]);\n' + GRID_ADAPTERS_SRC + "\n";
  return new Function("anyCommand", "IDENTITY_PROBE", `${prelude}${body}\nreturn ${shipped}`)(
    fx.anyCommand,
    IDENTITY_PROBE,
  );
}

/** Runs the identity probe with `this` = the pressed node. */
function runIdentity(pressed, focus) {
  const fn = vm.runInNewContext(`(${IDENTITY_PROBE})`, {});
  return fn.call(pressed, focus);
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

test("the probe runs in an isolated world, never the page's own", async () => {
  // Finding 2. `Runtime.evaluate` with no `contextId` runs in the page's main
  // world, where the page owns both `document.activeElement` and
  // `Element.prototype.select` — it can answer the question falsely *and* change
  // what the answer does. The context id is what makes the probe unshadowable.
  const seen = [];
  const focusState = loadFocusState(async () => ({ result: { value: { ok: true, reason: "" } } }), seen);
  await focusState(1, true);
  const evaluate = seen.find((c) => c.method === "Runtime.evaluate");
  assert.equal(evaluate.params.contextId, 77, "the probe is evaluated in the isolated world");
  assert.ok(seen.some((c) => c.method === "Page.createIsolatedWorld"),
    "the world must be created, not assumed");
  const created = seen.find((c) => c.method === "Page.createIsolatedWorld");
  assert.equal(created.params.worldName, "brotto-idle");
  assert.equal(created.params.grantUniveralAccess, false,
    "an isolated world must not be granted access to the page's objects");
});

test("the world is created once per tab and reused", async () => {
  let worlds = 0;
  const anyCommand = async (_t, command) => {
    if (command.method === "Page.getFrameTree") return { frameTree: { frame: { id: "F" } } };
    if (command.method === "Page.createIsolatedWorld") { worlds++; return { executionContextId: 5 }; }
    return { result: { value: { ok: true, reason: "" } } };
  };
  const shipped = extractFn(ptrSrc, "focusState").replace(/^export\s+/, "");
  // Fresh module state per load, so the cache is exercised from empty.
  const focusState = new Function("anyCommand", "FOCUS_PROBE",
    'const worldIds = new Map();\nconst IDLE_WORLD = "brotto-idle";\n' +
    ["topFrameId", "isolatedWorld", "withWorld"].map((n) => extractFn(ptrSrc, n).replace(/^export\s+/, "")).join("\n") + `\nreturn ${shipped}`)(anyCommand, FOCUS_PROBE);
  await focusState(1, true);
  await focusState(1, true);
  assert.equal(worlds, 1, "one createIsolatedWorld per tab, not one per clear");
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
// ── the identity wall ────────────────────────────────────────────────────────
//
// Finding 1: the probe proved only that *something* held focus, so `select()`
// ran against whatever `activeElement` happened to be. These are the tests
// that say who it must be.

test("the branch binds focus between the press and the text, and refuses when it cannot", async () => {
  const branch = extractBranch('t === "type_at"');
  assert.ok(branch.indexOf("bindFocus(") > branch.indexOf("pressAt(")
    && branch.indexOf("bindFocus(") < branch.indexOf("focusState("),
    "identity is proved after the press (which moves focus) and before anything reads it");
  const { result, sent } = await run(AT, { bind: async () => ({ ok: false, reason: "focus-not-the-target" }) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "focus-not-the-target");
  assert.equal(sent.filter((c) => c.method === "Input.insertText").length, 0,
    "an unbound focus types nothing and clears nothing");
  assert.equal(sent.filter((c) => c.method === "Input.dispatchMouseEvent").length, 2,
    "the press still happened — it is what moved focus");
});

test("the focused node is named by the engine, not by script in the page", async () => {
  // `DOM.getFocusNode` was removed from Chrome, so the read is done in the
  // isolated world — where the page cannot redefine `document.activeElement` —
  // and the node is named by the engine. Reading it in the page's own world
  // would ask the page a question it may answer falsely.
  const fx = engine(focusAnswers({
    "DOM.describeNode": { node: { backendNodeId: 99, nodeName: "INPUT" } },
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "Runtime.callFunctionOn": { result: { value: { ok: true, reason: "same-node", tag: "CANVAS" } } },
  }));
  const ok = await loadBindFocus(fx)(1, 99);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const read = fx.calls.find((c) => c.method === "Runtime.evaluate");
  assert.ok(read, "the focused node is read at all");
  assert.equal(read.params.expression, "document.activeElement");
  assert.equal(read.params.contextId, 9, "read in the isolated world, not the page's own");
  const described = fx.calls.find((c) => c.method === "DOM.describeNode");
  assert.equal(described.params.objectId, "focus-obj", "the engine names the node that was read");
  assert.ok(!fx.methods().includes("DOM.getFocusNode"),
    "that method no longer exists in Chrome, and asking for it is what refused every type_at");
});

test("an engine that will not name the focused node refuses — it is never inferred", async () => {
  for (const answers of [
    { "DOM.enable": {}, "Runtime.evaluate": { result: {} } },        // no object id
    { "DOM.enable": {}, "Runtime.evaluate": { result: { objectId: "o" } }, "DOM.describeNode": { node: {} } },
    { "DOM.enable": {} },                                            // the read throws
  ]) {
    const fx = engine(answers);
    const r = await loadBindFocus(fx)(1, 99);
    assert.ok(!r.ok || r.reason === "focus-not-the-target", `got ${JSON.stringify(r)}`);
    if (!r.ok) assert.equal(r.reason, "focus-identify-failed", JSON.stringify(r));
  }
});

test("a clear with no backendNodeId to bind to refuses", async () => {
  const fx = engine({});
  const r = await loadBindFocus(fx)(1, undefined, 10, 10);
  assert.deepEqual(r, { ok: false, reason: "focus-unidentified" });
  assert.deepEqual(fx.calls, [], "it refuses before spending a CDP call");
});

// ── the containment allowance ───────────────────────────────────────────────

test("the same node passes", async () => {
  const el = { nodeType: 1, tagName: "INPUT", contains: () => false };
  const r = runIdentity(el, el);
  assert.equal(r.ok, true);
  assert.equal(r.reason, "same-node");
});

test("focus on a descendant of what was pressed passes — a label, a wrapper, a span", () => {
  // The ordinary case an equality test throws away: the model pressed a
  // `<label>`, the browser focused the `<input>` inside it.
  const input = { nodeType: 1 };
  const label = { nodeType: 1, tagName: "LABEL", contains: (n) => n === input };
  const r = runIdentity(label, input);
  assert.equal(r.ok, true);
  assert.equal(r.reason, "focus-inside-target");
});

test("focus on an ancestor of what was pressed does NOT pass", () => {
  // The direction is load-bearing: a hit on a descendant is a hit on the
  // element, a hit on an ancestor is not.
  const wrapper = { nodeType: 1, tagName: "DIV", contains: () => true };
  const inner = { nodeType: 1, tagName: "INPUT" };
  assert.equal(runIdentity(inner, wrapper).ok, false);
});

test("focus the browser retargeted to the pressed node's shadow host passes", () => {
  // A press inside an open shadow root: `elementFromPoint` resolves to the
  // host, and the browser retargets focus back to the host. Ordinary
  // `contains()` misses this — the host *contains* what was pressed.
  const host = { nodeType: 1, tagName: "MY-WIDGET", contains: () => false };
  const inner = { nodeType: 1, tagName: "INPUT", contains: () => false, getRootNode: () => ({ host }) };
  const r = runIdentity(inner, host);
  assert.equal(r.ok, true);
  assert.equal(r.reason, "focus-retargeted-to-host");
});

test("an unrelated focused node refuses, with the tag of the pressed node for the exemption", async () => {
  const fx = engine(focusAnswers({
    "DOM.describeNode": { node: { backendNodeId: 99, nodeName: "INPUT" } },
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "Runtime.callFunctionOn": { result: { value: { ok: false, reason: "not-the-target", tag: "BUTTON" } } },
  }));
  const r = await loadBindFocus(fx)(1, 99);
  assert.deepEqual(r, { ok: false, reason: "focus-not-the-target" });
});

// ── the canvas exemption ────────────────────────────────────────────────────

/** The one shape identity cannot serve: a <canvas> grid whose press focuses an
 *  editor that is neither the cell nor inside it. */
function canvasShape({ tag = "CANVAS", focusTag = "TEXTAREA", focusEditable = false, inner, outer, viewport,
  origin = "", path = "", focusScope = "", focusClass = "" } = {}) {
  const answers = focusAnswers({
    "DOM.describeNode": { node: { backendNodeId: 77, nodeName: focusTag } },
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "Runtime.callFunctionOn": { result: { value: { ok: false, reason: "not-the-target", tag, focusTag, focusEditable, origin, path, focusScope, focusClass } } },
    "DOM.getBoxModel": ({ params }) => (params.backendNodeId === 77 ? { model: { quads: [inner] } } : { model: { quads: [outer] } }),
  });
  if (viewport === "throw") answers["Page.getLayoutMetrics"] = () => { throw new Error("no target"); };
  return loadBindFocus(engine(answers));
}

const QUAD = (x, y, w, h) => [x, y, x + w, y, x + w, y + h, x, y + h];

test("a canvas cell whose press focuses an editor inside it is exempt, and says so", async () => {
  const bind = canvasShape({ inner: QUAD(10, 10, 40, 12), outer: QUAD(0, 0, 400, 300) });
  const r = await bind(1, 42);
  assert.deepEqual(r, { ok: true, reason: "canvas-editor-exempt", focusId: 77, grid: false, gridEditor: false },
    "the exemption is reported, never silently asserted as identity");
});

test("a press on a canvas cannot clear a visible field somewhere else on the page", async () => {
  // The defeat finding 1 describes. The editor's box is nowhere near the canvas,
  // so the containment fails and the clear refuses. No attribute is consulted —
  // `aria-hidden` on the user's own input cannot unlock the exemption.
  const bind = canvasShape({ inner: QUAD(600, 700, 200, 24), outer: QUAD(0, 0, 400, 300) });
  const r = await bind(1, 42);
  assert.deepEqual(r, { ok: false, reason: "focus-not-the-target" });
});

test("the exemption is canvas-only", async () => {
  const bind = canvasShape({ tag: "DIV", inner: QUAD(10, 10, 40, 12), outer: QUAD(0, 0, 400, 300) });
  assert.equal((await bind(1, 42)).reason, "focus-not-the-target");
});

test("the exemption is text-input-only", async () => {
  const bind = canvasShape({ focusTag: "DIV", inner: QUAD(10, 10, 40, 12), outer: QUAD(0, 0, 400, 300) });
  assert.equal((await bind(1, 42)).reason, "focus-not-the-target");
});

test("an editor with no rendered box does not qualify", async () => {
  const fx = engine(focusAnswers({
    "DOM.describeNode": { node: { backendNodeId: 77, nodeName: "TEXTAREA" } },
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "Runtime.callFunctionOn": { result: { value: { ok: false, reason: "not-the-target", tag: "CANVAS" } } },
    "DOM.getBoxModel": { model: { quads: [QUAD(10, 10, 40, 12)] } },
  }));
  // Only the canvas answers with a box; the editor has none.
  const bind = loadBindFocus({ ...fx, anyCommand: async (t, c) => (c.method === "DOM.getBoxModel" && c.params.backendNodeId === 77
    ? (() => { throw new Error("not rendered"); })() : fx.anyCommand(t, c)) });
  assert.equal((await bind(1, 42)).reason, "focus-not-the-target");
});

// ── the grid editor ──────────────────────────────────────────────────────────
//
// The second canvas shape: a grid that keeps its editor *outside* the canvas.
// Google Sheets' cell editor is `DIV#waffle-rich-text-editor.cell-input
// [contenteditable=true]` — a direct child of BODY, zero-width, parked at
// y = -9998 — so it is neither the pressed node nor inside it, and it is not
// an INPUT either. The one shape identity cannot serve and wall 3 cannot
// serve, and the run that reported it typed nothing at all.
//
// **The shape is not the permission.** A canvas, a click listener and a hidden
// input parked off-screen is a shape any page can build, and the old wall
// admitted it on the strength of geometry alone: the agent then typed into a
// field the user cannot see, believing it had typed into the cell under the
// cursor. So the exemption is granted to a *recognised application* — the
// origin the document is served from (which a page cannot forge) plus the
// editor that application is known to write.

test("a canvas grid whose editor is parked off-screen is admitted, and says so", async () => {
  const bind = canvasShape({
    focusTag: "DIV", focusEditable: true, ...SHEETS,
    inner: QUAD(4, -9998, 0, 30), outer: QUAD(0, 142, 1388, 620),
  });
  const r = await bind(1, 42, 300, 200);
  assert.deepEqual(r, { ok: true, reason: "canvas-grid-editor", focusId: 77, grid: true, gridEditor: true },
    "the grid editor is admitted, and the allowance is reported");
});

test("a canvas grid whose editor is drawn over the clicked cell is admitted", async () => {
  const bind = canvasShape({
    focusTag: "DIV", focusEditable: true, ...SHEETS,
    inner: QUAD(280, 190, 100, 24), outer: QUAD(0, 142, 1388, 620),
  });
  assert.deepEqual(await bind(1, 42, 300, 200),
    { ok: true, reason: "canvas-grid-editor", focusId: 77, grid: true, gridEditor: true });
});

// ── the grid wall is granted to an application, not to a shape ───────────────

test("a canvas press that focuses a hidden field on an unrecognised page is refused", async () => {
  // The defeat the security review names. A hostile page renders a canvas,
  // listens for the click, and focuses an off-screen input; the agent then
  // types into a field the user cannot see, believing it typed into the cell.
  // The shape is identical to a spreadsheet's, so the shape cannot decide.
  const bind = canvasShape({
    focusTag: "DIV", focusEditable: true,
    origin: "https://attacker.example", focusScope: "grid-editor", focusClass: "cell-input",
    inner: QUAD(4, -9998, 0, 30), outer: QUAD(0, 142, 1388, 620),
  });
  assert.deepEqual(await bind(1, 42, 300, 200),
    { ok: false, reason: "grid-editor-unrecognised" });
});

test("the page's own attributes cannot unlock the wall on another origin", async () => {
  // The editor wears the app's own id and class, on the page's own origin.
  // The origin is the part a page cannot forge, so this is refused.
  const bind = canvasShape({
    focusTag: "DIV", focusEditable: true,
    ...SHEETS, origin: "https://attacker.example",
    inner: QUAD(4, -9998, 0, 30), outer: QUAD(0, 142, 1388, 620),
  });
  assert.deepEqual(await bind(1, 42, 300, 200),
    { ok: false, reason: "grid-editor-unrecognised" });
});

test("the app's origin alone does not unlock the wall — the editor must be the app's too", async () => {
  const bind = canvasShape({
    focusTag: "DIV", focusEditable: true,
    origin: SHEETS.origin, focusScope: "some-other-editor", focusClass: "cell-input",
    inner: QUAD(4, -9998, 0, 30), outer: QUAD(0, 142, 1388, 620),
  });
  assert.deepEqual(await bind(1, 42, 300, 200),
    { ok: false, reason: "grid-editor-unrecognised" });
});

test("the wall needs an editable — the app's own editor, but not editable, is refused", async () => {
  const bind = canvasShape({
    focusTag: "DIV", focusEditable: false, ...SHEETS,
    inner: QUAD(4, -9998, 0, 30), outer: QUAD(0, 142, 1388, 620),
  });
  assert.equal((await bind(1, 42, 300, 200)).reason, "focus-not-the-target");
});

test("a visible field elsewhere on the page is still refused — the grid wall is not a hole", async () => {
  // The defeat: a grid editor is admitted, and now *any* focused editable
  // qualifies. A visible field of the user's own, somewhere else on the page,
  // satisfies none of the three ways in — and typing into it is the
  // "erase some other field" failure.
  const bind = canvasShape({
    focusTag: "DIV", focusEditable: true, ...SHEETS,
    inner: QUAD(600, 700, 200, 24), outer: QUAD(0, 142, 1388, 620),
  });
  assert.deepEqual(await bind(1, 42, 300, 200), { ok: false, reason: "focus-not-the-target" });
});

test("the grid wall is canvas-only", async () => {
  const bind = canvasShape({
    tag: "DIV", focusTag: "DIV", focusEditable: true, ...SHEETS,
    inner: QUAD(4, -9998, 0, 30), outer: QUAD(0, 142, 1388, 620),
  });
  assert.equal((await bind(1, 42, 300, 200)).reason, "focus-not-the-target");
});

test("a viewport that cannot be read proves nothing, so the grid wall fails closed", async () => {
  const bind = canvasShape({
    focusTag: "DIV", focusEditable: true, viewport: "throw", ...SHEETS,
    inner: QUAD(600, 700, 200, 24), outer: QUAD(0, 142, 1388, 620),
  });
  assert.equal((await bind(1, 42, 300, 200)).reason, "focus-not-the-target");
});

test("the grid wall is granted to an application, and the application is named in the source", () => {
  const src = extractFn(ptrSrc, "bindFocus");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.match(code, /gridAdapter\(v\)/,
    "the wall must consult the adapter, not the geometry alone");
  assert.match(code, /v\.focusEditable === true/,
    "editability is the DOM property, read in the isolated world");
  assert.match(extractFn(ptrSrc, "box"), /DOM\.getBoxModel/,
    "the geometry is the engine's, not the page's");
  // The origin is the unforgeable half, and it is read from the document.
  const probe = extractTemplate(ptrSrc, "IDENTITY_PROBE");
  assert.match(probe, /location\.origin/,
    "the app is identified by the document's own origin");
  // And the adapter list names an origin for every entry — an adapter with no
  // origin would be a shape rule wearing an adapter's clothes.
  const adapters = vm.runInNewContext(`${GRID_ADAPTERS_SRC}; GRID_ADAPTERS`);
  assert.ok(adapters.length > 0, "there must be at least one recognised grid");
  for (const a of adapters) {
    assert.match(a.origin, /^https:\/\//, `${a.app} must name an origin`);
    assert.ok(a.scopeId && a.className, `${a.app} must name the editor it writes into`);
  }
});

test("the exemption is stated in the source, so the rule is not just a test", () => {
  const src = extractFn(ptrSrc, "bindFocus");
  assert.match(src, /v\.tag === "CANVAS"/, "the pressed node must be a canvas");
  assert.match(src, /TEXT_INPUT_TAGS\.has\(focus\.nodeName\)/, "the focused node must be a text input");
  assert.match(src, /inner\.minX >= outer\.minX/, "the editor must lie inside the canvas box");
  assert.match(extractFn(ptrSrc, "box"), /DOM\.getBoxModel/,
    "both boxes come from the engine, not from page attributes");
  assert.doesNotMatch(src, /getAttribute|aria-hidden/, "a page-written attribute must not unlock the exemption");
});

test("the refusal vocabulary is closed, and lives in one place", () => {
  // TYPE_AT_REFUSALS is the list a reader needs; these three assertions are
  // what keep it true. Every reason emitted must be in it, every entry in it
  // must be emitted somewhere, and every entry must say what it means.
  const list = ptrSrc.slice(ptrSrc.indexOf("export const TYPE_AT_REFUSALS"));
  for (const m of list.matchAll(/^  "([a-z0-9-]+)": "([^"]*)"/gm)) {
    assert.ok(m[2].length > 10, `${m[1]} must carry a meaning, not a restatement`);
  }
  const declared = new Set([...list.matchAll(/^  "([a-z0-9-]+)":/gm)].map((m) => m[1]));
  for (const r of ["no-active-element", "focus-on-body", "focus-on-root", "focus-on-frame",
    "focus-no-text-field", "clear-select-noop", "clear-no-text-field", "clear-threw",
    "focus-probe-failed", "focus-probe-silent", "focus-unidentified", "focus-identify-failed",
    "focus-not-the-target", "point-out-of-viewport", "point-not-numeric", "target-gone",
    "target-unresolvable", "probe-silent", "probe-failed", "canvas-grid-editor",
    "grid-editor-unrecognised", "focus-changed", "grid-text-not-delivered",
    "grid-text-misdelivered", "canvas-text-too-long"]) {
    assert.ok(declared.has(r), `${r} must be documented in TYPE_AT_REFUSALS`);
  }
  // Nothing on the `type_at` path may emit a reason the list does not name.
  // `different-element:<tag>` is the one prefixed form — a hit-test verdict
  // whose detail is a tag. The scan is over this action's surfaces only; the
  // cursor draw has its own (`foreign-frame`, `no-body`) and is not a refusal.
  const surfaces = [FOCUS_PROBE, IDENTITY_PROBE, extractTemplate(ptrSrc, "TARGET_PROBE"),
    gridFocusProbe(), gridDeliveryProbe(),
    extractFn(ptrSrc, "verifyTarget"), extractFn(ptrSrc, "bindFocus"), extractFn(ptrSrc, "focusState"),
    extractFn(ptrSrc, "reassertGridFocus"), extractFn(ptrSrc, "gridDelivery"),
    extractBranch('t === "type_at"'), extractFn(bgSrc, "pressAt"), extractFn(bgSrc, "typeIntoCanvas")];
  for (const src of surfaces) {
    for (const m of src.matchAll(/reason:\s*"([a-z0-9:-]+)"/g)) {
      const name = m[1].split(":")[0];
      if (name === "different-element") continue;
      assert.ok(declared.has(name), `"${m[1]}" is emitted but not documented`);
    }
  }
  // ...and every declared entry is emitted by *some* surface, so the list
  // cannot grow a reason nothing produces — which is how a vocabulary grows a
  // name that reads like a refusal and is not one.
  //
  // **Positioned on a `reason`, not as a bare substring.** The old check was
  // `emitted.includes(`"${name}"`)`, which a mere mention satisfies: a name
  // quoted in a comment or a console message counts as emitted, so a key that
  // nothing returns passes. That is the whole defect — a guard that cannot
  // fail. Comments are stripped first, then the name must appear on a line that
  // is producing a reason, which admits the two forms the code actually uses:
  // `reason: "x"` and `reason: doClear ? "a" : "b"` (and, in
  // `bindFocus`, `String(v.reason ?? "identity-verified")`).
  const emitted = surfaces
    .map((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))
    .join("\n");
  for (const name of declared) {
    assert.ok(new RegExp(`reason[^\\n]*"${name}"`).test(emitted),
      `${name} is documented but nothing returns it`);
  }

  // The prose block and the map are two renderings of one vocabulary, and only
  // the map is parsed above — so a key edited into one and not the other read
  // clean. The prose may document a strict subset (the other names are written
  // up at their own call sites), but it may not name a key the map lacks.
  const docStart = ptrSrc.indexOf("/**\n * **Every reason `type_at` can refuse");
  const docBlock = ptrSrc.slice(docStart, ptrSrc.indexOf("export const TYPE_AT_REFUSALS"));
  for (const m of docBlock.matchAll(/^ \*   ([a-z0-9:-]+)\s/gm)) {
    assert.ok(declared.has(m[1]),
      `the refusal prose documents "${m[1]}" but TYPE_AT_REFUSALS does not carry it`);
  }
});

test("the numeric guard in verifyTarget refuses, and is the only emitter of point-not-numeric", async () => {
  // `point-not-numeric` is emitted here, not by `background.ts`: every
  // coordinate that reaches `pressAt` from `type_at` / `click_xy` has been
  // through `boundedPoint` (which refuses a non-number as
  // `point-out-of-viewport`), but `click_ref` hands `verifyTarget` the
  // *server's* raw x/y, which nothing has bounded. Deleting the key from the
  // vocabulary because "nothing emits it any more" would have left a live
  // refusal reaching the model's history and the audit document unnamed — and
  // deleting the guard instead would have let a string coordinate reach
  // `Math.round` and then `Input.dispatchMouseEvent`. Both directions are
  // pinned here: it is emitted, and it fails closed.
  const src = extractFn(ptrSrc, "verifyTarget");
  assert.match(src, /reason: "point-not-numeric"/, "the guard must refuse, not fall through to a stale read");
  const verifyTarget = new Function("anyCommand", "return " +
    extractFn(ptrSrc, "verifyTarget").replace(/^export\s+/, ""))(
      async () => { throw new Error("must not resolve a node"); });
  for (const [x, y] of [["10", 20], [10, null], [NaN, 5], [Infinity, 5]]) {
    const r = await verifyTarget(1, 42, x, y);
    assert.equal(r.ok, false, `(${String(x)},${String(y)}) must not verify`);
    assert.equal(r.reason, "point-not-numeric");
  }
  // An absent id is still the deliberate pass-through — a relay too old to
  // carry one — and it is NOT the same refusal. Collapsing the two is the bug
  // `credentialState`'s three states exist to prevent.
  assert.deepEqual(await verifyTarget(1, undefined, 10, 20), { ok: true, reason: "no-backend-id" });
});

// ── the grid page: the cell is typed, whichever field holds the focus ─────────
//
// The reported loss. The model named the *formula bar* — a contenteditable of
// its own, in a scope of its own — so the press was ordinary and the write took
// the ordinary path: one `Input.insertText`, which fires no keydown. The grid's
// model never heard it, the Enter that followed had nothing to commit, and the
// run reported itself done. The press was never the problem; the delivery
// mechanism was.

test("a grid page types as keystrokes even when the focus is the formula bar", async () => {
  const { result, sent } = await run({ ...AT, text: "name" }, { bind: GRID_FIELD_BIND });
  assert.equal(result.ok, true, `refused: ${result.reason}`);
  assert.equal(sent.filter((c) => c.method === "Input.insertText").length, 0,
    "an insertion fires no keydown, so the cell would show a caret with nothing in it");
  assert.equal(sent.filter((c) => c.method === "Input.dispatchKeyEvent").length, 8,
    "one keyDown and one keyUp per character");
  // The press still happens where the model aimed it.
  assert.equal(sent[0].method, "Input.dispatchMouseEvent");
  assert.equal(sent[1].params.type, "mouseReleased");
});

test("the grid page's write that did not land refuses, and is not reported done", async () => {
  const { result } = await run({ ...AT, text: "name" }, {
    bind: GRID_FIELD_BIND,
    editorText: async () => ({ ok: true, text: "" }),   // the editor never changed
    focusNode: async () => ({ ok: true, backendNodeId: 42 }),
  });
  assert.deepEqual(result, { ok: false, reason: "grid-text-not-delivered" });
});

test("off a grid, the ordinary path still types by one insertion", async () => {
  const { result, sent } = await run({ ...AT, text: "hello" });
  assert.equal(result.ok, true);
  assert.equal(sent.filter((c) => c.method === "Input.insertText").length, 1,
    "a README is 1325 characters and one insertion is the whole point");
  assert.equal(sent.filter((c) => c.method === "Input.dispatchKeyEvent").length, 0);
});

test("the grid page's keystrokes never take the focus from the field being typed into", async () => {
  // The name box is a real input the model writes a *reference* into and then
  // jumps on. Re-asserting the grid's cell editor here would type the reference
  // into a cell instead, and the jump would break.
  let reasserts = 0;
  await run({ ...AT, text: "B2" }, {
    bind: GRID_FIELD_BIND,
    reassert: async () => { reasserts++; return { ok: true, reason: "" }; },
  });
  assert.equal(reasserts, 0, "the focus is the model's to keep; nothing may take it");
});

test("the grid's own cell editor is re-asserted before every character", async () => {
  let reasserts = 0;
  await run({ ...AT, text: "ab" }, {
    bind: GRID_BIND,
    reassert: async () => { reasserts++; return { ok: true, reason: "" }; },
  });
  assert.equal(reasserts, 2, "one binding re-made per character");
});

// ── the application, not the origin ────────────────────────────────────────
//
// The grant is to an *application*, not a shape and not an address. One origin
// serves Google Docs, Drive and Sheets alike, so matching on `location.origin`
// alone admitted the Docs comment box and the Drive rename field to the grid's
// keystroke path: the whole of Drive, per keystroke, from a single adapter row.
// The pathname is read in the same unforgeable isolated world as the origin and
// is what names the application.

/** The real `bindFocus`, on a recognised grid, with the focus somewhere the
 *  model chose — override SHEETS to move it off the app's own cell editor. */
function gridShape(identity = {}) {
  const fx = engine(focusAnswers({
    "DOM.describeNode": { node: { backendNodeId: 77, nodeName: "DIV" } },
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "Runtime.callFunctionOn": { result: { value: {
      ok: true, reason: "same-node", tag: "DIV", focusTag: "DIV",
      focusEditable: true, ...SHEETS, ...identity } } },
  }));
  return loadBindFocus(fx)(1, 42);
}

test("the app's own cell editor is the grid AND the editor", async () => {
  const r = await gridShape();
  assert.equal(r.grid, true, JSON.stringify(r));
  assert.equal(r.gridEditor, true, JSON.stringify(r));
});

test("the formula bar is the grid but NOT the editor", async () => {
  // Same origin, same app, same path — a different field. The keystroke
  // delivery is still right (the grid starts editing on a keystroke), but the
  // focus is a real field the model wrote a value into and must keep.
  const r = await gridShape({ focusScope: "", focusClass: "" });
  assert.equal(r.grid, true, JSON.stringify(r));
  assert.equal(r.gridEditor, false, JSON.stringify(r));
});

/** The shipped `gridApp`, with the adapter list supplied by the test. */
function gridAppWith(adapters) {
  const src = extractFn(ptrSrc, "gridApp").replace(/^export\s+/, "");
  const pm = new Function(`${extractFn(ptrSrc, "pathMatches")}\nreturn pathMatches;`)();
  return new Function("GRID_ADAPTERS", "pathMatches", `${src}\nreturn gridApp;`)(adapters, pm);
}

test("a path on the right origin is not the application", async () => {
  // The shipped adapter list itself, not a copy of it.
  const app = gridAppWith(vm.runInNewContext(`(${GRID_ADAPTERS_SRC.replace(/^const GRID_ADAPTERS = /, "").replace(/;\s*$/, "")})`, {}));
  assert.ok(app(SHEETS.origin, "/document/d/1/edit") === null, "Google Docs on the Sheets origin is not Sheets");
  assert.ok(app(SHEETS.origin, "/drive/folders/1") === null, "and neither is Drive");
  assert.ok(app(SHEETS.origin, SHEETS.path) !== null, "the path the app is served under is the app");
  assert.ok(app("https://example.com", SHEETS.path) === null, "the path does not carry an origin that is wrong");
});

test("two adapters for one origin are ambiguous, and are refused", async () => {
  const twin = gridAppWith([
    { app: "one", origin: "https://docs.google.com", pathPrefix: "/spreadsheets/", scopeId: "a", className: "a" },
    { app: "two", origin: "https://docs.google.com", pathPrefix: "/documents/", scopeId: "b", className: "b" },
  ]);
  assert.equal(twin("https://docs.google.com", "/spreadsheets/d/1/edit"), null,
    "guessing which of two is which is how a grant widens by accident");
});

test("a Docs field on the Sheets origin never reaches the keystroke path", async () => {
  const r = await gridShape({ path: "/document/d/1/edit" });
  assert.equal(r.grid, false, `a Drive rename field must not be typed as a grid cell: ${JSON.stringify(r)}`);
  assert.equal(r.gridEditor, false);
});

test("off the application, the write is an ordinary insertion again", async () => {
  const { sent } = await run({ ...AT, text: "name" }, { bind: () => gridShape({ path: "/document/d/1/edit" }) });
  assert.equal(sent.filter((c) => c.method === "Input.insertText").length, 1,
    "the whole of Drive is not typed one keystroke at a time");
  assert.equal(sent.filter((c) => c.method === "Input.dispatchKeyEvent").length, 0);
});

test("a grid write that is not the cell editor still clears", async () => {
  // Defect: the grid branch never asked the page to select-all, so `type_text`
  // — documented "clears first" — typed `42` into a cell holding `17` and left
  // `1742`. Only the app's own editor keeps the no-clear behaviour: there the
  // first keystroke genuinely replaces what is there.
  const { result, state } = await run({ ...AT, text: "42", clear: true }, { bind: GRID_FIELD_BIND });
  assert.equal(result.ok, true, `refused: ${result.reason}`);
  assert.deepEqual(state.focusClears, [true], "the page was asked to select-all before the write");
});

test("the app's own cell editor is not cleared — its first keystroke replaces", async () => {
  const { result, state } = await run({ ...AT, text: "42", clear: true }, { bind: GRID_BIND });
  assert.equal(result.ok, true, `refused: ${result.reason}`);
  assert.deepEqual(state.focusClears, [], "clearing a grid editor appends nothing and erases nothing else");
});
