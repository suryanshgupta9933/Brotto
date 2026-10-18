/**
 * Coordinate clicks and the live cursor.
 *
 * Two things live here because they are the same problem seen from two ends:
 * a click at a coordinate that has never been near an accessibility node, and
 * a marker at that coordinate so the user can see where it is going.
 *
 * **A raw coordinate is a new trust class.** Every `click` coordinate today
 * came out of `BOX_WALK`, which checked it twice in the page: against the
 * viewport, then against `document.elementFromPoint`. A coordinate off the
 * wire has been checked by nobody, and a coordinate outside the viewport is a
 * click on nothing, on a page whose scroll position has since moved, or — the
 * case that matters — off the side of a window the user has since resized. So
 * `boundedPoint` re-reads the live viewport and refuses anything outside it.
 * The `viewport` the relay sends alongside the click is *not* the bound: it is
 * the server's idea of the viewport as of when it framed the action, and
 * trusting it is trusting a number the same untrusted message carried.
 *
 * Refusing is the cheap failure. A click outside the viewport is not a wasted
 * step, it is a click on an element nobody saw the model point at.
 *
 * **The cursor is an occluder, and that is the whole risk.** It lands in the
 * page, so `document.elementFromPoint` in `BOX_WALK` could see it and mark the
 * element beneath it `occluded` — breaking the very click the cursor is
 * announcing. Two defences, both required:
 *
 *   1. `pointer-events: none`, so the hit test skips it. This is what makes
 *      `scripts/test-cursor.test.js` assertable: the marker is invisible to the
 *      resolver, not merely drawn on top.
 *   2. Removal strictly after the `mousePressed`/`mouseReleased` pair, in a
 *      `finally` at the `executeAction` call site — not on a timer. A click
 *      that navigates throws on the observation that follows, and a timer is
 *      how a marker outlives the action that drew it.
 *
 * No offscreen document (no permission, no new surface) and no content script:
 * this is one more bounded `Runtime.evaluate`, the same primitive as
 * `observation/index.ts`.
 */

import * as dbg from "../debugger";

/** One wrapper so the call sites below stay annotation-free — the Node test
 *  extracts these function bodies and evaluates them as plain JavaScript, and
 *  a `: any` inside a body is a syntax error there. Same constraint as
 *  `anyCommand` in `surfaces.ts`. */
async function anyCommand(tabId: number, command: any): Promise<any> {
  return await dbg.sendCommand(tabId, command);
}

/** The marker's element id. The label gets `${id}-label`, so one `clearCursor`
 *  removes both by name rather than by class. */
export const CURSOR_ID = "__brotto_cursor";

/** A label is a truncated slice of model-authored text rendered into the page.
 *  Bounded because an unbounded one is a layout bomb on someone else's DOM. */
export const MAX_CURSOR_LABEL = 80;

/**
 * Draw the marker and its label, replacing any previous one.
 *
 * Returns `{drawn:false, reason}` when the point is not in this document — see
 * `DRAW_CURSOR`. Idempotent: it removes the old marker first, so a crash
 * between actions cannot leave one behind.
 *
 * No template literals or semicolons inside: the Node test slices these
 * constants out of the source between the backticks, and a backtick inside
 * would end the slice early.
 */
const DRAW_CURSOR = `function (x, y, label, id) {
  var doc = document;
  var prev = doc.getElementById(id);
  if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
  var prevLabel = doc.getElementById(id + "-label");
  if (prevLabel && prevLabel.parentNode) prevLabel.parentNode.removeChild(prevLabel);
  // Where the click will actually land. An iframe here means the content is
  // another document, and a marker appended to *this* body's stacking context
  // is invisible over it — with no error, which is the failure this probe
  // exists to convert from a shrug into a sentence. See KNOWN LIMITATION below.
  var probe = doc.elementFromPoint(x, y);
  while (probe) {
    if (probe.tagName === "IFRAME") return { drawn: false, reason: "foreign-frame" };
    probe = probe.parentNode;
  }
  var host = doc.body || doc.documentElement;
  if (!host) return { drawn: false, reason: "no-body" };
  var dot = doc.createElement("div");
  dot.id = id;
  dot.style.position = "fixed";
  dot.style.left = (x - 7) + "px";
  dot.style.top = (y - 7) + "px";
  dot.style.width = "14px";
  dot.style.height = "14px";
  dot.style.borderRadius = "50%";
  dot.style.border = "2px solid #ef4444";
  dot.style.background = "rgba(239,68,68,0.25)";
  dot.style.pointerEvents = "none";
  dot.style.zIndex = "2147483647";
  var tag = doc.createElement("div");
  tag.id = id + "-label";
  tag.textContent = String(label == null ? "" : label).slice(0, ${MAX_CURSOR_LABEL});
  tag.style.position = "fixed";
  tag.style.left = (x + 12) + "px";
  tag.style.top = (y + 12) + "px";
  tag.style.maxWidth = "260px";
  tag.style.padding = "3px 7px";
  tag.style.background = "#111827";
  tag.style.color = "#f9fafb";
  tag.style.font = "12px/1.4 system-ui, sans-serif";
  tag.style.borderRadius = "4px";
  tag.style.pointerEvents = "none";
  tag.style.zIndex = "2147483647";
  host.appendChild(dot);
  host.appendChild(tag);
  return { drawn: true, reason: "" };
}`;

/** Remove the marker and the label. Never throws on a missing marker: this is
 *  the `finally` path, and a throw there would mask the click's own failure. */
const CLEAR_CURSOR = `function (id) {
  var doc = document;
  var a = doc.getElementById(id);
  if (a && a.parentNode) a.parentNode.removeChild(a);
  var b = doc.getElementById(id + "-label");
  if (b && b.parentNode) b.parentNode.removeChild(b);
  return true;
}`;

const MAX_LABEL = MAX_CURSOR_LABEL;

/**
 * KNOWN LIMITATION — this is the top frame, and only the top frame.
 *
 * `Runtime.evaluate` with no `contextId` runs in the top document. Google
 * Sheets and Figma host their grids in a shadow root and an iframe
 * respectively, so on those the marker is appended to the wrong document,
 * renders nowhere the user is looking, and raises no error. Binding the right
 * execution context needs `Page.getFrameTree` + `Page.createIsolatedWorld` per
 * frame plus a target attach for an out-of-process iframe — and
 * `observation/surfaces.ts` opens with a standing rule that this workstream
 * does not evaluate script in a cross-origin frame's context. So the cursor
 * stays in the top document and the draw *reports* when the point is not in
 * it, rather than pretending.
 *
 * The click itself is unaffected: `Input.dispatchMouseEvent` takes
 * viewport-relative coordinates and the browser routes them to whichever
 * frame is under the point.
 *
 * A shadow root is fine, and is not part of this limitation — the marker is
 * appended to `body` with the maximum `z-index`, which paints above shadow
 * content in the same document.
 */
export async function drawCursor(tabId, x, y, label) {
  const expression = "(" + DRAW_CURSOR + ")(" +
    JSON.stringify(x) + "," + JSON.stringify(y) + "," +
    JSON.stringify(String(label == null ? "" : label).slice(0, MAX_LABEL)) + "," +
    JSON.stringify(CURSOR_ID) + ")";
  try {
    const r = await anyCommand(tabId, {
      method: "Runtime.evaluate",
      params: { expression: expression, returnByValue: true },
    });
    const v = r?.result?.value;
    return { drawn: v?.drawn === true, reason: String(v?.reason ?? "") };
  } catch {
    // No marker. The click still happens; the user just does not see it, which
    // is a smaller failure than a click that does not happen.
    return { drawn: false, reason: "evaluate-failed" };
  }
}

/** Idempotent. Call it before drawing and in the `finally` after clicking. */
export async function clearCursor(tabId) {
  try {
    await anyCommand(tabId, {
      method: "Runtime.evaluate",
      params: { expression: "(" + CLEAR_CURSOR + ")(" + JSON.stringify(CURSOR_ID) + ")", returnByValue: true },
    });
  } catch {
    // A tab mid-navigation rejects the evaluate. Nothing to clear, or the
    // document that held it is gone — both are the outcome we wanted anyway.
  }
}

/**
 * The live viewport, or null if it cannot be read.
 *
 * One call, and only for a coordinate that arrived on the wire: a ref-derived
 * coordinate was already bounded by `BOX_WALK` against `window.inner*` in the
 * page itself, and re-reading it per `click` would be a round trip to learn
 * nothing. `cssLayoutViewport` is CSS pixels, which is the unit the click is
 * dispatched in; `layoutViewport` is device-independent pixels on some builds
 * and is only a fallback.
 */
export async function liveViewport(tabId) {
  try {
    const m = await anyCommand(tabId, { method: "Page.getLayoutMetrics" });
    const css = m?.cssLayoutViewport ?? m?.layoutViewport;
    if (css && css.clientWidth > 0 && css.clientHeight > 0) {
      return { width: css.clientWidth, height: css.clientHeight };
    }
  } catch {
    // A tab that will not answer has no viewport to clamp against.
  }
  return null;
}

/**
 * A wire coordinate, bounded against the live viewport — or null.
 *
 * Null covers every refusal: a non-number (the frame carried `x: "412"`), a
 * NaN or Infinity, a viewport that would not read, and a point outside it.
 * Half-open, `x < width`, because BOX_WALK uses the same half-open bound and
 * the two disagreeing at the far edge is its own bug.
 */
export async function boundedPoint(tabId, x, y) {
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!isFinite(x) || !isFinite(y)) return null;
  const px = Math.round(x);
  const py = Math.round(y);
  const vp = await liveViewport(tabId);
  if (!vp) return null;
  if (px < 0 || py < 0 || px >= vp.width || py >= vp.height) return null;
  return { x: px, y: py };
}