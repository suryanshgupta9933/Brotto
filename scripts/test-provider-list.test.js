// The provider list on the wizard's last step.
//
// It was empty on every install, and nothing in the diff said so: the code
// read
//
//     catalog = brottoModelCatalog.load(...);
//     catalog.then(populateProviders);
//
// and `populateProviders` walked `catalog.providers` — which is `undefined`
// on a *Promise*. `load()` resolved, the callback ran, and it wrote zero
// options into a select. The datalist went the same way, and `finish()`
// resolved the context window against the same undefined, so a saved model
// config carried the 128000 fallback whatever the server had said.
//
// Two more things were wrong underneath it and both are silent:
//
//   1. The load ran at module scope, before the IIFE at the bottom of the
//      file had pre-filled the address from storage — so it asked
//      `http://localhost:8000` on every install, including the ones whose
//      server was somewhere else entirely.
//   2. `load()` cannot reject; it falls back to the cache and then to a
//      built-in list. So the state a bare `<select>` could not express was
//      never "failed" but "offline", and offline rendered as an empty box
//      that looked exactly like still loading, forever.
//
// So this file asserts the assignment (the catalogue is the catalogue, not
// the promise), the address (the one the field holds, at the time of the
// fetch), and the three states a control has to be able to draw.
//
//   node scripts/test-provider-list.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "clients", "brotto-extension", "src");
const welcome = fs.readFileSync(path.join(EXT, "welcome.js"), "utf8");
const welcomeHtml = fs.readFileSync(path.join(EXT, "welcome.html"), "utf8");

function extract(src, name) {
  const start = src.search(new RegExp(`^(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} — renamed?`);
  let parens = 0;
  let bodyStart = -1;
  for (let i = src.indexOf("(", start); i < src.length; i++) {
    if (src[i] === "(") parens++;
    else if (src[i] === ")" && --parens === 0) { bodyStart = src.indexOf("{", i); break; }
  }
  if (bodyStart < 0) throw new Error(`no body for ${name}`);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
}

/** The functions that draw the control, plus the little DOM they use. */
function rig({ serverUrl, catalogue }) {
  const select = { value: "", disabled: false, textContent: "", options: [], appendChild(o) { this.options.push(o); } };
  const trigger = { disabled: false };
  const status = { textContent: "", className: "" };
  const retry = { hidden: false };
  const asked = [];
  const sandbox = {
    $serverUrl: { value: serverUrl },
    $provider: select,
    $providerTrigger: trigger,
    $providerStatus: status,
    $providerRetryBtn: retry,
    $model: { value: "" },
    // The shared dropdown is a separate file; this test is about the list,
    // not the open/close, so a sync stub is enough and still catches the
    // "trigger left live over an empty host" case via setProviderDisabled.
    providerDd: { sync() {} },
    DEFAULT_SERVER: "http://localhost:8000",
    catalog: null,
    catalogBase: "",
    document: {
      activeElement: null,
      getElementById: (id) => (id === "model-options" ? (sandbox.modelOptions = { textContent: "", options: [], appendChild(o) { this.options.push(o); } }) : null),
      createElement: () => ({ value: "", textContent: "" }),
    },
    brottoModelCatalog: {
      load: async (base) => { asked.push(base); return typeof catalogue === "function" ? catalogue() : catalogue; },
      provider: (list, id) => ((list && list.providers) || []).find((p) => p.id === id) || null,
    },
  };
  vm.createContext(sandbox);
  for (const fn of ["setProviderStatus", "setProviderDisabled", "loadCatalog", "renderProviders", "populateModels"]) {
    vm.runInContext(extract(welcome, fn), sandbox);
  }
  return {
    sandbox,
    asked,
    select,
    trigger,
    status,
    retry,
    labels: () => select.options.map((o) => o.textContent),
    run: () => vm.runInContext("loadCatalog()", sandbox),
  };
}

const CATALOGUE = {
  offline: false,
  providers: [
    { id: 'anthropic', label: 'Anthropic', models: [{ id: 'claude-sonnet-5-5', context_window: 1000000 }] },
    { id: 'openai', label: 'OpenAI', models: [{ id: 'gpt-6.1-sol', context_window: 1050000 }] },
  ],
};

(async () => {
  // ── The assignment ───────────────────────────────────────────────────────
  const live = rig({ serverUrl: "https://agent.brotto.dev", catalogue: CATALOGUE });
  await live.run();
  check("the select is filled from the catalogue that came back",
    live.labels().join(",") === "Anthropic,OpenAI", live.labels().join(","));
  check("and it is usable, not a disabled placeholder",
    live.select.disabled === false && live.trigger.disabled === false);
  check("nothing is left saying it is loading", live.status.textContent === "", live.status.textContent);
  check("and no retry is offered when there was nothing to recover from", live.retry.hidden === true);

  // The bug, restated as the thing that must not come back. A promise has no
  // `providers`, so this assertion is the one that fails on the old file.
  check("`catalog` holds the catalogue and not the promise",
    vm.runInContext("Array.isArray(catalog.providers)", live.sandbox) === true,
    "a Promise has no .providers, and populateProviders then writes nothing at all");
  // The same `undefined` reached `finish()`, so every saved model config
  // carried the smallest-known-window fallback whatever the server said.
  check("…and `finish()` resolves a context window against the same thing",
    /contextWindow\(catalog, provider, model\)/.test(welcome)
    && vm.runInContext("catalog.providers.length", live.sandbox) === 2);

  // ── The address ──────────────────────────────────────────────────────────
  check("it asks the address the field holds, not localhost",
    live.asked.length === 1 && live.asked[0] === "https://agent.brotto.dev", live.asked.join(","));
  const blank = rig({ serverUrl: "", catalogue: CATALOGUE });
  await blank.run();
  check("a blank field still resolves to the documented default",
    blank.asked.length === 1 && blank.asked[0] === "http://localhost:8000", blank.asked.join(","));
  // The ordering is the defect: a module-scope load read an empty field, so
  // every install asked localhost whatever the user had chosen.
  const loadSite = welcome.slice(
    welcome.indexOf("async function loadCatalog"),
    welcome.indexOf("function renderProviders"));
  check("the address is read inside the load, not passed to it",
    /const base = \$serverUrl\.value\.trim\(\) \|\| DEFAULT_SERVER;/.test(loadSite)
      && /brottoModelCatalog\.load\(base\)/.test(loadSite));
  check("and the load is not run at module scope any more",
    !/^catalog = brottoModelCatalog\.load\(/m.test(welcome),
    "module scope runs before the IIFE pre-fills the field from storage");
  check("…it is called after the pre-fill instead",
    /applyEdition\(\);[\s\S]{0,320}await loadCatalog\(\)/.test(welcome));
  check("and it is re-run if the address moved before the last step",
    /if \(n === TOTAL_STEPS\)[\s\S]{0,200}loadCatalog\(\)/.test(welcome));

  // ── The three states ─────────────────────────────────────────────────────
  const offline = rig({ serverUrl: "http://10.0.0.5:8000", catalogue: { offline: true, providers: CATALOGUE.providers } });
  await offline.run();
  check("a list that came from the built-in copy says so",
    /couldn'?t reach your server/i.test(offline.status.textContent), offline.status.textContent);
  check("…and is marked bad rather than shown as a normal answer",
    /bad/.test(offline.status.className), offline.status.className);
  check("…and offers a way to try again", offline.retry.hidden === false);
  check("but the list itself is still usable",
    offline.select.disabled === false && offline.trigger.disabled === false && offline.labels().length === 2);

  const empty = rig({ serverUrl: "http://10.0.0.5:8000", catalogue: { offline: false, providers: [] } });
  await empty.run();
  check("an empty list is its own sentence, not silence",
    /came back empty/i.test(empty.status.textContent), empty.status.textContent);
  check("…says the reason rather than an empty control alone",
    /server/.test(empty.status.textContent), empty.status.textContent);
  check("…offers a retry", empty.retry.hidden === false);
  check("…and leaves the control disabled, because there is nothing to pick",
    empty.select.disabled === true && empty.trigger.disabled === true);

  const before = rig({ serverUrl: "http://x", catalogue: CATALOGUE });
  check("and the retry button is wired to another load",
    /\$providerRetryBtn\.addEventListener\("click", \(\) => \{ void loadCatalog\(\); \}\)/.test(welcome));
  check("the markup starts in the loading state, disabled",
    /id="provider" class="dd-native"[^>]*disabled/.test(welcomeHtml)
      && /id="providerTrigger"[^>]*disabled/.test(welcomeHtml)
      && /<option value="" selected>Loading models…<\/option>/.test(welcomeHtml));
  check("and it is the same dropdown component Settings uses",
    /id="providerDd"/.test(welcomeHtml) && /id="providerList" class="dd-list"/.test(welcomeHtml)
      && /attachDropdown/.test(welcome));
  check("and there is somewhere for the reason to be drawn",
    /id="providerStatus"/.test(welcomeHtml) && /id="providerRetryBtn"/.test(welcomeHtml));
  void before;

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();