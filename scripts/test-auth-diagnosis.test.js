// A wrong AGENT_SECRET must not read as a server that is not running.
//
// This server answers a refused credential with **404, not 403** — 403 would
// confirm the route is worth probing — so on its own the status is
// indistinguishable from "no such endpoint". The extension turned that into
// three "Server unreachable" toasts and a final "Is the server running?",
// which sends a self-hoster to debug the machine that is working perfectly.
//
// The separator is `/health`: unauthenticated by design (the Docker
// healthcheck needs it), so it answers when the server is up and throws when
// it is not. An authenticated 404 plus a live /health means the key.
//
// The classifier is extracted from background.ts by brace matching, so this
// cannot pass while the shipping copy is broken.
//
//   node scripts/test-auth-diagnosis.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const worker = fs.readFileSync(
  path.join(ROOT, "clients", "brotto-extension", "src", "background.ts"), "utf8");
const panel = fs.readFileSync(
  path.join(ROOT, "clients", "brotto-extension", "src", "sidepanel.js"), "utf8");
const welcome = fs.readFileSync(
  path.join(ROOT, "clients", "brotto-extension", "src", "welcome.js"), "utf8");
const main = fs.readFileSync(
  path.join(ROOT, "services", "brotto-orchestrator", "src", "brotto_orchestrator", "main.py"),
  "utf8");

function extract(src, name) {
  const start = src.search(new RegExp(`^(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} — renamed?`);
  let parens = 0;
  let bodyStart = -1;
  for (let i = src.indexOf("(", start); i < src.length; i++) {
    if (src[i] === "(") parens++;
    else if (src[i] === ")" && --parens === 0) { bodyStart = src.indexOf("{", i); break; }
  }
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      // background.ts is TypeScript: drop the return-type annotation so the
      // rest evals as the JavaScript it compiles to.
      const sig = src.slice(start, bodyStart).replace(/\)\s*:\s*[\w<>[\]| ]+$/, ")");
      return sig + src.slice(bodyStart, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
}

// ── The classifier, run against both servers ───────────────────────────────
const SRC = extract(worker, "describeAuthFailure");

/** @param healthStatus null = /health threw (no server); 200 = server is up. */
async function classify(healthStatus) {
  const calls = [];
  const sandbox = {
    serverUrl: "http://localhost:8000",
    fetch: async (url) => {
      calls.push(url);
      if (!url.endsWith("/health")) return { ok: true, status: 200 };
      if (healthStatus === null) throw new Error("Failed to fetch");
      return { ok: healthStatus < 400, status: healthStatus };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { calls, verdict: await sandbox.describeAuthFailure() };
}

(async () => {
  const dead = await classify(null);
  check("a server that is not there is named as unreachable",
    /can't reach/i.test(dead.verdict), dead.verdict);
  check("and not sent to check a key that was never the problem",
    !dead.verdict.includes("AGENT_SECRET"), dead.verdict);

  const sick = await classify(503);
  check("a server that answers /health badly is still 'unreachable'",
    /can't reach/i.test(sick.verdict), sick.verdict);

  const wrongKey = await classify(200);
  check("a live server behind a 404 is named as a refused key",
    /AGENT_SECRET/.test(wrongKey.verdict), wrongKey.verdict);
  check("the sentence says the server DID answer",
    /answered/i.test(wrongKey.verdict), wrongKey.verdict);
  check("it names the file the key actually lives in",
    /docker-compose\.yml/.test(wrongKey.verdict), wrongKey.verdict);

  // The whole diagnosis rests on /health being unauthenticated. If a future
  // change gates it, the probe refuses itself and every key reads as
  // unreachable again — the exact symptom this file exists for.
  const health = /@app\.get\("\/health"\)/.exec(main) || /def health\(/.exec(main);
  check("/health is still reachable without the secret", !!health,
    "no /health route in main.py — the classifier has nothing to separate on");
  check("and auth is not applied to it",
    !/\/health[\s\S]{0,200}require_secret/.test(main),
    "if /health now needs the key, a wrong key reads as unreachable again");

  // ── The retry that used to be spent on a wrong key ─────────────────────
  const create = /for \(let attempt = 1; attempt <= SESSION_ATTEMPTS[\s\S]*?\n      \}/.exec(worker);
  check("the session-create loop is findable", !!create);
  if (create) {
    const body = create[0];
    check("a 404 is not retried",
      /resp\.status === 404[\s\S]*?break;/.test(body),
      "three identical attempts, and three 'server unreachable' toasts, for a key that was never going to work");
    check("the 404 branch carries the diagnosis into the thrown error",
      /giveUp = await describeAuthFailure\(\)/.test(body),
      "the loop's own message says 'is the server running?', which is what the user then reads");
  }
  check("and the diagnosis outranks the loop's own message",
    /throw new Error\(giveUp \|\|/.test(worker),
    "an empty giveUp is right for a real network failure, wrong for a refused key");

  // ── The panel's Settings save ──────────────────────────────────────────
  // A separate bundle, so the same one-request trick is written out again.
  // Both copies must name the key, or the user fixes one screen and not the
  // other.
  check("the settings save distinguishes a refused key from an absent server",
    /r\.status === 404[\s\S]{0,400}rejected AGENT_SECRET/.test(panel),
    "the Save button says 'server unreachable' for a key the server refused");
  check("and reaches for /health to tell them apart",
    /r\.status === 404[\s\S]{0,400}\/health/.test(panel));
  // Opening the panel probes /health, which is unauthenticated — so with a
  // wrong key the pill goes green and the user finds out on their first task.
  check("the panel says so on open, not only on the first task",
    /authed\.status === 404[\s\S]{0,400}AGENT_SECRET/.test(panel),
    "a green pill on a server that refuses every call the extension makes");

  // ── The wizard ─────────────────────────────────────────────────────────
  // Storing the secret in `settings` is what makes the second-run silent: it
  // is read on every use rather than cached, so a paste-then-retry works
  // without restarting the service worker.
  check("the first-run wizard collects the server key",
    /getElementById\("agentSecret"\)/.test(welcome));
  check("and saves it where background.ts reads it",
    /settings:\s*\{[\s\S]{0,200}agentSecret:/.test(welcome),
    "without this the key is typed on every first run and lost on every restart");
  check("the wizard checks the pair, not just the address",
    /\/v1\/policy[\s\S]{0,200}404/.test(welcome) || /404[\s\S]{0,300}\/v1\/policy/.test(welcome),
    "a first-run user with a wrong key is told 'Reachable' and finds out on their first task");

  // ── The server's own words ─────────────────────────────────────────────
  const warn = /AGENT_SECRET is unset[\s\S]*?\n    \)/.exec(main);
  check("the startup warning exists at all", !!warn);
  if (warn) {
    check("and says where to put one",
      /docker-compose\.yml/.test(warn[0]), warn[0]);
    check("and says what it costs to leave it unset",
      /drive the agent against your logged-in browser/.test(warn[0]), warn[0]);
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();