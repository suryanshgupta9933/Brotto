// The panel must say when history is local rather than the server's.
//
// A bad or missing `AGENT_SECRET` is refused with **404, not 403, by design**
// — so one wrong credential 404s `/v1/sessions`, `/v1/suggestions` and
// `/v1/policy` at the same moment. `historyEntries` fell through to the
// IndexedDB mirror and `chrome.storage.local` on all three failure paths and
// said nothing, so "the server rejected us and these are local copies" looked
// identical to "the server has no sessions". That is exactly what the
// operator saw, and it sent them looking for routes that were there.
//
//   node scripts/test-history-source.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src");
const sidepanel = fs.readFileSync(path.join(SRC, "sidepanel.js"), "utf8");

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

// historyEntries against a scripted server, with the merge stubbed to a fixed
// list — this file is about *which branch ran*, not about what merged.
async function sourceFor(response) {
  const s = {
    historySource: "server",
    serverBase: () => "http://box:8000",
    authHeaders: async () => ({}),
    listSessions: async () => [],
    mirrorRows: async () => [],
    mergeHistory: (...srcs) => srcs.flat(),
    panelStatus: (x) => x,
    fetch: response,
  };
  vm.createContext(s);
  vm.runInContext(extract("historyEntries"), s);
  await s.historyEntries();
  return s.historySource;
}

const res = (ok, status, body) => async () => ({
  ok, status, json: async () => body,
});

(async () => {
  // ── Every fall-through records why ──────────────────────────────────────
  check("a server that answers owns the list",
    (await sourceFor(res(true, 200, { sessions: [] }))) === "server");

  // 404 is a *refused credential*, not a stopped server. The panel must not
  // send the user to debug the machine when the key is the problem.
  check("a 404 is recorded as a refused credential, not an outage",
    (await sourceFor(res(false, 404, {}))) === "rejected");

  check("a 500 or any other non-ok is an unreachable server",
    (await sourceFor(res(false, 503, {}))) === "unreachable");
  check("a throw is an unreachable server",
    (await sourceFor(async () => { throw new Error("network down"); })) === "unreachable");
  check("a 200 with no array is an unreachable server",
    (await sourceFor(res(true, 200, { nope: true }))) === "unreachable");

  // ── The card ────────────────────────────────────────────────────────────
  const cards = sidepanel.match(/const HISTORY_SOURCE_CARD = (\{[\s\S]*?\n\});/);
  check("there is a card per non-server source", Boolean(cards));
  if (cards) {
    const table = vm.runInNewContext(`(${cards[1]})`);
    check("a refused credential has its own sentence", Boolean(table.rejected));
    check("a refused credential names the key, not the network",
      /AGENT_SECRET/.test(table.rejected.body) && /Settings/.test(table.rejected.footer),
      table.rejected?.body);
    check("an unreachable server says the conversations are not lost",
      /not lost/.test(table.unreachable.footer), table.unreachable?.footer);
    // Every card is a literal string. None of this is assembled from user or
    // model text, so `appendFailureBubble` may run it through renderMarkdown.
    check("every card field is a plain literal string",
      Object.values(table).every((c) => typeof c.body === "string"
        && typeof c.title === "string" && typeof c.footer === "string"));
  }

  // The card goes above the composer, reusing the theme's own failure card —
  // never back into the top bar the pill was removed from.
  check("it renders through appendFailureBubble, like the model-not-set card",
    /function noteHistorySource\(\)[\s\S]{0,400}appendFailureBubble/.test(sidepanel));
  check("it is not written back into the header",
    !/function noteHistorySource\(\)[\s\S]{0,400}statusBarEl/.test(sidepanel));

  // Re-rendering history must not stack a second copy into the transcript.
  check("a re-render replaces the notice rather than stacking it",
    /\.history-source-card/.test(sidepanel) && /existing\.remove\(\)/.test(sidepanel));

  // renderHistory is the thing that shows it, so opening history is enough.
  check("renderHistory reports the source",
    /async function renderHistory\(\)[\s\S]{0,200}noteHistorySource\(\)/.test(sidepanel));

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();