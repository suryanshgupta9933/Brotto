// The `aria-hidden` supplement is the sharpest security edge in the perception
// workstream: it puts controls the *site* deliberately hid from assistive
// technology in front of an agent that will click them. Every case below is
// about not doing that carelessly.
//
//   - the hit-test. A supplemented control has to be the node actually under
//     the point we measured, or the model clicks whatever is on top of it.
//   - the 512 KB cap. `Runtime.evaluate` cannot return more than that, and a
//     page that produces more is a page we do not read. A cap written down
//     and not enforced is not a cap.
//   - the double count. Some sites mark a parent `aria-hidden` and leave a
//     child visible; that child is in the AX tree *and* matches the probe.
//     Two refs for one control is not a duplicate line, it is a second thing
//     to click.
//
// The functions are extracted from TypeScript source by brace matching (the
// pattern `test-observation-surfaces.test.js` uses) so these test the text
// that ships.
//
//   node --test scripts/test-observation-supplement.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const OBS_DIR = path.join(__dirname, "..", "clients", "brotto-extension", "src", "observation");
const supplementSrc = fs.readFileSync(path.join(OBS_DIR, "supplement.ts"), "utf8");

function extract(src, name) {
  const start = src.search(new RegExp(`^(export )?(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} — renamed?`);
  const open = src.indexOf("{", start);
  if (src.slice(start, open).includes("}")) {
    throw new Error(`${name}'s signature has braces in it; extraction would match the wrong one`);
  }
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`unterminated function ${name}`);
}

function extractConst(src, name) {
  const start = src.search(new RegExp(`^export const ${name} = `, "m"));
  if (start < 0) throw new Error(`no const ${name} — renamed?`);
  const line = src.slice(start, src.indexOf("\n", start));
  return line.slice(line.indexOf("=") + 1).replace(/;\s*$/, "").trim();
}

// The probe is a multi-line template literal, so the single-line const reader
// won't take it. Balanced-backtick scan. It is read as *source* (not run) so
// the test can assert on what the page is asked to do.
function extractProbe(src) {
  const start = src.indexOf("const HIDDEN_PROBE = `");
  if (start < 0) throw new Error("no HIDDEN_PROBE in supplement.ts — renamed?");
  const open = src.indexOf("`", start);
  let i = open + 1;
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue; }
    if (src[i] === "`") return src.slice(open + 1, i);
    i++;
  }
  throw new Error("unterminated HIDDEN_PROBE");
}

const BODIES = { findHiddenTargets: extract(supplementSrc, "findHiddenTargets") };
const CONSTS = {
  MAX_HIDDEN_NODES: extractConst(supplementSrc, "MAX_HIDDEN_NODES"),
  MAX_EVAL_BYTES: extractConst(supplementSrc, "MAX_EVAL_BYTES"),
};
const PROBE = extractProbe(supplementSrc);

function moduleFor(dbgImpl) {
  const sandbox = {
    // The consts arrive as source, so they have to be *evaluated* into the
    // sandbox's scope — a string in scope compares against nothing, and a cap
    // that silently never trips is worse than no cap.
    ...Object.fromEntries(Object.entries(CONSTS).map(([k, v]) => [k, vm.runInNewContext(v)])),
    HIDDEN_PROBE: PROBE,
    dbg: { sendCommand: dbgImpl },
    makeRef: (frameIndex, nodeId) => frameIndex + ":" + nodeId,
    JSON, Math, Set, Map, String, Array, console,
  };
  return vm.runInNewContext(
    `(function () {
       const anyCommand = (async function (tabId, command) { return await dbg.sendCommand(tabId, command); });
       const findHiddenTargets = (async function (tabId, surface, seenBackendIds) { ${BODIES.findHiddenTargets} });
       return { findHiddenTargets };
     })()`,
    sandbox,
  );
}

const MAIN = { frameIndex: 0, frameId: "", depth: 0, crossOrigin: false, url: "https://shop.example", axNodes: [] };

// A probe result carrying `n` hidden controls, all hit-testable to backend id
// `100 + i`.
function probeResult(n) {
  return {
    result: {
      value: {
        capped: false,
        items: Array.from({ length: n }, (_, i) => ({
          role: "button", name: "Hidden " + i, x: 10 + i, y: 20 + i,
        })),
      },
    },
  };
}

// A dbg that answers the probe, then hit-tests every point to `100 + i` in the
// order the points are asked for.
function dbgFor(opts = {}) {
  const calls = [];
  let hit = 0;
  return {
    calls,
    send: async (_tabId, cmd) => {
      calls.push(cmd);
      if (cmd.method === "Runtime.evaluate") {
        if (opts.evaluateThrows) throw new Error("Command failed: target closed");
        if (opts.capped) return { result: { value: { capped: true, items: [] } } };
        if (opts.hugePayload) {
          return { result: { value: { capped: false, items: [{ role: "button", name: "x".repeat(600_000), x: 1, y: 1 }] } } };
        }
        return opts.result !== undefined ? opts.result : probeResult(opts.n ?? 1);
      }
      if (cmd.method === "DOM.getNodeForLocation") {
        const id = 100 + hit++;
        if (opts.hitBackendId) return { backendNodeId: opts.hitBackendId };
        return { backendNodeId: id };
      }
      return {};
    },
  };
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

(async () => {
  console.log("aria-hidden supplement");

  // 0. THE CAPS ARE THE CAPS. Read out of the source, because a constant that
  //    reads 512 * 1024 in a diff and 512 * 1000 in a running extension is a
  //    silent 2% over-read on every page.
  {
    const c = {};
    for (const k of Object.keys(CONSTS)) c[k] = vm.runInNewContext(CONSTS[k]);
    check("the evaluate cap is the CDP ceiling, 512 KB", c.MAX_EVAL_BYTES === 512 * 1024,
      `MAX_EVAL_BYTES was ${c.MAX_EVAL_BYTES}`);
    check("the element cap is 200", c.MAX_HIDDEN_NODES === 200,
      `MAX_HIDDEN_NODES was ${c.MAX_HIDDEN_NODES}`);
  }

  // 1. A HIDDEN CONTROL IS FOUND, AND MARKED. The flag is the whole contract:
  //    the renderer keys off it and the approval gate refuses to trust it.
  {
    const d = dbgFor({ n: 1 });
    const mod = moduleFor(d.send);
    const targets = await mod.findHiddenTargets(7, MAIN);
    check("a hidden control is surfaced", targets.length === 1,
      `got ${targets.length}: ${JSON.stringify(targets)}`);
    check("…marked hidden: true, which is what ax_filter and harness read",
      targets[0] && targets[0].hidden === true, `got ${JSON.stringify(targets[0])}`);
    check("…with the role and name the page gave it",
      targets[0].role === "button" && targets[0].name === "Hidden 0",
      `got ${JSON.stringify(targets[0])}`);
    check("…and coordinates, because dispatch is coordinate-based",
      targets[0].x === 10 && targets[0].y === 20, `got ${JSON.stringify(targets[0])}`);
    check("…and a backend id, so it is not double-counted and can be attributed",
      targets[0].backendNodeId === 100, `got ${JSON.stringify(targets[0])}`);
    check("…on a ref that cannot collide with an AX node id",
      targets[0].ref === "0:-1", `ref was ${targets[0].ref}`);
  }

  // 2. THE 512 KB CAP. A page that produces an oversized result is a page we do
  //    not read. Both sides enforce it: the probe refuses before the payload
  //    leaves the renderer, and `findHiddenTargets` re-checks what came back.
  {
    const d = dbgFor({ capped: true });
    const mod = moduleFor(d.send);
    const targets = await mod.findHiddenTargets(7, MAIN);
    check("a page that reports the cap is not read", targets.length === 0,
      `got ${targets.length}: ${JSON.stringify(targets)}`);

    // …and the belt-and-braces side, for a page that fought the probe. This is
    // the half that runs in the extension, so it is the half that binds.
    const big = dbgFor({ hugePayload: true });
    const mod2 = moduleFor(big.send);
    const targets2 = await mod2.findHiddenTargets(7, MAIN);
    check("a 600 KB serialized result is refused too", targets2.length === 0,
      `got ${targets2.length}`);
    const hitCalls = big.calls.filter((c) => c.method === "DOM.getNodeForLocation");
    check("…before a single hit-test is spent on it", hitCalls.length === 0,
      `${hitCalls.length} hit-tests were sent for an unread page`);
  }

  // 3. THE DOUBLE COUNT. A site marks a container `aria-hidden` and leaves a
  //    child visible; that child is in the AX tree *and* matches the probe.
  {
    const d = dbgFor({ n: 2 });
    const mod = moduleFor(d.send);
    // backendNodeId 100 is the first probe hit — the AX pass already reported it.
    const targets = await mod.findHiddenTargets(7, MAIN, new Set([100]));
    check("a node already in the AX tree is not emitted again", targets.length === 1,
      `got ${targets.length}: ${JSON.stringify(targets)}`);
    check("…and it is the *other* one that survives", targets[0].name === "Hidden 1",
      `got ${JSON.stringify(targets)}`);
    check("…with a ref of its own, not the skipped one's",
      targets[0].ref !== "0:-1", `ref was ${targets[0].ref}`);

    // With no AX set to compare against, nothing is dropped — the supplement
    // adds, it never filters.
    const d2 = dbgFor({ n: 2 });
    const mod2 = moduleFor(d2.send);
    check("with nothing to compare against, nothing is dropped",
      (await mod2.findHiddenTargets(7, MAIN)).length === 2, "targets went missing");
  }

  // 4. A PAGE WITH NOTHING HIDDEN. The common case, and it must be free: one
  //    evaluate, no hit-tests, no targets.
  {
    const d = dbgFor({ n: 0 });
    const mod = moduleFor(d.send);
    const targets = await mod.findHiddenTargets(7, MAIN);
    check("a page with no aria-hidden controls returns nothing", targets.length === 0,
      `got ${JSON.stringify(targets)}`);
    check("…and costs exactly one round trip",
      d.calls.length === 1 && d.calls[0].method === "Runtime.evaluate",
      `sent ${d.calls.map((c) => c.method).join(", ")}`);
  }

  // 5. THE TWO REFUSALS. A cross-origin frame is the one thing this workstream
  //    must never do, and a subframe's rect is not in the top viewport, so a
  //    hit-test there would name some unrelated node.
  {
    const d = dbgFor({ n: 1 });
    const mod = moduleFor(d.send);
    const foreign = { ...MAIN, frameIndex: 1, frameId: "subA", crossOrigin: true };
    const sub = { ...MAIN, frameIndex: 1, frameId: "subB", depth: 1 };
    check("a cross-origin frame is never scripted", (await mod.findHiddenTargets(7, foreign)).length === 0,
      "a foreign realm was evaluated");
    check("…and it costs no round trip getting there", d.calls.length === 0,
      `${d.calls.length} commands were sent`);
    check("a subframe is not supplemented either", (await mod.findHiddenTargets(7, sub)).length === 0,
      "a subframe rect was hit-tested in the top viewport");
  }

  // 6. A DEAD FRAME. One evaluate rejects. The observation must degrade to "no
  //    supplement", never to an exception the caller has to catch.
  {
    const d = dbgFor({ evaluateThrows: true });
    const mod = moduleFor(d.send);
    check("a failed evaluate yields no targets and no throw",
      (await mod.findHiddenTargets(7, MAIN)).length === 0, "the failure escaped");
  }

  // 7. AN UNVERIFIABLE NODE IS NOT SURFACED. If the hit-test cannot say which
  //    DOM node is at the point we measured, the control is one we cannot
  //    promise the model can click — and that promise is the premise.
  {
    const mod = moduleFor(async (_t, cmd) => {
      if (cmd.method === "Runtime.evaluate") return probeResult(1);
      return {};  // no backendNodeId
    });
    check("a node that cannot be hit-tested is dropped", (await mod.findHiddenTargets(7, MAIN)).length === 0,
      "an unverifiable control was surfaced");
  }

  // 8. THE PROBE ITSELF. It cannot be executed here — there is no page — so
  //    check the three things that are absences, and would read clean in review.
  check("the probe reads aria-hidden off the tree, not off the element",
    PROBE.includes('closest(\'[aria-hidden="true"]\')'),
    "a descendant with aria-hidden=false would have been suppressed");
  check("…and asks the platform whether the element is on screen",
    PROBE.includes("checkVisibility"), "no visibility test in the probe");
  check("…and caps on its own size before returning anything",
    PROBE.includes("size > CAP") && PROBE.includes("capped: true"),
    "the probe returns an uncapped payload");

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
