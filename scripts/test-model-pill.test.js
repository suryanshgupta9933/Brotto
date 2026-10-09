// Two defects the GIF harness exposed in the header, both of which are absences
// a diff reads clean: a model name that fits scrolling anyway, and a sign-in
// card that resolves while its Continue button stays on screen.
//
// fitModelPill adds the handoff padding to offsetWidth, which already contains
// it — so every name overflowed by exactly one gap and every pill marqueed.
// appendLoginCard appends the Continue button to the message list, a sibling of
// the card, so resolveCard's own querySelectorAll could never reach it.
//
// Extracted from src/sidepanel.js by brace matching, like the other panel tests.
//
//   node scripts/test-model-pill.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src", "sidepanel.js");
const source = fs.readFileSync(SRC, "utf8");

function extract(name) {
  const start = source.search(new RegExp(`^function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} in sidepanel.js — renamed?`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

// ── Stubs ──────────────────────────────────────────────────────────────────
// A DOM small enough to read: nodes know their parent and their siblings, and
// querySelectorAll searches descendants only — which is the whole point, since
// resolveCard reaches the button by walking forwards from the card.
function node(className, parent) {
  const el = {
    className: className || "",
    children: [],
    parent,
    textContent: "",
    classList: {
      add: (c) => { if (!classesOf(el).includes(c)) el.className = `${el.className} ${c}`.trim(); },
      remove: (c) => { el.className = classesOf(el).filter((x) => x !== c).join(" "); },
      contains: (c) => classesOf(el).includes(c),
      toggle: (c, on) => (on ? el.classList.add(c) : el.classList.remove(c)),
    },
    appendChild: (child) => addChild(el, child),
    remove: () => removeNode(el),
    querySelectorAll: (sel) => queryAll(el, sel),
    querySelector: (sel) => query(el, sel),
    get nextElementSibling() { return nextSibling(el); },
    get firstElementChild() { return el.children[0] || null; },
  };
  return el;
}

function addChild(parent, child) {
  parent.children.push(child);
  child.parent = parent;
  return child;
}

function classesOf(el) {
  return el.className ? el.className.split(/\s+/).filter(Boolean) : [];
}

function removeNode(el) {
  const p = el.parent;
  if (!p) return;
  p.children = p.children.filter((c) => c !== el);
  el.parent = null;
}

function nextSibling(el) {
  const p = el.parent;
  if (!p) return null;
  const i = p.children.indexOf(el);
  return i < 0 || i === p.children.length - 1 ? null : p.children[i + 1];
}

// Descendant-only, and class-only: every stub node carries a className.
function queryAll(root, selector) {
  const want = selector.replace(/^\./, "");
  const out = [];
  (function walk(n) {
    for (const c of n.children) {
      if (classesOf(c).includes(want)) out.push(c);
      walk(c);
    }
  })(root);
  return out;
}

function query(root, selector) {
  return queryAll(root, selector)[0] || null;
}

function append(parent, className) {
  return addChild(parent, node(className, parent));
}

const messagesEl = node("messages", null);

const sandbox = {
  messagesEl,
  document: { createElement: () => node("div", null) },
  getComputedStyle: () => ({ paddingRight: "20px" }),
  parseFloat,
  Math,
};
const context = vm.createContext(sandbox);
vm.runInContext("let modelPillName = null;", context);
vm.runInContext("globalThis.setModelPillName = (el) => { modelPillName = el; };", context);
vm.runInContext(extract("resolveCard"), context);
vm.runInContext(extract("fitModelPill"), context);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
}

// ── resolveCard drops the sign-in fallback button ───────────────────────────

function buildLoginList() {
  messagesEl.children = [];
  const card = append(messagesEl, "login-required-msg blocking");
  append(card, "login-required-badge");
  append(messagesEl, "login-continue-btn");
  return card;
}

const card = buildLoginList();
context.resolveCard(card, "login-required-outcome", "Signed in, and the task carried on.");

check(
  "resolveCard resolves the login card in place",
  classesOf(card).includes("resolved") && !classesOf(card).includes("blocking"),
  `classes: ${card.className}`,
);
check(
  "resolveCard removes the sibling Continue button",
  messagesEl.children.every((c) => c.className !== "login-continue-btn"),
  `remaining: ${messagesEl.children.map((c) => c.className).join(", ")}`,
);
check(
  "the card itself stays in the transcript",
  messagesEl.children.includes(card),
);

// An approval card carries its buttons inside it, and the sibling walk must not
// touch the chat around it.
{
  messagesEl.children = [];
  const before = append(messagesEl, "message assistant");
  const approval = append(messagesEl, "approval-card blocking");
  const actions = append(approval, "approval-actions");
  const after = append(messagesEl, "message user");
  context.resolveCard(approval, "approval-decision", "Approved");
  check("resolveCard still removes controls inside the card", actions.parent === null);
  check("resolveCard leaves the surrounding chat alone",
    before.parent === messagesEl && after.parent === messagesEl);
}

// ── fitModelPill does not marquee a name that fits ──────────────────────────

function pillFor(textWidth) {
  // setModelPill builds a two-copy track; fitModelPill measures the head of it.
  const pill = node("model-pill-name", null);
  pill.classList.add("marquee");
  pill.clientWidth = 88;
  const track = append(pill, "model-pill-track");
  const head = append(track, "span");
  head.textContent = "x";
  // offsetWidth carries the handoff padding, so it is 20 wider than the glyphs.
  head.offsetWidth = textWidth;
  return { pill, head };
}

{
  const { pill } = pillFor(80);
  context.setModelPillName(pill);
  context.fitModelPill();
  check("a name inside the window does not marquee", !pill.classList.contains("marquee"), `class: ${pill.className}`);
}
{
  const { pill } = pillFor(113);
  context.setModelPillName(pill);
  context.fitModelPill();
  check("a name wider than the window still marquees", pill.classList.contains("marquee"));
}

process.exit(failures ? 1 : 0);