// The live cursor must not be an occluder.
//
// `scripts/test-observation-geometry.test.js` records the failure this feature
// is prone to (landmine 7 in the plan): the marker lands in the page, so
// `document.elementFromPoint` inside `BOX_WALK` can see it and mark the
// element beneath it `occluded` — breaking the very click the cursor is
// announcing. Both the draw snippet and `BOX_WALK` are sliced out of the
// shipped source and run against one shared fake page, so the case below is the
// real interaction and not a restatement of it.
//
// What is asserted is mostly *absence*: the target is clickable with the marker
// up, and nothing in the extension ever removes the marker — it is the user's
// only way to see where the agent is clicking.
//
//   node --test scripts/test-cursor.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXT = path.join(__dirname, "..", "clients", "brotto-extension");
const SRC = path.join(EXT, "src", "observation", "pointer.ts");
const GEO = path.join(EXT, "src", "observation", "geometry.ts");
const src = fs.readFileSync(SRC, "utf8");
const geo = fs.readFileSync(GEO, "utf8");

// Template literals: sliced between the backticks, never copied.
function extractTemplate(name, from = src) {
  const marker = `const ${name} = \``;
  const start = from.indexOf(marker);
  if (start < 0) throw new Error(`no template const ${name} — renamed?`);
  const end = from.indexOf("`;", start);
  if (end < 0) throw new Error(`unterminated template ${name}`);
  return from.slice(start + marker.length, end);
}

// Bodies, by brace matching, so they stay plain JavaScript when evaluated.
function extractBody(name) {
  const start = src.search(new RegExp(`^(export )?(async )?function ${name}\\s*\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} — renamed?`);
  const open = src.indexOf("{", start);
  if (src.slice(start, open).includes("}")) throw new Error(`${name}'s signature has braces`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`unterminated function ${name}`);
}

const CURSOR_ID = src.match(/^export const CURSOR_ID = "(.*)";$/m)[1];
const MAX_CURSOR_LABEL = src.match(/^export const MAX_CURSOR_LABEL = (\d+);$/m)[1];
// The one `${…}` the sliced literal carries, resolved the way TypeScript
// resolves it — so the cap the snippet enforces is the constant, not a copy.
const DRAW_CURSOR = extractTemplate("DRAW_CURSOR").replace("${MAX_CURSOR_LABEL}", MAX_CURSOR_LABEL);
const BOX_WALK = extractTemplate("BOX_WALK", geo);

// ── one fake page, shared by both snippets ─────────────────────────────────

// A node answers what BOX_WALK reads (`children`, `getClientRects`,
// `getBoundingClientRect`, `contains`) and what the draw snippet reads
// (`style`, `parentNode`, `appendChild`). Its box comes from its inline
// `left/top/width/height` styles, which is how a marker the draw snippet
// created becomes a hit-test candidate at all — without that, the absence
// below would pass for the wrong reason.
function node(tag, box, style = {}) {
  const self = {
    tagName: tag.toUpperCase(),
    nodeType: 1,
    children: [],
    parentNode: null,
    style: { ...style },
    _box: box,
    _attrs: {},
    setAttribute(k, v) { self._attrs[k] = String(v); },
    getAttribute(k) { return k in self._attrs ? self._attrs[k] : null; },
    getClientRects: () => (box ? [{ width: 1 }] : []),
    getBoundingClientRect: () => self._box || { left: 0, right: 0, top: 0, bottom: 0 },
    contains: (other) => allNodes.includes(other) && subtree(self).includes(other),
    appendChild(child) {
      const i = self.children.indexOf(child);
      if (i >= 0) self.children.splice(i, 1);
      self.children.push(child);
      child.parentNode = self;
      allNodes.push(child);
      registry.set(child.id, child);
      return child;
    },
    removeChild(child) {
      const i = self.children.indexOf(child);
      if (i >= 0) self.children.splice(i, 1);
      child.parentNode = null;
      allNodes.splice(allNodes.indexOf(child), 1);
      registry.delete(child.id);
      return child;
    },
  };
  // Styles override the spec box, so a `fixed` marker lands where it was told.
  const px = (v) => (typeof v === "string" ? parseFloat(v) : NaN);
  Object.defineProperty(self, "_liveBox", {
    get() {
      const l = px(self.style.left), t = px(self.style.top);
      const w = px(self.style.width), h = px(self.style.height);
      if ([l, t, w, h].some(Number.isNaN)) return self._box;
      return { left: l, top: t, right: l + w, bottom: t + h };
    },
  });
  return self;
}

function subtree(n) {
  return [n, ...n.children.flatMap(subtree)];
}

let allNodes = [];
let registry = new Map();

function makePage() {
  allNodes = [];
  registry = new Map();
  const button = node("button", { left: 100, right: 200, top: 100, bottom: 140 });
  const iframe = node("iframe", { left: 300, right: 900, top: 100, bottom: 400 });
  const body = node("body", { left: 0, right: 1000, top: 0, bottom: 800 });
  body.appendChild(button);
  body.appendChild(iframe);
  allNodes.push(button, iframe, body);

  const doc = {
    nodeType: 9,
    children: [body],
    body,
    createElement: (tag) => node(tag, null),
    getElementById: (id) => registry.get(id) ?? null,
    elementFromPoint(x, y) {
      const area = (r) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
      const at = allNodes.filter((n) => {
        // The browser's own rule: a `pointer-events: none` element is not a
        // hit-test candidate at all. Modelled here because it is the entire
        // mechanism — a marker that is merely painted on top would still
        // occlude.
        if (n.style && n.style.pointerEvents === "none") return false;
        const r = n._liveBox;
        return r && area(r) > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      });
      if (!at.length) return null;
      return at.reduce((a, b) => (area(a._liveBox) <= area(b._liveBox) ? a : b));
    },
  };
  body.parentNode = doc;
  return { doc, button, iframe, body };
}

// The sandbox the draw snippet and BOX_WALK both run in: one `document`, one
// window. If the marker were not `pointer-events: none` the resolver below
// would still return it, because the fake resolves purely by geometry — which
// is the point: the *style* is what has to make the hit test skip it, exactly
// as it does in Chrome.
function sandboxFor(page, width = 1000, height = 800) {
  const sandbox = { document: page.doc, window: { innerWidth: width, innerHeight: height }, String, JSON, Math, console };
  return {
    draw: vm.runInNewContext("(" + DRAW_CURSOR + ")", sandbox),
    walk: vm.runInNewContext("(" + BOX_WALK + ")", sandbox),
  };
}

// ── assertions ─────────────────────────────────────────────────────────────

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(`FAIL  ${name}\n      ${detail}`); }
}

(async () => {
  console.log("the cursor is not an occluder");

  // 0. Baseline. Nothing drawn: the button at (150,120) is clickable.
  {
    const page = makePage();
    const { walk } = sandboxFor(page);
    const out = walk.call(page.doc, [[0, 0]]);
    check("baseline: the target under the point is clickable",
      out[0] && out[0].x === 150 && out[0].y === 120,
      `BOX_WALK answered ${JSON.stringify(out[0])} with no marker drawn`);
  }

  // 1. With the marker up, the hit test must still reach the element beneath.
  //    Red before the pointer-events line existed: the marker is the innermost
  //    thing at the point and BOX_WALK answers `occluded`.
  {
    const page = makePage();
    const { draw, walk } = sandboxFor(page);
    const drawn = draw(150, 120, "the cell C4", CURSOR_ID);
    check("the marker draws", drawn.drawn === true, `draw answered ${JSON.stringify(drawn)}`);
    const marker = page.doc.getElementById(CURSOR_ID);
    check("the marker is in the document", !!marker, "no element with the cursor id");
    check("the marker declares pointer-events: none",
      marker && marker.style.pointerEvents === "none",
      `pointer-events is ${marker && marker.style.pointerEvents} — BOX_WALK will see this as an occluder`);
    const out = walk.call(page.doc, [[0, 0]]);
    check("with the marker up, the target is still clickable",
      out[0] && out[0].x === 150 && out[0].y === 120,
      `BOX_WALK answered ${JSON.stringify(out[0])} with the marker drawn — the cursor is occluding the click it announces`);
  }

  // 2. The label is bounded, and it is not in the page's text.
  //
  //    The marker stays up, so its words would otherwise sit in the page text
  //    the model reads (`document.body.innerText`) and in the accessibility tree
  //    the observation is built from — the model would read the agent's own
  //    annotation as if it were the page's. So the words live in `data-label`
  //    and are rendered by a `::after` rule: a pseudo-element's content is not
  //    a text node, so it is in neither.
  {
    const page = makePage();
    const { draw } = sandboxFor(page);
    draw(150, 120, "x".repeat(500) + "<img src=x onerror=1>", CURSOR_ID);
    const label = page.doc.getElementById(CURSOR_ID + "-label");
    const cap = src.match(/^export const MAX_CURSOR_LABEL = (\d+);$/m)[1];
    const words = label ? (label.getAttribute("data-label") || "") : "";
    check("the label is capped", words.length === Number(cap),
      `label is ${words.length} chars, cap is ${cap}`);
    check("the label carries no text node", label && !label.textContent,
      `the label has text content: ${JSON.stringify(label && label.textContent)}`);
    check("the label is textContent, never innerHTML",
      label && label.innerHTML === undefined, "the label element exposes innerHTML");
    check("the label is pointer-events: none too",
      label && label.style.pointerEvents === "none", "only the dot was made transparent to the hit test");
    check("the label is hidden from the accessibility tree",
      label && label.getAttribute("aria-hidden") === "true",
      "aria-hidden is what keeps the label out of the AX tree the observation is built from");
    const dot = page.doc.getElementById(CURSOR_ID);
    check("the dot is hidden from the accessibility tree too",
      dot && dot.getAttribute("aria-hidden") === "true", "the dot exposes an empty node to the AX tree");
    const sheet = page.doc.getElementById(CURSOR_ID + "-style");
    check("the label's rule is a stylesheet, not a text node",
      sheet && typeof sheet.textContent === "string" && sheet.textContent.includes("attr(data-label)"),
      "the rule that renders the words was not written");
  }

  // 3. A second draw replaces the first: two markers is one occluder too many,
  //    and this is the whole "idempotent" claim.
  {
    const page = makePage();
    const { draw } = sandboxFor(page);
    draw(150, 120, "first", CURSOR_ID);
    draw(160, 130, "second", CURSOR_ID);
    // button, iframe, style, dot, label — the first two are the page's own.
    check("a redraw leaves one marker", page.body.children.length === 5,
      `body has ${page.body.children.length} children: ${page.body.children.map((c) => c.id).join(", ")}`);
  }

  // 4. The marker is never removed. There is no path that takes it away: the
  //    next click *moves* it, and the only thing that ends it is the page going
  //    away — so an overlay can never be orphaned across a navigation, because
  //    it cannot outlive the document it lives in.
  {
    check("nothing in the extension removes the marker",
      !src.includes("CLEAR_CURSOR") && !src.includes("clearCursor"),
      "the pointer module still has a path that removes the marker");
    const bg = fs.readFileSync(path.join(EXT, "src", "background.ts"), "utf8");
    check("nothing in the background removes the marker either",
      !bg.includes("clearCursor"), "background.ts still clears the marker");
  }

  // 5. A point inside an iframe is another document. The draw must say so
  //    rather than draw a marker into the top frame and look like it worked.
  {
    const page = makePage();
    const { draw } = sandboxFor(page);
    const drawn = draw(400, 200, "the cell C4", CURSOR_ID);
    check("an iframe point is reported, not silently drawn",
      drawn.drawn === false && drawn.reason === "foreign-frame",
      `draw answered ${JSON.stringify(drawn)} over an iframe`);
    check("nothing was appended over the iframe", !page.doc.getElementById(CURSOR_ID),
      "a marker was appended anyway, where nobody would see it");
  }

  console.log("\nthe wire coordinate is bounded against the live viewport");
  {
    const BODIES = {
      liveViewport: extractBody("liveViewport"),
      boundedPoint: extractBody("boundedPoint"),
    };
    const calls = [];
    const mk = (viewport) => {
      calls.length = 0;
      const mod = vm.runInNewContext(
        `(function () {
           const anyCommand = (async function (tabId, command) { return await dbg.sendCommand(tabId, command); });
           const liveViewport = (async function (tabId) { ${BODIES.liveViewport} });
           const boundedPoint = (async function (tabId, x, y) { ${BODIES.boundedPoint} });
           return { liveViewport, boundedPoint };
         })()`,
        {
          dbg: {
            sendCommand: async (_tabId, cmd) => {
              calls.push(cmd.method);
              if (cmd.method === "Page.getLayoutMetrics") {
                if (viewport === "throw") throw new Error("no target");
                return viewport === null ? {} : { cssLayoutViewport: { clientWidth: viewport[0], clientHeight: viewport[1] } };
              }
              return {};
            },
          },
          Math, isFinite, console,
        },
      );
      return mod;
    };

    const inb = await mk([1512, 982]).boundedPoint(1, 412, 288);
    check("a point inside the viewport passes", inb && inb.x === 412 && inb.y === 288,
      `boundedPoint answered ${JSON.stringify(inb)}`);
    check("the bound came from the live page, not the frame",
      calls[0] === "Page.getLayoutMetrics", `called ${JSON.stringify(calls)}`);

    const outside = await mk([1512, 982]).boundedPoint(1, 1512, 288);
    check("x == width is outside (half-open, as BOX_WALK has it)", outside === null,
      `boundedPoint answered ${JSON.stringify(outside)}`);
    const neg = await mk([1512, 982]).boundedPoint(1, -1, 5);
    check("a negative coordinate is refused", neg === null, `boundedPoint answered ${JSON.stringify(neg)}`);
    const str = await mk([1512, 982]).boundedPoint(1, "412", 288);
    check("a string coordinate is refused", str === null, `boundedPoint answered ${JSON.stringify(str)}`);
    const nan = await mk([1512, 982]).boundedPoint(1, NaN, 288);
    check("NaN is refused", nan === null, `boundedPoint answered ${JSON.stringify(nan)}`);
    const inf = await mk([1512, 982]).boundedPoint(1, Infinity, 288);
    check("Infinity is refused", inf === null, `boundedPoint answered ${JSON.stringify(inf)}`);
    const noVp = await mk("throw").boundedPoint(1, 10, 10);
    check("an unreadable viewport refuses rather than trusting the frame", noVp === null,
      `boundedPoint answered ${JSON.stringify(noVp)}`);
  }

  console.log(failures === 0 ? "\nall cursor cases pass" : `\n${failures} failing`);
  process.exit(failures === 0 ? 0 : 1);
})();