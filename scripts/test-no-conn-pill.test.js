// The connection pill is gone.
//
// It occupied header height the panel no longer had, and it was ambient
// chrome carrying no information the panel did not already say somewhere
// better. Every one of its six mutators had a second signal that must
// survive the removal:
//
//   - setPhase's five branches were chrome; the error phase already sets an
//     outcome card.
//   - `disconnected` mid-task set `setOutcome('failed', …)` — the card that
//     must keep working.
//   - `server_unreachable`, sign-in expired, key rejected and open-time
//     unreachable each already raised a toast above the composer.
//
// The failure mode this guards is the quiet one: a handler deleted with the
// renderer, and an error that now goes nowhere. Comments and dead CSS do not
// fail a build, so the assertions are on the *survivors*.
//
//   node scripts/test-no-conn-pill.test.js

"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src");
const panel = fs.readFileSync(path.join(SRC, "sidepanel.js"), "utf8");
const html = fs.readFileSync(path.join(SRC, "sidepanel.html"), "utf8");

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`); }
}

// ── It is actually gone ────────────────────────────────────────────────────
for (const name of ["setConnPill", "statusPill", "connLabelEl", "connLabel", "statusDot"]) {
  check(`${name} is gone from sidepanel.js`, !new RegExp(`\\b${name}\\b`).test(panel));
  check(`${name} is gone from sidepanel.html`, !new RegExp(`\\b${name}\\b`).test(html));
}
check("no .status-pill CSS is left orphaned", !/status-pill/.test(html));
check("no commented-out pill is left behind", !/\/\/.*setConnPill/.test(panel));

// ── …and nothing it signalled went with it ────────────────────────────────
const survivors = [
  ["the mid-task disconnect card",
    /case 'disconnected':[\s\S]*?setOutcome\('failed', FAILURE_NOTE\.disconnected/],
  ["the server-unreachable toast",
    /case 'server_unreachable':[\s\S]*?toast\(\s*`Server unreachable/],
  ["the sign-in-expired toast",
    /sign-in has expired — open Set up Brotto to sign in again/],
  ["the key-rejected toast",
    /rejected AGENT_SECRET — fix it in Settings/],
  ["the open-time unreachable toast",
    /Server unreachable — settings still work locally/],
  ["setPhase still surfaces an error outcome",
    /setOutcome\(phase|setOutcome\('failed'/],
];
for (const [name, re] of survivors) {
  check(name, re.test(panel), "the signal the pill was shadowing is gone too");
}

// The `pulse` keyframes outlive the pill — the working outcome mark uses them,
// and deleting a shared keyframe because one caller left is the orphan this
// file would otherwise create.
check("the shared `pulse` keyframes stay for the outcome mark",
  /@keyframes pulse/.test(html) && /animation: pulse/.test(html));

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);