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

  const nsFor = (base, accountId) =>
    vm.runInNewContext(`${cloudNs}; namespaceFor(${JSON.stringify(base)}, ${JSON.stringify(accountId ?? null)})`);

  // ── The namespace itself ────────────────────────────────────────────────
  check("a trailing slash is the same server",
    nsFor("https://agent.brotto.dev/") === nsFor("https://agent.brotto.dev"));
  check("host case is not a different server",
    nsFor("https://Agent.Brotto.DEV") === nsFor("https://agent.brotto.dev"));
  check("two servers are two namespaces", nsFor(CLOUD) !== nsFor(SELF));

  // ── The account, and the self-host string that must not move ───────────
  // Pinned literally, not as "different from something": a self-hoster's rows
  // were written under these exact bytes, and a self-host install has no
  // account, so any change here silently empties their History.
  check("self-host's namespace is the bare address, byte for byte",
    nsFor(SELF) === "http://localhost:8000", nsFor(SELF));
  check("…with a trailing slash, a capital host or an empty base, too",
    nsFor(SELF + "/") === "http://localhost:8000"
    && nsFor("HTTP://LocalHost:8000") === "http://localhost:8000"
    && nsFor(null) === "");
  // Every shape the server can answer with on a self-hoster's machine, all
  // three of which mean "no account" rather than "an account called nothing".
  for (const none of [null, "", undefined]) {
    check(`no account (${JSON.stringify(none)}) is not a namespace change`,
      nsFor(SELF, none) === "http://localhost:8000", nsFor(SELF, none));
  }
  check("two accounts on one relay are two namespaces",
    nsFor(CLOUD, "acc-a") !== nsFor(CLOUD, "acc-b"));
  check("the address stays the outer key",
    nsFor(CLOUD, "acc-a").startsWith("https://agent.brotto.dev#"), nsFor(CLOUD, "acc-a"));
  check("an account does not leak into another server's namespace",
    nsFor(SELF, "acc-a") !== nsFor(CLOUD, "acc-a"));

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

  // ── Remove is scoped too: the reads hide a foreign row, and an ungated
  //    delete would destroy it anyway, so the read fix would be undone by the
  //    write path.
  check("deleting a row from the wrong server is refused",
    (await store.remove("cloud-run", nsFor(SELF))) === false && sandbox.rows.has("cloud-run"));
  check("…and deleting the same row as its own server does delete it",
    (await store.remove("cloud-run", nsFor(CLOUD))) === true && !sandbox.rows.has("cloud-run"));
  check("a pre-namespace row is not deletable by any server",
    (await store.remove("legacy-run", nsFor(SELF))) === false && sandbox.rows.has("legacy-run"));
  sandbox.rows.delete("legacy-run");

  // ── The panel passes the namespace on every read and write ─────────────
  {
    // Every store call must carry a namespace. One that does not is the bug
    // this whole file is about, and it would read clean in review.
    // `list(ns)` carries it through a local.
    for (const call of sidepanel.match(/brottoSessionStore\.[a-z]+\([^)]*\)/g) || []) {
      check(`namespaced: ${call.slice(0, 60)}`,
        /namespaceFor\(/.test(call) || /list\(ns\)/.test(call), call);
    }
    check("the panel stamps the namespace on write",
      /brottoSessionStore\.put\(sessionId, doc, \{\s*namespace: brottoSessionStore\.namespaceFor\(serverBase\(\), state\.accountId\)/.test(sidepanel));
    check("the namespace is the address plus the account id, never the credential",
      /brottoSessionStore\.namespaceFor\(serverBase\(\), state\.accountId\)/.test(sidepanel));
    // Every site must pass it. One that drops the second argument is a row
    // filed under no account, which reads as history that vanished.
    // Counted rather than matched per call: a nested `)` ends any regex that
    // tries to capture the argument list, so the one-argument form is asserted
    // by its absence, which is the same fact.
    const sites = sidepanel.match(/brottoSessionStore\.namespaceFor\(/g) || [];
    check("every namespace site carries the account id",
      sites.length > 0 && sites.length === (sidepanel.match(/namespaceFor\(serverBase\(\), state\.accountId\)/g) || []).length,
      `${sites.length} site(s)`);
    check("it does not key the mirror on the typed secret",
      !/namespaceFor\([^)]*agentSecret/.test(sidepanel));
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();