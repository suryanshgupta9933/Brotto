// The `evaluate` frame's one optional field: `isolatedWorld`.
//
// The failure this guards is silent and one-sided. Without the flag the frame
// must be *exactly* the call that shipped — main world, no `contextId` key in
// `params` at all — because every existing caller (`_PROBE_XY_JS`, the generic
// `evaluate`) depends on the page's own globals. Add the flag wrongly and
// `document.title` reads an empty string; that is an observation failure, not
// a crash, so it would ship. With the flag it must run in the tab's cached
// `brotto-idle` world — one world per tab, reused, never one per call.
//
// The branch is extracted from `background.ts` by brace matching and run
// against a fake socket and debugger, so it cannot drift from what ships.
//
//   node --test scripts/test-evaluate-isolated-world.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const EXT = path.join(ROOT, "clients", "brotto-extension");
const bg = fs.readFileSync(path.join(EXT, "src", "background.ts"), "utf8");
const ptr = fs.readFileSync(path.join(EXT, "src", "observation", "pointer.ts"), "utf8");

/** The `case "evaluate":` body, with TypeScript annotations stripped. */
function extractBranch() {
  const start = bg.search(/case "evaluate":/);
  if (start < 0) throw new Error('no `case "evaluate"` — renamed?');
  const open = bg.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < bg.length; i++) {
    if (bg[i] === "{") depth++;
    else if (bg[i] === "}" && --depth === 0) {
      return bg.slice(open + 1, i)
        // `as { result?: { value?: unknown } }` nests, and `[^}]*` leaves the
        // inner brace behind — which unbalances the body and reads as a syntax
        // error in the extracted code, not as the bug it is. A type annotation
        // carries no `;`, so stop there.
        .replace(/ as \{[^;]*\}/g, "")
        // An optional-parameter annotation on a local arrow, e.g. the
        // `(contextId?: number)` the isolated path takes. `?:` cannot appear in
        // a plain JS binding, so this cannot eat an object literal.
        .replace(/\((\w+)\?:\s*[\w<>[\]| ]+\)/g, "($1)")
        .replace(/ws!/g, "ws")
        .replace(/^\s*break;\s*$/m, "");
    }
  }
  throw new Error("unterminated evaluate branch");
}

const BODY = extractBranch();

/** One shipped function out of `pointer.ts`, types stripped, sharing one cache.
 *  The signature and the body are stripped separately: a rule that removed
 *  `: false,` would also eat the `: false` in `{ ok: false }`. */
function ptrSrc(name) {
  const head = new RegExp(`^(export )?(async )?function ${name}\\s*[<(]`, "m");
  const start = ptr.search(head);
  if (start < 0) throw new Error(`pointer.ts has no ${name} — renamed?`);
  const open = ptr.indexOf("{\n", start);
  let depth = 0;
  for (let i = open; i < ptr.length; i++) {
    if (ptr[i] === "{") depth++;
    else if (ptr[i] === "}" && --depth === 0) {
      let sig = ptr.slice(start, open)
        // An arrow parameter's own `Promise<T>` first: the `): Promise<` rule
        // below would otherwise match the *outer* return type and leave a
        // dangling `)` where the arrow's was.
        .replace(/=>\s*Promise<[^<>]*>/g, "=> Promise")
        .replace(/\)\s*:\s*Promise</g, ")<")
        .replace(/:\s*[\w<>[\]| ]+(?=\s*[,)])/g, "")
        // An arrow-typed parameter, `fn: (contextId: number) => Promise<T>`:
        // the scalar rule above stops at the `(`.
        .replace(/:\s*\([^()]*\)\s*=>\s*\w+/g, "")
        .replace(/^export\s+/, "")
        .replace(/<[A-Za-z]\w*>\(/, "("); // the generic parameter list
      for (let j = sig.indexOf(")<"); j >= 0; j = sig.indexOf(")<")) {
        let d = 0, end = -1;
        for (let k = j + 1; k < sig.length; k++) {
          if (sig[k] === "<") d++;
          else if (sig[k] === ">" && --d === 0) { end = k; break; }
        }
        if (end < 0) break;
        sig = sig.slice(0, j + 1) + sig.slice(end + 1);
      }
      return sig + ptr.slice(open, i + 1).replace(/\s+as\s+[A-Za-z<>\[\]| ]+/g, "");
    }
  }
  throw new Error(`unterminated ${name}`);
}

/** Run the branch with a fake debugger, and report the commands it sent. */
async function runBranch(msg, { sendCommand } = {}) {
  const sent = [];
  const commands = [];
  const ctx = {
    tid: 1,
    msg,
    ws: { send: (s) => sent.push(JSON.parse(s)) },
    dbg: {
      sendCommand: async (_t, c) => {
        commands.push(c);
        return sendCommand ? sendCommand(c) : { result: { value: "ok" } };
      },
    },
    withWorld: async (_t, fn) => fn(7),
  };
  vm.createContext(ctx);
  new vm.Script(`(async () => {${BODY}})()`).runInContext(ctx);
  // The branch's promise is not awaited here; one turn is enough for the
  // single sendCommand it makes and the socket write after it.
  await new Promise((r) => setTimeout(r, 10));
  return { sent, commands };
}

test("without the flag, the call is byte-for-byte the one that shipped", async () => {
  for (const msg of [
    { type: "evaluate", expression: "document.title" },
    { type: "evaluate", expression: "document.title", isolatedWorld: false },
    { type: "evaluate", expression: "document.title", isolatedWorld: undefined },
  ]) {
    const { sent, commands } = await runBranch(msg);
    assert.equal(commands.length, 1);
    assert.deepEqual(commands[0], {
      method: "Runtime.evaluate",
      // No `contextId` key at all — an explicit `undefined` would serialise into
      // the CDP message, and "absent" is the only thing an old caller tolerates.
      params: { expression: "document.title", returnByValue: true },
    }, "the main-world path must not change shape");
    assert.deepEqual(sent, [{ type: "evaluate_result", value: "ok" }]);
  }
});

test("with the flag, it runs in the cached isolated world and returns the same value", async () => {
  const { sent, commands } = await runBranch(
    { type: "evaluate", expression: "document.activeElement.tagName", isolatedWorld: true },
    { sendCommand: () => ({ result: { value: "INPUT" } }) });
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0], {
    method: "Runtime.evaluate",
    // `returnByValue` is unchanged: the isolated world shares the DOM, so the
    // expression reads the same `document.activeElement` object and the same
    // primitive comes back. Only the JS globals differ.
    params: { expression: "document.activeElement.tagName", returnByValue: true, contextId: 7 },
  });
  assert.deepEqual(sent, [{ type: "evaluate_result", value: "INPUT" }]);
});

test("the flag is strict: only `true` moves the call off the main world", async () => {
  // A relay that sends the string "true", or 1, has sent something else. The
  // main world is the shipped behaviour and the safe default, so an
  // unexpected value keeps it rather than half-enabling the guard.
  for (const v of ["true", 1, {}, [], null]) {
    const { commands } = await runBranch({ type: "evaluate", expression: "1", isolatedWorld: v });
    assert.equal("contextId" in commands[0].params, false, `isolatedWorld: ${JSON.stringify(v)} moved the call`);
  }
});

test("a failing isolated-world lookup answers with an error, never a main-world read", async () => {
  // Fail closed on the *guard* too: if the world cannot be created, the honest
  // answer is "this could not be evaluated", not "here is what the page's own
  // (shadowable) world says". Silently dropping the contextId would turn a
  // refusal into a main-world read — the exact hole the flag exists to close.
  const sent = [];
  const ctx = {
    tid: 1,
    msg: { type: "evaluate", expression: "document.activeElement", isolatedWorld: true },
    ws: { send: (s) => sent.push(JSON.parse(s)) },
    dbg: { sendCommand: async () => { throw new Error("the debugger is gone"); } },
    withWorld: async () => { throw new Error("no execution context"); },
  };
  vm.createContext(ctx);
  new vm.Script(`(async () => {${BODY}})()`).runInContext(ctx);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "evaluate_result");
  assert.equal(sent[0].value, "");
  assert.match(sent[0].error, /no execution context/);
});

test("the world is the one `pointer.ts` already caches — one per tab, not one per call", () => {
  // A second `createIsolatedWorld` per call would make the flag cost a world
  // per evaluate, which is the thing the existing cache exists to prevent.
  const fn = ptr.slice(ptr.indexOf("async function isolatedWorld") >= 0
    ? ptr.indexOf("async function isolatedWorld")
    : ptr.indexOf("export async function isolatedWorld"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /worldIds\.get\(tabId\)/, "the tab's world must be cached, not recreated");
  assert.match(body, /worldIds\.set\(tabId, id\)/, "and stored after the first create");
  // And `background.ts` must import that helper rather than open a world of its own.
  assert.match(bg, /import \{[^}]*withWorld[^}]*\} from "\.\/observation\/pointer"/,
    "the evaluate path must reuse pointer.ts's world, not create a second one");
  assert.doesNotMatch(extractBranch(), /createIsolatedWorld|worldName/,
    "the evaluate branch must not create a world of its own");
});

test("a context id the renderer threw away is corrected, not obeyed", async () => {
  // The failure this pins is silent and terminal. `worldIds` is a module-level
  // `Map<tabId, executionContextId>` in a service worker that outlives many page
  // loads, and a context id belongs to a *renderer*: it dies on a cross-document
  // navigation and on a detach/reattach, neither of which invalidates the cache.
  // `Runtime.evaluate` against a dead context is an **error**, so the `catch`
  // answers `{value: "", error}` and the server reads "the extension could not
  // evaluate" — `duration_ms=1`, an empty focus id, and every action refused as
  // "focus unknown" for the rest of the run. Observed live on google.com and on
  // Sheets, first focus read of a fresh connection already failing.
  //
  // There is no list of invalidating events to check — navigation, detach, frame
  // swap, context destroyed, and whatever comes next — so the correction has to
  // be the failure itself: drop the id, create the world again, retry once.
  const sent = [];
  const commands = [];
  let creates = 0;
  const sendCommand = async (_t, c) => {
    commands.push(c);
    if (c.method === "Page.getFrameTree") return { frameTree: { frame: { id: "F" } } };
    if (c.method === "Page.createIsolatedWorld") {
      creates++;
      return { executionContextId: creates === 1 ? 5 : 9 };
    }
    // The "renderer" throws away context 5 the moment it navigates.
    if (c.params.contextId === 5) throw new Error("Cannot find context with specified id");
    return { result: { value: "INPUT" } };
  };
  // The shipped `isolatedWorld` + `withWorld` + `topFrameId` over one cache, not
  // stubs: the bug *is* the cache, and a stubbed world would not have one.
  const withWorld = new Function("anyCommand",
    `const worldIds = new Map();
     const IDLE_WORLD = "brotto-idle";
     ${ptrSrc("topFrameId")}
     ${ptrSrc("isolatedWorld")}
     ${ptrSrc("withWorld")}
     return withWorld;`)(sendCommand);
  const ctx = {
    tid: 1,
    msg: { type: "evaluate", expression: "document.activeElement.tagName", isolatedWorld: true },
    ws: { send: (s) => sent.push(JSON.parse(s)) },
    dbg: { sendCommand },
    withWorld,
  };
  vm.createContext(ctx);
  new vm.Script(`(async () => {${BODY}})()`).runInContext(ctx);
  await new Promise((r) => setTimeout(r, 20));

  assert.deepEqual(sent, [{ type: "evaluate_result", value: "INPUT" }],
    `a stale cached context id must be recreated and retried, not answered as an error: ${JSON.stringify(sent)}`);
  const contexts = commands.filter((c) => c.method === "Runtime.evaluate").map((c) => c.params.contextId);
  assert.deepEqual(contexts, [5, 9],
    "exactly one retry, against the freshly created world");
});

test("the grow-only frame contract still holds for `evaluate`", () => {
  // The field is additive and optional, so the shape a shipped caller sends is
  // unchanged. `expression` and `returnByValue` are what an old caller relies
  // on, and the flag defaults off in the source itself, not in the server.
  assert.match(BODY, /msg\.expression \?\? "''"/, "the expression default is untouched");
  assert.match(BODY, /msg\.isolatedWorld === true/,
    "the flag must be compared strictly, so absence and false are the same path");
  // The server half is `brotto-conversation`'s; read-only here, and the
  // assertion is that it is *optional* — an older server never sets it.
  const relay = fs.readFileSync(path.join(ROOT, "services", "brotto-orchestrator", "src",
    "brotto_orchestrator", "cdp", "extension_relay.py"), "utf8");
  assert.ok(relay.includes('"type": "evaluate"') || relay.includes('type="evaluate"')
    || relay.includes('"evaluate"'), "the relay still sends evaluate");
});
