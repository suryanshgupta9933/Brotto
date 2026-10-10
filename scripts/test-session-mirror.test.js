// The server's audit documents are the only complete copy of a conversation,
// and on a hosted orchestrator that disk is ephemeral. The IndexedDB mirror is
// what makes the history survive a dyno restart.
//
// Every failure below is an *absence* that reads clean in a diff:
//
//   - a merge that returns only the server's rows empties the history on
//     exactly the restart the mirror exists to survive,
//   - a `fetchAudit` with no fallback turns a reachable server that has
//     forgotten a session into "we cannot show you this conversation",
//   - a delete that misses the mirror leaves the only copy that outlives the
//     server sitting there after the user asked for it to be gone.
//
// The store itself is IndexedDB, which node does not have, so the fake below
// stands in for it and the logic under test is the panel's: the merge, the
// fallback order, and the delete bookkeeping. Read against src/sidepanel.js
// directly so it cannot drift from what ships.
//
//   node scripts/test-session-mirror.test.js

"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src", "sidepanel.js");
const STORE_SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src", "session_store.js");
const source = fs.readFileSync(SRC, "utf8");
const storeSource = fs.readFileSync(STORE_SRC, "utf8");

function sliceFunction(name) {
  const start = source.search(new RegExp(`^(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} in sidepanel.js — renamed?`);
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

console.log("the client mirrors the server's audit documents");

// ── mergeHistory ─────────────────────────────────────────────────────────────

const mergeHistory = eval(`(${sliceFunction("mergeHistory")})`);

check("the server's row wins over the mirror's for the same session", () => {
  const server = [{ session_id: "a", task: "server", elapsed: "42s" }];
  const mirror = [{ session_id: "a", task: "mirror", elapsed: "—" }];
  const merged = mergeHistory(server, mirror, []);
  assert(merged.length === 1, `expected one row, got ${merged.length}`);
  assert(merged[0].elapsed === "42s", "the mirror overwrote the server's row");
});

check("a mirrored session the server has never heard of still lists", () => {
  // The dyno-restart case, and the whole reason the mirror exists.
  const merged = mergeHistory(
    [{ session_id: "new", task: "server" }],
    [{ session_id: "old", task: "mirror" }],
    [],
  );
  assert(merged.length === 2, `mirror row was dropped: ${JSON.stringify(merged)}`);
  assert(merged.some((r) => r.session_id === "old"), "the mirrored session is missing");
});

check("rows with no session id dedupe on start time, not by accident", () => {
  // Two rows, same conversation, neither carrying an id — that is the replay
  // saveSession already guards against in storage.
  const merged = mergeHistory(
    [],
    [],
    [{ session_id: null, startedAt: 100, task: "x" }, { session_id: null, startedAt: 100, task: "x" }],
  );
  assert(merged.length === 1, `duplicate rows survived: ${JSON.stringify(merged)}`);
});

check("a missing source does not take the merge down", () => {
  const merged = mergeHistory(null, undefined, [{ session_id: "a" }]);
  assert(merged.length === 1, `expected the one row, got ${JSON.stringify(merged)}`);
});

// ── historyEntries ───────────────────────────────────────────────────────────

// Node has no IndexedDB and no chrome.*; the fakes below are the whole
// surface these functions touch.
function fakeStore(mirror) {
  return {
    list: async () => mirror || [],
    get: async () => null,
    put: async () => true,
    remove: async () => true,
    clear: async () => true,
  };
}

function entriesFor(serverBehaviour, mirror, local = []) {
  const store = fakeStore(mirror);
  // mirrorRows and mergeHistory are both free identifiers inside
  // historyEntries, so both have to be handed in — stubbing the merge away
  // would test a union that never runs.
  const realMirrorRows = new Function("brottoSessionStore", "panelStatus",
    `return (${sliceFunction("mirrorRows")});`)(store, (s) => s || "done");
  const fn = new Function("brottoSessionStore", "listSessions", "mirrorRows", "mergeHistory",
    "panelStatus", "serverBase", "authHeaders", "fetch",
    `return (${sliceFunction("historyEntries")});`)(
      store, async () => local, realMirrorRows, mergeHistory, (s) => s || "done",
      () => "https://server", async () => ({}), serverBehaviour);
  return fn();
}

const okJson = (payload) => async () => ({ ok: true, json: async () => payload });
const fails = async () => { throw new Error("network down"); };

(async () => {
  // The remaining checks are async, so `check` cannot hold them.
  const run = async (name, fn) => {
    try { await fn(); console.log(`  ok  ${name}`); }
    catch (e) { failed++; console.error(`FAIL  ${name}\n      ${e.message}`); }
  };

  check("(sync sanity) the harness is wired up", () => {
    assert(typeof mergeHistory === "function", "mergeHistory did not evaluate");
  });

  await run("the server's list and the mirror are unioned, not either one", async () => {
    const rows = await entriesFor(
      okJson({ sessions: [{ session_id: "s1", task: "from server", status: "completed" }] }),
      [{ session_id: "m1", task: "from mirror", status: "completed", started_at: "2026-01-01" }],
    );
    assert(rows.length === 2, `expected both rows, got ${JSON.stringify(rows)}`);
    assert(rows.map((r) => r.session_id).includes("m1"), "the mirrored session is missing");
    assert(rows.map((r) => r.session_id).includes("s1"), "the server's session is missing");
  });

  await run("a server that cannot be reached falls back to the mirror", async () => {
    const rows = await entriesFor(fails, [{ session_id: "m1", task: "mirrored", status: "completed" }]);
    assert(rows.length === 1 && rows[0].session_id === "m1",
      `fallback produced ${JSON.stringify(rows)}`);
  });

  await run("a 404 from the server falls back to the mirror", async () => {
    const rows = await entriesFor(
      async () => ({ ok: false, status: 404, json: async () => ({}) }),
      [{ session_id: "m1", task: "mirrored", status: "completed" }],
    );
    assert(rows.length === 1 && rows[0].session_id === "m1",
      `fallback produced ${JSON.stringify(rows)}`);
  });

  await run("legacy rows with no session id are not lost", async () => {
    const rows = await entriesFor(fails, [], [{ session_id: null, startedAt: 5, task: "old" }]);
    assert(rows.length === 1 && rows[0].task === "old", `lost the legacy row: ${JSON.stringify(rows)}`);
  });

  // ── fetchAudit ────────────────────────────────────────────────────────────

  await run("fetchAudit falls back to the mirror when the server forgets the session", async () => {
    const fakeStore = {
      get: async (id) => (id === "m1" ? { schema_version: 2, tasks: [] } : null),
      list: async () => [],
    };
    const fn = new Function("brottoSessionStore", "serverBase", "authHeaders", "fetch",
      `return (${sliceFunction("fetchAudit")});`)(
      fakeStore, () => "https://server", async () => ({}),
      async () => ({ ok: true, json: async () => ({ found: false }) }));
    const doc = await fn("m1");
    assert(doc && doc.schema_version === 2, `mirror was not used: ${JSON.stringify(doc)}`);
  });

  await run("fetchAudit still prefers the server's copy", async () => {
    const fakeStore = { get: async () => ({ from: "mirror" }) };
    const fn = new Function("brottoSessionStore", "serverBase", "authHeaders", "fetch",
      `return (${sliceFunction("fetchAudit")});`)(
      fakeStore, () => "https://server", async () => ({}),
      async () => ({ ok: true, json: async () => ({ from: "server" }) }));
    const doc = await fn("m1");
    assert(doc.from === "server", `the mirror won: ${JSON.stringify(doc)}`);
  });

  await run("fetchAudit throws only when no copy exists anywhere", async () => {
    const fakeStore = { get: async () => null };
    const fn = new Function("brottoSessionStore", "serverBase", "authHeaders", "fetch",
      `return (${sliceFunction("fetchAudit")});`)(
      fakeStore, () => "https://server", async () => ({}), fails);
    let threw = false;
    try { await fn("m1"); } catch { threw = true; }
    assert(threw, "fetchAudit returned undefined instead of throwing");
  });

  // ── deletes ───────────────────────────────────────────────────────────────

  check("deleting a session also deletes its mirrored copy", () => {
    const body = sliceFunction("deleteSession");
    assert(/brottoSessionStore\.remove/.test(body),
      "the row and the server file go, but the mirror — the copy that outlives " +
      "the server — is left behind, so 'deleted' is the one outcome the user cannot verify");
  });

  check("delete-all also empties the mirror", () => {
    const body = sliceFunction("deleteAllSessions");
    assert(/brottoSessionStore\.clear/.test(body),
      "delete-all clears the row array and the server but not the mirror");
  });

  // ── the store itself ──────────────────────────────────────────────────────

  check("the mirror writes the server's document verbatim", () => {
    assert(/doc,/.test(storeSource),
      "the document is reshaped on the way in, so the mirror and the server " +
      "have two renderings of one transcript");
  });

  check("the mirror is never the only place a delete is recorded", () => {
    assert(/noteDeleted/.test(sliceFunction("deleteSession")),
      "the deleted-marker is what stops the buffered replay re-creating the row");
  });

  check("no transcript is written to chrome.storage.local", () => {
    assert(!/storage\.local[\s\S]{0,80}doc\b/.test(storeSource),
      "storage.local caps at ~10MB and needs unlimitedStorage — a permission the " +
      "store review has to approve");
  });

  console.log(
    failed === 0
      ? "\nall session-mirror checks passed"
      : `\n${failed} check(s) failed`,
  );
  process.exit(failed === 0 ? 0 : 1);
})();