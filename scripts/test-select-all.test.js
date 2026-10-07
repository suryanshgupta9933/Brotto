// `clear_ref` sent Ctrl+A. That is select-all on Windows and Linux and *move
// to line start* on macOS, so on a Mac the field kept its old text, the next
// `type_text` appended to it, and a ruleset name typed three times ended up
// holding "Protect mainmainProteProtect mainProtect mainct ma". The model's
// only remaining move was Backspace — one character per step, for ten steps
// (session 7d567b66).
//
// Two fixes for that are both wrong. Branching on `sys.platform` in the relay,
// or sniffing `navigator.platform` in the extension, each make the code
// correct only on the machine you tested on — and the extension is talking to
// a user's laptop, not to the server, so the server has no business deciding.
// `select()` is the DOM's own "select the text in this control" and involves
// no keyboard, so it is the same operation everywhere.
//
// The constant is Python that ships as JavaScript, so it is extracted from
// source and run here against a fake DOM: these cases test the text that
// actually reaches the page, not a paraphrase of it.
//
//   node scripts/test-select-all.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(
  __dirname, "..", "services", "brotto-orchestrator",
  "src", "brotto_orchestrator", "cdp", "relay.py",
);
const source = fs.readFileSync(SRC, "utf8");

// The constant is a Python concatenation of plain string literals, one per
// line. Reading it means joining the literals *as Python evaluates them* —
// taking the source text verbatim would hand this file a syntax error, and
// hand a reviewer a page-side script that never ran. Each literal is a valid
// JSON string, so JSON.parse is the interpreter for it; anything that is not
// one (an f-string, a join, a triple-quoted block) throws here rather than
// silently testing a paraphrase.
function extractSelectAll() {
  const start = source.indexOf("SELECT_ALL_JS = (");
  if (start < 0) throw new Error("no SELECT_ALL_JS in relay.py — renamed?");
  const open = source.indexOf("(", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) { end = i; break; }
  }
  if (end < 0) throw new Error("unterminated SELECT_ALL_JS");

  const body = source.slice(open + 1, end);
  const literals = [];
  const literal = /^\s*("(?:[^"\\]|\\.)*")/gm;
  let m;
  while ((m = literal.exec(body)) !== null) literals.push(JSON.parse(m[1]));
  if (!literals.length) throw new Error("SELECT_ALL_JS has no string literals");
  return literals.join("");
}

// The three element shapes the expression distinguishes, and nothing else —
// it touches no other DOM surface, so a stub that grows a property the
// expression never uses is the signal that the expression grew too.
function element(opts) {
  const el = {
    tagName: opts.tag || "INPUT",
    isContentEditable: opts.editable === true,
    selected: false,
    rangeContents: null,
  };
  if (opts.selectable) el.select = () => { el.selected = true; };
  return el;
}

function run(active) {
  const ranges = [];
  const document = {
    activeElement: active,
    body: element({ tag: "BODY" }),
    getSelection: () => ({
      ranges,
      removeAllRanges: () => { ranges.length = 0; },
      addRange: (r) => ranges.push(r),
    }),
    createRange: () => ({ selectNodeContents: (el) => { el.rangeContents = el; } }),
  };
  // The script is an IIFE — `(function () { ... })()` — so evaluating it in a
  // context with a `document` *is* the call, and yields the verb it returns.
  return vm.runInNewContext(extractSelectAll(), { document });
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

const JS = extractSelectAll();

// ── The platform check, which is the reason this exists ────────────────────
check(
  "the script contains no keyboard shortcut to get wrong",
  !/\b(ctrl|meta|modifier|keydown|keyup|keyboard)\b/i.test(JS),
  `SELECT_ALL_JS mentions a keyboard: ${JS}`,
);

// ── A text field ───────────────────────────────────────────────────────────
const input = element({ tag: "INPUT", selectable: true });
check("an <input> reports select-all", run(input) === "select-all", `got ${run(input)}`);
check("an <input> is actually selected", input.selected === true, "el.select() never ran");

const textarea = element({ tag: "TEXTAREA", selectable: true });
check("a <textarea> is selected", run(textarea) === "select-all", `got ${run(textarea)}`);

// ── A contenteditable, which has no .select() ──────────────────────────────
// Google Docs and every rich-text comment box land here; without the Range
// branch this returns not-a-text-field and the field is never cleared.
const editable = element({ tag: "DIV", editable: true });
check("a contenteditable reports select-all", run(editable) === "select-all", `got ${run(editable)}`);
check("a contenteditable gets a Range over it", editable.rangeContents === editable, "no Range selected");

// ── Things that are not text fields ────────────────────────────────────────
const button = element({ tag: "BUTTON" });
check(
  "a button is refused with its tag, not a false success",
  /^not-a-text-field: BUTTON$/.test(run(button) || ""),
  `got ${run(button)}`,
);
check("nothing was focused is distinguishable", run(null) === "no-focus", `got ${run(null)}`);
check(
  "focus on the body is not a text field either",
  /^not-a-text-field|no-focus/.test(run(element({ tag: "BODY" })) || ""),
  `got ${run(element({ tag: "BODY" }))}`,
);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);