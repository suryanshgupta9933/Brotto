// The waitlist, in the two places it lives: the panel's Settings and the
// wizard. One function in each file, extracted by brace matching and run
// against a fake fetch, so this cannot pass while the real one is broken.
//
// `POST /v1/waitlist` takes an address and an OPTIONAL `name`, and answers
// `{"ok": true}` for a new address and for one already on the list alike —
// deliberately, so the route cannot be asked who is on it. Two consequences
// this pins: the body carries the name the moment the field exists, and the
// sentence after a 200 is the same one for both outcomes.
//
//   node scripts/test-waitlist.test.js

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

// Comments are stripped before a source is asserted on: both writers explain
// themselves by naming innerHTML, and a check that trips on the explanation
// defeats the rule it states.
const code = (s) => s.replace(/^\s*\/\/.*$/gm, "");

function json(okStatus, body) {
  return async () => ({ ok: okStatus < 400, status: okStatus, json: async () => body });
}

/** The fields, the two writers, and a fetch that records what it was sent. */
function rig(src, respond) {
  const calls = [];
  const status = { textContent: "", className: "" };
  const sandbox = {
    calls,
    status,
    email: { value: "person@example.com" },
    name: { value: "Ada Lovelace" },
    $serverUrl: { value: "https://agent.brotto.dev" },
    // The one element `setWaitlistStatus` looks up.
    document: { getElementById: (id) => (id === "waitlistStatus" ? status : null) },
    fetch: async (url, opts) => {
      calls.push({ url, method: opts.method, headers: opts.headers, body: opts.body });
      return respond(url, opts);
    },
    serverBase() { return "https://agent.brotto.dev"; },
    chrome: {
      storage: {
        local: {
          get: async () => ({ settings: sandbox.saved || {} }),
          set: async (o) => { sandbox.saved = o.settings; sandbox.stored = o; },
        },
      },
    },
  };
  // The wizard names its inputs with `$` and posts to the field's value; the
  // panel uses bare names and `serverBase()`. Same contract, so one rig.
  sandbox.waitlistEmail = sandbox.$waitlistEmail = sandbox.email;
  sandbox.waitlistName = sandbox.$waitlistName = sandbox.name;
  vm.createContext(sandbox);
  vm.runInContext(extract(src, "setWaitlistStatus"), sandbox);
  vm.runInContext(extract(src, "postAuth"), sandbox);
  vm.runInContext(extract(src, "joinWaitlist"), sandbox);
  vm.runInContext(extract(src, "prefillWaitlist"), sandbox);
  vm.runInContext(extract(src, "rememberAccountName"), sandbox);
  return sandbox;
}

async function runSurface(label, src) {
  const good = rig(src, json(200, { ok: true }));
  const ok = await good.joinWaitlist();
  check(`${label}: a signup posts to the waitlist route on the server it is pointed at`,
    good.calls.length === 1 && good.calls[0].url === "https://agent.brotto.dev/v1/waitlist",
    JSON.stringify(good.calls));
  check(`${label}: as JSON, carrying the name`,
    good.calls[0].method === "POST"
    && good.calls[0].headers["Content-Type"] === "application/json"
    && good.calls[0].body === JSON.stringify({ email: "person@example.com", name: "Ada Lovelace" }),
    good.calls[0].body);
  check(`${label}: with no credential — this is the one route that answers a caller holding none`,
    !("Authorization" in (good.calls[0].headers || {})), JSON.stringify(good.calls[0].headers));
  check(`${label}: returns true and marks the line ok`,
    ok === true && good.status.className.endsWith("ok"), good.status.className);
  // A duplicate answers identically, so a sentence claiming membership is
  // false for one of the two outcomes the server actually returns.
  check(`${label}: never claims to know whether the address was already on it`,
    !/on the list|already (signed up|on)|you'?re in/i.test(good.status.textContent), good.status.textContent);
  check(`${label}: names the address it will be emailed at`,
    /person@example\.com/.test(good.status.textContent), good.status.textContent);

  const untidy = rig(src, json(200, { ok: true }));
  untidy.email.value = "  person@example.com  ";
  untidy.name.value = "  Ada  ";
  await untidy.joinWaitlist();
  check(`${label}: both fields are trimmed before they leave`,
    untidy.calls[0].body === JSON.stringify({ email: "person@example.com", name: "Ada" }), untidy.calls[0].body);

  const noName = rig(src, json(200, { ok: true }));
  noName.name.value = "   ";
  await noName.joinWaitlist();
  check(`${label}: an empty name is sent as empty, not dropped as undefined`,
    noName.calls[0].body === JSON.stringify({ email: "person@example.com", name: "" }), noName.calls[0].body);

  // There is exactly ONE neutraliser for a formula, and it is the server's
  // `build_row` (plus the migration's CHECK). A client-side one would be a
  // second implementation that could disagree with it — the same reason
  // `is_secret_field` lives in the server and not in a relay. So the name
  // reaches the wire with its leading `=` intact, and the client does not
  // quietly mangle a name into something the operator did not type.
  const formula = rig(src, json(200, { ok: true }));
  formula.name.value = "=cmd|' /C calc'!A0";
  await formula.joinWaitlist();
  check(`${label}: a name that a spreadsheet would run reaches the wire untouched`,
    formula.calls[0].body === JSON.stringify({ email: "person@example.com", name: "=cmd|' /C calc'!A0" }),
    formula.calls[0].body);

  const blank = rig(src, json(200, { ok: true }));
  blank.email.value = "  ";
  const blankOk = await blank.joinWaitlist();
  check(`${label}: no address, no request`,
    blankOk === false && blank.calls.length === 0 && blank.status.className.endsWith("bad"),
    `${blank.calls.length} calls, ${blank.status.className}`);

  const throttled = rig(src, json(429, { detail: "too many attempts" }));
  check(`${label}: a throttled signup is not a signup`,
    (await throttled.joinWaitlist()) === false && throttled.status.className.endsWith("bad"),
    throttled.status.className);
  check(`${label}: and the sentence sends them back later`,
    /few minutes/i.test(throttled.status.textContent), throttled.status.textContent);

  const offline = rig(src, async () => { throw new Error("network down"); });
  check(`${label}: a server that is not there says so rather than throwing`,
    (await offline.joinWaitlist()) === false && /could not reach/i.test(offline.status.textContent),
    offline.status.textContent);

  // The status line carries a typed address, so this is the panel's rule and
  // not a convenience: textContent, never innerHTML.
  const writer = code(extract(src, "setWaitlistStatus"));
  check(`${label}: the status line is textContent, never innerHTML`,
    /\.textContent = text \|\| ['"]/.test(writer) && !/innerHTML/.test(writer), writer);

  // The prefill is the refusal's convenience, not the form's default — an
  // address already typed is the user's own answer.
  const typed = rig(src, json(200, { ok: true }));
  typed.email.value = "someone-else@example.com";
  typed.prefillWaitlist("person@example.com");
  check(`${label}: the refusal's prefill never overwrites an address already typed`,
    typed.email.value === "someone-else@example.com", typed.email.value);

  const empty = rig(src, json(200, { ok: true }));
  empty.prefillWaitlist("person@example.com");
  check(`${label}: and fills a blank one`, empty.email.value === "person@example.com", empty.email.value);
}

(async () => {
  await runSurface("panel", sidepanel);
  await runSurface("wizard", welcome);

  // ── The shape both surfaces agree on ───────────────────────────────────
  // The server answers this route only when `auth_mode` is `jwt`, and each
  // surface reveals its cloud block on exactly that answer — so the markup
  // has to sit inside it. A waitlist form anywhere else posts to a 404.
  for (const [label, html, openId] of [
    ["panel", panelHtml, 'id="cloudSignIn"'],
    ["wizard", welcomeHtml, 'id="cloudFields"'],
  ]) {
    const open = html.indexOf(openId);
    const block = html.indexOf('id="waitlistBlock"');
    check(`${label}: the waitlist lives inside the cloud-only block, and after it`,
      open > -1 && block > open, `cloud@${open} waitlist@${block}`);
    check(`${label}: it asks for a name, an email, and offers one button`,
      /id="waitlistName"[\s\S]{0,120}maxlength="64"/.test(html)
      && /id="waitlistEmail"/.test(html) && /id="waitlistJoinBtn"/.test(html));
    check(`${label}: the name reads as optional on screen, not only in the route`,
      /for="waitlistName">\s*Name \(optional\)/.test(html));
  }

  // Both surfaces post through their own `postAuth`, which is the same
  // function the exchange uses — so a waitlist signup cannot drift into
  // carrying a credential the route never asked for.
  check("both post through the shared auth helper, not a second fetch call site",
    code(sidepanel).includes("await postAuth('/v1/waitlist'")
    && code(welcome).includes('await postAuth("/v1/waitlist"'));

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();