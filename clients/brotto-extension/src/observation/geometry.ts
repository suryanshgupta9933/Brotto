/**
 * Geometry in bulk: every kept node's centre, in three CDP calls.
 *
 * `targetsForFrame` used to call `DOM.getBoxModel` once per kept AX node,
 * serially, inside the loop. The Gmail search step measured 608 targets, so
 * every observation of every task paid 608 serialised round trips — a latency
 * floor proportional to page size, paid forever, for a coordinate the model
 * uses only to render a target off-screen or not.
 *
 * Three calls replace them:
 *
 *   1. `DOM.getDocument({depth: -1, pierce: true})` — the whole document, each
 *      node carrying a `backendNodeId`.
 *   2. `DOM.resolveNode({backendNodeId})` on the document node — one objectId.
 *   3. `Runtime.callFunctionOn` — one function that walks an argument list of
 *      element paths and returns their centres.
 *
 * The join key is `backendNodeId`: the same id space for the same target, which
 * is what makes a bulk read possible at all. The spec listed that as an open,
 * unverified item, so the probe (`scripts/probe_perception.py`, recorded in
 * `tests/fixtures/perception-probe.json`) measures it on a real page rather
 * than taking it from memory. What it confirmed is in the probe's own output.
 *
 * **A backendNodeId is not a handle the page can use.** There is no page-side
 * accessor for it, and the two obvious-looking routes are both wrong:
 * `DOM.pushNodesByBackendIdsToFrontend` hands back *frontend* nodeIds, which
 * are equally invisible to script, and resolving each id to an object is one
 * round trip per node — the thing being replaced. So the walk is by *path*
 * instead: the CDP tree gives element-child indices, and the page resolves
 * them with `children[i]`, which is an element-only list. The arithmetic has to
 * count elements only, because CDP's `children` includes text nodes and
 * `children[]` does not; off by one and every node after it on the page is
 * wrong.
 *
 * The failure mode is asymmetric and that is what everything below is built
 * around. A *wrong* x/y is a click on the wrong element, which is a data-loss
 * bug. A *missing* x/y is a target rendered off-screen, which is what happens
 * today and is a far cheaper failure. So the bulk path is an optimisation, not
 * a dependency: any id it cannot cover falls back to today's per-node
 * `DOM.getBoxModel`, and a bulk path that fails outright falls back for
 * everything. That fallback is the code's defining property, and
 * `scripts/test-observation-geometry.test.js` exists to keep it honest.
 */

import { anyCommand } from "./surfaces";

/** Matches MAX_NODES_PER_FRAME in `surfaces.ts`: 2000 nodes per tree. A cap
 *  written down and not enforced is not a cap, so the ids past it are dropped
 *  from the *bulk* call and fall back to `DOM.getBoxModel` — the cap bounds
 *  the batch, it never costs a coordinate. */
const MAX_GEOMETRY_ENTRIES = 2000;

export interface GeometryResult {
  /** backendNodeId → centre of the content box, viewport coordinates. Absent
   *  means no box: the caller emits the target with no `x`/`y`, as today. */
  boxes: Map<number, { x: number; y: number }>;
  /** Distinct ids asked for, after de-duplication by the caller's array. */
  requested: number;
  /** `boxes.size` after the fallback ran. */
  resolved: number;
  /** How many ids cost a per-node `DOM.getBoxModel`. The number to watch: a
   *  bulk path that silently stops joining shows up here first. */
  fallback: number;
  /** The id list was longer than the cap. */
  truncated: boolean;
  /** `bulk` — the three calls worked. `empty` — nothing was asked for.
   *  `no-join` — the calls worked and matched nothing, which is what a
   *  mismatched id space looks like. `failed` — a call threw. */
  source: string;
}

/**
 * The page-side walk. Runs as a string in the page's own realm.
 *
 * `this` is the Document node `DOM.resolveNode` handed back, because that is
 * the only context guaranteed to be the document we asked for. `document` is
 * the fallback for a call where `this` is not a document.
 *
 * `getClientRects().length === 0` is the no-box check and it is not optional.
 * `getBoundingClientRect()` on a `display:none` element returns all zeros, and
 * (0,0) is the top-left corner of the viewport: every invisible control on the
 * page would become a click in the same place. Today's code omits coordinates
 * there, and `targetsForFrame` and everything downstream depend on that.
 *
 * No template literals or semicolons-at-EOL in here: the Node test slices this
 * constant out of the source between the backticks.
 */
// A `function`, not an arrow: `Runtime.callFunctionOn` binds `this` to the
// objectId's value, and an arrow would not see it.
const BOX_WALK = `function (paths) {
  const root = (this && this.nodeType === 9) ? this : document;
  const out = [];
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    let el = root;
    let ok = true;
    for (let j = 0; j < path.length; j++) {
      const kids = el.children;
      if (!kids || path[j] >= kids.length) { ok = false; break; }
      el = kids[path[j]];
    }
    if (!ok || !el) { out.push(null); continue; }
    if (el.getClientRects().length === 0) { out.push(null); continue; }
    const r = el.getBoundingClientRect();
    out.push([Math.round((r.left + r.right) / 2), Math.round((r.top + r.bottom) / 2)]);
  }
  return out;
}`;

/**
 * Element-child paths for the requested ids, from a `DOM.getDocument` tree.
 *
 * Only nodes the page can actually walk get a path. A node inside an open
 * shadow root or an iframe's content document is reachable from the top
 * Document only through `shadowRoot`/`contentDocument`, not through `children`,
 * so those subtrees are never descended into: the caller falls back for them.
 * Walking them anyway would produce a path that resolves to a *different*
 * element, which is the one outcome worse than a round trip.
 *
 * Iterative, because a real document is deep enough to matter and a runaway
 * iframe is not something to meet with the JS stack.
 */
function reachablePaths(root: any, wanted: Set<number>): Map<number, number[]> {
  const out = new Map();
  if (!root || typeof root !== "object" || !wanted || typeof wanted.has !== "function") return out;
  const stack = [{ node: root, path: [] }];
  while (stack.length) {
    const entry = stack.pop();
    const kids = entry.node.children;
    if (!kids) continue;
    // Element children only — `el.children[i]` counts elements, so this
    // counter has to as well or every path after the first text node is off.
    let index = 0;
    for (const kid of kids) {
      if (!kid || kid.nodeType !== 1) continue;
      const at = index++;
      const path = entry.path.concat(at);
      const backendNodeId = kid.backendNodeId;
      if (typeof backendNodeId === "number" && wanted.has(backendNodeId)) out.set(backendNodeId, path);
      stack.push({ node: kid, path });
    }
  }
  return out;
}

/**
 * Every requested id's centre: three CDP calls, then a per-node fallback for
 * whatever the bulk path could not cover.
 *
 * The fallback is not an error path, it is the definition. Bulk returns what
 * it can; `DOM.getBoxModel` — the pre-bulk behaviour, unchanged — mops up the
 * rest, so the caller gets coordinates for every id it can get either way and
 * a node with no box is still a node with *no* coordinates rather than a
 * fabricated (0,0). The cost when the bulk path stops joining is the old cost,
 * which is a regression in latency and nothing else.
 *
 * Call it once per observation, with the union of the ids every frame's AX
 * tree produced — the frame's own geometry is in the same id space as the top
 * document's, and one call for 600 nodes beats 12 calls for 50.
 */
export async function boxMap(
  tabId: number,
  backendNodeIds: number[],
): Promise<GeometryResult> {
  const boxes = new Map();
  const ids = [];
  const seen = new Set();
  for (const id of backendNodeIds ?? []) {
    if (typeof id !== "number" || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  const truncated = ids.length > MAX_GEOMETRY_ENTRIES;
  const bulk = ids.slice(0, MAX_GEOMETRY_ENTRIES);
  // `let` and not a `: "bulk" | …` annotation, because the Node test
  // evaluates this body as plain JavaScript. The four values are on the
  // interface above.
  let source = "empty";

  if (bulk.length) {
    source = "bulk";
    try {
      const doc = await anyCommand(tabId, {
        method: "DOM.getDocument",
        params: { depth: -1, pierce: true },
      });
      const root = doc?.root;
      const paths = reachablePaths(root, new Set(bulk));
      if (!paths.size) {
        // The calls worked and matched nothing. This is what a mismatched
        // backendNodeId space looks like from here.
        source = "no-join";
      } else {
        const ordered = [];
        const wanted = [];
        for (const id of bulk) {
          const path = paths.get(id);
          if (!path) continue;
          ordered.push(id);
          wanted.push(path);
        }
        const resolved = await anyCommand(tabId, {
          method: "DOM.resolveNode",
          params: { backendNodeId: root.backendNodeId },
        });
        const objectId = resolved?.object?.objectId;
        if (!objectId) throw new Error("DOM.resolveNode returned no objectId");
        const call = await anyCommand(tabId, {
          method: "Runtime.callFunctionOn",
          params: {
            objectId,
            functionDeclaration: BOX_WALK,
            arguments: [{ value: wanted }],
            returnByValue: true,
          },
        });
        const values = call?.result?.value ?? [];
        // The page answers one entry per path, in order — the same order we
        // sent, so the join is positional and needs no key from the page.
        for (let i = 0; i < ordered.length; i++) {
          const value = values[i];
          if (Array.isArray(value) && value.length >= 2) {
            boxes.set(ordered[i], { x: Math.round(value[0]), y: Math.round(value[1]) });
          }
        }
      }
    } catch {
      // A tab mid-navigation, a target that went away, a CDP method that is
      // not there. None of it may cost the observation its coordinates.
      source = "failed";
    }
  }

  let fallback = 0;
  for (const id of ids) {
    if (boxes.has(id)) continue;
    fallback++;
    try {
      const box = await anyCommand(tabId, {
        method: "DOM.getBoxModel",
        params: { backendNodeId: id },
      });
      const content = box?.model?.content;
      if (content && content.length >= 4) {
        boxes.set(id, {
          x: Math.round((content[0] + content[2]) / 2),
          y: Math.round((content[1] + content[3]) / 2),
        });
      }
    } catch {
      // No box — off-screen, display:none, or a stale id. Today's behaviour:
      // the target is emitted without x/y. Never 0,0.
    }
  }

  return { boxes, requested: ids.length, resolved: boxes.size, fallback, truncated, source };
}
