// Whether the suggestions on screen came from reading the page.
//
// The "Reading page" badge covers the seconds the read takes. These lines are
// what the read produced, and they outlive it — so a caption has to say so
// afterwards, and keep saying it for a line set served from cache. The cache is
// the part that regresses quietly: a fresh fetch is obvious in a diff, a
// replayed one looks identical and is the common case after a reopen.
//
// The functions are extracted from src/sidepanel.js rather than copied, so
// this cannot drift from what ships.
//
//   node scripts/test-suggestion-source.test.js

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
function el() {
  const node = {
    tagName: "DIV",
    id: "",
    className: "",
    _text: "",
    children: [],
    handlers: {},
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    focus() {},
  };
  Object.defineProperty(node, "textContent", {
    get() {
      return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text;
    },
    // Assigning textContent removes every child, which is how `paintSuggestions`
    // clears the box before it refills it. Without that, children from the
    // previous paint survive and every assertion reads a union of two screens.
    set(v) { this._text = v; this.children = []; },
  });
  return node;
}

// ── Sandbox ────────────────────────────────────────────────────────────────
const suggestions = el();
const byId = { suggestions };

// Set by each test: what the server answers.
let answer = { lines: [], context_used: false };
let localStore = {};
let calls = [];

const sandbox = {
  console, Date, Promise,
  setTimeout, clearTimeout,
  // Not a vm-context global here, and `suggestionKey` swallows the resulting
  // TypeError into an empty key — so without it every fetch silently returns
  // null and the test would pass nothing.
  URL,
  document: {
    createElement: (tag) => { const n = el(); n.tagName = String(tag).toUpperCase(); return n; },
    getElementById: (id) => byId[id] || null,
  },
  plannerUrlEl: { value: "http://localhost:8000" },
  SUGGESTION_CACHE_KEY: "suggestionCache",
  SUGGESTION_CACHE_MAX: 40,
  SUGGESTION_TTL_DEFAULT_MS: 24 * 60 * 60 * 1000,
  SUGGESTION_TTL_CONTEXT_MS: 10 * 60 * 1000,
  chrome: {
    storage: {
      local: {
        get: async (k) => ({ [k]: localStore[k] }),
        set: async (obj) => { Object.assign(localStore, obj); },
      },
      session: { get: async () => ({ modelApiKey: "sk-test" }) },
    },
  },
  fetch: async (url, opts = {}) => {
    calls.push({ url, ...opts });
    return { ok: true, status: 200, json: async () => answer };
  },
  authHeaders: async () => ({}),
  deviceId: async () => "dev-test",
  fillComposer: () => {},
  // Module-scope state `fetchSuggestions` reads, declared here so the sandbox
  // has it: extraction pulls the function body, not the file's top level.
  suggestionInFlight: '',
  FALLBACK_SUGGESTIONS: ['Ask Brotto anything'],
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const fn of ["suggestionKey", "readSuggestionCache", "writeSuggestionCache",
                  "contextSuggestionsEnabled", "fetchSuggestions", "paintSuggestions"]) {
  vm.runInContext(extract(fn), sandbox);
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
}

const note = () => {
  const n = suggestions.children.find((c) => c.className === "suggestion-note");
  return n ? n.textContent : null;
};
const caption = () => suggestions.children.map((c) => c.textContent).join("|");

(async () => {
  // ── A page read leaves a mark ──────────────────────────────────────────
  // Page suggestions on, which is the only state a read can happen in — and
  // the only state a replay can be tested in, since the opt-out at the bottom
  // refuses a context entry outright once the setting is off.
  localStore = { settings: { contextSuggestions: true } };
  answer = { lines: ["Search the HDFC statement"], context_used: true };
  let hit = await sandbox.fetchSuggestions("https://hdfc.test/a", "Statement", "some page text");
  check("the server's own answer is what decides the flag, not whether the read worked",
    hit.fromContext === true, JSON.stringify(hit));
  sandbox.paintSuggestions(hit.lines, hit.fromContext);
  check("the button is painted", caption().includes("Search the HDFC statement"), caption());
  check("and the line says it came from the page", note() !== null, caption());
  check("the cache remembers that it did",
    localStore.suggestionCache[sandbox.suggestionKey("https://hdfc.test/a")].context === true,
    JSON.stringify(localStore.suggestionCache));

  // ── A read that found nothing leaves no mark ──────────────────────────
  // A different host, so this cannot read the previous block's cache entry.
  // The store is not reset between blocks: block 3 replays both entries, and
  // wiping it is what would turn a cache hit back into a fetch.
  // The page was opened and yielded no text — a shell that renders from script,
  // a body the probe could not reach. The server says so, and claiming a read
  // that produced nothing would be the same lie as claiming one that did.
  answer = { lines: ["Open the recent tab"], context_used: false };
  hit = await sandbox.fetchSuggestions("https://icici.test/b", "Accounts", "");
  sandbox.paintSuggestions(hit.lines, hit.fromContext);
  check("suggestions the model did not see the page for are not captioned",
    note() === null, caption());
  check("and neither is the flag", hit.fromContext === false, JSON.stringify(hit));

  // ── A replayed line set keeps the mark ────────────────────────────────
  // The case that regresses quietly: the second visit is served from cache, so
  // nothing about this code path looks like a page read on the wire.
  calls = [];
  hit = await sandbox.fetchSuggestions("https://hdfc.test/a", "Statement");
  check("a cache hit does not call the server again", calls.length === 0, JSON.stringify(calls));
  check("and still reports the page it was read from", hit.fromContext === true, JSON.stringify(hit));
  sandbox.paintSuggestions(hit.lines, hit.fromContext);
  check("so the caption is still there on reopen", note() !== null, caption());

  // A cached line set built without a read keeps the absence too.
  hit = await sandbox.fetchSuggestions("https://icici.test/b", "Accounts", "");
  sandbox.paintSuggestions(hit.lines, hit.fromContext);
  check("a cached no-read line set is not captioned either", note() === null, caption());
  check("and it was the cache that answered both times", calls.length === 0, JSON.stringify(calls));

  // ── Opting out must not replay a line set the page produced ──────────
  localStore = {
    suggestionCache: {
      [sandbox.suggestionKey("https://hdfc.test/a")]: {
        at: Date.now(), ttl: 10 * 60 * 1000, context: true,
        lines: ["Search the HDFC statement"],
      },
    },
  };
  localStore.settings = { contextSuggestions: false };
  calls = [];
  sandbox.paintSuggestions(sandbox.FALLBACK_SUGGESTIONS);
  check("opting out drops the cached line set rather than replaying it",
    await sandbox.fetchSuggestions("https://hdfc.test/a", "Statement") === null);
  check("and nothing is read to replace it",
    calls.length === 0, JSON.stringify(calls));

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
