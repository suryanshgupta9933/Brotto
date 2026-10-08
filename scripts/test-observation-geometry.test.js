// Geometry in bulk.
//
// `targetsForFrame` used to call `DOM.getBoxModel` once per kept AX node,
// serially, inside the loop. The Gmail search step measured 608 targets, so
// every observation of every task paid 608 serialised round trips. This
// replaces them with three.
//
// Two of the five cases below are about *absences*, which is why they are
// tested at all:
//
//   - a node the bulk walk cannot reach falls back to the per-node call. A
//     wrong x/y clicks the wrong element; a missing one renders the target
//     off-screen, which is what happens today and is a far cheaper failure.
//   - an element with no box must be *absent* from the map, not 0,0. (0,0) is
//     the top-left corner of the viewport, and every display:none control on
//     the page would become a click in the same place.
//
// The functions are extracted from TypeScript source by brace matching (the
// pattern test-observation-surfaces.test.js uses) so these cases test the text
// that ships. A dropped field is an absence that reads clean in a diff.
//
//   node --test scripts/test-observation-geometry.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src", "observation", "geometry.ts");
const src = fs.readFileSync(SRC, "utf8");

// Returns the function *body* only, so the extracted text is plain JS. The
// signatures are deliberately brace-free for this reason.
function extract(name) {
  const start = src.search(new RegExp(`^(export )?(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} — renamed?`);
  const open = src.indexOf("{", start);
  if (src.slice(start, open).includes("}")) {
    throw new Error(`${name}'s signature has braces in it; extraction would match the wrong one`);
  }
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`unterminated function ${name}`);
}

function extractConst(name) {
  const start = src.search(new RegExp(`^const ${name} = `, "m"));
  if (start < 0) throw new Error(`no const ${name} — renamed?`);
  const line = src.slice(start, src.indexOf("\n", start));
  return line.slice(line.indexOf("=") + 1).replace(/;\s*$/, "").replace(/\s*as const$/, "").trim();
}

// BOX_WALK is a multi-line template literal, so the single-line const reader
// won't take it. Sliced from source rather than restated here: the page-side
// function is the one piece of this that runs in someone else's context, and
// a copy in the test could drift from the copy that ships without failing.
function extractTemplate(name) {
  const marker = `const ${name} = \``;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`no template const ${name} — renamed?`);
  const end = src.indexOf("`;", start);
  if (end < 0) throw new Error(`unterminated template ${name}`);
  return src.slice(start + marker.length, end);
}

const BODIES = {
  reachablePaths: extract("reachablePaths"),
  boxMap: extract("boxMap"),
};
const CONSTS = {
  MAX_GEOMETRY_ENTRIES: extractConst("MAX_GEOMETRY_ENTRIES"),
};
const BOX_WALK = extractTemplate("BOX_WALK");

// The page-side walk lives in geometry.ts, but `pooled` and `CDP_CONCURRENCY`
// are the shared CDP helpers in surfaces.ts. Extracted from there too, so the
// fallback this file measures is the fallback that ships.
const SURFACES_SRC = path.join(path.dirname(SRC), "surfaces.ts");
const surfacesSrc = fs.readFileSync(SURFACES_SRC, "utf8");

function extractFrom(source, name) {
  const start = source.search(new RegExp(`^(export )?(async )?function ${name}\\s*(<[^>(]*>)?\\s*\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} — renamed?`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unterminated function ${name}`);
}
const POOLED_BODY = extractFrom(surfacesSrc, "pooled");
const CDP_CONCURRENCY = vm.runInNewContext(
  surfacesSrc.match(/^export const CDP_CONCURRENCY = (.*);$/m)[1],
);

// The wrapper every case runs in: the extracted bodies, bound to a fake dbg.
function moduleFor(dbgImpl, opts = {}) {
  // Evaluated, not spread as text: `"2000" > 600` happens to be true in
  // JavaScript, and a cap that only works by coercion is not a cap.
  const consts = {};
  for (const k of Object.keys(CONSTS)) consts[k] = vm.runInNewContext(CONSTS[k]);
  const sandbox = {
    ...consts,
    CDP_CONCURRENCY,
    BOX_WALK,
    dbg: { sendCommand: dbgImpl },
    JSON, Math, Set, Map, String, Array, console, Promise,
  };
  return vm.runInNewContext(
    `(function () {
       const anyCommand = (async function (tabId, command) { return await dbg.sendCommand(tabId, command); });
       const pooled = (async function (items, limit, fn) { ${POOLED_BODY} });
       const reachablePaths = (function (root, wanted) { ${BODIES.reachablePaths} });
       const boxMap = (async function (tabId, backendNodeIds) { ${BODIES.boxMap} });
       return { reachablePaths, boxMap };
     })()`,
    sandbox,
  );
}

// ── DOM builders ────────────────────────────────────────────────────────────

// A CDP node. `nodeType` 1 = element, 3 = text, 9 = document.
function el(backendNodeId, children = [], extra = {}) {
  return { nodeType: 1, backendNodeId, children, ...extra };
}
function text(backendNodeId) {
  return { nodeType: 3, backendNodeId, children: [] };
}
function doc(children) {
  return { nodeType: 9, backendNodeId: 1, children };
}

// The fake page: answers the `Runtime.callFunctionOn` the way Chrome would,
// by walking `children` with the same element-index arithmetic BOX_WALK uses.
// A spec may carry `blocked`, standing in for what BOX_WALK itself decides
// inside the page — the join only cares about the shape of the answer.
function pageFor(nodesById) {
  return (paths) =>
    paths.map((p) => {
      let cur = { children: nodesById };
      for (const i of p) {
        if (!cur || !cur.children || i >= cur.children.length) return null;
        cur = cur.children[i];
      }
      if (!cur || cur.noBox) return null;
      if (cur.blocked) return { blocked: cur.blocked };
      return { x: cur.x, y: cur.y };
    });
}

// ── assertions ──────────────────────────────────────────────────────────────

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}\n      ${detail}`);
  }
}

// ── the page-side function, on its own ──────────────────────────────────────

// Runs BOX_WALK as the browser would: `this` is the Document node, and every
// element answers `children`, `getClientRects`, `getBoundingClientRect` and
// `contains`. The sandbox supplies the two globals the hit test reads — the
// window it checks against, and the page's own `elementFromPoint`.
//
// The hit resolver is a real one, not a stub that answers what the case wants.
// Among the boxes containing the point it returns the innermost (smallest area),
// which is how a browser resolves a point that lands on a child — and a spec
// marked `top: true` always wins, which is how a sticky header, a modal
// backdrop or a parent that paints over its child is modelled. A stub would let
// the cases pass while the real comparison in BOX_WALK went untested, and that
// comparison is the whole mechanism: it is what turns a silent dead click into
// a refusal.
//
// `contains` is a subtree test over the built tree, not a set of everything on
// the page — a flat set would report a banner as a descendant of every element
// under it and quietly turn every occlusion back into a hit.
function runBoxWalk(rootChildren, { paths, width = 1280, height = 800, overlay = false } = {}) {
  const all = [];
  const area = (r) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
  function build(spec) {
    const self = {
      getClientRects: () => (spec.noBox ? [] : [{ width: 10 }]),
      getBoundingClientRect: () => spec.box ?? { left: 0, right: 0, top: 0, bottom: 0 },
    };
    self.children = (spec.children ?? []).map(build);
    self.contains = (other) => self._subtree.includes(other);
    self._top = !!spec.top;
    self._subtree = [self, ...self.children.flatMap((c) => c._subtree)];
    all.push(self);
    return self;
  }
  const built = rootChildren.map(build);
  const root = { nodeType: 9, children: built };
  if (overlay) {
    const banner = { _top: true, contains: () => false, getBoundingClientRect: () => ({ left: 0, right: width, top: 0, bottom: height }) };
    all.push(banner);
  }
  const sandbox = {
    window: { innerWidth: width, innerHeight: height },
    document: {
      elementFromPoint: (x, y) => {
        const at = [];
        for (const n of all) {
          if (!n.getBoundingClientRect) continue;
          const r = n.getBoundingClientRect();
          if (area(r) === 0) continue;
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) at.push(n);
        }
        if (!at.length) return null;
        const forced = at.filter((n) => n._top);
        if (forced.length) return forced[forced.length - 1];
        return at.reduce((a, b) => (area(a.getBoundingClientRect()) <= area(b.getBoundingClientRect()) ? a : b));
      },
    },
  };
  const walk = vm.runInNewContext("(" + BOX_WALK + ")", sandbox);
  return walk.call(root, paths ?? rootChildren.map((_, i) => [i]));
}

(async () => {
  console.log("bulk geometry");

  const walk = vm.runInNewContext("(" + BOX_WALK + ")");

  // 0. The page-side function, before anything depends on it. A zero-checked
  //    getClientRects() is the whole reason a display:none control is absent
  //    rather than at (0,0).
  {
    const out = runBoxWalk([
      { box: { left: 10, right: 30, top: 20, bottom: 60 } },
      { noBox: true },
    ]);
    check("a laid-out element yields its centre",
      out[0] && out[0].x === 20 && out[0].y === 40,
      `first rect was ${JSON.stringify(out[0])}`);
    check("an element with no box yields nothing, not (0,0)",
      out[1] === null || out[1] === undefined,
      `second rect was ${JSON.stringify(out[1])} — (0,0) is a click in the viewport corner`);
    check("a path that walks off the tree yields nothing",
      walk.call({ nodeType: 9, children: [] }, [[7]])[0] == null,
      "an out-of-range path did not fail closed");
  }

  // 0b. Having a box is not the same as being clickable. This is the whole
  //     point of the change: an element scrolled past the fold still has
  //     client rects, so the old walk emitted a coordinate for it, the relay
  //     clicked a point that is over nothing, and the click reported success.
  //     Ten such clicks are session a7328461's entire failure.
  {
    const off = runBoxWalk([
      { box: { left: 10, right: 30, top: 900, bottom: 940 } },
    ]);
    check("an element below the fold is blocked off-screen, not given a coordinate",
      off[0] && off[0].blocked === "off-screen" && off[0].x === undefined,
      `below the fold was ${JSON.stringify(off[0])}`);

    const above = runBoxWalk([
      { box: { left: 10, right: 30, top: -60, bottom: -20 } },
    ]);
    check("…and one above it too, because the window is not only the bottom edge",
      above[0] && above[0].blocked === "off-screen",
      `above the fold was ${JSON.stringify(above[0])}`);

    const covered = runBoxWalk([
      { box: { left: 10, right: 30, top: 20, bottom: 60 } },
    ], { overlay: true });
    check("a control under a banner is blocked occluded",
      covered[0] && covered[0].blocked === "occluded",
      `under an overlay was ${JSON.stringify(covered[0])}`);

    // The comparison that must NOT fire: a point landing on a child of the
    // element is a hit on the element. Refusing here would refuse every label,
    // icon and span inside every button on the page.
    const nested = runBoxWalk([
      { box: { left: 10, right: 30, top: 20, bottom: 60 }, children: [{ box: { left: 12, right: 28, top: 30, bottom: 50 } }] },
    ]);
    check("a point landing on a child is a hit on the parent, not an occlusion",
      nested[0] && nested[0].x === 20 && nested[0].y === 40,
      `a nested hit was ${JSON.stringify(nested[0])}`);

    // …and the reverse. Clicking an ancestor is not clicking the element under
    // it, which is why the source checks `el.contains(hit)` and not the reverse.
    const under = runBoxWalk([
      { box: { left: 10, right: 30, top: 20, bottom: 60 }, top: true, children: [{ box: { left: 12, right: 28, top: 30, bottom: 50 } }] },
    ], { paths: [[0, 0]] });
    check("a point landing on an ancestor is an occlusion, not a hit",
      under[0] && under[0].blocked === "occluded",
      `an ancestor hit was ${JSON.stringify(under[0])}`);
  }

  // 1. THE POINT OF THE TASK. 600 nodes, three CDP calls.
  {
    const N = 600;
    const nodes = [];
    const wanted = [];
    for (let i = 0; i < N; i++) {
      const backendNodeId = 100 + i;
      wanted.push(backendNodeId);
      nodes.push({ backendNodeId, x: i * 2, y: i * 3, noBox: false });
    }
    const calls = [];
    const mod = moduleFor(async (_t, cmd) => {
      calls.push(cmd);
      if (cmd.method === "DOM.getDocument") return { root: doc(nodes.map((n) => el(n.backendNodeId))) };
      if (cmd.method === "DOM.resolveNode") return { object: { objectId: "obj-1" } };
      if (cmd.method === "Runtime.callFunctionOn") return { result: { value: pageFor(nodes)(cmd.params.arguments[0].value) } };
      if (cmd.method === "DOM.getBoxModel") throw new Error("bulk path should have covered this");
      return {};
    });

    const out = await mod.boxMap(7, wanted);
    check(`600 nodes cost three CDP calls, not ${N}`, calls.length === 3,
      `sent ${calls.length}: ${calls.map((c) => c.method).join(", ")}`);
    check("…and they are the three the plan names",
      calls.map((c) => c.method).join(",") === "DOM.getDocument,DOM.resolveNode,Runtime.callFunctionOn",
      `methods were ${calls.map((c) => c.method).join(",")}`);
    check("…and every node has a centre", out.boxes.size === N,
      `${out.boxes.size} of ${N} resolved`);
    check("…with no per-node fallback charged",
      out.fallback === 0 && out.source === "bulk",
      `source=${out.source} fallback=${out.fallback}`);
    check("…and the map is keyed by backendNodeId, so the caller can join it",
      out.boxes.get(100) && out.boxes.get(100).x === 0 && out.boxes.get(100).y === 0
        && out.boxes.get(N + 99).x === (N - 1) * 2,
      `get(100)=${JSON.stringify(out.boxes.get(100))} get(${N + 99})=${JSON.stringify(out.boxes.get(N + 99))}`);
  }

  // 2. The join only holds for nodes the page-side walk can reach. Anything
  //    else falls back to the per-node call, which is what costs a round trip
  //    today. Losing a coordinate is survivable; inventing one is not.
  {
    const calls = [];
    // 201 is an AX node whose backendNodeId is not in the pierced document at
    // all — a node in a shadow root, or a document that changed under us.
    const nodes = [el(200)];
    const mod = moduleFor(async (_t, cmd) => {
      calls.push(cmd);
      if (cmd.method === "DOM.getDocument") return { root: doc(nodes) };
      if (cmd.method === "DOM.resolveNode") return { object: { objectId: "obj-1" } };
      if (cmd.method === "Runtime.callFunctionOn") return { result: { value: [{ x: 5, y: 7 }] } };
      if (cmd.method === "DOM.getBoxModel") return { model: { content: [0, 0, 10, 10] } };
      return {};
    });
    const out = await mod.boxMap(7, [200, 201]);
    const boxes = calls.filter((c) => c.method === "DOM.getBoxModel");
    check("a node missing from the bulk map falls back to DOM.getBoxModel",
      boxes.length === 1 && boxes[0].params.backendNodeId === 201,
      `fallback calls were ${JSON.stringify(boxes.map((c) => c.params))}`);
    check("…and it still gets its coordinates",
      out.boxes.get(200).x === 5 && out.boxes.get(201).x === 5,
      `boxes were ${JSON.stringify([...out.boxes])}`);
    check("…and the fallback is reported", out.fallback === 1,
      `fallback was ${out.fallback}`);
  }

  // 3. The bulk path failing outright must cost the old price, not the step.
  {
    const calls = [];
    const mod = moduleFor(async (_t, cmd) => {
      calls.push(cmd);
      if (cmd.method === "DOM.getDocument") throw new Error("target closed");
      if (cmd.method === "DOM.getBoxModel") {
        return { model: { content: [0, 0, cmd.params.backendNodeId, 2] } };
      }
      return {};
    });
    const out = await mod.boxMap(7, [11, 22, 33]);
    const boxes = calls.filter((c) => c.method === "DOM.getBoxModel");
    check("a failed bulk path falls back for every node",
      boxes.length === 3 && out.boxes.size === 3,
      `${boxes.length} fallbacks, ${out.boxes.size} boxes`);
    check("…and the observation still completes", out.source === "failed" && out.requested === 3,
      `result was ${JSON.stringify({ source: out.source, requested: out.requested })}`);
    check("…and the coordinates are the ones getBoxModel gave",
      out.boxes.get(22).x === 11 && out.boxes.get(22).y === 1,
      `get(22) was ${JSON.stringify(out.boxes.get(22))}`);
  }

  // 3b. Bulk succeeds but the join finds nothing — the case where the
  //     backendNodeId spaces turn out not to match. Same guarantee.
  {
    const calls = [];
    const mod = moduleFor(async (_t, cmd) => {
      calls.push(cmd);
      if (cmd.method === "DOM.getDocument") return { root: doc([el(9001), el(9002)]) };
      if (cmd.method === "DOM.resolveNode") return { object: { objectId: "obj-1" } };
      if (cmd.method === "Runtime.callFunctionOn") return { result: { value: [] } };
      if (cmd.method === "DOM.getBoxModel") return { model: { content: [2, 2, 4, 6] } };
      return {};
    });
    const out = await mod.boxMap(7, [1, 2, 3]);
    check("a join that matches nothing falls back rather than dropping coordinates",
      out.boxes.size === 3 && out.source === "no-join",
      `size=${out.boxes.size} source=${out.source}`);
  }

  // 4. An element with no box. Today `getBoxModel` throws or returns no model
  //    and the target is emitted without x/y. The bulk path must not invent a
  //    (0,0) for it, and the fallback must not either.
  {
    const calls = [];
    const nodes = [{ backendNodeId: 300, noBox: true }];
    const mod = moduleFor(async (_t, cmd) => {
      calls.push(cmd);
      if (cmd.method === "DOM.getDocument") return { root: doc([el(300)]) };
      if (cmd.method === "DOM.resolveNode") return { object: { objectId: "obj-1" } };
      if (cmd.method === "Runtime.callFunctionOn") return { result: { value: pageFor(nodes)(cmd.params.arguments[0].value) } };
      if (cmd.method === "DOM.getBoxModel") throw new Error("Could not compute box model.");
      return {};
    });
    const out = await mod.boxMap(7, [300]);
    check("an element with no box has no entry", out.boxes.has(300) === false,
      `map held ${JSON.stringify([...out.boxes])}`);
    check("…so the target is emitted without x/y, as today",
      out.boxes.get(300) === undefined,
      "a 0,0 here is a click in the viewport corner");
    check("…and the per-node fallback is still tried first", out.fallback === 1,
      `fallback was ${out.fallback}`);
  }

  // 5. The cap. Written down and enforced is the only kind that exists; the
  //    ids past it fall back, so a cap never costs a coordinate.
  {
    const N = 2100;
    const wanted = [];
    const nodes = [];
    for (let i = 0; i < N; i++) {
      const backendNodeId = 1000 + i;
      wanted.push(backendNodeId);
      nodes.push({ backendNodeId, x: i, y: i, noBox: false });
    }
    const calls = [];
    const mod = moduleFor(async (_t, cmd) => {
      calls.push(cmd);
      if (cmd.method === "DOM.getDocument") return { root: doc(nodes.map((n) => el(n.backendNodeId))) };
      if (cmd.method === "DOM.resolveNode") return { object: { objectId: "obj-1" } };
      if (cmd.method === "Runtime.callFunctionOn") return { result: { value: pageFor(nodes)(cmd.params.arguments[0].value) } };
      if (cmd.method === "DOM.getBoxModel") return { model: { content: [0, 0, 1, 1] } };
      return {};
    });
    const out = await mod.boxMap(7, wanted);
    const fnCall = calls.find((c) => c.method === "Runtime.callFunctionOn");
    const sent = fnCall.params.arguments[0].value.length;
    check(`a ${N}-node request is truncated to 2000 in the bulk call`, sent === 2000,
      `${sent} paths were sent to the page`);
    check("…and the truncation is reported", out.truncated === true && out.requested === N,
      `truncated=${out.truncated} requested=${out.requested}`);
    check("…and the 100 past the cap are not dropped, they fall back",
      out.boxes.size === N && out.fallback === 100,
      `${out.boxes.size} boxes, ${out.fallback} fallbacks`);
  }

  // 6. An empty request costs nothing. The observation calls this every step
  //    and a frame with no kept node must not pay three round trips.
  {
    const calls = [];
    const mod = moduleFor(async (_t, cmd) => { calls.push(cmd); return {}; });
    const out = await mod.boxMap(7, []);
    check("an empty id list makes no CDP call at all", calls.length === 0,
      `sent ${calls.map((c) => c.method).join(",")}`);
    check("…and says so", out.source === "empty" && out.boxes.size === 0,
      `result was ${JSON.stringify({ source: out.source, size: out.boxes.size })}`);
  }

  // 7. The path arithmetic. `children` on an element skips text nodes, so a
  //    path built from CDP's flat children list has to count elements only —
  //    off by one here and every node after it on the page is wrong.
  {
    const mod = moduleFor(async () => ({}));
    const tree = doc([
      el(1, [text(90), el(2, [el(3)])]),
      el(4),
    ]);
    const paths = mod.reachablePaths(tree, new Set([3, 4]));
    check("a path counts element children only",
      JSON.stringify(paths.get(3)) === "[0,0,0]" && JSON.stringify(paths.get(4)) === "[1]",
      `paths were ${JSON.stringify([...paths])}`);
  }

  // 8. Reachability. A node inside a shadow root or an iframe's content
  //    document cannot be walked from the top Document with `children`, so
  //    the CDP tree must not pretend otherwise — it has to leave them out and
  //    let the caller fall back. A path that resolves to the *wrong* element
  //    would click the wrong thing, which is worse than a round trip.
  {
    const mod = moduleFor(async () => ({}));
    const tree = doc([
      el(1, [el(2, [], { shadowRoots: [doc([el(5)])] })]),
      el(3, [], { contentDocument: doc([el(6)]) }),
      el(7),
    ]);
    const paths = mod.reachablePaths(tree, new Set([5, 6, 7]));
    check("shadow and iframe content nodes get no path", paths.size === 1 && paths.has(7),
      `paths were ${JSON.stringify([...paths])}`);
    check("…and the top-document node still does",
      JSON.stringify(paths.get(7)) === "[2]",
      `path for 7 was ${JSON.stringify(paths.get(7))}`);
  }

  // 9. The fallback must not reintroduce the dead click the bulk walk just
  //    closed. This is the path taken whenever the bulk path fails outright,
  //    so an unclamped `getBoxModel` here puts the exact bug back on the
  //    branch that matters most — which is why the viewport is read at all,
  //    and why it is read lazily: an observation the bulk path covered costs
  //    no fourth call.
  {
    const calls = [];
    const mod = moduleFor(async (_t, cmd) => {
      calls.push(cmd);
      if (cmd.method === "DOM.getDocument") throw new Error("target closed");
      if (cmd.method === "Page.getLayoutMetrics") {
        return { cssLayoutViewport: { clientWidth: 1280, clientHeight: 800 } };
      }
      if (cmd.method === "DOM.getBoxModel") {
        const id = cmd.params.backendNodeId;
        // 11 sits inside the window; 22 is 900px down a long form.
        return id === 11
          ? { model: { content: [10, 20, 30, 60] } }
          : { model: { content: [10, 900, 30, 940] } };
      }
      return {};
    });
    const out = await mod.boxMap(7, [11, 22]);
    check("an on-screen fallback node still gets its coordinates",
      out.boxes.get(11) && out.boxes.get(11).x === 20 && out.boxes.get(11).y === 40,
      `get(11) was ${JSON.stringify(out.boxes.get(11))}`);
    check("an off-screen one is refused by the fallback too",
      out.boxes.has(22) === false && out.blocked.get(22) === "off-screen",
      `boxes=${JSON.stringify([...out.boxes])} blocked=${JSON.stringify([...out.blocked])}`);
  }

  // 9b. …and the viewport is only fetched when there is something to clamp.
  {
    const calls = [];
    const nodes0 = [{ backendNodeId: 100, x: 5, y: 7 }, { backendNodeId: 101, x: 9, y: 9 }];
    const mod = moduleFor(async (_t, cmd) => {
      calls.push(cmd);
      if (cmd.method === "DOM.getDocument") return { root: doc(nodes0.map((n) => el(n.backendNodeId))) };
      if (cmd.method === "DOM.resolveNode") return { object: { objectId: "obj-1" } };
      if (cmd.method === "Runtime.callFunctionOn") return { result: { value: pageFor(nodes0)(cmd.params.arguments[0].value) } };
      return {};
    });
    await mod.boxMap(7, [100, 101]);
    check("a fully-covered observation spends no call on Page.getLayoutMetrics",
      !calls.some((c) => c.method === "Page.getLayoutMetrics"),
      `sent ${calls.map((c) => c.method).join(", ")}`);
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
