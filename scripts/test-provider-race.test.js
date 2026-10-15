// Changing the provider must take effect immediately, and must stay taken.
//
// The bug is a lost update, and it is an absence: no line in the diff said
// "this repaint may arrive after the user's click". Three hydrations run on a
// panel open — the bare one, the one behind the catalogue fetch, and the one
// behind /health — and each re-read `chrome.storage.local`. None of them knows
// whether the user had already moved. So a provider picked in the window
// between two of them was overwritten by whichever storage read landed last,
// which is the *previous* provider: its model list, its model name, its
// context window. Replying to the user's next click was the only way to clear
// it.
//
// The other half is the delay. `modelCatalog` was null until the fetch
// resolved, so the provider <select> had zero options for the length of that
// request. A provider chosen there was written to a <select> that had nowhere
// to put it — the value silently became "" — and the next repaint replaced it
// with the stored config. The fix seeds the select from model_catalog.js's own
// FALLBACK, which is what that file already does when the server is down.
//
// Everything here is extracted from the shipping panel by brace matching and
// run against a fake DOM, so it cannot drift. `model_catalog.js` is evaluated
// as-is too, so the fallback this test reads is the one that ships.
//
//   node scripts/test-provider-race.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src");
const panel = fs.readFileSync(path.join(SRC, "sidepanel.js"), "utf8");
const dropdownSrc = fs.readFileSync(path.join(SRC, "dropdown.js"), "utf8");
const catalogSrc = fs.readFileSync(path.join(SRC, "model_catalog.js"), "utf8");
const modelKeysSrc = fs.readFileSync(path.join(SRC, "model_keys.js"), "utf8");

/** Brace-matched body of `function name(...)`. */
function extract(name, src = name === "attachDropdown" ? dropdownSrc : panel) {
  const start = src.search(new RegExp(`^(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} in ${src === dropdownSrc ? "dropdown.js" : "sidepanel.js"} — renamed?`);
  let parens = 0;
  let bodyStart = -1;
  for (let i = src.indexOf("(", start); i < src.length; i++) {
    if (src[i] === "(") parens++;
    else if (src[i] === ")" && --parens === 0) { bodyStart = src.indexOf("{", i); break; }
  }
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

/**
 * Any brace-delimited statement block, anchored on its opening text. Used for
 * the two `if ($modelProvider) { … }` listener registrations, which are not
 * functions and so cannot go through `extract` — and stubbing them out would
 * mean testing a copy of the guard rather than the guard.
 */
function extractBlock(anchor) {
  const at = panel.indexOf(anchor);
  if (at < 0) throw new Error(`no block ${anchor} in sidepanel.js — renamed?`);
  let depth = 0;
  for (let i = panel.indexOf("{", at); i < panel.length; i++) {
    if (panel[i] === "{") depth++;
    else if (panel[i] === "}" && --depth === 0) return panel.slice(at, i + 1);
  }
  throw new Error(`unterminated block ${anchor}`);
}

/**
 * A <select> with the one behaviour this whole bug turns on: assigning a value
 * that no option carries leaves the control empty. A fake that accepted it
 * would let the original defect pass every assertion below.
 */
function FakeSelect() {
  this._options = [];
  this._value = "";
  this._listeners = {};
}
Object.defineProperty(FakeSelect.prototype, "children", {
  get() { return this._options; },
});
Object.defineProperty(FakeSelect.prototype, "textContent", {
  get() { return this._options.map((o) => o.textContent).join(""); },
  set() { this._options = []; this._value = ""; },
});
Object.defineProperty(FakeSelect.prototype, "value", {
  get() { return this._value; },
  set(v) { this._value = this._options.some((o) => o.value === v) ? v : ""; },
});
FakeSelect.prototype.appendChild = function (opt) {
  this._options.push(opt);
  // Chromium auto-selects the first option of a select that has none selected.
  // Without this the fake reports a blank control where the real one is usable.
  if (!this._options.some((o) => o.value === this._value)) this._value = opt.value;
};
FakeSelect.prototype.addEventListener = function (t, fn) {
  (this._listeners[t] = this._listeners[t] || []).push(fn);
};
FakeSelect.prototype.dispatchEvent = function (e) {
  for (const fn of this._listeners[e.type] || []) fn(e);
};

function fakeInput(value = "") {
  return {
    value,
    listeners: {},
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    dispatchEvent(e) { for (const fn of this.listeners[e.type] || []) fn(e); },
  };
}

/** A DOM node good enough for the real attachDropdown. */
function fakeEl(tag = "div") {
  const el = {
    tagName: tag, children: [], className: "", hidden: false, id: "",
    dataset: {}, attrs: {}, _text: "", listeners: {},
    set textContent(v) { this._text = String(v); if (v === "") this.children = []; },
    get textContent() {
      return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text;
    },
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(t, fn) { (this.listeners[t] || (this.listeners[t] = [])).push(fn); },
    scrollIntoView() {},
    click() { for (const fn of this.listeners.click || []) fn({ type: "click" }); },
  };
  el.classList = {
    _s: new Set(),
    add(...c) { c.forEach((x) => this._s.add(x)); },
    remove(...c) { c.forEach((x) => this._s.delete(x)); },
    contains(c) { return this._s.has(c); },
  };
  return el;
}

/**
 * The real attachDropdown over a fake DOM, driving the exact gesture the bug
 * report describes: open the provider list, click a provider, read the label
 * back off the trigger.
 */
function openDropdown(hostValue = "anthropic") {
  const list = fakeEl("ul");
  const slot = fakeEl("span");
  slot.className = "dd-value";
  const root = fakeEl("div");
  root.contains = () => true;
  const trigger = fakeEl("button");
  trigger.querySelector = (sel) => (sel === ".dd-value" ? slot : null);

  const sandbox = {
    console, Event: { type: "x" },
    document: { createElement: (tag) => fakeEl(tag), addEventListener() {}, activeElement: null },
    DROPDOWNS: [], dropdownWriting: false,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extract("attachDropdown"), sandbox);

  let value = hostValue;
  const dd = sandbox.attachDropdown({
    root, trigger, list,
    getOptions: () => [
      { value: "anthropic", label: "Anthropic" },
      { value: "openai", label: "OpenAI" },
    ],
    getValue: () => value,
    setValue: (v) => { value = v; },
  });
  return {
    label: () => slot.textContent,
    open: () => dd.open(),
    /** Open, then click the row for `providerId`, exactly as a user would. */
    pick(providerId) {
      dd.open();
      const i = list.children.findIndex((r) => r.dataset.value === providerId);
      list.children[i].click();
      return value;
    },
  };
}

const SERVED = {
  providers: [
    { id: "anthropic", label: "Anthropic", accepts_base_url: false,
      default_base_url: null, accepts_any_model: false,
      models: [{ id: "claude-sonnet-5-5", label: "claude-sonnet-5-5", context_window: 1000000, vision: true }] },
    { id: "openai", label: "OpenAI", accepts_base_url: false,
      default_base_url: null, accepts_any_model: false,
      models: [{ id: "gpt-6-luna", label: "gpt-6-luna", context_window: 400000, vision: false }] },
  ],
};

/**
 * A panel opened with `stored` already saved. `fetch` is held by the caller so
 * the catalogue can be resolved at any moment the test wants — which is the
 * whole point: the race is about *when*, and a stub that resolves immediately
 * cannot express it.
 */
function openPanel(stored) {
  let release = null;
  let held = false;
  const served = new Promise((r) => { release = r; });
  const calls = { fetched: 0 };

  const sandbox = {
    console, Date, JSON, Promise, Event: { type: "x" },
    document: {
      createElement: () => ({ value: "", textContent: "" }),
      activeElement: null,
    },
    chrome: {
      storage: {
        local: {
          get: async (k) => (k === "modelCatalog" ? {} : (stored === undefined ? {} : { modelConfig: stored })),
          set: async () => {},
        },
      },
    },
    fetch: async () => {
      calls.fetched++;
      if (held) await served;
      return { ok: true, json: async () => SERVED };
    },
    $modelProvider: new FakeSelect(),
    $modelName: fakeInput(),
    $modelNameOptions: (() => {
      // textContent='' clears the option store, exactly as it does on a
      // <datalist> — otherwise the old provider's models accumulate and every
      // "the list is the new provider's" check passes on stale entries.
      const d = { children: [] };
      Object.defineProperty(d, "textContent", {
        get() { return this.children.map((o) => o.value).join(""); },
        set() { this.children = []; },
      });
      d.appendChild = function (o) { this.children.push(o); };
      return d;
    })(),
    $modelBaseUrlSetting: { classList: { toggle() {} } },
    $modelBaseUrl: { value: "" },
    $modelContextWindow: { textContent: "", title: "" },
    $modelContextWindowSetting: { classList: { toggle() {} } },
    $modelContextWindowInput: { value: "" },
    $modelVisionBadge: { hidden: true, dataset: {}, textContent: "" },
    modelSettingsEdited: false,
    // Free variables the brace-matched hydrate/save bodies close over.
    KEY_MASK: '••••••••',
    $modelKey: { value: "" },
    dropdownWriting: false,
    modelDd: null,
    // initModelSettings repaints the provider trigger itself, so the /health
    // path — which awaits it with no .then — cannot leave the trigger naming
    // the previous server's provider. Optional chaining does not save an
    // undeclared identifier, so the sandbox has to declare it.
    providerDd: null,
    modelCheckPass: null,
    setModelPill() {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(catalogSrc, sandbox);
  // The panel's own seed expression, evaluated rather than assumed — otherwise
  // this test would pass with `let modelCatalog = null` back in place, because
  // it would be seeding the catalogue itself instead of reading what ships.
  const seed = panel.match(/^let modelCatalog = (.+);$/m);
  if (!seed) throw new Error("no `let modelCatalog = …` in sidepanel.js — renamed?");
  sandbox.modelCatalog = vm.runInContext(seed[1], sandbox);

  // The real key-naming pair: a hand-written stand-in would let these pass
  // while the shipped file reads a per-account key.
  vm.runInContext(modelKeysSrc, sandbox);
  vm.runInContext(extract("modelKeyNames"), sandbox);
  for (const fn of ["currentProvider", "populateModelOptions", "populateProviders",
                    "effectiveContextWindow", "renderModelFacts", "hydrateModelSettings", "initModelSettings", "repaintKeyField"]) {
    vm.runInContext(extract(fn), sandbox);
  }
  // The synchronous populate the panel does at module scope, before any fetch.
  vm.runInContext("populateProviders();", sandbox);
  // The two listener registrations, verbatim.
  vm.runInContext(extractBlock("if ($modelProvider) {"), sandbox);
  vm.runInContext(extractBlock("if ($modelName) {"), sandbox);
  // Formatted in the sandbox's own realm. The panel writes the context window
  // with `toLocaleString()`, and the grouping it produces depends on the host's
  // locale — asserting "400,000" would fail the test on a machine set to
  // en-IN, which says nothing about the panel.
  const fmt = vm.runInContext("(n) => n.toLocaleString()", sandbox);

  return {
    sandbox,
    calls,
    /** Stop the next fetch from answering until landCatalogue(). */
    holdCatalogue() { held = true; },
    /** The catalogue arriving. This is the "later" in the race. */
    landCatalogue() { held = false; release(); },
    /** Kick off init without awaiting, so the fetch can be held open. */
    startInit() { return sandbox.initModelSettings("http://localhost:8000"); },
    async openSettings() { await sandbox.initModelSettings("http://localhost:8000"); },
    /** What the user does: open the provider list, click OpenAI. */
    pick(providerId) {
      sandbox.$modelProvider.value = providerId;
      sandbox.$modelProvider.dispatchEvent({ type: "change" });
    },
    async typeModel(id) {
      sandbox.$modelName.value = id;
      sandbox.$modelName.dispatchEvent({ type: "input" });
    },
    // Mirrors the module-scope `hydrateModelSettings().then(() => { …; renderModelFacts(); })`.
    async hydrate() {
      await sandbox.hydrateModelSettings();
      vm.runInContext("renderModelFacts()", sandbox);
    },
    fmt: (n) => `${fmt(n)} ctx`,
    ids() { return sandbox.$modelNameOptions.children.map((o) => o.value); },
    facts() {
      return { ctx: sandbox.$modelContextWindow.textContent,
               vision: sandbox.$modelVisionBadge.textContent };
    },
  };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
}

async function main() {
  const STORED = { provider: "anthropic", model: "claude-sonnet-5-5", context_window: 1000000 };

  // ── The provider control must exist before any request answers ────────────
  //
  // An empty <select> is not "loading", it is a control that cannot be used:
  // the value the user picked goes nowhere and is lost on the next repaint.
  {
    const p = openPanel(STORED);
    check("the panel seeds the provider list from the shipped fallback",
      p.sandbox.$modelProvider.children.length > 0,
      `${p.sandbox.$modelProvider.children.length} options`);
    check("…and something is selected, so the box is never blank",
      p.sandbox.$modelProvider.value !== "");
  }
  {
    // The seed is the catalogue file's own FALLBACK, not a second list.
    const p = openPanel(STORED);
    const ids = p.sandbox.$modelProvider.children.map((o) => o.value);
    const fallback = p.sandbox.brottoModelCatalog.FALLBACK.providers.map((x) => x.id);
    check("…taken from model_catalog.js, not hand-kept here",
      JSON.stringify(ids) === JSON.stringify(fallback), `${ids} vs ${fallback}`);
  }

  // ── The race: the user picks, then storage catches up ────────────────────
  {
    const p = openPanel(STORED);
    await p.hydrate();
    check("the stored config lands first", p.sandbox.$modelProvider.value === "anthropic"
      && p.sandbox.$modelName.value === "claude-sonnet-5-5");

    p.pick("openai");
    await p.typeModel("gpt-6-luna");
    check("the change is visible immediately", p.sandbox.$modelProvider.value === "openai"
      && p.sandbox.$modelName.value === "gpt-6-luna");

    // …and now every later hydration must leave it alone.
    await p.hydrate();
    await p.hydrate();
    check("a late hydration does not put the old provider back",
      p.sandbox.$modelProvider.value === "openai", p.sandbox.$modelProvider.value);
    check("…nor the old model name", p.sandbox.$modelName.value === "gpt-6-luna",
      p.sandbox.$modelName.value);
  }

  // ── …including the one behind the catalogue fetch ─────────────────────────
  //
  // The ordering that loses the edit: the user picks while /v1/models is still
  // in flight, and the hydration at the end of that init answers afterwards.
  {
    const p = openPanel(STORED);
    await p.hydrate();
    p.holdCatalogue();
    const inflight = p.startInit();
    p.pick("openai");
    await p.typeModel("gpt-6-luna");
    check("the pick is usable while the catalogue is still in flight",
      p.sandbox.$modelProvider.value === "openai", p.sandbox.$modelProvider.value);

    p.landCatalogue();
    await inflight;
    check("the catalogue is fetched", p.calls.fetched === 1, `${p.calls.fetched} fetches`);
    check("…and the picked provider survives it", p.sandbox.$modelProvider.value === "openai",
      p.sandbox.$modelProvider.value);
    check("…and the picked model survives it", p.sandbox.$modelName.value === "gpt-6-luna",
      p.sandbox.$modelName.value);
    check("…and the list is now the new provider's", p.ids().join() === "gpt-6-luna",
      p.ids().join());
    check("…and the facts are the new provider's", p.facts().ctx === p.fmt(400000),
      p.facts().ctx);
  }

  // ── The reverse order: storage arrives after /health names the server ────
  {
    const p = openPanel(STORED);
    await p.openSettings();
    p.pick("openai");
    await p.typeModel("gpt-6-luna");
    // The /health path calls initModelSettings a second time (sidepanel.js
    // ~5038), which ends in another storage read.
    await p.openSettings();
    check("a second init does not resurrect the stored provider",
      p.sandbox.$modelProvider.value === "openai", p.sandbox.$modelProvider.value);
    check("…nor the stored model", p.sandbox.$modelName.value === "gpt-6-luna",
      p.sandbox.$modelName.value);
  }

  // ── An untouched panel still gets storage, twice, unchanged ───────────────
  //
  // The guard is on *edits*, not on hydration. Skipping the restore for a user
  // who has not touched anything would strand the pill and the model box.
  {
    const p = openPanel(STORED);
    await p.hydrate();
    check("an untouched panel takes the stored provider", p.sandbox.$modelProvider.value === "anthropic");
    await p.openSettings();
    check("…and keeps it through the catalogue load", p.sandbox.$modelProvider.value === "anthropic",
      p.sandbox.$modelProvider.value);
    check("…with the stored model", p.sandbox.$modelName.value === "claude-sonnet-5-5",
      p.sandbox.$modelName.value);
  }
  {
    // The pill names what this browser last *saved*. An unsaved edit moving it
    // would claim a model the next task will not run on.
    const p = openPanel(STORED);
    let pill = null;
    p.sandbox.setModelPill = (m) => { pill = m; };
    await p.hydrate();
    p.pick("openai");
    await p.typeModel("gpt-6-luna");
    await p.hydrate();
    check("the header pill still names the saved model, not the unsaved edit",
      pill === "claude-sonnet-5-5", String(pill));
  }

  // ── The facts follow the provider ─────────────────────────────────────────
  {
    const p = openPanel(STORED);
    await p.openSettings();
    check("a vision-documented model gets the badge",
      p.facts().vision === "VISION", p.facts().vision);
    p.pick("openai");
    await p.typeModel("gpt-6-luna");
    check("…and the next provider's model gets its own facts",
      p.facts().ctx === p.fmt(400000) && p.facts().vision === "vision unverified",
      JSON.stringify(p.facts()));
  }

  // ── The trigger's own label ──────────────────────────────────────────────
  //
  // The other half of the report, and the half the hydration guard does not
  // touch: the provider box kept reading "Anthropic" after the user picked
  // OpenAI. `close()` runs before the value is written, so the label painted
  // by `open()` was correct for the value *before* the choice, and nothing
  // between the click and the next open re-read it.
  {
    const dd = openDropdown("anthropic");
    dd.open();
    check("the trigger label starts on the host's value", dd.label() === "Anthropic", dd.label());
    dd.pick("openai");
    check("choosing a provider repaints the trigger's label",
      dd.label() === "OpenAI", dd.label());
  }
  {
    // The repaint has to be in the component, not in the provider's own change
    // handler: the model dropdown shares this code and its trigger is the input
    // itself, so a fix bolted onto one listener leaves the other unfixed.
    const choose = extract("attachDropdown");
    check("the repaint is in choose(), the shared place",
      /function choose\(i\)[\s\S]*?sync\(\);[\s\S]*?\n  \}/.test(choose));
  }

  // ── The call site, on the source ─────────────────────────────────────────
  //
  // The bug was an absence, so what is asserted is the presence of the thing
  // that prevents a repeat: the seed, the synchronous populate, and the flag
  // written by both user handlers.
  {
    check("the catalogue is seeded from the shipped fallback, not null",
      /let modelCatalog = brottoModelCatalog\.FALLBACK;/.test(panel)
      && !/let modelCatalog = null;/.test(panel));
    check("the provider list is populated synchronously, not only inside the async init",
      /^\}\n\n\/\/ Populated before any request resolves[\s\S]*?^populateProviders\(\);$/m.test(panel));
    check("picking a provider marks the fields edited",
      /\$modelProvider\.addEventListener\('change', \(\) => \{\s*\n\s*modelSettingsEdited = true;/.test(panel));
    check("typing a model marks the fields edited",
      /\$modelName\.addEventListener\('input', \(\) => \{\s*\n\s*modelSettingsEdited = true;/.test(panel));
    // The guard has to be in the shared function, or one of the three callers
    // is still unprotected and the failure comes back as "it does it sometimes".
    const hydrate = extract("hydrateModelSettings");
    check("the guard is in hydrateModelSettings, where all three callers land",
      /if \(!modelSettingsEdited\)/.test(hydrate));
    check("…and it guards the provider, the model and the base URL together",
      /if \(!modelSettingsEdited\) \{[\s\S]*?\$modelProvider\.value = cfg\.provider;[\s\S]*?\$modelName\.value = cfg\.model;[\s\S]*?\$modelBaseUrl\.value = cfg\.base_url;/.test(hydrate));
    // The pill is outside the guard; the behavioural check above proves it
    // (a user who picked openai and did not save still sees the saved model in
    // the header), so asserting the shape here as well would only re-state it.
    check("…and the pill is still fed from storage",
      hydrate.indexOf("setModelPill(cfg.model)") > hydrate.indexOf("if (!modelSettingsEdited)"));
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
}

main();