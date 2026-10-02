// The redesigned Settings panel: one Ink & Rule dropdown component behind
// three fields, and the model facts it renders beneath the model control.
//
// `attachDropdown` and `renderModelFacts` are extracted from the shipping
// sidepanel.js by brace matching and eval'd against a fake DOM, so this cannot
// drift from what ships. That matters more than usual here: every failure this
// guards against is an *absence* — a dropdown that opens but never reports a
// selection, a badge that asserts a model is text-only when the catalogue only
// said nothing, a context window that invents a number, an id the JS queries
// that the new markup no longer has — and an absence reads clean in review.
//
//   node scripts/test-settings-panel.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "clients", "brotto-extension", "src");
const sidepanel = fs.readFileSync(path.join(EXT, "sidepanel.js"), "utf8");
const panelHtml = fs.readFileSync(path.join(EXT, "sidepanel.html"), "utf8");
const catalogSrc = fs.readFileSync(path.join(EXT, "model_catalog.js"), "utf8");

// Brace matching has to begin after the parameter list — a destructured
// argument closes its own brace and would end the match at the signature.
function extract(name) {
  const start = sidepanel.search(new RegExp(`^(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} in sidepanel.js — renamed?`);
  let parens = 0;
  let bodyStart = -1;
  for (let i = sidepanel.indexOf("(", start); i < sidepanel.length; i++) {
    if (sidepanel[i] === "(") parens++;
    else if (sidepanel[i] === ")" && --parens === 0) { bodyStart = sidepanel.indexOf("{", i); break; }
  }
  if (bodyStart < 0) throw new Error(`no body for ${name}`);
  let depth = 0;
  for (let i = bodyStart; i < sidepanel.length; i++) {
    if (sidepanel[i] === "{") depth++;
    else if (sidepanel[i] === "}" && --depth === 0) return sidepanel.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

// ── Fake DOM ───────────────────────────────────────────────────────────────
let uid = 0;

class FakeEvent {
  constructor(type) { this.type = type; }
}

function el(extra = {}) {
  const node = {
    tagName: "DIV",
    id: "",
    value: "",
    children: [],
    attrs: {},
    dataset: {},
    handlers: {},
    readOnly: false,
    hidden: false,
    _text: "",
    _classes: new Set(),
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    dispatchEvent(ev) { for (const fn of this.handlers[ev.type] || []) fn(ev); return true; },
    contains(other) {
      if (other === this) return true;
      return this.children.some((c) => c.contains(other));
    },
    querySelector(sel) { return this._find(sel.replace(/^\./, "")); },
    _find(name) {
      for (const c of this.children) {
        if (c._classes.has(name)) return c;
        const hit = c._find(name);
        if (hit) return hit;
      }
      return null;
    },
  };
  Object.assign(node, extra);
  // textContent on a container clears its children in the real DOM, and
  // paint() relies on that to rebuild the list — so it has to be an accessor,
  // which Object.assign cannot copy.
  Object.defineProperties(node, {
    classList: {
      value: {
        add: (c) => node._classes.add(c),
        remove: (c) => node._classes.delete(c),
        toggle(c, on) {
          const has = node._classes.has(c);
          const next = on === undefined ? !has : !!on;
          next ? node._classes.add(c) : node._classes.delete(c);
          return next;
        },
        contains: (c) => node._classes.has(c),
      },
    },
    textContent: {
      get() { return this._text; },
      set(v) { this._text = v; if (v === "") this.children = []; },
    },
  });
  return node;
}

function option(value, label) {
  const o = el({ tagName: "OPTION" });
  o.value = value;
  o.textContent = label;
  return o;
}

function press(node, k) {
  for (const fn of node.handlers.keydown || []) {
    fn({ key: k, type: "keydown", defaultPrevented: false,
         preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });
  }
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
}

const SERVER = {
  providers: [
    { id: "anthropic", label: "Anthropic", accepts_base_url: false, default_base_url: null,
      accepts_any_model: false,
      models: [
        { id: "claude-sonnet-5-5", label: "claude-sonnet-5-5", context_window: 1000000, vision: true },
        // The catalogue's own rule: vision false means "not documented",
        // never "confirmed text-only".
        { id: "claude-haiku-4-5", label: "claude-haiku-4-5", context_window: 200000, vision: false },
      ] },
    // `custom` ships with no models at all — it is a base URL plus a free-text
    // id — which is also what makes it the free-text case below.
    { id: "custom", label: "Custom (OpenAI-compatible)", accepts_base_url: true,
      default_base_url: "http://gpu-box.lan:8000/v1",
      accepts_any_model: true, models: [] },
  ],
};

// One dropdown instance: the .dd wrapper, its trigger, the value slot inside
// it, and the listbox it controls — the exact shape sidepanel.html ships.
function dropdownShell() {
  const root = el({ id: "dd-root" });
  // The trigger's ARIA is authored in sidepanel.html, not by the component —
  // attachDropdown only flips aria-expanded. Seed it the way the markup ships
  // it so a missing attribute in the HTML is what the id check below catches.
  const trigger = el({ tagName: "BUTTON", id: "dd-trigger", attrs: {
    role: "combobox", "aria-expanded": "false",
    "aria-haspopup": "listbox", "aria-controls": "dd-list",
  } });
  const slot = el({ _classes: new Set(["dd-value"]) });
  const list = el({ tagName: "UL", id: "dd-list", hidden: true });
  trigger.appendChild(slot);
  root.appendChild(trigger);
  root.appendChild(list);
  return { root, trigger, slot, list };
}

// A panel wired the way sidepanel.js wires the provider dropdown: the value
// host is a real <select>, and choosing an option writes .value and fires
// `change` so the rest of the file's listeners run untouched.
function panel() {
  const { root, trigger, slot, list } = dropdownShell();
  const host = el({ tagName: "SELECT", id: "model-provider" });
  for (const p of SERVER.providers) host.appendChild(option(p.id, p.label));
  host.value = "anthropic";

  const docListeners = {};
  const doc = {
    activeElement: null,
    createElement: (tag) => el({ tagName: tag.toUpperCase(), id: `n${++uid}` }),
    addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
    listeners: docListeners,
  };

  const sandbox = {
    console, Date, Event: FakeEvent, document: doc, setTimeout, clearTimeout,
    modelCatalog: { providers: SERVER.providers },
    $modelProvider: host,
    $modelName: el({ tagName: "INPUT", id: "model-name" }),
    $modelVisionBadge: el({ id: "modelVisionBadge", hidden: true }),
    $modelContextWindow: el({ id: "modelContextWindow" }),
    ROOT: root, TRIGGER: trigger, LIST: list,
    DROPDOWNS: [],
    dropdownWriting: false,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(catalogSrc, sandbox);
  for (const fn of ["currentProvider", "attachDropdown", "renderModelFacts"]) {
    vm.runInContext(extract(fn), sandbox);
  }
  const dd = vm.runInContext(`attachDropdown({
    root: ROOT, trigger: TRIGGER, list: LIST,
    getOptions: () => [...$modelProvider.children].map((o) => ({ value: o.value, label: o.textContent })),
    getValue: () => $modelProvider.value,
    setValue: (v) => { $modelProvider.value = v; $modelProvider.dispatchEvent(new Event('change')); },
  })`, sandbox);

  const clickOutside = () => {
    for (const fn of docListeners.click || []) fn({ target: el(), type: "click" });
  };

  return { root, trigger, slot, list, host, dd, sandbox, clickOutside };
}

function main() {
  // ── Opening and selecting by keyboard ────────────────────────────────────
  {
    const { trigger, list, host, root } = panel();

    press(trigger, "ArrowDown");
    check("ArrowDown opens the list", list.hidden === false);
    check("…and the trigger announces it", trigger.getAttribute("aria-expanded") === "true");
    check("…and controls the listbox it points at", trigger.getAttribute("aria-controls") === "dd-list");
    check("…and the wrapper knows it is open", root._classes.has("open") === true);
    check("opening lands the active option on the current value",
      trigger.getAttribute("aria-activedescendant") === "dd-list-opt-0",
      trigger.getAttribute("aria-activedescendant"));

    press(trigger, "ArrowDown");
    check("ArrowDown moves the active option",
      trigger.getAttribute("aria-activedescendant") === "dd-list-opt-1",
      trigger.getAttribute("aria-activedescendant"));
    check("…and the active row is marked in the DOM too, not only announced",
      list.children[1]._classes.has("active") === true);
    check("…and the row it left is not", list.children[0]._classes.has("active") === false);

    press(trigger, "ArrowUp");
    check("ArrowUp moves back", trigger.getAttribute("aria-activedescendant") === "dd-list-opt-0");

    press(trigger, "ArrowDown");
    press(trigger, "Enter");
    check("Enter selects the active option", host.value === "custom", host.value);
    check("…and closes the list", list.hidden === true);
    check("…and marks the trigger closed", trigger.getAttribute("aria-expanded") === "false");
    check("…and stops announcing an active option",
      trigger.getAttribute("aria-activedescendant") === null);
  }

  {
    const { trigger, host } = panel();
    press(trigger, "ArrowDown");
    press(trigger, "Enter");
    check("Enter on the already-active option is a no-op on the value",
      host.value === "anthropic", host.value);
    press(trigger, "ArrowDown");
    check("reopening lands on the value just selected, not on the first row",
      trigger.getAttribute("aria-activedescendant") === "dd-list-opt-0",
      trigger.getAttribute("aria-activedescendant"));
    press(trigger, "Escape");
  }

  // ── Escape closes without selecting ──────────────────────────────────────
  {
    // A select that changed under a dismissed menu is how a user saves the
    // wrong security mode believing they chose nothing.
    const { trigger, list, host } = panel();
    press(trigger, "ArrowDown");
    press(trigger, "ArrowDown");
    press(trigger, "Escape");
    check("Escape closes the list", list.hidden === true);
    check("Escape does not select anything", host.value === "anthropic", host.value);
    check("Escape clears the active-option announcement",
      trigger.getAttribute("aria-activedescendant") === null);
  }

  // ── Enter and Space open; Tab closes ─────────────────────────────────────
  {
    const { trigger, list, host } = panel();
    press(trigger, "Enter");
    check("Enter opens a closed list", list.hidden === false);
    press(trigger, "Tab");
    check("Tab closes without selecting", list.hidden === true && host.value === "anthropic");

    press(trigger, " ");
    check("Space opens a closed list", list.hidden === false);
  }

  // ── Click to select, click outside to dismiss ────────────────────────────
  {
    const { trigger, list, host, clickOutside } = panel();
    press(trigger, "ArrowDown");
    list.children[1].dispatchEvent({ type: "click", target: list.children[1] });
    check("clicking an option selects it", host.value === "custom", host.value);

    press(trigger, "ArrowDown");
    clickOutside();
    check("clicking outside closes the list", list.hidden === true);
  }

  // ── Selection is communicated, and not by colour ─────────────────────────
  {
    const { trigger, list, slot } = panel();
    press(trigger, "ArrowDown");
    check("the current option is marked in the open list",
      list.children[0].getAttribute("aria-selected") === "true");
    check("…and the others are explicitly not",
      list.children[1].getAttribute("aria-selected") === "false");
    check("selection is carried by a check glyph, because the panel is monochrome",
      list.children[0].children[0].textContent === "✓" &&
      list.children[1].children[0].textContent === "");
    check("the check is hidden from the a11y tree, which reads aria-selected",
      list.children[0].children[0].getAttribute("aria-hidden") === "true");
    check("options carry role=option",
      list.children[0].getAttribute("role") === "option");
    check("the box names the selected option without the list being open",
      slot.textContent === "Anthropic", slot.textContent);
  }

  // ── The model facts ──────────────────────────────────────────────────────
  {
    const { sandbox } = panel();
    const badge = sandbox.$modelVisionBadge;
    const ctx = sandbox.$modelContextWindow;
    // "Locale-formatted" means the reader's locale, so the expectation is
    // built the same way the panel builds it. What is being asserted is that
    // the number goes through toLocaleString at all and is never a raw digit
    // string glued onto "ctx".
    const shown = (n) => `${n.toLocaleString()} ctx`;

    sandbox.$modelName.value = "claude-sonnet-5-5";
    vm.runInContext("renderModelFacts()", sandbox);
    check("a documented-vision model gets the VISION badge", badge.textContent === "VISION", badge.textContent);
    check("…marked affirmative, not neutral", badge.dataset.vision === "yes");
    check("…and visible", badge.hidden === false);
    check("the context window is locale-formatted",
      ctx.textContent === shown(1000000), ctx.textContent);

    sandbox.$modelName.value = "claude-haiku-4-5";
    vm.runInContext("renderModelFacts()", sandbox);
    check("vision:false never claims the model is text-only",
      !/text-only|not supported|no image/i.test(badge.textContent), badge.textContent);
    check("vision:false reads as unverified, which is what the catalogue says",
      badge.textContent === "vision unverified" && badge.dataset.vision === "no");
    check("a 200K model still reports its own window",
      ctx.textContent === shown(200000), ctx.textContent);

    // The free-text case is the reason the model control is an input at all.
    sandbox.$modelProvider.value = "custom";
    sandbox.$modelName.value = "qwen2.5-coder:7b";
    vm.runInContext("renderModelFacts()", sandbox);
    check("an unknown model id falls back to the provider's smallest known window",
      ctx.textContent === shown(128000), ctx.textContent);
    check("…rather than inventing the largest window in the catalogue",
      ctx.textContent !== shown(1000000));
    check("…and says that number is a fallback, not a fact about the model",
      /not in the catalogue/.test(ctx.title), ctx.title);

    sandbox.$modelName.value = "";
    vm.runInContext("renderModelFacts()", sandbox);
    check("an empty field renders no window and hides the badge",
      ctx.textContent === "" && badge.hidden === true);
  }

  // ── The offline fallback carries the same shape ──────────────────────────
  {
    const models = (() => {
      const sandbox = { console, Date, fetch: async () => { throw new Error("down"); },
                        chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } } };
      sandbox.globalThis = sandbox;
      vm.createContext(sandbox);
      vm.runInContext(catalogSrc, sandbox);
      return sandbox.brottoModelCatalog.FALLBACK.providers.flatMap((p) => p.models);
    })();
    check("every offline fallback model carries a label for the panel to render",
      models.every((m) => typeof m.label === "string" && m.label.length > 0));
    check("…and a vision flag, so the badge reads offline instead of vanishing",
      models.every((m) => typeof m.vision === "boolean"));
    check("the fallback marks only what a vendor actually documented",
      models.find((m) => m.id === "claude-sonnet-5-5").vision === true &&
      models.find((m) => m.id === "MiniMax-M2.7").vision === false);
    check("the fallback declares itself a fallback, not a copy to keep in sync",
      /not a copy to keep in sync/.test(catalogSrc));
  }

  // ── Every id the JS queries still exists in the markup ────────────────────
  {
    const ids = new Set();
    for (const m of sidepanel.matchAll(/getElementById\((['"])([^'"]+)\1\)/g)) ids.add(m[2]);
    const missing = [...ids].filter((id) => !panelHtml.includes(`id="${id}"`));
    check(`all ${ids.size} getElementById ids exist in sidepanel.html`, missing.length === 0,
      `missing: ${missing.join(", ")}`);
  }

  // ── The design system's non-negotiables, asserted on the source ───────────
  {
    // populateModelOptions() has always toggled .hidden, and with no rule for
    // it the base-URL and API-key boxes showed for every provider — a class
    // that hides nothing reads clean in review, so it needs a check.
    check(".hidden is actually defined", /\.hidden\s*\{\s*display:\s*none\s*!important;?\s*\}/.test(panelHtml));
    check("the dropdown list draws a border and never a shadow",
      /\.dd-list\s*\{[^}]*border:\s*1px solid var\(--rule-2\)/.test(panelHtml) &&
      !/\.dd-list\s*\{[^}]*box-shadow/.test(panelHtml));
    check("the panel still forces square corners globally",
      /border-radius:\s*0\s*!important/.test(panelHtml));
    check("Replay setup is a link, not a second button",
      /id="replaySetupBtn" class="settings-link"/.test(panelHtml));
    // Counted against the sections rather than a literal: a hardcoded 4 broke
    // the moment a section was added, which is the opposite of what a test for
    // "every section is headed" should do.
    const sections = (panelHtml.match(/<section class="settings-section">/g) || []).length;
    check("every Settings section is headed and separated by a hairline",
      sections > 0 &&
      (panelHtml.match(/<h3>/g) || []).length === sections &&
      /\.settings-section \+ \.settings-section \{[^}]*border-top: 1px solid var\(--rule\)/.test(panelHtml));
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
}

main();
