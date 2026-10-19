// A coordinate click is the one approval the user cannot check by reading.
//
// Everything else the panel asks permission for names its destination: a URL,
// an action, a form. A `click_xy` is a pair of numbers on a picture, and a
// canvas (Google Sheets, Figma) has no accessibility node to name — so this
// card is the entire safety story. Four things therefore have to hold, and
// each of them fails as an *absence*, which is why they need a test:
//
//   - the crosshair lands on the point the agent named. `x`/`y` are CSS pixels
//     and `Page.captureScreenshot` writes device pixels, so arithmetic against
//     the image's natural size is off by the device scale factor — on a 2x
//     display that is a crosshair two cells from the one being approved. The
//     card positions by percentage of the viewport box instead, which is the
//     same point on a retina and a non-retina machine;
//   - the label is set with textContent, never innerHTML. It is model-authored
//     and therefore as steerable by page content as any other model text here;
//   - a `type_xy` shows the **whole** of `args.text`, in one `textContent`
//     block under a fixed label. `reasoning` carries no value any more — it
//     says only "the text shown below this card" — so this block is the card's
//     only preview of what will be typed, and a truncated one (it used to be
//     120 characters) is consent for something other than what gets written.
//     The value used to sit inside that prose, where it could close a curly
//     quote and speak as harness text. No cap, no ellipsis;
//   - that block is drawn by the *caller*, not by the picture. A `type_xy` whose
//     screenshot failed to render used to fall out of the builder's early
//     return and leave the card promising a value it was not showing — an
//     approvable card, an invisible write. It is also drawn for a value that
//     is not a string, because the server types `str(args.get("text") or "")`;
//   - what is on the card cannot be reordered or hidden by the value itself.
//     Bidi controls and zero-width characters are rendered as named
//     placeholders (`<U+202E>`), never drawn, and the block isolates its bidi
//     context — the typed string is unchanged, the preview is not a faithful
//     copy of a string that cannot be faithfully shown;
//   - an approval with no screenshot — which is every other approval in the
//     app — renders the ordinary card, unchanged. This is the regression that
//     matters most: the feature must not alter a single existing approval.
//
// Read against src/sidepanel.js directly, by extraction, so it cannot drift
// from what ships.
//
//   node scripts/test-coordinate-approval.test.js

"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src");
const panel = fs.readFileSync(path.join(SRC, "sidepanel.js"), "utf8");

// Brace matching from the signature's closing paren, so a destructured
// parameter object is not mistaken for the body.
function sliceFunction(name) {
  const start = panel.search(new RegExp(`^(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} in sidepanel.js — renamed?`);
  let paren = 0;
  let open = -1;
  for (let i = panel.indexOf("(", start); i < panel.length; i++) {
    const c = panel[i];
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (paren === 0) { open = i; break; }
  }
  let depth = 0;
  for (let i = open; i < panel.length; i++) {
    if (panel[i] === "{") depth++;
    else if (panel[i] === "}" && --depth === 0) return panel.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

// The smallest element the card under test touches. No layout, no queries —
// these two functions build and append, and read back what they built.
//
// `textContent` is a *derived* getter over the child text nodes, because the
// value block is built that way (a run of text, then a marked placeholder) and
// a fake that stored it as a plain field would read back empty for exactly the
// case the bidi tests are about. It is a prototype accessor, so `attrsOf` —
// which walks own properties — never sees a value hiding in an attribute.
function fakeDocument() {
  // `made` is what makes "the value cannot become a second element" checkable:
  // every element the card builds, in order, whether or not it was appended.
  const made = [];
  class Node {
    constructor(tag) {
      this.tagName = tag;
      this.className = "";
      this.style = {};
      this.children = [];
      this._text = "";
      made.push(this);
    }
    appendChild(c) { this.children.push(c); return c; }
    get textContent() {
      return this.children.length
        ? this.children.map((c) => c.textContent).join("")
        : this._text;
    }
    set textContent(v) { this._text = String(v); }
  }
  return {
    createElement: (tag) => new Node(tag),
    createTextNode: (text) => {
      const n = new Node("#text");
      n.textContent = text;
      return n;
    },
    made,
  };
}

const crosshairPercent = eval(`(${sliceFunction("crosshairPercent")})`);
const appendApprovalTarget = eval(`(${sliceFunction("appendApprovalTarget")})`);
// The value block is built by two more functions and reads one module const;
// they are pulled out the same way, so the test cannot drift from what ships.
const INVISIBLE_CP = (() => {
  // The flag is part of the literal: an astral range like U+E0000–U+E007F
  // only means one codepoint under /u.
  const m = /const INVISIBLE_CP = (\/[^;]+\/[a-z]*)/.exec(panel);
  if (!m) {
    console.error("FAIL  no INVISIBLE_CP in sidepanel.js — the value block does not name invisible characters");
    process.exit(1);
  }
  return eval(m[1]);
})();
const splitInvisible = eval(`(${sliceFunction("splitInvisible")})`);
const appendApprovalValue = eval(`(${sliceFunction("appendApprovalValue")})`);
const approvalValueUnavailable = eval(`(${sliceFunction("approvalValueUnavailable")})`);
const approvalValueMasked = eval(`(${sliceFunction("approvalValueMasked")})`);

// The gate settles on the deny's reply, so a gate test has to let the
// microtask queue drain before it reads the card.
const flush = () => new Promise((r) => setImmediate(r));

let failed = 0;
const pending = [];
function check(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      pending.push(out.then(
        () => console.log(`  ok  ${name}`),
        (e) => { failed++; console.error(`FAIL  ${name}\n      ${e.message}`); },
      ));
      return;
    }
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL  ${name}\n      ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function approx(a, b, tol = 1e-9) {
  return Math.abs(a - b) <= tol;
}

// A real 13" MacBook Air page, and the same page on the same machine with the
// display scaled — the pair the device-pixel trap shows up on.
const LAPTOP = { width: 1512, height: 982 };
const JPEG = "/9j/4AAQSkZJRgABAQAAAQ==";
const ARGS = { x: 412, y: 288, label: "the cell C4" };

console.log("the crosshair lands on the point the agent named");

check("a retina screenshot and a non-retina one place it identically", () => {
  // Same CSS point, viewport 1512×982; the image behind it is captured at 2x.
  const a = crosshairPercent(412, 288, LAPTOP);
  assert(a !== null, "a 2x capture was rejected outright");
  // If the card had used naturalWidth (3024) the crosshair would sit at 13.6%
  // instead of 27.2% — roughly four fifths of the way off the page.
  assert(approx(a.left, 27.2486772, 1e-6), `left is ${a.left}, expected 27.2486772`);
  assert(approx(a.top, 29.3279022, 1e-6), `top is ${a.top}, expected 29.3279022`);
  assert(a.outside === false, "a point well inside the viewport was called outside");
  assert(!/naturalWidth/.test(panel.replace(/\/\/.*$/gm, "")),
    "the panel reads the image's natural size — that is the device-pixel bug");
});

check("a point past the viewport edge is flagged rather than clipped silently", () => {
  const p = crosshairPercent(1600, 100, LAPTOP);
  assert(p.outside === true, "x past the width was not flagged");
  const inside = crosshairPercent(1512, 982, LAPTOP);
  assert(inside.outside === false, "the last pixel of the viewport was called outside");
});

check("a viewport that never arrived leaves nothing to draw", () => {
  assert(crosshairPercent(412, 288, null) === null, "a missing viewport did not return null");
  assert(crosshairPercent(412, 288, { width: 0, height: 0 }) === null, "a 0×0 viewport did not return null");
});

console.log("\nthe card the user is asked to approve");

function build(over) {
  const doc = fakeDocument();
  globalThis.document = doc;
  const card = doc.createElement("div");
  const shown = appendApprovalTarget(card, Object.assign(
    { screenshot: JPEG, viewport: LAPTOP, args: ARGS, url: "https://docs.google.com/" },
    over,
  ));
  return {
    card, shown, doc,
    made: doc.made.slice(1),
    cross: card.children.find((c) => (c.className || "").includes("approval-cross")),
  };
}

// Every property of an element except its children, its style and its
// textContent — i.e. what an attribute, a class or a title could carry. The
// value belongs in exactly one place, and this is not it.
function attrsOf(el) {
  return Object.entries(el)
    .filter(([k]) => !["children", "style", "textContent", "_text"].includes(k))
    .map(([, v]) => String(v))
    .join(" ");
}

// Depth-first, the way `querySelector` would see it — the value block is a
// wrapper with two children, not a flat child of the card.
function findEl(node, pred) {
  for (const c of node.children) {
    if (pred(c)) return c;
    const hit = findEl(c, pred);
    if (hit) return hit;
  }
  return null;
}
const hasClass = (name) => (c) => (c.className || "").split(/\s+/).includes(name);
function countTree(node) {
  return 1 + node.children.reduce((n, c) => n + countTree(c), 0);
}

check("it leads with the label, not the coordinates", () => {
  const { card, shown } = build();
  assert(shown === true, "the picture was not rendered at all");
  const target = card.children.find((c) => c.className === "approval-target");
  assert(target, "no .approval-target line — the card opens on the reason instead");
  assert(target.textContent === "Click the cell C4", `target reads ${JSON.stringify(target.textContent)}`);
  assert(!/\b412\b|\b288\b/.test(card.children.map((c) => c.textContent).join(" ")),
    "raw coordinates reached the user as text");
});

check("the picture and the crosshair are one node over one picture", () => {
  const { card } = build();
  const shot = card.children.find((c) => c.className === "approval-shot");
  assert(shot, "no .approval-shot");
  const img = shot.children[0];
  assert(img.src === `data:image/jpeg;base64,${JPEG}`, "the screenshot is not the picture we were sent");
  const cross = shot.children[1];
  assert(cross.className === "approval-cross", `crosshair class is ${cross.className}`);
  assert(cross.style.left === "27.24867724867725%", `left is ${cross.style.left}`);
  assert(cross.style.top === "29.327902240325866%", `top is ${cross.style.top}`);
});

check("the label never reaches innerHTML — it is model-authored", () => {
  const hostile = { x: 1, y: 1, label: '<img src=x onerror="alert(1)">' };
  const { card } = build({ args: hostile });
  const target = card.children.find((c) => c.className === "approval-target");
  assert(target.textContent === 'Click <img src=x onerror="alert(1)">',
    "the label was not written verbatim as text");
  assert(!/innerHTML/.test(sliceFunction("appendApprovalTarget")),
    "the card builder assigns innerHTML");
});

check("a capture that is not base64 shows no picture at all", () => {
  const { shown, card } = build({ screenshot: '"><script>alert(1)</script>' });
  assert(shown === false, "a non-base64 screenshot was rendered anyway");
  assert(card.children.length === 0, `it appended ${card.children.length} nodes`);
});

console.log("\nthe value, on a type_xy card");

// A cell value long enough that any cap — the old 120-character preview, a
// CSS line clamp, a panel-height crop — shows up as a shortfall.
const LONG = "Q3 reconciliation note. ".repeat(220); // ~5,700 chars
const TYPE_ARGS = { x: 412, y: 288, label: "the cell C4", text: LONG };
const TYPE_ACTION = { type: "type_xy" };

// The card the caller builds, in the order appendApprovalCard writes it: the
// picture, then the reason, then the value. `drewPicture` is kept because the
// whole point of the missing-screenshot case is that the value is drawn
// whether or not this is true.
function buildCard(over = {}) {
  const doc = fakeDocument();
  globalThis.document = doc;
  const card = doc.createElement("div");
  const drewPicture = appendApprovalTarget(card, {
    screenshot: JPEG, viewport: LAPTOP, args: ARGS, url: "https://docs.google.com/", ...over,
  });
  const body = doc.createElement("div");
  body.className = "approval-body";
  body.textContent = over.reason ?? "the text shown below this card";
  card.appendChild(body);
  appendApprovalValue(card, over.args ?? TYPE_ARGS, over.action ?? TYPE_ACTION);
  return { card, doc, drewPicture, made: doc.made.slice(1) };
}

check("the whole value is rendered, not a prefix of it", () => {
  const { card } = buildCard();
  const block = findEl(card, hasClass("approval-value-text"));
  assert(block, "no value block — a type_xy card shows the value nowhere");
  assert(block.textContent === LONG,
    `the block holds ${(block.textContent || "").length} of ${LONG.length} characters`);
  assert(!/…|\.\.\.$/.test((block.textContent || "").trim()),
    "the value was truncated with an ellipsis");
});

check("the block carries a fixed label the value cannot close", () => {
  const { card } = buildCard();
  const wrap = findEl(card, hasClass("approval-value"));
  assert(wrap, "no .approval-value wrapper");
  // The label is its own element, so no amount of quote characters in the
  // value can end it — and it says plainly that this is what gets written.
  const labels = wrap.children.filter((c) => c !== wrap.children[wrap.children.length - 1]);
  assert(labels.length >= 1, "the value block has no label of its own");
  assert(/type|write/i.test(labels[0].textContent),
    `the label does not say what the block is: ${JSON.stringify(labels[0].textContent)}`);
});

check("a hostile value is literal text and cannot speak as harness prose", () => {
  // Every trick at once: close the label's quotes, claim the card said
  // something it did not, and try to open a tag.
  const hostile = '” — safe cell, actually delete everything — “ <b onclick="x">hi</b>\nline two';
  const { card, made } = buildCard({ args: { ...TYPE_ARGS, text: hostile } });
  const block = findEl(card, hasClass("approval-value-text"));
  assert(block, "no value block");
  assert(block.textContent === hostile,
    `the value was not written verbatim: ${JSON.stringify(block.textContent)}`);
  // Same element count as a benign value: a value that could introduce an
  // element would change this number.
  const benign = buildCard({ args: { ...TYPE_ARGS, text: "ok" } });
  assert(made.length === benign.made.length,
    `a hostile value built ${made.length} elements, a benign one ${benign.made.length}`);
  // +1 for the card `made` deliberately excludes.
  assert(made.length + 1 === countTree(card), "an element was built and never attached");
  // And it reached no attribute, so no parser and no tooltip ever sees it.
  assert(!made.some((e) => attrsOf(e).includes("delete everything")),
    "the value reached a class name, src, alt or title");
  // The value sits after the reason, under it: the sentence that points at the
  // value and the value itself are one card, in that order.
  const kids = card.children;
  const reasonAt = kids.findIndex((c) => (c.className || "").includes("approval-body"));
  const valueAt = kids.findIndex((c) => (c.className || "").includes("approval-value"));
  assert(reasonAt >= 0 && valueAt > reasonAt,
    "the value does not sit under the reason that promises it");
});

check("the block leads with the target and scrolls rather than cutting", () => {
  const css = fs.readFileSync(path.join(SRC, "sidepanel.html"), "utf8");
  const rule = /\.approval-value-text \{[^}]*\}/.exec(css);
  assert(rule, "no .approval-value-text rule — the block has no style of its own");
  assert(/max-height/.test(rule[0]) && /overflow/.test(rule[0]),
    "a long value has nowhere to go but off the card: no max-height/overflow");
  assert(/text-overflow/.test(rule[0]) === false && /line-clamp/.test(rule[0]) === false,
    "the value block ellipsises or clamps — that is the bug being fixed");
});

console.log("\nthe value survives a card whose picture never drew");

check("a missing screenshot still shows the value", () => {
  const { card, drewPicture } = buildCard({ screenshot: undefined });
  assert(drewPicture === false, "a missing screenshot drew a picture anyway");
  const block = findEl(card, hasClass("approval-value-text"));
  assert(block && block.textContent === LONG,
    "the value vanished with the picture — the card still says 'the text shown below this card'");
});

check("a malformed capture still shows the value", () => {
  const { card, drewPicture } = buildCard({ screenshot: '"><script>alert(1)</script>' });
  assert(drewPicture === false, "a non-base64 capture was rendered");
  assert(findEl(card, hasClass("approval-value-text")), "the value went with the bad capture");
});

check("an absent viewport still shows the value", () => {
  const { card, drewPicture } = buildCard({ viewport: null });
  assert(drewPicture === false, "a missing viewport drew a picture anyway");
  assert(findEl(card, hasClass("approval-value-text")), "the value went with the missing viewport");
});

check("the value lives in the caller, not behind the early return", () => {
  assert(!/approval-value/.test(sliceFunction("appendApprovalTarget")),
    "appendApprovalTarget draws the value block again — it returns before it on a bad capture");
  // An unqualified statement, not a call behind a condition: gating it on
  // whether the picture drew is the whole bug this check exists for, and the
  // tree under test cannot express that — so the *source* is what is read.
  assert(/^\s*appendApprovalValue\(card, args, action\);$/m.test(sliceFunction("appendApprovalCard")),
    "appendApprovalCard does not draw the value block unconditionally");
});

check("a value that is not a string is shown, not typed unseen", () => {
  // The server types `str(args.get("text") or "")`, so every one of these
  // reaches the page. Gating on `typeof === 'string'` made them invisible here.
  for (const [text, expected] of [[123, "123"], [0, "0"], [true, "true"],
    [{ a: 1 }, "[object Object]"], [["a", "b"], "a,b"]]) {
    const { card } = buildCard({ args: { ...TYPE_ARGS, text } });
    const block = findEl(card, hasClass("approval-value-text"));
    assert(block, `${JSON.stringify(text)} rendered no value block`);
    assert(block.textContent === expected,
      `${JSON.stringify(text)} rendered as ${JSON.stringify(block.textContent)}, not ${JSON.stringify(expected)}`);
  }
});

check("a click or focus with no value renders no block at all", () => {
  for (const verb of ["click_xy", "focus_xy"]) {
    const { card } = buildCard({ args: { x: 412, y: 288, label: "the cell C4" }, action: { type: verb } });
    assert(!findEl(card, hasClass("approval-value")), `${verb} grew a value block`);
  }
  // And a type_xy whose text is empty string is still a type — the block says
  // so, rather than the card implying there was nothing to write.
  const empty = buildCard({ args: { ...TYPE_ARGS, text: "" } });
  const eb = findEl(empty.card, hasClass("approval-value-text"));
  assert(eb && eb.textContent === "", "an empty value rendered as something other than nothing");
});

console.log("\ninvisible characters cannot hide characters, or reorder the card");

// Written as escapes on purpose: a literal U+202E in this file would itself
// be a bidi hazard for whoever reads it next.
//   "Total: 42" + RLO + "2" + LRE — the cell reads "Total: 42 2" in code
// order, and renders the digits the other way round on screen.
const BIDI = "Total: 42\u202e2\u202a";
const INVISIBLE_RUN = "a\u200db\u2060c\ufeffd";
// `{4,}` rather than `{4}`: a supplementary-plane codepoint needs 5–6 hex
// digits, and `codePointAt(0).toString(16).padStart(4, '0')` does not clip it.
const NAME = /<U\+[0-9A-F]{4,}>/g;
// "…shown…" with the invisible characters taken out: the placeholders stand in
// for those and for nothing else.
const strip = (t) => t.replace(NAME, "");
// Rebuilt with the same flags it ships with: under /u the astral range means
// one codepoint, and without it the source does not even compile.
const visibleOnly = (t) => t.replace(new RegExp(INVISIBLE_CP.source, `${INVISIBLE_CP.flags}g`), "");

check("a bidi payload renders visibly different from its byte order", () => {
  const { card } = buildCard({ args: { ...TYPE_ARGS, text: BIDI } });
  const block = findEl(card, hasClass("approval-value-text"));
  assert(block, "no value block for a bidi payload");
  const rendered = block.textContent;
  assert(rendered !== BIDI, "the payload was rendered verbatim — the controls are still invisible");
  assert(rendered.includes("Total: 42"), "the visible part of the value was lost");
  assert(rendered.includes("<U+202E>") && rendered.includes("<U+202A>"),
    `the controls are not named: ${JSON.stringify(rendered)}`);
  // The placeholder keeps the character count visible: stripping them back to
  // one character each recovers the value exactly, nothing dropped.
  assert(strip(rendered).length === visibleOnly(BIDI).length
    && rendered.split(NAME).length - 1 === [...BIDI].filter((c) => INVISIBLE_CP.test(c)).length,
  "the rendered text does not account for every character of the value");
  // Strip the placeholders and what is left is the *visible* characters of the
  // value, unchanged and in order — the controls are the only thing renamed.
  assert(strip(rendered) === visibleOnly(BIDI),
    `the visible characters changed: ${JSON.stringify(strip(rendered))}`);
});

check("zero-width and format characters are named too", () => {
  const { card } = buildCard({ args: { ...TYPE_ARGS, text: INVISIBLE_RUN } });
  const block = findEl(card, hasClass("approval-value-text"));
  const rendered = block.textContent;
  for (const cp of ["<U+200D>", "<U+2060>", "<U+FEFF>"]) {
    assert(rendered.includes(cp), `${cp} is not shown: ${JSON.stringify(rendered)}`);
  }
  assert(strip(rendered) === visibleOnly(INVISIBLE_RUN),
    `the visible characters around the invisible ones changed: ${JSON.stringify(rendered)}`);
});

check("the value isolates its bidi context, so the card cannot be reordered", () => {
  const css = fs.readFileSync(path.join(SRC, "sidepanel.html"), "utf8");
  const rule = /\.approval-value-text \{[^}]*\}/.exec(css);
  assert(rule && /unicode-bidi:\s*isolate/.test(rule[0]),
    "the value block does not isolate its bidi context — a U+202E reaches the card around it");
  const { card } = buildCard({ args: { ...TYPE_ARGS, text: BIDI } });
  // Every other line of the card is a sibling of the value block, so the
  // payload has nothing to reorder: the reason, the label and the picture are
  // all outside its bidi run.
  const body = card.children.find((c) => (c.className || "").includes("approval-body"));
  assert(body && !/\u202a|\u202e|\u200e|\u200f/.test(body.textContent),
    "the payload leaked into the reason line, which sits next to it");
});

check("placeholder runs are marked, so they read as something else", () => {
  const { card } = buildCard({ args: { ...TYPE_ARGS, text: BIDI } });
  const marks = [];
  (function walk(n) {
    for (const c of n.children) {
      if (hasClass("approval-value-invisible")(c)) marks.push(c);
      walk(c);
    }
  })(card);
  assert(marks.length === 2, `expected two placeholder runs, found ${marks.length}`);
  assert(marks.every((m) => /^<U\+[0-9A-F]{4}>$/.test(m.textContent)),
    `a placeholder run is not a bare named codepoint: ${JSON.stringify(marks.map((m) => m.textContent))}`);
  // The whole run, not each character: they are written with textContent, so
  // a codepoint in a value cannot introduce an element of its own.
  // One element per *run*, not per character: a, then the four invisible ones
  // as a single marked span, then b, c, d — text nodes are the rest.
  const { made } = buildCard({ args: { ...TYPE_ARGS, text: INVISIBLE_RUN } });
  // One element per *run*, not per character: three separated marks here, so
  // three spans — a per-character renderer would have built four.
  assert(made.filter((e) => (e.className || "").includes("approval-value-invisible")).length === 3,
    `three separated invisible runs built ${made.length} elements`);
});

check("a replayed type_xy keeps the promise its reason makes", () => {
  // #4: the audit prompt carries `args` but no screenshot, so a replayed
  // approval has no picture and no crosshair. It does have the value, and the
  // reason still points at it.
  const prompt = { id: "p1", kind: "approval", action: "type_xy", decision: "approved",
    reason: "the text shown below this card", args: { url: "https://docs.google.com/", text: "Total: 42" } };
  const src = sliceFunction("appendPromptCard");
  assert(/args,/.test(src), "appendPromptCard drops the prompt's args, so replay shows no value");
  const m = /\n\s*args,\n/.exec(src);
  assert(m, "the prompt's args are not forwarded to the approval card");
  // The bubble itself is unchanged: a replayed row still renders live.
  assert(/appendApprovalCard\(/.test(src), "a replayed approval no longer renders a card");
  // And the value really does reach the block from a prompt-shaped object.
  const { card } = buildCard({ args: prompt.args, action: { type: prompt.action } });
  assert(findEl(card, hasClass("approval-value-text")).textContent === "Total: 42",
    "a prompt's args do not produce the value block");
});

check("a replayed type_xy with no recorded value says so", () => {
  // The audit caps args, so a long value can come back truncated or absent.
  // The block still appears — the reason's "shown below this card" must not
  // point at nothing.
  const { card } = buildCard({ args: { url: "https://docs.google.com/" }, action: { type: "type_xy" } });
  const block = findEl(card, hasClass("approval-value-text"));
  assert(block, "a type_xy with no recorded value rendered no block at all");
  assert(/not recorded/i.test(block.textContent),
    `the block does not say the value is unavailable: ${JSON.stringify(block.textContent)}`);
  assert(!block.textContent.includes("shown below"), "the block claims to be the value");
});

check("a replayed type_xy does not render the redaction mask as the value", () => {
  // What replay actually hands over: `_scrubbed` writes the mask into
  // `args.text` and the real length into `args.text_chars`. So the card was
  // drawing "[redacted:password]" under a heading promising the whole value.
  for (const mask of ["[redacted]", "[redacted:password]"]) {
    const { card } = buildCard({
      args: { x: 412, y: 288, label: "the cell C4", text: mask, text_chars: 7 },
      action: { type: "type_xy" },
    });
    const block = findEl(card, hasClass("approval-value-text"));
    assert(block, `${mask} rendered no value block at all`);
    assert(!block.textContent.includes("redacted"),
      `${JSON.stringify(block.textContent)} shows the mask as though it were the value`);
    assert(/not recorded/i.test(block.textContent),
      `${JSON.stringify(block.textContent)} does not say the value is unavailable`);
    assert(/7/.test(block.textContent), "the recorded length is dropped even though the audit kept it");
    assert(block.className.includes("unavailable"), "the block is not marked unavailable");
    // The heading is the promise; it must not promise what this block does
    // not show.
    const label = findEl(card, hasClass("approval-value-label"));
    assert(label, "no label above the value block");
    assert(!/whole value|exactly as it will be written/.test(label.textContent),
      `the heading still promises the value: ${JSON.stringify(label.textContent)}`);
  }
});

check("a live type_xy still renders the real value in full", () => {
  // The other side of the same gate: the live frame carries the raw value and
  // no `text_chars`, and it must be untouched.
  const raw = "Total: 42";
  const { card } = buildCard({ args: { x: 412, y: 288, label: "the cell C4", text: raw } });
  const block = findEl(card, hasClass("approval-value-text"));
  assert(block.textContent === raw, `the live value rendered as ${JSON.stringify(block.textContent)}`);
  const label = findEl(card, hasClass("approval-value-label"));
  assert(/whole value, exactly as it will be written/.test(label.textContent),
    `the live heading lost its promise: ${JSON.stringify(label.textContent)}`);
});

check("a literal value that merely starts with a bracket is still shown", () => {
  // The mask test is a prefix match, so it must not swallow ordinary typing.
  for (const text of ["[redacted] is a literal string", "[Redacted]"]) {
    const { card } = buildCard({ args: { x: 412, y: 288, label: "c", text } });
    const block = findEl(card, hasClass("approval-value-text"));
    assert(block.textContent === text,
      `${JSON.stringify(text)} rendered as ${JSON.stringify(block.textContent)}`);
  }
});

console.log("\nthe enumerated invisible set covers the rest of the well-known invisibles");

// One entry per newly enumerated range. Each value is the range's character
// between two ordinary ones, so "is it named?" and "did anything else change?"
// are the same assertion.
const NEW_RANGES = [
  ["soft hyphen U+00AD", "\u00ad"],
  ["combining grapheme joiner U+034F", "\u034f"],
  ["invisible math operator U+2061–U+2064", "\u2061"],
  ["deprecated format U+206A–U+206F", "\u206a"],
  ["Hangul filler U+115F", "\u115f"],
  ["Hangul filler U+1160", "\u1160"],
  ["Hangul filler U+3164", "\u3164"],
  ["halfwidth Hangul filler U+FFA0", "\uffa0"],
  ["Hangul filler U+FFFA", "\ufffa"],
  ["variation selector U+FE00–U+FE0F", "\ufe00"],
  ["tag block U+E0000–U+E007F", "\u{E0061}"],
];

for (const [name, cp] of NEW_RANGES) {
  check(`${name} is named, not drawn`, () => {
    const value = `a${cp}b`;
    const { card } = buildCard({ args: { ...TYPE_ARGS, text: value } });
    const rendered = findEl(card, hasClass("approval-value-text")).textContent;
    assert(rendered !== value, "the character was rendered verbatim — it is still invisible");
    assert(rendered.startsWith("a") && rendered.endsWith("b"),
      `the visible characters around it changed: ${JSON.stringify(rendered)}`);
    assert(strip(rendered) === `ab`,
      `stripping the placeholders did not recover the visible characters: ${JSON.stringify(rendered)}`);
    const hex = cp.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
    assert(rendered.includes(`<U+${hex}>`),
      `it is not named by codepoint: ${JSON.stringify(rendered)} wanted <U+${hex}>`);
  });
}

check("a supplementary-plane placeholder names the whole codepoint", () => {
  // U+E0061 is astral: two UTF-16 units, so the pairing of the range with
  // `codePointAt` is the claim to verify rather than assume. A per-surrogate
  // read would produce U+DBC1 here and a mangled name.
  const value = "a\u{E0061}b";
  const { card } = buildCard({ args: { ...TYPE_ARGS, text: value } });
  const rendered = findEl(card, hasClass("approval-value-text")).textContent;
  assert(rendered.includes("<U+E0061>"),
    `the astral codepoint is not named in full: ${JSON.stringify(rendered)}`);
  assert(!/<U\+DBC1>/.test(rendered), "the placeholder names one surrogate, not the codepoint");
  assert(strip(rendered) === "ab", `the visible characters changed: ${JSON.stringify(rendered)}`);
});

check("an emoji with a ZWJ is not mangled by the list", () => {
  // The regression guard against inverting the rule. U+200D is inside an emoji
  // sequence and is also, correctly, an invisible placeholder — the emoji
  // themselves must survive as text either way.
  const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
  const { card } = buildCard({ args: { ...TYPE_ARGS, text: family } });
  const rendered = findEl(card, hasClass("approval-value-text")).textContent;
  for (const ch of family) {
    if (ch === "‍") continue;
    assert(rendered.includes(ch),
      `the emoji lost ${ch.codePointAt(0).toString(16)}: ${JSON.stringify(rendered)}`);
  }
  // Stripping the placeholders recovers every emoji, in order and unmangled:
  // the joiner itself is named rather than drawn, but it is not substituted for
  // and nothing else is lost. This is what inverting the rule would break —
  // it would also have named the joiner, but only by mangling every emoji that
  // the list legitimately leaves alone.
  assert(strip(rendered) === family.replace(/‍/g, ""),
    `the emoji did not survive intact: ${JSON.stringify(rendered)}`);
  assert((rendered.match(/<U\+200D>/g) || []).length === 3,
    `the joiner is not named once per occurrence: ${JSON.stringify(rendered)}`);
});
console.log("\na write whose value cannot be shown is not a write you can approve");

// The card builder itself, with the collaborators it calls supplied — the
// three value/target helpers are the real ones, so what is under test is the
// gate in appendApprovalCard and not a copy of it.
function buildFullCard(frame) {
  const doc = fakeDocument();
  const createElement = doc.createElement;
  // Buttons hang click listeners; the fake element has nowhere to put one.
  doc.createElement = (tag) => {
    const n = createElement(tag);
    n.addEventListener = () => {};
    n.remove = () => {};
    n.dataset = {};
    return n;
  };
  globalThis.document = doc;
  const appended = [];
  const messagesEl = { querySelector: () => null, appendChild: (c) => appended.push(c) };
  const sent = [];
  const outcomes = [];
  const resolveCard = (card, cls, text) => {
    card.className = "approval-card resolved";
    outcomes.push({ cls, text });
  };
  const appendApprovalCard = new Function(
    "messagesEl", "NON_APPROVABLE_ACTIONS", "sendMessage", "console",
    "appendApprovalTarget", "appendApprovalValue", "approvalValueUnavailable",
    "approvalValueMasked", "resolveCard", "decisionLabel",
    `return (${sliceFunction("appendApprovalCard")})`,
  )(messagesEl, new Set(), (m) => { sent.push(m); return Promise.resolve({ success: true }); },
    console, appendApprovalTarget, appendApprovalValue, approvalValueUnavailable,
    approvalValueMasked, resolveCard, (d) => String(d));
  appendApprovalCard(frame);
  const card = appended[0];
  return { card, sent, outcomes };
}
const actionsIn = (card) => card && findEl(card, hasClass("approval-actions"));

// Replay's shape: the audit masked the value and left `text_chars` behind.
const MASKED = { x: 412, y: 288, label: "the cell C4", text: "[redacted]", text_chars: 5700 };

check("a type_xy whose value is unavailable carries no Approve", async () => {
  const { card, outcomes, sent } = buildFullCard({
    id: 7, reason: "the text shown below this card", action: { type: "type_xy" },
    screenshot: JPEG, viewport: LAPTOP, args: MASKED, url: "https://docs.google.com/",
  });
  await flush();
  assert(card, "the card was not rendered at all — the user is left with nothing");
  assert(!actionsIn(card), "the card still has an action row — it is answerable");
  assert(outcomes.length === 1, `expected one decision line, got ${outcomes.length}`);
  assert(/not recorded/i.test(outcomes[0].text) && /nothing to review/i.test(outcomes[0].text),
    `the card does not say why: ${JSON.stringify(outcomes[0].text)}`);
  // The server is ACK'd so a pending id is not left holding a reply nobody can
  // send — the same reason NON_APPROVABLE_ACTIONS denies rather than drops.
  assert(sent.length === 1 && sent[0].approved === false,
    `the server was not told: ${JSON.stringify(sent)}`);
});

check("a value lost with no length recorded is still denied", async () => {
  // `text_chars` is the producer's flag, not the only signal: a mask literal
  // with no count is the same failure.
  const { card, outcomes } = buildFullCard({
    id: 8, action: { type: "type_xy" }, screenshot: JPEG, viewport: LAPTOP,
    args: { x: 1, y: 1, label: "the cell", text: "[redacted typed secret]" },
  });
  await flush();
  assert(!actionsIn(card), "a masked value with no text_chars is still approvable");
  assert(outcomes.length === 1, "the denial line is missing");
});

check("a type_xy with a real value is still fully approvable", () => {
  // The regression guard. The gate must cost nothing on the live path, where
  // the frame carries the value and no `text_chars`.
  const { card, sent, outcomes } = buildFullCard({
    id: 9, reason: "the text shown below this card", action: { type: "type_xy" },
    screenshot: JPEG, viewport: LAPTOP, args: TYPE_ARGS, url: "https://docs.google.com/",
  });
  assert(actionsIn(card), "a normal type_xy card lost its Approve/Deny");
  assert(card.textContent.includes("Q3 reconciliation note."), "the value is no longer on the card");
  assert(outcomes.length === 0, `the live card was pre-resolved: ${JSON.stringify(outcomes)}`);
  assert(sent.length === 0, "the server was ACKed before the user answered");
});

check("a click_xy is untouched by the value gate", () => {
  const { card } = buildFullCard({
    id: 10, action: { type: "click_xy" }, screenshot: JPEG, viewport: LAPTOP, args: ARGS,
    url: "https://docs.google.com/",
  });
  assert(actionsIn(card), "a click_xy lost its Approve/Deny");
});

check("a canonical_approval with no args is still approvable", async () => {
  // The live regression. `canonical_approval` forwards `action` and nothing
  // else — no `args` — so a gate that reads "no args" as "the value was
  // masked" auto-denied every coordinate approval the frame could carry,
  // with a card the user cannot answer. Absent args are not evidence.
  const branch = /case 'canonical_approval': \{[\s\S]*?\n    \}/.exec(panel);
  assert(branch, "no `case 'canonical_approval'` — renamed?");
  assert(!/\bargs\b/.test(branch[0]),
    "the canonical_approval branch now forwards args; this test should be re-read");
  const { card, outcomes, sent } = buildFullCard({
    id: 11, reason: "Brotto is requesting approval for a sensitive action.",
    action: { type: "type_xy" },
  });
  await flush();
  assert(actionsIn(card), "a canonical_approval type_xy has no Approve/Deny — the feature is dead");
  assert(outcomes.length === 0, `it was pre-resolved: ${JSON.stringify(outcomes)}`);
  assert(sent.length === 0, `the server was ACKed before the user answered: ${JSON.stringify(sent)}`);
  assert(approvalValueMasked(undefined) === false, "a missing args reads as a mask");
});

check("a canonical_approval is denied when the frame really is masked", async () => {
  // The other half: the narrow predicate must still fire. A `type_xy` frame
  // carrying `text_chars` (set by `_scrubbed`, and now by the 8k cap) is a
  // mask signal whether or not the caller supplied args at all.
  const { card, outcomes } = buildFullCard({
    id: 12, action: { type: "type_xy" }, args: { text: "[redacted]", text_chars: 5700 },
  });
  await flush();
  assert(!actionsIn(card), "a masked value is still answerable");
  assert(outcomes.length === 1 && /nothing to review/i.test(outcomes[0].text),
    `the denial line is missing: ${JSON.stringify(outcomes)}`);
});

check("a value the audit cap truncated is unavailable, not the whole value", () => {
  // `_cap_deep` shortens `args.text` at MAX_FIELD_CHARS and used to leave no
  // marker, so a long paste came back as a silently shortened string under a
  // heading promising "the whole value, exactly as it will be written".
  // The producer now sets `text_chars` beside a truncated `args.text`.
  const truncated = { text: "x".repeat(8000), text_chars: 12345 };
  assert(approvalValueMasked(truncated) === true, "a truncated value does not read as a mask");
  assert(approvalValueUnavailable(truncated) === true, "a truncated value renders as the whole thing");
  const { card } = buildCard({ args: truncated, action: { type: "type_xy" } });
  const block = findEl(card, hasClass("approval-value-text"));
  assert(!block.textContent.includes("xxxx"), "the truncated string was drawn as the value");
  assert(/not recorded/i.test(block.textContent), "the block does not say the value is unavailable");
  const label = findEl(card, hasClass("approval-value-label"));
  assert(!/whole value|exactly as it will be written/.test(label.textContent),
    `the heading still promises the value: ${JSON.stringify(label.textContent)}`);
  // The producer side, read out of the audit module so it cannot drift.
  const audit = fs.readFileSync(
    path.join(__dirname, "..", "services", "brotto-orchestrator", "src",
      "brotto_orchestrator", "agent", "audit.py"), "utf8");
  assert(/capped_args\["text_chars"\] = len\(args\["text"\]\)/.test(audit),
    "audit.py no longer flags a capped args.text — the consumer is waiting on it");
});

console.log("\nthe regression that matters: every other approval is untouched");

check("an approval with no screenshot renders the ordinary card", () => {
  const doc = fakeDocument();
  globalThis.document = doc;
  const card = doc.createElement("div");
  // Exactly the frame the server has always sent.
  const shown = appendApprovalTarget(card, {
    screenshot: undefined, viewport: undefined, args: undefined, url: "https://example.com/",
  });
  assert(shown === false, "the plain card tried to draw a picture");
  assert(card.children.length === 0,
    `the plain card gained ${card.children.length} child nodes: ${card.children.map((c) => c.className).join(", ")}`);
});

check("the approval frame forwards the three new optional fields", () => {
  const branch = /case 'approval_request': \{[\s\S]*?\n    \}/.exec(panel);
  assert(branch, "no `case 'approval_request'` — renamed?");
  for (const f of ["screenshot: message.screenshot", "viewport: message.viewport", "args", "url: message.url"]) {
    assert(branch[0].includes(f), `the approval branch does not forward ${f}`);
  }
});

check("no second copy of the pixels is written anywhere", () => {
  // The card puts a data: URL in one <img>. Nothing else may persist it: the
  // IndexedDB mirror copies the server's audit document, not the panel DOM, so
  // the only copy of the page is the live node.
  const writes = [...panel.matchAll(/data:image\/jpeg;base64,[^`"']*/g)];
  assert(writes.length <= 1, `the base64 payload is interpolated ${writes.length} times`);
  // The only node that ever holds the pixels is the card's own <img>; every
  // other screenshot in the panel is a live one, never stored.
  assert(writes.every((w) => Math.abs(w.index - panel.indexOf("data:image/jpeg;base64,${screenshot}")) < 400),
    "the base64 payload is interpolated somewhere other than the card");
});

// The summary waits on the async checks: a test that has not settled has not
// reported, and a summary that prints first reports on nothing.
Promise.all(pending).then(() => {
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
});
check("a frame carrying no args at all is still answerable", async () => {
  // `canonical_approval` sends {id, reason, action} and no args. Treating a
  // missing args as a masked value auto-denied every such approval.
  const { card, outcomes } = buildFullCard({
    id: 9, reason: "Brotto is requesting approval for a sensitive action.",
    action: { type: "type_xy" },
  });
  await flush();
  assert(card, "no card was rendered");
  assert(outcomes.length === 0,
    `a frame with no args was auto-denied: ${JSON.stringify(outcomes)}`);
  assert(actionsIn(card), "a frame with no args lost its action row");
});

check("a real type_xy value is still approvable", async () => {
  const { card, outcomes } = buildFullCard({
    id: 10, reason: "the text shown below this card", action: { type: "type_xy" },
    screenshot: JPEG, viewport: LAPTOP,
    args: { x: 412, y: 288, label: "the cell C4", text: "Q3 revenue" },
    url: "https://docs.google.com/",
  });
  await flush();
  assert(outcomes.length === 0, `a live value was denied: ${JSON.stringify(outcomes)}`);
  assert(actionsIn(card), "a live value lost its action row");
});
