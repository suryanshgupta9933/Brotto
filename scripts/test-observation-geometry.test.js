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
function moduleFor(dbgImpl) {
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
function pageFor(nodesById) {
  return (paths) =>
    paths.map((p) => {
      let cur = { children: nodesById };
      for (const i of p) {
        if (!cur || !cur.children || i >= cur.children.length) return null;
        cur = cur.children[i];
      }
      if (!cur || cur.noBox) return null;
      return [cur.x, cur.y];
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
// element answers `children`, `getClientRects`, `getBoundingClientRect`.
function runBoxWalk(rootChildren) {
  const fake = (kids, box) => ({
    children: kids,
    getClientRects: () => (box === null ? [] : [{ width: 10 }]),
    getBoundingClientRect: () => box ?? { left: 0, right: 0, top: 0, bottom: 0 },
  });
  const root = { nodeType: 9, children: [] };
  root.children = rootChildren.map((spec) =>
    spec.noBox ? fake(spec.children || [], null) : fake(spec.children || [], spec.box || { left: 0, right: 0, top: 0, bottom: 0 }));
  return vm.runInNewContext("(" + BOX_WALK + ")").call(root, [[0], [1]]);
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
      Array.isArray(out[0]) && out[0][0] === 20 && out[0][1] === 40,
      `first rect was ${JSON.stringify(out[0])}`);
    check("an element with no box yields nothing, not (0,0)",
      out[1] === null || out[1] === undefined,
      `second rect was ${JSON.stringify(out[1])} — (0,0) is a click in the viewport corner`);
    check("a path that walks off the tree yields nothing",
      walk.call({ nodeType: 9, children: [] }, [[7]])[0] == null,
      "an out-of-range path did not fail closed");
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
      if (cmd.method === "Runtime.callFunctionOn") return { result: { value: [[5, 7]] } };
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

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
