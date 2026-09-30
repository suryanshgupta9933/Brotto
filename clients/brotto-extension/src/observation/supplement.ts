/**
 * The `aria-hidden` supplement: controls the site deliberately kept out of the
 * accessibility tree, surfaced with that fact marked.
 *
 * `aria-hidden` is not a Chrome gap. It is the accessibility contract working
 * as designed — an `aria-hidden` element is `ignored: true` in the AX tree, and
 * a screen-reader user cannot reach it either. That is what the attribute is
 * *for*. But such an element is very often still visible and clickable, and for
 * a task like "delete the draft" it is exactly the control the user means. The
 * `auth-aria-hidden` fixture is that case, and it failed the benchmark with
 * `GAP_ARIA`.
 *
 * So: surface it, marked. Two rules make that safe to do, and both live
 * outside this file — the line is rendered with `[hidden]` in
 * `agent/ax_filter.py`, and a supplemented node is not pre-approved under
 * secure mode in `agent/harness.py`. A control the site hid from assistive tech
 * still has to pass a first-time approval like anything else. Nothing here
 * changes what assistive technology sees.
 *
 * **This is a disclosure change**, the sharpest edge in the perception
 * workstream. Hence the two caps and the main-frame-only rule below.
 */

import { anyCommand, makeRef, Surface } from "./surfaces";

// Untrusted page content flowing into a model prompt, bounded twice.
//
// MAX_EVAL_BYTES is the CDP `Runtime.evaluate` ceiling from the Scalability
// table: a page whose serialized result crosses 512 KB is a page we do not
// read, and the probe re-checks it on the page side so the payload never
// leaves the renderer in the first place. MAX_HIDDEN_NODES is the realistic
// ceiling — a page with 200 visible, named, clickable `aria-hidden` controls is
// not a page whose 201st control is what the model wanted.
export const MAX_HIDDEN_NODES = 200;
export const MAX_EVAL_BYTES = 512 * 1024;

/**
 * The page-side probe. One `Runtime.evaluate`, one IIFE, no globals touched.
 *
 * `aria-hidden` is resolved with `closest('[aria-hidden="true"]')` rather than
 * read off the element, because a descendant carrying `aria-hidden="false"` is
 * re-exposed by its own attribute and is *not* hidden. Reading the marker
 * straight off the element would suppress that node for no reason.
 *
 * `checkVisibility` is the native platform answer to "is it actually on
 * screen" — no manual display/visibility/opacity walk, and it keeps up with
 * `content-visibility: hidden` without knowing about it.
 */
const HIDDEN_PROBE = `(function () {
  var CAP = ${MAX_EVAL_BYTES}, MAX = ${MAX_HIDDEN_NODES}, items = [], size = 0;
  var roleOf = function (el) {
    var explicit = (el.getAttribute("role") || "").split(/\\s+/)[0].toLowerCase();
    if (explicit) return explicit;
    var tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : "";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "input") {
      var t = (el.type || "text").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (t === "range") return "slider";
      if (t === "number") return "spinbutton";
      if (t === "button" || t === "submit" || t === "reset") return "button";
      return "textbox";
    }
    return "";
  };
  var nameOf = function (el) {
    var cands = [
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("placeholder"),
      el.getAttribute("alt"),
      el.tagName === "INPUT" ? el.value : null,
      el.textContent,
    ];
    for (var i = 0; i < cands.length; i++) {
      var s = (cands[i] || "").replace(/\\s+/g, " ").trim();
      if (s) return s.slice(0, 80);
    }
    return "";
  };
  var all = document.querySelectorAll("[aria-hidden]");
  for (var i = 0; i < all.length; i++) {
    if (items.length >= MAX) break;
    var el = all[i];
    if (!el.closest || !el.closest('[aria-hidden="true"]')) continue;
    if (el.checkVisibility && !el.checkVisibility()) continue;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    var role = roleOf(el), name = nameOf(el);
    if (!role || !name) continue;
    size += name.length + role.length + 64;
    if (size > CAP) return { capped: true, items: [] };
    items.push({
      role: role, name: name,
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
    });
  }
  return { capped: false, items: items };
})()`;

/**
 * Targets for the `aria-hidden` controls on `surface` that the accessibility
 * tree does not already carry.
 *
 * `seenBackendIds` is every `backendNodeId` the AX pass produced for this
 * observation. A site that marks a container `aria-hidden` and leaves a child
 * visible gets that child into the tree anyway, and the supplement must not
 * then hand the model the same control twice under two refs — the second copy
 * is not a duplicate line, it is a second thing to click.
 *
 * Identity comes from `DOM.getNodeForLocation` at the element's centre, which
 * answers all three questions in one call: which DOM node this actually is,
 * whether something is painted on top of it (a control under an overlay is not
 * clickable, and the node returned is the one on top), and its backend id.
 *
 * ponytail: the main frame only. `DOM.getNodeForLocation` reads coordinates in
 * the *top* viewport, so a same-origin subframe's own rect has to be offset by
 * its iframe's before the call means anything — get that wrong and the
 * hit-test returns some unrelated node and we click the wrong control, which
 * is worse than not supplementing. `auth-aria-hidden` is a top-frame gap and
 * no fixture has shown a subframe one. Add the offset when one is measured.
 *
 * Cross-origin surfaces are refused outright: evaluating script in a foreign
 * realm is the one thing this workstream must never do (`surfaces.ts` header),
 * and a read is not worth a materially larger privilege.
 */
export async function findHiddenTargets(
  tabId: number,
  surface: Surface,
  seenBackendIds?: Set<number>,
): Promise<object[]> {
  if (surface.crossOrigin || surface.depth > 0) return [];
  let raw;
  try {
    raw = await anyCommand(tabId, {
      method: "Runtime.evaluate",
      params: { expression: HIDDEN_PROBE, returnByValue: true },
    });
  } catch {
    return [];  // mid-navigation, or the frame went away under us
  }
  const value = raw?.result?.value;
  if (!value || value.capped || !Array.isArray(value.items)) return [];
  // The probe caps on the page side, so this can only trip on a page that
  // fought the probe. Re-checked here because 512 KB of JSON does not fit in
  // a model prompt, and an unreported overflow is how it gets there.
  if (JSON.stringify(value.items).length > MAX_EVAL_BYTES) return [];

  const targets = [];
  for (let i = 0; i < value.items.length; i++) {
    const it = value.items[i];
    let backendNodeId;
    try {
      const hit = await anyCommand(tabId, {
        method: "DOM.getNodeForLocation",
        params: { x: it.x, y: it.y },
      });
      backendNodeId = hit?.backendNodeId;
    } catch { /* fall through: unverified nodes are not surfaced */ }
    // Unverifiable is not surfaced. A control we cannot hit-test is one we
    // cannot promise the model is clickable, and the whole premise of the
    // supplement is that the model may act on it.
    if (backendNodeId === undefined) continue;
    if (seenBackendIds && seenBackendIds.has(backendNodeId)) continue;
    targets.push({
      // Negative node ids: CDP `nodeId`s are positive, so a supplemented ref
      // can never collide with an AX ref, and the pair still round-trips to
      // one unambiguous line in the rendered tree.
      ref: makeRef(surface.frameIndex, -(i + 1)),
      role: it.role,
      name: it.name,
      x: it.x,
      y: it.y,
      frameId: surface.frameId,
      backendNodeId,
      // The whole point. Read by ax_filter (renders `[hidden]`) and by
      // harness (never pre-approves a supplemented control).
      hidden: true,
    });
  }
  return targets;
}
