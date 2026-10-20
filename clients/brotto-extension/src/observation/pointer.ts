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
 * The dispatch-time hit test. Runs as a string in the page, with the *resolved
 * element* as `this` — so this is `Runtime.callFunctionOn`, not
 * `Runtime.evaluate`: the element arrived as a `backendNodeId`, which has no
 * page-side accessor at all, and `DOM.resolveNode` is the only thing that turns
 * it into something script can hold. That is the same two-call shape
 * `geometry.ts` uses for `BOX_WALK`, reused rather than a second probe invented
 * beside it.
 *
 * **`elementFromPoint`, not `DOM.getNodeForLocation`.** The CDP one is cheaper
 * (one call, returns a `backendNodeId` directly) and the codebase already uses
 * it in `supplement.ts` — but it answers a different question. It returns the
 * *deepest* node at the point, so a click on `<button><span>Send</span></button>`
 * returns the `<span>`, which is not the element the accessibility observation
 * named, and a naive `==` would refuse nearly every real click. `el.contains(hit)`
 * is what absorbs the ordinary case, and it is the direction that matters: a hit
 * on a *descendant* is a hit on the element, a hit on an *ancestor* is not.
 * `DOM.getNodeForLocation` cannot be rescued this way without re-walking the
 * tree to find an AX-identical ancestor, which is the cost this gate exists to
 * avoid.
 *
 * The shadow-host walk is the one case `contains()` does not cover, and it is
 * deliberate: `elementFromPoint` does not pierce a shadow boundary, so a target
 * inside an open shadow root resolves to its *host* — and the browser retargets
 * the event to that host, so the click genuinely lands where we are aiming. Only
 * shadow hosts are admitted, never ordinary ancestors, for the reason above.
 *
 * No template literals or semicolons at EOL: `scripts/test-target-hittest.test.js`
 * slices this constant out of the source between the backticks.
 */
const TARGET_PROBE = `function (x, y) {
  var el = this;
  if (!el || el.nodeType !== 1) return { ok: false, reason: "not-an-element" };
  // The coordinates on the wire are in the *top* frame. Establish that first,
  // so the document below is the top document and not whatever frame this
  // callFunctionOn happened to bind to. window.top !== window is an identity
  // comparison — it reads a cross-origin WindowProxy and never evaluates a
  // script in the other frame — where binding the right context properly
  // (Page.getFrameTree plus a contextId) is the frame-tree work the KNOWN
  // LIMITATION below declines.
  var top = window.top;
  if (!top || top !== window) return { ok: false, reason: "cross-frame-target" };
  // Now that the coordinate space is the top frame's, the element must be in it
  // too. **Unreadable is not the same document.** A falsy ownerDocument — a
  // detached node, a synthetic object — reads as "same document" under a
  // truthiness test and proceeds to a hit test against a node that is not in
  // this page at all. Every failure here refuses, so compare explicitly.
  if (!el.ownerDocument || el.ownerDocument !== document) {
    return { ok: false, reason: "cross-frame-target" };
  }
  var hit = document.elementFromPoint(x, y);
  if (!hit) return { ok: false, reason: "point-hit-nothing" };
  if (hit === el) return { ok: true, reason: "" };
  if (el.contains && el.contains(hit)) return { ok: true, reason: "" };
  var root = el.getRootNode ? el.getRootNode() : null;
  while (root && root.host) {
    var host = root.host;
    if (host === hit || (host.contains && host.contains(hit))) return { ok: true, reason: "" };
    root = host.getRootNode ? host.getRootNode() : null;
  }
  var tag = hit.tagName ? String(hit.tagName).toLowerCase() : "unknown";
  return { ok: false, reason: "different-element:" + tag };
}`;

/**
 * Is (x, y) still the element this observation resolved?
 *
 * The geometry guards in `BOX_WALK` decide at *observation* time. Between that
 * and the press sits a model call — tens of seconds in which the page can
 * re-render, a menu can open, a spinner can mount. `Input.dispatchMouseEvent`
 * returns `{}` for a click that lands anywhere, including on `<body>`, so a
 * stale coordinate is dispatched, resolves, and is audited `ok: true`. That is
 * the same failure shape the geometry guards were written for and they cannot
 * close it, because they are upstream of the delay. This is downstream of it.
 *
 * Two CDP calls on the already-attached session, per ref-derived click only.
 * Nothing here runs for `click_xy` / `focus_xy` / `type_xy`: those arrive with
 * no ref and no id, they are gated by `boundedPoint` and by an approval
 * screenshot, and refusing them on an absent id would break the only way to act
 * on a canvas page.
 *
 * **Every failure here refuses.** That is the decision, and the reason is the
 * asymmetry that runs through all of `geometry.ts`: a wrong click is data loss,
 * a missing click is one step. If the tab navigated the id no longer resolves
 * and the observation is stale by definition; if the probe throws, the document
 * went away mid-call. Neither is the kind of failure where proceeding is the
 * optimistic reading — proceeding is precisely the silent wrong click this
 * exists to prevent. The one case that fails open is an action carrying no
 * `backendNodeId` at all, which means a relay older than the field and no gate
 * to run; that is today's behaviour, not a new hole, and it warns.
 */
export async function verifyTarget(tabId, backendNodeId, x, y) {
  if (typeof backendNodeId !== "number") return { ok: true, reason: "no-backend-id" };
  if (typeof x !== "number" || typeof y !== "number" || !isFinite(x) || !isFinite(y)) {
    return { ok: false, reason: "point-not-numeric" };
  }
  const px = Math.round(x);
  const py = Math.round(y);
  let objectId = "";
  try {
    const resolved = await anyCommand(tabId, {
      method: "DOM.resolveNode",
      params: { backendNodeId },
    });
    objectId = resolved?.object?.objectId || "";
  } catch {
    // A navigated tab, or a node the page has since dropped. Either way the
    // element the model pointed at is gone; the coordinate is now a guess.
    return { ok: false, reason: "target-gone" };
  }
  if (!objectId) return { ok: false, reason: "target-unresolvable" };
  try {
    const call = await anyCommand(tabId, {
      method: "Runtime.callFunctionOn",
      params: {
        objectId,
        functionDeclaration: TARGET_PROBE,
        arguments: [{ value: px }, { value: py }],
        returnByValue: true,
        awaitPromise: false,
      },
    });
    const v = call?.result?.value;
    if (!v || typeof v !== "object") return { ok: false, reason: "probe-silent" };
    return { ok: v.ok === true, reason: String(v.reason ?? "") };
  } catch {
    // The probe itself failed — context destroyed, or the call refused. The
    // question "is this still the right element" has no answer, and refusing is
    // the honest one. See the note above.
    return { ok: false, reason: "probe-failed" };
  }
}

/**
 * Did the press leave something that can receive text?
 *
 * `Input.insertText` writes into `document.activeElement` and verifies nothing,
 * so a press that focused nothing — a dead cell, a div that took the click but
 * not the focus — turns into a keystroke into whatever *was* focused, or into
 * silence. `type_at` fuses the click and the type into one action, which closes
 * the window `focus_id` in `cdp/relay.py` uses to catch the user reaching for
 * the keyboard mid-step; this is the extension-side half of that protection.
 *
 * **Identity is not checked here.** Google Sheets focuses an input that is not a
 * descendant of the cell node that was clicked, so a containment test inside this
 * probe would refuse on exactly the shape this exists to serve. Identity is
 * `bindFocus`'s, it is engine-sourced, and it runs *before* this probe — so by
 * the time `select()` is reached, the element it is called on has been proved to
 * be the thing the press was aimed at (or the narrow, logged canvas exemption).
 * This probe's remaining question is only "is there something here that can
 * receive text", which is the one a click can answer on its own.
 *
 * **The clear is here, and it is a DOM operation.** It used to be a key chord
 * the caller had to name, via a `modifiers` bitmask on the frame, because "which
 * chord means select-all" is an OS question and this file is forbidden from
 * asking it: Ctrl+A is "move to line start" on macOS and this drives a user's
 * laptop. The server could not answer it either — it has no OS signal, and its
 * own select-all ran *before* the press, against whatever held focus before,
 * i.e. possibly a different field, which is the "erase some other field"
 * failure. Ordering is why this cannot be a server-side call: after `pressAt`,
 * `activeElement` *is* the clicked target; before it, it is not.
 *
 * `activeElement` and not the clicked node, which is the Sheets question: a
 * cell is a `<canvas>` whose press focuses a hidden input that is not a
 * descendant of the cell node, so a containment test refuses on exactly the
 * shape this action exists for. `select()` works the same on a hidden input
 * wherever it hangs in the tree — it selects that element's own contents, not a
 * region of the page.
 *
 * Both questions, one evaluate, in the order they were already asked in — the
 * same composition `CLEAR_AND_FOCUS_JS` performs server-side. A second round
 * trip would ask the same unchanged `activeElement` twice.
 *
 * The clear's verdict rides the same `{ok, reason}` as the focus's, in a closed
 * vocabulary. **The whole list lives in `TYPE_AT_REFUSALS` below** — no tag
 * name or other page-chosen text appears, because this string reaches the
 * model's history and the audit document.
 *
 * No template literals or semicolons inside: the Node test slices this out of
 * the source between the backticks.
 */
const FOCUS_PROBE = `function (doClear) {
  var a = document.activeElement;
  if (!a) return { ok: false, reason: "no-active-element" };
  // The document and the root element are the "nobody is focused" answer in
  // every engine. insertText against either is a no-op, so calling that a
  // failure is reporting the truth rather than inventing one.
  if (a === document.body) return { ok: false, reason: "focus-on-body" };
  if (a === document.documentElement) return { ok: false, reason: "focus-on-root" };
  // A focused <iframe> is a *document*, not an element: insertText against it
  // lands in the frame, which no observation this run produced covered. Named
  // apart from the generic refusal below because the cause is a different one
  // and the sentence the model reads should say so.
  if (a.tagName === "IFRAME") return { ok: false, reason: "focus-on-frame" };
  // **One predicate, both paths.** "Is this a text field" was inferred from
  // \`typeof a.select === "function"\`, which is a duck type: any element can
  // carry a \`select\`, a \`select()\` on a <div> does nothing, and the page owns
  // that method. \`instanceof\` against the extension's own prototypes is the
  // real test — and it holds here precisely because the probe runs in an
  // isolated world (see IDENTITY_PROBE), where these classes cannot be
  // shadowed by anything the page did.
  var field = a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a.isContentEditable === true;
  if (!field) return { ok: false, reason: doClear ? "clear-no-text-field" : "focus-no-text-field" };
  // Nothing was asked to be cleared, and what holds focus can receive text —
  // which is the whole question on this path. \`Input.insertText\` verifies
  // nothing, so the answer used to be "success" for a <div> that took the click
  // and a keystroked into nothing.
  if (!doClear) return { ok: true, reason: "" };
  try {
    if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) {
      a.select();
      // **Confirm the clear, do not infer it.** HTMLInputElement.select() is
      // specified to do *nothing* on an input type it does not apply to — email,
      // number, date, time — and to do nothing rather than throw, so a call
      // that returned is not evidence a clear happened. Read the selection back
      // and require it to cover the whole value; anything less is a clear that
      // did not happen, and the text after it would append to a field the model
      // asked to empty.
      //
      // The value is read first so an *empty* field of a no-op type returns
      // before \`selectionStart\` is touched: it is null (not a number) on those
      // types, and an empty field has nothing to clear, so appending to it is
      // correct. That is also the Sheets case — the canvas exemption's editor
      // holds the cell's text in a hidden input, and an empty cell's input is
      // empty.
      var len = typeof a.value === "string" ? a.value.length : -1;
      if (len === 0) return { ok: true, reason: "" };
      var start = a.selectionStart;
      var end = a.selectionEnd;
      if (typeof start !== "number" || typeof end !== "number" || end - start !== len) {
        return { ok: false, reason: "clear-select-noop" };
      }
      return { ok: true, reason: "" };
    }
    // contenteditable: no \`select()\`, so a range over the node's contents is
    // the same operation by another route — and it is confirmed the same way.
    var had = a.textContent ? a.textContent.length : 0;
    var sel = document.getSelection();
    if (!sel) return { ok: false, reason: "clear-select-noop" };
    var range = document.createRange();
    range.selectNodeContents(a);
    sel.removeAllRanges();
    sel.addRange(range);
    if (had > 0) {
      if (sel.rangeCount !== 1) return { ok: false, reason: "clear-select-noop" };
      var got = sel.getRangeAt(0);
      if (!got || !got.toString()) return { ok: false, reason: "clear-select-noop" };
    }
    return { ok: true, reason: "" };
  } catch (err) { return { ok: false, reason: "clear-threw" }; }
}`;

/**
 * **The probe runs in an isolated world, and that is load-bearing.** In the
 * page's own world the page owns both the question and the effect: it can
 * override the `document.activeElement` getter so the probe reports a focus
 * that is not there, and it can override `Element.prototype.select` so
 * `select()` does something other than select. A probe a malicious page can
 * answer *and* act on is not a guard — so this evaluates in a world whose
 * prototypes are the extension's, and `focusState` is only ever called after
 * `bindFocus` has independently named the focused node from the engine, so the
 * two walls fail independently rather than resting on the same script.
 */
const IDENTITY_PROBE = `function (focus) {
  var el = this;
  if (!el || el.nodeType !== 1) return { ok: false, reason: "unreadable", tag: "" };
  if (!focus || focus.nodeType !== 1) return { ok: false, reason: "unreadable", tag: "" };
  var tag = el.tagName ? String(el.tagName).toUpperCase() : "";
  // The ordinary case: the same node, or focus landing on a descendant of what
  // was pressed — a <label>, a <div> wrapper, a <span> inside a button. A hit on
  // a *descendant* is a hit on the element; an ancestor is not admitted.
  if (el === focus) return { ok: true, reason: "same-node", tag: tag };
  if (el.contains && el.contains(focus)) return { ok: true, reason: "focus-inside-target", tag: tag };
  // The shadow direction: the press resolved to a node inside an open shadow
  // root — elementFromPoint does not pierce one, so it resolved to the host —
  // and the browser retargeted focus to that same host. So the focus is one of
  // the *pressed node's* shadow hosts, which ordinary contains() cannot see.
  var sroot = el.getRootNode ? el.getRootNode() : null;
  while (sroot && sroot.host) {
    if (sroot.host === focus) return { ok: true, reason: "focus-retargeted-to-host", tag: tag };
    sroot = sroot.host.getRootNode ? sroot.host.getRootNode() : null;
  }
  return { ok: false, reason: "not-the-target", tag: tag };
}`;

/** The one named world. Reused: `createIsolatedWorld` is idempotent per name. */
const IDLE_WORLD = "brotto-idle";

/**
 * **Every reason `type_at` can refuse, in one list.**
 *
 * These strings are a closed vocabulary: they reach the model's history and the
 * audit document, so each one names a *cause* and nothing about the page. They
 * are kept here rather than at their five call sites because the list is the
 * thing a reader needs, and a reader who has to assemble it from the branches
 * will read it wrong — which is how a duck-typed refusal reason got in
 * alongside a real one. Exported so `scripts/test-type-at.test.js` can assert
 * every `reason:` in the source is in here, and every entry here is used.
 *
 *   no-active-element       `document.activeElement` was null — nothing to read,
 *                           or the document went away under the probe.
 *   focus-on-body           focus is `<body>`, the engine's "nobody" answer.
 *   focus-on-root           focus is `<html>`, the same answer by another name.
 *   focus-on-frame          focus is an `<iframe>`: the text would land in
 *                           another document, which no observation covered.
 *   focus-no-text-field     focus is a real element but not one `Input.insertText`
 *                           can enter, and no clear was asked for.
 *   focus-unidentified      the frame carried no `backendNodeId`, so there is
 *                           nothing to bind a destructive clear to. `verifyTarget`
 *                           passes that case through; the clear cannot.
 *   focus-identify-failed   the engine would not name the focused node, or the
 *                           probe over it failed. Never inferred.
 *   focus-not-the-target    focus holds a node that is not the pressed node, not
 *                           inside it, and not a canvas editor inside it.
 *   focus-probe-failed      the `Runtime.evaluate` threw — the document is gone.
 *   focus-probe-silent      the evaluate returned no object: no answer, no pass.
 *   clear-select-noop       the clear was requested and did not happen — the
 *                           selection did not cover the value, or the range did
 *                           not materialise. The clear is *confirmed*, never
 *                           inferred from `select()` having returned.
 *   clear-threw             `select()` / `createRange` threw — a detached node.
 *   clear-no-text-field     a clear was asked for and focus is not a text field,
 *                           so there is nothing to clear.
 *   point-out-of-viewport   the coordinate is not a point in the live viewport
 *                           (outside it, not finite, or the viewport unreadable).
 *                           Shared with `click_xy`.
 *   point-not-numeric       x/y were not numbers on the frame.
 *   target-gone             the pressed node no longer resolves — the page
 *                           dropped it, or the tab navigated.
 *   target-unresolvable     `DOM.resolveNode` answered without an object id.
 *   probe-silent            the dispatch-time hit test returned no object.
 *   probe-failed            the dispatch-time hit test threw.
 *   different-element:<tag> the hit test found a different element at the point.
 *                           The tag is appended by `TARGET_PROBE` and is the one
 *                           place a page-chosen string enters; it names a tag,
 *                           which is engine-derived, not freeform.
 */
export const TYPE_AT_REFUSALS: Readonly<Record<string, string>> = {
  "no-active-element": "nothing holds focus, or the document went away",
  "unreadable": "the pressed node or the focused node would not resolve in the probe's realm",
  "not-an-element": "the dispatch-time probe was not bound to an element",
  "cross-frame-target": "the target is not in this document — the coordinates are the top frame's",
  "point-hit-nothing": "elementFromPoint returned nothing at the dispatched point",
  "no-backend-id": "the frame carried no id, so the hit test has nothing to gate — a pass-through, not a proof",
  
  "focus-on-body": "focus is <body>",
  "focus-on-root": "focus is <html>",
  "focus-on-frame": "focus is an <iframe>: the text would land in another document",
  "focus-no-text-field": "focus is real but cannot receive Input.insertText",
  "focus-unidentified": "no backendNodeId to bind a destructive clear to",
  "focus-identify-failed": "the engine would not name the focused node",
  "focus-not-the-target": "focus is not the pressed node, an ancestor-descendant of it, or a canvas editor",
  "focus-probe-failed": "the focus evaluate threw; the document went away",
  "focus-probe-silent": "the focus evaluate returned no answer",
  "clear-select-noop": "the clear was requested and did not happen",
  "clear-threw": "select()/createRange threw — a detached node",
  "clear-no-text-field": "a clear was asked for and focus is not a text field",
  "point-out-of-viewport": "the coordinate is not a point in the live viewport",
  "point-not-numeric": "x or y on the frame was not a number",
  "target-gone": "the pressed node no longer resolves",
  "target-unresolvable": "DOM.resolveNode returned no object id",
  "probe-silent": "the dispatch-time hit test returned no object",
  "probe-failed": "the dispatch-time hit test threw",

  // The successes, in the same list because they ride the same wire and a
  // reader handed this list should not have to guess which half a name is in.
  // Every one of these means `ok: true`, and `canvas-editor-exempt` is the
  // only one that is an allowance rather than a proof.
  "same-node": "OK — focus is the pressed node",
  "focus-inside-target": "OK — focus is inside the pressed node",
  "focus-retargeted-to-host": "OK — focus was retargeted to the pressed node's shadow host",
  "not-the-target": "the identity probe's verdict before the exemption is consulted",
  "identity-verified": "OK — the probe answered without naming which way",
  "canvas-editor-exempt": "OK by exemption — a canvas cell whose editor lies inside it",
};

/** Cache the world's context id per tab. One `Page.createIsolatedWorld` per tab,
 *  not one per action — the clear runs on every `type_at`, and the `evaluate`
 *  frame's `isolatedWorld` flag reuses this same world rather than making a
 *  second one per call. */
const worldIds = new Map<number, number>();

export async function isolatedWorld(tabId: number): Promise<number> {
  const cached = worldIds.get(tabId);
  if (typeof cached === "number") return cached;
  const created = await anyCommand(tabId, {
    method: "Page.createIsolatedWorld",
    params: { frameId: await topFrameId(tabId), worldName: IDLE_WORLD, grantUniveralAccess: false },
  });
  const id = created?.executionContextId;
  if (typeof id !== "number") throw new Error("no execution context");
  worldIds.set(tabId, id);
  return id;
}

/**
 * Run `fn` in the tab's isolated world, and make a stale context id
 * self-correcting.
 *
 * A context id belongs to a *renderer*, not to a tab: it dies with a
 * cross-document navigation and with a detach/reattach, and neither event
 * invalidates this cache. Enumerating the invalidating events would rot — a
 * future one is missed and the id goes stale again, silently, because a
 * `Runtime.evaluate` against a dead context is an *error*, not an empty value,
 * and every caller here reads "the extension could not evaluate".
 *
 * So the staleness corrects itself: one failure drops the entry, the world is
 * created again, and the call runs once more. That covers every cause —
 * navigation, detach, frame swap, context destroyed — without a list of them.
 * Keying the cache on the frame's `loaderId` is cheaper on the happy path but
 * still misses detach-and-reattach-to-the-same-page, which is the case a live
 * run actually hit.
 *
 * A second failure propagates unchanged, so a real fault is still one.
 */
export async function withWorld<T>(tabId: number, fn: (contextId: number) => Promise<T>): Promise<T> {
  try {
    return await fn(await isolatedWorld(tabId));
  } catch (e) {
    worldIds.delete(tabId);
    return await fn(await isolatedWorld(tabId));
  }
}

async function topFrameId(tabId: number): Promise<string> {
  const tree = await anyCommand(tabId, { method: "Page.getFrameTree" });
  const id = tree?.frameTree?.frame?.id;
  if (typeof id !== "string") throw new Error("no frame tree");
  return id;
}

/**
 * The focused node, as the *engine* names it.
 *
 * `DOM.getFocusNode` + `DOM.describeNode` is the answer the page has no way to
 * reach: no script runs to produce it, so overriding `document.activeElement`
 * changes nothing. This is the primary wall — `focusState`'s in-page read is
 * corroboration for the *effect*, this is the authority for the *identity*.
 *
 * Every failure refuses. `DOM.getFocusNode` is experimental and can decline to
 * answer; a page whose focus cannot be named cannot be cleared.
 */
async function focusNode(tabId: number): Promise<{ ok: boolean; reason: string; backendNodeId?: number; nodeName?: string }> {
  try {
    await anyCommand(tabId, { method: "DOM.enable" });
    const got = await anyCommand(tabId, { method: "DOM.getFocusNode" });
    const nodeId = got?.nodeId;
    if (typeof nodeId !== "number") return { ok: false, reason: "focus-identify-failed" };
    const described = await anyCommand(tabId, { method: "DOM.describeNode", params: { nodeId } });
    const backendNodeId = described?.node?.backendNodeId;
    const nodeName = described?.node?.nodeName;
    if (typeof backendNodeId !== "number") return { ok: false, reason: "focus-identify-failed" };
    return { ok: true, reason: "", backendNodeId, nodeName: String(nodeName ?? "") };
  } catch {
    return { ok: false, reason: "focus-identify-failed" };
  }
}

/** A box, as min/max CSS px, or null. `DOM.getBoxModel` declines on a node that
 *  is not rendered, which is the answer "no visible box" rather than a throw. */
async function box(tabId: number, backendNodeId: number) {
  try {
    const m = await anyCommand(tabId, { method: "DOM.getBoxModel", params: { backendNodeId } });
    const quads = m?.model?.quads;
    if (!Array.isArray(quads) || quads.length < 1) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const q of quads) {
      for (let i = 0; i + 1 < q.length; i += 2) {
        minX = Math.min(minX, q[i]); maxX = Math.max(maxX, q[i]);
        minY = Math.min(minY, q[i + 1]); maxY = Math.max(maxY, q[i + 1]);
      }
    }
    return { minX, minY, maxX, maxY };
  } catch {
    return null;
  }
}

/** Text-entry controls. A `CANVAS` press may only reach one of these through the
 *  exemption — never a button, never a div, never a contenteditable host. */
const TEXT_INPUT_TAGS = new Set(["INPUT", "TEXTAREA"]);

/**
 * Prove that what holds focus is the thing this press was aimed at.
 *
 * Three walls, and none of them closes the finding alone:
 *
 *   1. **Engine-sourced identity** — `DOM.getFocusNode` vs the pressed
 *      `backendNodeId`. The page cannot lie: no script runs to answer. Alone
 *      this would refuse Sheets, and alone it would refuse a `<label>` press.
 *   2. **Containment, in an isolated world** — same node, a descendant, or a
 *      focus the browser retargeted to the pressed node's shadow host. This
 *      absorbs the ordinary DOM cases identity-by-equality throws away.
 *   3. **The canvas exemption**, for the one shape none of the above can serve:
 *      a `<canvas>` grid cell whose press focuses a hidden editor that is not
 *      the cell and not inside it.
 *
 * **The exemption, stated so it can be checked.** All four hold:
 *
 *   (i)   the pressed node is a `CANVAS`;
 *   (ii)  the focused node is an `INPUT` or `TEXTAREA` — the engine's own name
 *         for it, not a page-supplied attribute;
 *   (iii) the focused node has a rendered box, and that box lies **wholly
 *         inside** the pressed canvas's box.
 *
 * (iii) is what makes this narrow rather than a hole. A visible field the user
 * was typing into — a real search box, a real form input — is somewhere else
 * on the page, so its box cannot be inside the canvas that was just clicked,
 * and a press on a canvas can never clear it. Both boxes come from the engine,
 * in the engine's own coordinates, so no page attribute (`aria-hidden`,
 * `style="opacity:0"`, `hidden`) can unlock the exemption by being written
 * onto the user's own field. The residual: a page that physically moved the
 * user's focused input on top of the canvas it was clicked — at which point
 * `verifyTarget`'s `elementFromPoint` hit test has already refused the press as
 * `different-element`, because the click landed on the input, not the canvas.
 *
 * The exemption is reported, never silent: it returns
 * `ok: true, reason: "canvas-editor-exempt"`, and the caller logs it.
 */
export async function bindFocus(tabId, backendNodeId, x, y) {
  if (typeof backendNodeId !== "number") {
    // Nothing to bind a *destructive* clear to. `verifyTarget` fails open on an
    // absent id because an older relay has no gate to run; the clear has no such
    // excuse — it is the one operation here that destroys the user's text.
    return { ok: false, reason: "focus-unidentified" };
  }
  const focus = await focusNode(tabId);
  if (!focus.ok) return { ok: false, reason: focus.reason };

  let targetObj, focusObj;
  try {
    ({ targetObj, focusObj } = await withWorld(tabId, async (id) => {
      const resolve = async (nid) =>
        (await anyCommand(tabId, { method: "DOM.resolveNode", params: { backendNodeId: nid, executionContextId: id } }))?.object?.objectId || "";
      return { targetObj: await resolve(backendNodeId), focusObj: await resolve(focus.backendNodeId) };
    }));
  } catch {
    return { ok: false, reason: "focus-identify-failed" };
  }
  if (!targetObj || !focusObj) return { ok: false, reason: "focus-identify-failed" };

  let v;
  try {
    const call = await anyCommand(tabId, {
      method: "Runtime.callFunctionOn",
      params: {
        objectId: targetObj,
        functionDeclaration: IDENTITY_PROBE,
        arguments: [{ objectId: focusObj }],
        returnByValue: true,
      },
    });
    v = call?.result?.value;
  } catch {
    return { ok: false, reason: "focus-identify-failed" };
  }
  if (!v || typeof v !== "object") return { ok: false, reason: "focus-identify-failed" };
  if (v.ok === true) return { ok: true, reason: String(v.reason ?? "identity-verified") };

  // Wall 3. Only reached when identity AND containment both failed, so the
  // exemption is the narrowest thing in this function.
  if (v.tag === "CANVAS" && TEXT_INPUT_TAGS.has(focus.nodeName)) {
    const inner = await box(tabId, focus.backendNodeId);
    const outer = await box(tabId, backendNodeId);
    if (inner && outer &&
        inner.minX >= outer.minX && inner.maxX <= outer.maxX &&
        inner.minY >= outer.minY && inner.maxY <= outer.maxY) {
      return { ok: true, reason: "canvas-editor-exempt" };
    }
  }
  return { ok: false, reason: "focus-not-the-target" };
}

/**
 * Read the focus state of the top document, and select-all inside it when
 * `doClear` is set. One bounded `Runtime.evaluate`, `returnByValue`, in an
 * isolated world (see `IDENTITY_PROBE`).
 *
 * ponytail: every failure refuses, matching `verifyTarget`. Ceiling: a page
 * that types through a document-level key handler while focus sits on `<body>`
 * would be refused where `insertText` would also have done nothing — upgrade if
 * a real host is found that contradicts it.
 */
export async function focusState(tabId, doClear) {
  let value;
  try {
    const call = await withWorld(tabId, (contextId) =>
      anyCommand(tabId, {
        method: "Runtime.evaluate",
        params: {
          expression: `(${FOCUS_PROBE})(${doClear === true})`,
          contextId,
          returnByValue: true,
        },
      }));
    value = call?.result?.value;
  } catch {
    // A document that went away mid-call. The question is unanswerable and
    // typing into an unanswerable document is how text lands in the wrong one.
    return { ok: false, reason: "focus-probe-failed" };
  }
  if (!value || typeof value !== "object") return { ok: false, reason: "focus-probe-silent" };
  return { ok: value.ok === true, reason: String(value.reason ?? "") };
}

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