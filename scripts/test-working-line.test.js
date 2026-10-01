// The live working line: what the panel shows during the ~25s a step spends
// observing and planning, before step_progress fires and there is anything
// real to say.
//
// Three things here can fail silently, which is why they are pinned. The line
// rotation is the whole point of the feature — the same sentence every step
// reads as a stuck animation, which is the problem this replaced. A deferred
// text swap that lands after the step card removed its bubble writes into a
// detached node, so the next step opens on a line nobody asked for. And a
// spinner ticker that outlives its bubble writes frames into a detached node
// every 90ms, which is the kind of leak that only shows up in a long session.
//
// Extracted from src/sidepanel.js by brace matching, like the other panel
// tests, so this cannot drift from what ships.
//
//   node scripts/test-working-line.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src", "sidepanel.js");
const source = fs.readFileSync(SRC, "utf8");

function extract(name) {
  const start = source.search(new RegExp(`^function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} in sidepanel.js — renamed?`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function extractConst(name) {
  const start = source.search(new RegExp(`^const ${name} = \\{`, "m"));
  if (start < 0) throw new Error(`no const ${name} in sidepanel.js — renamed?`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated const ${name}`);
}

// ── Stubs ──────────────────────────────────────────────────────────────────
// Timers are captured rather than scheduled, so a deferred swap is only ever
// written when the test says so. Real timers would make "did this fire early"
// untestable, which is the failure being guarded.
const pending = new Map();
const intervals = new Map();
let nextTimerId = 1;

const sandbox = {
  messagesEl: { scrollHeight: 0, querySelector: () => null },
  setTimeout: (fn, ms) => {
    const id = nextTimerId++;
    pending.set(id, { fn, ms });
    return id;
  },
  clearTimeout: (id) => { pending.delete(id); },
  setInterval: (fn, ms) => {
    const id = nextTimerId++;
    intervals.set(id, { fn, ms });
    return id;
  },
  clearInterval: (id) => { intervals.delete(id); },
  Math: {
    floor: Math.floor,
    // forceIndex < 0 is the real thing; >= 0 pins the spinner picker to one
    // set so every set can be walked deterministically.
    random: () => (forceIndex < 0 ? Math.random() : forceIndex / setCount),
  },
  Date,
};
let forceIndex = -1;
let setCount = 0;

const context = vm.createContext(sandbox);
for (const fn of ["workingLine", "setWorkingText", "dropWorkingMessage", "startSpinner", "stopSpinner"]) {
  vm.runInContext(extract(fn), context);
}
vm.runInContext(extractConst("WORKING_LINES"), context);
vm.runInContext(extractConst("SPINNER_FRAMES"), context);
vm.runInContext(
  "const workingLast = { observe: null, plan: null };" +
  "const SPINNER_KEYS = Object.keys(SPINNER_FRAMES);" +
  "const reduceMotion = { matches: false };" +
  "let spinTimer = null; let spinSet = null; let spinIndex = 0;",
  context,
);
// The module-level state the extracted functions close over.
vm.runInContext(
  "let currentAssistantMsg = null; let workingSwapAt = 0; let workingSwapTimer = null;",
  context,
);
// The fake bubble is built in the context, not marshalled in: a `remove()`
// method does not survive JSON.stringify, and the object under test has to be
// the one the functions actually hold a reference to.
vm.runInContext(
  "let orphan = null;" +
  "function openBubble(text) {" +
  "  const el = { removed: false, remove() { this.removed = true; } };" +
  "  currentAssistantMsg = { el, textNode: { nodeValue: text || 'start' } };" +
  "  workingSwapAt = Date.now() - 5000;" +
  "}",
  context,
);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
}
function fireAllTimers() {
  const entries = [...pending.values()];
  pending.clear();
  for (const t of entries) t.fn();
}

// ── Rotation ───────────────────────────────────────────────────────────────
// Random, but never twice the same in a row. The second half of that is the
// assertion that matters: it is the exact failure that makes random feel
// identical to the fixed line it replaced.
const listLen = vm.runInContext("WORKING_LINES.observe.length", context);
check("both phases have a decent number of lines", listLen >= 6 &&
  vm.runInContext("WORKING_LINES.plan.length", context) >= 6, `observe=${listLen}`);

function drawMany(kind, n) {
  return vm.runInContext(
    `Array.from({length: ${n}}, () => workingLine('${kind}'))`, context,
  );
}

const observed = drawMany("observe", 60);
check("the wording actually varies", new Set(observed).size >= 3, JSON.stringify(observed));
check("every line drawn is one the set defines",
  observed.every((l) => vm.runInContext("WORKING_LINES.observe", context).includes(l)));

check("no phase repeats itself on the next step",
  observed.every((l, i) => i === 0 || l !== observed[i - 1]),
  JSON.stringify(observed.filter((l, i) => i > 0 && l === observed[i - 1])));

// The two phases are drawn independently, so a step's observe line and its
// plan line are free to collide — but neither may stick to itself.
const plans = drawMany("plan", 60);
check("no plan line repeats itself either",
  plans.every((l, i) => i === 0 || l !== plans[i - 1]));

check("an unrecognised phase yields no line", vm.runInContext("workingLine('nonsense')", context) === null);
check("a blank phase yields no line", vm.runInContext("workingLine('')", context) === null);

// ── The hold ───────────────────────────────────────────────────────────────
// A cached page answers fast enough that both phase lines would flash past
// unread, so the second one waits. The first must not.
vm.runInContext("openBubble('start')", context);
pending.clear();
vm.runInContext("setWorkingText('Reading the page')", context);
check("a line arriving after the hold applies at once",
  pending.size === 0 &&
  vm.runInContext("currentAssistantMsg.textNode.nodeValue", context) === "Reading the page");

vm.runInContext("openBubble('start'); workingSwapAt = Date.now();", context);
pending.clear();
vm.runInContext("setWorkingText('Deciding what to do next')", context);
check("a line arriving inside the hold is deferred, not dropped",
  pending.size === 1 &&
  vm.runInContext("currentAssistantMsg.textNode.nodeValue", context) === "start");
fireAllTimers();
check("the deferred line lands when the hold expires",
  vm.runInContext("currentAssistantMsg.textNode.nodeValue", context) === "Deciding what to do next");

// ── A burst collapses to the last one ──────────────────────────────────────
// Observe and plan arrive back to back on a cached page. Both are queued, so
// the first is superseded rather than shown and immediately overwritten.
vm.runInContext("openBubble('start'); workingSwapAt = Date.now();", context);
pending.clear();
vm.runInContext("setWorkingText('Reading the page'); setWorkingText('Deciding what to do next')", context);
check("two lines inside one hold leave one pending swap", pending.size === 1);
fireAllTimers();
check("the survivor is the last line, not the first",
  vm.runInContext("currentAssistantMsg.textNode.nodeValue", context) === "Deciding what to do next");

// ── The step card lands mid-hold ───────────────────────────────────────────
// The whole point of the guard: a swap scheduled before step_card removed the
// bubble must not write into it, or the next step opens on a stale line.
vm.runInContext("openBubble('start'); orphan = currentAssistantMsg; workingSwapAt = Date.now();", context);
pending.clear();
vm.runInContext("setWorkingText('Reading the page')", context);
vm.runInContext("dropWorkingMessage()", context);
check("dropping removes the bubble", vm.runInContext("orphan.el.removed", context) === true);
fireAllTimers();
check("a swap deferred before the drop never lands",
  vm.runInContext("orphan.textNode.nodeValue", context) === "start" &&
  vm.runInContext("currentAssistantMsg", context) === null,
  vm.runInContext("orphan.textNode.nodeValue", context));

check("dropping twice is harmless", vm.runInContext("dropWorkingMessage()", context) === undefined);

// ── The spinner ────────────────────────────────────────────────────────────
const allSets = vm.runInContext("SPINNER_FRAMES", context);
const sets = Object.keys(allSets);
setCount = sets.length;

check("there is more than one spinner to pick from", sets.length >= 4, JSON.stringify(sets));
check("every spinner has frames to cycle",
  sets.every((k) => allSets[k].frames.length > 1),
  JSON.stringify(sets.map((k) => [k, allSets[k].frames.length])));

// "Consistent" is the ask, so it is the assertion: five spinners on one shared
// interval read as one spinner five times. Distinct cadences, and a shape
// family that stays inside the block-drawing ranges the square design language
// actually has — a circle is the one shape the panel has no vocabulary for.
const cadences = sets.map((k) => allSets[k].ms);
check("no two spinners share a cadence", new Set(cadences).size === sets.length,
  JSON.stringify(sets.map((k) => [k, allSets[k].ms])));

const BLOCK = (cp) => (cp >= 0x2580 && cp <= 0x259f);
const BRAILLE = (cp) => (cp >= 0x2800 && cp <= 0x28ff);
const ARROW = (cp) => (cp >= 0x2190 && cp <= 0x21ff);
const offFamily = [];
for (const k of sets) {
  for (const f of allSets[k].frames) {
    const cp = f.codePointAt(0);
    if (!BLOCK(cp) && !BRAILLE(cp) && !ARROW(cp)) offFamily.push(`${k}:${f}`);
  }
}
check("every frame is a block, braille or arrow glyph — no curves", offFamily.length === 0,
  offFamily.join(" "));
check("every frame is a single character",
  sets.every((k) => allSets[k].frames.every((f) => [...f].length === 1)));

// The glyph element lives on the sandbox global, which is what the context
// wraps — assigning it after createContext is what makes it visible in there.
const spinEl = { textContent: "" };
sandbox.spinEl = spinEl;

// Every set is walked, not just whichever one the random pick landed on. The
// picker is a coin toss, so testing one set per run would leave four of the
// five unexercised most of the time, and the two motion modes are exactly the
// thing that has to be covered.
for (const [i, name] of sets.entries()) {
  intervals.clear();
  forceIndex = i;
  vm.runInContext("startSpinner(spinEl)", context);

  const first = spinEl.textContent;
  const frames = allSets[name].frames;
  const len = frames.length;
  const pingPong = !!allSets[name].back;
  const ticks = [...intervals.values()][0];

  check(`${name}: shows a frame immediately`, first === frames[0], first);
  check(`${name}: starts exactly one ticker`, intervals.size === 1, `${intervals.size}`);

  // One tick, then a full traversal by whichever mode this set uses. Ticking
  // an arbitrary count instead would land back on frame 0 for whichever set
  // divides it, which reads as a spinner that never moved.
  ticks.fn();
  check(`${name}: one tick advances off the first frame`,
    spinEl.textContent === frames[1], `${first} -> ${spinEl.textContent}`);

  if (pingPong) {
    for (let i = 2; i < len; i++) ticks.fn();
    check(`${name}: reaches its last frame`, spinEl.textContent === frames[len - 1],
      spinEl.textContent);
    ticks.fn();
    check(`${name}: reverses at the end instead of wrapping`,
      vm.runInContext("spinDir", context) === -1 &&
      spinEl.textContent === frames[len - 2],
      `dir=${vm.runInContext("spinDir", context)} frame=${spinEl.textContent}`);
    for (let i = 0; i < len - 2; i++) ticks.fn();
    check(`${name}: comes back to the first frame`, spinEl.textContent === first,
      spinEl.textContent);
  } else {
    for (let i = 2; i <= len; i++) ticks.fn();
    check(`${name}: wraps from the last frame to the first`,
      spinEl.textContent === first, `${spinEl.textContent} != ${first}`);
  }
}

// The picker is random, so this is only checkable over many draws.
forceIndex = -1;
const drawn = new Set();
for (let i = 0; i < 200; i++) {
  vm.runInContext("startSpinner(spinEl)", context);
  drawn.add(vm.runInContext("SPINNER_KEYS.find((k) => SPINNER_FRAMES[k] === spinSet)", context));
}
check("the picker reaches every set", drawn.size === sets.length, JSON.stringify([...drawn]));

// Two spins in a row must not leave two tickers running.
vm.runInContext("startSpinner(spinEl)", context);
check("starting again replaces the ticker rather than stacking one",
  intervals.size === 1, `${intervals.size} tickers`);

// The step card lands. The bubble goes; the ticker must go with it, or it
// writes into a detached node forever.
vm.runInContext("openBubble('start'); workingSwapAt = Date.now(); startSpinner(spinEl)", context);
vm.runInContext("dropWorkingMessage()", context);
check("dropping the bubble stops the ticker", intervals.size === 0, `${intervals.size} left`);

vm.runInContext("reduceMotion.matches = true", context);
spinEl.textContent = "";
vm.runInContext("startSpinner(spinEl)", context);
check("reduced motion still shows a spinner", spinEl.textContent.length > 0, JSON.stringify(spinEl.textContent));
check("reduced motion starts no ticker", intervals.size === 0, `${intervals.size} started`);
vm.runInContext("reduceMotion.matches = false", context);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
