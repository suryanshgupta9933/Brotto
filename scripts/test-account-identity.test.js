// Per-account identity on the extension side.
//
// Two cloud accounts in one Chrome profile had one namespace, because the
// only separator was the server address and that is the same for the whole
// hosted relay. The relay now names the account (`account_id` on exchange, and
// on the authenticated `GET /v1/account` for a panel that has no exchange in
// this session), and these checks are what stop the identity from quietly
// becoming the credential: the id is a field the server sends, never something
// decoded out of the token.
//
// Everything is extracted from the shipping files and run against a fake
// fetch and a fake storage. No request leaves this process.
//
//   node scripts/test-account-identity.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "clients", "brotto-extension", "src");
const sidepanel = fs.readFileSync(path.join(EXT, "sidepanel.js"), "utf8");
const welcome = fs.readFileSync(path.join(EXT, "welcome.js"), "utf8");
const store = fs.readFileSync(path.join(EXT, "session_store.js"), "utf8");

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

// Comments are stripped before a source is asserted on: both files explain
// themselves by naming JWT decoding, and a check that trips on the explanation
// defeats the rule it states.
const code = (s) => s.replace(/^\s*\/\/.*$/gm, "");

const ACCOUNT = "8f2c1d3e-0a44-4f1c-9c0b-2f6a91d0c111";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9." + "A".repeat(600) + ".sig";

// ── The panel's /v1/account probe ─────────────────────────────────────────
function panelRig(respond, { authMode = "jwt", stored = {} } = {}) {
  const calls = [];
  const local = { settings: { serverUrl: "https://agent.brotto.dev", agentSecret: TOKEN, ...stored }, ...stored };
  const sandbox = {
    calls,
    local,
    fetch: async (url, opts) => {
      calls.push({ url, method: opts.method, headers: opts.headers });
      return respond(url, opts);
    },
    chrome: {
      storage: {
        local: {
          get: async (k) => (typeof k === "string" ? (k in local ? { [k]: local[k] } : {}) : {}),
          set: async (o) => { Object.assign(local, o); },
          remove: async () => {},
        },
      },
    },
    state: { authMode, accountId: null },
    plannerUrlEl: { value: "https://agent.brotto.dev" },
    // The real credential binding, so "does it send the token" is the shipped
    // rule and not this file's opinion of it.
    brottoCredential: { forUrl: (s) => ({ secret: (s && s.agentSecret) || "", refusal: "" }) },
    lastCredentialRefusal: "",
    toast() {},
    CLOUD_SERVER_URL: "https://agent.brotto.dev",
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extract(sidepanel, "authHeaders"), sandbox);
  vm.runInContext(extract(sidepanel, "serverBase"), sandbox);
  vm.runInContext(extract(sidepanel, "learnAccountId"), sandbox);
  return sandbox;
}

const json = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });

(async () => {
  // ── Learning it ─────────────────────────────────────────────────────────
  {
    const s = panelRig(json(200, { account_id: ACCOUNT, approved: true }));
    await s.learnAccountId();
    check("a panel opened days later learns the account from /v1/account",
      s.calls.length === 1 && s.calls[0].url === "https://agent.brotto.dev/v1/account",
      JSON.stringify(s.calls));
    check("…over the ordinary bearer header, not a query string",
      s.calls[0].headers && s.calls[0].headers.Authorization === `Bearer ${TOKEN}`
      && !s.calls[0].url.includes("?"),
      JSON.stringify(s.calls[0].headers));
    check("it is cached on the panel for the namespace to read",
      s.state.accountId === ACCOUNT, String(s.state.accountId));
    check("and stored, so the service worker and the wizard can read it too",
      s.local.settings.accountId === ACCOUNT, JSON.stringify(s.local.settings.accountId));
  }

  // ── The three answers that mean "no account" ───────────────────────────
  // Self-host's `null`, a degraded exchange's `""` and a refusal must all
  // leave the panel exactly as it was before accounts existed.
  for (const [label, status, body] of [
    ["self-host answers null", 200, { account_id: null, approved: false }],
    ["a degraded exchange answers an empty string", 200, { account_id: "", approved: true }],
    ["a refused credential answers 404", 404, {}],
  ]) {
    const s = panelRig(json(status, body));
    await s.learnAccountId();
    check(`${label} leaves no account on the panel`,
      s.state.accountId === null, String(s.state.accountId));
    check(`${label} leaves nothing in storage`,
      s.local.settings.accountId === undefined, String(s.local.settings.accountId));
  }
  {
    const s = panelRig(async () => { throw new Error("network down"); });
    await s.learnAccountId();
    check("an unreachable server leaves no account", s.state.accountId === null);
  }

  // ── Self-host is never asked ───────────────────────────────────────────
  {
    const s = panelRig(json(200, { account_id: ACCOUNT }), { authMode: "secret" });
    await s.learnAccountId();
    check("a self-hoster's server is never asked which account they are",
      s.calls.length === 0 && s.state.accountId === null, JSON.stringify(s.calls));
  }

  // ── A stored id short-circuits ─────────────────────────────────────────
  {
    const s = panelRig(json(200, { account_id: ACCOUNT }), { stored: { accountId: ACCOUNT } });
    await s.learnAccountId();
    check("an id already in storage costs no request",
      s.calls.length === 0 && s.state.accountId === ACCOUNT, JSON.stringify(s.calls));
  }

  // ── The wizard's half ──────────────────────────────────────────────────
  {
    const exchange = extract(welcome, "exchangeCode");
    check("the exchange reads the id as its own field, not out of the token",
      /body\.account_id/.test(exchange) && !/\batob\b|jwtDecode|split\(["']\.["']\)/.test(exchange));
    check("finish() persists it next to the credential",
      /accountId:\s*exchangeAccountId/.test(extract(welcome, "finish")));
  }

  // ── Absences that must not come back ───────────────────────────────────
  {
    const both = code(sidepanel) + code(welcome) + code(store);
    check("no surface decodes the credential",
      !/\batob\s*\(|jwtDecode|jwt_decode|base64UrlDecode|Buffer\.from\(.*token/i.test(both));
    check("the credential is never passed into a namespace",
      !/namespaceFor\([^)]*agentSecret|namespaceFor\([^)]*secret/i.test(both));
    check("identity does not branch on a hardcoded server address",
      !/accountId[^;]*===?\s*CLOUD_SERVER_URL|CLOUD_SERVER_URL[^;]*accountId/i.test(both),
      "the mode comes from /health and the id from the server's answer");
    check("/v1/account is asked with a header, never a query string",
      !/\/v1\/account\?/.test(both) && /Authorization/.test(extract(sidepanel, "authHeaders")));
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();