// The model settings UI: one catalogue from the server, and per-provider
// fields that appear only where they apply.
//
// The functions under test are extracted from the shipping sources by brace
// matching and eval'd against a fake DOM, so this cannot drift from what
// ships. That matters more than usual here: every one of the failures this
// guards against is an *absence* — a field that silently stopped being
// prefilled, a provider that stopped appearing in the select, a base_url that
// stopped being persisted — and an absence reads clean in review.
//
//   node scripts/test-model-config.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXT = path.join(__dirname, "..", "clients", "brotto-extension", "src");
const sidepanel = fs.readFileSync(path.join(EXT, "sidepanel.js"), "utf8");
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

// Brace match for a bare block (`if ($modelSave) { ... }`) so the save
// handler — an inline arrow, not a named function — can be registered the way
// it is in the shipping file.
function extractBlock(anchor) {
  const start = sidepanel.search(new RegExp(anchor));
  if (start < 0) throw new Error(`no ${anchor} in sidepanel.js — renamed?`);
  let depth = 0;
  for (let i = sidepanel.indexOf("{", start); i < sidepanel.length; i++) {
    if (sidepanel[i] === "{") depth++;
    else if (sidepanel[i] === "}" && --depth === 0) return sidepanel.slice(start, i + 1);
  }
  throw new Error(`unterminated block ${anchor}`);
}

// ── Fake DOM ───────────────────────────────────────────────────────────────
function el(extra = {}) {
  return Object.assign({
    value: "",
    textContent: "",
    children: [],
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
                 toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
                 contains(c) { return this._s.has(c); } },
    appendChild(c) { this.children.push(c); return c; },
    replaceChildren() { this.children = []; },
    addEventListener(type, fn) { (this.handlers ||= {})[type] = fn; },
    focus() {},
  }, extra);
}

function storage() {
  const local = {};
  const session = {};
  return {
    local, session,
    chrome: {
      storage: {
        local: {
          get: async (k) => (k in local ? { [k]: local[k] } : {}),
          set: async (o) => Object.assign(local, o),
          remove: async (k) => { delete local[k]; },
        },
        session: {
          get: async (k) => (k in session ? { [k]: session[k] } : {}),
          set: async (o) => Object.assign(session, o),
          remove: async (k) => { delete session[k]; },
        },
      },
    },
  };
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
      accepts_any_model: false, keyless_ok: false,
      models: [{ id: "claude-sonnet-5-5", context_window: 1000000 }] },
    { id: "ollama", label: "Ollama (local)", accepts_base_url: true,
      default_base_url: "http://localhost:11434/v1",
      accepts_any_model: true, keyless_ok: true,
      models: [{ id: "llama3.1", context_window: 128000 }] },
  ],
};

// ── model_catalog.js, run as shipped ───────────────────────────────────────
async function makeCatalog(fetchImpl) {
  const store = storage();
  const sandbox = {
    chrome: store.chrome, console, Date,
    fetch: fetchImpl,
    globalThis: null,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(catalogSrc, sandbox);
  return { api: sandbox.brottoModelCatalog, store };
}

async function main() {
  // ── The loader ───────────────────────────────────────────────────────────
  {
    const { api, store } = await makeCatalog(async (url) => {
      if (url !== "http://box:8000/v1/models") throw new Error(`wrong url ${url}`);
      return { ok: true, status: 200, json: async () => SERVER };
    });
    const out = await api.load("http://box:8000/");
    check("the catalogue comes from GET /v1/models", out.providers.length === 2);
    check("a trailing slash on the server URL is trimmed", out.offline === false);
    check("the fetched catalogue is cached for next open",
      Array.isArray(store.local.modelCatalog.providers));
  }

  {
    let calls = 0;
    const { api } = await makeCatalog(async () => { calls++; return { ok: true, status: 200, json: async () => SERVER }; });
    await api.load("http://box:8000");
    await api.load("http://box:8000");
    check("a warm cache is not re-fetched on every open", calls === 1, `calls=${calls}`);
  }

  {
    const { api } = await makeCatalog(async () => { throw new Error("ECONNREFUSED"); });
    const out = await api.load("http://box:8000");
    check("Settings still opens with the server down", out.providers.length > 0);
    check("…and says it is running on the fallback", out.offline === true);
  }

  {
    const { api } = await makeCatalog(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const out = await api.load("http://box:8000");
    check("a 500 falls back rather than rendering nothing", out.providers.length > 0);
  }

  {
    const { api } = await makeCatalog(async () => ({ ok: true, status: 200, json: async () => ({ providers: [] }) }));
    const out = await api.load("http://box:8000");
    check("an empty catalogue is not cached as the truth", out.providers.length > 0);
  }

  {
    // A stale cache beats the fallback: otherwise a server edit silently
    // stops showing up for anyone who opened Settings while it was down.
    const { api, store } = await makeCatalog(async () => { throw new Error("down"); });
    store.local.modelCatalog = { providers: SERVER.providers, at: 0 };
    const out = await api.load("http://box:8000");
    check("a stale cache is preferred over the built-in fallback", out.providers[1].id === "ollama");
  }

  // ── context_window, which drives the AX-tree budget ──────────────────────
  {
    const { api } = await makeCatalog(async () => { throw new Error("x"); });
    const list = { providers: SERVER.providers };
    check("a catalogued model reports its own window",
      api.contextWindow(list, "anthropic", "claude-sonnet-5-5") === 1000000);
    check("a free-text model id does not claim zero",
      api.contextWindow(list, "ollama", "qwen2.5-coder:7b") === 128000,
      String(api.contextWindow(list, "ollama", "qwen2.5-coder:7b")));
    // window/20 becomes the AX budget, so an invented 1M would overrun the real
    // window and 400 on the next step. The fallback can only under-fill.
    check("an unknown id never resolves to more than the provider's smallest known window",
      api.contextWindow(list, "ollama", "made-up") <= 128000);
  }

  // ── The side panel's rendering ───────────────────────────────────────────
  function panel(fetchImpl, stored) {
    const els = {
      "model-provider": el(),
      "model-name": el(),
      "model-name-options": el(),
      modelBaseUrlSetting: el({ className: "hidden" }),
      "model-base-url": el(),
      modelKeySetting: el(),
      "model-api-key": el(),
      "model-save": el(),
      "model-save-status": el(),
    };
    const store = storage();
    if (stored) store.local.modelConfig = stored;
    els["model-provider"].value = stored ? stored.provider : "";
    els["model-name"].value = stored ? stored.model : "";
    const sandbox = {
      console,
      document: {
        getElementById: (id) => els[id] || null,
        activeElement: null,
        createElement: (tag) => el({ tagName: tag.toUpperCase() }),
      },
      chrome: store.chrome, fetch: fetchImpl,
      setModelPill() {}, brottoModelCatalog: null, setTimeout,
      globalThis: null,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    // The panel's element handles are module-level consts in the real file.
    Object.assign(sandbox, {
      $modelProvider: els["model-provider"],
      $modelName: els["model-name"],
      $modelNameOptions: els["model-name-options"],
      $modelBaseUrlSetting: els.modelBaseUrlSetting,
      $modelBaseUrl: els["model-base-url"],
      $modelKeySetting: els.modelKeySetting,
      $modelKey: els["model-api-key"],
      $modelSave: els["model-save"],
      $modelStatus: els["model-save-status"],
    });
    return { els, store, sandbox };
  }

  // The loader is loaded into the same sandbox so the panel runs against the
  // real catalogue code rather than a hand-written stand-in.
  async function panelWithCatalog(fetchImpl, stored) {
    const { els, store, sandbox } = panel(fetchImpl, stored);
    vm.runInContext(catalogSrc, sandbox);
    for (const fn of ["currentProvider", "populateModelOptions", "populateProviders",
                      "initModelSettings", "hydrateModelSettings"]) {
      vm.runInContext(extract(fn), sandbox);
    }
    // The click handler, registered the way the file registers it.
    vm.runInContext(extractBlock(String.raw`if \(\$modelSave\) \{`), sandbox);
    return { els, store, sandbox, ctx: sandbox };
  }

  const ok = async () => ({ ok: true, status: 200, json: async () => SERVER });

  {
    const { els, ctx } = await panelWithCatalog(ok);
    await ctx.initModelSettings("http://box:8000");
    const ids = els["model-provider"].children.map((c) => c.value);
    check("the provider select is populated from the server", ids.length === 2, JSON.stringify(ids));
    check("provider options are labelled, not raw ids",
      els["model-provider"].children[1].textContent === "Ollama (local)");
    check("model suggestions come from the catalogue",
      els["model-name-options"].children.map((c) => c.value).join() === "claude-sonnet-5-5");
  }

  {
    const { els, ctx } = await panelWithCatalog(ok);
    await ctx.initModelSettings("http://box:8000");
    els["model-provider"].value = "anthropic";
    vm.runInContext("populateModelOptions()", ctx);
    check("a fixed-endpoint provider hides the base-URL box",
      els.modelBaseUrlSetting.classList.contains("hidden") === true);
    check("…and does not prefill one", els["model-base-url"].value === "");
    check("a keyed provider keeps the API-key box",
      els.modelKeySetting.classList.contains("hidden") === false);
  }

  {
    const { els, ctx } = await panelWithCatalog(ok);
    await ctx.initModelSettings("http://box:8000");
    els["model-provider"].value = "ollama";
    vm.runInContext("populateModelOptions()", ctx);
    check("a self-hosted provider shows the base-URL box",
      els.modelBaseUrlSetting.classList.contains("hidden") === false);
    check("…prefilled with the provider's default endpoint",
      els["model-base-url"].value === "http://localhost:11434/v1");
    check("a keyless provider hides the API-key box",
      els.modelKeySetting.classList.contains("hidden") === true);
  }

  {
    // The whole point of base_url on ModelConfig: an Ollama user should not
    // re-paste it every browser restart, the way they re-paste their key.
    const { els, store, ctx } = await panelWithCatalog(ok);
    await ctx.initModelSettings("http://box:8000");
    els["model-provider"].value = "ollama";
    vm.runInContext("populateModelOptions()", ctx);
    els["model-name"].value = "qwen2.5-coder:7b";
    els["model-api-key"].value = "";
    await els["model-save"].handlers.click();
    check("base_url is persisted with the model config",
      store.local.modelConfig.base_url === "http://localhost:11434/v1",
      JSON.stringify(store.local.modelConfig));
    check("a free-text model id still gets a context window",
      store.local.modelConfig.context_window > 0);
    check("a keyless provider's blank key does not write a key",
      !("modelApiKey" in store.session));
  }

  {
    const { els, store, ctx } = await panelWithCatalog(ok);
    await ctx.initModelSettings("http://box:8000");
    els["model-provider"].value = "anthropic";
    vm.runInContext("populateModelOptions()", ctx);
    els["model-name"].value = "claude-sonnet-5-5";
    els["model-api-key"].value = "sk-secret";
    await els["model-save"].handlers.click();
    check("a provider with no base-URL field stores null, not the leftover box value",
      store.local.modelConfig.base_url === null, JSON.stringify(store.local.modelConfig));
    check("the key goes to session storage, not local",
      store.session.modelApiKey === "sk-secret" && !("modelApiKey" in store.local));
  }

  {
    // The round trip this feature exists for, and the one that did not work
    // before base_url was on the config.
    const { els, ctx } = await panelWithCatalog(ok, {
      provider: "ollama", model: "llama3.1", context_window: 128000,
      base_url: "http://gpu-box.lan:11434/v1",
    });
    await ctx.initModelSettings("http://box:8000");
    check("a saved provider comes back selected", els["model-provider"].value === "ollama");
    check("a saved model comes back in the field", els["model-name"].value === "llama3.1");
    check("a saved base URL comes back — not the provider default",
      els["model-base-url"].value === "http://gpu-box.lan:11434/v1",
      els["model-base-url"].value);
  }

  {
    const { els, ctx } = await panelWithCatalog(async () => { throw new Error("down"); }, {
      provider: "anthropic", model: "claude-sonnet-5-5", context_window: 1000000,
    });
    await ctx.initModelSettings("");
    check("a config saved before base_url existed still loads",
      els["model-name"].value === "claude-sonnet-5-5");
    check("…and does not resurrect a stale base URL", els["model-base-url"].value === "");
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
}

main();
