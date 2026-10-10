// Cloud sign-in: a 6-digit code in, a bearer token in `settings.agentSecret`.
//
// The token is ~635 characters of base64 with dots in it, and the whole point
// is that this client never looks inside it. So the assertions here are
// mostly about ABSENCES and about what happens on the failure paths, which
// are the ones nobody tests by hand: a five-digit code, a server that
// answers 200 with no token, a code that does not work. Each of those must
// leave the panel exactly as it was, because the alternative is a broken
// token in the slot that refuses every call with a 404 — indistinguishable,
// to the user, from a wrong AGENT_SECRET on a server they do not have.
//
// `exchangeCode` and `exchangeSignInCode` are extracted from the shipping
// files by brace matching and run against a fake fetch, so this cannot pass
// while the real thing is broken.
//
//   node scripts/test-signin.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "clients", "brotto-extension", "src");
const welcome = fs.readFileSync(path.join(EXT, "welcome.js"), "utf8");
const sidepanel = fs.readFileSync(path.join(EXT, "sidepanel.js"), "utf8");
const welcomeHtml = fs.readFileSync(path.join(EXT, "welcome.html"), "utf8");
const panelHtml = fs.readFileSync(path.join(EXT, "sidepanel.html"), "utf8");

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

const TOKEN = "eyJhbGciOiJIUzI1NiJ9." + "A".repeat(600) + ".sig";

/** A fake fetch plus the storage the exchange writes to. */
function rig(src, name, respond) {
  const calls = [];
  const store = { local: {}, session: {} };
  const sandbox = {
    calls,
    store,
    stored: {},
    statusText: "",
    fetch: async (url, opts) => {
      calls.push({ url, method: opts.method, headers: opts.headers, body: opts.body });
      return respond(url, opts);
    },
    $serverUrl: { value: "https://agent.brotto.dev" },
    $cloudEmail: { value: "person@example.com" },
    $cloudCode: { value: "123456" },
    $agentSecret: { value: "" },
    $cloudStatus: { textContent: "", className: "status" },
    setCloudStatus(text, tone) {
      sandbox.$cloudStatus.textContent = text || "";
      sandbox.$cloudStatus.className = tone ? `status ${tone}` : "status";
      sandbox.statusText = text || "";
      sandbox.statusTone = tone || "";
    },
    serverBase() { return "https://agent.brotto.dev"; },
    storeAgentSecret: async (value) => {
      sandbox.stored = { ...(sandbox.stored || {}), agentSecret: value };
      sandbox.$agentSecret.value = value;
    },
    chrome: {
      storage: {
        local: {
          get: async (k) => (k in sandbox.stored ? { [k]: sandbox.stored[k] } : {}),
          set: async (o) => { store.local = { ...store.local, ...o }; sandbox.stored = o.settings; },
        },
      },
    },
  };
  vm.createContext(sandbox);
  // The wizard names its inputs with `$`, the panel without. Both are the
  // same contract, so the rig answers to both.
  sandbox.cloudEmail = sandbox.$cloudEmail;
  sandbox.cloudCode = sandbox.$cloudCode;
  sandbox.agentSecretSetting = sandbox.$agentSecret;
  vm.runInContext(extract(src, name), sandbox);
  vm.runInContext(extract(src, "postAuth"), sandbox);
  return sandbox;
}

function json(okStatus, body) {
  return async () => ({ ok: okStatus < 400, status: okStatus, json: async () => body });
}

// ── The wizard's exchange ─────────────────────────────────────────────────
(async () => {
  const good = rig(welcome, "exchangeCode", json(200, { access_token: TOKEN }));
  const ok = await good.exchangeCode();
  check("a good code returns true", ok === true, good.statusText);
  check("and posts to the exchange endpoint on the configured base",
    good.calls.length === 1 && good.calls[0].url === "https://agent.brotto.dev/v1/auth/exchange",
    JSON.stringify(good.calls));
  check("sending the email and the code, as JSON",
    good.calls[0].method === "POST"
    && good.calls[0].headers["Content-Type"] === "application/json"
    && good.calls[0].body === JSON.stringify({ email: "person@example.com", code: "123456" }),
    good.calls[0].body);
  check("the token lands in the slot finish() already writes",
    good.$agentSecret.value === TOKEN);
  check("and the wizard itself writes no storage key at all",
    Object.keys(good.store.local).length === 0, JSON.stringify(Object.keys(good.store.local)),
    "finish() is the one writer; a second one is a second shape to keep in step");
  check("the code box is cleared once used", good.$cloudCode.value === "");
  check("the user is told it worked", /signed in/i.test(good.statusText), good.statusText);

  const bad = rig(welcome, "exchangeCode", json(401, { detail: "nope" }));
  const badOk = await bad.exchangeCode();
  check("a refused code returns false", badOk === false);
  check("and writes nothing to the slot", bad.$agentSecret.value === "",
    "a rejected code that still writes a token is the whole failure this guards");
  check("and says the code did not work", /did not work/i.test(bad.statusText), bad.statusText);

  const empty = rig(welcome, "exchangeCode", json(200, {}));
  const emptyOk = await empty.exchangeCode();
  check("a 200 with no token is a failure, not a sign-in",
    emptyOk === false && empty.$agentSecret.value === "",
    "a truthy body field would store `undefined` as a bearer token");

  const wrongType = rig(welcome, "exchangeCode", json(200, { access_token: 42 }));
  check("a non-string token is refused",
    (await wrongType.exchangeCode()) === false && wrongType.$agentSecret.value === "");

  const short = rig(welcome, "exchangeCode", json(200, { access_token: TOKEN }));
  short.$cloudCode.value = "12345";
  check("five digits never leaves the wizard",
    (await short.exchangeCode()) === false && short.calls.length === 0,
    "a request per typo, and the server decides what a code is");
  short.$cloudCode.value = "12345a";
  check("and neither does a letter",
    (await short.exchangeCode()) === false && short.calls.length === 0);

  const noEmail = rig(welcome, "exchangeCode", json(200, { access_token: TOKEN }));
  noEmail.$cloudEmail.value = "  ";
  check("no email, no request",
    (await noEmail.exchangeCode()) === false && noEmail.calls.length === 0);

  const offline = rig(welcome, "exchangeCode", async () => { throw new Error("network down"); });
  check("a server that is not there is not a sign-in",
    (await offline.exchangeCode()) === false && offline.$agentSecret.value === "");
  check("and the sentence does not blame the code",
    /did not work/i.test(offline.statusText), offline.statusText);

  // ── Requesting the code ─────────────────────────────────────────────────
  const req = rig(welcome, "requestCode", json(200, { ok: true }));
  await req.requestCode();
  check("the code request goes to /v1/auth/request-code",
    req.calls[0] && req.calls[0].url === "https://agent.brotto.dev/v1/auth/request-code",
    JSON.stringify(req.calls));
  check("carrying the email only",
    req.calls[0].body === JSON.stringify({ email: "person@example.com" }));
  check("and confirms with the address it went to",
    /person@example\.com/.test(req.statusText), req.statusText);

  // ── The panel's exchange, same contract ─────────────────────────────────
  const panelGood = rig(sidepanel, "exchangeSignInCode", json(200, { access_token: TOKEN }));
  check("the panel exchanges too",
    (await panelGood.exchangeSignInCode()) === true
    && panelGood.stored.agentSecret === TOKEN, JSON.stringify(panelGood.stored));
  const panelBad = rig(sidepanel, "exchangeSignInCode", json(400, {}));
  check("and refuses just as firmly",
    (await panelBad.exchangeSignInCode()) === false && !panelBad.stored.agentSecret);

  // ── The shape of the token is never inspected ───────────────────────────
  check("nothing splits or measures the token",
    !/access_token[\s\S]{0,40}(split|length|slice|indexOf|match)/.test(welcome + sidepanel));
  check("nothing matches on its prefix",
    !/access_token[\s\S]{0,40}startsWith/.test(welcome + sidepanel));
  check("and neither file has a notion of a mode in storage",
    !/settings\.(mode|edition|cloud|hosted|jwt)/.test(welcome + sidepanel),
    "the mode is the server's answer, not a thing the panel keeps");

  // ── What the user is told ───────────────────────────────────────────────
  // The panel's rule is that no unescaped string reaches innerHTML. The email
  // is typed into this flow, and it lands in a status line. Comments are
  // stripped first: both functions explain themselves by naming innerHTML,
  // and a check that trips on the explanation defeats the rule it states.
  const code = (s) => s.replace(/^\s*\/\/.*$/gm, "");
  const statusSrc = code(extract(sidepanel, "setCloudStatus"));
  check("the panel's status line is textContent",
    /\.textContent = text \|\| ''/.test(statusSrc) && !/innerHTML/.test(statusSrc));
  check("so is the wizard's", /\.textContent = text \|\| ""/.test(code(extract(welcome, "setCloudStatus"))));
  check("and neither interpolates the email into markup",
    !/innerHTML[\s\S]{0,120}(email|token|code|access_token)/.test(code(welcome) + code(sidepanel)));
  check("and this feature opened no new innerHTML sink",
    !/innerHTML/.test(code(extract(sidepanel, "setCloudStatus"))) && !/innerHTML/.test(code(extract(welcome, "setCloudStatus"))));
  // The panel's whole rule in one assertion: every innerHTML assignment is a
  // renderMarkdown call, a literal the file itself wrote, or the one Lucide
  // icon. A new feature that reaches for innerHTML is a feature that renders
  // a model's words.
  const ALLOWED = ["svgContent", "icon"];
  const sinks = [...code(sidepanel).matchAll(/(\w+)\.innerHTML = ([^\n;]+);/g)]
    .map((m) => m[2].trim());
  check("every innerHTML sink in the panel is renderMarkdown, a literal, or the Lucide icon",
    sinks.every((v) => v.startsWith("renderMarkdown(") || /^['"]/.test(v) || ALLOWED.includes(v)),
    sinks.filter((v) => !(v.startsWith("renderMarkdown(") || /^['"]/.test(v) || ALLOWED.includes(v))).join(" | "));

  // ── Nothing new was asked of the browser ───────────────────────────────
  check("no deep link is followed",
    !/chrome\.runtime\.getURL|chrome\.tabs\.create/.test(welcome + sidepanel),
    "a magic link needs chrome.identity and a reopened store review; the code is the reason neither exists");
  check("no permission was added to the manifest",
    !/identity/.test(fs.readFileSync(path.join(ROOT, "clients", "brotto-extension", "manifest.json"), "utf8")));
  check("both code inputs are numeric and six wide",
    /id="cloudCode"[\s\S]{0,80}maxlength="6"/.test(welcomeHtml)
    && /id="cloudCode"[\s\S]{0,80}maxlength="6"/.test(panelHtml));
  check("both are asked for by the same shape of button",
    /id="sendCodeBtn"/.test(welcomeHtml) && /id="cloudCodeBtn"/.test(panelHtml));

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();