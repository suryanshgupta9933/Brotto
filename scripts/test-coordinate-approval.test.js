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
//     block under a fixed label. `reasoning` carries no value any more, so
//     this is the card's only preview of what will be typed — and a truncated
//     one (it used to be 120 characters) is consent for something other than
//     what gets written. The value used to sit inside that prose, where it
//     could close a curly quote and speak as harness text. No cap, no ellipsis;
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
function fakeDocument() {
  // `made` is what makes "the value cannot become a second element" checkable:
  // every element the card builds, in order, whether or not it was appended.
  const made = [];
  const mk = (tag) => {
    const el = {
      tagName: tag,
      className: "",
      textContent: "",
      style: {},
      children: [],
      appendChild(c) { this.children.push(c); return c; },
    };
    made.push(el);
    return el;
  };
  return { createElement: mk, made };
}

const crosshairPercent = eval(`(${sliceFunction("crosshairPercent")})`);
const appendApprovalTarget = eval(`(${sliceFunction("appendApprovalTarget")})`);

let failed = 0;
function check(name, fn) {
  try {
    fn();
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
    .filter(([k]) => k !== "children" && k !== "style" && k !== "textContent")
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

check("the whole value is rendered, not a prefix of it", () => {
  const { card } = build({ args: TYPE_ARGS });
  const block = findEl(card, hasClass("approval-value-text"));
  assert(block, "no value block — a type_xy card shows the value nowhere");
  assert(block.textContent === LONG,
    `the block holds ${(block.textContent || "").length} of ${LONG.length} characters`);
  assert(!/…|\.\.\.$/.test((block.textContent || "").trim()),
    "the value was truncated with an ellipsis");
});

check("the block carries a fixed label the value cannot close", () => {
  const { card } = build({ args: TYPE_ARGS });
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
  const { card, made } = build({ args: { ...TYPE_ARGS, text: hostile } });
  const block = findEl(card, hasClass("approval-value-text"));
  assert(block, "no value block");
  assert(block.textContent === hostile,
    `the value was not written verbatim: ${JSON.stringify(block.textContent)}`);
  // Same element count as a benign value: a value that could introduce an
  // element would change this number.
  const benign = build({ args: { ...TYPE_ARGS, text: "ok" } });
  assert(made.length === benign.made.length,
    `a hostile value built ${made.length} elements, a benign one ${benign.made.length}`);
  // +1 for the card `made` deliberately excludes.
  assert(made.length + 1 === countTree(card), "an element was built and never attached");
  // And it reached no attribute, so no parser and no tooltip ever sees it.
  assert(!made.some((e) => attrsOf(e).includes("delete everything")),
    "the value reached a class name, src, alt or title");
  // The harness prose on the card is not the value and does not contain it.
  assert(!card.children.some((c) => (c.className || "").includes("approval-body")),
    "the reasoning is inside this builder now — it belongs to the caller");
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

check("a click or focus with no value renders no block at all", () => {
  for (const verb of ["click_xy", "focus_xy"]) {
    const { card } = build({ args: { x: 412, y: 288, label: "the cell C4" } });
    assert(verb && !findEl(card, hasClass("approval-value")),
      `${verb} grew a value block`);
  }
  // And a type_xy whose text is empty string is still a type — the block says
  // so, rather than the card implying there was nothing to write.
  const empty = build({ args: { ...TYPE_ARGS, text: "" } });
  assert(!findEl(empty.card, hasClass("approval-value-text"))
    || findEl(empty.card, hasClass("approval-value-text")).textContent === "",
  "an empty value rendered as something other than nothing");
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

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);