// The panel's half of the credential-origin bind.
//
// `settings.agentSecret` holds a self-hoster's AGENT_SECRET and, on the cloud
// path, a Supabase access token that is a real account identity — one slot, one
// `Bearer` header, one reader. background.ts binds it to the origin that
// issued it; scripts/test-credential-origin.test.js pins that side. This file
// pins the panel's, which is two surfaces it does not own:
//
//   - sidepanel.js `authHeaders()` sends the slot to `serverBase()`, an address
//     the user typed, on eleven call sites (history, delete, audit, policy,
//     suggestions). It has to ask the same question the worker does.
//   - welcome.js `checkServer()` sends the same value to the same user-typed
//     address, and the wizard *pre-fills* it from storage — so the key in that
//     field can be a cloud token the user never typed here.
//
// And the third thing this file exists for: credential.js and background.ts
// hold two copies of one rule, because the worker is a TS bundle and the panel
// is a plain script. Two copies drift. So both are extracted and run against
// one table here, and the first answer that differs fails the file.
//
//   node scripts/test-panel-credential.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXT = path.join(__dirname, "..", "clients", "brotto-extension", "src");
const panel = fs.readFileSync(path.join(EXT, "sidepanel.js"), "utf8");
const welcome = fs.readFileSync(path.join(EXT, "welcome.js"), "utf8");
const credential = fs.readFileSync(path.join(EXT, "credential.js"), "utf8");
const worker = fs.readFileSync(path.join(EXT, "background.ts"), "utf8");

/** Brace-match one top-level function out of a source file. */
function extract(src, name, { async: isAsync = false } = {}) {
  const re = new RegExp(
    isAsync ? `^async function ${name}\\(` : `^(?:async )?function ${name}\\(`,
    "m");
  const start = src.search(re);
  if (start < 0) throw new Error(`no function ${name} — renamed?`);
  let parens = 0, bodyStart = -1;
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

/** background.ts's TypeScript annotations, which vm cannot parse.
 *
 * Stripped from the signature only: the return type runs to the end of the
 * signature, and a greedy body-side strip takes the function with it.
 */
function stripTypes(fn) {
  let parens = 0, bodyStart = -1;
  for (let i = fn.indexOf("("); i < fn.length; i++) {
    if (fn[i] === "(") parens++;
    else if (fn[i] === ")" && --parens === 0) { bodyStart = fn.indexOf("{", i); break; }
  }
  const sig = fn.slice(0, bodyStart)
    .replace(/([(,]\s*[A-Za-z_$][\w$]*)\s*:\s*[^,)]+/g, "$1")
    .replace(/\)\s*:\s*[\s\S]*$/, ")");
  const body = fn.slice(bodyStart)
    .replace(/ as\s*\|?\s*\{(?:[^{}]|\n)*?\}\s*\|\s*undefined/g, "")
    .replace(/ as \w+/g, "");
  return sig + body;
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
}

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.cloud-account-token.signature";
const CLOUD = "https://agent.brotto.dev";
const MYSELF = "http://localhost:8000";
const SOMEONE_ELSE = "http://192.168.1.50:8000";

/** credential.js's `forUrl`, in a sandbox of its own. */
function panelForUrl() {
  const sandbox = { URL };
  vm.createContext(sandbox);
  for (const fn of ["originOf", "isLoopback", "forUrl"]) {
    vm.runInContext(extract(credential, fn), sandbox);
  }
  return (settings, url, typed) => vm.runInContext("forUrl", sandbox)(settings, url, typed);
}

/** background.ts's `credentialFor`, reading the same settings. */
function workerFor(settings) {
  const sandbox = { URL, console };
  sandbox.chrome = { storage: { local: { get: async () => ({ settings }) } } };
  vm.createContext(sandbox);
  for (const fn of ["originOf", "isLoopback"]) {
    vm.runInContext(stripTypes(extract(worker, fn)), sandbox);
  }
  vm.runInContext(stripTypes(extract(worker, "credentialFor", { async: true })), sandbox);
  return (url) => vm.runInContext("credentialFor", sandbox)(url);
}

/** sidepanel.js `authHeaders()`, with the storage and address it reads. */
function panelAuthHeaders(settings, base) {
  const toasts = [];
  const sandbox = {
    brottoCredential: { forUrl: panelForUrl() },
    chrome: { storage: { local: { get: async () => ({ settings }) } } },
    serverBase: () => base,
    toast: (text, kind) => toasts.push({ text, kind }),
    lastCredentialRefusal: "",
  };
  vm.createContext(sandbox);
  vm.runInContext(extract(panel, "authHeaders", { async: true }), sandbox);
  return { headers: () => vm.runInContext("authHeaders()", sandbox), toasts };
}

/** welcome.js `checkServer()`, against a fetch that records what it was sent. */
function wizardCheckServer({ stored, serverUrl, typedKey, respond }) {
  const calls = [];
  const sandbox = {
    brottoCredential: { forUrl: panelForUrl() },
    DEFAULT_SERVER: "http://localhost:8000",
    $serverUrl: { value: serverUrl },
    $agentSecret: { value: typedKey },
    $serverStatus: { textContent: "", className: "status" },
    chrome: { storage: { local: { get: async () => ({ settings: stored }) } } },
    fetch: async (url, opts) => {
      calls.push({ url, headers: opts.headers });
      return respond(url);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(extract(welcome, "checkServer", { async: true }), sandbox);
  return {
    calls,
    status: () => sandbox.$serverStatus.textContent,
    run: () => vm.runInContext("checkServer()", sandbox),
  };
}

const alive = async () => ({ ok: true, status: 200 });

(async () => {
  // ── One rule, two copies ────────────────────────────────────────────────
  console.log("credential.js and background.ts answer the same question");

  const TABLE = [
    ["matching cloud origin", { agentSecret: TOKEN, agentSecretOrigin: CLOUD }, CLOUD],
    ["trailing slash either side", { agentSecret: TOKEN, agentSecretOrigin: CLOUD + "/" }, CLOUD + "/"],
    ["a path on the address", { agentSecret: TOKEN, agentSecretOrigin: CLOUD }, CLOUD + "/some/path"],
    ["a colleague's self-host", { agentSecret: TOKEN, agentSecretOrigin: CLOUD }, SOMEONE_ELSE],
    ["a lookalike host", { agentSecret: TOKEN, agentSecretOrigin: CLOUD }, "https://agent.brotto.dev.evil.com"],
    ["the same host, downgraded", { agentSecret: TOKEN, agentSecretOrigin: CLOUD }, "http://agent.brotto.dev"],
    ["legacy, loopback", { agentSecret: "k" }, MYSELF],
    ["legacy, remote", { agentSecret: "k" }, SOMEONE_ELSE],
    ["cleartext to the issuer", { agentSecret: "k", agentSecretOrigin: SOMEONE_ELSE }, SOMEONE_ELSE],
    ["no credential at all", {}, MYSELF],
    ["an unparseable address", { agentSecret: TOKEN, agentSecretOrigin: CLOUD }, "not a url"],
  ];
  for (const [name, settings, url] of TABLE) {
    const mine = panelForUrl()(settings, url);
    const theirs = await workerFor(settings)(url);
    check(`both copies agree: ${name}`,
      mine.secret === theirs.secret && mine.refusal === theirs.refusal,
      `panel ${JSON.stringify(mine)}\n     worker ${JSON.stringify(theirs)}`);
  }

  // ── The panel's forwarding sites ────────────────────────────────────────
  console.log("\nand the panel's own readers ask before they send");

  const good = panelAuthHeaders({ agentSecret: TOKEN, agentSecretOrigin: CLOUD }, CLOUD);
  const goodHeaders = await good.headers();
  check("the panel still sends a credential its server issued",
    goodHeaders.Authorization === `Bearer ${TOKEN}`, JSON.stringify(goodHeaders));

  const bad = panelAuthHeaders({ agentSecret: TOKEN, agentSecretOrigin: CLOUD }, "https://evil.example");
  const badHeaders = await bad.headers();
  check("…and sends nothing to a server that did not",
    badHeaders.Authorization === undefined, JSON.stringify(badHeaders));
  check("a dropped header is not left to read as an outage",
    /sign in again/i.test(bad.toasts[0] && bad.toasts[0].text), JSON.stringify(bad.toasts));

  // The wizard pre-fills the stored credential into the field the user is
  // about to be asked about, so the key in it may not be theirs.
  const leaked = wizardCheckServer({
    stored: { agentSecret: TOKEN, agentSecretOrigin: CLOUD },
    serverUrl: SOMEONE_ELSE,
    typedKey: TOKEN,
    respond: alive,
  });
  await leaked.run();
  check("the wizard does not hand a cloud token to a typed address",
    leaked.calls.every((c) => !c.headers || !c.headers.Authorization),
    JSON.stringify(leaked.calls));
  check("…and says why, in the status line",
    /sign in again/i.test(leaked.status()), leaked.status());

  const mineWizard = wizardCheckServer({
    stored: { agentSecret: "self-hosted-key", agentSecretOrigin: SOMEONE_ELSE },
    serverUrl: SOMEONE_ELSE,
    typedKey: "self-hosted-key",
    respond: alive,
  });
  await mineWizard.run();
  check("a self-hoster's own key still reaches their own server",
    mineWizard.calls.some((c) => c.headers && c.headers.Authorization === "Bearer self-hosted-key"),
    JSON.stringify(mineWizard.calls));

  const typed = wizardCheckServer({
    stored: { agentSecret: TOKEN, agentSecretOrigin: CLOUD },
    serverUrl: SOMEONE_ELSE,
    typedKey: "a-key-they-just-typed",
    respond: alive,
  });
  await typed.run();
  check("a key typed on this screen is not a credential from elsewhere",
    typed.calls.some((c) => c.headers && c.headers.Authorization === "Bearer a-key-they-just-typed"),
    JSON.stringify(typed.calls));

  // ── The writers, so the guard is reachable at all ───────────────────────
  console.log("\nand every writer records the origin the reader needs");

  const stored = { approved_domains: ['example.com'] };
  const writerSandbox = {
    chrome: {
      storage: {
        local: {
          get: async () => ({ settings: stored }),
          set: async (o) => Object.assign(stored, o.settings),
        },
      },
    },
    serverBase: () => CLOUD,
    agentSecretSetting: null,
    TOKEN,
  };
  vm.createContext(writerSandbox);
  vm.runInContext(extract(panel, "storeAgentSecret", { async: true }), writerSandbox);
  await vm.runInContext("storeAgentSecret(TOKEN)", writerSandbox);
  check("the panel's cloud sign-in records the server it signed in to",
    stored.agentSecretOrigin === CLOUD, JSON.stringify(stored));
  check("and keeps the fields written elsewhere — the spread is the point",
    JSON.stringify(stored.approved_domains) === '["example.com"]', JSON.stringify(stored));

  // `finish()` writes two storage areas and calls chrome.sidePanel, so it is
  // asserted where the shape lives: the object literal it saves.
  check("the wizard's finish() records the server it signed in to",
    /agentSecret:\s*\$agentSecret\.value\.trim\(\),[\s\S]{0,400}?agentSecretOrigin:\s*server,/.test(welcome),
    "finish() must save agentSecretOrigin: server");

  // Settings Save replaces `settings` wholesale, so an origin it omits is a
  // credential the service worker refuses everywhere — including for the user
  // who just pressed Save.
  const saveHandler = panel.slice(panel.indexOf("if (saveSettingsBtn)"));
  check("Settings Save records the origin too, rather than dropping it",
    /agentSecretOrigin:\s*serverUrl/.test(saveHandler),
    "settings is replaced wholesale; the origin has to be in the new object");

  // ── The one-way server address ──────────────────────────────────────────
  console.log("\nand the cloud address is still one-way in, not out");

  const wizardSandbox = {
    CLOUD_SERVER_URL: CLOUD,
    CLOUD_HINT: "cloud", SELF_HOST_HINT: "self",
    selfHostServerUrl: "",
    edition: () => wizardSandbox.$editionCloud.checked ? "cloud" : "self",
    setCloudStatus() {},
    $editionCloud: { checked: false },
    $selfHostFields: { hidden: false },
    $cloudFields: { hidden: true },
    $serverUrl: { value: "http://myserver.lan:8000", readOnly: false, classList: { toggle() {} } },
    $serverUrlHint: { textContent: "" },
    $serverStatus: { textContent: "", className: "status" },
  };
  vm.createContext(wizardSandbox);
  vm.runInContext(extract(welcome, "applyEdition"), wizardSandbox);
  const apply = () => vm.runInContext("applyEdition()", wizardSandbox);
  apply();
  wizardSandbox.$editionCloud.checked = true;
  apply();
  check("choosing cloud puts the cloud address in the field",
    wizardSandbox.$serverUrl.value === CLOUD, wizardSandbox.$serverUrl.value);
  wizardSandbox.$editionCloud.checked = false;
  apply();
  check("and choosing self-host back gives the user's own address, not the cloud one",
    wizardSandbox.$serverUrl.value === "http://myserver.lan:8000", wizardSandbox.$serverUrl.value);

  wizardSandbox.$serverUrl.value = "http://elsewhere.lan:9000";
  wizardSandbox.$editionCloud.checked = true;
  apply();
  wizardSandbox.$editionCloud.checked = false;
  apply();
  check("an address typed while self-host is the one that comes back",
    wizardSandbox.$serverUrl.value === "http://elsewhere.lan:9000", wizardSandbox.$serverUrl.value);

  console.log(failures === 0 ? "\nall panel-credential checks passed"
    : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();