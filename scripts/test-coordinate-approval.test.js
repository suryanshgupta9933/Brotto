// A coordinate click is the one approval the user cannot check by reading.
//
// Everything else the panel asks permission for names its destination: a URL,
// an action, a form. A `click_xy` is a pair of numbers on a picture, and a
// canvas (Google Sheets, Figma) has no accessibility node to name — so this
// card is the entire safety story. Three things therefore have to hold, and
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
  const mk = (tag) => ({
    tagName: tag,
    className: "",
    textContent: "",
    style: {},
    children: [],
    appendChild(c) { this.children.push(c); return c; },
  });
  return { createElement: mk };
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
  return { card, shown, cross: card.children.find((c) => (c.className || "").includes("approval-cross")) };
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