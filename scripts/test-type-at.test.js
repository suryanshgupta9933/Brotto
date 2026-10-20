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
const IDENTITY_PROBE = extractTemplate(ptrSrc, "IDENTITY_PROBE");

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
    boundedPoint: opts.point ?? (async (_t, x, y) => ({ x: Math.round(x), y: Math.round(y) })),
    verifyTarget: opts.verify ?? (async () => ({ ok: true, reason: "" })),
    bindFocus: opts.bind ?? (async () => ({ ok: true, reason: "same-node" })),
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

test("the branch never dispatches a key, so it can never need to know the OS", () => {
  const branch = extractBranch('t === "type_at"');
  assert.doesNotMatch(branch, /dispatchKey|modifiers|navigator|userAgent|platform/,
    "select-all is a DOM operation; a key here is the per-OS bug it replaced");
  assert.ok(branch.includes("focusState(tabId, action.clear === true)"),
    "the clear rides the focus probe, so it targets what the press focused");
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
  const world = extractFn(ptrSrc, "isolatedWorld").replace(/^export\s+/, "");
  const frame = extractFn(ptrSrc, "topFrameId").replace(/^export\s+/, "");
  const cache = "const worldIds = new Map();\n";
  const src = `${cache}\nconst IDLE_WORLD = "brotto-idle";\n${frame}\n${world}\nreturn ${shipped}`;
  return new Function("anyCommand", "FOCUS_PROBE", src)(anyCommand, FOCUS_PROBE);
}

/** The fake CDP session for `bindFocus`: named commands, a real-ish protocol
 *  shape, so a wall that stops being called is a *missing answer*, not a
 *  function that quietly passes. The world's plumbing has real answers too,
 *  because `bindFocus` resolves its nodes into it. */
const PLUMBING = {
  "Page.getFrameTree": { frameTree: { frame: { id: "F" } } },
  "Page.createIsolatedWorld": { executionContextId: 9 },
};

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
  const body = ["focusNode", "isolatedWorld", "topFrameId", "box"]
    .map((n) => extractFn(ptrSrc, n).replace(/^export\s+/, ""))
    .join("\n");
  const prelude = 'const IDLE_WORLD = "brotto-idle";\nconst worldIds = new Map();\n' +
    'const TEXT_INPUT_TAGS = new Set(["INPUT", "TEXTAREA"]);\n';
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
    extractFn(ptrSrc, "topFrameId") + "\n" + extractFn(ptrSrc, "isolatedWorld").replace(/^export\s+/, "") + `\nreturn ${shipped}`)(anyCommand, FOCUS_PROBE);
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
  const fx = engine({
    "DOM.enable": {},
    "DOM.getFocusNode": { nodeId: 11 },
    "DOM.describeNode": { node: { backendNodeId: 99, nodeName: "INPUT" } },
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "Runtime.callFunctionOn": { result: { value: { ok: true, reason: "same-node", tag: "CANVAS" } } },
  });
  const ok = await loadBindFocus(fx)(1, 99);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.ok(fx.methods().includes("DOM.getFocusNode"),
    "identity comes from the engine; no evaluate is consulted for it");
  const described = fx.calls.find((c) => c.method === "DOM.describeNode");
  assert.equal(described.params.nodeId, 11, "the nodeId the engine returned is the one described");
});

test("an engine that will not name the focused node refuses — it is never inferred", async () => {
  for (const answers of [
    { "DOM.enable": {}, "DOM.getFocusNode": { nodeId: 11 }, "DOM.describeNode": { node: {} } },
    { "DOM.enable": {} },   // getFocusNode throws
    { "DOM.enable": {}, "DOM.getFocusNode": { nodeId: 11 }, "DOM.describeNode": { node: { backendNodeId: 9, nodeName: "INPUT" } } },
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
  const fx = engine({
    "DOM.enable": {},
    "DOM.getFocusNode": { nodeId: 11 },
    "DOM.describeNode": { node: { backendNodeId: 99, nodeName: "INPUT" } },
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "Runtime.callFunctionOn": { result: { value: { ok: false, reason: "not-the-target", tag: "BUTTON" } } },
  });
  const r = await loadBindFocus(fx)(1, 99);
  assert.deepEqual(r, { ok: false, reason: "focus-not-the-target" });
});

// ── the canvas exemption ────────────────────────────────────────────────────

/** The one shape identity cannot serve: a <canvas> grid whose press focuses an
 *  editor that is neither the cell nor inside it. */
function canvasShape({ tag = "CANVAS", focusTag = "TEXTAREA", inner, outer } = {}) {
  const fx = engine({
    "DOM.enable": {},
    "DOM.getFocusNode": { nodeId: 11 },
    "DOM.describeNode": { node: { backendNodeId: 77, nodeName: focusTag } },
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "Runtime.callFunctionOn": { result: { value: { ok: false, reason: "not-the-target", tag } } },
    "DOM.getBoxModel": ({ params }) => (params.backendNodeId === 77 ? { model: { quads: [inner] } } : { model: { quads: [outer] } }),
  });
  return loadBindFocus(fx);
}

const QUAD = (x, y, w, h) => [x, y, x + w, y, x + w, y + h, x, y + h];

test("a canvas cell whose press focuses an editor inside it is exempt, and says so", async () => {
  const bind = canvasShape({ inner: QUAD(10, 10, 40, 12), outer: QUAD(0, 0, 400, 300) });
  const r = await bind(1, 42);
  assert.deepEqual(r, { ok: true, reason: "canvas-editor-exempt" },
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
  const fx = engine({
    "DOM.enable": {},
    "DOM.getFocusNode": { nodeId: 11 },
    "DOM.describeNode": { node: { backendNodeId: 77, nodeName: "TEXTAREA" } },
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "Runtime.callFunctionOn": { result: { value: { ok: false, reason: "not-the-target", tag: "CANVAS" } } },
    "DOM.getBoxModel": { model: { quads: [QUAD(10, 10, 40, 12)] } },
  });
  // Only the canvas answers with a box; the editor has none.
  const bind = loadBindFocus({ ...fx, anyCommand: async (t, c) => (c.method === "DOM.getBoxModel" && c.params.backendNodeId === 77
    ? (() => { throw new Error("not rendered"); })() : fx.anyCommand(t, c)) });
  assert.equal((await bind(1, 42)).reason, "focus-not-the-target");
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
    "target-unresolvable", "probe-silent", "probe-failed"]) {
    assert.ok(declared.has(r), `${r} must be documented in TYPE_AT_REFUSALS`);
  }
  // Nothing on the `type_at` path may emit a reason the list does not name.
  // `different-element:<tag>` is the one prefixed form — a hit-test verdict
  // whose detail is a tag. The scan is over this action's surfaces only; the
  // cursor draw has its own (`foreign-frame`, `no-body`) and is not a refusal.
  const surfaces = [FOCUS_PROBE, IDENTITY_PROBE, extractTemplate(ptrSrc, "TARGET_PROBE"),
    extractFn(ptrSrc, "verifyTarget"), extractFn(ptrSrc, "bindFocus"), extractFn(ptrSrc, "focusState"),
    extractBranch('t === "type_at"'), extractFn(bgSrc, "pressAt")];
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
