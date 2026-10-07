// `PERMISSIONS.md` is a submission artefact: a Chrome Web Store reviewer reads
// it next to the manifest and decides whether the permissions are honest. So a
// claim in it that the code no longer supports is a self-reported finding.
//
// It drifted twice. "The relay was unauthenticated" (2026-10-05), and then
// `Runtime.evaluate` described as used "in exactly one place" when the
// extension issues it from three internal sites on every observation, with the
// per-step page-text read capped at 2,000 (the *idle* read's cap) rather than
// the 20,000 it actually uses.
//
// A doc that is quietly wrong reads clean in review — nobody diffs prose
// against source. So this enumerates the call sites out of the source and
// requires the doc to name each one.
//
//   node scripts/test-permissions-doc.test.js

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "clients", "brotto-extension");
const DOC = path.join(EXT, "PERMISSIONS.md");
const doc = fs.readFileSync(DOC, "utf8");

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

/** Every source file that can issue a CDP command. */
function sources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.ts$/.test(entry.name)) out.push(p);
    }
  };
  walk(path.join(EXT, "src"));
  return out;
}

/**
 * Every `Runtime.evaluate` call site, as {file, line}.
 *
 * This is the primitive that executes code in the page, so it is the one the
 * doc has to account for. `background.ts` is separated out by the doc itself —
 * it is the one server-composed path — so it is reported but not required to
 * be named inline.
 */
function evaluateSites() {
  const out = [];
  for (const file of sources()) {
    const src = fs.readFileSync(file, "utf8");
    src.split("\n").forEach((line, i) => {
      if (!/method:\s*["']Runtime\.evaluate["']/.test(line)) return;
      out.push({ file: path.relative(EXT, file), line: i + 1 });
    });
  }
  return out;
}

const sites = evaluateSites();
const serverComposed = sites.filter((s) => s.file === "src/background.ts");
const internal = sites.filter((s) => s.file !== "src/background.ts");

console.log(`Runtime.evaluate sites: ${sites.length} ` +
  `(${serverComposed.length} server-composed, ${internal.length} extension-internal)\n`);

console.log("every extension-internal evaluate site is named in PERMISSIONS.md");
check(internal.length > 0, "found the extension-internal sites to check",
  "enumeration came back empty — check the regex, the doc will pass vacuously");
for (const s of internal) {
  check(doc.includes(s.file.replace(/^src\//, "")),
    `${s.file} is accounted for`,
    `Runtime.evaluate is issued at ${s.file}:${s.line} and the doc does not ` +
      `mention it — this is the primitive that executes code in the page`);
}

console.log("\nthe page-text caps quoted in the doc are the ones the code uses");
const idx = fs.readFileSync(path.join(EXT, "src", "observation", "index.ts"), "utf8");
const cap = idx.match(/PAGE_TEXT_MAX\s*=\s*(\d+)/);
check(cap !== null, "found PAGE_TEXT_MAX in observation/index.ts");

// Prose writes "20,000"; the source writes 20000. Match on comma-free text,
// and anchor on word boundaries so `2000` cannot match inside `20000`.
const quotes = (n, hay) =>
  new RegExp(`\\b${n}\\b`).test(hay.replace(/,/g, ""));
const flat = doc;

if (cap) {
  // The cap has to sit on the *same line* as the file it describes. Testing
  // the whole document here is the weakness the original doc had — "20,000"
  // appears three more times in prose, so a wrong cap on the row passes
  // anyway and the test reports clean.
  const row = doc.split("\n").find(
    (l) => l.includes("observation/index.ts") && l.startsWith("|"));
  check(row !== undefined,
    "found the enumeration row for observation/index.ts");
  check(row !== undefined && quotes(cap[1], row),
    `the ${cap[1]}-character per-step cap is on that row`,
    `observation/index.ts caps page text at ${cap[1]}, and the doc's row for ` +
      `it does not say so — a cap quoted elsewhere is the bug this pins`);

  // The idle read has its own cap, and it is *supposed* to differ. Both
  // numbers have to be present for the doc to be attributing them
  // separately; one number alone can only be one of them.
  const idle = fs.readFileSync(path.join(EXT, "src", "sidepanel.js"), "utf8");
  const idleCap = idle.match(/PAGE_TEXT_CHARS\s*=\s*(\d+)/);
  check(idleCap === null || quotes(idleCap[1], flat),
    `the ${idleCap && idleCap[1]}-character idle cap appears in the doc too`,
    `sidepanel.js reads ${idleCap && idleCap[1]} and index.ts reads ${cap[1]}; ` +
      `the doc must attribute each cap to its own path, so both numbers belong`);
}

console.log(
  failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`,
);
process.exit(failed === 0 ? 0 : 1);