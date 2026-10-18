// An approval the user cannot see must not be answerable in one tap.
//
// The panel card is the whole safety story for a coordinate approval: it draws
// the screenshot, the crosshair, and — for a `type_xy` — the entire typed
// value. The server's `reasoning` for that frame deliberately carries none of
// it ("the text shown below this card"), so the prose only makes sense on that
// surface. A notification cannot render a card, so when the notification also
// offered an Approve button it was asking the user to consent to an unseen
// action: they read a sentence pointing at a card that was not there, tapped
// Approve, and the value went into their spreadsheet.
//
// Three things therefore have to hold, and each fails as an *absence*, which is
// what makes them worth a test:
//
//   - a coordinate approval_request (the only kind that carries `viewport`)
//     produces a notification with no buttons at all;
//   - every *other* approval_request still gets Approve / Not now. This is the
//     regression guard: a fix that suppressed buttons globally would pass the
//     first check and break every ordinary prompt;
//   - the coordinate message is self-contained — no "card", no "shown below",
//     no reference to a surface the notification cannot draw.
//
// `notify()` itself is extracted too, so the assertion is on what reaches
// chrome.notifications.create rather than on the shape of the argument.
//
//   node scripts/test-approval-notification.test.js

"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src", "background.ts");
const source = fs.readFileSync(SRC, "utf8");

function sliceFunction(name) {
  const start = source.search(new RegExp(`^(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} in background.ts — renamed?`);
  let parens = 0;
  let bodyStart = -1;
  for (let i = source.indexOf("(", start); i < source.length; i++) {
    if (source[i] === "(") parens++;
    else if (source[i] === ")" && --parens === 0) { bodyStart = source.indexOf("{", i); break; }
  }
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

// Strip just enough TypeScript for eval: parameter/return annotations and the
// two `as` casts in these two functions. Nothing else is type syntax.
function js(fn) {
  return fn
    .replace(/function maybeNotify\(event: Record<string, unknown>\): void/, "function maybeNotify(event)")
    .replace(/function notify\(id: string, spec: NotificationSpec\): void/, "function notify(id, spec)")
    .replace(/event\.type as string/g, "event.type")
    .replace(/ as chrome\.notifications\.NotificationOptions<true>/g, "");
}

// Runs maybeNotify over a recording chrome.notifications stub and returns
// every notification it created.
function notificationsFor(event) {
  const created = [];
  const sandbox = {
    chrome: {
      notifications: { create: (id, opts) => { created.push({ id, opts }); } },
      runtime: { getURL: (p) => p, lastError: undefined },
    },
    // Module-level flags maybeNotify reads. notifyBlocking defaults to true in
    // the worker, which is the case where the notification fires at all.
    notifyBlocking: true,
    notifyResults: true,
    panelConnected: false,
    panelWatching: false,
    console: { log() {}, error() {} },
  };
  const factory = new Function(
    "chrome",
    "notifyBlocking",
    "notifyResults",
    "panelConnected",
    "panelWatching",
    "console",
    `${js(sliceFunction("notify"))}\n${js(sliceFunction("maybeNotify"))}\nreturn maybeNotify;`
  );
  factory(
    sandbox.chrome, true, true, false, false, sandbox.console
  )(event);
  return created;
}

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL  ${name}\n      ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function titles(opts) {
  return (opts.buttons || []).map((b) => b.title);
}

console.log("a coordinate approval is not answerable from the notification");

const coordinate = {
  type: "approval_request",
  id: "approval-1",
  reason: "a press, a release, and then the text shown below this card inserted at that point",
  action: { type: "type_xy" },
  args: { text: "quarterly revenue" },
  screenshot: "data:image/jpeg;base64,AAAA",
  viewport: { width: 1280, height: 800 },
  url: "https://example.com/sheet",
};

const ordinary = {
  type: "approval_request",
  id: "approval-2",
  reason: "This will submit your credit card details to example.com.",
  action: { type: "submit_form", url: "https://example.com/pay" },
};

check("a coordinate approval_request still fires exactly one notification", () => {
  const created = notificationsFor(coordinate);
  assert(created.length === 1, `expected one notification, got ${created.length}`);
  assert(created[0].id === "approval:approval-1", `wrong id: ${created[0].id}`);
});

check("the coordinate notification offers no Approve action", () => {
  const [n] = notificationsFor(coordinate);
  const t = titles(n.opts);
  assert(!t.includes("Approve"), `Approve is offered on a notification: ${JSON.stringify(t)}`);
  assert(t.length === 0, `expected no buttons at all, got ${JSON.stringify(t)}`);
});

check("the coordinate message is self-contained", () => {
  const [n] = notificationsFor(coordinate);
  const m = String(n.opts.message || "");
  assert(m.length > 0, "the notification has no message at all");
  for (const banned of ["card", "below", "crosshair", "shown", "quarterly revenue"]) {
    assert(
      !m.toLowerCase().includes(banned),
      `the message points at a surface the notification cannot draw: "${m}"`
    );
  }
  assert(/panel/i.test(m), `the message does not tell the user where to approve: "${m}"`);
});

check("an ordinary approval_request still gets Approve / Not now", () => {
  const created = notificationsFor(ordinary);
  assert(created.length === 1, `expected one notification, got ${created.length}`);
  const t = titles(created[0].opts);
  assert(t.includes("Approve"), `Approve is gone from an ordinary approval: ${JSON.stringify(t)}`);
  assert(t.includes("Not now"), `Not now is gone from an ordinary approval: ${JSON.stringify(t)}`);
});

check("an ordinary approval keeps the server's own sentence", () => {
  const [n] = notificationsFor(ordinary);
  assert(
    n.opts.message === ordinary.reason,
    `the ordinary message changed: ${JSON.stringify(n.opts.message)}`
  );
});

check("login_required and clarify_request are untouched by the coordinate rule", () => {
  const login = notificationsFor({ type: "login_required", domain: "example.com" })[0];
  assert(!login.opts.buttons, "login_required grew buttons");
  assert(/example\.com/.test(login.opts.message), `login message lost its domain: ${login.opts.message}`);
  const clarify = notificationsFor({ type: "ask_human_clarify", question: "Which one?" })[0];
  assert(!clarify, "clarify_request should not be routed through approval_request");
});

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);