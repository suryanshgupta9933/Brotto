// Cloud sign-in: a 6-digit code in, a bearer token in `settings.agentSecret`.
//
// The token is ~635 characters of base64 with dots in it, and the whole point
// is that this client never looks inside it. So the assertions here are
// mostly about ABSENCES and about what happens on the failure paths, which
// are the ones nobody tests by hand: a five-digit code, a server that
// answers 200 with no token, a code that does not work. Each of those must
// leave the wizard exactly as it was, because the alternative is a broken
// token in the slot that refuses every call with a 404 — indistinguishable,
// to the user, from a wrong AGENT_SECRET on a server they do not have.
//
// The panel's Settings copy of this flow is gone with the Connection
// section: the wizard is the one place to change server, key or account.
// Asserted as an absence at the bottom.
//
// `exchangeCode` is extracted from the shipping welcome.js by brace matching
// and run against a fake fetch, so this cannot pass while the real thing is
// broken.
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
    $sendCodeRow: { hidden: false },
    $providerRetryBtn: null,
    $agentSecret: { value: "" },
    $cloudStatus: { textContent: "", className: "status" },
    $waitlistBlock: { open: false },
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
  // The wizard names its inputs with `$`.
  sandbox.waitlistEmail = sandbox.$waitlistEmail;
  sandbox.waitlistName = sandbox.$waitlistName;
  vm.runInContext(extract(src, name), sandbox);
  vm.runInContext(extract(src, "postAuth"), sandbox);
  vm.runInContext(extract(src, "prefillWaitlist"), sandbox);
  vm.runInContext(extract(src, "storedAccountName"), sandbox);
  // The reveal helpers are the real ones: "did the code box open" is the
  // behaviour under test, so stubbing it would assert nothing.
  for (const fn of ["showCodeEntry", "hideCodeEntry"]) {
    vm.runInContext(extract(src, fn), sandbox);
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
  check("and the exchange itself writes no storage key at all",
    Object.keys(good.store.local).length === 0, JSON.stringify(Object.keys(good.store.local)),
    "finish() is the one writer; a second one is a second shape to keep in step");
  check("the code box is cleared once used", good.$cloudCode.value === "");
  check("the user is told it worked", /signed in/i.test(good.statusText), good.statusText);
  check("an approved sign-in leaves the waitlist collapsed",
    good.$waitlistBlock.open === false);

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
  // The server says whether a code is on its way. Always HTTP 200; the body
  // carries `sent` and, on a refusal, a `reason`.
  const req = rig(welcome, "requestCode", json(200, { sent: true }));
  await req.requestCode();
  check("the code request goes to /v1/auth/request-code",
    req.calls[0] && req.calls[0].url === "https://agent.brotto.dev/v1/auth/request-code",
    JSON.stringify(req.calls));
  check("carrying the email only",
    req.calls[0].body === JSON.stringify({ email: "person@example.com" }));
  check("and confirms with the address it went to",
    /person@example\.com/.test(req.statusText), req.statusText);
  check("certainly — a code is on its way to that address, not 'if'",
    /on its way to person@example\.com/i.test(req.statusText)
    && !/if person@example\.com is in the beta/i.test(req.statusText), req.statusText);

  // ── The reveal, and what it is not driven by ────────────────────────────
  // The box opens when the user asked for a code and one is on its way. It
  // does not open when the server says no mail is coming — a box the user
  // can fill with a code nobody sent is worse than no box.
  check("a sent code reveals the code box",
    req.$cloudCodeField.hidden === false && req.$resendCodeBtn.hidden === false,
    `code@${req.$cloudCodeField.hidden} resend@${req.$resendCodeBtn.hidden}`);
  check("and takes the Send code button off the screen with it",
    req.$sendCodeRow.hidden === true,
    "two ways to ask for a code on one screen is two ways to be confused");

  const offList = rig(welcome, "requestCode", json(200, { sent: false, reason: "not_on_list" }), { codeFieldHidden: true });
  await offList.requestCode();
  check("not_on_list is told so, and the box stays shut",
    offList.$cloudCodeField.hidden === true && offList.$resendCodeBtn.hidden === true
    && /not in the closed beta/i.test(offList.statusText), offList.statusText);
  check("and the Send code button comes back, because nothing was sent",
    offList.$sendCodeRow.hidden === false);
  check("and the waitlist is offered the address they just tried",
    offList.$waitlistEmail.value === "person@example.com", offList.$waitlistEmail.value);
  check("and the waitlist toggle opens — the form they are told to use has to be visible",
    offList.$waitlistBlock.open === true);
  check("offered, not sent — the refusal makes no second request",
    offList.calls.length === 1, JSON.stringify(offList.calls.map((c) => c.url)));

  const pending = rig(welcome, "requestCode", json(200, { sent: false, reason: "pending" }), { codeFieldHidden: true });
  await pending.requestCode();
  check("pending says watch your inbox, and the box stays shut",
    pending.$cloudCodeField.hidden === true
    && /inbox/i.test(pending.statusText) && /write/i.test(pending.statusText), pending.statusText);

  const revoked = rig(welcome, "requestCode", json(200, { sent: false, reason: "revoked" }), { codeFieldHidden: true });
  await revoked.requestCode();
  check("revoked is plain about it, and the box stays shut",
    revoked.$cloudCodeField.hidden === true
    && /withdrawn/i.test(revoked.statusText), revoked.statusText);

  const asked = rig(welcome, "requestCode", json(429, { detail: "slow down" }), { codeFieldHidden: true });
  await asked.requestCode();
  check("a refused request reveals nothing",
    asked.$cloudCodeField.hidden === true && asked.$resendCodeBtn.hidden === true,
    "a box the user can fill when no mail is coming is worse than no box");
  // The roster always answers 200; a 429 is the rate limiter, and burying it
  // under the generic sentence sends the user to retype an address that was
  // never the problem.
  check("a rate limit says so instead of blaming the address",
    /Too many attempts/i.test(asked.statusText), asked.statusText);

  const again = rig(welcome, "requestCode", json(200, { sent: false, reason: "try_again" }), { codeFieldHidden: true });
  await again.requestCode();
  check("an admitted address whose code could not be stored says try again",
    /try again in a moment/i.test(again.statusText) && again.$cloudCodeField.hidden === true,
    again.statusText);

  const busted = rig(welcome, "requestCode", json(502, { detail: "unavailable" }), { codeFieldHidden: true });
  await busted.requestCode();
  check("a 5xx is cloud trouble, not a bad email",
    /Brotto Cloud had a problem/i.test(busted.statusText), busted.statusText);
  const dropped = rig(welcome, "requestCode", async () => { throw new Error("network down"); }, { codeFieldHidden: true });
  await dropped.requestCode();
  check("and neither does one that never reached the server",
    dropped.$cloudCodeField.hidden === true);

  const blankAddr = rig(welcome, "requestCode", json(200, { sent: true }), { codeFieldHidden: true });
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
  check("and puts Send code back, ready for the next address",
    afterGood.$sendCodeRow.hidden === false);

  check("the resend button is the same call, not a second flow",
    /\$resendCodeBtn\.addEventListener\("click", \(\) => \{ void requestCode\(\); \}\)/.test(welcome));
  check("the screen never shows a code field and a Send code button together",
    !/id="cloudCode"[\s\S]{0,400}id="sendCodeBtn"/.test(welcomeHtml),
    "the box opens on the send; it is not on screen asking to be filled first");
  check("the next field is titled Code, and says where to look",
    /<label[^>]*for="cloudCode">\s*Code\s*<\/label>/.test(welcomeHtml)
    && /Check your mail for the code\./.test(welcomeHtml));

  // ── Greeting ───────────────────────────────────────────────────────────
  // The only name Brotto ever holds is one the user typed on the waitlist
  // form, so it is written on a successful signup and read back. Nothing new
  // about the person leaves the browser to earn it.
  const named = rig(welcome, "exchangeCode", json(200, { access_token: TOKEN, approved: true }));
  named.stored = { settings: { accountName: "Ada Lovelace" } };
  check("an exchange reads the stored name back",
    (await named.exchangeCode()) === true && named.$agentSecret.value === TOKEN);

  // Only a field the user filled in may write one. Two occurrences of the
  // name in a file — the definition and a single call, inside joinWaitlist.
  {
    const body = code(welcome);
    check("wizard: an account name is written in exactly one place",
      body.split("rememberAccountName(").length === 3
      && code(extract(welcome, "joinWaitlist")).includes("rememberAccountName(name)"),
      `${body.split("rememberAccountName(").length - 1} occurrences`);
    check("panel: no account-name writer is left behind",
      !/rememberAccountName|storedAccountName/.test(sidepanel));
  }

  // ── `approved` ──────────────────────────────────────────────────────────
  // A report, not the gate: an unlisted address and an unreachable control
  // plane both come back as a valid token, a 200 and `false`. So the token
  // is stored either way — dropping it would strand an address the operator
  // approves later — and what changes is the sentence and the waitlist box.
  const wizOff = rig(welcome, "exchangeCode", json(200, { access_token: TOKEN, approved: false }));
  check("the wizard stores the token on an unlisted address",
    (await wizOff.exchangeCode()) === true && wizOff.$agentSecret.value === TOKEN);
  check("says so, and offers the waitlist the same address",
    /beta/i.test(wizOff.statusText)
    && wizOff.$waitlistEmail.value === "person@example.com", wizOff.statusText);
  check("and opens the waitlist toggle on that path too",
    wizOff.$waitlistBlock.open === true);
  const wizOn = rig(welcome, "exchangeCode", json(200, { access_token: TOKEN, approved: true }));
  check("and an approved wizard sign-in is an ordinary sign-in",
    (await wizOn.exchangeCode()) === true && /^signed in$/i.test(wizOn.statusText.trim()), wizOn.statusText);

  // Additive means additive: a server too old to send the field must not read
  // as a refusal, or every install on it would be told it is not in the beta.
  const noField = rig(welcome, "exchangeCode", json(200, { access_token: TOKEN }));
  check("a response with no `approved` at all is not a refusal",
    (await noField.exchangeCode()) === true
    && /signed in/i.test(noField.statusText), noField.statusText);

  // Truthiness is the bug here: an absent field is `undefined`, and
  // `if (body.approved)` would make every pre-cloud server a refusal.
  check("it is compared against false, never truthiness",
    /body\.approved === false/.test(code(welcome))
    && !/if \(body\.approved\)|body\.approved \?|!body\.approved\)/.test(code(welcome)));

  // A refusal on a response that carries no token is not a refusal at all —
  // the failure path wins, so nothing here can say "not in the beta" about a
  // sign-in that never happened.
  const badAndOff = rig(welcome, "exchangeCode", json(400, { approved: false }));
  check("a refused code is a refused code, not a closed beta",
    (await badAndOff.exchangeCode()) === false
    && /did not work/i.test(badAndOff.statusText)
    && badAndOff.$waitlistEmail.value === "", badAndOff.statusText);

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
  // is typed into this flow, and it lands in a toast / status line.
  const toastSrc = code(extract(welcome, "toast"));
  check("the wizard's toast is textContent",
    /\.textContent = text/.test(toastSrc) && !/innerHTML/.test(toastSrc), toastSrc);
  check("and its status writers open no second sink",
    !/innerHTML/.test(code(extract(welcome, "setCloudStatus")))
    && !/innerHTML/.test(code(extract(welcome, "setWaitlistStatus"))));
  check("and neither interpolates the email into markup",
    !/innerHTML[\s\S]{0,120}(email|token|code|access_token)/.test(code(welcome) + code(sidepanel)));
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
  check("the wizard's code input is numeric and six wide",
    /id="cloudCode"[\s\S]{0,80}maxlength="6"/.test(welcomeHtml));
  check("and it is asked for by name",
    /id="sendCodeBtn"/.test(welcomeHtml));

  // ── The panel's copy of this flow is gone ───────────────────────────────
  for (const fn of ["exchangeSignInCode", "requestSignInCode", "greetOnSignIn",
                    "setCloudStatus", "storeAgentSecret", "signOutOfCloud"]) {
    check(`panel: no ${fn} left behind`,
      !new RegExp(`function ${fn}\\b`).test(sidepanel), "the wizard is the one place to sign in");
  }
  for (const id of ["cloudCodeBtn", "cloudSignInBtn", "cloudSignOutBtn", "cloudResendBtn"]) {
    check(`panel: #${id} is deleted, not hidden`, !panelHtml.includes(`id="${id}"`));
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
