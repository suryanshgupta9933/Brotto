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
  const local = { settings: { serverUrl: "https://agent.brotto.dev", agentSecret: TOKEN, accountCredential: true, ...stored }, ...stored };
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
          get: async (k) => {
            const keys = Array.isArray(k) ? k : typeof k === "string" ? [k] : Object.keys(local);
            const out = {};
            for (const key of keys) if (key in local) out[key] = local[key];
            return out;
          },
          set: async (o) => { Object.assign(local, o); },
          remove: async (keys) => {
            for (const key of (Array.isArray(keys) ? keys : [keys])) delete local[key];
          },
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
    UNNAMED_ACCOUNT: "unnamed-account",
    brottoModelKeys: (id) => (typeof id === "string" && id
      ? { config: `modelConfig:${id}`, apiKey: `modelApiKey:${id}` }
      : { config: "modelConfig", apiKey: "modelApiKey" }),
    brottoSessionStore: {
      cleared: [],
      clear: async (ns) => { sandbox.brottoSessionStore.cleared.push(ns); },
      namespaceFor: (base, id) => {
        const ns = String(base || "").replace(/\/$/, "").toLowerCase();
        return id ? `${ns}#${id}` : ns;
      },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(extract(sidepanel, "authHeaders"), sandbox);
  vm.runInContext(extract(sidepanel, "serverBase"), sandbox);
  vm.runInContext(extract(sidepanel, "accountScope"), sandbox);
  vm.runInContext(extract(sidepanel, "clearAccountArtifacts"), sandbox);
  vm.runInContext(extract(sidepanel, "dropCredential"), sandbox);
  vm.runInContext(extract(sidepanel, "learnAccountId"), sandbox);
  vm.runInContext(extract(sidepanel, "clearAccountArtifacts"), sandbox);
  vm.runInContext(extract(sidepanel, "dropCredential"), sandbox);
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
    check("and stored under its own key, so no writer reconstructs the settings blob",
      s.local.accountId === ACCOUNT && s.local.settings.accountId === undefined,
      JSON.stringify(s.local));
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
      s.local.accountId === undefined && s.local.settings.accountId === undefined,
      JSON.stringify(s.local));
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

  // ── The scoping must not wait on a network call ───────────────────────
  // The bug this exists for: state.accountId was assigned only inside the
  // /health-guarded probe, so a panel opened before that probe settled read
  // the SHARED namespace — the exact cross-account disclosure the scoping
  // exists to stop.
  {
    const s = panelRig(async () => { throw new Error("health never answered"); },
      { authMode: null, stored: { accountId: ACCOUNT } });
    const ns = s.brottoSessionStore.namespaceFor(s.serverBase(), await s.accountScope());
    check("an id in storage scopes the namespace with no network at all",
      ns === `https://agent.brotto.dev#${ACCOUNT}`, ns);
    check("…and it scopes even with authMode never probed",
      s.state.authMode === null && (await s.accountScope()) === ACCOUNT);
  }
  {
    // Credential in the slot, no id anywhere: the one case that must fail
    // CLOSED rather than fall back to shared — and it must fail closed even
    // when /health never answered, since "not probed" is not "not a cloud
    // account".
    const s = panelRig(json(200, { account_id: null }), { authMode: null, stored: { accountCredential: true } });
    const ns = s.brottoSessionStore.namespaceFor(s.serverBase(), await s.accountScope());
    check("a token with no identifiable account fails closed, never to shared",
      ns !== "https://agent.brotto.dev" && ns.endsWith("#unnamed-account"), ns);
    check("an unprobed server cannot widen an account back to shared",
      s.state.authMode === null && (await s.accountScope()) === "unnamed-account");
  }
  {
    // Self-host: a credential, but no account id — the namespace must be
    // byte-identical to every install from before accounts existed.
    const s = panelRig(json(200, {}), { authMode: "secret", stored: { agentSecret: "AGENT_SECRET_VALUE", accountCredential: false } });
    s.plannerUrlEl.value = "http://localhost:8000/";
    s.local.settings.serverUrl = "http://localhost:8000/";
    const ns = s.brottoSessionStore.namespaceFor(s.serverBase(), await s.accountScope());
    check("self-host keeps its flat namespace, byte-identical",
      ns === "http://localhost:8000", ns);
  }

  // ── Sign-out takes the account's artifacts with it ─────────────────────
  {
    const s = panelRig(json(200, {}), { stored: { accountId: ACCOUNT } });
    s.local[`modelApiKey:${ACCOUNT}`] = "sk-live-secret";
    s.local[`modelConfig:${ACCOUNT}`] = { provider: "anthropic", model: "claude" };
    await s.dropCredential();
    check("dropping the credential deletes the token", !s.local.settings.agentSecret);
    check("dropping the credential deletes the account id", s.local.accountId === undefined);
    check("dropping the credential deletes the account's saved API key",
      s.local[`modelApiKey:${ACCOUNT}`] === undefined, JSON.stringify(Object.keys(s.local)));
    check("dropping the credential deletes the account's model config",
      s.local[`modelConfig:${ACCOUNT}`] === undefined);
    check("dropping the credential clears the account's mirrored history",
      s.brottoSessionStore.cleared.includes(`https://agent.brotto.dev#${ACCOUNT}`),
      JSON.stringify(s.brottoSessionStore.cleared));
    check("dropping the credential leaves the panel scoped to nothing", s.state.accountId === null);
  }
  // A cloud account whose id never arrived writes and reads the sentinel
  // namespace. Sign-out must take that bucket too, or its key and mirrored
  // history outlive the sign-out and greet the next account to sign in.
  {
    const s = panelRig(json(200, {}), { authMode: "jwt", stored: { agentSecret: "cloud-token", accountCredential: true } });
    s.local["modelApiKey:unnamed-account"] = "sk-live-secret";
    s.local["modelConfig:unnamed-account"] = { provider: "anthropic", model: "claude" };
    await s.dropCredential();
    check("sign-out clears the unnamed namespace's saved API key",
      s.local["modelApiKey:unnamed-account"] === undefined, JSON.stringify(Object.keys(s.local)));
    check("sign-out clears the unnamed namespace's model config",
      s.local["modelConfig:unnamed-account"] === undefined);
    check("sign-out clears the unnamed namespace's mirrored history",
      s.brottoSessionStore.cleared.includes("https://agent.brotto.dev#unnamed-account"),
      JSON.stringify(s.brottoSessionStore.cleared));
  }
  // Self-host resolves to no scope at all: nothing namespaced, nothing deleted.
  {
    const s = panelRig(json(200, {}), { authMode: "secret", stored: { agentSecret: "AGENT_SECRET_VALUE", accountCredential: false } });
    s.local.modelApiKey = "sk-self-hosted";
    await s.dropCredential();
    check("self-host sign-out leaves its flat key and history alone",
      s.local.modelApiKey === "sk-self-hosted" && s.brottoSessionStore.cleared.length === 0,
      JSON.stringify([s.brottoSessionStore.cleared, Object.keys(s.local)]));
  }
  check("both teardown paths run the one helper",
    /await dropCredential\(\)/.test(code(sidepanel))
    && (code(sidepanel).match(/dropCredential\(\)/g) || []).length === 3,
    "the Sign out button and the expired-credential sweep, and no third copy");
  check("no teardown path rebuilds the id list by hand",
    !/remove\(\s*\[?\s*["'`]model(ApiKey|Config)/.test(code(sidepanel)),
    "key names come from the modelKeys helper");

  // ── The wizard's half ──────────────────────────────────────────────────
  {
    const exchange = extract(welcome, "exchangeCode");
    check("the exchange reads the id as its own field, not out of the token",
      /body\.account_id/.test(exchange) && !/\batob\b|jwtDecode|split\(["']\.["']\)/.test(exchange));
    check("finish() persists it as a top-level key, not a settings field",
      /chrome\.storage\.local\.set\(\{\s*accountId:\s*exchangeAccountId/.test(extract(welcome, "finish")));
    check("the wizard records whether the credential it stored is an account",
      /accountCredential:\s*edition\(\)\s*===\s*["']cloud["']/.test(extract(welcome, "finish")));
    check("scope is never decided by a /health answer",
      !/state\.authMode\s*===\s*["']jwt["']/.test(extract(sidepanel, "accountScope")),
      "an unprobed or unreachable server reads as null, and null must not widen scope");
  }
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