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

// Comments are stripped before a source is asserted on: both files explain
// themselves by naming innerHTML, and a check that trips on the explanation
// defeats the rule it states.
const code = (s) => s.replace(/^\s*\/\/.*$/gm, "");

/** A fake fetch plus the storage the exchange writes to. The code box starts
 *  hidden, as the markup does; a rig that wants to test an exchange sets it. */
function rig(src, name, respond, { codeFieldHidden = false } = {}) {
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
    $cloudCode: { value: "123456", focus() {} },
    $cloudCodeField: { hidden: codeFieldHidden },
    $resendCodeBtn: { hidden: true },
    $providerRetryBtn: null,
    $agentSecret: { value: "" },
    $cloudStatus: { textContent: "", className: "status" },
    cloudCodeField: { hidden: false },
    cloudCode: { value: "123456", focus() {} },
    cloudResendBtn: null,
    settingsOverlay: { classList: { remove() {}, add() {} } },
    goalEl: { focus() {} },
    toast() {},
    async greetOnSignIn() { sandbox.greeted = true; },
    $waitlistEmail: { value: "" },
    $waitlistName: { value: "" },
    setCloudStatus(text, tone) {
      sandbox.$cloudStatus.textContent = text || "";
      sandbox.$cloudStatus.className = tone ? `status ${tone}` : "status";
      sandbox.statusText = text || "";
      sandbox.statusTone = tone || "";
    },
    // `joinWaitlist` is a different file's test; here the refusal only has to
    // reach the waitlist box, and `prefillWaitlist` is the real extracted one.
    setWaitlistStatus(text) { sandbox.waitlistStatusText = text || ""; },
    document: { getElementById: () => null },
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
  sandbox.cloudCodeField = sandbox.$cloudCodeField;
  sandbox.agentSecretSetting = sandbox.$agentSecret;
  sandbox.waitlistEmail = sandbox.$waitlistEmail;
  sandbox.waitlistName = sandbox.$waitlistName;
  vm.runInContext(extract(src, name), sandbox);
  vm.runInContext(extract(src, "postAuth"), sandbox);
  vm.runInContext(extract(src, "prefillWaitlist"), sandbox);
  vm.runInContext(extract(src, "storedAccountName"), sandbox);
  // The reveal helpers are the real ones on both surfaces: "did the code box
  // open" is the behaviour under test, so stubbing it would assert nothing.
  for (const fn of ["showCodeEntry", "hideCodeEntry", "showCloudCodeEntry", "hideCloudCodeEntry"]) {
    try { vm.runInContext(extract(src, fn), sandbox); } catch { /* the other surface's name */ }
  }
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

  // ── The reveal, and what it is not driven by ────────────────────────────
  // `request-code` answers a listed and an unlisted address byte-identically,
  // deliberately, so nothing in this response can tell the two apart. The
  // reveal therefore rides on the request going out — the user's own click
  // plus an accepted request — and the sentence is one that is true of both.
  check("a 200 reveals the code box",
    req.$cloudCodeField.hidden === false && req.$resendCodeBtn.hidden === false,
    `code@${req.$cloudCodeField.hidden} resend@${req.$resendCodeBtn.hidden}`);
  check("and never claims a mail is on its way to that address",
    !/code (sent|is on its way to)\b(?! — can take)/i.test(req.statusText)
    && /if person@example\.com is in the beta/i.test(req.statusText), req.statusText);

  const asked = rig(welcome, "requestCode", json(429, { detail: "slow down" }), { codeFieldHidden: true });
  await asked.requestCode();
  check("a refused request reveals nothing",
    asked.$cloudCodeField.hidden === true && asked.$resendCodeBtn.hidden === true,
    "a box the user can fill when no mail is coming is worse than no box");
  const dropped = rig(welcome, "requestCode", async () => { throw new Error("network down"); }, { codeFieldHidden: true });
  await dropped.requestCode();
  check("and neither does one that never reached the server",
    dropped.$cloudCodeField.hidden === true);

  const blankAddr = rig(welcome, "requestCode", json(200, { ok: true }), { codeFieldHidden: true });
  blankAddr.$cloudEmail.value = "  ";
  await blankAddr.requestCode();
  check("no address, no request and no box",
    blankAddr.calls.length === 0 && blankAddr.$cloudCodeField.hidden === true);

  // The other direction: the code box is never a free-standing field, so an
  // exchange typed before the reveal is refused rather than posted.
  const early = rig(welcome, "exchangeCode", json(200, { access_token: TOKEN }));
  early.$cloudCodeField.hidden = true;
  check("a code typed before the reveal never leaves",
    (await early.exchangeCode()) === false && early.calls.length === 0
    && early.$agentSecret.value === "", "the guard is a UX affordance only if it is a real refusal");
  check("and it says why, rather than failing silently",
    /send yourself a code first/i.test(early.statusText), early.statusText);

  const afterGood = rig(welcome, "exchangeCode", json(200, { access_token: TOKEN }));
  await afterGood.exchangeCode();
  check("a real exchange closes the box again",
    afterGood.$cloudCodeField.hidden === true && afterGood.$resendCodeBtn.hidden === true);

  check("the resend button is the same call, not a second flow",
    /\$resendCodeBtn\.addEventListener\("click", \(\) => \{ void requestCode\(\); \}\)/.test(welcome));
  check("and the panel's is too",
    /cloudResendBtn\.addEventListener\('click', \(\) => \{ void requestSignInCode\(\); \}\)/.test(sidepanel));
  check("neither surface asks for the code twice in one screen",
    !/id="cloudCode"[\s\S]{0,400}id="sendCodeBtn"/.test(welcomeHtml),
    "the box opens on the send; it is not on screen asking to be filled first");

  // ── The panel's exchange, same contract ─────────────────────────────────
  const panelGood = rig(sidepanel, "exchangeSignInCode", json(200, { access_token: TOKEN }));
  check("the panel exchanges too",
    (await panelGood.exchangeSignInCode()) === true
    && panelGood.stored.agentSecret === TOKEN, JSON.stringify(panelGood.stored));
  const panelBad = rig(sidepanel, "exchangeSignInCode", json(400, {}));
  check("and refuses just as firmly",
    (await panelBad.exchangeSignInCode()) === false && !panelBad.stored.agentSecret);

  // ── The panel's reveal, same contract as the wizard's ───────────────────
  const pReq = rig(sidepanel, "requestSignInCode", json(200, { ok: true }), { codeFieldHidden: true });
  await pReq.requestSignInCode();
  check("a 200 reveals the panel's code box too", pReq.cloudCodeField.hidden === false);
  check("with a sentence true of a member and a stranger",
    /if person@example\.com is in the beta/i.test(pReq.statusText)
    && !/code sent to/i.test(pReq.statusText), pReq.statusText);
  const pRefused = rig(sidepanel, "requestSignInCode", json(429, {}), { codeFieldHidden: true });
  await pRefused.requestSignInCode();
  check("and a refused one reveals nothing", pRefused.cloudCodeField.hidden === true);
  const pEarly = rig(sidepanel, "exchangeSignInCode", json(200, { access_token: TOKEN }), { codeFieldHidden: true });
  check("the panel refuses an exchange typed before the reveal",
    (await pEarly.exchangeSignInCode()) === false && pEarly.calls.length === 0
    && !pEarly.stored.agentSecret);
  const pSpent = rig(sidepanel, "exchangeSignInCode", json(200, { access_token: TOKEN, approved: true }));
  await pSpent.exchangeSignInCode();
  check("and the box closes again once a code is spent", pSpent.cloudCodeField.hidden === true);

  // ── Greeting ───────────────────────────────────────────────────────────
  // The only name Brotto ever holds is one the user typed on the waitlist
  // form, so it is written on a successful signup and read back. Nothing new
  // about the person leaves the browser to earn it.
  const named = rig(sidepanel, "exchangeSignInCode", json(200, { access_token: TOKEN, approved: true }));
  named.stored = { settings: { accountName: "Ada Lovelace" } };
  check("a sign-in on a stored name greets by it",
    (await named.exchangeSignInCode()) === true && named.greeted === true);
  const unnamed = rig(sidepanel, "exchangeSignInCode", json(200, { access_token: TOKEN, approved: true }));
  check("and one with no name still signs in plainly",
    (await unnamed.exchangeSignInCode()) === true && unnamed.greeted === true);

  const greetSrc = code(extract(sidepanel, "greetOnSignIn"));
  check("the greeting is the name, or the plain sentence when there is none",
    /name \? `Signed in\. Welcome, \$\{name\}\.` : 'Signed in to Brotto Cloud\.'/.test(greetSrc),
    greetSrc);
  check("it closes the settings overlay and returns focus to the composer",
    /settingsOverlay\.classList\.remove\('open'\)/.test(greetSrc)
    && /goalEl\.focus\(\)/.test(greetSrc));
  check("and the name is read from the one place it is written",
    /stored\.settings && stored\.settings\.accountName/.test(code(extract(sidepanel, "storedAccountName"))));
  // Only a field the user filled in may write one. Two occurrences of the
  // name in a file — the definition and a single call, inside joinWaitlist.
  for (const [label, src] of [["panel", sidepanel], ["wizard", welcome]]) {
    const body = code(src);
    check(`${label}: an account name is written in exactly one place`,
      body.split("rememberAccountName(").length === 3
      && code(extract(src, "joinWaitlist")).includes("rememberAccountName(name)"),
      `${body.split("rememberAccountName(").length - 1} occurrences`,
      );
  }

  // ── `approved` ──────────────────────────────────────────────────────────
  // A report, not the gate: an unlisted address and an unreachable control
  // plane both come back as a valid token, a 200 and `false`. So the token
  // is stored either way — dropping it would strand an address the operator
  // approves later — and what changes is the sentence and the waitlist box.
  const offBeta = rig(sidepanel, "exchangeSignInCode", json(200, { access_token: TOKEN, approved: false }));
  check("an unlisted address still gets its token — it is a real one",
    (await offBeta.exchangeSignInCode()) === true && offBeta.stored.agentSecret === TOKEN,
    "a refusal that threw the token away is how an approved-later account never recovers");
  check("and sign-in does not read as a success",
    offBeta.statusTone !== "ok" && !/^signed in to brotto cloud\.?$/i.test(offBeta.statusText.trim()),
    offBeta.statusText);
  check("it says they are not in the beta, without blaming them",
    /beta/i.test(offBeta.statusText) && /not on the list/i.test(offBeta.statusText), offBeta.statusText);
  check("and the waitlist box is offered the address they just proved",
    offBeta.$waitlistEmail.value === "person@example.com", offBeta.$waitlistEmail.value);
  check("offered, not sent — the refusal makes no second request",
    offBeta.calls.length === 1, JSON.stringify(offBeta.calls.map((c) => c.url)));

  const onBeta = rig(sidepanel, "exchangeSignInCode", json(200, { access_token: TOKEN, approved: true }));
  check("an approved address signs in plainly",
    (await onBeta.exchangeSignInCode()) === true
    && /signed in to brotto cloud/i.test(onBeta.statusText), onBeta.statusText);
  check("and is not handed a waitlist it does not need",
    onBeta.$waitlistEmail.value === "");

  // Additive means additive: a server too old to send the field must not read
  // as a refusal, or every install on it would be told it is not in the beta.
  const noField = rig(sidepanel, "exchangeSignInCode", json(200, { access_token: TOKEN }));
  check("a response with no `approved` at all is not a refusal",
    (await noField.exchangeSignInCode()) === true
    && /signed in to brotto cloud/i.test(noField.statusText), noField.statusText);

  // Truthiness is the bug here: an absent field is `undefined`, and
  // `if (body.approved)` would make every pre-cloud server a refusal.
  check("it is compared against false, never truthiness",
    /body\.approved === false/.test(code(sidepanel) + code(welcome))
    && !/if \(body\.approved\)|body\.approved \?|!body\.approved\)/.test(code(sidepanel) + code(welcome)));

  // A refusal on a response that carries no token is not a refusal at all —
  // the failure path wins, so nothing here can say "not in the beta" about a
  // sign-in that never happened.
  const badAndOff = rig(sidepanel, "exchangeSignInCode", json(400, { approved: false }));
  check("a refused code is a refused code, not a closed beta",
    (await badAndOff.exchangeSignInCode()) === false
    && /did not work/i.test(badAndOff.statusText)
    && badAndOff.$waitlistEmail.value === "", badAndOff.statusText);

  // The wizard: same field, same outcome, and the step still advances — the
  // token is real and `finish()` has something to save.
  const wizOff = rig(welcome, "exchangeCode", json(200, { access_token: TOKEN, approved: false }));
  check("the wizard stores the token on an unlisted address",
    (await wizOff.exchangeCode()) === true && wizOff.$agentSecret.value === TOKEN);
  check("says so, and offers the waitlist the same address",
    /beta/i.test(wizOff.statusText)
    && wizOff.$waitlistEmail.value === "person@example.com", wizOff.statusText);
  const wizOn = rig(welcome, "exchangeCode", json(200, { access_token: TOKEN, approved: true }));
  check("and an approved wizard sign-in is an ordinary sign-in",
    (await wizOn.exchangeCode()) === true && /^signed in$/i.test(wizOn.statusText.trim()), wizOn.statusText);

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
  // is typed into this flow, and it lands in a status line.
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