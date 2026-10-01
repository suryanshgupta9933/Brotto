// The busy short-circuit's safety net.
//
// `stability.ts` now gives up on a page that is mutating hard after 1000ms —
// Gmail measured 41 mutations in 10,002ms, so the 3s quiet window was
// arithmetically unreachable and every observation paid the full deadline,
// 47.7% of a two-step run's wall clock. The short-circuit is a *guess*: it
// assumes a page already churning is past its initial render. `auth-slowjs`
// disproves that assumption — its control appears at 5000ms, after almost no
// mutation at all.
//
// So the guess is checked, not trusted. `captureObservation` rescans and
// compares `role|name|value` fingerprints; if two rescans agree the page had
// settled and the short path was right. If every rescan saw something
// different, the page really was still moving, and the guard pays the full
// quiet window (`noEarly`) and scans once more — the pre-existing behaviour.
//
// That guard is the whole justification for the change. If it silently stopped
// firing, a half-rendered tree would reach the model and every metric would
// still look fine. An absence reads clean in a diff, so it is pinned here.
//
// The body is extracted from source and the handful of TypeScript annotations
// are stripped, so the logic under test is the logic that ships.
//
//   node --test scripts/test-observation-rescan-guard.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(
  __dirname, "..", "clients", "brotto-extension", "src", "observation", "index.ts",
);
const src = fs.readFileSync(SRC, "utf8");

function extract(name) {
  const start = src.search(new RegExp(`^(export )?(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} — renamed?`);
  const open = src.indexOf("{", start);
  if (src.slice(start, open).includes("}")) {
    throw new Error(`${name}'s signature has braces in it`);
  }
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`unterminated function ${name}`);
}

// A TS `as {…}` cast, with braces balanced rather than pattern-matched: the
// one in `captureObservation` nests three deep, which no fixed-arity regex
// gets right. An unmatched `as` throws in the vm, so a cast this misses fails
// loudly instead of evaluating as something else.
function stripTypes(body) {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    if (body.startsWith("as {", i) && /\s/.test(body[i - 1] ?? " ")) {
      let depth = 0;
      for (let j = i + 3; j < body.length; j++) {
        if (body[j] === "{") depth++;
        else if (body[j] === "}" && --depth === 0) { i = j; break; }
      }
      continue;
    }
    out += body[i];
  }
  return out.replace(/:\s*any\[\]/g, "").replace(/:\s*any\b/g, "");
}

const BODY = stripTypes(extract("captureObservation"));

// The tree each successive `extractAx` returns. `waited` false means the page
// has not settled; `scans` records how many trees were read.
function harness({ stability, trees }) {
  const calls = { waits: [], scans: 0, sleeps: 0 };
  let i = 0;
  const sandbox = {
    PAGE_TEXT_MAX: 20000,
    sleep: async () => { calls.sleeps++; },
    observationMetrics: (st, geo, scans, targets, bytes) => ({ scans, targets, bytes, stability: st }),
    pageMayStillBeMoving: (st) => !(st && st.waited === true),
    waitForStable: async (tabId, opts) => {
      calls.waits.push(opts);
      return stability;
    },
    extractAx: async () => {
      calls.scans++;
      const t = trees[Math.min(i, trees.length - 1)];
      i++;
      return { targets: t.targets, frames: t.frames ?? {}, geometry: t.geometry ?? {} };
    },
    dbg: { sendCommand: async () => ({ result: { value: { url: "u", title: "t", text: "p" } } }) },
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  const capture = vm.runInNewContext(
    `(async function (tabId) { ${BODY} })`, sandbox,
  );
  return { calls, run: () => capture(7) };
}

const tree = (...names) => ({ targets: names.map((n) => ({ role: "button", name: n })) });

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}\n      ${detail}`);
  }
}

(async () => {
console.log("observation rescan guard");

// 1. THE FAST PATH. Gmail: the sample fires, the tree is already there, the
//    first rescan matches it. The guard must NOT pay a second gate — that is
//    the entire latency saving, and it is invisible in the source.
{
  const h = harness({
    stability: { waited: false, timedOut: true, early: true },
    trees: [tree("Inbox"), tree("Inbox")],
  });
  const obs = await h.run();
  check("a page whose first rescan matches pays no second gate",
    h.calls.waits.length === 1,
    `waitForStable was called ${h.calls.waits.length}× with ${JSON.stringify(h.calls.waits)}`);
  check("…and the scan count reflects the one rescan",
    obs.metrics.scans === 2,
    `scans was ${obs.metrics.scans} (1 initial + 1 matching rescan)`);
  check("…and the targets shipped are the settled ones",
    obs.axTargets[0].name === "Inbox", `got ${JSON.stringify(obs.axTargets)}`);
}

// 2. THE GUARD. `auth-slowjs` mutates almost nothing, so the sample claims it
//    early, but the tree keeps changing — the control really is still arriving.
//    Every rescan differs, so the page was read too early and the full gate is
//    owed. Without this the model gets a tree from 5000ms-in on a page whose
//    control does not exist yet.
{
  const h = harness({
    stability: { waited: false, timedOut: true, early: true },
    trees: [tree("a"), tree("b"), tree("c"), tree("d")],
  });
  const obs = await h.run();
  check("a page still changing after the short-circuit gets the full gate",
    h.calls.waits.length === 2 && h.calls.waits[1]?.noEarly === true,
    `waitForStable was called ${h.calls.waits.length}× with ${JSON.stringify(h.calls.waits)} — ` +
    "the noEarly fallback did not fire, so a half-rendered tree would reach the model");
  check("…and one more scan after it",
    obs.metrics.scans === 4,
    `scans was ${obs.metrics.scans} (1 + 2 rescans + 1 after the gate)`);
  check("…reading the tree as it was after the full wait",
    obs.axTargets[0].name === "d", `got ${JSON.stringify(obs.axTargets)}`);
}

// 3. A page that never even produced an `early` verdict — it ran to the
//    deadline — must not pay a second gate either. That is the old behaviour,
//    preserved: `waited:false, timedOut:true, early:false` is what a genuinely
//    still-moving page looks like when the sample did not take it, and the
//    rescans are already the arbiter there.
{
  const h = harness({
    stability: { waited: false, timedOut: true, early: false },
    trees: [tree("a"), tree("b"), tree("c")],
  });
  const obs = await h.run();
  check("a deadline page pays no second gate",
    h.calls.waits.length === 1,
    `waitForStable was called ${h.calls.waits.length}×`);
  check("…but still takes its two rescans", obs.metrics.scans === 3,
    `scans was ${obs.metrics.scans}`);
}

// 4. The settled page never enters the retry loop at all — the flat ~3s the
//    rescan gate bought. `pageMayStillBeMoving` is false, so one scan, one wait.
{
  const h = harness({
    stability: { waited: true, timedOut: false, early: false },
    trees: [tree("only")],
  });
  const obs = await h.run();
  check("a settled page is scanned exactly once",
    obs.metrics.scans === 1 && h.calls.scans === 1,
    `scans was ${obs.metrics.scans}, extractAx called ${h.calls.scans}×`);
  check("…and never sleeps between reads", h.calls.sleeps === 0,
    `slept ${h.calls.sleeps}×`);
}

// 5. A page that reports both `waited` and `early`. The real gate cannot emit
//    it — the sample only ever resolves `waited:false` — but if a future edit
//    made it possible, `pageMayStillBeMoving` is the gate that matters: a page
//    that *did* go still needs no rescan and no second wait at all. This is why
//    the fallback keys on `early && !settledByFingerprint` rather than on the
//    `early` flag alone.
{
  const h = harness({
    stability: { waited: true, timedOut: false, early: true },
    trees: [tree("x")],
  });
  const obs = await h.run();
  check("a page that went still is never re-waited, whatever early says",
    h.calls.waits.length === 1 && obs.metrics.scans === 1,
    `waits ${h.calls.waits.length}, scans ${obs.metrics.scans}`);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});