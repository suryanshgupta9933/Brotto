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
  vm.runInContext(extract("copyWithFallback"), s);
  // The completed card's honesty sentence — a module const the done branch
  // reads, so it has to be in the sandbox the way the helpers are.
  vm.runInContext(panel.match(/const REPORTED_(?:NOTE|SUMMARY) =[\s\S]*?;/g).join("\n"), s);
  vm.runInContext(extract("appendMessage"), s);
  s.appendMessage({ role, text: "", finalAnswer: "here it is" });
  return s;
}

function boot(s) {
  vm.createContext(s);
  vm.runInContext(extract("escapeHtml"), s);
  vm.runInContext(extract("copyWithFallback"), s);
  vm.runInContext(panel.match(/const REPORTED_(?:NOTE|SUMMARY) =[\s\S]*?;/g).join("\n"), s);
  vm.runInContext(extract("appendMessage"), s);
  s.appendMessage({ role: "done", text: "", finalAnswer: "x" });
  return (s.__buttons || []).find((b) => b.label === "Share this run");
}

function makeSand(role) {
  const buttons = [];
  const el = (tag) => {
    const node = {
      tagName: tag, className: "", innerHTML: "", textContent: "", value: "",
      children: [], style: {}, attrs: {},
      appendChild: (c) => (node.children.push(c), c && c.__isButton && buttons.push(c), node),
      setAttribute() {}, addEventListener() {}, remove() {}, select() {},
      removeChild() {},
      querySelector: () => null, classList: { add() {}, remove() {} },
    };
    return node;
  };
  const opened = [];
  const clip = [];
  const toasts = [];
  const execs = [];
  const s = {
    LUCIDE_ICONS: icons,
    FEEDBACK_URL: feedbackUrl,
    MAX_TASK_CHARS: 1000,
    state: { lastGoal: "book the flight to Lisbon", taskId: "t1" },
    messagesEl: { appendChild() {}, querySelector: () => null },
    document: { createElement: el, execCommand: () => { execs.push(1); return s.__clipMode === "fallback"; }, body: el("body") },
    chrome: {
      tabs: { create: (o) => opened.push(o.url) },
      storage: { local: { get: async () => ({}), set: async () => {} } },
    },
    renderMarkdown: (t) => String(t),
    makeIconBtn: (icon, label, onClick) => ({ icon, label, onClick, className: "", __isButton: true }),
    retryLastTask() {}, stopSpinner() {},
    toast: (t) => toasts.push(String(t)),
    navigator: { clipboard: { writeText: (t) => {
      clip.push(t);
      // 'ok' | 'fallback' | 'dead' — 'fallback'/'dead' are what a panel that
      // has lost focus actually sees: the async API refuses and only the
      // textarea path can save it.
      return s.__clipMode === "ok" ? Promise.resolve() : Promise.reject(new Error("no clipboard"));
    } } },
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    __opened: opened,
    __clip: clip,
    __toasts: toasts,
    __buttons: buttons,
    __execs: execs,
    __clipMode: "ok",
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
      nasty.state.lastGoal = '<!-- owned -->\n[x](http://evil.test) **bold**';
      const btn = boot(nasty);
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
      long.state.lastGoal = "z".repeat(9000);
      const btn = boot(long);
      btn.onClick({ stopPropagation() {} });
      await new Promise((r) => setTimeout(r, 0));
      check("the task is length-bounded", (long.__clip[0] || "").length < 3000,
        String((long.__clip[0] || "").length));
    }
  }

  // ── The tab opens only after a confirmed write ─────────────────────────
  // The order used to be tabs.create() then writeText(). When the write
  // refused, the user was already on an empty public composer and was told to
  // copy a draft that had never been written anywhere — it exists only in the
  // variable whose write threw.
  {
    const dead = makeSand("done");
    dead.__clipMode = "dead";
    const btn = boot(dead);
    btn.onClick({ stopPropagation() {} });
    await new Promise((r) => setTimeout(r, 0));
    check("a failed copy opens no tab", dead.__opened.length === 0,
      JSON.stringify(dead.__opened));
    check("the fallback was tried before giving up", dead.__execs.length === 1,
      String(dead.__execs.length));
    check("the failure toast says the draft was not copied",
      dead.__toasts.some((t) => /not copied/i.test(t)), JSON.stringify(dead.__toasts));
    check("the failure toast does not point at a draft on screen",
      !dead.__toasts.some((t) => /from the run above/i.test(t)),
      JSON.stringify(dead.__toasts));
  }
  {
    const ok = makeSand("done");
    ok.__clipMode = "ok";
    const btn = boot(ok);
    btn.onClick({ stopPropagation() {} });
    await new Promise((r) => setTimeout(r, 0));
    check("a confirmed copy opens the tab", ok.__opened.length === 1,
      JSON.stringify(ok.__opened));
    check("the success toast comes after the tab", ok.__toasts.length === 1);
  }
  {
    // The async clipboard API refuses in a panel that has lost focus; the
    // textarea path is the only thing that works there. A write that lands on
    // it is still a confirmed write.
    const fb = makeSand("done");
    fb.__clipMode = "fallback";
    const btn = boot(fb);
    btn.onClick({ stopPropagation() {} });
    await new Promise((r) => setTimeout(r, 0));
    check("the execCommand fallback still opens the tab", fb.__opened.length === 1,
      JSON.stringify(fb.__opened));
    check("the fallback copy carries the draft",
      /book the flight to Lisbon/.test(fb.__clip[0] || ""), String(fb.__clip[0]));
  }

  // ── One copy path, not two ─────────────────────────────────────────────
  // The Copy-task button already had the textarea fallback; the share flow
  // wrote its own copy inline. Two implementations of "put this on the
  // clipboard" is how the fallback gets fixed in one and not the other.
  check("there is exactly one copy helper", (panel.match(/async function copyWithFallback\(/g) || []).length === 1);
  check("no textarea + execCommand fallback lives anywhere else",
    (panel.match(/execCommand\('copy'\)/g) || []).length === 1);
  check("the Copy-task button goes through the helper",
    /copyWithFallback\(copyText\)/.test(extract("appendMessage")));
  check("the share flow goes through the same helper",
    /copyWithFallback\(body\)/.test(extract("appendMessage")));
  check("the share flow writes before it opens the tab",
    extract("appendMessage").indexOf("copyWithFallback(body)")
      < extract("appendMessage").indexOf("chrome.tabs.create({ url: FEEDBACK_URL })"));

  // ── No unescaped innerHTML on this path ────────────────────────────────
  const doneSrc = extract("appendMessage");
  const htmlSets = doneSrc.match(/innerHTML\s*=/g) || [];
  check("every innerHTML write in appendMessage goes through renderMarkdown",
    htmlSets.length === (doneSrc.match(/innerHTML = renderMarkdown\(/g) || []).length,
    `${htmlSets.length} writes, ${(doneSrc.match(/innerHTML = renderMarkdown\(/g) || []).length} escaped`);

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
