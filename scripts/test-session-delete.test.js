// Erasure from the history panel: the row, the confirmation, and the call
// that removes the transcript from disk.
//
// The functions under test are extracted from src/sidepanel.js rather than
// copied, so this cannot drift from what ships. Extraction is by brace
// matching, so it only has to survive a rename to fail loudly here.
//
//   node scripts/test-session-delete.test.js

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

// ── Fake DOM ───────────────────────────────────────────────────────────────
let uid = 0;
const focused = [];

function el(extra = {}) {
  const node = {
    tagName: "DIV",
    id: "",
    value: "",
    children: [],
    attrs: {},
    dataset: {},
    handlers: {},
    hidden: false,
    title: "",
    type: "",
    _text: "",
    _classes: new Set(),
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { cs.forEach((c) => this.children.push(c)); },
    replaceChildren(...cs) { this.children = cs; },
    focus() { focused.push(this.id); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    dispatchEvent(ev) { for (const fn of this.handlers[ev.type] || []) fn(ev); return true; },
    querySelector(sel) { return this._find(sel.replace(/^\./, "")); },
    _find(name) {
      for (const c of this.children) {
        if (c._classes.has(name)) return c;
        const hit = c._find(name);
        if (hit) return hit;
      }
      return null;
    },
  };
  node._innerHTML = "";
  Object.assign(node, extra);
  Object.defineProperties(node, {
    // sidepanel.js builds history rows from a static HTML string. The real
    // parser is not under test, only the class lookup that follows it, so
    // this makes one child per `class="…"` in document order — flat, where
    // the browser would nest. Nothing here reads nesting.
    innerHTML: {
      get() { return node._innerHTML; },
      set(v) {
        node._innerHTML = v;
        node.children = [];
        for (const m of v.matchAll(/class="([^"]+)"/g)) {
          node.appendChild(el({ _classes: new Set(m[1].split(/\s+/)) }));
        }
      },
    },
    // sidepanel.js assigns `className` as a string; without this the class
    // never reaches `_classes` and every `_classes.has` check below is false.
    className: {
      get() { return [...this._classes].join(" "); },
      set(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    },
    classList: {
      value: {
        add: (c) => node._classes.add(c),
        remove: (c) => node._classes.delete(c),
        contains: (c) => node._classes.has(c),
      },
    },
    textContent: {
      // The DOM's own concatenation: the code under test builds a row's meta
      // line by appending spans, and the assertion reads the result.
      get() {
        return this.children.length
          ? this.children.map((c) => c.textContent).join("")
          : this._text;
      },
      set(v) { this._text = v; },
    },
  });
  return node;
}

// ── Sandbox ────────────────────────────────────────────────────────────────
// One fetch, restored in both directions. A second copy that drifts is how a
// test stops testing what ships.
function fakeFetch(url, opts = {}) {
  calls.push({ url, ...opts });
  if (serverDown) throw new Error("offline");
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ sessions: serverSessions }) });
}

const store = {};
const calls = [];
let stored = [];
let nextAnswer = true;
// undefined = the server answered but had no list to give (the default for
// every delete test, which only cares about the DELETE call). Set it to make
// the server the source of history; set serverDown to make it unreachable.
let serverSessions;
let serverDown = false;

const historyList = el({ id: "historyList" });
const historyDeleteAll = el({ id: "historyDeleteAll" });
const confirmOverlay = el({ id: "confirmOverlay" });
const confirmTitle = el({ id: "confirmTitle" });
const confirmBody = el({ id: "confirmBody" });
const confirmOk = el({ id: "confirmOk" });
const confirmCancel = el({ id: "confirmCancel" });
const byId = {
  historyList, historyDeleteAll, confirmOverlay, confirmTitle, confirmBody,
  confirmOk, confirmCancel,
};

const docListeners = {};
const sandbox = {
  console, Date, Promise,
  setTimeout, clearTimeout,
  document: {
    createElement: (tag) => el({ tagName: String(tag).toUpperCase(), id: `n${++uid}` }),
    getElementById: (id) => byId[id] || null,
    addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
    listeners: docListeners,
    activeElement: null,
  },
  plannerUrlEl: { value: "http://localhost:8000" },
  historyList,
  historyDeleteAll,
  confirmOverlay, confirmTitle, confirmBody, confirmOk, confirmCancel,
  SESSIONS_KEY: "sessions",
  chrome: {
    storage: {
      local: {
        get: async (k) => ({ [k]: stored }),
        set: async (obj) => { Object.assign(store, obj); stored = obj.sessions ?? stored; },
      },
    },
  },
  fetch: fakeFetch,
  toast: (text, kind) => calls.push({ toast: text, kind }),
  confirmSettle: null,
  replaySession: async () => {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const fn of ["askConfirm", "closeConfirm", "deleteSession", "deleteAllSessions",
                  "serverBase", "authHeaders", "listSessions", "historyEntries",
                  "renderHistory", "formatSessionTime"]) {
  vm.runInContext(extract(fn), sandbox);
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
}

const SESSIONS = [
  { task: "find the cheapest flight", status: "done", steps: 4, elapsed: "2m",
    startedAt: 1, session_id: "aaa", task_count: 1 },
  { task: "star brotto-ui", status: "done", steps: 2, elapsed: "30s",
    startedAt: 2, session_id: "bbb", task_count: 1 },
];

function reset(sessions = SESSIONS) {
  stored = [...sessions];
  store.sessions = stored;
  historyList.replaceChildren();
  confirmOverlay._classes.delete("open");
  calls.length = 0;
  focused.length = 0;
  nextAnswer = true;
  serverSessions = undefined;
  serverDown = false;
}

// ── The confirmation ───────────────────────────────────────────────────────
// Answered from a microtask, so the code under test drives the real
// ask/settle path instead of the test reaching in and settling a promise of
// its own — which would settle the wrong one, since askConfirm supersedes.
const realAskConfirm = sandbox.askConfirm;
let asked = null;
sandbox.askConfirm = (...args) => {
  const p = realAskConfirm(...args);
  asked = {
    title: sandbox.confirmTitle.textContent,
    body: sandbox.confirmBody.children.map((c) => c.textContent).join(""),
    focused: focused.slice(),
    open: sandbox.confirmOverlay._classes.has("open"),
  };
  queueMicrotask(() => sandbox.closeConfirm(nextAnswer));
  return p;
};

(async () => {
  // ── A row carries a delete control ────────────────────────────────────
  reset();
  await sandbox.renderHistory();
  check("every session gets a row", historyList.children.length === SESSIONS.length,
    `got ${historyList.children.length}`);
  const wrap = historyList.children[0];
  check("the row is wrapped, so two buttons share one ledger rule",
    wrap._classes.has("history-row") && wrap.children.length === 2,
    wrap._classes && [...wrap._classes].join(","));
  const del = wrap.children[1];
  check("the second control is the delete button",
    del._classes.has("history-delete") && del.type === "button");
  check("it names the conversation it will erase",
    (del.getAttribute("aria-label") || "").includes("find the cheapest flight"),
    del.getAttribute("aria-label"));

  // ── Deleting asks first ───────────────────────────────────────────────
  reset();
  await sandbox.renderHistory();
  calls.length = 0;
  nextAnswer = false;
  await sandbox.deleteSession(SESSIONS[0]);
  check("clicking delete opens the question", asked && asked.open === true);
  check("the question names the conversation by its own words",
    asked && asked.title.toLowerCase().includes("delete")
      && asked.body.includes("find the cheapest flight"),
    JSON.stringify(asked));
  check("the destructive answer has the keyboard focus",
    asked && asked.focused.includes("confirmOk"), JSON.stringify(asked && asked.focused));
  check("answering no erases nothing",
    calls.length === 0 && stored.length === 2, JSON.stringify(calls));
  check("and closes the question",
    !confirmOverlay._classes.has("open"));

  // ── Answering yes removes the row and calls the server ────────────────
  reset();
  await sandbox.renderHistory();
  calls.length = 0;
  nextAnswer = true;
  await sandbox.deleteSession(SESSIONS[0]);
  const dels = calls.filter((c) => c.method === "DELETE");
  check("it calls DELETE on that session only",
    dels.length === 1 && dels[0].url === "http://localhost:8000/v1/sessions/aaa",
    JSON.stringify(calls));
  check("the row is gone from this browser", stored.length === 1 && stored[0].session_id === "bbb",
    JSON.stringify(stored));
  check("and it says so", calls.some((c) => c.toast === "Deleted from the server"),
    JSON.stringify(calls));

  // ── The other rows are untouched ──────────────────────────────────────
  reset();
  await sandbox.renderHistory();
  calls.length = 0;
  nextAnswer = false;
  historyList.children[0].children[1].dispatchEvent({ type: "click" });
  await new Promise((r) => setImmediate(r));
  check("cancelling leaves the list exactly as it was", stored.length === 2,
    JSON.stringify(stored));

  // ── A row with no session id has no server file behind it ─────────────
  reset([{ task: "an old row", status: "done", steps: 1, elapsed: "—",
           startedAt: 3, session_id: null, task_count: 1 }]);
  await sandbox.renderHistory();
  calls.length = 0;
  nextAnswer = true;
  await sandbox.deleteSession(stored[0]);
  check("a row written before ids existed still disappears locally",
    stored.length === 0, JSON.stringify(stored));
  check("and asks the server for nothing",
    calls.filter((c) => c.method === "DELETE").length === 0, JSON.stringify(calls));

  // ── A server that refuses must not be reported as a deletion ──────────
  reset();
  await sandbox.renderHistory();
  calls.length = 0;
  sandbox.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  nextAnswer = true;
  await sandbox.deleteSession(SESSIONS[0]);
  check("a refused delete says the file may still be on disk",
    calls.some((c) => c.toast && c.toast.includes("still be on disk")),
    JSON.stringify(calls));
  sandbox.fetch = fakeFetch;

  // ── Delete-all ────────────────────────────────────────────────────────
  reset();
  await sandbox.renderHistory();
  check("delete all appears only when there is something to delete",
    historyDeleteAll.hidden === false);
  calls.length = 0;
  nextAnswer = true;
  await sandbox.deleteAllSessions();
  check("delete-all names the count, not a session",
    asked && asked.body.includes("2 conversations"), JSON.stringify(asked));
  const allDels = calls.filter((c) => c.method === "DELETE");
  check("it clears the whole server, not one row",
    allDels.length === 1 && allDels[0].url === "http://localhost:8000/v1/sessions",
    JSON.stringify(calls));
  check("and empties this browser's list", stored.length === 0, JSON.stringify(stored));

  reset([]);
  await sandbox.renderHistory();
  check("delete all is hidden on an empty list", historyDeleteAll.hidden === true);
  check("and the empty state says what history is for",
    historyList.children.length === 1
      && historyList.children[0]._classes.has("history-empty"));

  // ── The server is the record; this browser is the fallback ────────────
  // The local array caps at 20 and only knows what this browser watched, so
  // anything the server knows and it does not is a conversation the user
  // cannot see — and cannot delete.
  const ON_DISK = [
    { session_id: "ccc", title: "cancel the hotel booking", status: "done",
      steps: 9, task_count: 2, started_at: "2026-10-03T04:12:00.000+00:00" },
    { session_id: "ddd", task: "apply for the card", status: "interrupted",
      steps: 3, task_count: 1, started_at: "2026-10-02T18:40:00.000+00:00" },
  ];

  reset([]);
  serverSessions = ON_DISK;
  await sandbox.renderHistory();
  check("history comes from the server, not this browser's 20 rows",
    historyList.children.length === 2, `${historyList.children.length} rows`);
  check("a conversation this browser never saw is still listed",
    calls.some((c) => c.url === "http://localhost:8000/v1/sessions" && !c.method),
    JSON.stringify(calls));
  const firstRow = historyList.children[0].children[0];
  check("its own wording survives the trip",
    firstRow.querySelector(".history-task").textContent === "cancel the hotel booking",
    firstRow.querySelector(".history-task").textContent);
  check("a two-task conversation says so",
    firstRow.querySelector(".history-meta").textContent.includes("2 tasks"),
    firstRow.querySelector(".history-meta").textContent);
  check("a run that never finished is marked as it ended",
    historyList.children[0].children[0].dataset.status === "done"
      && historyList.children[1].children[0].dataset.status === "interrupted",
    historyList.children[1].children[0].dataset.status);

  // Deleting a row the server supplied. This browser watched the same run, so
  // it has a local row too — but a *different object*, rebuilt from the index
  // on every open. Removing it by identity would leave the local row behind
  // and the conversation would come back the moment the server is unreachable.
  const DUPLICATE = [
    ...SESSIONS,
    { task: "cancel the hotel booking", status: "done", steps: 9, elapsed: "3m",
      startedAt: 3, session_id: "ccc", task_count: 2 },
  ];
  reset(DUPLICATE);
  serverSessions = ON_DISK;
  await sandbox.renderHistory();
  calls.length = 0;
  nextAnswer = true;
  await sandbox.deleteSession(ON_DISK[0]);
  const serverDel = calls.filter((c) => c.method === "DELETE");
  check("deleting a server row still reaches the server",
    serverDel.length === 1
      && serverDel[0].url === "http://localhost:8000/v1/sessions/ccc",
    JSON.stringify(serverDel));
  check("and clears the stale local row with it",
    stored.length === 2 && !stored.some((s) => s.session_id === "ccc"),
    JSON.stringify(stored));

  // ── No server, no empty list ──────────────────────────────────────────
  reset(SESSIONS);
  serverDown = true;
  await sandbox.renderHistory();
  check("an unreachable server falls back to what this browser knows",
    historyList.children.length === 2, `${historyList.children.length} rows`);
  check("and says nothing about it", calls.every((c) => c.toast === undefined),
    JSON.stringify(calls));

  reset(SESSIONS);
  sandbox.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await sandbox.renderHistory();
  check("a wrong secret is the same fallback, not an empty history",
    historyList.children.length === 2, `${historyList.children.length} rows`);
  sandbox.fetch = fakeFetch;

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
