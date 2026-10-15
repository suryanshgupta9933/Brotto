// The copy button copies the task.
//
// It used to build `**Task:** …\n\n**Response:**\n…` — a deliberate
// "self-contained when shared" choice that the operator has since reversed:
// what gets pasted elsewhere is the prompt, so a run can be reproduced. The
// answer is already on screen.
//
//   node scripts/test-copy-task.test.js

"use strict";

const fs = require("fs");
const path = require("path");

const EXT = path.join(__dirname, "..", "clients", "brotto-extension", "src");
const sidepanel = fs.readFileSync(path.join(EXT, "sidepanel.js"), "utf8");

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`); }
}

// The line the copy text is built on, read straight out of the shipping file.
const line = (() => {
  const m = sidepanel.match(/^\s*const copyText = .*$/m);
  if (!m) throw new Error("no copyText in sidepanel.js — renamed?");
  return m[0].trim();
})();

check("the copy text is the task", /^const copyText = state\.lastGoal \|\| finalAnswer;$/.test(line), line);
check("it does not concatenate the response", !/Response:/.test(sidepanel), "a '**Response:**' label survived");
check("it does not wrap the task in markdown labels", !/Task:\*\*/.test(sidepanel));

// The URL copy paths are separate and correct — they must not have been
// swept along by this change.
check("the URL copy path still copies a URL",
  /wireCopyUrl/.test(sidepanel) && !/wireCopyUrl[\s\S]{0,400}lastGoal/.test(sidepanel));

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);