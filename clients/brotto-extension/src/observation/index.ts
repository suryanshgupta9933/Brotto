/**
 * The observation pipeline: page state + accessibility targets for one tab.
 *
 * Split out of background.ts so the stages can grow into their own files
 * (stability, surfaces, geometry, supplement) without every change landing in
 * a thousand-line service worker. The relay calls captureObservation and does
 * not otherwise know what an observation is made of.
 */

import * as dbg from "../debugger";
import { waitForStable, pageMayStillBeMoving, Stability } from "./stability";
import { anyCommand, enumerateSurfaces, makeRef, FrameScan, Surface } from "./surfaces";
import { boxMap, GeometryResult } from "./geometry";
import { findHiddenTargets } from "./supplement";

const KEEP_ROLES = new Set([
  "button","link","textbox","searchbox","combobox","checkbox","radio",
  "menuitem","tab","option","switch","slider","spinbutton","gridcell",
  "heading","dialog","alert","listitem",
]);

// Mirrors PAGE_TEXT_MAX in agent/ax_filter.py.
const PAGE_TEXT_MAX = 20000;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// A link's destination lives in a CDP "url" property, not a top-level field.
function propUrl(node: any): string | undefined {
  for (const p of node.properties ?? []) {
    if (p.name !== "url") continue;
    const v = p.value;
    return (typeof v === "object" ? v?.value : v) || undefined;
  }
  return undefined;
}

/**
 * One frame's accessibility nodes, as targets.
 *
 * Written without local type annotations for the same reason as `anyCommand`:
 * `scripts/test-observation-surfaces.test.js` extracts this body and
 * evaluates it as plain JavaScript, and `: Set<number>` is a syntax error
 * there. `tsconfig` has `strict: false`, so nothing is lost.
 *
 * The parent chain is resolved *within the frame* — `nodeId` is only
 * meaningful next to its own frame's table — and only then turned into a
 * composite ref on the way out. The server's `_depths` walks `parent`
 * opaquely, so a `0:41` → `0:7` chain indents exactly as the bare node ids
 * did before frames existed.
 */
export async function targetsForFrame(
  tabId: number,
  surface: Surface,
  boxes?: GeometryResult["boxes"],
  blockedMap?: GeometryResult["blocked"],
): Promise<object[]> {
  const nodes = surface.axNodes;
  const targets = [];

  // The server indents by kept-ancestor depth, so it needs the parent
  // chain. Send the nearest *kept* ancestor and let it derive depth — one
  // implementation for both capture paths, not one per language. A link's
  // immediate parent is usually a generic container that never survives
  // KEEP_ROLES, so resolving only the direct parent yields depth 0.
  const kept = new Set();
  const parentOf = new Map();
  for (const node of nodes) {
    if (typeof node.nodeId === "number" && typeof node.parentId === "number") {
      parentOf.set(node.nodeId, node.parentId);
    }
    if (node.ignored) continue;
    const role = (node.role?.value ?? "").toLowerCase();
    if (!KEEP_ROLES.has(role)) continue;
    kept.add(node.nodeId);
  }

  const keptAncestor = (nodeId) => {
    const seen = new Set();
    let cur = parentOf.get(nodeId);
    while (cur !== undefined && !kept.has(cur)) {
      if (seen.has(cur)) return undefined;
      seen.add(cur);
      cur = parentOf.get(cur);
    }
    return cur;
  };

  for (const node of nodes) {
    if (!kept.has(node.nodeId)) continue;
    const role = (node.role?.value ?? "").toLowerCase();
    const name  = node.name?.value?.trim() ?? "";
    const value = node.value?.value ?? undefined;
    const href  = propUrl(node);
    const parentId = keptAncestor(node.nodeId);
    const backendId = node.backendDOMNodeId;
    // A disabled control is a real element with a real box that will do
    // nothing when clicked. It was dropped on the floor until now: the model
    // was handed the ref, the relay dispatched a click at a genuine
    // coordinate, and the audit recorded `ok: true` for a button the page had
    // switched off. Carried only when true — a field per target costs a
    // thousand false values on a page this size.
    const disabled = node.properties?.some(
      (p) => p?.name === "disabled" && p?.value?.value === true,
    ) === true;
    const blocked = backendId ? blockedMap?.get(backendId) : undefined;
    let x, y;
    // A blocked target has a box and still no coordinates. Emitting one
    // anyway is the bug; emitting it *with* the reason is what lets the relay
    // refuse in a sentence the model can act on.
    if (backendId && !blocked) {
      // Prefer the bulk map. A miss falls through to the per-node call rather
      // than dropping coords — an off-screen target and an unmeasured one are
      // different, and the fallback is what keeps that distinction honest.
      const box = boxes?.get(backendId);
      if (box) {
        ({ x, y } = box);
      } else {
        try {
          const one = await anyCommand(tabId, {
            method: "DOM.getBoxModel",
            params: { backendNodeId: backendId },
          });
          const c = one?.model?.content;
          if (c && c.length >= 4) {
            x = Math.round((c[0] + c[2]) / 2);
            y = Math.round((c[1] + c[3]) / 2);
          }
        } catch { /* offscreen — skip coords */ }
      }
    }
    targets.push({
      ref: makeRef(surface.frameIndex, node.nodeId), role, name,
      ...(value !== undefined ? { value } : {}),
      ...(href    !== undefined ? { href }    : {}),
      ...(parentId !== undefined ? { parent: makeRef(surface.frameIndex, parentId) } : {}),
      ...(x !== undefined    ? { x, y }   : {}),
      ...(blocked !== undefined ? { blocked } : {}),
      ...(disabled ? { disabled: true } : {}),
      // The frame this node lives in, so a click can be routed to the right
      // one. Refs are per-observation, so this travels with the target rather
      // than being looked up later.
      frameId: surface.frameId,
      // The server cannot tell a password field from an email field without
      // the DOM node, and this is the only place the id is available — the
      // getBoxModel call above already used it. One int on a target that is
      // already being sent.
      ...(backendId !== undefined ? { backendNodeId: backendId } : {}),
    });
  }
  return targets;
}

export async function extractAx(
  tabId: number,
): Promise<{ targets: object[]; frames: FrameScan; geometry: GeometryResult }> {
  await dbg.sendCommand(tabId, { method: "Accessibility.enable" });
  const { surfaces, scan } = await enumerateSurfaces(tabId);

  // One geometry call for the whole union, not one per node per frame: the
  // Gmail search page measured 608 targets, and the old per-node round trip
  // made observation latency proportional to page size on every step.
  const ids: number[] = [];
  for (const surface of surfaces) {
    for (const node of surface.axNodes ?? []) {
      if (typeof node?.backendDOMNodeId === "number") ids.push(node.backendDOMNodeId);
    }
  }
  const geometry = await boxMap(tabId, ids);

  const targets: object[] = [];
  const perFrame: number[] = [];
  // Sequential, not Promise.all: a frame bomb is capped, but a page that
  // legitimately has a dozen frames should not have twelve `getFullAXTree`
  // calls in flight against one debugger session.
  for (const surface of surfaces) {
    const fromTree = await targetsForFrame(
      tabId, surface, geometry.boxes, geometry.blocked,
    );
    perFrame.push(fromTree.length);
    targets.push(...fromTree);
    // aria-hidden controls the AX tree dropped on purpose. They carry
    // `hidden: true`, which is what stops the harness pre-approving one.
    targets.push(...await findHiddenTargets(
      tabId, surface, new Set(targets.map((t: any) => t.backendNodeId)),
    ));
  }
  // What the node cap is actually costing. `MAX_NODES_PER_FRAME` caps *raw*
  // AX nodes, but only kept-role nodes ever become targets — so `nodes` alone
  // cannot say whether a cap cost the model anything. `kept` is how many
  // controls survived out of the 2000 this frame was allowed; compare it with
  // `nodes` to see whether the slice is trimming containers or controls.
  //
  // The number of controls lost in the discarded tail is deliberately not
  // reported: it is not knowable from what is left in hand, and a plausible
  // wrong number here would be read as a measurement.
  for (const capped of scan.cappedFrames ?? []) {
    const kept = perFrame[capped.frameIndex];
    if (kept !== undefined) capped.kept = kept;
  }
  await dbg.sendCommand(tabId, { method: "Accessibility.disable" });
  return { targets, frames: scan, geometry };
}

/**
 * What the observation cost, in numbers the server can log.
 *
 * `waitForStable` returns a `Stability` and `boxMap` returns a `GeometryResult`,
 * and `captureObservation` threw both away — so the double rescan, the
 * `QUIET_MS` floor and the geometry overflow were all inferable from the source
 * and from nothing else. This reports values that already exist; it computes
 * nothing new.
 *
 * `geometry` is copied field by field rather than spread, because `boxes` is a
 * `Map` and a `Map` on the wire serialises to `{}` — which in the log is
 * indistinguishable from "the bulk path joined nothing", a real and different
 * fault. `scripts/test-observation-metrics.test.js` pins that.
 *
 * `bytes` is the size of the observation the model is about to be handed, and
 * the server retains it verbatim in `_cached_obs`, so it is the memory answer
 * too. Measured on the finished object rather than summed from its parts,
 * because the parts are not what is retained.
 */
function observationMetrics(
  stability: Stability,
  geometry: GeometryResult,
  scans: number,
  targetCount: number,
  bytes: number,
): object {
  return {
    scans,
    targets: targetCount,
    bytes,
    stability,
    geometry: {
      requested: geometry?.requested ?? 0,
      resolved: geometry?.resolved ?? 0,
      fallback: geometry?.fallback ?? 0,
      truncated: geometry?.truncated ?? false,
      source: geometry?.source ?? "empty",
    },
  };
}

export async function captureObservation(tabId: number) {
  // readyState reaches "complete" with the load event, which on a SPA is
  // before the app has rendered anything. Wait for the page to go still.
  const stability = await waitForStable(tabId);

  // Page text rides along with url/title in the evaluate that already runs
  // every step — no extra round trip. innerText is the only place numbers
  // like "Star 50" exist; the accessibility tree often omits them entirely.
  const ps = await dbg.sendCommand(tabId, {
    method: "Runtime.evaluate",
    params: {
      expression:
        `({url:location.href,title:document.title,` +
        `text:((document.body&&document.body.innerText)||'').replace(/\\s+/g,' ').slice(0,${PAGE_TEXT_MAX})})`,
      returnByValue: true,
    },
  }) as { result?: { value?: { url: string; title: string; text: string } } };
  const { url = "", title = "", text: pageText = "" } = ps.result?.value ?? {};

  let { targets: axTargets, frames, geometry } = await extractAx(tabId);
  let scans = 1;

  // Retry only while the tree is still moving. The old test was
  // `axTargets.length < 3`, which is wrong in both directions: a page that
  // rendered three useless targets stops retrying, and a merely-dense page
  // burns all four retries on itself. Two extra reads, stopping at the first
  // one that changes nothing.
  //
  // The loop's first iteration is unconditional, so a page that had already
  // gone still paid a second full scan and a changed page paid three. The
  // stability gate already ran and already knows: `pageMayStillBeMoving` is
  // false only when the page provably sat still for the whole quiet window.
  // That is a flat 3004ms off every settled observation, and an unsettled one
  // is unchanged — `auth-slowjs` renders its control at 5000ms, so it mutates
  // past the window, hits the deadline, and rescans exactly as before.
  //
  // ponytail: an unsettled page is still up to three full frame scans, so a
  // page with a dozen frames pays 36 `getFullAXTree` calls. Worth caching the
  // frame list across the retries if it ever shows up in a trace — the cap
  // bounds it, it is not unbounded.
  // The busy short-circuit in `stability.ts` is a guess: it assumes a page
  // already mutating hard is past its initial render. The rescans below are
  // what actually decide that, and they say so by breaking early — an exit
  // reason the loop was discarding.
  //
  // If every rescan saw a different tree, the page really was still moving
  // and the short path read it early. Pay the full quiet window then, and
  // scan once more. That is the slow-renderer shape (`auth-slowjs` renders at
  // 5000ms), and on it this is the pre-existing behaviour — wait the gate,
  // then rescan. On the fast path it costs nothing: the rescans matched and we
  // never arrive here.
  let settledByFingerprint = !pageMayStillBeMoving(stability);
  if (pageMayStillBeMoving(stability)) {
    const fingerprint = (ts: any[]) =>
      ts.map((t: any) => t.role + "|" + (t.name ?? "") + "|" + (t.value ?? "")).join("~");
    for (let i = 0, fp = fingerprint(axTargets); i < 2; i++) {
      await sleep(800);
      const next = await extractAx(tabId);
      const nextFp = fingerprint(next.targets);
      axTargets = next.targets;
      frames = next.frames;
      geometry = next.geometry;
      scans++;
      if (nextFp === fp) { settledByFingerprint = true; break; }
      fp = nextFp;
    }
  }
  if (stability.early && !settledByFingerprint) {
    await waitForStable(tabId, { noEarly: true });
    const settled = await extractAx(tabId);
    axTargets = settled.targets;
    frames = settled.frames;
    geometry = settled.geometry;
    scans++;
  }

  const observation = { url, title, pageText, axTargets, frames };
  // `frames` and `metrics` ride the wire for free — `sendObservation` spreads
  // the whole observation — so a truncated or cross-origin-reading step, and
  // what the observation cost to produce, are visible in the server log and
  // the audit without a second channel.
  return {
    ...observation,
    metrics: observationMetrics(
      stability, geometry, scans, axTargets.length,
      JSON.stringify(observation).length,
    ),
  };
}
