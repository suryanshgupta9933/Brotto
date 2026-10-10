// The credential has to survive the handshake, and a refusal has to be
// distinguishable from an outage.
//
// The bug this pins: `authedWs` capped the subprotocol at 120 characters, so a
// Supabase JWT (~635, ~1.5 KB with populated `user_metadata`) did not fit. The
// check failed, the credential was **dropped rather than sent**, and the socket
// arrived with none — the server refused it, and the close code the extension
// got back was indistinguishable from "server unreachable". The user debugged
// a key that had never been transmitted.
//
// The second half is the part a length test cannot reach. main.py rejects
// BEFORE accept, and a pre-accept rejection is an HTTP-level failure: measured
// against real Chrome 154, `CloseEvent.code` is **1006, not 4001**. So a
// refused key, a missing credential and a server that is not running are the
// same event in the browser, and the old handler discarded the event entirely.
// The split has to be made from evidence the client actually has — whether it
// put a credential on the wire, cross-checked against the server still being
// up.
//
// Everything under test is extracted from background.ts by brace matching and
// evalled, so it cannot drift from what ships.
//
//   node scripts/test-credential-transport.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const worker = fs.readFileSync(
  path.join(__dirname, "..", "clients", "brotto-extension", "src", "background.ts"), "utf8");

/** Brace-match one top-level declaration out of background.ts. */
function extract(name, { async: isAsync = false } = {}) {
  const re = new RegExp(
    isAsync ? `^async function ${name}\\(` : `^(?:async )?function ${name}\\(|^const ${name}\\b|^let ${name}\\b`,
    "m");
  const start = worker.search(re);
  if (start < 0) throw new Error(`no ${name} in background.ts — renamed?`);
  // A `const`/`let` line ends at its first newline; a function ends at its
  // matching brace. `async function` is still a function.
  if (!/\bfunction /.test(worker.slice(start, start + 20))) {
    let depth = 0, seen = false;
    for (let i = start; i < worker.length; i++) {
      if (worker[i] === "{") { depth++; seen = true; }
      else if (worker[i] === "}") seen = false;
      else if (worker[i] === "\n" && !seen) return stripType(worker.slice(start, i));
      else if (worker[i] === ";" && !seen) return stripType(worker.slice(start, i + 1));
    }
  }
  let parens = 0, bodyStart = -1;
  for (let i = worker.indexOf("(", start); i < worker.length; i++) {
    if (worker[i] === "(") parens++;
    else if (worker[i] === ")" && --parens === 0) { bodyStart = worker.indexOf("{", i); break; }
  }
  let depth = 0;
  for (let i = bodyStart; i < worker.length; i++) {
    if (worker[i] === "{") depth++;
    else if (worker[i] === "}" && --depth === 0) {
      // TypeScript: drop the parameter and return annotations so the rest evals
      // as the JavaScript it compiles to. The trailing `{` comes off first —
      // it terminates the signature, and a `$`-anchored return-type match never
      // reaches it.
      const sig = worker.slice(start, bodyStart).replace(/\{\s*$/, "");
      return sig
        .replace(/([(,]\s*[A-Za-z_$][\w$]*)\s*:\s*[^,)]+/g, "$1")
        .replace(/\)\s*:\s*[\w<>[\]| "']+$/, ")") + worker.slice(bodyStart, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

/** `let credentialState: "a" | "b" = "a"` → `let credentialState = "a"`. */
function stripType(decl) {
  return decl.replace(/^(let|const) (\w+)\s*:[^=]*=/, "$1 $2 =");
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
}

/** The token grammar RFC 6455 allows in a subprotocol. */
const tokenChar = /^[A-Za-z0-9._~-]+$/;
function secretOf(n) {
  return "a".repeat(n); // inside the charset; length is the variable
}

// ── What actually fits ──────────────────────────────────────────────────────
const MAX = Number((extract("SUBPROTOCOL_MAX_CHARS").match(/=\s*(\d+)/) || [])[1]);

(async () => {
  console.log(`SUBPROTOCOL_MAX_CHARS = ${MAX}\n`);

  // The bound is only justified if a real token fits and the old cap did not.
  const JWT_TODAY = 635;
  const JWT_WITH_METADATA = 1500;

  check("a Supabase access token of today's length fits under the cap",
    JWT_TODAY < MAX, `${JWT_TODAY} vs ${MAX}`);
  check("a JWT with populated user_metadata fits under the cap",
    JWT_WITH_METADATA < MAX, `${JWT_WITH_METADATA} vs ${MAX}`);
  check("the cap clears the length that broke it",
    MAX > JWT_WITH_METADATA * 2,
    `no headroom over ${JWT_WITH_METADATA}; a token that grows past ${MAX} is dropped again`);
  check("the cap stays under the ~8 KB edge where a proxy refuses the header",
    MAX <= 4096, `${MAX} is past nginx's default large_client_header_buffers`);

  // ── The fit predicate ────────────────────────────────────────────────────
  const fitsSandbox = {};
  vm.createContext(fitsSandbox);
  vm.runInContext(extract("SUBPROTOCOL_MAX_CHARS"), fitsSandbox);
  vm.runInContext(extract("credentialFits"), fitsSandbox);
  const fits = fitsSandbox.credentialFits;

  check("a self-host AGENT_SECRET of ordinary length still rides the handshake",
    fits("correct-horse-battery-staple"));
  check("a 120-char secret behaves exactly as it did before",
    fits(secretOf(120)), "the old boundary is a regression point");
  check("a 121-char secret is no longer dropped at the old boundary",
    fits(secretOf(121)));
  check("a 635-char JWT is sent",
    fits(secretOf(JWT_TODAY)));
  check("a 1500-char JWT is sent",
    fits(secretOf(JWT_WITH_METADATA)));

  // The charset semantics for self-host are unchanged, and they are the reason
  // the drop exists at all: a secret with a character outside RFC 6455's token
  // grammar would produce a malformed handshake, which fails as an unexplained
  // network error — worse than the server's own refusal.
  check("a secret with a space is still not sent",
    !fits("has a space"), "would produce a malformed handshake");
  check("a secret with a slash is still not sent",
    !fits("a/b"), "would produce a malformed handshake");
  check("a secret with a plus is still not sent",
    !fits("a+b"));
  check("the charset check is a character-class test, not a length one",
    !fits(""), "an empty secret is the no-secret install, not a failure");

  // ── What the client records, and what the close makes of it ──────────────
  /**
   * @param secret   the credential the install holds
   * @param code     the CloseEvent.code Chrome handed us
   * @param opened   whether the socket ever reached OPEN
   * @param health   null = /health threw (server not running)
   */
  async function classify({ secret, code, opened, health }) {
    const probes = [];
    const sandbox = {
      serverUrl: "http://localhost:8000",
      fetch: async (url) => {
        probes.push(url);
        if (!url.endsWith("/health")) return { ok: true };
        if (health === null) throw new Error("Failed to fetch");
        return { ok: health < 400 };
      },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout,
      AbortController,
      WebSocket: function WebSocket(url, protocols) {
        this.url = url;
        this.protocols = protocols;
        sandbox.socket = this;
      },
      console,
    };
    vm.createContext(sandbox);
    for (const decl of ["credentialState", "socketOpened", "SUBPROTOCOL_MAX_CHARS",
      "RELAY_PROTOCOL", "credentialFits", "SERVER_PROBE_MS"]) {
      vm.runInContext(extract(decl), sandbox);
    }
    vm.runInContext(extract("authedWs"), sandbox);
    vm.runInContext(extract("refusalForCloseCode"), sandbox);
    vm.runInContext(extract("serverIsAlive", { async: true }), sandbox);
    vm.runInContext(extract("classifySocketDeath", { async: true }), sandbox);

    sandbox.authedWs("ws://x/ws/ext/1", secret);
    if (opened) vm.runInContext("socketOpened = true", sandbox);
    return {
      verdict: await sandbox.classifySocketDeath(code, opened),
      // `let` at context top level is a lexical binding, not a property of the
      // global object — reading it off `sandbox` would silently yield undefined,
      // and every assertion below would then pass or fail for the wrong reason.
      state: vm.runInContext("credentialState", sandbox),
      protocols: sandbox.socket.protocols,
      probes,
    };
  }

  console.log("\nthe credential is only dropped when it cannot be represented");

  const jwt = await classify({ secret: secretOf(1500), code: 1000, opened: true, health: null });
  check("a 1500-char JWT is actually placed on the wire",
    jwt.state === "sent" && Array.isArray(jwt.protocols)
      && jwt.protocols[1] === secretOf(1500),
    `${jwt.state} ${JSON.stringify(jwt.protocols && jwt.protocols.map((p) => p.length))}`);
  check("and the protocol name still leads the list",
    jwt.protocols[0] === "brotto-v1");

  const odd = await classify({ secret: "has a space", code: 1000, opened: true, health: null });
  check("a secret outside the token grammar is still dropped, not mangled",
    odd.protocols === undefined, JSON.stringify(odd.protocols));
  check("and dropping it is recorded as 'dropped', not as 'none'",
    odd.state === "dropped", odd.state);

  const none = await classify({ secret: "", code: 1000, opened: true, health: null });
  check("a self-host with no AGENT_SECRET still connects with no credential",
    none.protocols === undefined, JSON.stringify(none.protocols));
  check("and an unset secret is 'none', never a dropped credential",
    none.state === "none", none.state);

  console.log("\na refusal reads differently from an outage");

  const rejected = await classify({ secret: "wrong-key", code: 1006, opened: false, health: 200 });
  check("a refused key is 'rejected', not unreachable",
    rejected.verdict === "rejected", String(rejected.verdict));

  const missing = await classify({ secret: "", code: 1006, opened: false, health: 200 });
  check("a live server that got no credential is 'missing'",
    missing.verdict === "missing", String(missing.verdict));

  const dropped = await classify({ secret: "x".repeat(99999), code: 1006, opened: false, health: 200 });
  check("a credential we could not send reads as 'missing', not 'rejected'",
    dropped.verdict === "missing", String(dropped.verdict));
  check("and that is exactly the case the 120-char cap used to cause silently",
    dropped.state === "dropped" && dropped.verdict === "missing");

  const offline = await classify({ secret: "wrong-key", code: 1006, opened: false, health: null });
  check("a server that is not running stays unreachable, so it still reconnects",
    offline.verdict === null, String(offline.verdict));

  const midRun = await classify({ secret: "wrong-key", code: 1006, opened: true, health: 200 });
  check("a socket that opened and then died is transport, not a refusal",
    midRun.verdict === null, String(midRun.verdict));

  const clean = await classify({ secret: "k", code: 1000, opened: true, health: 200 });
  check("a clean close is not a refusal",
    clean.verdict === null);

  console.log("\nthe code the server does send is honoured when it survives");
  const via4001 = await classify({ secret: "k", code: 4001, opened: true, health: null });
  check("4001 reads as 'rejected'",
    via4001.verdict === "rejected", String(via4001.verdict));
  const via4003 = await classify({ secret: "k", code: 4003, opened: true, health: null });
  check("4003 reads as 'missing'",
    via4003.verdict === "missing", String(via4003.verdict));
  check("4003 and 4001 are told apart from each other",
    via4001.verdict !== via4003.verdict);

  console.log("\nno probe on the paths that must not wait");
  check("a socket that opened dying does not spend a health probe",
    midRun.probes.length === 0, JSON.stringify(midRun.probes));
  check("a clean close does not spend one",
    clean.probes.length === 0);
  const bounded = await classify({ secret: "k", code: 1006, opened: false, health: 200 });
  check("only a pre-open close probes, and it probes once",
    bounded.probes.length === 1, JSON.stringify(bounded.probes));

  console.log("\nthe probe is bounded — it runs ahead of a reconnect");
  check("SERVER_PROBE_MS is set", typeof MAX === "number" && MAX > 0);
  const ms = Number((extract("SERVER_PROBE_MS").match(/=\s*(\d+)/) || [])[1]);
  check("and is short enough not to delay a reconnect",
    ms > 0 && ms <= 5000, `${ms}ms`);

  console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});