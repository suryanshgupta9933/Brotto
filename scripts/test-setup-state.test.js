// Setup state: is this browser set up, and does its server answer?
//
// Three states that the panel must keep apart, and the whole file is about the
// third one, which is new:
//
//   never answered the wizard  → no `onboarded`; the panel goes to the wizard
//   answered Skip              → onboarded + `setupDeferred`; the user already
//                                knows their server is not running
//   answered Start             → onboarded, no flag; a dead server here is an
//                                outage worth a card
//
// Conflating the last two is what makes a card lie: telling somebody who
// deliberately deferred setup that their server "is not answering" every
// session teaches them to ignore the one place a real outage would speak.
//
// The probe is the `/health` fetch the panel already makes on open — this file
// also pins that there is no second ping written to serve the banner.
//
//   node scripts/test-setup-state.test.js

"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src");
const sidepanel = fs.readFileSync(path.join(SRC, "sidepanel.js"), "utf8");
const panelHtml = fs.readFileSync(path.join(SRC, "sidepanel.html"), "utf8");
const welcome = fs.readFileSync(path.join(SRC, "welcome.js"), "utf8");

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`); }
}

// ── The banner, where the model-not-set card is ───────────────────────────
check("the card lives above the composer, as the model-check banner does",
  /id="serverBanner" class="model-check-banner"/.test(panelHtml));
check("it is not a top-bar indicator — the pill is gone and stays gone",
  !/editionTag[\s\S]{0,400}serverReachable/.test(panelHtml) && !/id="serverPill"/.test(panelHtml));
check("it is hidden until painted, like its sibling",
  /id="serverBanner"[^>]*hidden/.test(panelHtml));

// ── It only speaks when /health actually failed ───────────────────────────
check("reachability is the settled answer to the one /health probe",
  /state\.serverReachable = res\.ok|state\.serverReachable = ok/.test(sidepanel));
check("a probe in flight is not an outage — null stays hidden",
  /state\.serverReachable !== false\) \{ \$banner\.hidden = true/.test(sidepanel));
// Three, all pre-existing: the open path, refreshAuthMode, and the 404
// disambiguation inside the settings save. The banner borrows the first; it
// does not add a fourth.
check("no second probe was written to serve the card",
  (sidepanel.match(/fetch\([^)]*\/health/g) || []).length === 3,
  `found ${(sidepanel.match(/fetch\([^)]*\/health/g) || []).length} fetch(/health) call sites`);

// ── The two states it must not conflate ───────────────────────────────────
check("a deferred (Skipped) browser never gets the card",
  /state\.setupDeferred \|\| state\.setupIncomplete\) \{ \$banner\.hidden = true/.test(sidepanel));
check("the Skip path is the only writer of the deferral flag",
  /setupDeferred: !!deferred/.test(welcome)
  && /void finish\(true\)/.test(welcome)
  && !/setupDeferred: true/.test(sidepanel));
check("Start clears it rather than leaving a stale deferral",
  /async function finish\(deferred = false\)/.test(welcome));

// ── Reset returns to the wizard when setup is incomplete ──────────────────
check("an unanswered wizard sends the panel back to the wizard",
  /if \(!settings\?\.onboarded\) \{\s*window\.location\.replace\('welcome\.html'\);/.test(sidepanel));
check("a finished setup is untouched — no redirect when onboarded",
  /if \(saved\) plannerUrlEl\.value = saved;/.test(sidepanel));
check("the redirect is in the open path, not a click handler", // i.e. it survives a reload
  sidepanel.search(/location\.replace\('welcome\.html'\)/) > sidepanel.search(/async function refreshAuthMode/) - 1);

// ── It must not be built out of a state machine ───────────────────────────
check("two facts, not a setup-state enum",
  [...new Set(sidepanel.match(/state\.setup[A-Za-z]+/g) || [])].sort().join() ===
    "state.setupDeferred,state.setupIncomplete",
  [...new Set(sidepanel.match(/state\.setup[A-Za-z]+/g) || [])].join());

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);