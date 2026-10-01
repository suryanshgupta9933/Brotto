// What an observation reports about its own cost.
//
// `waitForStable` returns a `Stability` and `boxMap` returns a
// `GeometryResult`, and `captureObservation` discarded both — so the double
// rescan, the 3s quiet floor and the geometry overflow were readable in the
// source and in nothing else. These counters are the fix, and they only
// falsify anything if they survive the trip to the server.
//
// The case that matters is the last one. `geometry.boxes` is a `Map`, and a
// `Map` serialises to `{}` — so spreading the result onto the wire would ship
// a geometry block indistinguishable from "the bulk path joined nothing",
// which is a real and completely different fault. An absent field is exactly
// the kind of defect that reads clean in a diff.
//
//   node --test scripts/test-observation-metrics.test.js

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

const observationMetrics = vm.runInNewContext(
  `(function (stability, geometry, scans, targetCount, bytes) {`
  + extract("observationMetrics")
  + `})`,
);

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}\n      ${detail}`);
  }
}

// A GeometryResult as `boxMap` really returns it, Map and all.
function geometryResult(over = {}) {
  return {
    boxes: new Map([[100, { x: 1, y: 2 }]]),
    requested: 4000, resolved: 1975, fallback: 2025,
    truncated: true, source: "bulk",
    ...over,
  };
}

console.log("observation metrics");

// 1. The three numbers Tasks 2 and 3 are decided on. `scans` is the one that
//    was never observable: the retry loop's first iteration is unconditional,
//    so a settled page always paid two full frame scans.
{
  const m = observationMetrics(
    { waited: true, timedOut: false, elapsedMs: 3004, mutations: 12 },
    geometryResult(),
    2, 608, 184_233,
  );
  check("the scan count is reported", m.scans === 2, `scans was ${m.scans}`);
  check("…and so is the target count", m.targets === 608, `targets was ${m.targets}`);
  check("…and the serialized size", m.bytes === 184233, `bytes was ${m.bytes}`);
  check("the stability verdict is reported verbatim",
    m.stability.waited === true && m.stability.timedOut === false
    && m.stability.elapsedMs === 3004,
    `stability was ${JSON.stringify(m.stability)}`);
  check("requested and fallback are both present, because their ratio is the signal",
    m.geometry.requested === 4000 && m.geometry.fallback === 2025,
    `geometry was ${JSON.stringify(m.geometry)}`);
}

// 2. The reason this is a named function and not a spread.
{
  const m = observationMetrics({}, geometryResult(), 1, 1, 1);
  const wire = JSON.parse(JSON.stringify(m));
  check("the coordinate map does not reach the wire",
    !("boxes" in wire.geometry) && !("boxes" in wire),
    `wire geometry was ${JSON.stringify(wire.geometry)}`);
  check("…and what remains is still readable as a report",
    wire.geometry.source === "bulk" && wire.geometry.resolved === 1975,
    `wire geometry was ${JSON.stringify(wire.geometry)}`);
  check("a Map would have serialised to an empty object, which reads as no-join",
    JSON.stringify(new Map([[100, { x: 1, y: 2 }]])) === "{}",
    "the premise of this check no longer holds — re-check what spreading would cost");
}

// 3. A scan that threw before boxMap answered. `extractAx` hands back
//    `geometry` from the bulk path, which is always set, but a metrics block
//    that renders `undefined` into a log line is a log line nobody can read.
{
  const m = observationMetrics({}, undefined, 1, 0, 0);
  check("a missing geometry result still reports zeros rather than undefined",
    m.geometry.requested === 0 && m.geometry.fallback === 0 && m.geometry.source === "empty",
    `geometry was ${JSON.stringify(m.geometry)}`);
  check("…and the whole block survives the wire",
    JSON.parse(JSON.stringify(m)).geometry.source === "empty",
    "the block did not survive serialization");
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
