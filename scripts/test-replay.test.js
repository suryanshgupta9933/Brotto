// Replay fidelity: reopening a history row has to rebuild the same
// conversation the user saw live, not a flattened transcript.
//
// The functions under test are extracted from src/sidepanel.js rather than
// copied, so this cannot drift from what ships — the thing the markdown
// work already got wrong once. Extraction is by brace matching, so it only
// has to survive a rename to fail loudly here.
//
//   node scripts/test-replay.test.js

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
  let seen = false;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") { depth++; seen = true; }
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  if (!seen) throw new Error(`unterminated function ${name}`);
  throw new Error(`unterminated function ${name}`);
}

// Same brace match, for a `const NAME = {` block. Copied into the sandbox so
// the vocabulary under test is the one that ships.
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
const rendered = [];
const state = { lastGoal: "" };

const sandbox = {
  state,
  messagesEl: { appendChild() {}, scrollHeight: 0, querySelector: () => null },
  updateStepCount() {},
  iconFor: (kind) => `[icon:${kind}]`,
  deriveReasoningFromAction: (t, kind) => `derived(${t || kind})`,
  appendMessage: (a) => rendered.push({ el: "message", ...a }),
  appendStep: (a) => rendered.push({ el: "step", ...a }),
  appendClarifyCard: (a) => rendered.push({ el: "clarify", ...a }),
  appendApprovalCard: (a) => rendered.push({ el: "approval", ...a }),
  appendLoginCard: (a) => rendered.push({ el: "login", ...a }),
};
sandbox.globalThis = sandbox;

for (const fn of [
  "leadAction", "isTurnThought", "appendStepForTurn", "appendPromptCard",
  "loginOutcome", "renderTranscript", "isOffline", "failureNote", "closingText",
]) {
  vm.runInNewContext(extract(fn), sandbox);
}
vm.runInNewContext(extractConst("FAILURE_NOTE"), sandbox);
vm.runInNewContext(
  "const INTERNAL_ACTIONS = new Set(['write_scratchpad','append_scratchpad','read_scratchpad','recall_memory']);",
  sandbox,
);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
}

// ── A conversation that used all four kinds of prompt ──────────────────────
const doc = {
  schema_version: 2,
  status: "completed",
  tasks: [{ task: "first task" }, { task: "second task" }],
  messages: [
    { role: "user", content: "find my repos", task: 0 },
    { role: "assistant", content: "Opening GitHub.", task: 0, turn: 0 },
    { role: "assistant", content: "You have 3 repos.", task: 0, turn: 2 },
    { role: "user", content: "now star the top one", task: 1 },
    { role: "assistant", content: "Starring it.", task: 1, turn: 3 },
    { role: "assistant", content: "Starred brotto-ui.", task: 1, turn: 4 },
  ],
  turns: [
    {
      task: 0, model: { thought: "Opening GitHub." },
      observation: { url: "https://github.com/new" },
      prompts: [{ kind: "first_navigation", action: "navigate", args: { url: "https://github.com/new" }, domain: "github.com", reason: "First visit to github.com", status: "answered", decision: "approved", response: "yes" }],
      actions: [{ action: "navigate", args: { url: "https://github.com/new" } }],
    },
    {
      task: 0, model: { thought: "Storing a note" },
      observation: { url: "https://github.com/new" },
      prompts: [],
      actions: [{ action: "write_scratchpad", args: {} }],
    },
    {
      task: 0, model: { thought: "Reading the list." },
      observation: { url: "https://github.com/acme?tab=repositories" },
      prompts: [{ kind: "ask_human", action: "ask_human", args: { question: "Private too?" }, status: "answered", decision: "answered", response: "no, just public" }],
      actions: [{ action: "insert_text", args: { text: "hi" } }],
    },
    {
      task: 1, model: { thought: "Starring it." },
      observation: { url: "https://github.com/acme/brotto-ui" },
      prompts: [{ kind: "login_required", action: "login", args: {}, domain: "github.com", status: "answered", decision: "continue", response: "" }],
      actions: [{ action: "left_click", args: { target: "star" } }],
    },
    {
      task: 1, model: null,
      observation: { url: "https://github.com/acme/brotto-ui" },
      prompts: [],
      actions: [],
    },
  ],
};

sandbox.renderTranscript(doc);

const shape = rendered.map((r) => {
  if (r.el === "message") return `message:${r.role}:${(r.text || r.finalAnswer || "").slice(0, 18)}`;
  if (r.el === "step") return `step:${r.text.slice(0, 14)}|${r.pageUrl}|${r.actionTarget || "-"}`;
  return `${r.el}:${r.question || r.reason || r.domain || ""}`;
});

console.log(shape.join("\n"));
console.log("");

check("user message opens each task",
  shape[0] === "message:user:find my repos"
    && rendered.some((r) => r.el === "message" && r.role === "user" && r.text === "now star the top one"),
  shape[0]);

check("every task ends in a done bubble carrying the final answer",
  shape.filter((s) => s.startsWith("message:done:")).length === 2,
  shape.filter((s) => s.startsWith("message:done:")).join(" | "));

check("a step bubble is drawn with its page address",
  shape.some((s) => s.startsWith("step:") && s.includes("github.com/acme/brotto-ui")),
  "no step carried a url");

check("only a navigation carries a destination address",
  rendered.filter((r) => r.el === "step").every((r) =>
    r.actionTarget === null || String(r.actionTarget).startsWith("https://")),
  JSON.stringify(rendered.filter((r) => r.el === "step").map((r) => r.actionTarget)));

check("a scratchpad-only turn draws no step but keeps its thought",
  !rendered.some((r) => r.el === "step" && /Storing a note/.test(r.text))
    && rendered.some((r) => r.el === "message" && r.text === "Storing a note"),
  "scratchpad turn leaked a step or lost its thought");

check("a turn's thought is not also drawn as a step title and a bubble",
  !rendered.some((r) => r.el === "message" && r.text === "Opening GitHub."),
  "thought duplicated");

check("the approval the agent asked for is replayed, resolved",
  rendered.some((r) => r.el === "approval" && r.resolved === "approved" && r.reason.includes("github.com")),
  JSON.stringify(rendered.filter((r) => r.el === "approval")));

check("the question the agent asked is replayed, with the answer",
  rendered.some((r) => r.el === "clarify" && r.resolved === "no, just public" && /Private too/.test(r.question)),
  JSON.stringify(rendered.filter((r) => r.el === "clarify")));

check("a sign-in wall is replayed rather than silently dropped",
  rendered.some((r) => r.el === "login" && r.domain === "github.com" && /Signed in/.test(r.outcome || "")),
  JSON.stringify(rendered.filter((r) => r.el === "login")));

check("the copy button would quote the task that produced the answer",
  state.lastGoal === "now star the top one", state.lastGoal);

// ── A v1 document: turns only, no messages ────────────────────────────────
rendered.length = 0;
state.lastGoal = "";
sandbox.renderTranscript({
  schema_version: 1, status: "completed", goal: "old run",
  result: { summary: "done" },
  turns: [{ task: -1, model: { thought: "Working." }, observation: { url: "https://x.test/" }, prompts: [], actions: [{ action: "navigate", args: { url: "https://x.test/" } }] }],
});
check("a v1 document still renders goal, step and answer",
  rendered.length === 3 && rendered[0].role === "user" && rendered[1].el === "step" && rendered[2].role === "done",
  JSON.stringify(rendered.map((r) => r.el || r.role)));

// ── A run that failed, reopened ────────────────────────────────────────────
// The closing message of a task is drawn as the answer purely because it is
// last. For a run that did not finish, the last message is the *reason it did
// not finish* — so a replayed failure rendered its own error text inside the
// green success bubble, and the panel read as a success while the words under
// the tick said the opposite. Only the colour was wrong; the text was right.
rendered.length = 0;
state.lastGoal = "";
sandbox.renderTranscript({
  schema_version: 2, status: "failed",
  tasks: [{ task: "find my mail", status: "failed" }],
  result: { status: "failed", failure_reason: "invalid_decision", summary: "minimax:MiniMax-M3 could not produce a valid action after 3 attempts." },
  messages: [
    { role: "user", content: "find my mail", task: 0 },
    { role: "assistant", content: "Checking your inbox.", task: 0, turn: 0 },
    { role: "assistant", content: "minimax:MiniMax-M3 could not produce a valid action after 3 attempts.", task: 0, turn: 1 },
  ],
  turns: [
    { task: 0, model: { thought: "Checking your inbox." }, observation: { url: "https://mail.google.com/" }, prompts: [], actions: [{ action: "navigate", args: { url: "https://mail.google.com/" } }] },
    { task: 0, model: { thought: "Reading the list." }, observation: { url: "https://mail.google.com/" }, prompts: [], actions: [] },
  ],
});
const closing = rendered.filter((r) => r.el === "message").pop();
check("a replayed failure is not drawn as a success",
  closing.role === "error", JSON.stringify({ role: closing.role, text: closing.text }));
check("the replayed failure carries the reason it could not continue",
  /rephrase|switch models/i.test(closing.text) && /MiniMax-M3/.test(closing.text), closing.text);
check("a replayed failure adds no third copy of the verdict",
  !rendered.some((r) => r.el === "message" && r.role === "system"), "the This one: line is back");

// An earlier task in a multi-task conversation keeps its own ending, and is not
// relabelled by how the whole conversation happened to end.
rendered.length = 0;
sandbox.renderTranscript({
  schema_version: 2, status: "failed",
  tasks: [{ status: "completed" }, { status: "failed" }],
  messages: [
    { role: "user", content: "first", task: 0 },
    { role: "assistant", content: "Here are your three repos.", task: 0, turn: 0 },
    { role: "user", content: "star the top one", task: 1 },
    { role: "assistant", content: "The model could not continue.", task: 1, turn: 1 },
  ],
  turns: [{ task: 0, model: { thought: "Opening." }, observation: { url: "https://github.com/" }, prompts: [], actions: [] }],
});
const closings = rendered.filter((r) => r.el === "message" && (r.role === "done" || r.role === "error"));
check("an earlier finished task keeps its answer, a later failed one does not",
  closings.length === 2 && closings[0].role === "done" && closings[1].role === "error",
  JSON.stringify(closings.map((r) => r.role)));

// ── The status bar on a replayed session ──────────────────────────────────
// A replay is a receipt, not an instrument: the numbers the run ended on, and
// one word saying how it ended. Both are read off the document, so both are
// here exercised against the real functions.
const cell = { dataset: {}, title: "", removeAttribute(k) { delete this.dataset[k.replace(/^data-/, "")]; } };
const outcomeEl = { textContent: "" };
const contextEl = { textContent: "" };
const timerEl = { textContent: "", title: "" };

Object.assign(sandbox, {
  outcomeCell: cell,
  timerActiveEl: timerEl,
  document: { getElementById: (id) => ({ outcomeValue: outcomeEl, contextValue: contextEl }[id]) },
});
for (const fn of ["setOutcome", "outcomeEntry", "renderReplayMetrics"]) {
  vm.runInNewContext(extract(fn), sandbox);
}
vm.runInNewContext(extractConst("OUTCOME_WORD"), sandbox);
vm.runInNewContext(extractConst("OUTCOME_BY_REASON"), sandbox);

// The grid appearing on a reopened session is the *gate* inside setPhase, not
// the fill — and the gate is the half that silently regressed. setPhase pulls in
// most of the panel, so the two lines that decide it are sliced out of the
// shipping source and run on their own: if someone drops `|| state.replaying`
// the replay goes back to a blank panel and this fails by name.
const GATE = extract("setPhase").match(/const showBar[\s\S]*?outcomeCell\?\.dataset\.state === 'waiting'\) setOutcome\('running'\);/);
if (!GATE) throw new Error("no status-bar gate in setPhase — renamed or rewritten?");
const bar = { on: false, classList: { toggle(k, v) { if (k === "active") this.owner.on = v; }, owner: null } };
bar.classList.owner = bar;
const newTask = { visible: false, classList: { toggle(k, v) { if (k === "visible") newTask.visible = v; } } };
Object.assign(sandbox, { statusBarEl: bar, newTaskBtn: newTask, stopping: false });
vm.runInNewContext(`function gate(phase) { ${GATE[0]} }`, sandbox);

const gate = (phase, replaying, sessionId) => {
  vm.runInContext(`state.replaying = ${replaying}; state.sessionId = ${JSON.stringify(sessionId)};`, sandbox);
  vm.runInContext(`gate(${JSON.stringify(phase)})`, sandbox);
  return bar.on;
};

check("a reopened session shows the grid, though it is not running",
  gate("connected", true, "s-1") === true, `bar.active=${bar.on}`);
check("an idle panel with no conversation shows no grid",
  gate("idle", false, null) === false, `bar.active=${bar.on}`);
check("a live run keeps the grid after it fails",
  gate("error", false, "s-1") === true, `bar.active=${bar.on}`);
check("a reopened session offers New chat", newTask.visible === true);
check("an idle panel does not offer New chat", (() => {
  gate("idle", false, null);
  return newTask.visible === false;
})());

// New chat ends a run, so it must not sit next to one. Clicking it mid-task
// reset the session out from under the agent — the connection kept, the
// conversation did not.
const offersNewChat = (phase, sessionId, stopped) => {
  vm.runInContext(`stopping = ${!!stopped}`, sandbox);
  gate(phase, false, sessionId);
  return newTask.visible;
};
check("a live run does not offer New chat", offersNewChat("executing", "s-1", false) === false);
check("a run waiting on you does not offer New chat", offersNewChat("paused", "s-1", false) === false);
check("a send in flight does not offer New chat", offersNewChat("connecting", "s-1", false) === false);
check("a finished run offers New chat again", offersNewChat("done", "s-1", false) === true);
check("a failed run offers New chat again", offersNewChat("error", "s-1", false) === true);
check("a run you stopped offers New chat", offersNewChat("paused", "s-1", true) === true);
vm.runInContext("stopping = false", sandbox);

// Stop is a pause: stopTask sets the phase to 'paused' so the composer and
// buttons behave, which used to stamp WAITING FOR YOU over the STOPPED BY YOU
// it had just written — a run the user had killed, announcing it was waiting.
check("a pause waits for you", (() => {
  vm.runInContext("stopping = false", sandbox);
  gate("paused", false, "s-1");
  return outcomeEl.textContent === "WAITING FOR YOU";
})(), outcomeEl.textContent);
check("a stop is not a pause, so it does not say it is waiting",
  (() => {
    vm.runInContext("stopping = true", sandbox);
    vm.runInContext("setOutcome('cancelled')", sandbox);
    gate("paused", false, "s-1");
    const out = outcomeEl.textContent;
    vm.runInContext("stopping = false", sandbox);
    return out === "STOPPED BY YOU";
  })(), outcomeEl.textContent);

const words = (status) => { vm.runInContext(`setOutcome(${JSON.stringify(status)})`, sandbox); return outcomeEl.textContent; };

check("a completed run says DONE", words("completed") === "DONE", outcomeEl.textContent);
check("a failed run says ERROR", words("failed") === "ERROR", outcomeEl.textContent);
check("a run you stopped says STOPPED BY YOU", words("cancelled") === "STOPPED BY YOU", outcomeEl.textContent);
check("a run that died on its own says so", words("interrupted") === "ENDED BY ITSELF", outcomeEl.textContent);
check("only the finished run carries a filled mark", (() => {
  vm.runInContext(`setOutcome('completed')`, sandbox);
  const filled = cell.dataset.state;
  vm.runInContext(`setOutcome('failed', 'x', 'auth_failed')`, sandbox);
  return filled === "done" && cell.dataset.state === "error";
})(), JSON.stringify(cell.dataset));

// The server reports `failed` for a run the user stopped, a login they skipped
// and a loop past the backstop, as readily as for a dead socket. One word for
// all of them would call two of them a fault, so the reason refines the word
// and the status only decides the default.
const word = (status, reason) => {
  vm.runInContext(`setOutcome(${JSON.stringify(status)}, '', ${JSON.stringify(reason || null)})`, sandbox);
  return outcomeEl.textContent;
};
check("a run that went wrong says ERROR", word("failed", "auth_failed") === "ERROR", outcomeEl.textContent);
check("declining the action is not an error", word("failed", "user_denied") === "STOPPED BY YOU", outcomeEl.textContent);
check("skipping the sign-in is not an error", word("failed", "user_skipped_login") === "STOPPED BY YOU", outcomeEl.textContent);
check("running past the backstop says so in its own words", word("failed", "runaway_backstop") === "TOO LONG", outcomeEl.textContent);
check("a blocked site is not a fault", word("failed", "policy_blocked") === "BLOCKED", outcomeEl.textContent);
check("the reason is kept for the tooltip", (() => {
  vm.runInContext(`setOutcome('failed', 'Stopped after 150 steps', 'runaway_backstop')`, sandbox);
  return cell.title === "Stopped after 150 steps";
})(), cell.title);

// A user cannot act on a code. Every reason the server writes has to come out
// as a sentence saying which family it was and what to try.
const note = (reason) => vm.runInContext(`failureNote(${JSON.stringify(reason)}, 'raw')`, sandbox);
check("a dropped connection is named as one", /connection/i.test(note("disconnected")), note("disconnected"));
check("a rejected key says where to fix it", /key/i.test(note("auth_failed")), note("auth_failed"));
check("an undecidable model suggests rephrasing", /rephras/i.test(note("invalid_decision")), note("invalid_decision"));
check("a browser we cannot attach to says why", /DevTools/i.test(note("cdp_preflight_failed")), note("cdp_preflight_failed"));
check("an unmapped reason still produces a sentence, not a code", (() => {
  const out = note("some_new_code_nobody_mapped");
  return typeof out === "string" && out.length > 20 && !out.includes("some_new_code_nobody_mapped");
})(), note("some_new_code_nobody_mapped"));
check("a fetch TypeError is read as unreachable, not shown raw", (() => {
  const out = vm.runInContext(`failureNote(null, new TypeError('Failed to fetch'))`, sandbox);
  return /could not reach/i.test(out) && !out.includes("Failed to fetch");
})());

// The server writes six statuses a run can end on, plus two the panel has to
// survive rather than render as a blank (harness.py:1167, and the corrupt /
// unknown a document it cannot read reports). An unmapped status would show a
// bare "—" and read as "nothing happened".
const EVERY_STATUS = [
  "completed", "failed", "cancelled", "interrupted", "awaiting_human",
  "running", "stagnated", "corrupt", "unknown",
];
const unmapped = EVERY_STATUS.filter((s) => words(s) === "—");
check("every status the server can write gets a word", unmapped.length === 0, unmapped.join(", "));

// The word has to fit the 160px half of a 320px panel at 12.5px.
const allWords = vm.runInContext(
  `Object.values(OUTCOME_WORD).concat(Object.values(OUTCOME_BY_REASON)).map(e => e[1])`, sandbox);
check("no outcome word overflows its cell", allWords.every((w) => w.length <= 17),
  allWords.filter((w) => w.length > 17).join(", "));

// The replayed bar, filled from the document.
vm.runInContext(`renderReplayMetrics({
  status: 'failed',
  result: { summary: 'Stopped after 150 steps without finishing' },
  totals: { wall_s: 142.63 },
  turns: [
    { model: { context_pct: 18.0 } },
    { model: { context_pct: 31.4 } },
  ],
})`, sandbox);

check("a replayed bar shows the steps the run took", state.stepCount === 2, state.stepCount);
check("a replayed bar shows the time it spent", timerEl.textContent === "142.6s", timerEl.textContent);
check("a replayed bar shows the context it finished on", contextEl.textContent === "31.4%", contextEl.textContent);
check("a replayed bar carries the harness's own reason", cell.title === "Stopped after 150 steps without finishing", cell.title);

// A v1 document recorded turns only — no totals — and must not read as zero.
timerEl.textContent = "0.0s";
contextEl.textContent = "0%";
vm.runInContext(`renderReplayMetrics({ status: 'completed', turns: [{ model: { context_pct: 12.5 } }] })`, sandbox);
check("a v1 document still fills the cells it has", timerEl.textContent === "0.0s" && contextEl.textContent === "12.5%",
  `${timerEl.textContent} / ${contextEl.textContent}`);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
