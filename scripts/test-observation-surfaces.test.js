// Frame traversal is the one genuinely new *reach* in the perception
// workstream: the `auth-iframe` fixture's control lives in a cross-origin
// frame and came back `GAP_FRAMES` from the top-frame-only tree.
//
// Two things here are absences rather than wrong values, which is why they
// are tested at all:
//
//   - a frame bomb. `Page.getFrameTree` hands back every frame on the page,
//     and one `getFullAXTree` per frame turns a 3000-frame page into 3000
//     round trips aimed at ourselves. A cap written down and not enforced is
//     not a cap.
//   - ref uniqueness. A CDP `nodeId` is unique only *within* a frame. Two
//     frames both return `nodeId: 42`, and a bare-nodeId ref makes a click
//     on one frame's control land on the other's. Nothing in a diff shows
//     that; the merge is two lines and the bug is invisible in both.
//
// The functions are extracted from TypeScript source by brace matching (the
// pattern `test-observation-stability.test.js` uses) so these cases test the
// text that ships.
//
//   node --test scripts/test-observation-surfaces.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const OBS_DIR = path.join(__dirname, "..", "clients", "brotto-extension", "src", "observation");
const surfacesSrc = fs.readFileSync(path.join(OBS_DIR, "surfaces.ts"), "utf8");
const indexSrc = fs.readFileSync(path.join(OBS_DIR, "index.ts"), "utf8");

// Returns the function *body* only, so the extracted text is plain JS. The
// signatures are deliberately brace-free for this reason.
function extract(src, name) {
  // `<T, R>` between the name and the paren is legal TypeScript and `pooled`
  // is the first thing here that uses it. Generic parameters carry no braces,
  // so the brace matching below is unaffected.
  const start = src.search(new RegExp(`^(export )?(async )?function ${name}\\s*(<[^>(]*>)?\\s*\\(`, "m"));
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

function extractConst(src, name) {
  // `CDP_CONCURRENCY` is exported so the observation modules can share it.
  const start = src.search(new RegExp(`^(export )?const ${name} = `, "m"));
  if (start < 0) throw new Error(`no const ${name} — renamed?`);
  const line = src.slice(start, src.indexOf("\n", start));
  return line.slice(line.indexOf("=") + 1).replace(/;\s*$/, "").trim();
}

const BODIES = {
  selectFrames: extract(surfacesSrc, "selectFrames"),
  enumerateSurfaces: extract(surfacesSrc, "enumerateSurfaces"),
  makeRef: extract(surfacesSrc, "makeRef"),
  originOf: extract(surfacesSrc, "originOf"),
  pooled: extract(surfacesSrc, "pooled"),
  targetsForFrame: extract(indexSrc, "targetsForFrame"),
  propUrl: extract(indexSrc, "propUrl"),
};
const CONSTS = {
  MAX_FRAMES: extractConst(surfacesSrc, "MAX_FRAMES"),
  MAX_FRAME_DEPTH: extractConst(surfacesSrc, "MAX_FRAME_DEPTH"),
  MAX_NODES_PER_FRAME: extractConst(surfacesSrc, "MAX_NODES_PER_FRAME"),
  CDP_CONCURRENCY: extractConst(surfacesSrc, "CDP_CONCURRENCY"),
};

// KEEP_ROLES is a multi-line Set, so the single-line const reader won't take
// it. Sliced from source rather than restated here: a role that silently
// dropped out of the set would quietly flatten every depth-0 test below.
const KEEP_ROLES_START = indexSrc.indexOf("const KEEP_ROLES");
if (KEEP_ROLES_START < 0) throw new Error("no KEEP_ROLES in index.ts — renamed?");
const KEEP_ROLES_SRC = indexSrc.slice(KEEP_ROLES_START, indexSrc.indexOf("]);", KEEP_ROLES_START) + 2);

// The wrapper every case runs in: the extracted bodies, bound to a fake dbg.
function moduleFor(dbgImpl) {
  const sandbox = {
    ...CONSTS,
    dbg: { sendCommand: dbgImpl },
    URL, JSON, Math, Set, Map, String, console,
  };
  return vm.runInNewContext(
    `(function () {
       const anyCommand = (async function (tabId, command) { return await dbg.sendCommand(tabId, command); });
       const pooled = (async function (items, limit, fn) { ${BODIES.pooled} });
       const makeRef = (function (frameIndex, nodeId) { ${BODIES.makeRef} });
       const originOf = (function (url) { ${BODIES.originOf} });
       const selectFrames = (function (frameTree, limits) { ${BODIES.selectFrames} });
       const enumerateSurfaces = (async function (tabId, limits) { ${BODIES.enumerateSurfaces} });
       const KEEP_ROLES = ${KEEP_ROLES_SRC.replace('const KEEP_ROLES = ', '')};
       const propUrl = (function (node) { ${BODIES.propUrl} });
       const targetsForFrame = (async function (tabId, surface, boxes, blockedMap) { ${BODIES.targetsForFrame} });
       return { makeRef, originOf, selectFrames, enumerateSurfaces, targetsForFrame };
     })()`,
    sandbox,
  );
}

// ── Frame-tree builders ─────────────────────────────────────────────────────

// What `Page.getFrameTree` actually returns: a node *wrapping* a frame.
function frameNode(id, url = "https://shop.example/checkout", children = []) {
  return { frame: { id, url }, childFrames: children };
}

// `count` sibling frames hanging off the main frame — a frame bomb.
function bomb(count) {
  const children = [];
  for (let i = 0; i < count; i++) children.push(frameNode("f" + i));
  return frameNode("root", "https://shop.example/checkout", children);
}

// A single chain of `depth` nested frames.
function chain(depth) {
  let node = frameNode("d" + depth);
  for (let i = depth - 1; i >= 1; i--) node = frameNode("d" + i, "https://shop.example/checkout", [node]);
  return frameNode("root", "https://shop.example/checkout", [node]);
}

// ── AX node builders ────────────────────────────────────────────────────────

let nextNodeId = 1;
function axNode(role, name, opts = {}) {
  const nodeId = opts.nodeId ?? nextNodeId++;
  // `properties` is the AX node's own attribute list: `url` for a link's
  // destination, `disabled` for a control the page has switched off.
  const properties = [];
  if (opts.url !== undefined) properties.push({ name: "url", value: { value: opts.url } });
  if (opts.disabled !== undefined) properties.push({ name: "disabled", value: { value: opts.disabled } });
  return {
    nodeId,
    ...(opts.parentId !== undefined ? { parentId: opts.parentId } : {}),
    role: { value: role },
    name: { value: name },
    ...(opts.backendId !== undefined ? { backendDOMNodeId: opts.backendId } : {}),
    ...(properties.length ? { properties } : {}),
  };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}\n      ${detail}`);
  }
}

(async () => {
  console.log("frame surfaces");

  const noop = async () => ({});
  const mod = moduleFor(noop);

  // Defaults are the Scalability bounds; they are the ones that run in prod.
  const consts = {};
  for (const k of Object.keys(CONSTS)) consts[k] = vm.runInNewContext(CONSTS[k]);
  check("frame cap defaults to 12", consts.MAX_FRAMES === 12, `MAX_FRAMES was ${consts.MAX_FRAMES}`);
  check("frame depth defaults to 4", consts.MAX_FRAME_DEPTH === 4, `MAX_FRAME_DEPTH was ${consts.MAX_FRAME_DEPTH}`);
  check("nodes per frame defaults to 2000", consts.MAX_NODES_PER_FRAME === 2000,
    `MAX_NODES_PER_FRAME was ${consts.MAX_NODES_PER_FRAME}`);

  // 1. A FRAME BOMB. 3000 frames must cost 12 `getFullAXTree` calls, and the
  //    observation must say so. A cap that does not report is a silent
  //    partial picture, which is the failure mode the spec calls out.
  {
    const { surfaces, scan } = mod.selectFrames(bomb(3000));
    check("3000 frames are capped at 12", surfaces.length === 12,
      `selected ${surfaces.length} frames`);
    check("…and the main frame is the one that survives",
      surfaces[0] && surfaces[0].frameId === "root",
      `first kept frame was ${surfaces[0] && surfaces[0].frameId}`);
    check("…and the cap is reported, not swallowed",
      scan.frameCapped === true && scan.total === 3001 && scan.traversed === 12,
      `scan was ${JSON.stringify(scan)}`);
    check("…and every kept ref index is distinct",
      new Set(surfaces.map((s) => s.frameIndex)).size === 12,
      `frameIndexes were ${surfaces.map((s) => s.frameIndex).join(",")}`);

    // The cap has to hold on the expensive path too, not just the selector.
    const calls = [];
    const bounded = moduleFor(async (_t, cmd) => {
      calls.push(cmd);
      if (cmd.method === "Page.getFrameTree") return { frameTree: bomb(3000) };
      return { nodes: [] };
    });
    const out = await bounded.enumerateSurfaces(7);
    const axCalls = calls.filter((c) => c.method === "Accessibility.getFullAXTree");
    check("a frame bomb costs 12 AX reads, not 3000", axCalls.length === 12,
      `${axCalls.length} Accessibility.getFullAXTree calls were sent`);
    check("…and the fetch is not silently short",
      out.scan.frameCapped === true && out.scan.total === 3001,
      `scan was ${JSON.stringify(out.scan)}`);
  }

  // 2. DEPTH. The server's own MAX_DEPTH for indentation is 4, so a control
  //    four levels down flattens out of the rendered tree anyway — traversing
  //    it spends a round trip on something the model cannot use.
  {
    const { surfaces, scan } = mod.selectFrames(chain(9));
    check("nesting past depth 4 is not traversed", surfaces.length === 4,
      `kept ${surfaces.length} frames: ${surfaces.map((s) => s.depth).join(",")}`);
    check("…and the depth cap is reported", scan.depthCapped === true,
      `scan was ${JSON.stringify(scan)}`);
    check("a shallow page is not flagged", (() => {
      const r = mod.selectFrames(chain(2));
      return r.scan.depthCapped === false && r.scan.frameCapped === false && r.surfaces.length === 3;
    })(), "a 3-frame page reported a cap");
  }

  // 3. REF UNIQUENESS. Two frames, both handing back `nodeId: 42`. This is
  //    the trap: the merge is a union, nodeId is per-frame, and a bare ref
  //    makes one frame's control clickable at the other's element.
  {
    const frames = mod.selectFrames(frameNode("root", "https://shop.example/checkout", [
      frameNode("subA", "https://shop.example/frame-a"),
      frameNode("subB", "https://other.example/frame-b"),
    ]));
    check("both subframes are traversed", frames.surfaces.length === 3,
      `got ${frames.surfaces.length} surfaces`);
    check("cross-origin frames are counted", frames.scan.crossOrigin === 1,
      `crossOrigin was ${frames.scan.crossOrigin} (b is a different origin, a is not)`);

    const a = { ...frames.surfaces[1], axNodes: [axNode("button", "Confirm", { nodeId: 42 })] };
    const b = { ...frames.surfaces[2], axNodes: [axNode("button", "Confirm", { nodeId: 42 })] };
    check("a same-origin subframe is not called cross-origin", a.crossOrigin === false,
      `a.crossOrigin was ${a.crossOrigin}`);

    const targets = [
      ...await mod.targetsForFrame(7, a),
      ...await mod.targetsForFrame(7, b),
    ];
    check("the colliding nodeId became two targets", targets.length === 2,
      `got ${targets.length} targets`);
    check("…with different refs", targets[0].ref !== targets[1].ref,
      `both refs were ${targets[0].ref}`);
    check("…that round-trip to the right (frame, node)",
      targets[0].ref === "1:42" && targets[1].ref === "2:42",
      `refs were ${targets.map((t) => t.ref).join(",")}`);
    check("…and each target carries the frame it lives in, for dispatch",
      targets[0].frameId === "subA" && targets[1].frameId === "subB",
      `frameIds were ${targets.map((t) => t.frameId).join(",")}`);

    // The server's `_depths` walks `parent` as an opaque string, so the
    // format only has to be stable and colon-free. A frame id leaking into
    // the ref would put 32 hex chars on every line of the AX tree.
    check("the ref is short — no CDP frame id in it", targets[0].ref.length <= 6,
      `ref was ${targets[0].ref}`);
  }

  // 4. THE BULK GEOMETRY WIRING. `boxMap` is tested on its own in
  //    test-observation-geometry; what is untested is that `targetsForFrame`
  //    actually *consumes* it. A silently-ignored map still passes every
  //    geometry test and still costs a round trip per node.
  {
    let boxCalls = 0;
    const mod2 = moduleFor(async (_t, cmd) => {
      if (cmd.method === "DOM.getBoxModel") { boxCalls++; throw new Error("should not be called"); }
      return {};
    });
    const frames = mod2.selectFrames(frameNode("root", "https://shop.example/checkout"));
    const surface = { ...frames.surfaces[0], axNodes: [
      axNode("button", "Pay", { backendId: 501 }),
      axNode("link", "Cancel", { backendId: 502 }),
    ] };
    const targets = await mod2.targetsForFrame(7, surface, new Map([
      [501, { x: 10, y: 20 }], [502, { x: 30, y: 40 }],
    ]), new Map());
    check("a supplied box map supplies the coordinates",
      targets[0].x === 10 && targets[0].y === 20 && targets[1].x === 30 && targets[1].y === 40,
      `got ${JSON.stringify(targets.map((t) => [t.x, t.y]))}`);
    check("…and the per-node call is skipped entirely", boxCalls === 0,
      `DOM.getBoxModel was called ${boxCalls} times`);
    check("…and an unflagged target carries no `blocked` field at all",
      !("blocked" in targets[0]),
      `got ${JSON.stringify(targets[0])}`);

    // The miss case is the one that must not regress silently: an id the map
    // does not cover falls back to the per-node call, so an off-screen target
    // and an unmeasured one stay different.
    const mod3 = moduleFor(async (_t, cmd) => {
      if (cmd.method === "DOM.getBoxModel") {
        boxCalls++;
        return { model: { content: [0, 0, 8, 4, 8, 4, 0, 0] } };
      }
      return {};
    });
    const partial = await mod3.targetsForFrame(7, surface, new Map([[501, { x: 1, y: 2 }]]), new Map());
    check("an id the map misses falls back to one per-node call", boxCalls === 1,
      `DOM.getBoxModel was called ${boxCalls} times`);
    check("…and the mapped node still took its bulk coordinates",
      partial[0].x === 1 && partial[1].x === 4,
      `got ${JSON.stringify(partial.map((t) => [t.x, t.y]))}`);

    // The wiring the ten dead clicks on session a7328461 went through. A
    // blocked target has a box and still gets no coordinates — and the per-node
    // fallback must not be reached to put one back, or the reason travels with
    // a coordinate and the relay clicks into the overlay anyway.
    let blockedCalls = 0;
    const mod4 = moduleFor(async (_t, cmd) => {
      if (cmd.method === "DOM.getBoxModel") { blockedCalls++; return { model: { content: [0, 0, 8, 4] } }; }
      return {};
    });
    const both = new Map([[501, { x: 10, y: 20 }], [502, { x: 30, y: 40 }]]);
    const blocked = await mod4.targetsForFrame(7, surface, both, new Map([[501, "off-screen"]]));
    check("a blocked target gets the reason and no coordinates",
      blocked[0].blocked === "off-screen" && blocked[0].x === undefined,
      `got ${JSON.stringify(blocked[0])}`);
    check("…and no per-node call was spent trying to re-measure it",
      blockedCalls === 0,
      `DOM.getBoxModel was called ${blockedCalls} times`);
    check("…while its unflagged sibling is untouched",
      blocked[1].x === 30 && blocked[1].blocked === undefined,
      `got ${JSON.stringify(blocked[1])}`);

    // `disabled` is read off the AX node's own properties. It was dropped on
    // the floor until now, and a dropped flag produces a click on a button the
    // page has switched off — audited `ok: true`, done nothing.
    const off = {
      ...surface,
      axNodes: [
        axNode("button", "Pay", { backendId: 501, disabled: true }),
        axNode("button", "Retry", { backendId: 502 }),
      ],
    };
    const flags = await mod4.targetsForFrame(7, off, new Map(), new Map());
    check("a disabled control is carried, and only it",
      flags[0].disabled === true && !("disabled" in flags[1]),
      `got ${JSON.stringify(flags.map((t) => [t.disabled]))}`);
  }

  // 5. A HOSTILE OR DEAD FRAME. One `getFullAXTree` rejects; the top frame's
  //    targets still come back. A frame that navigated out from under us
  //    must not cost the whole observation.
  {
    const mod2 = moduleFor(async (_t, cmd) => {
      if (cmd.method === "Page.getFrameTree") {
        return { frameTree: frameNode("root", "https://shop.example/checkout", [
          frameNode("dead", "https://evil.example/frame"),
        ]) };
      }
      if (cmd.method === "Accessibility.getFullAXTree") {
        if (cmd.params && cmd.params.frameId === "dead") {
          throw new Error("Command failed: Inspected target navigated or closed");
        }
        return { nodes: [axNode("button", "Pay now", { nodeId: 7, backendId: 1 })] };
      }
      if (cmd.method === "DOM.getBoxModel") {
        return { model: { content: [10, 10, 90, 10, 90, 50, 10, 50] } };
      }
      return {};
    });
    const { surfaces, scan } = await mod2.enumerateSurfaces(7);
    check("a failing frame does not reject the observation", surfaces.length === 2,
      `got ${surfaces.length} surfaces`);
    check("…it is recorded, with the frame that failed", scan.failed.length === 1,
      `scan.failed was ${JSON.stringify(scan.failed)}`);

    const targets = [];
    for (const s of surfaces) targets.push(...await mod2.targetsForFrame(7, s));
    check("the top frame's targets still come back", targets.length === 1,
      `got ${targets.length} targets: ${JSON.stringify(targets)}`);
    check("…including its geometry", targets[0].x === 50 && targets[0].y === 10,
      `coords were ${targets[0].x},${targets[0].y}`);
    check("…and a frame with no tree produces no targets", surfaces[1].error !== undefined,
      "the failed frame recorded no error");
  }

  // 4b. `Page.getFrameTree` itself failing — a tab mid-navigation. The
  //     observation degrades to the main frame, which is what it did before
  //     frames existed, rather than to nothing.
  {
    const mod3 = moduleFor(async (_t, cmd) => {
      if (cmd.method === "Page.getFrameTree") throw new Error("Command failed: target closed");
      if (cmd.method === "Accessibility.getFullAXTree") {
        return { nodes: [axNode("button", "Still here", { nodeId: 3 })] };
      }
      return {};
    });
    const { surfaces, scan } = await mod3.enumerateSurfaces(7);
    check("a failed getFrameTree falls back to the main frame", surfaces.length === 1,
      `got ${surfaces.length} surfaces`);
    check("…and reads it without a frameId", surfaces[0].frameId === "",
      `frameId was ${JSON.stringify(surfaces[0].frameId)}`);
    const targets = await mod3.targetsForFrame(7, surfaces[0]);
    check("…which still yields targets", targets.length === 1 && targets[0].ref === "0:3",
      `got ${JSON.stringify(targets)}`);
    check("…and reports no phantom truncation", scan.frameCapped === false && scan.total === 0,
      `scan was ${JSON.stringify(scan)}`);
  }

  // 5. PARENT RESOLUTION ACROSS THE MERGED SET. A link's immediate parent is
  //    usually a `generic` container that never survives KEEP_ROLES, so the
  //    parent sent has to be the nearest *kept* ancestor — resolved inside
  //    the right frame's table, then re-emitted as that frame's ref. Every
  //    node id here is reused verbatim in all three frames, so a parent
  //    resolved in the wrong table still looks right as a bare id; the frame
  //    prefix is the only thing that can catch it.
  {
    // 1 dialog (kept) → 2 generic (dropped) → 3 generic (dropped) → 4 link.
    // 5 button hangs off the kept dialog directly.
    const nodes = [
      axNode("dialog", "Payment", { nodeId: 1 }),
      axNode("generic", "", { nodeId: 2, parentId: 1 }),
      axNode("generic", "", { nodeId: 3, parentId: 2 }),
      axNode("link", "Terms", { nodeId: 4, parentId: 3, url: "https://shop.example/t" }),
      axNode("button", "Cancel", { nodeId: 5, parentId: 1 }),
    ];
    const frames = mod.selectFrames(frameNode("root", "https://shop.example/checkout", [
      frameNode("subA", "https://shop.example/frame-a"),
      frameNode("subB", "https://other.example/frame-b"),
    ]));
    const targets = [];
    for (const s of frames.surfaces) {
      targets.push(...await mod.targetsForFrame(7, { ...s, axNodes: nodes }));
    }
    const terms = targets.filter((t) => t.name === "Terms");
    const cancel = targets.filter((t) => t.name === "Cancel");

    check("all three frames' targets are merged", targets.length === 9,
      `got ${targets.length} targets`);
    check("the same node id in three frames is three refs",
      new Set(targets.filter((t) => t.name === "Terms").map((t) => t.ref)).size === 3,
      `Terms refs were ${targets.filter((t) => t.name === "Terms").map((t) => t.ref).join(",")}`);

    for (const t of terms) {
      const myFrame = t.ref.split(":")[0];
      check("a node under a dropped `generic` keeps its kept ancestor, in its own frame",
        t.parent === myFrame + ":1",
        `ref ${t.ref} had parent ${JSON.stringify(t.parent)}, expected ${myFrame}:1`);
    }
    check("…not the direct, dropped parent", terms.every((t) => t.parent !== t.ref.split(":")[0] + ":3"),
      "the direct generic parent leaked through");
    for (const t of cancel) {
      check("a child of a kept node resolves to it directly",
        t.parent === t.ref.split(":")[0] + ":1",
        `ref ${t.ref} had parent ${JSON.stringify(t.parent)}`);
    }
    check("no target resolves a parent in another frame's table",
      targets.every((t) => t.parent === undefined || t.parent.split(":")[0] === t.ref.split(":")[0]),
      `ref/parent pairs were ${JSON.stringify(targets.map((t) => t.ref + "→" + t.parent))}`);

    // And the server's own resolution, run on exactly the refs we emit —
    // `ax_filter._depths` treats them as opaque strings.
    const parent = {};
    for (const t of targets) if (t.parent) parent[t.ref] = t.parent;
    const depth = {};
    for (const t of targets) {
      let n = 0, cur = t.parent;
      const seen = new Set([t.ref]);
      while (cur !== undefined && !seen.has(cur)) { seen.add(cur); cur = parent[cur]; n++; }
      depth[t.ref] = n;
    }
    check("the server's depth walk gives a link under a dropped parent depth 1, not 0",
      depth["0:4"] === 1 && depth["1:4"] === 1 && depth["2:4"] === 1,
      `depths were ${JSON.stringify(depth)}`);
  }

  // 6. THE NODE CAP. A flat list larger than 2000 is not renderable under any
  //    budget, and it is the one unbounded resource left in the AX path.
  {
    const big = Array.from({ length: 2500 }, (_, i) => axNode("button", "b" + i, { nodeId: i + 1 }));
    const mod4 = moduleFor(async (_t, cmd) => {
      if (cmd.method === "Page.getFrameTree") return { frameTree: frameNode("root") };
      return { nodes: big };
    });
    const { surfaces, scan } = await mod4.enumerateSurfaces(7);
    check("a 2500-node tree is truncated to 2000", surfaces[0].axNodes.length === 2000,
      `kept ${surfaces[0].axNodes.length} nodes`);
    check("…and the truncation is reported", scan.nodeCapped === true,
      `scan.nodeCapped was ${scan.nodeCapped}`);
    // Which frame capped is the only thing that says whether the model lost
    // something it needed. A boolean fires every step on a harmless embed and
    // tells a reader nothing.
    check("…naming the frame that capped", scan.cappedFrames.length === 1
      && scan.cappedFrames[0].frameIndex === 0 && scan.cappedFrames[0].nodes === 2500,
      `cappedFrames was ${JSON.stringify(scan.cappedFrames)}`);
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
