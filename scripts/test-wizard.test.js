// Which Brotto? One wizard, two editions, one build.
//
// The hosted lock-out used to be `HOSTED_SERVER_URL` compared against the
// address the user typed — a guess that a trailing slash, a typed `http://`
// or a case difference each defeats, and which left an empty constant sitting
// in the shipping file waiting to be filled in. The server knows which one it
// is and says so in `/health`'s `auth_mode`, so the panel derives it from
// there. This file asserts the constant is GONE: an absence is exactly what
// reads clean in review, and a constant that is empty today is a constant
// that gets filled in tomorrow.
//
// The storage shape is the other half. The cloud token lands in the existing
// `settings.agentSecret` slot, so there is no migration, no second slot, and
// nothing downstream that has to know which kind of token it holds.
//
//   node scripts/test-wizard.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "clients", "brotto-extension", "src");
const sidepanel = fs.readFileSync(path.join(EXT, "sidepanel.js"), "utf8");
const welcome = fs.readFileSync(path.join(EXT, "welcome.js"), "utf8");
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

// ── The constant is gone ──────────────────────────────────────────────────
check("HOSTED_SERVER_URL is deleted from sidepanel.js",
  !/const HOSTED_SERVER_URL/.test(sidepanel),
  "an empty literal built to be filled in, and the hosted state was a string comparison against typed text");
check("and the derived lock-out went with it",
  !/plannerUrlSetting\.value\.trim\(\) === /.test(sidepanel),
  "compare the field against a constant and you have re-created the guess");
check("nothing compares the address to a literal to decide hosted",
  !/=== CLOUD_SERVER_URL/.test(sidepanel),
  "serverBase() may FALL BACK to the cloud address, never use it as the mode test");
check("the cloud address is a default, and says so",
  /not the mode\s+(\/\/\s*)?test: the mode still comes from \/health/.test(sidepanel));

// ── The mode comes from the server ────────────────────────────────────────
check("the panel reads auth_mode off /health",
  /auth_mode/.test(sidepanel) && /readAuthMode/.test(sidepanel));
check("a body that is not JSON cannot throw into the caller",
  /async function readAuthMode\([\s\S]{0,320}catch \{\s*return null;/.test(sidepanel),
  "the init path reads a throw as 'server unreachable', which is the one diagnosis this file exists to get right");
check("only jwt is cloud",
  /state\.authMode === 'jwt'/.test(sidepanel),
  "'open' and 'secret' are both self-host and must render exactly as before");

// ── serverBase() run against the three states ─────────────────────────────
const SRC = extract(sidepanel, "serverBase");

function baseFor({ authMode, typed }) {
  const sandbox = { state: { authMode }, plannerUrlEl: { value: typed }, CLOUD_SERVER_URL: "https://agent.brotto.dev" };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.serverBase();
}

check("a self-hoster with a blank field still gets localhost",
  baseFor({ authMode: "secret", typed: "" }) === "http://localhost:8000");
check("a self-hoster with an address gets that address",
  baseFor({ authMode: "secret", typed: "http://10.0.0.5:9000/" }) === "http://10.0.0.5:9000");
check("an unknown mode is still self-host",
  baseFor({ authMode: null, typed: "" }) === "http://localhost:8000",
  "a server that predates auth_mode must not be read as cloud");
check("a cloud server is never localhost",
  baseFor({ authMode: "jwt", typed: "" }) === "https://agent.brotto.dev",
  "the blank-field fallback is right for a self-hoster and wrong for a cloud user");

// ── One storage slot ──────────────────────────────────────────────────────
check("the wizard saves the token into settings.agentSecret",
  /settings:\s*\{[\s\S]{0,240}agentSecret:/.test(welcome),
  "a new key means a migration and a second reader");
check("no second token slot was invented",
  !/chrome\.storage\.(local|session)\.set\(\{\s*(cloud|jwt|access)/i.test(welcome + sidepanel));
check("nothing parses the token's kind",
  !/access_token\.(split|\.length|startsWith|indexOf)|eyJ/.test(welcome + sidepanel),
  "a JWT has dots in it and that is not a licence to inspect it");
check("the panel writes it through the same slot",
  /settings:\s*\{\s*\.\.\.\(stored\.settings \|\| \{\}\),\s*agentSecret: value/.test(sidepanel));

// ── The wizard asks which one, first ──────────────────────────────────────
const steps = [...welcomeHtml.matchAll(/data-step="(\d+)"/g)].map((m) => m[1]);
check("there are four steps and they are numbered in order",
  steps.join(",") === "1,2,3,4", steps.join(","));
check("the count in the markup agrees with the constant",
  /Step 1 of 4/.test(welcomeHtml) && /const TOTAL_STEPS = 4;/.test(welcome));
check("the edition choice is the FIRST step",
  /data-step="1"[\s\S]{0,120}Which Brotto\?/.test(welcomeHtml));
check("it is a radio pair, and self-host is the default",
  /name="edition"/.test(welcomeHtml) && /id="editionSelf"[^>]*value="self"[^>]*checked|value="self"[^>]*checked/.test(welcomeHtml),
  "skipping the wizard must land on today's behaviour, which is self-host");
check("both editions exist by name",
  /Brotto Cloud/.test(welcomeHtml) && /Self-host/.test(welcomeHtml));

// ── What each edition renders ─────────────────────────────────────────────
const APPLY = extract(welcome, "applyEdition");

function applyEditionTo(selfChecked, cloudChecked, serverUrl) {
  const sandbox = {
    $selfHostFields: { hidden: false },
    $cloudFields: { hidden: false },
    $serverUrl: { ...serverUrl, classList: { toggle() {} } },
    $serverUrlHint: { textContent: "" },
    $serverStatus: { textContent: "", className: "" },
    $cloudStatus: { textContent: "", className: "" },
    edition() { return cloudChecked ? "cloud" : "self"; },
    setCloudStatus() {},
    CLOUD_SERVER_URL: "https://agent.brotto.dev",
    CLOUD_HINT: "cloud hint",
    SELF_HOST_HINT: "self hint",
  };
  vm.createContext(sandbox);
  vm.runInContext(APPLY, sandbox);
  sandbox.applyEdition();
  return sandbox;
}

const selfRun = applyEditionTo(true, false, { value: "http://localhost:8000", readOnly: false });
check("self-host leaves the address editable", selfRun.$serverUrl.readOnly === false);
check("self-host keeps the address the user has", selfRun.$serverUrl.value === "http://localhost:8000");
check("self-host shows the key field", selfRun.$selfHostFields.hidden === false);
check("self-host hides the sign-in block", selfRun.$cloudFields.hidden === true);

const cloudRun = applyEditionTo(false, true, { value: "", readOnly: false });
check("cloud prefills the address rather than leaving it blank", cloudRun.$serverUrl.value === "https://agent.brotto.dev");
check("cloud locks the address", cloudRun.$serverUrl.readOnly === true);
check("cloud hides the AGENT_SECRET field", cloudRun.$selfHostFields.hidden === true);
check("cloud shows email and code", cloudRun.$cloudFields.hidden === false);

// ── The self-host path is unchanged ───────────────────────────────────────
// This is the promise the contract makes about self-host, and it is an
// absence: nothing here grew a branch, so assert the original check is
// still the original check.
check("checkServer still probes /health then /v1/policy",
  /\/health[\s\S]{0,400}\/v1\/policy/.test(welcome));
check("and still reads a refused key as the 404 it is",
  /authed\.status === 404/.test(welcome) && /rejected|refused/i.test(welcome),
  "403 would confirm the route; 404 without this check reads as a missing endpoint");
check("a blank key does not trigger the authenticated probe",
  /if \(secret\) \{/.test(welcome));
check("and an unreachable server still says so in its own words",
  /No answer — check the address/.test(welcome));

// ── The panel's Connection section ────────────────────────────────────────
check("the secret field has an id to hide", /id="agentSecretField"/.test(panelHtml));
check("the cloud block has an id to show", /id="cloudSignIn"/.test(panelHtml));
check("and it starts hidden",
  /id="cloudSignIn" hidden/.test(panelHtml),
  "a self-hoster opening Settings must see exactly the screen they saw before");
for (const id of ["cloudEmail", "cloudCode", "cloudCodeBtn", "cloudSignInBtn", "cloudSignOutBtn", "cloudSignInStatus"]) {
  check(`the panel markup has #${id}`, new RegExp(`id="${id}"`).test(panelHtml));
}
check("every id the panel JS queries exists in the markup",
  [...sidepanel.matchAll(/getElementById\('(cloud[A-Za-z]+|agentSecretField)'\)/g)]
    .every((m) => panelHtml.includes(`id="${m[1]}"`)),
  "an id the JS queries that the markup lacks is invisible in a diff");
check("the code field is six digits wide",
  /id="cloudCode"[\s\S]{0,80}maxlength="6"/.test(welcomeHtml + panelHtml));

// ── No new permission ─────────────────────────────────────────────────────
// The 6-digit code exists precisely so the listing does not have to be
// reopened mid-review for `chrome.identity`.
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "clients", "brotto-extension", "manifest.json"), "utf8"));
const perms = manifest.permissions || [];
check("no identity permission was added", !perms.includes("identity"), perms.join(", "));
check("and no identity or unlimitedStorage call anywhere in the client",
  !/chrome\.identity|unlimitedStorage/.test(welcome + sidepanel));

// ── Signing out ───────────────────────────────────────────────────────────
// A stale token in the slot is a server refusing every call with a 404,
// which reads exactly like a wrong AGENT_SECRET.
const SIGNOUT = extract(sidepanel, "signOutOfCloud");
check("signing out clears the slot", /storeAgentSecret\(''\)/.test(SIGNOUT));
check("and lands back on the wizard, not on a dead token",
  /setOptions\(\{ path: 'welcome\.html' \}\)/.test(SIGNOUT));
check("the wizard pre-selects cloud from the stored address",
  /CLOUD_SERVER_URL === \$serverUrl\.value\.trim\(\)\)/.test(welcome),
  "otherwise a signed-out cloud user lands on the self-host form with their address already filled in");

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);