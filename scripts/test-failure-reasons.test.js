// `failure_reason` is a code, and every code the server can send has a
// sentence in the panel.
//
// The contract is written down at sidepanel.js:2466 — "the server's
// failure_reason is a code for the log … every one of them is translated here
// into a sentence and a next step." Nothing enforced it, and two paths broke
// it the same way: `cannot_complete` shipped the agent's own prose as the
// reason, and `budget_exhausted` was emitted with no entry at all. Both landed
// on `failureNote`'s fallthrough, so the user was told "Something went wrong.
// The details are in Brotto's log" — about a reason that was in the transcript
// in plain English, or about a cost cap the user had set themselves.
//
// A missed lookup is an *absence*, and an absence reads clean in review. This
// enumerates the codes rather than the sentences, so a new one shows up here
// without anyone remembering this file.
//
//   node scripts/test-failure-reasons.test.js

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PANEL = path.join(ROOT, "clients", "brotto-extension", "src", "sidepanel.js");
const PY = path.join(ROOT, "services", "brotto-orchestrator", "src", "brotto_orchestrator");

const panel = fs.readFileSync(PANEL, "utf8");

const SERVER_FILES = ["main.py", path.join("agent", "harness.py")];

/** Every assignment to `failure_reason` in the server, as {file, line, text}. */
function assignments() {
  const out = [];
  for (const file of SERVER_FILES) {
    const src = fs.readFileSync(path.join(PY, file), "utf8");
    src.split("\n").forEach((line, i) => {
      if (/\bd\s*:/.test(line)) return; // a comment, not an assignment
      if (!/failure_reason["']?\s*[:=]/.test(line)) return;
      out.push({ file, line: i + 1, text: line.trim() });
    });
  }
  return out;
}

/**
 * Every code the server can put in a TaskResult or a frame.
 *
 * *All* the literals on the line, not the first: the reason a code goes
 * missing is a conditional —
 * `failure_reason="policy_preflight" if preflight else "cannot_complete"` —
 * and a match that stops at the first literal enumerates one of the two
 * branches and calls the coverage complete.
 */
function serverReasons() {
  const found = new Map();
  for (const a of assignments()) {
    for (const m of a.text.matchAll(/["']([a-z_]+)["']/g)) {
      if (m.index < a.text.indexOf("failure_reason")) continue;
      found.set(m[1], `${a.file}:${a.line}`);
    }
  }
  return found;
}

/** Every `failure_reason=` carrying NO literal at all — a bug if any exist. */
function nonLiteralReasons() {
  return assignments().filter((a) => !/["'][a-z_]+["']/.test(a.text.slice(a.text.indexOf("failure_reason"))));
}

/** The keys of FAILURE_NOTE, read out of the source rather than restated. */
function noteKeys() {
  const start = panel.search(/const FAILURE_NOTE = \{/);
  if (start < 0) throw new Error("no FAILURE_NOTE table in sidepanel.js — renamed?");
  const body = panel.slice(start, panel.indexOf("\n};", start));
  return new Set([...body.matchAll(/^\s*([A-Za-z_]+):/gm)].map((m) => m[1]));
}

/**
 * Every code the *extension* writes, from background.ts.
 *
 * Same contract as above and the same trap: six client-side conditions
 * (START_FAILED, NO_ACTIVE_TAB, TASK_ERROR, CANCELLED, WS_ERROR,
 * CONNECTION_LOST) all reached the panel and all landed on the fallthrough,
 * so a task the user cancelled was reported as "Something went wrong. The
 * details are in Brotto's log" — and there is no Brotto log holding a tab
 * that was never focused.
 */
function clientReasons() {
  const worker = fs.readFileSync(
    path.join(ROOT, "clients", "brotto-extension", "src", "background.ts"), "utf8");
  const found = new Map();
  for (const m of worker.matchAll(/failure_reason:\s*"([A-Za-z_]+)"/g)) {
    const line = worker.slice(0, m.index).split("\n").length;
    found.set(m[1], `background.ts:${line}`);
  }
  return found;
}

const reasons = serverReasons();
const client = clientReasons();
const notes = noteKeys();

// Three entries the panel names for itself rather than receiving. They are
// rendered through the same table so the transcript cannot carry two
// vocabularies, and each one is reachable only from sidepanel.js itself.
const PANEL_ALIAS = {
  server_error: "task_error",       // the frame the panel renders it for
  disconnected: "CONNECTION_LOST",  // the socket dropping mid-task
  service_worker: null,             // the worker not answering: no wire code at all
};

let failed = 0;
function check(ok, label, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  failed++;
  console.log(`FAIL  ${label}`);
  if (detail) console.log(`      ${detail}`);
}

console.log(`server reasons found: ${[...reasons.keys()].sort().join(", ")}`);
console.log(`client reasons found: ${[...client.keys()].sort().join(", ")}`);
console.log(`FAILURE_NOTE keys:    ${[...notes].sort().join(", ")}\n`);

console.log("every code the server sends has a sentence the user can read");
for (const [reason, file] of [...reasons].sort()) {
  check(
    notes.has(reason),
    `${reason} has a FAILURE_NOTE entry`,
    `emitted by ${file}; failureNote() falls through to "the details are in ` +
      `Brotto's log" for an unmapped code`,
  );
}

console.log("\nevery code the extension writes has a sentence too");
for (const [reason, file] of [...client].sort()) {
  check(
    notes.has(reason),
    `${reason} has a FAILURE_NOTE entry`,
    `emitted by ${file}; it is a client-side condition, so the fallthrough ` +
      `points the user at a log that never saw it`,
  );
}

console.log("\nfailure_reason is always a literal");
for (const hit of nonLiteralReasons()) {
  check(false, "failure_reason is a code, not a sentence", hit);
}
check(
  nonLiteralReasons().length === 0,
  "no failure_reason carries free text or an expression",
  "a code that is not a constant cannot be looked up; the agent's prose " +
    "belonged in `summary`, which is the detail the panel appends under the note",
);

// ── every code is reportable, or the ledger has a hole in it ──────────────
//
// `failure_reports` (session/failure_report.py) answers "did the run happen,
// and if not which of our fixed codes says why" — which is only answerable if
// the codes it accepts are the codes we emit. REPORTABLE is a restated list,
// so this is what keeps it honest: a new `failure_reason` that nobody added
// there is a failure the operator cannot see, and a missing entry is an
// *absence*, which reads clean in review.
console.log("\nevery code is one the failure-report ledger accepts");
const reportable = new Set();
{
  const py = fs.readFileSync(path.join(PY, "session", "failure_report.py"), "utf8");
  // Exactly two sets, each sliced from its own assignment. CLIENT_STAGE and
  // SERVER_STAGES sit between them and are stages, not codes — one
  // `start…end` slice across the whole region swallowed them too, and every
  // stage then looked like a code with no sentence in the panel. REPORTABLE
  // is `CLIENT_CODES | frozenset({ … })`, so it carries two `frozenset`
  // tokens and only the second one opens its literal list.
  for (const name of ["CLIENT_CODES", "REPORTABLE"]) {
    const assign = py.indexOf(`${name}${name === "REPORTABLE" ? ":" : ""} `);
    if (assign < 0) throw new Error(`no ${name} assignment in failure_report.py — renamed?`);
    const from = py.indexOf("frozenset", assign);
    const open = py.indexOf("{", from);
    const end = py.indexOf("})", open);
    if (from < 0 || open < 0 || end < 0) throw new Error(`could not slice ${name} — changed shape?`);
    for (const m of py.slice(open, end).matchAll(/["']([A-Za-z_]+)["']/g)) reportable.add(m[1]);
  }
}
const notReported = new Set();
{
  const py = fs.readFileSync(path.join(PY, "session", "failure_report.py"), "utf8");
  const start = py.indexOf("NOT_REPORTED = frozenset");
  if (start < 0) throw new Error("no NOT_REPORTED set in failure_report.py — renamed?");
  for (const m of py.slice(start, py.indexOf("})", start)).matchAll(/["']([A-Za-z_]+)["']/g)) {
    notReported.add(m[1]);
  }
}
console.log(`reportable codes:     ${[...reportable].sort().join(", ")}\n`);

// The authoritative direction, and the one the audit found unenforced: the
// *ledger* is the vocabulary, not the assignments. Six codes reach the panel
// only through REPORTABLE and are emitted where no `failure_reason=` literal
// is written — `task_cap_reached` and its siblings are built in the relay's
// answer, not assigned — so a check driven by `assignments()` looked complete
// while four user-facing codes had no sentence at all, and deleting
// `task_cap_reached` from the panel left it green.
console.log("\nevery code the ledger accepts has a sentence the user can read");
const vocabulary = new Set([...reportable, ...notReported]);
for (const code of [...vocabulary].sort()) {
  check(
    notes.has(code) || Object.values(PANEL_ALIAS).includes(code),
    `${code} has a FAILURE_NOTE entry`,
    "accepted by the failure-report ledger, so it can reach the panel; " +
      "failureNote() falls through for it",
  );
}
for (const [reason, file] of [...reasons].sort()) {
  check(
    reportable.has(reason),
    `${reason} can be recorded`,
    `emitted by ${file}; without it here the operator sees a run that failed ` +
      `and no code saying why`,
  );
}

console.log("\nevery code the extension writes is recorded or has a reason not to");
for (const [reason, file] of [...client].sort()) {
  check(
    reportable.has(reason) || notReported.has(reason),
    `${reason} is either reportable or in NOT_REPORTED`,
    `emitted by ${file}; a client condition with neither a code in the ledger ` +
      `nor a written reason it is excluded is an operator blind spot`,
  );
}

// ── the other direction ───────────────────────────────────────────────────
//
// Everything above asks "does every code have a sentence?". This asks the
// half that was unenforced and is why the fallthrough reached users at all:
// a sentence with no code behind it is either dead copy or — worse — a code
// that got renamed server-side, leaving the panel describing a world that no
// longer exists while every forward check stayed green.
console.log("\nevery sentence in the panel is a code something can send");

for (const key of [...notes].sort()) {
  const aliased = Object.prototype.hasOwnProperty.call(PANEL_ALIAS, key)
    ? PANEL_ALIAS[key]
    : key;
  check(
    aliased === null || reportable.has(aliased) || notReported.has(aliased),
    `${key} is a real code`,
    `no server or client code sends \`${key}\`; it is dead copy, or a code ` +
      `that was renamed and this table was not`,
  );
}

// The fallthrough is the last thing to touch a user. It may not point at a
// thing that does not exist: there is no Brotto log for a client-side
// condition, and on a self-hosted install the log is the user's own machine,
// which most of them never open.
{
  const start = panel.indexOf("function failureNote(");
  check(start >= 0, "failureNote still exists", "renamed or deleted");
  const body = start >= 0 ? panel.slice(start, panel.indexOf("\n}", start)) : "";
  const tail = body.slice(body.indexOf("return ", body.indexOf("isOffline")));
  // Line comments stripped first: this file explains *why* the sentence must
  // not name a log, so a bare /log/ scan reads the explanation and fails on
  // the fix — and an apostrophe in that prose pairs across lines and drags
  // half the comment into the literal scan.
  const code = tail.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const literals = [...code.matchAll(/(['"])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]).join(" ");
  check(!/log/i.test(literals),
        "the fallthrough never points at a log",
        "an unmapped code still tells the user to look in a log they do not " +
          "have — see the panel's own docstring above");
}

console.log("\nno report can carry anything but a code");
{
  // The extension side. `reportBody` is the only thing in the worker that
  // builds a report payload; enumerating its object keys is the guarantee
  // that there is nowhere for a page or a task to go.
  const worker = fs.readFileSync(
    path.join(ROOT, "clients", "brotto-extension", "src", "background.ts"), "utf8");
  const start = worker.indexOf("function reportBody(");
  check(start >= 0, "background.ts still builds its reports through reportBody",
        "renamed or deleted — the payload shape is now unchecked");
  // From the return, not from the signature: `codes: string[]` is a
  // parameter and reading it as a field is the same false positive as a key.
  const fn = start >= 0 ? worker.slice(start, worker.indexOf("\n}", start)) : "";
  const body = fn.slice(fn.indexOf("return"));
  const keys = new Set([...body.matchAll(/([A-Za-z_]+)\s*:/g)].map((m) => m[1]));
  check(keys.size > 0, "reportBody's returned object was found");
  for (const key of keys) {
    check(
      ["reports", "code", "ext_version"].includes(key),
      `reportBody emits no \`${key}\``,
      "a report carries a code and this build's version, nothing else",
    );
  }
  check(/[{(]\s*code\s*[},]/.test(body), "a report still carries its code",
        "the shorthand `code` disappeared from the payload");
  check(fn.includes("chrome.runtime.getManifest().version"),
        "the only free-form value on a report is a version string");
}

console.log(
  failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);