/**
 * The grid's DOM knowledge.
 *
 * The name box is a React-controlled `<input>`: writing to it needs REAL key
 * events, and a page-controlled `.value` assignment is ignored. So the jump is
 * focus → select (a DOM operation — never a Ctrl+A chord, which is "move to
 * line start" on macOS) → type the reference one character at a time → Enter.
 *
 * The formula bar is a contenteditable mirror of the selected cell. It shows
 * the cell's TEXT — so an empty mirror is an empty cell (a read that HAPPENED)
 * and a missing mirror is a read that could not be performed at all. Those are
 * different verdicts, and the server tells them apart.
 *
 * Every probe below is a **string**: the extension evaluates it through
 * `Runtime.evaluate` with a context id, in the isolated world, so a page
 * cannot shadow the getters it reads. Every lookup is wrapped — a page must
 * not be able to throw inside a probe.
 *
 * The functions the Node test slices out carry no type annotations, for the
 * same reason `gridAdapter` in `pointer.ts` does: the test evaluates them as
 * plain JavaScript.
 */

import { GRID_ADAPTERS, gridApp } from "./pointer";

/**
 * The adapter this document is, or null.
 *
 * Origin **and** path: one origin serves several Google applications, and a
 * grant that stopped at the origin admitted every text field on the whole
 * site. The decision is made from the extension's own knowledge of the tab —
 * never from a frame's payload — so a hostile frame cannot claim to be a
 * sheet.
 */
export function gridAdapterFor(location) {
  if (!location) return null;
  return gridApp(location.origin, location.path);
}

/**
 * Is this a cell reference? `A1`, `b32` — a column and a row, and nothing
 * else. A word is not a reference: typing one into the name box creates a
 * NAMED RANGE, and the write is lost silently.
 */
export function isCellReference(text) {
  return /^[A-Za-z]{1,3}[0-9]{1,7}$/.test(String(text ?? "").trim());
}

/** The name box's current value, or `""` when there is no name box. */
const NAME_BOX_PROBE = `function (selector) {
  try {
    var el = document.querySelector(selector);
    if (!el) return "";
    var v = el.value;
    return v == null ? "" : String(v);
  } catch (err) { return ""; }
}`;

/**
 * Focus the name box and select its contents.
 *
 * `select()` is a DOM operation, not a chord: "which chord means select-all"
 * is the one question that would need the OS, and there is no legal way to
 * ask it. The isolated world's `Element.prototype.select` is the engine's own,
 * so a page that overrode it cannot neuter the clear.
 */
const NAME_BOX_FOCUS_PROBE = `function (selector) {
  try {
    var el = document.querySelector(selector);
    if (!el) return { ok: false, reason: "no-name-box" };
    el.focus({ preventScroll: true });
    if (typeof el.select === "function") el.select();
    var held = document.activeElement === el;
    return { ok: held, reason: held ? "" : "no-name-box" };
  } catch (err) { return { ok: false, reason: "no-name-box" }; }
}`;

/**
 * The mirror's text, or `null` when there is no mirror.
 *
 * `null` is the "could not be read" answer; `""` is an empty cell. The two
 * are different verdicts and the server needs them apart.
 */
const FORMULA_BAR_PROBE = `function (selector) {
  try {
    var el = document.querySelector(selector);
    if (!el) return null;
    var t = el.textContent;
    return t == null ? null : String(t);
  } catch (err) { return null; }
}`;

/**
 * Focus the mirror and select its contents.
 *
 * The mirror is a contenteditable, so it has no `select()`: its contents are
 * selected with a Range, which is the same DOM operation in a different
 * costume. The selection is checked afterwards — an insertion that APPENDED
 * to what was already in the cell is a wrong value, not a failed one, so the
 * write is refused rather than made.
 */
const FORMULA_BAR_FOCUS_PROBE = `function (selector) {
  try {
    var el = document.querySelector(selector);
    if (!el) return { ok: false, reason: "no-formula-bar" };
    el.focus({ preventScroll: true });
    // **The focus must have moved.** A collapsed formula bar cannot be
    // focused, and an insertion that stayed in the previous field — the name
    // box, which holds a REFERENCE — is the exact failure this ladder exists
    // to stop. So the focus is checked, not assumed.
    var active = document.activeElement;
    if (active !== el && !(el.contains && el.contains(active))) {
      return { ok: false, reason: "formula-bar-not-focused" };
    }
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    if (!sel) return { ok: false, reason: "no-formula-bar" };
    sel.removeAllRanges();
    sel.addRange(range);
    var text = String(el.textContent == null ? "" : el.textContent);
    var covered = (text === "") || (sel.toString() === text);
    return { ok: covered, reason: covered ? "" : "formula-bar-not-selected" };
  } catch (err) { return { ok: false, reason: "no-formula-bar" }; }
}`;

/** The selector a probe should use: the adapter's own, or the first one's. */
function selectorFor(selector, field) {
  const given = String(selector ?? "");
  if (given) return given;
  const first = GRID_ADAPTERS[0];
  return first ? String(first[field] ?? "") : "";
}

/** The isolated-world expression that reads the name box. */
export function nameBoxJs(selector) {
  return `(${NAME_BOX_PROBE})(${JSON.stringify(selectorFor(selector, "nameBoxSelector"))})`;
}

/** The isolated-world expression that focuses the name box and selects it. */
export function nameBoxFocusJs(selector) {
  return `(${NAME_BOX_FOCUS_PROBE})(${JSON.stringify(selectorFor(selector, "nameBoxSelector"))})`;
}

/** The isolated-world expression that reads the formula bar's mirror. */
export function formulaBarJs(selector) {
  return `(${FORMULA_BAR_PROBE})(${JSON.stringify(selectorFor(selector, "formulaBarSelector"))})`;
}

/** The isolated-world expression that focuses the mirror and selects it. */
export function formulaBarFocusJs(selector) {
  return `(${FORMULA_BAR_FOCUS_PROBE})(${JSON.stringify(selectorFor(selector, "formulaBarSelector"))})`;
}

/**
 * The extension's own answer, read.
 *
 * `state` is `"ok"` (the read happened — an empty value is an empty cell) or
 * `"unreadable"` (the read could not be performed — no mirror, or the jump
 * did not land). The two are different verdicts, and the server tells them
 * apart: an unreadable target never closes a plan item.
 */
export function parseGridResult(raw) {
  const r = raw ?? {};
  const ok = r.ok === true;
  const state = r.state === "unreadable" ? "unreadable" : "ok";
  return {
    ok,
    address: String(r.address ?? ""),
    value: state === "ok" ? (r.value == null ? "" : String(r.value)) : null,
    state,
    mechanism: String(r.mechanism ?? ""),
    error: String(r.error ?? ""),
  };
}
