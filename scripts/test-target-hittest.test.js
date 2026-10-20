// A click must still be aimed at the element the observation resolved, at the
// instant of the press.
//
// The geometry guards in `BOX_WALK` decide at observation time. A model call
// sits between that and the press — tens of seconds — and the page can re-render
// in it. `Input.dispatchMouseEvent` returns `{}` for a click that lands on
// `<body>`, so a stale coordinate dispatches, resolves, and is audited
// `ok: true`. `scripts/test-target-hittest.test.js` covers the gate that closes
// that: `verifyTarget` in `pointer.ts`, sliced out of the shipped source and
// run against a fake CDP session, plus the `executeAction` call site that
// consults it.
//
//   node --test scripts/test-target-hittest.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const EXT = path.join(__dirname, "..", "clients", "brotto-extension");
const ptrSrc = fs.readFileSync(path.join(EXT, "src", "observation", "pointer.ts"), "utf8");
const bgSrc = fs.readFileSync(path.join(EXT, "src", "background.ts"), "utf8");

function extractTemplate(name, from = ptrSrc) {
  const marker = `const ${name} = \``;
  const start = from.indexOf(marker);
  if (start < 0) throw new Error(`no template const ${name} — renamed?`);
  const end = from.indexOf("`;", start);
  if (end < 0) throw new Error(`unterminated template ${name}`);
  return from.slice(start + marker.length, end);
}

function extractBody(name, from = ptrSrc) {
  const start = from.search(new RegExp(`^(export )?(async )?function ${name}\\s*\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} — renamed?`);
  const open = from.indexOf("{", start);
  if (from.slice(start, open).includes("}")) throw new Error(`${name}'s signature has braces`);
  let depth = 0;
  for (let i = open; i < from.length; i++) {
    if (from[i] === "{") depth++;
    else if (from[i] === "}" && --depth === 0) return from.slice(open + 1, i);
  }
  throw new Error(`unterminated function ${name}`);
}

const TARGET_PROBE = extractTemplate("TARGET_PROBE");

// ── a fake page ─────────────────────────────────────────────────────────────

function el(tag, opts = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    nodeType: 1,
    children: [],
    parentNode: null,
    getRootNode: () => opts.root || node,
    contains: (other) => other === node || node.children.includes(other),
  };
  return node;
}

function makePage(nodes) {
  const byCoord = {};
  const document = {
    elementFromPoint: (x, y) => byCoord[`${x},${y}`] || null,
  };
  // A live element carries `ownerDocument`; the probe refuses on a falsy one.
  // A node built but never put on this page is the detached case, and it
  // deliberately keeps no `ownerDocument` — see its own test.
  for (const n of nodes) n.node.ownerDocument = document;
  for (const n of nodes) byCoord[`${n.x},${n.y}`] = n.node;
  return { document, top: true };
}

// Run the shipped snippet with `this` bound to the target, exactly as
// `Runtime.callFunctionOn` does. `page.top: false` models a probe bound to a
// child frame, where the wire's coordinates are in some other frame's space.
// `page.detached` leaves the target with no `ownerDocument` at all — the case
// the guard must refuse rather than read as "this document".
function runProbe(target, page, x, y) {
  const vm = require("vm");
  const window = {};
  window.top = page.top === false ? { notThisFrame: true } : window;
  if (page.detached) delete target.ownerDocument;
  else if (target.ownerDocument === undefined) target.ownerDocument = page.document;
  const fn = vm.runInNewContext(
    "(" + TARGET_PROBE + ")", { document: page.document, window });
  return fn.call(target, x, y);
}

// ── the fake CDP session `verifyTarget` talks to ────────────────────────────

function loadVerifyTarget(handler) {
  const anyCommand = async (tabId, command) => handler(command);
  const body = extractBody("verifyTarget");
  // TARGET_PROBE is a module-level const in the real file; it is passed in
  // here so the extracted body sees the shipped snippet, not a copy of it.
  // eslint-disable-next-line no-new-func
  return new Function(
    "anyCommand", "TARGET_PROBE",
    `return async function (tabId, backendNodeId, x, y) {${body}}`,
  )(anyCommand, TARGET_PROBE);
}

test("the shipped snippet accepts the element itself and its descendants", () => {
  const btn = el("button");
  const span = el("span");
  btn.children = [span];
  const page = makePage([{ x: 10, y: 10, node: span }]);

  assert.equal(runProbe(btn, page, 10, 10).ok, true, "a hit on a child is a hit on the element");
});

test("a shadow host counts, because elementFromPoint stops at the boundary", () => {
  const host = el("div");
  const inner = el("input");
  const shadow = { host };
  inner.getRootNode = () => shadow;
  const page = makePage([{ x: 10, y: 10, node: host }]);

  assert.equal(runProbe(inner, page, 10, 10).ok, true);
});

test("an ordinary ancestor does NOT count — that is a click on something else", () => {
  const parent = el("div");
  const btn = el("button");
  parent.children = [btn];
  const page = makePage([{ x: 10, y: 10, node: parent }]);

  const r = runProbe(btn, page, 10, 10);
  assert.equal(r.ok, false);
  assert.match(r.reason, /different-element:div/);
});

test("a target in another document refuses — the probe reads the top frame's point", () => {
  // The dispatch targets whichever frame the node lives in, but this probe's
  // `document.elementFromPoint` is the top one. Checking the point in the wrong
  // coordinate space either refuses a correct click or passes a click aimed at
  // the wrong element, so the gate must degrade to a refusal.
  const inner = el("button");
  inner.ownerDocument = { notTheTopDocument: true };
  const decoy = el("div"); // what the top document has at that point
  const page = makePage([{ x: 10, y: 10, node: decoy }]);

  const r = runProbe(inner, page, 10, 10);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "cross-frame-target");
  assert.ok(/^[a-z][a-z0-9-]{0,31}$/.test(r.reason),
    "must survive the server's _ACTION_REASON_RE clamp");
});

test("a detached element refuses — an unreadable ownerDocument is not \"this document\"", () => {
  // The defeat: `el.ownerDocument && el.ownerDocument !== document` reads a
  // missing ownerDocument as "same document", so a node that is not in this page
  // at all proceeds to a hit test against the top document. This file's rule is
  // that every failure refuses, so an unreadable value must read as unknown.
  const detached = el("button"); // never put on the page — no ownerDocument
  const page = makePage([{ x: 10, y: 10, node: detached }]);
  page.detached = true;

  const r = runProbe(detached, page, 10, 10);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "cross-frame-target");
});

test("a probe bound to a child frame refuses: the wire's x/y are in the top frame", () => {
  // The defeat: comparing the element's document to the *ambient* `document`
  // only answers "is this element in my own frame", and concludes from that
  // that the coordinates are too. They are not — they are top-frame
  // coordinates, and elementFromPoint would resolve them in the wrong space.
  const btn = el("button");
  const page = makePage([{ x: 10, y: 10, node: btn }]);
  page.top = false;

  const r = runProbe(btn, page, 10, 10);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "cross-frame-target");
});

test("the top-frame check is an identity comparison, not a cross-frame script read", () => {
  // `window.top` on a cross-origin frame is a WindowProxy; comparing it to
  // `window` never evaluates a script in the other frame. If the guard ever
  // grows `.document` or a property read on `top`, it has stopped being free
  // and has started throwing on exactly the cross-origin frames it guards.
  assert.match(TARGET_PROBE, /top\s*!==\s*window/);
  assert.doesNotMatch(TARGET_PROBE, /top\s*\.\s*document/);
});

test("a stale point now over a different element is refused", async () => {
  const other = el("a");
  const page = makePage([{ x: 10, y: 10, node: other }]);
  const target = el("button");
  const verify = loadVerifyTarget(async (cmd) => {
    if (cmd.method === "DOM.resolveNode") return { object: { objectId: "obj-1" } };
    if (cmd.method === "Runtime.callFunctionOn") {
      return { result: { value: runProbe(target, page, 10, 10) } };
    }
    throw new Error("unexpected " + cmd.method);
  });

  const r = await verify(1, 4242, 10, 10);
  assert.equal(r.ok, false);
  assert.match(r.reason, /different-element/);
});

test("a ref that still resolves lands normally", async () => {
  const target = el("button");
  const page = makePage([{ x: 10, y: 10, node: target }]);
  const calls = [];
  const verify = loadVerifyTarget(async (cmd) => {
    calls.push(cmd.method);
    if (cmd.method === "DOM.resolveNode") return { object: { objectId: "obj-1" } };
    return { result: { value: runProbe(target, page, 10, 10) } };
  });

  const r = await verify(1, 4242, 10, 10);
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ["DOM.resolveNode", "Runtime.callFunctionOn"],
    "two CDP calls on the attached session, not more");
});

test("a probe that throws refuses — the answer is unknowable, not a pass", async () => {
  const verify = loadVerifyTarget(async (cmd) => {
    if (cmd.method === "DOM.resolveNode") return { object: { objectId: "obj-1" } };
    throw new Error("Execution context was destroyed");
  });
  const r = await verify(1, 4242, 10, 10);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "probe-failed");
});

test("a tab that navigated mid-dispatch refuses: the node is gone", async () => {
  const verify = loadVerifyTarget(async () => {
    throw new Error("No node with given id found");
  });
  const r = await verify(1, 4242, 10, 10);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "target-gone");
});

test("a point over nothing refuses", async () => {
  const verify = loadVerifyTarget(async (cmd) => {
    if (cmd.method === "DOM.resolveNode") return { object: { objectId: "obj-1" } };
    return { result: { value: { ok: false, reason: "point-hit-nothing" } } };
  });
  assert.equal((await verify(1, 1, 5, 5)).ok, false);
});

// ── the call site ───────────────────────────────────────────────────────────

// The gate moved into `pressAt` when `type_at` landed: `click` and the fused
// action now share one press, so a gate that existed on one branch and not its
// sibling would be a gate with a hole in it. These read `pressAt`, which is a
// *stronger* claim than the branch they replaced — it is what both call.
function pressAtSrc() {
  const start = bgSrc.search(/^async function pressAt\s*\(/m);
  if (start < 0) throw new Error("no pressAt in background.ts — renamed?");
  const end = bgSrc.indexOf("\n}\n", start);
  if (end < 0) throw new Error("unterminated pressAt");
  return bgSrc.slice(start, end);
}

test("executeAction consults the gate for `click` and dispatches only after it", () => {
  const press = pressAtSrc();
  const gate = press.indexOf("verifyTarget(");
  const down = press.indexOf('type: "mousePressed"');
  assert.ok(gate > 0, "the press must call verifyTarget");
  assert.ok(gate < down, "the hit test runs before mousePressed, not after");
});

test("executeAction returns without dispatching when the gate refuses", () => {
  const press = pressAtSrc();
  const gate = press.indexOf("if (!check.ok) {");
  const ret = press.indexOf("return { ok: false", gate);
  const down = press.indexOf('type: "mousePressed"');
  assert.ok(gate > 0 && ret > gate && ret < down,
    "a refusal returns before anything is dispatched");
});

function branchBody(cond) {
  const start = bgSrc.indexOf(`else if (${cond}) {`);
  if (start < 0) throw new Error(`no \`${cond}\` branch in background.ts — renamed?`);
  const open = bgSrc.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < bgSrc.length; i++) {
    if (bgSrc[i] === "{") depth++;
    else if (bgSrc[i] === "}" && --depth === 0) return bgSrc.slice(open + 1, i);
  }
  throw new Error(`unterminated \`${cond}\` branch`);
}

test("the gate is inside the shared press, so focus_ref, clear_ref and type_at all get it", () => {
  // `focus_ref` and `clear_ref` dispatch the same `click` action type, and
  // `type_at` is a type of its own. All three reach the press through
  // `pressAt`; a gate placed on any one branch instead would leave typing into
  // a moved field ungated.
  const press = pressAtSrc();
  assert.ok(press.includes("verifyTarget(tabId, action.backendNodeId, x, y)"));
  for (const cond of ['t === "click" || t === "click_xy"', 't === "type_at"']) {
    assert.ok(branchBody(cond).includes("pressAt("),
      `${cond} must reach the press through pressAt, not dispatch its own`);
  }
});

test("a coordinate action carries no id, and is not refused for that", async () => {
  // The canvas path: `click_xy` arrives with x/y and nothing else. Refusing on
  // the absent id would break the only way to act on a canvas page.
  const verify = loadVerifyTarget(async () => {
    throw new Error("no CDP call may be made without an id");
  });
  const r = await verify(1, undefined, 300, 200);
  assert.equal(r.ok, true);
  assert.equal(r.reason, "no-backend-id");
});

test("the extension reads backendNodeId off the action frame the relay sends", () => {
  // One field, optional, additive. `extension_relay._locate` puts it in the
  // coords dict every ref-taking method spreads.
  const relay = fs.readFileSync(
    path.join(__dirname, "..", "services", "brotto-orchestrator",
      "src", "brotto_orchestrator", "cdp", "extension_relay.py"),
    "utf8",
  );
  assert.match(relay, /"backendNodeId": t\.get\("backendNodeId"\)/,
    "the relay must put the target's id on the action frame");
});