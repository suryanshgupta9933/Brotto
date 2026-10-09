// Domain grants have to survive a server whose filesystem does not.
//
// The server keeps the user's blacklist and their approved domains in one
// JSON file under logs/. That is fine on a box the user owns and wrong on
// one that wipes its disk on restart, which is every ephemeral host. The
// blocklist already round-trips (the client ships it on every task_start);
// grants were the one thing only the server held, so "approving a site
// outlives the run" quietly stopped being true there.
//
// The client now keeps its own copy in chrome.storage.local. Three things
// here can fail silently and none of them throw, which is why they are
// pinned:
//
//   1. A grant that is never written to storage is lost the moment the
//      service worker sleeps — it has no other copy once the disk is wiped.
//   2. `policy_changed` rebuilds `userPolicy` wholesale, and it fires on
//      every press of Save. Omitting approved_domains there silently
//      revoked every standing grant the moment anyone opened Settings.
//   3. `hydrateUserPolicy` is what repopulates the mirror on browser start.
//      Same omission, same revocation, and this time it looks like the
//      feature simply never persisted.
//
// Read against src/background.ts directly rather than the bundle: esbuild
// strips types without reading them, so a wrongly-typed field builds clean
// and fails here instead — which is the point.
//
//   node scripts/test-domain-grants.test.js

"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src", "background.ts");
const source = fs.readFileSync(SRC, "utf8");

// Slice a `case "x": { ... }` block out of the frame dispatcher.
function sliceCase(name) {
  const start = source.search(new RegExp(`case "${name}"\\s*:\\s*\\{`, "m"));
  if (start < 0) throw new Error(`no case "${name}" in background.ts — renamed?`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated case "${name}"`);
}

// Slice a whole `async function name(...) { ... }`.
function sliceFunction(name) {
  const start = source.search(new RegExp(`^(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} in background.ts — renamed?`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
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

console.log("domain grants are held by the client as well as the server");

check("the mirror carries approved_domains, not just blacklist", () => {
  const decl = source.match(/let userPolicy[\s\S]*?\}\s*=\s*\{[\s\S]*?\};/);
  assert(decl, "userPolicy declaration not found");
  assert(/approved_domains/.test(decl[0]), `userPolicy has no approved_domains: ${decl[0]}`);
});

check("a domain_granted frame writes the grant to chrome.storage", () => {
  const body = sliceCase("domain_granted");
  assert(
    /chrome\.storage\.local\.set/.test(body),
    "grant is merged in memory but never persisted, so it dies with the service worker"
  );
  assert(/approved_domains/.test(body), "the persisted document has no approved_domains key");
  // Without the guard the server re-sends the same grant every step and the
  // stored list grows a duplicate each time.
  assert(/includes\(domain\)/.test(body), "no duplicate guard on re-sent grants");
});

check("policy_changed does not revoke grants", () => {
  const body = sliceCase("policy_changed");
  assert(
    /approved_domains\s*:\s*userPolicy\.approved_domains/.test(body),
    "policy_changed rebuilds userPolicy without carrying approved_domains forward — " +
      "pressing Save in Settings would revoke every standing grant"
  );
});

check("hydration restores grants on browser start", () => {
  const body = sliceFunction("hydrateUserPolicy");
  assert(
    /approved_domains/.test(body),
    "hydrateUserPolicy drops approved_domains, so a browser restart revokes grants"
  );
  assert(
    /chrome\.storage\.local\.get/.test(body),
    "hydrateUserPolicy is supposed to read chrome.storage.local"
  );
});

check("task_start ships the grants back to the server", () => {
  assert(
    /user_policy:\s*userPolicy/.test(source),
    "task_start must send user_policy so the server can re-seed grants from a wiped disk"
  );
});

console.log(
  failed === 0
    ? "\nall domain-grant checks passed"
    : `\n${failed} check(s) failed`
);
process.exit(failed === 0 ? 0 : 1);