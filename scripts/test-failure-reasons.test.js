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
  return new Set([...body.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]));
}

const reasons = serverReasons();
const notes = noteKeys();

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

console.log(
  failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);