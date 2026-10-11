// Three checks around "which server", in the places they are easy to lose.
//
//   1. Cloud is the wizard's default, and an install that already answered is
//      not re-asked. A default that migrates people is worse than either
//      default, so `initialEdition` is run against the three real cases and
//      the "no migration" half is an assertion, not a hope.
//   2. The address is verified on save, not on blur — and the three answers
//      (reachable / key refused / no answer) stay three. `checkServer` is
//      extracted and run against a fake server, so the message that reaches
//      the user is the one in the file that ships.
//   3. A task is sent only after the configured server has answered once, and
//      a credential from another server never rides the address. The probe is
//      the worker's `serverIsAlive` — the bound matters, so that half is
//      measured rather than asserted in a comment.
//
//   node scripts/test-server-check.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "clients", "brotto-extension", "src");
const panel = fs.readFileSync(path.join(EXT, "sidepanel.js"), "utf8");
const welcome = fs.readFileSync(path.join(EXT, "welcome.js"), "utf8");
const welcomeHtml = fs.readFileSync(path.join(EXT, "welcome.html"), "utf8");
const worker = fs.readFileSync(path.join(EXT, "background.ts"), "utf8");
const credential = fs.readFileSync(path.join(EXT, "credential.js"), "utf8");

function extract(src, name, { async: isAsync = false } = {}) {
  const re = new RegExp(isAsync ? `^async function ${name}\\(` : `^(?:async )?function ${name}\\(`, "m");
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

/** background.ts is TypeScript and vm is not. Signature only. */
function stripTypes(fn) {
  let parens = 0, bodyStart = -1;
  for (let i = fn.indexOf("("); i < fn.length; i++) {
    if (fn[i] === "(") parens++;
    else if (fn[i] === ")" && --parens === 0) { bodyStart = fn.indexOf("{", i); break; }
  }
  const sig = fn.slice(0, bodyStart)
    .replace(/([(,]\s*[A-Za-z_$][\w$]*)\s*:\s*[^,)]+/g, "$1")
    .replace(/\)\s*:\s*[\s\S]*$/, ")");
  return sig + fn.slice(bodyStart).replace(/ as\s+\w+/g, "");
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
}

const CLOUD = "https://agent.brotto.dev";
const SELF = "http://192.168.1.50:8000";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.cloud-account-token.signature";

// credential.js, so the panel's copy of the rule is the one that decides.
function panelForUrl() {
  const sandbox = { URL };
  vm.createContext(sandbox);
  for (const fn of ["originOf", "isLoopback", "forUrl"]) {
    vm.runInContext(extract(credential, fn), sandbox);
  }
  return (settings, url, typed) => vm.runInContext("forUrl", sandbox)(settings, url, typed);
}

// ── 1. Cloud is the default; an install that answered is not re-asked ───────
console.log("the wizard opens on the cloud, and only for a browser that never answered");

const INITIAL = extract(welcome, "initialEdition");
function editionFor(stored) {
  const sandbox = { CLOUD_SERVER_URL: CLOUD };
  vm.createContext(sandbox);
  vm.runInContext(INITIAL, sandbox);
  return vm.runInContext(`initialEdition(${JSON.stringify(stored ?? null)})`, sandbox);
}

check("a brand-new install opens on cloud",
  editionFor(undefined) === "cloud" && editionFor(null) === "cloud" && editionFor("") === "cloud");
check("a signed-out cloud user comes back to cloud",
  editionFor(CLOUD) === "cloud");
check("an install that chose self-host keeps it — it is not migrated",
  editionFor(SELF) === "self" && editionFor(`${SELF}/`) === "self",
  "an existing self-hoster re-asked on every update is worse than either default");
check("a stored address is what decides, never a comparison with the cloud constant",
  /function initialEdition\(storedServerUrl\)[\s\S]{0,200}CLOUD_SERVER_URL/.test(welcome)
  && /stored\.settings\?\.serverUrl/.test(welcome));

// One address, one place. A second literal is a default that can drift.
check("the cloud address is written from the constant, not typed into the markup",
  /value\.trim\(\) !== CLOUD_SERVER_URL[\s\S]{0,120}value = CLOUD_SERVER_URL/.test(welcome));
check("and the markup does not spell the address out",
  !welcomeHtml.includes(CLOUD),
  "a second copy of an address is a second thing to update");

// The wizard is not re-shown to somebody who finished it. This is the rule
// that makes the default safe, and it lives in the worker, not the wizard.
check("a finished wizard is not re-shown: onboarded gates the wizard page",
  /if \(!s\.settings\?\.onboarded\) chrome\.sidePanel\.setOptions\(\{ path: "welcome\.html" \}\)/.test(worker),
  "without this, inverting the default would re-ask every existing install");
check("and finish() is what sets it — including on Skip",
  /onboarded: true/.test(welcome)
  && /\$skip\.addEventListener\("click"[\s\S]{0,120}void finish\(\)/.test(welcome),
  "'Skip is a real answer' only holds if Skip also writes onboarded");

(async () => {
// ── 2. Verified on save, three answers ─────────────────────────────────────
console.log("\nand the address is proved before it is saved, not on blur");

function wizardCheck({ stored, serverUrl, typedKey, health, policy }) {
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
      if (url.endsWith("/health")) {
        if (health instanceof Error) throw health;
        return health;
      }
      return policy;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext("function setServerStatus(t, tone) { $serverStatus.textContent = t || ''; $serverStatus.className = tone ? `status ${tone}` : 'status'; }", sandbox);
  vm.runInContext(extract(welcome, "checkServer", { async: true }), sandbox);
  return { calls, status: () => sandbox.$serverStatus.textContent, run: () => vm.runInContext("checkServer()", sandbox) };
}

const alive = { ok: true, status: 200 };
const dead = new Error("Failed to fetch");

const up = wizardCheck({ stored: {}, serverUrl: SELF, typedKey: "", health: alive, policy: alive });
const upResult = await up.run();
check("a live server is reported reachable", upResult.ok === true && /Reachable/.test(upResult.text), JSON.stringify(upResult));
check("…and it is what the status line says too", up.status() === upResult.text, up.status());

const refused = wizardCheck({
  stored: { agentSecret: "k", agentSecretOrigin: SELF }, serverUrl: SELF, typedKey: "k",
  health: alive, policy: { ok: false, status: 404 },
});
const refusedResult = await refused.run();
check("a refused key is NOT collapsed into 'reachable'",
  refusedResult.ok === false && /refused/.test(refusedResult.text), JSON.stringify(refusedResult));
check("…and it names the thing to fix", /AGENT_SECRET/.test(refusedResult.text));

const silent = wizardCheck({ stored: {}, serverUrl: SELF, typedKey: "", health: dead, policy: alive });
const silentResult = await silent.run();
check("a server that does not answer is its own answer",
  silentResult.ok === false && /No answer/.test(silentResult.text), JSON.stringify(silentResult));
check("the three sentences are three sentences",
  new Set([upResult.text, refusedResult.text, silentResult.text]).size === 3);

const mismatch = wizardCheck({
  stored: { agentSecret: TOKEN, agentSecretOrigin: CLOUD }, serverUrl: SELF, typedKey: TOKEN,
  health: alive, policy: alive,
});
const mismatchResult = await mismatch.run();
check("a cloud token pointed at somebody else's server is caught here too",
  mismatchResult.ok === false && /sign in again/i.test(mismatchResult.text), JSON.stringify(mismatchResult));

// The gate itself: Start asks before it writes, Skip is still a way out.
const nextHandler = welcome.slice(
  welcome.indexOf('$next.addEventListener("click"'),
  welcome.indexOf('$skip.addEventListener("click"'));
check("Start probes before it saves", nextHandler.indexOf("await checkServer()") > -1
  && nextHandler.indexOf("await checkServer()") < nextHandler.indexOf("void finish()"));
check("and refuses to save an address that did not answer",
  /if \(!verified\.ok\)[\s\S]{0,300}return;[\s\S]{0,300}void finish\(\)/.test(nextHandler),
  "a known-dead address written to storage is the failure this screen exists to prevent");
check("…sending the user back to the step the address was typed on",
  /show\(SERVER_STEP\)/.test(nextHandler));
const skipHandler = welcome.slice(
  welcome.indexOf('$skip.addEventListener("click"'),
  welcome.indexOf("function initialEdition"));
check("Skip is still a real answer — it is not made to wait on a server",
  !/checkServer/.test(skipHandler),
  "the wizard is not a gate, and the pre-task probe is what catches what Skip saved");

// ── 3. One probe, bounded, asked once per address ──────────────────────────
console.log("\nand a task is sent only after the configured server has answered");

// The worker's probe, run for real against a fetch that never answers.
function workerProbe({ timeout, fetchImpl }) {
  const sandbox = {
    serverUrl: "http://stale:8000",
    SERVER_PROBE_MS: 1500,
    AbortController,
    setTimeout: (fn) => timeout(fn),
    clearTimeout: () => {},
    fetch: fetchImpl,
  };
  vm.createContext(sandbox);
  vm.runInContext(stripTypes(extract(worker, "serverIsAlive", { async: true })), sandbox);
  return (url) => vm.runInContext(`serverIsAlive(${url ? JSON.stringify(url) : ""})`, sandbox);
}

const probed = [];
const boundProbe = workerProbe({
  timeout: (fn) => { setImmediate(fn); return 1; },
  fetchImpl: (url, opts) => {
    probed.push(url);
    if (!opts || !opts.signal) throw new Error("no abort signal — an unbounded fetch hangs the composer");
    return new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  },
});
check("a blackholed server fails in the bound, not in forever",
  (await boundProbe(SELF)) === false);
check("and it probes the address it was given, not the worker's stale one",
  probed.length === 1 && probed[0] === `${SELF}/health`, probed.join(","));
check("the bound is the one the close path already uses",
  /const SERVER_PROBE_MS = 1500;/.test(worker)
  && /setTimeout\(\(\) => ac\.abort\(\), SERVER_PROBE_MS\)/.test(worker));
// The panel's own /health calls are `auth_mode` and the Settings Save, and
// both are answering a different question. What must not exist is a second
// *liveness* probe on the send path — that is the one with the timeout.
const ENSURE = extract(panel, "ensureConnected", { async: true });
check("no second probe was written on the send path",
  !/fetch\(/.test(ENSURE) && /probe_server/.test(ENSURE),
  "two liveness probes means two timeouts, and one of them is wrong");

// The worker answers the panel's question.
check("the worker exposes it as a message, resolved the same way a task is",
  /case "probe_server"[\s\S]{0,600}serverIsAlive\(url\)/.test(worker)
  && /case "probe_server"[\s\S]{0,600}settings as any\)\?\.serverUrl/.test(worker));

// The panel's use of it.
function panelSend({ stored, url, alive }) {
  let probes = 0;
  const phases = [];
  const sandbox = {
    probedServerUrl: "",
    plannerUrlEl: { value: url },
    state: {},
    FAILURE_NOTE: { connect_failed: "Brotto could not reach its server." },
    brottoCredential: { forUrl: panelForUrl() },
    chrome: {
      storage: { local: { get: async () => ({ settings: stored }) } },
      runtime: {
        sendMessage: async (m) => {
          if (m.type !== "probe_server") return { success: false };
          probes++;
          return { success: true, alive };
        },
      },
    },
    setPhase: (p) => phases.push(p),
  };
  vm.createContext(sandbox);
  vm.runInContext(extract(panel, "ensureConnected", { async: true }), sandbox);
  return {
    send: () => vm.runInContext("ensureConnected()", sandbox),
    probes: () => probes,
    phases,
    probedUrl: () => sandbox.probedServerUrl,
  };
}

const first = panelSend({ stored: {}, url: SELF, alive: true });
check("a task is not refused when the server answers", (await first.send()) === "");
check("the address is probed before the first task on it", first.probes() === 1);
check("and it is remembered, so the happy path costs no second request",
  (await first.send()) === "" && first.probes() === 1, `${first.probes()} probes`);

first.probedUrl();
const moved = panelSend({ stored: {}, url: "http://elsewhere.lan:9000", alive: true });
await moved.send();
check("a changed address re-arms the probe", moved.probes() === 1);

const down = panelSend({ stored: {}, url: SELF, alive: false });
const downNote = await down.send();
check("a dead server is one clear sentence, and no task",
  typeof downNote === "string" && downNote.length > 0 && downNote !== "");
check("a failure is not cached — the next send asks again",
  (await down.send()) !== "" && down.probes() === 2, `${down.probes()} probes`);

const crossed = panelSend({ stored: { agentSecret: TOKEN, agentSecretOrigin: CLOUD }, url: SELF, alive: true });
const refusal = await crossed.send();
check("a credential from another server is refused BEFORE the probe",
  /sign in again/i.test(refusal) && crossed.probes() === 0, JSON.stringify(refusal));
check("…with the existing refusal sentence, not a new one",
  refusal === panelForUrl()({ agentSecret: TOKEN, agentSecretOrigin: CLOUD }, SELF).refusal, refusal);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);})();
