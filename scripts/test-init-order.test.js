// No top-level call may reach `state` before `state` exists.
//
// This has now bitten three times, always the same way:
//
//   refreshModelCheckBanner()  -> modelKeyNames() -> accountScope() -> state.accountId
//   hydrateModelSettings()     -> modelKeyNames() -> accountScope() -> state.accountId
//   initModelSettings()        -> the same chain, a second way in
//
// A call above `const state = { … }` is a temporal-dead-zone ReferenceError one
// `await` later. It is not swallowed by the caller's `void`: the reference is
// inside a promise nobody awaits, so it arrives as
// `Uncaught (in promise) ReferenceError` and the panel carries on without it.
// That is why each of these read as "some swallowed error" rather than a crash.
//
// So this asserts the *shape*, not the three known call sites: take the module
// text, build the call graph over its top-level function declarations, and fail
// if any statement that executes at module scope — a bare call, or a `.then`
// whose receiver is a bare call — can reach a function whose body mentions
// `state.`. A fourth caller added later fails this file instead of the console.
//
//   node scripts/test-init-order.test.js

"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src", "sidepanel.js");
const src = fs.readFileSync(SRC, "utf8");
const lines = src.split("\n");

let failures = 0;
function check(ok, msg) {
  if (!ok) { failures++; console.error("FAIL: " + msg); }
  else console.log("ok: " + msg);
}

// Where `state` is declared. Everything before this line runs outside its
// existence, and a `const` gives no grace period: even `typeof state` throws.
const stateLine = lines.findIndex((l) => /^const state\s*=/.test(l));
check(stateLine > 0, "`const state` is declared at module scope (line " + (stateLine + 1) + ")");

// ── function bodies ────────────────────────────────────────────────────────
// Top-level `function foo(...) {` / `async function foo(...) {`, by brace
// matching. A named `const foo = (…) => …` is included too, since a helper
// written that way has the same reachability.
function bodyOf(openIndex) {
  let depth = 0;
  for (let i = openIndex; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) return lines.slice(openIndex, i + 1).join("\n"); }
    }
  }
  return null;
}

const bodies = new Map();
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
  if (!m) continue;
  const start = lines.slice(i).findIndex((l) => l.includes("{")) + i;
  if (start < 0) continue;
  const body = bodyOf(start);
  if (body) bodies.set(m[1], body);
}

// Which functions mention `state.` — the forbidden state.
const readsState = new Set();
for (const [name, body] of bodies) {
  if (/\bstate\./.test(body)) readsState.add(name);
}

// Transitive closure: a call to any of these reaches the temporal dead zone.
const reachesState = new Set();
function canReachState(name, seen = new Set()) {
  if (seen.has(name) || !bodies.has(name)) return false;
  seen.add(name);
  if (readsState.has(name)) return true;
  for (const [, body] of bodies) void body;
  for (const callee of bodies.keys()) {
    const called = new RegExp("\\b" + callee.replace(/\$/g, "\\$") + "\\s*\\(").test(bodies.get(name));
    if (called && canReachState(callee, seen)) return true;
  }
  return false;
}
for (const name of bodies.keys()) if (canReachState(name)) reachesState.add(name);

// ── module-scope statements ─────────────────────────────────────────────────
// Column 0 and not a declaration, not a comment, not a brace. This is what the
// module actually runs, in order, the moment it loads.
const moduleCalls = [];
for (let i = 0; i < stateLine; i++) {
  const line = lines[i];
  if (!line || line[0] === " " || line[0] === "\t") continue;      // indented: inside something
  if (/^\/\//.test(line)) continue;
  if (/^(const|let|var|function|async function|class|import|export|\}|\{|\/\*)/.test(line)) continue;
  if (/^\s*$/.test(line)) continue;
  moduleCalls.push({ line: i + 1, text: line.trim() });
}

// An event listener registers, it does not run — the handler body is only
// reached on an interaction, long after the module finished evaluating.
const isRegistration = (text) =>
  /addEventListener\s*\(/.test(text) || /^\w+\.(?:on\w+|dataset|style|classList|value|textContent|hidden|type|checked)\b/.test(text);

for (const call of moduleCalls) {
  if (isRegistration(call.text)) continue;
  const offenders = [...reachesState].filter((name) => new RegExp("\\b" + name.replace(/\$/g, "\\$") + "\\s*\\(").test(call.text));
  check(
    offenders.length === 0,
    "line " + call.line + " (`" + call.text.slice(0, 60) + "`) runs before `state` and reaches " +
      (offenders.join(", ") || "nothing that reads state")
  );
}

// The two known offenders must also not reappear above `state` under any name.
const tail = lines.slice(stateLine).join("\n");
check(/hydrateModelSettings\(\)\.then/.test(tail), "hydrateModelSettings() fires below `const state`");
check(/initModelSettings\(/.test(tail), "initModelSettings() fires below `const state`");
check(/void refreshModelCheckBanner\(\)/.test(tail), "refreshModelCheckBanner() fires below `const state`");

console.log(failures === 0 ? "\nPASS" : "\n" + failures + " failing");
process.exit(failures === 0 ? 0 : 1);