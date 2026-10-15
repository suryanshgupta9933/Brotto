// The model config and the model API key, scoped to the account.
//
// On one flat storage key, two cloud accounts in one Chrome profile shared a
// provider, a model and — the one that mattered — a saved API key, so
// account A's run paid with account B's credential. `model_keys.js` (panel
// and wizard) and `model_config.ts` (the service worker) name the two keys;
// they are separate files because the worker is a TS bundle and the panel is a
// plain script, so they cannot share one function — and they must not drift,
// which is why this file runs both against one table.
//
// The migration decision is pinned here too, because it is the kind of thing
// that reads as an oversight six months from now: **nothing is migrated.** A
// flat key written before this change belongs to whoever was signed in then
// and nothing recorded which, so moving it into whichever account signs in
// next would hand that account a credential that may be someone else's.
//
//   node scripts/test-model-keys.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "clients", "brotto-extension", "src");
const keysJs = fs.readFileSync(path.join(EXT, "model_keys.js"), "utf8");
const configTs = fs.readFileSync(path.join(EXT, "model_config.ts"), "utf8");

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
}

// model_config.ts is TypeScript and this runs under plain `vm`. It is
// compiled, not regex-stripped: the shipped TypeScript compiler is already a
// devDependency of the extension, and a hand-rolled annotation stripper is the
// kind of thing that silently tests something other than what ships.
const ts = require(path.join(ROOT, "clients", "brotto-extension", "node_modules", "typescript"));
// The CommonJS export plumbing is dropped and the rest runs as-is: the module
// has no imports, so the whole body is the thing under test.
const compiled = ts.transpileModule(configTs, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText
  .split("\n")
  .filter((l) => !/^\s*("use strict";|Object\.defineProperty\(exports|exports\.|require\()/.test(l))
  .join("\n");

const ACCOUNT = "8f2c1d3e-0a44-4f1c-9c0b-2f6a91d0c111";

// The worker's copy, read out of the file by brace matching rather than
// retyped, so a renamed constant here fails instead of testing a fixture.
const tsFn = compiled.match(/function modelKeys\([\s\S]*?\n}/);
if (!tsFn) throw new Error("no modelKeys in model_config.ts — renamed?");

// The constants the function closes over, read out of the file: a rename
// fails here rather than being papered over by a fixture that still matches.
const TS_CONSTS = (compiled.match(/^const (MODEL_KEY|API_KEY_KEY) = .*$/gm) || []).join("\n");
if (!/MODEL_KEY/.test(TS_CONSTS) || !/API_KEY_KEY/.test(TS_CONSTS)) {
  throw new Error("no MODEL_KEY/API_KEY_KEY in model_config.ts — renamed?");
}

// A fake chrome.storage.local over a plain object.
function storage(initial) {
  const local = { ...initial };
  return {
    local,
    chrome: {
      storage: {
        local: {
          get: async (k) => {
            const keys = Array.isArray(k) ? k : [k];
            const out = {};
            for (const one of keys) if (one in local) out[one] = local[one];
            return out;
          },
          set: async (o) => { Object.assign(local, o); },
          remove: async (k) => { delete local[k]; },
        },
      },
    },
  };
}

function panelKeys(accountId) {
  const sandbox = { console, globalThis: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(keysJs, sandbox);
  return vm.runInContext(`modelKeys(${JSON.stringify(accountId)})`, sandbox);
}

function workerKeys(accountId) {
  return vm.runInNewContext(
    `${TS_CONSTS}\n${tsFn[0]}; modelKeys(${JSON.stringify(accountId)})`);
}

// ── One table, both surfaces ──────────────────────────────────────────────
const cases = [
  [undefined, { config: "modelConfig", apiKey: "modelApiKey" }],
  [null, { config: "modelConfig", apiKey: "modelApiKey" }],
  ["", { config: "modelConfig", apiKey: "modelApiKey" }],
  [42, { config: "modelConfig", apiKey: "modelApiKey" }],
  [ACCOUNT, { config: `modelConfig:${ACCOUNT}`, apiKey: `modelApiKey:${ACCOUNT}` }],
];
for (const [accountId, want] of cases) {
  const fromJs = panelKeys(accountId);
  const fromTs = workerKeys(accountId);
  check(`both surfaces name the same keys for ${JSON.stringify(accountId) ?? "undefined"}`,
    fromJs.config === want.config && fromJs.apiKey === want.apiKey
    && fromTs.config === want.config && fromTs.apiKey === want.apiKey,
    JSON.stringify({ fromJs, fromTs }));
}
check("two accounts do not share a key",
  panelKeys("acc-a").apiKey !== panelKeys("acc-b").apiKey);

// ── Self-host reads and writes the flat keys, unchanged ──────────────────
(async () => {
  const flat = { modelConfig: { provider: "ollama", model: "qwen" }, modelApiKey: "sk-local" };
  {
    const s = storage({ settings: { serverUrl: "http://localhost:8000" }, ...flat });
    const ctx = vm.createContext(Object.assign(s, {
      chrome: s.chrome,
    }));
    vm.runInContext(compiled, ctx);
    const read = await vm.runInContext("getStoredModelConfig()", ctx);
    check("a self-hoster's key is still under the flat key, byte for byte",
      read.api_key === "sk-local" && read.model_config.model === "qwen", JSON.stringify(read));
    check("and their key never appeared anywhere else",
      !Object.keys(s.local).some((k) => k.includes("modelApiKey:")), JSON.stringify(Object.keys(s.local)));
    await vm.runInContext('setStoredModelConfig({ model_config: { provider: "anthropic", model: "x" }, api_key: null })', ctx);
    check("a self-hoster clearing the key clears the flat one",
      s.local.modelApiKey === undefined && s.local.modelConfig.provider === "anthropic",
      JSON.stringify(s.local));
  }

  // ── The migration, which is the absence ────────────────────────────────
  {
    const s = storage({ accountId: ACCOUNT, settings: { serverUrl: "https://agent.brotto.dev" }, ...flat });
    const ctx = vm.createContext(s);
    vm.runInContext(compiled, ctx);
    const read = await vm.runInContext("getStoredModelConfig()", ctx);
    check("a cloud account does not adopt the flat key left by an earlier install",
      read.api_key === null && read.model_config === null, JSON.stringify(read));
    check("…and the flat key is left exactly where it was, not moved",
      s.local.modelApiKey === "sk-local", JSON.stringify(s.local));
    await vm.runInContext('setStoredModelConfig({ model_config: { provider: "anthropic", model: "x" }, api_key: "sk-new" })', ctx);
    check("a cloud account's key lands in its own slot",
      s.local[`modelApiKey:${ACCOUNT}`] === "sk-new"
      && s.local.modelApiKey === "sk-local", JSON.stringify(Object.keys(s.local)));
  }

  // ── The panel asks the same question ───────────────────────────────────
  check("the panel and the wizard both load the shared key-naming script",
    /<script src="model_keys\.js"><\/script>/.test(
      fs.readFileSync(path.join(EXT, "sidepanel.html"), "utf8")
      + fs.readFileSync(path.join(EXT, "welcome.html"), "utf8")));
  check("the wizard writes the config and key under those keys",
    /\[keys\.config\][\s\S]*\{ provider, model, context_window: keepCtx \}/.test(
      fs.readFileSync(path.join(EXT, "welcome.js"), "utf8"))
    && /\[keys\.apiKey\]: key/.test(fs.readFileSync(path.join(EXT, "welcome.js"), "utf8")));
  check("no storage key was invented for the account-scoped pair in the panel",
    // Comments are stripped: the panel explains itself by naming the keys,
    // and a check that trips on the explanation defeats the rule it states.
    !/modelApiKey:|modelConfig:/.test(
      fs.readFileSync(path.join(EXT, "sidepanel.js"), "utf8")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/modelApiKey:\$\{accountId\}/g, "")),
    "the panel asks modelKeys() for the name; the worker copy of the table is not repeated here");

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();