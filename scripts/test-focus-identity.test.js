// `press_key` has no ref: it types into whatever `document.activeElement` is.
// The guard reads a name for that element before and after the model thinks and
// refuses the keystroke when the name moved — the case is the user reaching for
// their open email draft while the agent is mid-step, and every layer above it
// would otherwise record `ok: true`.
//
// That name is `FOCUS_ID_JS`, and the page supplies both of its inputs: the `id`
// attribute and the element's ordinal among same-tag elements. A duplicated `id`
// therefore gives two different elements one name — focus moves between the
// search box and the delete button and the guard reads "focus did not move", so
// the keystroke is allowed through. The guard has to refuse on an ambiguous
// name, and `""` is what it already reads as unknown.
//
// `FOCUS_ID_JS` is Python that ships as JavaScript, so it is extracted from
// source and run here against a fake DOM — these cases test the text that
// actually reaches the page.
//
//   node --test scripts/test-focus-identity.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(
  __dirname, "..", "services", "brotto-orchestrator",
  "src", "brotto_orchestrator", "cdp", "relay.py",
);
const source = fs.readFileSync(SRC, "utf8");

// Each literal is a valid JSON string, so JSON.parse is the Python-literal
// interpreter; anything else (an f-string, a join) throws here rather than
// silently testing a paraphrase.
function extractFocusId() {
  const start = source.indexOf("FOCUS_ID_JS = (");
  if (start < 0) throw new Error("no FOCUS_ID_JS in relay.py — renamed?");
  const open = source.indexOf("(", start);
  let depth = 0, end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) { end = i; break; }
  }
  if (end < 0) throw new Error("unterminated FOCUS_ID_JS");

  const literals = [];
  const literal = /^\s*("(?:[^"\\]|\\.)*")/gm;
  let m;
  while ((m = literal.exec(source.slice(open + 1, end))) !== null) {
    literals.push(JSON.parse(m[1]));
  }
  if (!literals.length) throw new Error("FOCUS_ID_JS has no string literals");
  return literals.join("");
}

const FOCUS_ID_JS = extractFocusId();

function el(tag, id) {
  return { tagName: tag, id: id || "" };
}

// `getElementsByTagName` returns a live list in document order, which is the
// order the ordinal is derived from — so the fake must hold the elements in
// that order and be told which one is active.
function run(order, activeIndex = 0) {
  const document = {
    activeElement: order[activeIndex],
    body: el("BODY"),
    getElementsByTagName: (t) => order.filter((e) => e.tagName === t),
  };
  return vm.runInNewContext(FOCUS_ID_JS, { document });
}

test("a unique id is the identity", () => {
  assert.equal(run([el("INPUT", "q")]), "INPUT#q");
});

test("a duplicated id is unknown, not a name two elements can share", () => {
  const order = [el("INPUT", "q"), el("INPUT", "q")];
  // The defeat: without the count these two both read "INPUT#q", so focus moving
  // from one to the other is invisible and the keystroke goes through.
  assert.equal(run(order, 0), "");
  assert.equal(run(order, 1), "");
});

test("the same id on a different tag is not a duplicate — the name carries the tag", () => {
  const order = [el("INPUT", "x"), el("P", "x")];
  assert.equal(run(order, 0), "INPUT#x");
  assert.equal(run(order, 1), "P#x");
});

test("an element with no id keeps its ordinal, which is unique in a document", () => {
  const order = [el("BUTTON"), el("BUTTON")];
  assert.equal(run(order, 0), "BUTTON[0]");
  assert.equal(run(order, 1), "BUTTON[1]");
});

test("'none' and 'body' stay distinct from the unknown ''", () => {
  const document = { activeElement: null, body: el("BODY"), getElementsByTagName: () => [] };
  assert.equal(vm.runInNewContext(FOCUS_ID_JS, { document }), "none");
  assert.equal(vm.runInNewContext(FOCUS_ID_JS, { document: { ...document, activeElement: document.body } }), "body");
});

test("an element it cannot find among its own tag list is unknown, never a bare tag name", () => {
  // The defeat: the old fallback `return t;` returned e.g. "DIV" — a name every
  // <div> on the page shares. A focus move between two of them then reads as no
  // move and the keystroke goes through. There is no path that returns a name
  // it has not proved unique.
  const ghost = el("INPUT");
  const document = {
    activeElement: ghost,
    body: el("BODY"),
    // The collection does not contain it: a shadow-root element, or a
    // `getElementsByTagName` that did not answer the truth.
    getElementsByTagName: () => [],
  };
  assert.equal(vm.runInNewContext(FOCUS_ID_JS, { document }), "");
});

test("the constant contains no bare-tag fallback at all", () => {
  // Cheaply pins the shape, so a well-meaning `return t;` cannot return.
  const returns = FOCUS_ID_JS.match(/return [^;]+;/g) || [];
  assert.ok(!returns.some((r) => /^\s*return t;/.test(r)),
    "a bare tag name is never a safe identity for this guard");
});

test("the native is bound once, so a later prototype swap cannot change the enumeration", () => {
  // `getElementsByTagName` is a page-reachable method and `all` is the evidence
  // the uniqueness proof rests on, so the guard takes the native once at the
  // top and iterates the bound copy. Honest limit: this closes a swap that
  // happens *after* the bind, not one installed before the evaluate starts —
  // closing that is `Page.createIsolatedWorld`, the frame workstream.
  assert.match(FOCUS_ID_JS, /getElementsByTagName\.bind\(document\)/,
    "the native must be bound, not called as a live method");

  const order = [el("INPUT", "q"), el("INPUT", "q")];
  const real = (t) => order.filter((e) => e.tagName === t);
  const document = {
    activeElement: order[0],
    body: el("BODY"),
    getElementsByTagName: real,
  };
  // The page swaps the prototype after the bind: the enumeration is unaffected.
  let swapped = false;
  document.getElementsByTagName = function (t) {
    const out = real.call(document, t);
    if (!swapped) { swapped = true; document.getElementsByTagName = () => []; }
    return out;
  };
  assert.equal(vm.runInNewContext(FOCUS_ID_JS, { document }), "",
    "the duplicate id is still seen, so the name stays unknown");
});

test("an ambiguous name is what focus_id() reports as None — the value the guard refuses on", () => {
  // The harness's guard refuses on None; "" is the only channel by which this
  // constant can reach it, so pin that "" is what a blank read becomes.
  const text = String(run([el("INPUT", "q"), el("INPUT", "q")], 0));
  assert.equal(text || null, null);
});