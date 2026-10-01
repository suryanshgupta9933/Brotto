// The bounded-concurrency pool the three serial CDP loops now share.
//
// `pooled` exists to make three sequential loops concurrent, and the promises
// are that the observations are bit-identical. That is not automatic: the AX
// tree's supplement mints a ref from the item's *index* (`-(i + 1)`), and the
// geometry fallback writes into one shared `boxes` Map. A pool that appended
// on completion would renumber every hidden control on the page, and a pool
// that swallowed a rejection would turn one dead node into a coordinate that
// is quietly missing rather than one that is loudly absent.
//
// So the cases are about the two ways a pool can be wrong while looking fine:
// order leaking from completion, and the concurrency bound not being a bound.
//
//   node --test scripts/test-observation-pool.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(
  __dirname, "..", "clients", "brotto-extension", "src", "observation", "surfaces.ts",
);
const src = fs.readFileSync(SRC, "utf8");

function extract(name) {
  // `<T, R>` between the name and the paren is legal TypeScript, and `pooled`
  // is the first thing here that uses it. Generic parameters carry no braces,
  // so the brace-matching below is unaffected.
  const start = src.search(new RegExp(`^(export )?(async )?function ${name}\\s*(<[^>(]*>)?\\s*\\(`, "m"));
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

function extractConst(name) {
  const start = src.search(new RegExp(`^(export )?const ${name} = `, "m"));
  if (start < 0) throw new Error(`no const ${name} — renamed?`);
  const line = src.slice(start, src.indexOf("\n", start));
  return line.slice(line.indexOf("=") + 1).replace(/;\s*$/, "").trim();
}

const sandbox = {
  CDP_CONCURRENCY: vm.runInNewContext(extractConst("CDP_CONCURRENCY")),
  Array, Math, Promise,
};
const pooled = vm.runInNewContext(
  `(async function (items, limit, fn) { ${extract("pooled")} })`, sandbox,
);

const tick = () => new Promise((r) => setTimeout(r, 0));

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
  console.log("bounded-concurrency pool");

  // 1. Order. The renderer answers the *last* AX tree first here, so an
  //    append-on-completion pool returns [9,8,7,…] and every ref on the page
  //    is off by the same amount — which still looks like a valid tree.
  {
    const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const out = await pooled(items, sandbox.CDP_CONCURRENCY, async (item) => {
      await new Promise((r) => setTimeout(r, (items.length - item) * 2));
      return "v" + item;
    });
    check("results come back in input order, not completion order",
      out.join(",") === "v0,v1,v2,v3,v4,v5,v6,v7,v8,v9",
      `got ${JSON.stringify(out)}`);
  }

  // 2. The bound is a bound. Twelve frames must not become twelve
  //    `getFullAXTree` calls in flight — that was the reason the reads were
  //    sequential in the first place.
  {
    let live = 0, peak = 0;
    const items = Array.from({ length: 50 }, (_, i) => i);
    await pooled(items, sandbox.CDP_CONCURRENCY, async () => {
      live++;
      peak = Math.max(peak, live);
      await tick();
      live--;
      return null;
    });
    check(`no more than ${sandbox.CDP_CONCURRENCY} calls are in flight at once`,
      peak <= sandbox.CDP_CONCURRENCY, `peak in-flight was ${peak}`);
    check("…and it really is concurrent, not a serial loop wearing a pool's name",
      peak > 1, `peak in-flight was ${peak} — this ran sequentially`);
  }

  // 3. Every item is visited exactly once, including past the bound. A worker
  //    that exits early leaves the tail unmeasured, and an unmeasured node
  //    looks exactly like a node with no box.
  {
    const seen = [];
    const items = Array.from({ length: 37 }, (_, i) => i);
    await pooled(items, sandbox.CDP_CONCURRENCY, async (item) => { seen.push(item); });
    check("every item is visited exactly once",
      seen.length === 37 && new Set(seen).size === 37 && seen.includes(36),
      `${seen.length} visits, ${new Set(seen).size} distinct`);
  }

  // 4. Degenerate inputs. A one-frame page is the common case, and an empty
  //    id list is what a frame with no kept nodes sends — neither may hang or
  //    divide by zero.
  {
    const one = await pooled(["only"], sandbox.CDP_CONCURRENCY, async (x) => x);
    check("a single item works", one[0] === "only", `got ${JSON.stringify(one)}`);
    const none = await pooled([], sandbox.CDP_CONCURRENCY, async () => { throw new Error("must not run"); });
    check("an empty list makes no call at all", Array.isArray(none) && none.length === 0,
      `got ${JSON.stringify(none)}`);
    const zero = await pooled(["a", "b"], 0, async (x) => x);
    check("a limit of 0 still completes rather than spinning",
      zero.length === 2 && zero[1] === "b", `got ${JSON.stringify(zero)}`);
  }

  // 5. A rejection propagates. The callers catch per item so a dead node is
  //    survivable, but a pool that swallowed the error would report success
  //    for a coordinate it never fetched.
  {
    let rejected = null;
    try {
      await pooled([1, 2, 3], sandbox.CDP_CONCURRENCY, async (item) => {
        if (item === 2) throw new Error("Could not compute box model.");
        return item;
      });
    } catch (err) {
      rejected = err;
    }
    check("a throwing item rejects the pool", rejected !== null,
      "the failure was swallowed — a missing coordinate would look measured");
    check("…and it is the caller's error, not a wrapper's",
      rejected && /Could not compute box model/.test(String(rejected.message)),
      `rejection was ${rejected && rejected.message}`);
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
