// The grid primitives: which app, which element, and what an answer means.
//
// The extension's grid knowledge is the answer to a measured failure: a run
// typed its column headers into the ADDRESS BOX, which holds the selected
// cell's *reference*, so a word became a NAMED RANGE and the write was lost
// silently while the run reported itself done. The name box and the
// formula-bar mirror are therefore different fields, and the difference
// between "an empty cell" and "a read that could not be performed" is a
// different verdict.
//
// The functions are extracted from source by brace matching and run against a
// fake DOM, so this cannot drift from what ships — a dropped field is an
// absence, and an absence reads clean in review.
//
//   node scripts/test-grid-primitives.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const GRID_SRC = fs.readFileSync(
  path.join(ROOT, "clients", "brotto-extension", "src", "observation", "grid.ts"),
  "utf8",
);
const POINTER_SRC = fs.readFileSync(
  path.join(ROOT, "clients", "brotto-extension", "src", "observation", "pointer.ts"),
  "utf8",
);

// A function, by brace matching. The signature's type annotations come off —
// the body is evaluated as plain JavaScript, and a `: any` in it is a syntax
// error there.
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} not found`);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      const head = src.slice(start, open).replace(/:\s*[\w<>[\]| .]+/g, "");
      return head + src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

// An array literal, by bracket matching.
function extractArray(src, name) {
  const start = src.indexOf(`const ${name} = [`);
  assert.ok(start >= 0, `${name} not found`);
  const open = src.indexOf("[", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced brackets in ${name}`);
}

// A string constant, by backtick matching. The probes are strings because
// they are evaluated in the page's isolated world.
function extractString(src, name) {
  const start = src.indexOf(`const ${name} = \``);
  assert.ok(start >= 0, `${name} not found`);
  const open = src.indexOf("`", start);
  const close = src.indexOf("`", open + 1);
  assert.ok(close > open, `unterminated ${name}`);
  return src.slice(open, close + 1);
}

// The adapter list and the resolver live in `pointer.ts` — one source of
// truth for "is this document a grid" — so they are extracted from there and
// put in scope for `grid.ts`'s resolver.
const GRID_ADAPTERS = eval(`(${extractArray(POINTER_SRC, "GRID_ADAPTERS")})`);
const pathMatches = eval(`(${extractFunction(POINTER_SRC, "pathMatches")})`);
const gridApp = eval(`(${extractFunction(POINTER_SRC, "gridApp")})`);

const gridAdapterFor = eval(`(${extractFunction(GRID_SRC, "gridAdapterFor")})`);
const isCellReference = eval(`(${extractFunction(GRID_SRC, "isCellReference")})`);
const parseGridResult = eval(`(${extractFunction(GRID_SRC, "parseGridResult")})`);
const nameBoxJs = eval(`(${extractFunction(GRID_SRC, "nameBoxJs")})`);
const formulaBarJs = eval(`(${extractFunction(GRID_SRC, "formulaBarJs")})`);
const nameBoxFocusJs = eval(`(${extractFunction(GRID_SRC, "nameBoxFocusJs")})`);
const formulaBarFocusJs = eval(`(${extractFunction(GRID_SRC, "formulaBarFocusJs")})`);

// The probe bodies and the selector helper the wrappers use.
const NAME_BOX_PROBE = eval(extractString(GRID_SRC, "NAME_BOX_PROBE"));
const NAME_BOX_FOCUS_PROBE = eval(extractString(GRID_SRC, "NAME_BOX_FOCUS_PROBE"));
const FORMULA_BAR_PROBE = eval(extractString(GRID_SRC, "FORMULA_BAR_PROBE"));
const FORMULA_BAR_FOCUS_PROBE = eval(extractString(GRID_SRC, "FORMULA_BAR_FOCUS_PROBE"));
const selectorFor = eval(`(${extractFunction(GRID_SRC, "selectorFor")})`);

// The adapter match needs origin AND path.
const SHEETS = { origin: "https://docs.google.com", path: "/spreadsheets/d/abc/edit" };

assert.ok(gridAdapterFor(SHEETS), "a sheet is a grid");
assert.strictEqual(gridAdapterFor({ origin: "https://docs.google.com", path: "/document/d/abc" }), null,
  "a doc is not a grid");
assert.strictEqual(gridAdapterFor({ origin: "https://evil.example", path: "/spreadsheets/d/abc" }), null,
  "the same path on another host is not a grid");

// The adapter carries the two selectors the grid's primitives need: the box
// that holds the cell's REFERENCE and the mirror that holds its TEXT.
const sheets = gridAdapterFor(SHEETS);
assert.strictEqual(sheets.nameBoxSelector, "input#t-name-box");
assert.strictEqual(sheets.formulaBarSelector, "#t-formula-bar-input .cell-input");

assert.ok(isCellReference("A1"));
assert.ok(isCellReference("b32"));
assert.ok(!isCellReference("name"), "a word is not a cell reference");
assert.ok(!isCellReference("A"), "a column alone is not a cell reference");
assert.ok(!isCellReference("A1:B2"), "a range is not a cell reference");

// An answer that could not be read is unknown, and carries no value.
const unreadable = parseGridResult({ ok: false, state: "unreadable", error: "no formula bar" });
assert.strictEqual(unreadable.state, "unreadable");
assert.strictEqual(unreadable.value, null);

// A value that is empty is a read that HAPPENED: the cell is empty.
const empty = parseGridResult({ ok: true, state: "ok", value: "" });
assert.strictEqual(empty.state, "ok");
assert.strictEqual(empty.value, "");

// The probes run against a fake DOM.
const nodes = {};
let selection = null;
const fakeDocument = {
  activeElement: null,
  querySelector(sel) { return Object.prototype.hasOwnProperty.call(nodes, sel) ? nodes[sel] : null; },
  createRange() { return { selectNodeContents() {} }; },
};

function runProbe(expression) {
  // A direct eval sees the enclosing function's scope, so the probe reads
  // THIS document and window — the page's, in the real extension.
  const document = fakeDocument;
  const window = { getSelection: () => selection };
  return eval(expression);
}

// The name box holds the selected cell's reference.
nodes["input#t-name-box"] = { value: "B7", focus() { fakeDocument.activeElement = this; }, select() { this.selected = true; } };
assert.strictEqual(runProbe(nameBoxJs("input#t-name-box")), "B7");

// No name box is an empty string, not a null: it is not the "could not be
// read" answer, which the mirror owns.
assert.strictEqual(runProbe(nameBoxJs("input#nope")), "");

// A page must not be able to throw inside a probe.
nodes["input#hostile"] = { get value() { throw new Error("page"); } };
assert.strictEqual(runProbe(nameBoxJs("input#hostile")), "");

// The mirror holds the cell's text. An empty mirror is an empty cell.
nodes["#t-formula-bar-input .cell-input"] = { textContent: "hello", focus() { fakeDocument.activeElement = this; } };
assert.strictEqual(runProbe(formulaBarJs("#t-formula-bar-input .cell-input")), "hello");
nodes["#t-formula-bar-input .cell-input"].textContent = "";
assert.strictEqual(runProbe(formulaBarJs("#t-formula-bar-input .cell-input")), "");

// A missing mirror is null — the "could not be read" answer, and it is NOT
// the same as an empty cell.
assert.strictEqual(runProbe(formulaBarJs("#nope")), null);

// Focusing the name box selects its contents: a DOM operation, never a chord.
const nameBox = nodes["input#t-name-box"];
const focused = runProbe(nameBoxFocusJs("input#t-name-box"));
assert.strictEqual(focused.ok, true);
assert.strictEqual(nameBox.selected, true, "the name box's contents are selected, not cleared by a chord");
assert.strictEqual(runProbe(nameBoxFocusJs("#nope")).ok, false);

// Focusing the mirror selects its contents with a Range — a contenteditable
// has no `select()`.
selection = { rangeCount: 0, removeAllRanges() { this.rangeCount = 0; }, addRange() { this.rangeCount = 1; }, toString() { return ""; } };
const mirror = runProbe(formulaBarFocusJs("#t-formula-bar-input .cell-input"));
assert.strictEqual(mirror.ok, true, "an empty mirror is selected — nothing to replace");
assert.strictEqual(runProbe(formulaBarFocusJs("#nope")).ok, false);

// A mirror that cannot take the focus — a collapsed formula bar — is refused.
// An insertion that stayed in the previous field (the name box, which holds a
// REFERENCE) is the exact failure the ladder exists to stop.
nodes["#hidden-mirror"] = { textContent: "", focus() { /* the focus does not move */ } };
assert.strictEqual(runProbe(formulaBarFocusJs("#hidden-mirror")).ok, false);

// The wire, pinned on this side: three request frames the extension answers,
// and one answer frame with the fields the server reads. `id` and `op` are
// echoed so a late answer to a previous op cannot be read as this one's.
const BG_SRC = fs.readFileSync(
  path.join(ROOT, "clients", "brotto-extension", "src", "background.ts"),
  "utf8",
);
for (const op of ["grid_select_cell", "grid_read_cell", "grid_write_cell"]) {
  assert.ok(BG_SRC.includes(`case "${op}"`), `${op} has no case in background.ts`);
}
assert.ok(BG_SRC.includes('type: "grid_result"'), "the extension sends no grid_result");
for (const field of ["id", "op", "ok", "address", "value", "state", "mechanism", "error"]) {
  assert.ok(BG_SRC.includes(`${field}:`), `grid_result lost "${field}"`);
}

// The answer echoes the request's id. Two calls of the SAME op — a write's
// read-back, then the completion pass — are indistinguishable by name, and
// the id is the only thing that tells the answers apart.
const frameFn = BG_SRC.search(/^function gridResultFrame\s*\(/m);
assert.ok(frameFn >= 0, "no gridResultFrame in background.ts — renamed?");
const frameOpen = BG_SRC.indexOf("{", frameFn);
let frameDepth = 0;
let frameEnd = -1;
for (let i = frameOpen; i < BG_SRC.length; i++) {
  if (BG_SRC[i] === "{") frameDepth++;
  else if (BG_SRC[i] === "}" && --frameDepth === 0) { frameEnd = i + 1; break; }
}
assert.ok(frameEnd > 0, "unterminated gridResultFrame");
const frameSrc = BG_SRC.slice(frameFn, frameOpen).replace(/:\s*[\w<>[\]| ]+/g, "")
  + BG_SRC.slice(frameOpen, frameEnd);
const gridResultFrame = eval(`(${frameSrc})`);

const echoed = JSON.parse(gridResultFrame("req-42", "grid_read_cell", "A1", {
  ok: true, value: "hello", state: "ok", mechanism: "formula-bar", error: "",
}));
assert.strictEqual(echoed.id, "req-42", "the answer does not echo the request's id");
assert.strictEqual(echoed.op, "grid_read_cell");
assert.strictEqual(echoed.value, "hello");
assert.strictEqual(echoed.state, "ok");

// An unreadable answer carries no value, and says so.
const unreadableFrame = JSON.parse(gridResultFrame("req-43", "grid_read_cell", "A1", {
  ok: false, value: null, state: "unreadable", mechanism: "", error: "no formula bar",
}));
assert.strictEqual(unreadableFrame.value, null, "a read that did not happen must not carry a value");
assert.strictEqual(unreadableFrame.state, "unreadable");
assert.strictEqual(unreadableFrame.error, "no formula bar");

console.log("grid primitives ok");
