// A completed task is the agent's report, not a check.
//
// `task_complete` is self-asserted: the harness records success the moment the
// model says it is done, with zero verification, and the panel drew that as a
// green DONE card over the agent's own final answer. A click that silently did
// nothing produces exactly the same card.
//
// There is no verifier and none is coming — it is impossible for canvas apps
// (no DOM to inspect) and for any side effect outside the browser (no way to
// observe a purchase, a send, a delete). So the honest move is not to build
// one, it is for the card to stop implying there is one. The wording is
// unconditional because nothing is verified today.
//
//   node scripts/test-completion-honesty.test.js

"use strict";

const fs = require("fs");
const path = require("path");

const PANEL = path.join(
  __dirname, "..", "clients", "brotto-extension", "src", "sidepanel.js");
const panel = fs.readFileSync(PANEL, "utf8");

let failed = 0;
function check(ok, label, detail) {
  console.log(ok ? `  ok  ${label}` : `FAIL  ${label}`);
  if (!ok) {
    failed++;
    if (detail) console.log(`      ${detail}`);
  }
}

const decl = panel.match(/const REPORTED_NOTE =\s*\n?\s*(['"])([\s\S]*?)\1;/);
check(!!decl, "sidepanel.js declares REPORTED_NOTE",
      "the completed card's honesty sentence is gone or renamed");

const note = decl ? decl[2] : "";

check(/\breports?\b/i.test(note),
      "the note says this is a report",
      `"${note}" reads as Brotto having checked the result`);
check(/not a (check|verified)|did not check|nothing (was )?(checked|verified)/i.test(note),
      "the note says it was not checked",
      `"${note}" needs to say the result was not verified`);
check(!/\b(failed|failed|error|problem|sorry|unfortunately)\b/i.test(note),
      "the note does not read as a failure",
      `"${note}" makes a successful run feel like a broken one; the agent is ` +
      "usually right and this is an accurate description, not a hedge");
check(note.length > 0 && note.length < 160, "the note is one short sentence",
      `${note.length} chars — ${note}`);

// The card must actually show it: textContent into the done bubble, so the
// sentence cannot be markdown-rendered into anything else.
check(
  /role === 'done'/.test(panel) &&
    /textContent\s*=\s*REPORTED_NOTE/.test(panel),
  "the done bubble renders REPORTED_NOTE via textContent",
  "the note is declared but never drawn, or it goes through innerHTML",
);

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);