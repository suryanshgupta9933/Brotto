// The credential belongs to the server that issued it.
//
// The bug this pins: `settings.agentSecret` is one slot holding two things —
// a self-hoster's `AGENT_SECRET` and, on the cloud path, a Supabase access
// token that is a real account identity — and it was attached to *whatever*
// server address the settings field held. One writer reads it as a string,
// which is right; nothing bound it to a server. So a mistyped host, an
// imported settings blob, or a colleague's self-host received the user's Brotto
// Cloud token, and the relay would honour it as that account.
//
// Both absences the previous bar could not see:
//   - there is no `agentSecretOrigin` next to it, and
//   - `authHeaders()` / `authedWs()` never asked where the value came from.
// A test that only checked "is a Bearer header produced?" passes against the
// unfixed code, because the unfixed code produces one every time.
//
// Everything under test is extracted from background.ts by brace matching and
// evalled, so it cannot drift from what ships.
//
//   node scripts/test-credential-origin.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const worker = fs.readFileSync(
  path.join(__dirname, "..", "clients", "brotto-extension", "src", "background.ts"), "utf8");

/** Brace-match one function out of background.ts and strip its TS annotations. */
function extract(name, { async: isAsync = false } = {}) {
  const re = new RegExp(
    isAsync ? `^async function ${name}\\(` : `^function ${name}\\(`,
    "m");
  const start = worker.search(re);
  if (start < 0) throw new Error(`no ${name} in background.ts — renamed?`);
  let parens = 0, bodyStart = -1;
  for (let i = worker.indexOf("(", start); i < worker.length; i++) {
    if (worker[i] === "(") parens++;
    else if (worker[i] === ")" && --parens === 0) { bodyStart = worker.indexOf("{", i); break; }
  }
  let depth = 0;
  for (let i = bodyStart; i < worker.length; i++) {
    if (worker[i] === "{") depth++;
    else if (worker[i] === "}" && --depth === 0) {
      const sig = worker.slice(start, bodyStart).replace(/\{\s*$/, "");
      return sig
        .replace(/([(,]\s*[A-Za-z_$][\w$]*)\s*:\s*[^,)]+/g, "$1")
        // Whatever is left after the parameter list is the return type, and it
        // is whatever esbuild is about to throw away anyway.
        .replace(/\)\s*:\s*[\s\S]*$/, ")") + worker.slice(bodyStart, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

/** TypeScript `as` casts, which vm cannot parse. */
function stripCasts(src) {
  return src.replace(/ as\s*\|?\s*\{(?:[^{}]|\n)*?\}\s*\|\s*undefined/g, "");
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

/** A worker whose `settings` document is whatever the test hands it. */
function workerWith(settings, url) {
  const sandbox = { URL, console, serverUrl: url };
  vm.createContext(sandbox);
  vm.runInContext(stripCasts(extract("originOf")), sandbox);
  vm.runInContext(stripCasts(extract("isLoopback")), sandbox);
  vm.runInContext(stripCasts(extract("credentialFor", { async: true })), sandbox);
  vm.runInContext(stripCasts(extract("authHeaders", { async: true })), sandbox);
  sandbox.chrome = {
    storage: { local: { get: async () => ({ settings }) } },
  };
  return sandbox;
}

const secretFor = async (settings, url) =>
  (await vm.runInContext("credentialFor", workerWith(settings, url))(url)).secret;

const refusalFor = async (settings, url) =>
  (await vm.runInContext("credentialFor", workerWith(settings, url))(url)).refusal;

(async () => {
  console.log("the credential reaches the server that issued it");

  const mine = { agentSecret: TOKEN, agentSecretOrigin: CLOUD };
  check("it rides the origin it was recorded against",
    (await secretFor(mine, CLOUD)) === TOKEN);
  check("a trailing slash on either side is not a different server",
    (await secretFor(mine, CLOUD + "/")) === TOKEN
      && (await secretFor({ ...mine, agentSecretOrigin: CLOUD + "/" }, CLOUD)) === TOKEN,
    "origin, not string — see originOf()");
  check("a path on the server URL does not change the origin either",
    (await secretFor(mine, CLOUD + "/some/path")) === TOKEN);

  console.log("\nand goes to nobody else");

  for (const other of [SOMEONE_ELSE, "https://evil.example", "https://agent.brotto.dev.evil.com",
    "http://agent.brotto.dev", "https://agent.brotto.dev:8443"]) {
    const sent = await secretFor(mine, other);
    check(`nothing is attached to ${other}`, sent === "", `leaked ${sent}`);
  }
  check("the refusal names the server it was issued for and the one asked for",
    /agent\.brotto\.dev/.test(await refusalFor(mine, "https://evil.example"))
      && /evil\.example/.test(await refusalFor(mine, "https://evil.example")),
    await refusalFor(mine, "https://evil.example"));
  check("and it tells the user what to do about it",
    /sign in again/i.test(await refusalFor(mine, "https://evil.example")));

  console.log("\nthe plaintext case, which is the one that is never fine");

  check("a self-host key reaches its own loopback server",
    (await secretFor({ agentSecret: "correct-horse" }, MYSELF)) === "correct-horse");
  check("…and 127.0.0.1 is loopback too",
    (await secretFor({ agentSecret: "k" }, "http://127.0.0.1:8000")) === "k");
  // A self-hoster on http://192.168.x.x is a supported deployment, so a
  // recorded origin is what authorises cleartext — never the address alone.
  check("cleartext to a remote host works only when that host issued it",
    (await secretFor({ agentSecret: "k", agentSecretOrigin: SOMEONE_ELSE }, SOMEONE_ELSE)) === "k");
  check("…and carries nothing when nothing says it was issued there",
    (await secretFor({ agentSecret: "k" }, SOMEONE_ELSE)) === "",
    "a bearer over cleartext is readable by anything on the path");

  console.log("\nan install written before the origin existed");

  const legacy = { agentSecret: "correct-horse-battery-staple" };
  check("…still works on loopback, which is where it always was",
    (await secretFor(legacy, MYSELF)) === "correct-horse-battery-staple");
  check("…and reaches nothing remote, because there is nothing to check it against",
    (await secretFor(legacy, SOMEONE_ELSE)) === "",
    "unknown issuer is not a permission to send it anywhere");
  check("the message says to sign in again rather than blaming the server",
    /sign in again/i.test(await refusalFor(legacy, "https://agent.brotto.dev")),
    await refusalFor(legacy, "https://agent.brotto.dev"));

  console.log("\nthe installs with no credential are untouched");

  check("no secret at all is not a refusal — 'no secret means open' is deliberate",
    (await refusalFor({}, MYSELF)) === "" && (await secretFor({}, MYSELF)) === "");
  check("an unparseable server address is refused rather than guessed at",
    (await secretFor(mine, "not a url")) === ""
      && /can't tell which server/i.test(await refusalFor(mine, "not a url")));

  console.log("\nthe header the request actually carries");

  const headersFor = async (settings, url) => {
    const sb = workerWith(settings, url);
    return vm.runInContext("authHeaders", sb)();
  };
  const good = await headersFor(mine, CLOUD);
  check("a matching origin still produces the Bearer header",
    good.Authorization === `Bearer ${TOKEN}`, JSON.stringify(good));
  const leaked = await headersFor(mine, "https://evil.example");
  check("a mismatched origin produces no Authorization header at all",
    leaked.Authorization === undefined, JSON.stringify(leaked));
  check("…which is what reaches POST /v1/sessions", true);
  check("an open self-host install sends no header, as it always did",
    JSON.stringify(await headersFor({}, MYSELF)) === "{}");

  console.log("\nthe writer records what the reader needs");

  // The guard is only reachable if something writes the origin. The wizard's
  // finish() and the panel's storeAgentSecret() are both owned by brotto-panel
  // and both already know the issuing server; without the write this whole file
  // reduces every cloud user to the legacy branch.
  const writesOrigin = (src) => /agentSecretOrigin/.test(src);
  check("the panel's cloud sign-in records the origin next to the token",
    writesOrigin(fs.readFileSync(
      path.join(__dirname, "..", "clients", "brotto-extension", "src", "sidepanel.js"), "utf8")),
    "brotto-panel: storeAgentSecret() must set agentSecretOrigin: <the server it just signed in to>");
  check("the wizard's finish() does the same",
    writesOrigin(fs.readFileSync(
      path.join(__dirname, "..", "clients", "brotto-extension", "src", "welcome.js"), "utf8")),
    "brotto-panel: finish() must set agentSecretOrigin: server");

  console.log("\nthe refusal is not retried as an outage");

  // scheduleReconnect() reads credentialRefusal. Asserted on the source rather
  // than extracted: it touches reconnectAttempt, notifyUi and a timer, and what
  // matters is the single early return.
  check("scheduleReconnect bails on a refused credential",
    /function scheduleReconnect\(\)\s*:\s*boolean \{[\s\S]{0,600}?if \(credentialRefusal\) return false;/
      .test(worker));
  check("and startRelay throws the refusal instead of opening a socket",
    /const credential = await credentialFor\(plannerUrl\);[\s\S]{0,200}?throw new Error\(credential\.refusal\);/
      .test(worker));
  check("the WebSocket is handed the resolved credential, not a fresh storage read",
    /authedWs\(wsUrl, credential\.secret\)/.test(worker));
  check("agentSecret() is gone — one reader, and it is the one that binds",
    !/function agentSecret\(/.test(worker));

  console.log(failures === 0 ? "\nall credential-origin checks passed"
    : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();