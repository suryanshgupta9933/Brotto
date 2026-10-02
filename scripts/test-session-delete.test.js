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
      get() { return this._text; },
      set(v) { this._text = v; },
    },
  });
  return node;
}

// ── Sandbox ────────────────────────────────────────────────────────────────
const store = {};
const calls = [];
let stored = [];
let nextAnswer = true;

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
  fetch: async (url, opts = {}) => {
    calls.push({ url, ...opts });
    return { ok: true, status: 200, json: async () => ({}) };
  },
  toast: (text, kind) => calls.push({ toast: text, kind }),
  confirmSettle: null,
  replaySession: async () => {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const fn of ["askConfirm", "closeConfirm", "deleteSession", "deleteAllSessions",
                  "serverBase", "authHeaders", "listSessions", "renderHistory",
                  "formatSessionTime"]) {
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
  sandbox.fetch = async (url, opts = {}) => {
    calls.push({ url, ...opts });
    return { ok: true, status: 200, json: async () => ({}) };
  };

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

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
