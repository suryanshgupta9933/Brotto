// A deleted history row must stay deleted.
//
// The failure this pins: a task's events are buffered in the service
// worker and replayed through handleEvent on every panel open. The
// terminal event calls saveSession, which had no memory of the delete —
// so deleting a conversation and reopening the panel brought it back,
// undone by a log the user never asked to replay.
//
// Extracted from src/sidepanel.js by brace matching, so it cannot drift
// from what ships.
//
//   node scripts/test-deleted-history.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src", "sidepanel.js");
const source = fs.readFileSync(SRC, "utf8");

function extract(name) {
  const start = source.search(new RegExp(`^(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} in sidepanel.js — renamed?`);
  let parens = 0;
  let bodyStart = -1;
  for (let i = source.indexOf("(", start); i < source.length; i++) {
    if (source[i] === "(") parens++;
    else if (source[i] === ")" && --parens === 0) { bodyStart = source.indexOf("{", i); break; }
  }
  if (bodyStart < 0) throw new Error(`no body for ${name}`);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

let store = {};

const sandbox = {
  console,
  SESSIONS_KEY: "sessions",
  DELETED_KEY: "deletedSessions",
  DELETED_LIMIT: 200,
  SESSION_LIMIT: 20,
  state: { sessionId: null, taskCount: 1, stepCount: 0, startTime: 1, lastGoal: "find the cheapest flight" },
  chrome: {
    storage: {
      local: {
        get: async (k) => (k in store ? { [k]: store[k] } : {}),
        set: async (obj) => Object.assign(store, obj),
      },
    },
  },
  fetch: async () => ({ ok: true, status: 200 }),
  toast: () => {},
  serverBase: () => "http://localhost:8000",
  authHeaders: async () => ({}),
  listSessions: async () => (Array.isArray(store.sessions) ? store.sessions : []),
  renderHistory: async () => {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const fn of ["noteDeleted", "wasDeleted", "saveSession"]) {
  vm.runInContext(extract(fn), sandbox);
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
}

function reset() {
  store = { sessions: [] };
  sandbox.state.sessionId = null;
  sandbox.state.taskCount = 1;
}

async function run() {
  // ── The delete is remembered ─────────────────────────────────────────────
  reset();
  await sandbox.noteDeleted(["aaa", "bbb"]);
  check("noteDeleted records the ids",
    Array.isArray(store.deletedSessions) && store.deletedSessions.includes("aaa"),
    JSON.stringify(store.deletedSessions));

  // ── …and honoured on the replay that used to undo it ─────────────────────
  reset();
  sandbox.state.sessionId = "aaa";
  await sandbox.saveSession({ status: "done", steps: 4, elapsed: "2m", task: "find the cheapest flight" });
  const before = store.sessions.length;

  store.sessions = [];
  await sandbox.noteDeleted(["aaa"]);
  await sandbox.saveSession({ status: "done", steps: 4, elapsed: "2m", task: "find the cheapest flight" });
  check("a replay does not re-add a deleted row",
    before === 1 && store.sessions.length === 0,
    `first save made ${before} row(s); after delete, replay made ${store.sessions.length}`);

  // ── An unrelated session still saves ─────────────────────────────────────
  reset();
  await sandbox.noteDeleted(["aaa"]);
  sandbox.state.sessionId = "ccc";
  await sandbox.saveSession({ status: "done", steps: 1, elapsed: "9s", task: "something else" });
  check("a session that was not deleted still saves",
    store.sessions.length === 1 && store.sessions[0].session_id === "ccc",
    JSON.stringify(store.sessions));

  // ── Delete-all marks every id it removed ─────────────────────────────────
  reset();
  await sandbox.noteDeleted(["aaa", "bbb", null, undefined, ""]);
  check("delete-all's id list skips rows with no id",
    store.deletedSessions.length === 2,
    JSON.stringify(store.deletedSessions));

  // ── The record is bounded ────────────────────────────────────────────────
  reset();
  const many = Array.from({ length: 260 }, (_, i) => `s${i}`);
  await sandbox.noteDeleted(many);
  check("the deleted-id record stays bounded",
    store.deletedSessions.length === 200
      && store.deletedSessions[store.deletedSessions.length - 1] === "s259",
    `length ${store.deletedSessions?.length}`);

  console.log(failures === 0 ? "\nall ok" : `\n${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

run();