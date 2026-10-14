// The dead thumbs up/down is gone, and something real took its place.
//
// The old control wrote `{good: 1}` into `chrome.storage.local` and nothing
// ever read it. It looked like it was reporting a run and was not, and the
// operator had no way to tell — which is the shape of feedback you cannot
// act on. Worse, it was the only affordance in the panel for "this worked",
// so the signal existed and was discarded.
//
// What replaces it has one hard constraint: it must work for a self-hosted
// install. Anything behind an account, an operator's inbox or an endpoint we
// run skips exactly the user whose runs are least represented — and the
// panel's central privacy claim is that a self-hoster's page text never
// reaches us, so phoning home for a "rating" would contradict it.
//
//   node scripts/test-share-run.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src");
const panel = fs.readFileSync(path.join(SRC, "sidepanel.js"), "utf8");
const html = fs.readFileSync(path.join(SRC, "sidepanel.html"), "utf8");

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`); }
}

function extract(name) {
  const start = panel.search(new RegExp(`^(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} in sidepanel.js — renamed?`);
  let parens = 0;
  let bodyStart = -1;
  for (let i = panel.indexOf("(", start); i < panel.length; i++) {
    if (panel[i] === "(") parens++;
    else if (panel[i] === ")" && --parens === 0) { bodyStart = panel.indexOf("{", i); break; }
  }
  let depth = 0;
  for (let i = bodyStart; i < panel.length; i++) {
    if (panel[i] === "{") depth++;
    else if (panel[i] === "}" && --depth === 0) return panel.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

// appendMessage run against a recording fake DOM: every button the toolbar
// builds is captured by the fake `makeIconBtn`, so the assertions are about
// what the user is actually offered, not about the source text.
const icons = vm.runInNewContext(
  '(' + panel.match(/const LUCIDE_ICONS = (\{[\s\S]*?\n\});/)[1]
    .replace(/<svg[\s\S]*?<\/svg>/g, '"<svg>"') + ')'
);
const feedbackUrl = panel.match(/const FEEDBACK_URL = '([^']+)'/)[1];

function renderButtons(role) {
  const s = makeSand(role);
  vm.createContext(s);
  vm.runInContext(extract("escapeHtml"), s);
  vm.runInContext(extract("appendMessage"), s);
  s.appendMessage({ role, text: "", finalAnswer: "here it is" });
  return s;
}

function makeSand(role) {
  const buttons = [];
  const el = (tag) => {
    const node = {
      tagName: tag, className: "", innerHTML: "", textContent: "", value: "",
      children: [], style: {}, attrs: {},
      appendChild: (c) => (node.children.push(c), c && c.__isButton && buttons.push(c), node),
      setAttribute() {}, addEventListener() {}, remove() {},
      querySelector: () => null, classList: { add() {}, remove() {} },
    };
    return node;
  };
  const opened = [];
  const clip = [];
  const toasts = [];
  const s = {
    LUCIDE_ICONS: icons,
    FEEDBACK_URL: feedbackUrl,
    MAX_TASK_CHARS: 1000,
    state: { lastGoal: "book the flight to Lisbon", taskId: "t1" },
    messagesEl: { appendChild() {}, querySelector: () => null },
    document: { createElement: el, execCommand() {}, body: el("body") },
    chrome: {
      tabs: { create: (o) => opened.push(o.url) },
      storage: { local: { get: async () => ({}), set: async () => {} } },
    },
    renderMarkdown: (t) => String(t),
    makeIconBtn: (icon, label, onClick) => ({ icon, label, onClick, className: "", __isButton: true }),
    retryLastTask() {}, stopSpinner() {},
    toast: (t) => toasts.push(String(t)),
    navigator: { clipboard: { writeText: (t) => { clip.push(t); return Promise.resolve(); } } },
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    __opened: opened,
    __clip: clip,
    __toasts: toasts,
    __buttons: buttons,
  };
  return s;
}

(async () => {
  // ── The old control is gone, not commented ──────────────────────────────
  check("recordFeedback is deleted, not disabled", !/recordFeedback/.test(panel));
  check("no thumbs icon is left in the icon table", !/thumbs(Up|Down)/.test(panel));
  check("no rated-good/rated-bad CSS is left orphaned", !/rated-(good|bad)/.test(html));
  check("nothing writes a rating into localStorage",
    !/localStorage.*(good|bad|rating)/i.test(panel));

  // ── The destination: same link for everyone, no backend ────────────────
  check("the destination is a public Discussions composer", /github\.com\/[^/]+\/[^/]+\/discussions\/new/.test(feedbackUrl));
  check("it is a plain https link with no credential in it",
    /^https:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+\/discussions\/new$/.test(feedbackUrl), feedbackUrl);
  check("nothing POSTs the rating anywhere",
    !/fetch\([^)]*feedback/i.test(panel) && !/brottoSessionStore\.put\([^)]*rating/i.test(panel));

  // ── Render path ────────────────────────────────────────────────────────
  const done = renderButtons("done");
  const labels = (done.__buttons || []).map((b) => b.label);
  check("a finished run offers a share control", labels.includes("Share this run"), labels.join(", "));
  check("it offers no rating control", !labels.some((l) => /good|bad/i.test(l)), labels.join(", "));

  const mid = renderButtons("assistant");
  const midLabels = (mid.__buttons || []).map((b) => b.label);
  check("mid-task, the share control is not there",
    !midLabels.includes("Share this run"), midLabels.join(", "));

  // ── The task never leaves the browser except via the clipboard ─────────
  const share = (done.__buttons || []).find((b) => b.label === "Share this run");
  if (share) {
    share.onClick({ stopPropagation() {} });
    await new Promise((r) => setTimeout(r, 0));   // the clipboard write is a promise
    const url = done.__opened[0];
    check("clicking it opens exactly one tab", done.__opened.length === 1);
    check("the tab is the bare Discussions composer, no query string",
      url === feedbackUrl, String(url));
    check("no task text reaches the URL", !/book|flight/i.test(String(url)));
    check("the draft is on the clipboard", /book the flight to Lisbon/.test(done.__clip[0] || ""));
    check("the user is told where it went", (done.__toasts || []).some((t) => /clipboard/i.test(t)),
      JSON.stringify(done.__toasts));
    // The body is read by a maintainer, and the text is whatever the agent saw
    // on a page — so it must be quoted and escaped, not interpolated raw.
    {
      const nasty = makeSand("done");
      vm.createContext(nasty);
      nasty.state.lastGoal = '<!-- owned -->\n[x](http://evil.test) **bold**';
      vm.runInContext(extract("escapeHtml"), nasty);
      vm.runInContext(extract("appendMessage"), nasty);
      nasty.appendMessage({ role: "done", text: "", finalAnswer: "x" });
      const btn = (nasty.__buttons || []).find((b) => b.label === "Share this run");
      btn.onClick({ stopPropagation() {} });
      await new Promise((r) => setTimeout(r, 0));
      const body = nasty.__clip[0] || "";
      check("every line of the task is quoted", body.includes(String.raw`> &lt;\!\-\- owned \-\-&gt;`), body);
      check("a link in the task never becomes a link", !/\[x\]\(http/.test(body));
      check("a comment in the task never becomes a comment", !/<!-- owned -->/.test(body));
      check("markers in the task cannot bold anything", !/\*\*bold\*\*/.test(body));
    }
    // Bound the length: the body is pasted into a third-party form.
    {
      const long = makeSand("done");
      vm.createContext(long);
      long.state.lastGoal = "z".repeat(9000);
      vm.runInContext(extract("escapeHtml"), long);
      vm.runInContext(extract("appendMessage"), long);
      long.appendMessage({ role: "done", text: "", finalAnswer: "x" });
      const btn = (long.__buttons || []).find((b) => b.label === "Share this run");
      btn.onClick({ stopPropagation() {} });
      await new Promise((r) => setTimeout(r, 0));
      check("the task is length-bounded", (long.__clip[0] || "").length < 3000,
        String((long.__clip[0] || "").length));
    }
  }

  // ── No unescaped innerHTML on this path ────────────────────────────────
  const doneSrc = extract("appendMessage");
  const htmlSets = doneSrc.match(/innerHTML\s*=/g) || [];
  check("every innerHTML write in appendMessage goes through renderMarkdown",
    htmlSets.length === (doneSrc.match(/innerHTML = renderMarkdown\(/g) || []).length,
    `${htmlSets.length} writes, ${(doneSrc.match(/innerHTML = renderMarkdown\(/g) || []).length} escaped`);

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
