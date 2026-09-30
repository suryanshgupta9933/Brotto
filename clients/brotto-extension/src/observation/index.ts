/**
 * The observation pipeline: page state + accessibility targets for one tab.
 *
 * Split out of background.ts so the stages can grow into their own files
 * (stability, surfaces, geometry, supplement) without every change landing in
 * a thousand-line service worker. The relay calls captureObservation and does
 * not otherwise know what an observation is made of.
 */

import * as dbg from "../debugger";

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

export async function extractAx(tabId: number): Promise<object[]> {
  await dbg.sendCommand(tabId, { method: "Accessibility.enable" });
  const raw = await dbg.sendCommand(tabId, {
    method: "Accessibility.getFullAXTree",
  }) as { nodes?: any[] };
  const nodes = raw.nodes ?? [];
  const targets: object[] = [];

  // The server indents by kept-ancestor depth, so it needs the parent
  // chain. Send the nearest *kept* ancestor and let it derive depth — one
  // implementation for both capture paths, not one per language. A link's
  // immediate parent is usually a generic container that never survives
  // KEEP_ROLES, so resolving only the direct parent yields depth 0.
  const kept = new Set<number>();
  const parentOf = new Map<number, number>();
  for (const node of nodes) {
    if (typeof node.nodeId === "number" && typeof node.parentId === "number") {
      parentOf.set(node.nodeId, node.parentId);
    }
    if (node.ignored) continue;
    const role = (node.role?.value ?? "").toLowerCase();
    if (!KEEP_ROLES.has(role)) continue;
    kept.add(node.nodeId);
  }

  const keptAncestor = (nodeId: number): number | undefined => {
    const seen = new Set<number>();
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
    let x: number | undefined, y: number | undefined;
    if (backendId) {
      try {
        const box = await dbg.sendCommand(tabId, {
          method: "DOM.getBoxModel",
          params: { backendNodeId: backendId },
        }) as { model?: { content?: number[] } };
        const c = box.model?.content;
        if (c && c.length >= 4) {
          x = Math.round((c[0] + c[2]) / 2);
          y = Math.round((c[1] + c[3]) / 2);
        }
      } catch { /* offscreen — skip coords */ }
    }
    targets.push({
      ref: node.nodeId, role, name,
      ...(value !== undefined ? { value } : {}),
      ...(href    !== undefined ? { href }    : {}),
      ...(parentId !== undefined ? { parent: parentId } : {}),
      ...(x !== undefined    ? { x, y }   : {}),
      // The server cannot tell a password field from an email field without
      // the DOM node, and this is the only place the id is available — the
      // getBoxModel call above already used it. One int on a target that is
      // already being sent.
      ...(backendId !== undefined ? { backendNodeId: backendId } : {}),
    });
  }
  await dbg.sendCommand(tabId, { method: "Accessibility.disable" });
  return targets;
}

export async function waitForPageReady(tabId: number, maxWaitMs = 10_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const r = await dbg.sendCommand(tabId, {
        method: "Runtime.evaluate",
        params: { expression: "document.readyState", returnByValue: true },
      }) as { result?: { value?: string } };
      if (r.result?.value === "complete") {
        await sleep(400); // let JS frameworks render
        return;
      }
    } catch { /* tab mid-navigation — keep polling */ }
    await sleep(300);
  }
  // timed out — proceed with whatever is there
}

export async function captureObservation(tabId: number) {
  await waitForPageReady(tabId);

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

  let axTargets = await extractAx(tabId);

  // SPA pages render interactives after readyState — retry with backoff
  for (let i = 0; i < 4 && axTargets.length < 3; i++) {
    await sleep(800 * (i + 1));
    axTargets = await extractAx(tabId);
  }

  return { url, title, pageText, axTargets };
}
