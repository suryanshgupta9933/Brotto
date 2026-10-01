/**
 * Frame surfaces: the observation is every frame, not just the top one.
 *
 * The probe (`services/brotto-orchestrator/scripts/probe_perception.py`,
 * recorded in `tests/fixtures/perception-probe.json`) settled the two
 * questions this file is built on. The `auth-iframe` fixture's "Confirm"
 * control is absent from the top frame's accessibility tree and present in a
 * subframe's — `GAP_FRAMES`. And `Accessibility.getFullAXTree` accepts a
 * `frameId` and reads cross-origin frame content in-process, so this is one
 * call per frame: no target-attach dance.
 *
 * The same probe fixes what this file must never do. Everything below reads
 * accessibility nodes and geometry. **It does not evaluate script in a
 * cross-origin frame's execution context, and nothing in this workstream may.**
 * A foreign-realm `Runtime.evaluate` is a materially larger privilege than a
 * read, and reaching into a third-party realm to get one would be the wrong
 * trade for a control we can already see.
 */

import * as dbg from "../debugger";

// Scalability bounds. A page with thousands of frames is hostile or broken,
// and the 13th frame is never the one the model wants. Depth 4 because the
// server's own MAX_DEPTH for AX indentation is 4: a control four levels down
// flattens out of the rendered tree anyway, so traversing it would spend a
// round trip on something the model cannot use.
// `sendCommand` is typed `unknown` because CDP returns whatever the method
// does. One wrapper so the call sites can stay annotation-free: the Node test
// extracts these function bodies and evaluates them as plain JavaScript, and
// `as {…}` or `: Type` inside a body is a syntax error there. This is the
// same constraint `stability.ts` is written under.
export async function anyCommand(tabId: number, command: any): Promise<any> {
  return await dbg.sendCommand(tabId, command);
}

/**
 * How many CDP calls may be in flight at once against one debugger session.
 *
 * The frame reads were sequential on purpose — "a page that legitimately has a
 * dozen frames should not have twelve `getFullAXTree` calls in flight against
 * one debugger session" — so this is a bound on an intent, not a free-for-all.
 * `chrome.debugger.sendCommand` is a native per-call callback API carrying no
 * lock, so concurrency is supported by construction; 6 is where the measured
 * serial cost collapses (5.1–5.5× on the CDP portion at 6–12 frames) without
 * putting a dozen full AX trees on the renderer at once.
 */
export const CDP_CONCURRENCY = 6;

/**
 * `items` through `fn`, at most `CDP_CONCURRENCY` at a time, results in the
 * original order.
 *
 * Order is the whole contract. Every caller here is rewriting a sequential
 * `for` loop that pushes into a list, and the refs the model sees are minted
 * from the *index* — a supplement target's ref is `-(i + 1)` — so completion
 * order leaking into the result would renumber every ref on the page. Results
 * are written by index, never appended, so the array is a permutation of the
 * input no matter what order the renderer answers in.
 *
 * A rejection propagates, and the other workers keep draining: the callers all
 * catch per item, so a `pooled` that swallowed a failure would turn one dead
 * node into a silently missing coordinate.
 *
 * Untyped, like `anyCommand` above and for the same reason: the callers are
 * all CDP traffic that is `any` at the boundary anyway, and the Node tests
 * evaluate this body as plain JavaScript.
 */
export async function pooled(items: any, limit: number, fn: any): Promise<any[]> {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  const width = Math.max(1, Math.min(limit, items.length));
  const workers = [];
  for (let i = 0; i < width; i++) workers.push(worker());
  await Promise.all(workers);
  return out;
}

const MAX_FRAMES = 12;
const MAX_FRAME_DEPTH = 4;
const MAX_NODES_PER_FRAME = 2000;

export interface SurfaceLimits {
  maxFrames?: number;
  maxDepth?: number;
  maxNodes?: number;
}

export interface Surface {
  /** Position in the traversal, 0 = main frame. This is the ref namespace. */
  frameIndex: number;
  /** CDP frame id. Empty means the main frame, which needs no `frameId`. */
  frameId: string;
  depth: number;
  url: string;
  crossOrigin: boolean;
  axNodes: any[];
  /** Set when this frame's tree could not be read. The scan carries on. */
  error?: string;
}

/** What we read and what we left behind, so a truncated observation is visible
 *  rather than silently partial. */
export interface FrameScan {
  traversed: number;
  /** Frames the page actually has, including the ones we did not fetch. */
  total: number;
  crossOrigin: number;
  frameCapped: boolean;
  depthCapped: boolean;
  nodeCapped: boolean;
  /** The frames whose tree hit MAX_NODES_PER_FRAME, so the server can say
   *  whether the truncated one was the page or an embed. */
  cappedFrames: { frameIndex: number; url: string; crossOrigin: boolean; nodes: number }[];
  /** Frame ids whose `getFullAXTree` failed. */
  failed: string[];
}

export interface FrameSelection {
  surfaces: Surface[];
  scan: FrameScan;
}

// `about:blank`, `about:srcdoc` and `data:` all parse to the "null" origin, so
// an about:blank iframe inside an about:blank page reads as same-origin. That
// is the right answer: it inherits, and it cannot reach anything the top
// document cannot.
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/**
 * A merged ref. A bare CDP `nodeId` is unique only *within* one frame — two
 * frames both hand back `nodeId: 42` — so the ref carries the frame's
 * position in the traversal as well.
 *
 * The frame's CDP id is a 32-char hex string and refs are printed on every
 * line of the AX tree, so the ordinal goes in the ref and the real id rides
 * alongside on the target. A missing index reads as a malformed ref rather
 * than as a plausible node id, which is what we want at 3am.
 */
export function makeRef(frameIndex: number, nodeId: number): string {
  return frameIndex + ":" + nodeId;
}

/**
 * Pick the frames worth a round trip, from `Page.getFrameTree`.
 *
 * Pure, and the whole walk is over data CDP already delivered — the cap is on
 * the per-frame `getFullAXTree` calls, which is where the cost actually is.
 * Counting `total` still walks everything, because an honest "12 of 3000" is
 * worth more to the model than a cheap lie.
 */
export function selectFrames(
  frameTree: any,
  limits?: SurfaceLimits,
): FrameSelection {
  const maxFrames = limits?.maxFrames ?? MAX_FRAMES;
  const maxDepth = limits?.maxDepth ?? MAX_FRAME_DEPTH;
  const scan = {
    traversed: 0, total: 0, crossOrigin: 0,
    frameCapped: false, depthCapped: false, nodeCapped: false, cappedFrames: [], failed: [],
  };
  const surfaces = [];
  if (!frameTree || typeof frameTree !== "object") return { surfaces, scan };

  // The tree node wraps its frame: {"frame": {...}, "childFrames": [...]}.
  // Reading the id off the node is the trap the probe hit once.
  const topUrl = typeof frameTree.frame?.url === "string" ? frameTree.frame.url : "";
  const topOrigin = originOf(topUrl);

  // Breadth-first over an index-pointer queue of *nodes*: a frame bomb
  // thousands deep must not recurse, and shallow frames are the ones the
  // model is looking at, so depth order is also the selection order. The
  // queue holds nodes, not frames, because `childFrames` is on the node —
  // the same wrapping that puts `id` there, read from the other side.
  const queue = [{ node: frameTree, depth: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    for (const child of entry.node?.childFrames ?? []) {
      queue.push({ node: child, depth: entry.depth + 1 });
    }
    const frame = entry.node?.frame;
    const frameId = typeof frame?.id === "string" ? frame.id : "";
    if (!frameId) continue;
    scan.total++;
    if (entry.depth >= maxDepth) {
      scan.depthCapped = true;
      continue;
    }
    if (surfaces.length >= maxFrames) {
      scan.frameCapped = true;
      continue;
    }
    const url = typeof frame.url === "string" ? frame.url : "";
    const crossOrigin = topOrigin !== "" && originOf(url) !== topOrigin;
    if (crossOrigin) scan.crossOrigin++;
    surfaces.push({
      frameIndex: surfaces.length,
      frameId,
      depth: entry.depth,
      url,
      crossOrigin,
      axNodes: [],
    });
  }
  scan.traversed = surfaces.length;
  return { surfaces, scan };
}

/**
 * One `getFullAXTree` per selected frame, union-ready.
 *
 * A frame that fails is recorded and skipped. A dead iframe, a cross-origin
 * one that navigated out from under us, a frame the page is still building —
 * none of them may cost us the frames that did answer, and the main frame's
 * targets are already in hand by the time we get to any of them.
 */
export async function enumerateSurfaces(
  tabId: number,
  limits?: SurfaceLimits,
): Promise<FrameSelection> {
  const maxNodes = limits?.maxNodes ?? MAX_NODES_PER_FRAME;
  let surfaces = [];
  let scan = null;
  try {
    const res = await anyCommand(tabId, { method: "Page.getFrameTree" });
    const picked = selectFrames(res?.frameTree, limits);
    surfaces = picked.surfaces;
    scan = picked.scan;
  } catch {
    // One call on a tab that may be mid-navigation. The main frame's tree is
    // still readable without a frameId — which is exactly what we asked for
    // before frames existed at all, so the observation degrades to the old
    // behaviour rather than to nothing.
    surfaces = [{ frameIndex: 0, frameId: "", depth: 0, url: "", crossOrigin: false, axNodes: [] }];
    scan = {
      traversed: 0, total: 0, crossOrigin: 0,
      frameCapped: false, depthCapped: false, nodeCapped: false, cappedFrames: [], failed: [],
    };
  }

  // The reads are pooled, the bookkeeping is not. A frame that fails is
  // recorded and skipped, and `cappedFrames` and `failed` are read in order
  // by anyone deciding whether the model lost something — so both are filled
  // in frame order after the reads land, exactly as the sequential loop had
  // them. Only the round trips are concurrent.
  const reads = await pooled(surfaces, CDP_CONCURRENCY, async (surface) => {
    try {
      const raw = await anyCommand(tabId, {
        method: "Accessibility.getFullAXTree",
        ...(surface.frameId ? { params: { frameId: surface.frameId } } : {}),
      });
      return { nodes: raw?.nodes ?? [] };
    } catch (err) {
      return { nodes: [], error: String(err) };
    }
  });

  for (let i = 0; i < surfaces.length; i++) {
    const surface = surfaces[i];
    const read = reads[i];
    if (read.error) {
      surface.axNodes = [];
      surface.error = read.error;
      scan.failed.push(surface.frameId || "main");
      continue;
    }
    const nodes = read.nodes;
    if (nodes.length > maxNodes) {
      scan.nodeCapped = true;
      // Which frame capped is the only thing that decides whether the model
      // lost something it needed: the main document going dark is a blind
      // agent, an analytics iframe going dark is nothing.
      scan.cappedFrames.push({
        frameIndex: surface.frameIndex,
        url: surface.url,
        crossOrigin: surface.crossOrigin,
        nodes: nodes.length,
      });
      surface.axNodes = nodes.slice(0, maxNodes);
    } else {
      surface.axNodes = nodes;
    }
  }
  return { surfaces, scan };
}
