// The elapsed clock: format, and the reset that failed to rebase it.
//
// Two separate defects, both invisible in a diff. `renderElapsed` printed
// seconds only, so "83.0s" for a run of nearly two minutes. And
// `resetForNewTask` called `stopTimer` where it meant `clearTimer` —
// stopTimer deliberately keeps state.startTime so a finished run's time
// stays on screen, but a reset has no finished run, and the surviving
// startTime made the replay guard (`startedAt && !state.startTime`) refuse
// to rebase, so the *next* run's clock counted from the previous run's
// start and kept running for hours.
//
//   node scripts/test-timer.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXT = path.join(__dirname, "..", "clients", "brotto-extension", "src");
const sidepanel = fs.readFileSync(path.join(EXT, "sidepanel.js"), "utf8");

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

function sandboxWith(extra = {}) {
  const timerEl = { textContent: "" };
  const timerActiveEl = { textContent: "" };
  const s = {
    timerEl,
    timerActiveEl,
    timerInterval: null,
    timerPausedAt: 0,
    state: { startTime: 0 },
    Date,
    clearInterval: () => {},
    setInterval: () => 1,
    ...extra,
  };
  vm.createContext(s);
  vm.runInContext(extract("formatElapsed"), s);
  vm.runInContext(extract("clearTimer"), s);
  vm.runInContext(extract("stopTimer"), s);
  vm.runInContext(extract("renderElapsed"), s);
  return s;
}

(async () => {
  // ── Format ──────────────────────────────────────────────────────────────
  {
    const s = sandboxWith();
    check("sub-minute keeps its tenths — a step is ~30s",
      s.formatElapsed(12300) === "12.3s", s.formatElapsed(12300));
    check("under a minute does not round up into minutes",
      s.formatElapsed(59400) === "59.4s", s.formatElapsed(59400));
    check("just past a minute reads as minutes",
      s.formatElapsed(60000) === "1m0s", s.formatElapsed(60000));
    check("1m23s", s.formatElapsed(83000) === "1m23s", s.formatElapsed(83000));
    check("1h23m26s", s.formatElapsed(5006000) === "1h23m26s", s.formatElapsed(5006000));
    check("exactly one hour is 1h0m0s, not 60m",
      s.formatElapsed(3600000) === "1h0m0s", s.formatElapsed(3600000));
    check("a clock skewed before the run reads 0.0s rather than -3.2s",
      s.formatElapsed(-3200) === "0.0s", s.formatElapsed(-3200));
  }

  // ── Reset rebases ───────────────────────────────────────────────────────
  // The assertion is on state.startTime, because that is what the replay
  // guard reads: `startedAt && !state.startTime`. A surviving base time is
  // invisible in the display until the next replay, and then it is hours off.
  {
    const s = sandboxWith();
    s.state.startTime = 1000;
    vm.runInContext(extract("stopTimer"), s);
    s.stopTimer();
    check("stopTimer keeps the base time — a finished run stays on screen",
      s.state.startTime === 1000, String(s.state.startTime));
  }
  {
    const s = sandboxWith();
    s.state.startTime = 1000;
    s.clearTimer();
    check("clearTimer zeroes the base time", s.state.startTime === 0, String(s.state.startTime));
    check("clearTimer resets the display", s.timerEl.textContent === "0.0s", s.timerEl.textContent);
    // The replay guard's own condition, verbatim: `startedAt && !state.startTime`.
    check("so the replay guard will rebase the next run",
      !!(1000 && !s.state.startTime));
  }

  // The call site, not just the two functions: the whole bug was the wrong one.
  {
    const start = sidepanel.indexOf("async function resetForNewTask(");
    const body = sidepanel.slice(start, start + 1200);
    check("resetForNewTask calls clearTimer", /clearTimer\(\)/.test(body));
    check("…and does not call stopTimer there",
      !/stopTimer\(\)/.test(body), body.match(/.*Timer.*/g)?.join(" | "));
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();