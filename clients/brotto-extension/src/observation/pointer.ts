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
 *   2. **The marker stays.** There is no code path that removes it: the next
 *      click *moves* it, and the only thing that takes it away is the page
 *      going away. That is what "always visible" means here, and it is a claim
 *      about the absence of a call rather than about a timer — a timer is how a
 *      marker outlives the action that drew it, and a `finally` that clears it
 *      is how the user never sees where the agent is clicking. Its words live
 *      in a shadow root under an `aria-hidden` host, so the label is in neither
 *      the page text the model reads nor the accessibility tree the
 *      observation is built from.
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

/** The marker's element id. The label gets `${id}-label`, so a redraw replaces
 *  both by name. */
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
 * **The marker stays.** There is no path that removes it — the next click
 * *moves* it, and the only thing that takes it away is the page going away.
 * That is the whole "always visible" claim, and it is a claim about the
 * absence of a call rather than about a timer.
 *
 * **The label is not in the DOM's text.** A marker that outlives its click
 * would otherwise put its own words into the page text the model reads
 * (`document.body.innerText`) and into the accessibility tree the observation
 * is built from — the model would be reading the agent's annotation as if it
 * were the page's. So the words live in a **shadow root**: `innerText` and
 * `textContent` do not cross a shadow boundary, and `aria-hidden` on the host
 * takes the subtree out of the AX tree.
 *
 * **Not a pseudo-element.** The first version rendered the words with a
 * `::after` rule in an injected `<style>` element — also not a text node, also
 * not in the AX tree. It rendered an *empty black pill* on Google Sheets, and
 * the reason is the page's Content-Security-Policy: a `<style>` element
 * without the page's nonce is refused (`style-src 'self'`), while the
 * inline styles set through CSSOM are not. A CSP-restricted page is the norm,
 * not the exception, so the rule cannot be the mechanism. Shadow DOM has no
 * such surface: the styles are set through CSSOM and the words are real text
 * in a tree the page's CSS and the page's CSP do not reach.
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
  // A stylesheet left by an older build, which rendered the words with a
  // pseudo-element. It is inert now, but it would sit in the page forever.
  var prevStyle = doc.getElementById(id + "-style");
  if (prevStyle && prevStyle.parentNode) prevStyle.parentNode.removeChild(prevStyle);
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
  var words = String(label == null ? "" : label).slice(0, ${MAX_CURSOR_LABEL});
  // The dot: a small ink disc with a white halo. Calm on a white sheet and
  // legible on a dark page, and it reads as a pointer rather than an alarm.
  var dot = doc.createElement("div");
  dot.id = id;
  dot.setAttribute("aria-hidden", "true");
  dot.style.position = "fixed";
  dot.style.left = (x - 7) + "px";
  dot.style.top = (y - 7) + "px";
  dot.style.width = "14px";
  dot.style.height = "14px";
  dot.style.boxSizing = "border-box";
  dot.style.borderRadius = "50%";
  dot.style.border = "2px solid #ffffff";
  dot.style.background = "#111827";
  dot.style.pointerEvents = "none";
  dot.style.zIndex = "2147483647";
  // The label. The words go in a shadow root so they are in neither the
  // page's text (innerText and textContent do not cross a shadow boundary)
  // nor the accessibility tree (the host is aria-hidden).
  var tag = doc.createElement("div");
  tag.id = id + "-label";
  tag.setAttribute("aria-hidden", "true");
  tag.setAttribute("data-label", words);
  tag.style.position = "fixed";
  tag.style.left = (x + 13) + "px";
  tag.style.top = (y + 13) + "px";
  tag.style.pointerEvents = "none";
  tag.style.zIndex = "2147483647";
  if (words) {
    var shadow = tag.attachShadow({ mode: "open" });
    var chip = doc.createElement("div");
    chip.textContent = words;
    chip.style.padding = "3px 8px";
    chip.style.background = "#ffffff";
    chip.style.color = "#111827";
    chip.style.border = "1px solid rgba(17,24,39,0.18)";
    chip.style.borderRadius = "3px";
    chip.style.font = "12px/1.35 system-ui, -apple-system, sans-serif";
    chip.style.maxWidth = "260px";
    chip.style.whiteSpace = "pre-wrap";
    chip.style.overflowWrap = "break-word";
    chip.style.pointerEvents = "none";
    shadow.appendChild(chip);
  }
  host.appendChild(dot);
  host.appendChild(tag);
  return { drawn: true, reason: "" };
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
  // What the *focused* node is, read in this world: its tag, and whether it is
  // an editable surface. The canvas-grid wall needs both — a grid's editor is
  // a contenteditable, and no engine-side answer carries "is editable".
  var focusTag = (focus && focus.tagName) ? String(focus.tagName).toUpperCase() : "";
  var focusEditable = !!(focus && focus.isContentEditable === true);
  // **The page's origin, and the focused node's own name.** Both are needed by
  // the grid wall, and neither can be forged by a script on the page:
  // location.origin is the document's own address, which only a navigation
  // can change, and it is read in the isolated world, where the page owns
  // neither the getter nor the value.
  var origin = "";
  try { origin = String(location.origin || ""); } catch (err) { origin = ""; }
  // The document's *path*, for the same reason: one origin serves several
  // applications — Google Docs, Drive and Sheets all live on docs.google.com —
  // and the path is what tells them apart. The origin alone is not the
  // application.
  var path = "";
  try { path = String(location.pathname || ""); } catch (err) { path = ""; }
  // The focused node's *scope* — the nearest ancestor-or-self carrying an id —
  // and its own class list. These are page-written strings, so they are read
  // only after the origin has already matched: on its own they prove nothing.
  var focusScope = "";
  var focusClass = "";
  try {
    if (focus && focus.nodeType === 1) {
      var scope = focus.closest ? focus.closest("[id]") : null;
      focusScope = (scope && scope.id) ? String(scope.id) : "";
      focusClass = (focus.className && typeof focus.className === "string") ? String(focus.className) : "";
    }
  } catch (err) { focusScope = ""; focusClass = ""; }
  if (!el || el.nodeType !== 1) return { ok: false, reason: "unreadable", tag: "", focusTag: focusTag, focusEditable: focusEditable, origin: origin, path: path, focusScope: focusScope, focusClass: focusClass };
  if (!focus || focus.nodeType !== 1) return { ok: false, reason: "unreadable", tag: "", focusTag: focusTag, focusEditable: focusEditable, origin: origin, path: path, focusScope: focusScope, focusClass: focusClass };
  var tag = el.tagName ? String(el.tagName).toUpperCase() : "";
  // The ordinary case: the same node, or focus landing on a descendant of what
  // was pressed — a <label>, a <div> wrapper, a <span> inside a button. A hit on
  // a *descendant* is a hit on the element; an ancestor is not admitted.
  if (el === focus) return { ok: true, reason: "same-node", tag: tag, focusTag: focusTag, focusEditable: focusEditable, origin: origin, path: path, focusScope: focusScope, focusClass: focusClass };
  if (el.contains && el.contains(focus)) return { ok: true, reason: "focus-inside-target", tag: tag, focusTag: focusTag, focusEditable: focusEditable, origin: origin, path: path, focusScope: focusScope, focusClass: focusClass };
  // The shadow direction: the press resolved to a node inside an open shadow
  // root — elementFromPoint does not pierce one, so it resolved to the host —
  // and the browser retargeted focus to that same host. So the focus is one of
  // the *pressed node's* shadow hosts, which ordinary contains() cannot see.
  var sroot = el.getRootNode ? el.getRootNode() : null;
  while (sroot && sroot.host) {
    if (sroot.host === focus) return { ok: true, reason: "focus-retargeted-to-host", tag: tag, focusTag: focusTag, focusEditable: focusEditable, origin: origin, path: path, focusScope: focusScope, focusClass: focusClass };
    sroot = sroot.host.getRootNode ? sroot.host.getRootNode() : null;
  }
  return { ok: false, reason: "not-the-target", tag: tag, focusTag: focusTag, focusEditable: focusEditable, origin: origin, path: path, focusScope: focusScope, focusClass: focusClass };
}`;

/**
 * **The recognised grid editors.**
 *
 * A grid whose editor is parked off-screen is a shape *any* page can fake: a
 * canvas, a click listener, and a hidden input the agent cannot see. Nothing
 * in the geometry tells a spreadsheet from that — the page that wants the
 * hidden field admitted can do exactly what Sheets does, and the old wall
 * admitted it. So the geometry is not the permission; **the app is.**
 *
 * Each entry names one application, in four parts:
 *
 *   - `origin` — the address the application is served from. This is the only
 *     part a page cannot forge: it is the document's own origin, read by the
 *     engine, and only a navigation changes it. A hostile page cannot make
 *     itself `docs.google.com`.
 *   - `pathPrefix` — the path the application is served under. **The origin
 *     is not the application**: one origin serves several of them — Google
 *     Docs, Drive and Sheets all live on `docs.google.com` — so a grant that
 *     stopped at the origin admitted *every text field on the whole site*,
 *     including the Docs comment box and the Drive rename field. The path is
 *     what says *which* application the document is, and it is read from the
 *     same unforgeable place as the origin.
 *   - `scopeId` — the id the application's editor container carries.
 *   - `className` — the class the application's own editor element carries.
 *
 * The id and the class are page-written strings, so they are consulted *only*
 * after the origin has matched: on their own they prove nothing, and a page
 * that wrote `id="waffle-rich-text-editor"` onto its own hidden input buys
 * nothing while it is on its own origin.
 *
 * **One entry per origin.** Two adapters for one origin would make the choice
 * ambiguous, and ambiguity is refused rather than guessed — so a second
 * application on the same origin cannot be added without a decision about
 * which one wins.
 *
 * **Adding an app is one entry.** The shape of the exemption is deliberately
 * narrow so that the list can grow one application at a time, as real grids
 * are met, rather than a rule that admits all of them at once.
 */
export const GRID_ADAPTERS = [
  {
    app: "google-sheets",
    origin: "https://docs.google.com",
    pathPrefix: "/spreadsheets/",
    scopeId: "waffle-rich-text-editor",
    className: "cell-input",
  },
];

/**
 * The adapter that recognises this focus, or null.
 *
 * All four parts must match: the origin, the path, the scope id and the editor
 * class. The editor must also be a contenteditable — a grid's editor is an
 * editable surface, and a plain div that happens to sit in the same container
 * is not it.
 */
export function gridAdapter(sig) {
  if (!sig || sig.focusEditable !== true) return null;
  const classes = String(sig.focusClass || "").split(/\s+/).filter(Boolean);
  for (const a of GRID_ADAPTERS) {
    if (a.origin !== sig.origin) continue;
    if (!pathMatches(a, sig.path)) continue;
    if (a.scopeId !== sig.focusScope) continue;
    if (!classes.includes(a.className)) continue;
    return a;
  }
  return null;
}

/** Does this document's path belong to the application this adapter names?
 *  No type annotations: the Node tests slice this out of the source and run
 *  it as plain JavaScript. */
function pathMatches(adapter, path) {
  if (!adapter.pathPrefix) return true;
  return typeof path === "string" && path.startsWith(adapter.pathPrefix);
}

/**
 * The grid application this *document* is, or null.
 *
 * Where `gridAdapter` answers "is this focus the grid's own editor", this
 * answers the narrower question the delivery mechanism hangs on: is this
 * document one whose cells must be **typed** rather than inserted? Same grant —
 * `GRID_ADAPTERS`, the same unforgeable origin *and path* — so a hostile page
 * cannot buy the keystroke path with a shape, and a page that merely happens
 * to be served from the same origin cannot either. Two adapters for one origin
 * would make the choice ambiguous and is refused rather than guessed.
 *
 * The origin and the path are two of the values `IDENTITY_PROBE` already reads
 * in the isolated world, so asking here is a field on an answer already in
 * hand, not a second round trip.
 */
export function gridApp(origin: unknown, path: unknown) {
  if (typeof origin !== "string" || !origin) return null;
  const hits = GRID_ADAPTERS.filter((a) => a.origin === origin);
  if (hits.length !== 1) return null;
  const app = hits[0];
  return pathMatches(app, path) ? app : null;
}

/**
 * **Hold the focus on the grid's own editor, at the moment of the keystroke.**
 *
 * A grid cell is *typed*, not inserted: the text arrives as `Input.dispatchKeyEvent`
 * calls, and a key event is not bound to a node — it goes to whatever holds focus
 * when the browser processes it. So the binding cannot be made in the dispatch. It
 * has to be made in the *page*, immediately before each dispatch — and it has to be
 * made by putting the focus **back**, not by observing that it left.
 *
 * **A reading is not a binding.** Reading `document.activeElement` and comparing
 * ids says what was true when the read answered; a page that moves focus between
 * the read and the keystroke gets the text anyway. That is the whole finding, and
 * it is why this operation *changes* the page rather than only reading it.
 *
 * Three things happen here, in this order:
 *
 *   1. **the document is still the application.** The origin is read from the
 *      document, in the isolated world, and the adapter is looked up *by that
 *      origin* — so a page that navigated away mid-typing has no adapter and is
 *      refused, and a page cannot forge its way into one.
 *   2. **the editor holds the focus** — the ordinary case, and it touches
 *      nothing at all.
 *   3. **otherwise the focus is taken back.** The editor is found by its role
 *      (the container id and the class the application writes) and given the
 *      focus with `preventScroll`, because the editor is parked at y = -9998 and
 *      a plain `focus()` scrolls the user's viewport to the top of the document.
 *
 * **The role, not the instance.** A grid replaces its own editor when it
 * re-renders a cell, so the *node* is not stable enough to bind to — binding to
 * the instance would refuse the typing that worked. The role is the same three
 * parts the grant was made on, re-read at the point of insertion.
 */
const GRID_FOCUS_PROBE = `function (adapters) {
  function isGridEditor(el, scopeId, className) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable !== true) return false;
    var scope = el.closest ? el.closest("[id]") : null;
    if (!scope || String(scope.id) !== String(scopeId)) return false;
    var cls = (el.className && typeof el.className === "string") ? el.className.split(/\\s+/) : [];
    for (var i = 0; i < cls.length; i++) { if (cls[i] === className) return true; }
    return false;
  }
  // **What had the focus, classified.** A key event is focus-global, so the
  // element that held the focus when the previous keystroke was processed is
  // where that keystroke went. A *text-entry surface* that is not the grid's
  // own editor is the one shape a keystroke can go into, so the drift is
  // "suspect" there; anything else — the body, the grid's own canvas — cannot
  // receive text, and the drift is "benign".
  function driftOf(el, scopeId, className) {
    try {
      if (!el || el.nodeType !== 1) return "benign";
      if (isGridEditor(el, scopeId, className)) return "benign";
      var tag = String(el.tagName || el.nodeName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA") return "suspect";
      if (el.isContentEditable === true) return "suspect";
    } catch (err) { return "benign"; }
    return "benign";
  }
  var origin = "";
  try { origin = String(location.origin || ""); } catch (err) { origin = ""; }
  var path = "";
  try { path = String(location.pathname || ""); } catch (err) { path = ""; }
  // **The origin is not the application** — one origin serves several — so
  // the path is consulted too, and the match is exactly the one gridApp
  // makes outside the page: one adapter for this origin, and the path under
  // that adapter's own prefix.
  var adapter = null, seen = 0;
  for (var i = 0; i < adapters.length; i++) {
    if (String(adapters[i].origin) === origin) { adapter = adapters[i]; seen++; }
  }
  // No adapter for this origin, or an ambiguous one: this is not the grid the
  // wall was written for, and a page that navigated here gets nothing.
  if (seen !== 1 || !adapter) return { ok: false, reason: "grid-editor-unrecognised" };
  var prefix = adapter.pathPrefix ? String(adapter.pathPrefix) : "";
  if (prefix && path.indexOf(prefix) !== 0) return { ok: false, reason: "grid-editor-unrecognised" };
  var scopeId = String(adapter.scopeId), className = String(adapter.className);
  // What held the focus *before* this probe. The keystroke that preceded it
  // went wherever this was.
  var prior = document.activeElement;
  if (isGridEditor(prior, scopeId, className)) {
    return { ok: true, outcome: "already-focused" };
  }
  // The focus drifted. Find the grid's editor by its role and take it back.
  var container = null;
  try { container = document.getElementById(scopeId); } catch (err) { container = null; }
  var editor = null;
  if (container) {
    if (isGridEditor(container, scopeId, className)) {
      editor = container;
    } else {
      var found = [];
      try { found = container.querySelectorAll ? container.querySelectorAll("." + className) : []; }
      catch (err) { found = []; }
      for (var j = 0; j < found.length; j++) {
        if (isGridEditor(found[j], scopeId, className)) { editor = found[j]; break; }
      }
    }
  }
  if (!editor) return { ok: false, reason: "focus-changed" };
  try {
    // **preventScroll**: the editor is parked off-screen, and a plain focus()
    // would scroll the user's viewport to the top of the document.
    editor.focus({ preventScroll: true });
  } catch (err) {
    return { ok: false, reason: "focus-changed" };
  }
  if (isGridEditor(document.activeElement, scopeId, className)) {
    return { ok: true, outcome: "refocused", drift: driftOf(prior, scopeId, className) };
  }
  return { ok: false, reason: "focus-changed" };
}`;

/**
 * Put the focus back on the grid's own editor, and say whether it is there.
 *
 * One isolated-world evaluate, so the page owns neither the question nor the
 * effect. The result is a *binding*, not an observation: on the success path
 * the grid's editor holds the focus at the moment the evaluate answers, and
 * the keystroke that follows is the very next thing sent.
 *
 * The refusal reasons are the existing ones: `grid-editor-unrecognised` when
 * the document is no longer served from a recognised grid's origin, and
 * `focus-changed` when the editor does not hold the focus and could not be
 * given it back.
 *
 * **`drift` says what had the focus when the probe took it back** — `suspect`
 * when it was a text-entry surface that is not the grid's own (so the
 * keystroke before it may have gone there), `benign` when it was something that
 * cannot receive text. It is absent when nothing drifted.
 */
export async function reassertGridFocus(tabId: number): Promise<{ ok: boolean; reason: string; drift?: string }> {
  const adapters = JSON.stringify(GRID_ADAPTERS);
  try {
    const call = await withWorld(tabId, (contextId) =>
      anyCommand(tabId, {
        method: "Runtime.evaluate",
        params: {
          expression: `(${GRID_FOCUS_PROBE})(${adapters})`,
          contextId,
          returnByValue: true,
        },
      }));
    const v = call?.result?.value;
    if (!v || typeof v !== "object") return { ok: false, reason: "focus-changed" };
    if (v.ok === true) {
      const drift = v.drift === "suspect" || v.drift === "benign" ? v.drift : undefined;
      return { ok: true, reason: "", drift };
    }
    return { ok: false, reason: String(v.reason ?? "focus-changed") };
  } catch {
    return { ok: false, reason: "focus-changed" };
  }
}

/**
 * **Where the typed text went.**
 *
 * The focus probe says whether the grid's editor held the focus; it cannot say
 * where a keystroke that went *elsewhere* landed, because a key event is
 * focus-global and leaves no trace of its own. This asks the page instead:
 *
 *   - `in-grid`  the text is inside the grid's own scope, so the grid has it.
 *   - `foreign`  the text is in some other editor on the page — the case the
 *                 security review named: the press was never aimed there.
 *   - `unknown`  the text was found nowhere, so nothing is claimed.
 *
 * The origin is checked first, exactly as the focus probe checks it: a page
 * that is not the recognised application is refused without being inspected.
 */
const GRID_DELIVERY_PROBE = `function (adapters, text) {
  var origin = "";
  try { origin = String(location.origin || ""); } catch (err) { origin = ""; }
  var path = "";
  try { path = String(location.pathname || ""); } catch (err) { path = ""; }
  var adapter = null, seen = 0;
  for (var i = 0; i < adapters.length; i++) {
    if (String(adapters[i].origin) === origin) { adapter = adapters[i]; seen++; }
  }
  if (seen !== 1 || !adapter) return { ok: false, reason: "grid-editor-unrecognised" };
  var prefix = adapter.pathPrefix ? String(adapter.pathPrefix) : "";
  if (prefix && path.indexOf(prefix) !== 0) return { ok: false, reason: "grid-editor-unrecognised" };
  var needle = String(text == null ? "" : text);
  if (!needle) return { ok: true, state: "unknown" };
  function holds(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      if (el.value != null && String(el.value).indexOf(needle) >= 0) return true;
      if (el.textContent != null && String(el.textContent).indexOf(needle) >= 0) return true;
    } catch (err) { return false; }
    return false;
  }
  function isEditor(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = String(el.tagName || el.nodeName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    return el.isContentEditable === true;
  }
  // The grid's own scope: by id, and by a document scan if the id lookup
  // finds nothing.
  var scopeId = String(adapter.scopeId), scope = null;
  try { scope = document.getElementById(scopeId); } catch (err) { scope = null; }
  if (!scope) {
    var ids = [];
    try { ids = document.querySelectorAll ? document.querySelectorAll("[id]") : []; }
    catch (err) { ids = []; }
    for (var j = 0; j < ids.length; j++) {
      if (String(ids[j].id) === scopeId) { scope = ids[j]; break; }
    }
  }
  if (scope && holds(scope)) return { ok: true, state: "in-grid" };
  if (scope && scope.querySelectorAll) {
    var inside = [];
    try { inside = scope.querySelectorAll("*"); } catch (err) { inside = []; }
    for (var k = 0; k < inside.length; k++) {
      if (holds(inside[k])) return { ok: true, state: "in-grid" };
    }
  }
  // Anywhere else on the page: an editor that holds the text.
  var others = [];
  try { others = document.querySelectorAll ? document.querySelectorAll("input, textarea, [contenteditable]") : []; }
  catch (err) { others = []; }
  for (var m = 0; m < others.length; m++) {
    if (scope && scope.contains && scope.contains(others[m])) continue;
    if (holds(others[m]) && isEditor(others[m])) return { ok: true, state: "foreign" };
  }
  return { ok: true, state: "unknown" };
}`;

/**
 * Ask the page where the typed text went, in the grid's own isolated world.
 *
 * Only consulted when the grid replaced its own editor mid-typing — so the
 * before/after reads are not comparable — *and* a keystroke may have gone
 * astray. The page is asked because a key event leaves no trace of its own;
 * the answer is a claim about where the text is, and `unknown` claims nothing.
 */
export async function gridDelivery(tabId: number, text: string): Promise<{ ok: boolean; state?: string; reason?: string }> {
  const adapters = JSON.stringify(GRID_ADAPTERS);
  try {
    const call = await withWorld(tabId, (contextId) =>
      anyCommand(tabId, {
        method: "Runtime.evaluate",
        params: {
          expression: `(${GRID_DELIVERY_PROBE})(${adapters}, ${JSON.stringify(String(text ?? ""))})`,
          contextId,
          returnByValue: true,
        },
      }));
    const v = call?.result?.value;
    if (!v || typeof v !== "object") return { ok: false, reason: "focus-probe-silent" };
    if (v.ok === true) return { ok: true, state: String(v.state ?? "unknown") };
    return { ok: false, reason: String(v.reason ?? "grid-editor-unrecognised") };
  } catch {
    return { ok: false, reason: "focus-probe-failed" };
  }
}

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
 *                           inside it, and not a recognised grid editor.
 *   grid-editor-unrecognised
 *                           a canvas press focused something editable, but the
 *                           page is not one of the recognised grids — so the
 *                           editor cannot be trusted to be the grid's own. Also
 *                           the answer when the document is no longer served
 *                           from a recognised grid's origin.
 *   focus-changed           the grid's own editor does not hold the focus and
 *                           could not be given it back, so the text was not
 *                           typed.
 *   grid-text-not-delivered the grid's editor did not change after the text was
 *                           typed into it, so the text did not land in the cell.
 *   grid-text-misdelivered a keystroke went to an editor the press was never
 *                           aimed at, so the text may have landed in somebody
 *                           else's field.
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
 *   canvas-text-too-long    the text is longer than a canvas grid can be given
 *                           in one run of keystrokes.
 *   target-gone             the pressed node no longer resolves — the page
 *                           dropped it, or the tab navigated.
 *   target-unresolvable     `DOM.resolveNode` answered without an object id.
 *   probe-silent            the dispatch-time hit test returned no object.
 *   probe-failed            the dispatch-time hit test threw.
 *   different-element:<tag> the hit test found a different element at the point.
 *                           The tag is appended by `TARGET_PROBE` and is the one
 *                           place a page-chosen string enters; it names a tag,
 *                           which is engine-derived, not freeform.
 *   canvas-grid-editor      an allowance, like `canvas-editor-exempt`: the
 *                           canvas grid's own editor, which the grid keeps
 *                           outside the canvas — parked off-screen, or drawn
 *                           over the cell being edited.
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
  "focus-not-the-target": "focus is not the pressed node, an ancestor-descendant of it, or a recognised grid editor",
  "grid-editor-unrecognised": "a canvas press focused an editable, but the page is not a recognised grid",
  "focus-changed": "the grid's editor does not hold the focus and could not be given it back",
  "grid-text-not-delivered": "the grid's editor did not change — the text did not land in the cell",
  "grid-text-misdelivered": "a keystroke went to another editor — the text may have landed in a field the press was never aimed at",
  "focus-probe-failed": "the focus evaluate threw; the document went away",
  "focus-probe-silent": "the focus evaluate returned no answer",
  "clear-select-noop": "the clear was requested and did not happen",
  "clear-threw": "select()/createRange threw — a detached node",
  "clear-no-text-field": "a clear was asked for and focus is not a text field",
  "canvas-text-too-long": "the text is longer than a canvas grid can be given in one run of keystrokes",
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
  "canvas-grid-editor": "OK by exemption — a canvas grid whose editor lies outside the canvas",
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
 * The focused node, as the engine names it.
 *
 * **The read is in the isolated world, and the naming is the engine's.** The
 * page owns `Document.prototype.activeElement` in *its* world, so a probe run
 * there can be answered falsely; the isolated world has its own prototypes, so
 * `document.activeElement` there is the real one. The object it returns is then
 * named by the engine (`DOM.describeNode`), which is what makes the *identity*
 * check in `bindFocus` a comparison between two engine-sourced ids rather than
 * between two things a page produced.
 *
 * **`DOM.getFocusNode` was removed from Chrome** — it answers `-32601`
 * ("'DOM.getFocusNode' wasn't found") on every current build, so the probe
 * below always failed and **every `type_at` was refused** with
 * `focus-identify-failed`, on every site and not only the canvas ones. The
 * replacement asks the same question by the route that still exists: read
 * `document.activeElement` in the isolated world, then have the engine describe
 * the node it points at.
 *
 * Every failure refuses. A page whose focus cannot be named cannot be cleared.
 */
export async function focusNode(tabId: number): Promise<{ ok: boolean; reason: string; backendNodeId?: number; nodeName?: string }> {
  try {
    await anyCommand(tabId, { method: "DOM.enable" });
    const read = await withWorld(tabId, (contextId) =>
      anyCommand(tabId, {
        method: "Runtime.evaluate",
        params: { expression: "document.activeElement", contextId, returnByValue: false },
      }));
    const objectId = read?.result?.objectId;
    if (!objectId) return { ok: false, reason: "focus-identify-failed" };
    const described = await anyCommand(tabId, { method: "DOM.describeNode", params: { objectId } });
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
 * What the given node holds, as text.
 *
 * The grid's editor is a contenteditable, and its content is the cell's text —
 * so "the editor still says what it said before the keystrokes" is the direct
 * answer to "did the text land", and it is read from the *editor* rather than
 * from the canvas, whose repaint we cannot measure (our own cursor marker
 * moves the pixels too, so a pixel diff cannot tell a cell edit from our
 * marker).
 *
 * Read in the isolated world, so a page cannot override the getter and make
 * the editor look full.
 */
const EDITOR_TEXT_PROBE = `function () {
  var el = this;
  if (!el || el.nodeType !== 1) return { ok: false, text: "" };
  try {
    if (el.isContentEditable === true) return { ok: true, text: el.textContent || "" };
    if (typeof el.value === "string") return { ok: true, text: el.value };
  } catch (err) { return { ok: false, text: "" }; }
  return { ok: false, text: "" };
}`;

/**
 * The text a node holds, or `{ok: false}` when it cannot be read.
 *
 * `ok: false` means **not measured** — the node is gone, the page went away,
 * or it is not a text-holding surface. It never means "empty": an empty editor
 * is `ok: true, text: ""`, and the difference is the whole point, because a
 * check that cannot read must not report a failure it did not observe.
 */
export async function editorText(tabId: number, backendNodeId: number): Promise<{ ok: boolean; text: string }> {
  try {
    return await withWorld(tabId, async (id) => {
      const resolved = await anyCommand(tabId, { method: "DOM.resolveNode", params: { backendNodeId, executionContextId: id } });
      const objectId = resolved?.object?.objectId;
      if (!objectId) return { ok: false, text: "" };
      const call = await anyCommand(tabId, {
        method: "Runtime.callFunctionOn",
        params: { objectId, functionDeclaration: EDITOR_TEXT_PROBE, returnByValue: true },
      });
      const v = call?.result?.value;
      if (!v || typeof v !== "object") return { ok: false, text: "" };
      return { ok: v.ok === true, text: String(v.text ?? "") };
    });
  } catch {
    return { ok: false, text: "" };
  }
}

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
 *   4. **The grid editor**, for the shape wall 3 cannot serve either: a canvas
 *      whose press focuses an editable the grid keeps *outside* the canvas —
 *      parked off-screen, or drawn over the cell being edited. This one is
 *      granted to a *recognised application* only (`GRID_ADAPTERS`), because
 *      the shape itself is one any page can imitate.
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
export async function bindFocus(tabId, backendNodeId, x, y): Promise<any> {
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
  // **What the focus is bound to, and what the page is.** Both are read from
  // the probe already made — no second evaluate. `focusId` is the focused
  // node, so a caller can read it before and after typing and compare on the
  // same node. `grid` is the *application* the document is, which is what
  // decides delivery: a cell is typed, never inserted. `gridEditor` is the
  // narrower question — is this focus the grid's own cell editor — and it is
  // what makes a focus re-assertion safe: only there may the focus be taken
  // back, so a name box the model is typing a reference into is never stolen.
  //
  // **The application, not the origin.** `gridApp` matches the origin *and*
  // the path, because one origin serves several Google applications: a Docs
  // comment box and a Drive rename field are on the same origin as a sheet,
  // and they are not a grid. `gridEditor` is that application's own editor,
  // so it cannot be true while `grid` is false.
  const app = gridApp(v.origin, v.path);
  const focusShape = {
    focusId: focus.backendNodeId,
    grid: app !== null,
    gridEditor: app !== null && gridAdapter(v) === app,
  };
  if (v.ok === true) return { ok: true, reason: String(v.reason ?? "identity-verified"), ...focusShape };

  // Wall 3. Only reached when identity AND containment both failed, so the
  // exemption is the narrowest thing in this function.
  if (v.tag === "CANVAS" && TEXT_INPUT_TAGS.has(focus.nodeName)) {
    const inner = await box(tabId, focus.backendNodeId);
    const outer = await box(tabId, backendNodeId);
    if (inner && outer &&
        inner.minX >= outer.minX && inner.maxX <= outer.maxX &&
        inner.minY >= outer.minY && inner.maxY <= outer.maxY) {
      return { ok: true, reason: "canvas-editor-exempt", ...focusShape };
    }
  }

  // Wall 3b. The *grid* editor: a canvas whose press focuses an editable that
  // is neither the cell nor inside it, because the grid keeps its editor
  // somewhere else entirely. Google Sheets' is `DIV#waffle-rich-text-editor
  // .cell-input[contenteditable=true]` — a direct child of BODY whose box is
  // zero-width and parked at y = -9998 — so wall 3a's text-input rule misses
  // it twice over: it is not an INPUT, and it is not inside the canvas.
  //
  // **The app is the permission; the geometry is only a narrowing.**
  //
  // The old rule admitted any canvas press whose focus was an editable that
  // the user could not see. That is a shape every page can fake: a canvas, a
  // click listener, and a hidden input parked off-screen. The agent then typed
  // into a field the user cannot see, believing it had typed into the cell
  // under the cursor — a UI-redress of the agent's own action.
  //
  // Nothing in the geometry can tell a spreadsheet from that disguise, so the
  // geometry is not what decides. What decides is the *application*: the
  // origin the document is served from, which a page cannot forge, plus the
  // editor that application is known to write. See `GRID_ADAPTERS`.
  //
  // Three ways the editor is admitted, and all three are the engine's own
  // geometry — they narrow the exemption further, they do not create it:
  //
  //   (a) it has no area at all — nothing the user can see is there;
  //   (b) it lies wholly outside the live viewport — also not visible;
  //   (c) its box contains the point that was pressed — the editor is drawn
  //       over the cell being edited, under the canvas that took the press.
  //
  // (c) is safe because `verifyTarget` has already asked `elementFromPoint`
  // about the dispatched point and been told the *canvas* is there: a visible
  // field of the user's own, sitting on top, would have been the hit and the
  // press would already have been refused as `different-element`. A viewport
  // that cannot be read proves nothing, so (b) fails closed and the press is
  // refused rather than typed into.
  if (v.tag === "CANVAS" && (v.focusEditable === true || TEXT_INPUT_TAGS.has(focus.nodeName))) {
    // The recognised application, and the focus being *that* application's
    // own editor. An ambiguous origin has no adapter, so it is refused here
    // too rather than resolved by a guess.
    const adapter = app && gridAdapter(v) === app ? app : null;
    if (!adapter) {
      // A canvas press that focuses something editable, on a page that is not
      // one of the recognised grids. This is the hostile shape and it is
      // refused — loudly, and with its own reason, because "the focus is not
      // the target" reads like a stale observation and this is not one.
      //
      // The reason is the grid's own: a *contenteditable* focus is what a
      // grid parks off-screen, so a page we cannot recognise that holds one
      // is the disguise. A plain text input keeps the older reason — it was
      // never the grid's shape, and "not the target" is the truer sentence.
      return { ok: false, reason: v.focusEditable === true ? "grid-editor-unrecognised" : "focus-not-the-target" };
    }
    const inner = await box(tabId, focus.backendNodeId);
    if (inner) {
      const zeroArea = inner.maxX <= inner.minX || inner.maxY <= inner.minY;
      const overPoint = inner.minX <= x && x <= inner.maxX && inner.minY <= y && y <= inner.maxY;
      let offscreen = false;
      if (!zeroArea && !overPoint) {
        const vp = await liveViewport(tabId);
        if (vp) {
          offscreen = inner.maxX <= 0 || inner.maxY <= 0 ||
                      inner.minX >= vp.width || inner.minY >= vp.height;
        }
      }
      if (zeroArea || overPoint || offscreen) {
        // The focused node's id, so the caller can re-read the focus before it
        // types and refuse if the page moved it in the meantime.
        return { ok: true, reason: "canvas-grid-editor", ...focusShape };
      }
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