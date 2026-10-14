// The IndexedDB mirror is namespaced by server.
//
// This is a disclosure bug, not cosmetics. `brotto-sessions` lives in the
// extension origin, which is shared by every server a user ever points the
// extension at, and `historyEntries` unions mirrored rows into History on
// every path — success, 404 and throw. So a Chrome profile that used the cloud
// relay and was then pointed at a self-hosted server showed the cloud
// account's conversation rows in the self-host History, replayable, with the
// self-hosted server never involved. The two servers share no directory, no
// secret and no bucket: this was entirely client-side.
//
// Rows written before the namespace existed carry none, and are shown under
// no server. Migrating them to whichever server is currently pointed at would
// be the friendlier reading and the unsafe one — it is the same disclosure,
// decided by which address the user happened to type.
//
//   node scripts/test-mirror-namespace.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src");
const storeSrc = fs.readFileSync(path.join(SRC, "session_store.js"), "utf8");
const sidepanel = fs.readFileSync(path.join(SRC, "sidepanel.js"), "utf8");

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`); }
}

function extract(name) {
  const start = storeSrc.search(new RegExp(`^(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} in session_store.js — renamed?`);
  let parens = 0;
  let bodyStart = -1;
  for (let i = storeSrc.indexOf("(", start); i < storeSrc.length; i++) {
    if (storeSrc[i] === "(") parens++;
    else if (storeSrc[i] === ")" && --parens === 0) { bodyStart = storeSrc.indexOf("{", i); break; }
  }
  let depth = 0;
  for (let i = bodyStart; i < storeSrc.length; i++) {
    if (storeSrc[i] === "{") depth++;
    else if (storeSrc[i] === "}" && --depth === 0) return storeSrc.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

// A minimal in-memory IndexedDB: the four operations the store uses, and a
// transaction that completes. Everything the store does is filtering, so the
// fake only has to be honest about what it hands back.
function fakeDb() {
  const rows = new Map();
  const db = {
    transaction: () => {
      // The store reads `req.result`, so every call hands back a request —
      // that is the shape the real API has and the one `tx` is written against.
      const req = (value) => ({ result: value });
      const store = {
        put: (row) => (rows.set(row.session_id, row), req(undefined)),
        get: (id) => req(rows.get(id)),
        getAll: () => req([...rows.values()]),
        delete: (id) => (rows.delete(id), req(undefined)),
        clear: () => (rows.clear(), req(undefined)),
      };
      const t = { objectStore: () => store };
      // The real transaction fires these after the request; here it is
      // synchronous, so the store's `req.result` is already the final value.
      t.oncomplete = null;
      queueMicrotask(() => t.oncomplete && t.oncomplete());
      return t;
    },
  };
  return {
    rows,
    chrome: { storage: { local: { get: async () => ({}), set: async () => {} } } },
    indexedDB: {
      open: () => {
        const req = {};
        Object.defineProperty(req, "result", { get: () => db });
        queueMicrotask(() => req.onsuccess && req.onsuccess());
        return req;
      },
    },
  };
}

(async () => {
  const CLOUD = "https://agent.brotto.dev";
  const SELF = "http://localhost:8000";
  const cloudNs = storeSrc.match(/function namespaceFor\([\s\S]*?\n}/)[0];

  const nsFor = (base) => vm.runInNewContext(`${cloudNs}; namespaceFor(${JSON.stringify(base)})`);

  // ── The namespace itself ────────────────────────────────────────────────
  check("a trailing slash is the same server",
    nsFor("https://agent.brotto.dev/") === nsFor("https://agent.brotto.dev"));
  check("host case is not a different server",
    nsFor("https://Agent.Brotto.DEV") === nsFor("https://agent.brotto.dev"));
  check("two servers are two namespaces", nsFor(CLOUD) !== nsFor(SELF));

  // ── The filter, against a real store run ────────────────────────────────
  const sandbox = { ...fakeDb(), console, globalThis: null, dbPromise: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // The whole module, not brace-matched pieces: it is a plain script whose only
  // export is the global, and seeding each module-level const by hand is the
  // kind of thing that rots the moment one is added.
  vm.runInContext(storeSrc, sandbox);
  const store = sandbox.brottoSessionStore;

await store.put("cloud-run", { goal: "book a flight" }, {
    namespace: nsFor(CLOUD), task: "book a flight", status: "done", startedAt: 2,
  });
  await store.put("self-run", { goal: "check the logs" }, {
    namespace: nsFor(SELF), task: "check the logs", status: "done", startedAt: 1,
  });

  const asSelf = (await store.list(nsFor(SELF))).map((r) => r.session_id).join();
  const asCloud = (await store.list(nsFor(CLOUD))).map((r) => r.session_id).join();

  check("pointed at the self-hosted server, the cloud row is not listed",
    asSelf === "self-run", asSelf);
  check("pointed at the cloud relay, the self-host row is not listed",
    asCloud === "cloud-run", asCloud);

  check("fetching the cloud document from the self-host server returns nothing",
    (await store.get("cloud-run", nsFor(SELF))) === null);
  check("…and the self-host document from itself does",
    (await store.get("self-run", nsFor(SELF))) !== null);

  // The rows are still there — this hides them, it does not destroy them.
  check("the cloud row is untouched on disk, only filtered on read",
    sandbox.rows.has("cloud-run"));

  // ── Rows written before the namespace existed ───────────────────────────
  sandbox.rows.set("legacy-run", { session_id: "legacy-run", task: "old", started_at: 3 });
  check("a pre-namespace row is shown under no server",
    (await store.list(nsFor(SELF))).length === 1);
  check("…including the one it was most likely written for",
    (await store.get("legacy-run", nsFor(SELF))) === null);

  // ── Clear is scoped, so "delete everything in the list" means that ───────
  await store.clear(nsFor(SELF));
  check("clearing one namespace leaves the other intact",
    sandbox.rows.has("cloud-run") && !sandbox.rows.has("self-run"));

  // ── The panel passes the namespace on every read and write ─────────────
  {
    // Every store call must carry a namespace. One that does not is the bug
    // this whole file is about, and it would read clean in review.
    // `remove` is exempt and the exclusion is stated: it deletes the row the
    // user just clicked, which came out of the scoped list — deleting is not
    // disclosure. `list(ns)` carries it through a local.
    for (const call of sidepanel.match(/brottoSessionStore\.[a-z]+\([^)]*\)/g) || []) {
      if (call.startsWith("brottoSessionStore.remove")) continue;
      check(`namespaced: ${call.slice(0, 60)}`,
        /namespaceFor\(/.test(call) || /list\(ns\)/.test(call), call);
    }
    check("the panel stamps the namespace on write",
      /brottoSessionStore\.put\(sessionId, doc, \{\s*namespace: brottoSessionStore\.namespaceFor\(serverBase\(\)\)/.test(sidepanel));
    check("the namespace is the address, not the credential",
      /brottoSessionStore\.namespaceFor\(serverBase\(\)\)/.test(sidepanel));
    check("it does not key the mirror on the typed secret",
      !/namespaceFor\([^)]*agentSecret/.test(sidepanel));
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();