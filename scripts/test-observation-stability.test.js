// The stability gate is the difference between seeing a SPA and not: the old
// wait was `document.readyState === "complete"`, which fires with the load
// event — before the app has rendered anything. `auth-slowjs` measures 5000ms
// for its control to appear, and we were capturing at ~400ms.
//
// The page-side observer runs here, against a fake DOM, so these cases test
// the text that ships rather than a paraphrase of it. The functions are
// extracted from source by brace matching (the pattern
// `test-key-dispatch.test.js` uses) for the same reason: a gate that never
// fires, or one that never stops, is an absence — it reads clean in a diff.
//
//   node --test scripts/test-observation-stability.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(
  __dirname, "..", "clients", "brotto-extension", "src", "observation", "stability.ts",
);
const source = fs.readFileSync(SRC, "utf8");

// Returns the function *body* only, so the extracted text is plain JS. The
// signatures are deliberately brace-free for this reason; a guard below makes
// an edit that breaks that assumption fail loudly instead of quietly.
function extract(name) {
  const start = source.search(new RegExp(`^(export )?(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} in stability.ts — renamed?`);
  const open = source.indexOf("{", start);
  if (source.slice(start, open).includes("}")) {
    throw new Error(`${name}'s signature has braces in it; extraction would match the wrong one`);
  }
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unterminated function ${name}`);
}

function extractConst(name) {
  const start = source.search(new RegExp(`^const ${name} = `, "m"));
  if (start < 0) throw new Error(`no const ${name} in stability.ts — renamed?`);
  const line = source.slice(start, source.indexOf("\n", start));
  return line.slice(line.indexOf("=") + 1).replace(/;\s*$/, "").trim();
}

const BODIES = {
  waitForStable: extract("waitForStable"),
  evalInPage: extract("evalInPage"),
  observerExpression: extract("observerExpression"),
  pageMayStillBeMoving: extract("pageMayStillBeMoving"),
};
const CONSTS = {
  QUIET_MS: extractConst("QUIET_MS"),
  DEADLINE_MS: extractConst("DEADLINE_MS"),
  BUSY_SAMPLE_MS: extractConst("BUSY_SAMPLE_MS"),
  BUSY_MUTATIONS: extractConst("BUSY_MUTATIONS"),
};

// A DOM with no content, a MutationObserver we can fire by hand, and a count
// of how many observers are still installed.
function makeDom() {
  const observers = new Set();
  class MutationObserver {
    constructor(cb) { this.cb = cb; this.seen = null; }
    observe(target, options) { this.seen = { target, options }; observers.add(this); }
    disconnect() { observers.delete(this); }
    takeRecords() { return []; }
  }
  return {
    MutationObserver,
    document: { nodeName: "#document" },
    installed: () => observers.size,
    watch: (o) => observers.has(o),
    mutate: () => { for (const o of [...observers]) o.cb([{ type: "childList" }], o); },
  };
}

// One harness per case: fresh DOM, fresh sandbox, the real extracted source.
// `behaviour` is either "run" (the page script executes) or "reject" (the tab
// navigated out from under the evaluate).
//
// The consts are *evaluated*, not passed as their source text. They reach the
// page script through `JSON.stringify`, and `JSON.stringify("1_000")` is
// `"1000"` — so a string `BUSY_SAMPLE_MS` compiles to `if ("1000" > 0)`,
// which is false, and the busy sample silently never installs. That failure
// is an absence: the whole suite still passes, it just waits longer.
const NUMBERS = Object.fromEntries(
  Object.keys(CONSTS).map((k) => [k, vm.runInNewContext(CONSTS[k])]),
);

function harness({ behaviour = "run", quietMs, deadlineMs } = {}) {
  const dom = makeDom();
  const sent = [];
  const sandbox = {
    ...NUMBERS,
    setTimeout, clearTimeout, setInterval, clearInterval,
    dbg: {
      sendCommand: async (tabId, cmd) => {
        sent.push(cmd);
        if (behaviour === "reject") {
          throw new Error("Command failed: Inspected target navigated or closed");
        }
        const value = await vm.runInNewContext(cmd.params.expression, {
          ...dom,
          setTimeout, clearTimeout, setInterval, clearInterval,
        });
        return { result: { value } };
      },
    },
  };
  // Parameter names are positional here, as in test-replay.test.js: renaming a
  // parameter in stability.ts breaks this loudly rather than silently.
  const factory = vm.runInNewContext(
    `(function () {
       const waitForStable = (async function (tabId, opts) { ${BODIES.waitForStable} });
       const evalInPage = (async function (tabId, expression) { ${BODIES.evalInPage} });
       const observerExpression = (function (quietMs, deadlineMs, earlyMs, busy) { ${BODIES.observerExpression} });
       return function (tabId, opts) { return waitForStable(tabId, opts); };
     })()`,
    sandbox,
  );
  return { dom, sent, wait: (opts) => factory(7, { quietMs, deadlineMs, ...opts }) };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}\n      ${detail}`);
  }
}

// Resolves, or reports that it did not within `ms`.
function bounded(p, ms) {
  return Promise.race([
    p.then((v) => ({ ok: true, v })),
    new Promise((r) => setTimeout(() => r({ ok: false }), ms)),
  ]);
}

(async () => {
  console.log("stability gate");

  // Defaults are the Scalability bounds; they are the ones that run in prod.
  const consts = {};
  for (const k of Object.keys(CONSTS)) consts[k] = vm.runInNewContext(CONSTS[k]);
  check("quiet window defaults to 3000ms", consts.QUIET_MS === 3000, `QUIET_MS was ${consts.QUIET_MS}`);
  check("hard deadline defaults to 10000ms", consts.DEADLINE_MS === 10000, `DEADLINE_MS was ${consts.DEADLINE_MS}`);
  check("the busy sample defaults to 1000ms", consts.BUSY_SAMPLE_MS === 1000,
    `BUSY_SAMPLE_MS was ${consts.BUSY_SAMPLE_MS}`);
  check("busy means 3 mutations in that window", consts.BUSY_MUTATIONS === 3,
    `BUSY_MUTATIONS was ${consts.BUSY_MUTATIONS}`);

  // awaitPromise is load-bearing: without it CDP returns a Promise object and
  // result.value is undefined, so the gate reports "did not wait" every step.
  {
    const h = harness({ quietMs: 60, deadlineMs: 500 });
    const r = await h.wait();
    check("evaluate is sent with awaitPromise", h.sent[0].params.awaitPromise === true,
      `params were ${JSON.stringify(h.sent[0].params).slice(0, 120)}`);
    check("a still page reports quiet", r.waited === true && r.timedOut === false,
      `got ${JSON.stringify(r)}`);
  }

  // 1. quiet page resolves on the quiet window, nowhere near the deadline.
  {
    const h = harness({ quietMs: 150, deadlineMs: 4000 });
    const t0 = Date.now();
    const r = await h.wait();
    const took = Date.now() - t0;
    check("a quiet page resolves well before the deadline",
      r.waited === true && r.timedOut === false && took < 1000,
      `took ${took}ms, got ${JSON.stringify(r)}`);
  }

  // 2. THE CONTRACT: a page that never goes quiet still returns, at the
  // deadline. A live dashboard never mutates out; a barrier here hangs the
  // step forever and nothing downstream can tell you why.
  {
    const h = harness({ quietMs: 400, deadlineMs: 900 });
    const ticker = setInterval(() => h.dom.mutate(), 40);
    const t0 = Date.now();
    const r = await bounded(h.wait(), 3000);
    const took = Date.now() - t0;
    clearInterval(ticker);
    check("a page that never goes quiet still returns", r.ok === true,
      "the gate never resolved — it is a barrier, not a wait");
    check("…and it returns at the deadline",
      r.ok && r.v.waited === false && r.v.timedOut === true && took >= 800 && took < 2000,
      `took ${took}ms, got ${r.ok ? JSON.stringify(r.v) : "no result"}`);
    check("the deadline path disconnects its observer", h.dom.installed() === 0,
      `${h.dom.installed()} observer(s) still installed`);
  }

  // 3. a page that goes quiet late resolves when it goes quiet, not at the
  // deadline — otherwise the gate is just a sleep.
  //
  //    The scales are chosen, not arbitrary. Surviving a 400ms quiet window
  //    needs a mutation at least that often; staying under 3-per-1000ms allows
  //    one per 333ms. The 50ms of overlap is the only window in which a page is
  //    genuinely still rendering and is genuinely not "already rendering" —
  //    outside it the two heuristics disagree and the busy sample takes it.
  {
    const h = harness({ quietMs: 400, deadlineMs: 6000 });
    // Two mutations land before the 1000ms sample (at 350 and 700) — under the
    // threshold of 3, so the sample does not claim it — and each resets the
    // quiet window before its 400ms expires. Rendering stops at 1200 and the
    // gate resolves 400ms after the last mutation.
    const ticker = setInterval(() => h.dom.mutate(), 350);
    const done = setTimeout(() => clearInterval(ticker), 1200);
    const t0 = Date.now();
    const r = await bounded(h.wait(), 9000);
    const took = Date.now() - t0;
    clearTimeout(done);
    clearInterval(ticker);
    // The ceiling is this harness's own 6000ms deadline, not a fixed 3000. The
    // claim is "resolved on the quiet window, not at the deadline", and a fixed
    // bound has no headroom on a loaded box — this flaked at ~3s with the
    // behaviour under test entirely correct.
    check("a slowly-rendering page resolves when it goes quiet, not early",
      r.ok && r.v.waited === true && r.v.early !== true && took >= 1200 && took < 6000,
      `took ${took}ms, got ${r.ok ? JSON.stringify(r.v) : "no result"}`);
    check("…having actually seen the mutations",
      r.ok && r.v.mutations > 0,
      `mutations was ${r.ok ? r.v.mutations : "n/a"} — the observer never fired`);
    check("…and its observer is disconnected", h.dom.installed() === 0,
      `${h.dom.installed()} observer(s) still installed`);
  }

  // 4. THE BUSY SHORT-CIRCUIT. Gmail measured 41 mutations in 10,002ms — one
  //    every ~244ms — so a 3s silent window is arithmetically unreachable and
  //    every observation paid the full 10s deadline: 47.7% of the wall clock of
  //    a two-step run, every step, forever. A page already mutating hard at a
  //    second in is past its initial render, not about to make one.
  {
    const h = harness({ quietMs: 3000, deadlineMs: 10000 });
    const ticker = setInterval(() => h.dom.mutate(), 200);
    const t0 = Date.now();
    const r = await bounded(h.wait(), 14000);
    const took = Date.now() - t0;
    clearInterval(ticker);
    // Same reasoning as case 3: the short-circuit fires at BUSY_SAMPLE_MS
    // (~1s), so "before the deadline" is the real claim and the harness's own
    // 10000 is the honest ceiling. `bounded` sits above it so a regression to
    // the full deadline is caught by this assertion rather than by a timeout.
    check("a page mutating hard returns on the sample, not the deadline",
      r.ok === true && took < 10000,
      `took ${took}ms — the short-circuit did not fire`);
    check("…reporting early, and never reporting itself quiet",
      r.ok && r.v.early === true && r.v.waited === false,
      `got ${r.ok ? JSON.stringify(r.v) : "no result"} — the sample can only say 'not quiet', never 'quiet'`);
    check("…having actually counted the mutations",
      r.ok && r.v.mutations >= consts.BUSY_MUTATIONS,
      `mutations was ${r.ok ? r.v.mutations : "n/a"}`);
    check("…and disconnecting its observer", h.dom.installed() === 0,
      `${h.dom.installed()} observer(s) still installed`);
  }

  // 4b. `noEarly` is the caller's fallback and the reason the misclassification
  //     is safe: a page it wrongly claimed must still get the full quiet window.
  {
    const h = harness({ quietMs: 200, deadlineMs: 900 });
    const ticker = setInterval(() => h.dom.mutate(), 40);
    const t0 = Date.now();
    const r = await bounded(h.wait({ noEarly: true }), 4000);
    const took = Date.now() - t0;
    clearInterval(ticker);
    check("noEarly restores the full gate — no early exit",
      r.ok && r.v.early === false && r.v.waited === false && r.v.timedOut === true,
      `got ${r.ok ? JSON.stringify(r.v) : "no result"}`);
    check("…taking the whole deadline to say so", r.ok && took >= 800,
      `took ${took}ms — noEarly let the sample fire anyway`);
  }

  // 5. a mutation after the resolve must reach nobody: the observer is gone,
  // so it cannot keep firing into the next step's window.
  {
    const h = harness({ quietMs: 100, deadlineMs: 400 });
    await h.wait();
    check("no observer survives the resolve", h.dom.installed() === 0,
      `${h.dom.installed()} observer(s) still installed`);
    let threw = null;
    try { h.dom.mutate(); } catch (e) { threw = e; }
    check("a post-resolve mutation is inert", threw === null && h.dom.installed() === 0,
      threw ? `threw ${threw}` : "an observer is still listening");
  }

  // 6. the tab navigates mid-evaluate: CDP rejects. The step must continue
  // with whatever is on the page rather than waiting out a promise that will
  // never settle.
  {
    const h = harness({ behaviour: "reject" });
    const r = await bounded(h.wait(), 1000);
    check("a rejected evaluate does not hang the step", r.ok === true,
      "waitForStable never settled on a rejected evaluate");
    check("…and reports neither a quiet wait nor a timeout",
      r.ok && r.v.waited === false && r.v.timedOut === false,
      r.ok ? JSON.stringify(r.v) : "no result");
  }

  // 7. THE RESCAN GATE. `captureObservation`'s retry loop ran its first
  //    iteration unconditionally, so a page that had already gone still paid a
  //    second full frame scan. The gate skips that when the page provably sat
  //    still — a flat 3004ms off every settled observation.
  //
  //    The trap is that `timedOut` is not "it went still". Case 6 above
  //    produces the shape that breaks a `!timedOut` gate: a tab that navigated
  //    mid-observe returns timedOut:false, having watched nothing. Gating on
  //    that skips the rescan on a page nobody observed, which is how a
  //    half-rendered tree reaches the model.
  //
  //    Every Stability here is produced by the real `waitForStable` through
  //    the same harness as the cases above, not written out as a literal — a
  //    literal would still pass if the gate shipped alongside a change to what
  //    these three shapes actually are.
  {
    const moving = vm.runInNewContext(
      `(function (stability) { ${BODIES.pageMayStillBeMoving} })`, { Object },
    );

    // A page that sits still: case 1's shape.
    const quiet = await harness({ quietMs: 150, deadlineMs: 4000 }).wait();
    check("a page that went still for the full window is not read again",
      quiet.waited === true && moving(quiet) === false,
      `got ${JSON.stringify(quiet)}, gate said ${moving(quiet)}`);

    // `auth-slowjs`: the control appears at 5000ms, so the page mutates past
    // the quiet window, never settles, and hits the deadline. Case 2's shape.
    // This is the regression gate — it must rescan exactly as it did before.
    const busy = harness({ quietMs: 400, deadlineMs: 900 });
    const ticker = setInterval(() => busy.dom.mutate(), 40);
    const churned = (await bounded(busy.wait(), 3000)).v;
    clearInterval(ticker);
    check("a page that never settled is read again (auth-slowjs)",
      churned && churned.waited === false && churned.mutations > 0 && moving(churned) === true,
      `got ${JSON.stringify(churned)}, gate said ${churned && moving(churned)}`);

    // A tab that navigated mid-evaluate: case 5's shape, and the one a
    // `!timedOut` gate gets wrong.
    const gone = await harness({ behaviour: "reject" }).wait();
    check("a tab that navigated mid-observe is read again, despite timedOut:false",
      gone.timedOut === false && moving(gone) === true,
      `timedOut=${gone.timedOut}, gate said ${moving(gone)}`);

    check("a missing Stability reads as moving, not as quiet",
      moving(undefined) === true, "an absent answer skipped the rescan");
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
