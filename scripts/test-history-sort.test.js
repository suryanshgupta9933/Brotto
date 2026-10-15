// History order: the union of three sources is not itself ordered.
//
// Each source sorts itself — the server by file mtime, the IndexedDB mirror
// by its `started_at` string — but `mergeHistory` concatenated them and
// returned the result, so the visible order depended on which source
// answered. Two runs' positions swapped between a reload that hit the server
// and one that fell through to the mirror, and both looked correct on their
// own.
//
// The server side was checked and already honours its docstring
// (`_session_documents` sorts by st_mtime, reverse) — the sort was only ever
// missing here, so this is a panel-side test.
//
//   node scripts/test-history-sort.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXT = path.join(__dirname, "..", "clients", "brotto-extension", "src");
const sidepanel = fs.readFileSync(path.join(EXT, "sidepanel.js"), "utf8");

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`); }
}

function extract(name) {
  const start = sidepanel.search(new RegExp(`^(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} in sidepanel.js — renamed?`);
  let parens = 0;
  let bodyStart = -1;
  for (let i = sidepanel.indexOf("(", start); i < sidepanel.length; i++) {
    if (sidepanel[i] === "(") parens++;
    else if (sidepanel[i] === ")" && --parens === 0) { bodyStart = sidepanel.indexOf("{", i); break; }
  }
  let depth = 0;
  for (let i = bodyStart; i < sidepanel.length; i++) {
    if (sidepanel[i] === "{") depth++;
    else if (sidepanel[i] === "}" && --depth === 0) return sidepanel.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

const sandbox = { Date };
vm.createContext(sandbox);
vm.runInContext(extract("mergeHistory"), sandbox);
const merge = (...s) => sandbox.mergeHistory(...s);
const ids = (rows) => rows.map((r) => r.session_id);

// The exact interleaving the concatenation produced: the server has two, the
// mirror one that belongs *between* them.
{
  const server = [
    { session_id: "old", startedAt: "2026-10-01T10:00:00Z" },
    { session_id: "new", startedAt: "2026-10-03T10:00:00Z" },
  ];
  const mirror = [{ session_id: "mid", startedAt: "2026-10-02T10:00:00Z" }];
  const merged = merge(server, mirror, []);
  check("a mirror row between two server rows lands between them",
    ids(merged).join() === "new,mid,old", ids(merged).join());
}

// Same three rows, order of arrival reversed — the answer must not move.
{
  const a = { session_id: "old", startedAt: "2026-10-01T10:00:00Z" };
  const b = { session_id: "mid", startedAt: "2026-10-02T10:00:00Z" };
  const c = { session_id: "new", startedAt: "2026-10-03T10:00:00Z" };
  check("source order does not change the result",
    ids(merge([a], [b], [c])).join() === ids(merge([c], [a], [b])).join());
}

// ms epoch (what `local` and a live saveSession write) mixed with ISO strings.
{
  const merged = merge(
    [{ session_id: "iso", startedAt: "2026-10-02T00:00:00Z" }],
    [{ session_id: "epoch", startedAt: 1000 }],
    [{ session_id: "iso-late", startedAt: "2030-01-01T00:00:00Z" }],
  );
  check("an epoch millisecond sorts against an ISO string, not as 1970",
    ids(merged).join() === "iso-late,iso,epoch", ids(merged).join());
}

// Dedup survives the sort — the union can carry the same session twice.
{
  const row = { session_id: "dup", startedAt: "2026-10-02T10:00:00Z" };
  check("the same session from two sources appears once",
    merge([row], [{ ...row, task: "from mirror" }], [row]).length === 1);
}

// A row with no start time must not lead the list.
{
  const merged = merge(
    [{ session_id: "whenever" }],
    [{ session_id: "dated", startedAt: "2020-01-01T00:00:00Z" }],
  );
  check("a row with no start time sinks rather than leads",
    ids(merged).join() === "dated,whenever", ids(merged).join());
}

// And the empty case still returns an array.
check("no sources is an empty list, not undefined",
  Array.isArray(merge()) && merge().length === 0);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);