// The page-delta signal.
//
// The bug this exists for: on a Google Sheet the AX tree is byte-identical
// across 15 consecutive steps, so the agent has no evidence its action landed
// and repeats. A screenshot every step would fix it at a cost nobody wants.
//
// The interesting failures here are NUMERIC, so this runs the real extracted
// `tileDelta` against synthetic pixel patterns rather than paraphrasing the
// algorithm — a paraphrase passes whether or not the shipped code does. The
// functions come out of `delta.ts` by brace matching, the same pattern
// `test-observation-stability.test.js` uses.
//
//   node --test scripts/test-observation-delta.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(
  __dirname, "..", "clients", "brotto-extension", "src", "observation", "delta.ts",
);
const source = fs.readFileSync(SRC, "utf8");

function extract(name) {
  const start = source.search(new RegExp(`^(export )?(async )?function ${name}\\(`, "m"));
  if (start < 0) throw new Error(`no function ${name} in delta.ts — renamed?`);
  // The body brace is the first `{` after the parameter list — but a return
  // type annotation (`: Promise<{ caret: any[] }>`) opens braces of its own, so
  // skip anything nested inside `<...>` on the way there.
  const paramsEnd = source.indexOf(")", start);
  let angle = 0;
  let open = -1;
  for (let i = paramsEnd + 1; i < source.length; i++) {
    const c = source[i];
    if (c === "<") angle++;
    else if (c === ">") angle--;
    else if (c === "{" && angle === 0) { open = i; break; }
    // A return type may carry `;` and `{` of its own (`: Promise<{ caret: any[] }>`),
    // so only terminate outside the type — otherwise the brace inside it wins.
    else if ((c === ";" || c === "\n\n") && angle === 0) break;
  }
  if (open < 0) throw new Error(`no body brace found for ${name}`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unterminated function ${name}`);
}

function extractConst(name) {
  const start = source.search(new RegExp(`^const ${name} = `, "m"));
  if (start < 0) throw new Error(`no const ${name} in delta.ts — renamed?`);
  const line = source.slice(start, source.indexOf("\n", start));
  return line.slice(line.indexOf("=") + 1).replace(/;\s*$/, "").trim();
}

/** For a const built by `+` concatenation across lines: everything up to the
 *  first `;` that ends a line. */
function extractConstMultiline(name) {
  // Tolerant of a wrapped initializer — prettier moves the `=` to the next line
  // when the value is long, which is exactly the consts this is for.
  const start = source.search(new RegExp(`^const ${name}\\s*=`, "m"));
  if (start < 0) throw new Error(`no const ${name} in delta.ts — renamed?`);
  const m = /;$/m.exec(source.slice(start));
  if (!m) throw new Error(`${name} is not a line-terminated const`);
  return source.slice(source.indexOf("=", start) + 1, start + m.index).trim();
}

const NUMBERS = {
  TILE_PX: vm.runInNewContext(extractConst("TILE_PX")),
  TILE_DIFF_THRESHOLD: vm.runInNewContext(extractConst("TILE_DIFF_THRESHOLD")),
  MAX_TILES: vm.runInNewContext(extractConst("MAX_TILES")),
  SCALE: vm.runInNewContext(extractConst("SCALE")),
};

const TILE_DELTA = extract("tileDelta");
const BUILD_MASK = extract("buildCaretMask");
const CANVAS_COVERED = extract("computeCanvasCovered");

// The extracted body, bound to the real constants. The consts are *evaluated*
// rather than passed as source text for the reason the stability suite gives:
// a string `"1_000"` compiles to something that silently never fires.
const tileDelta = vm.runInNewContext(
  `(function (TILE_PX, TILE_DIFF_THRESHOLD, MAX_TILES, SCALE) {
     return function (prev, cur, masked) { ${TILE_DELTA} };
   })(${NUMBERS.TILE_PX}, ${NUMBERS.TILE_DIFF_THRESHOLD}, ${NUMBERS.MAX_TILES}, ${NUMBERS.SCALE})`,
  { Math, Array },
);

const buildCaretMask = vm.runInNewContext(
  `(function (SCALE) {
     return function (width, height, rects) { ${BUILD_MASK} };
   })(${NUMBERS.SCALE})`,
  { Math, Uint8Array },
);

const computeCanvasCovered = vm.runInNewContext(
  `(function () { return function (rects, vw, vh) { ${CANVAS_COVERED} }; })()`,
  { Math, Array, isFinite },
);

// ── Synthetic frames ────────────────────────────────────────────────────────

/** A grayscale RGBA buffer of `w`×`h`, filled with `lum`. */
function flat(w, h, lum) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = lum;
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

/** A copy of `f` with a filled rect painted at `lum`. */
function paintRect(f, x0, y0, w, h, lum) {
  const out = { width: f.width, height: f.height, data: new Uint8ClampedArray(f.data) };
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const p = (y * f.width + x) * 4;
      out.data[p] = out.data[p + 1] = out.data[p + 2] = lum;
    }
  }
  return out;
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name}\n      ${detail}`);
  }
}

(async () => {
  console.log("page delta");

  // The constants are the calibration, so they are pinned as numbers — a
  // re-tuned threshold should be a visible edit here, not a silent one.
  check("tiles are 16x16 in the downscaled buffer", NUMBERS.TILE_PX === 16,
    `TILE_PX was ${NUMBERS.TILE_PX}`);
  check("at most 5 tiles ride the wire", NUMBERS.MAX_TILES === 5,
    `MAX_TILES was ${NUMBERS.MAX_TILES}`);
  check("the capture is downscaled by half, not an eighth", NUMBERS.SCALE === 0.5,
    `SCALE was ${NUMBERS.SCALE}`);
  check("threshold is an absolute luminance difference, not a page fraction",
    NUMBERS.TILE_DIFF_THRESHOLD === 2.0, `TILE_DIFF_THRESHOLD was ${NUMBERS.TILE_DIFF_THRESHOLD}`);

  // ── 1. THE FALSE-NEGATIVE CASE THAT KILLS NAIVE IMPLEMENTATIONS ───────────
  // A large mostly-white grid — 64×48 downscaled, i.e. a 128×96 CSS px region
  // of a big sheet — with a few characters changed in ONE tile.
  //
  // Globally this is a rounding error: 4 glyph-ish pixels out of 3072 is
  // 0.13% of the page. A "% of page changed" threshold set at anything sane
  // misses it, which is exactly the failure this design was chosen to avoid.
  {
    const W = 64, H = 48;
    const before = flat(W, H, 250);
    // A cell of text: a few dark runs inside tile (2, 2), i.e. pixels 32..47.
    const withText = paintRect(before, 32, 32, 8, 2, 40);
    // The agent typed: two more glyphs next to the existing text.
    const after = paintRect(withText, 40, 32, 6, 2, 40);

    const d = tileDelta(before, after, null);
    check("a small edit inside a large light grid IS detected", d.changed === true,
      `changed was ${d.changed} with ${JSON.stringify(d.tiles)} — the change is ` +
      "0.13% of the page, and a page-fraction threshold would have missed it");
    check("…reported as exactly one tile", d.tiles.length === 1,
      `got ${d.tiles.length} tiles: ${JSON.stringify(d.tiles)}`);
    check("…positioned where the text is, in FULL-RES CSS pixels",
      d.tiles[0] && d.tiles[0].x === 2 * NUMBERS.TILE_PX / NUMBERS.SCALE
        && d.tiles[0].y === 2 * NUMBERS.TILE_PX / NUMBERS.SCALE,
      `got ${JSON.stringify(d.tiles[0])} — tiles are at half the downscaled scale (${NUMBERS.SCALE})`);
    check("…with full-resolution width, so it is 32 CSS px not 16",
      d.tiles[0] && d.tiles[0].w === (NUMBERS.TILE_PX / NUMBERS.SCALE),
      `got ${JSON.stringify(d.tiles[0])}`);
    // The whole point of per-tile: this tile's mean is far above the global
    // mean, which is why the per-tile reading is the one that works.
    check("…and the tile's own pct is well clear of the threshold",
      d.tiles[0] && d.tiles[0].pct > NUMBERS.TILE_DIFF_THRESHOLD * 3,
      `pct was ${d.tiles[0] && d.tiles[0].pct}`);
  }

  // ── 2. RENDERING NOISE IS NOT A CHANGE ────────────────────────────────────
  // Anti-aliasing shimmer: a few pixels move by 1–2 levels. The threshold is
  // set above this, so a repaint that changed nothing the model can see does
  // not read as evidence that its action landed — which would be worse than
  // the original problem, in the other direction.
  {
    const W = 64, H = 48;
    const before = flat(W, H, 200);
    let after = before;
    for (let n = 0; n < 40; n++) {
      after = paintRect(after, (n * 7) % W, (n * 11) % H, 1, 1, 198);
    }
    const d = tileDelta(before, after, null);
    check("anti-aliasing shimmer is NOT reported as changed", d.changed === false,
      `changed was ${d.changed} with ${JSON.stringify(d.tiles)} — a ±2 shimmer ` +
      "tripped the threshold, so every repaint would look like a result");
    check("…and contributes no tiles", d.tiles.length === 0, JSON.stringify(d.tiles));
  }

  // ── 3. A BLINKING CARET, MASKED, IS NOT A CHANGE ON EVERY FRAME ───────────
  // The case this feature would die on without the mask: a caret in a cell
  // toggles, so every consecutive frame differs, and the agent would believe
  // its typing "worked" every step.
  {
    const W = 64, H = 48;
    const page = flat(W, H, 250);
    const withText = paintRect(page, 32, 32, 8, 2, 40);
    // Frame A has the caret drawn, frame B does not — the blink.
    const lit = paintRect(withText, 32, 32, 1, 8, 20);
    const dark = withText;

    check("an unmasked caret DOES read as a change (the bug being prevented)",
      tileDelta(lit, dark, null).changed === true,
      "the mask would be dead code if an unmasked caret did not register");

    // Now mask it, the way `buildCaretMask` does from the DOM caret rect.
    // The rect is in FULL-RES CSS pixels; the mask is in the downscaled
    // buffer, so the locator's output has to be scaled down too. Getting that
    // wrong masks a patch 32 pixels from the caret and reads as a false
    // negative rather than as an error.
    const cx = 32, cy = 32;
    const caretRectCss = { x: cx / NUMBERS.SCALE, y: cy / NUMBERS.SCALE, w: 2, h: 16 };
    const mask = buildCaretMask(W, H, [caretRectCss]);
    check("the caret mask covers the lit caret pixels",
      mask !== null && mask[cy * W + cx] === 1,
      `mask was ${mask && mask[cy * W + cx]} at the caret's own pixel (x=${cx}, y=${cy})`);

    const masked = tileDelta(lit, dark, mask);
    check("a masked caret is NOT a change on every frame", masked.changed === false,
      `changed was ${masked.changed} with ${JSON.stringify(masked.tiles)} — the caret ` +
      "is permanent change and would make every diff meaningless");

    // The mask must not blind the diff to a REAL edit in the same tile.
    const edited = paintRect(dark, 38, 34, 3, 2, 40);
    const both = tileDelta(lit, edited, mask);
    check("…and a real edit in the same tile as the caret still registers",
      both.changed === true,
      `changed was ${both.changed} — masking the caret swallowed the edit too`);
  }

  // ── 4. NO PREVIOUS FRAME ⇒ `delta` IS OMITTED, NOT "all changed" ──────────
  // `computeDelta` is the half that decides this, and it is the half with the
  // most ways to be wrong quietly — so the REAL body runs, with fakes only for
  // the browser APIs it calls (the decoder and the DOM evaluate). There is no
  // previous frame to compare on the first observation, and reporting
  // `changed: true` there would tell the model "everything changed" about a
  // page it has never seen — the loudest possible lie, and it acts on it.
  {
    // Built with the sandbox as the global object so the browser APIs below
    // resolve, then called with the pieces a vm context cannot hold closures
    // over.
    const bound = vm.runInNewContext(
      `(function (args) {
         const { dbg, atob, Blob, createImageBitmap, OffscreenCanvas } = args;
         const TILE_PX = args.TILE_PX, TILE_DIFF_THRESHOLD = args.TILE_DIFF_THRESHOLD;
         const MAX_TILES = args.MAX_TILES, SCALE = args.SCALE;
         const frames = new Map();
         const clearDelta = function (tabId) { ${extract("clearDelta")} };
         const tileDelta = function (prev, cur, masked) { ${TILE_DELTA} };
         const buildCaretMask = function (width, height, rects) { ${BUILD_MASK} };
         // The one DOM pass, faked: pageProbe is the only thing between
         // computeDelta and the wire, and it is a single evaluate returning
         // the caret rects and the canvas rects together.
         async function pageProbe(tabId) {
           try {
             const r = await dbg.sendCommand(tabId, {
               method: "Runtime.evaluate", params: { expression: "", returnByValue: true } });
             const v = r?.result?.value;
             if (!v || typeof v !== "object") return null;
             return { caret: v.caret, canvases: v.canvases, vw: v.vw, vh: v.vh };
           } catch { return null; }
         }
         const computeCanvasCovered = function (rects, vw, vh) { ${CANVAS_COVERED} };
         const signal = function (canvasCovered) { ${extract("signal")} };
         async function captureFrame(tabId) {
           const r = await dbg.sendCommand(tabId, {
             method: "Page.captureScreenshot",
             params: { format: "png",
               clip: { x: 0, y: 0, width: 0, height: 0, scale: SCALE },
               captureBeyondViewport: false },
           });
           const data = typeof r.data === "string" ? r.data : "";
           if (data.length === 0) return null;
           const bin = atob(data);
           const bytes = new Uint8Array(bin.length);
           for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
           const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
           const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
           const ctx = canvas.getContext("2d", { willReadFrequently: true });
           if (!ctx) return null;
           ctx.drawImage(bitmap, 0, 0);
           bitmap.close();
           return ctx.getImageData(0, 0, canvas.width, canvas.height);
         }
         const computeDelta = async function (tabId, url, opts) { ${extract("computeDelta")} };
         return { computeDelta, clearDelta, frames };
       })`, { Math, Uint8Array, Map, Uint8ClampedArray, Array, JSON },
    );

    // The pixels the fake decoder hands back: one queued frame per capture,
    // falling back to an unchanged page so an unqueued capture is a no-op diff
    // rather than a crash.
    const page = flat(32, 32, 250);
    const edited = paintRect(page, 8, 8, 8, 8, 20);
    const lit = paintRect(page, 20, 20, 2, 8, 20);

    // The harness hands `computeDelta` a browser: a debugger that answers a
    // screenshot with base64 and answers the caret evaluate with rects, and a
    // decoder that turns the base64 into the next queued frame.
    const makeRun = (caretRects, canvases = [], vw = 0, vh = 0) => {
      const shots = [];
      const calls = { evaluates: 0 };
      const canvas = {
        getContext: () => ({
          drawImage() {},
          getImageData: () => shots.shift() || page,
        }),
      };
      return {
        shots,
        get evaluates() { return calls.evaluates; },
        api: bound({
          TILE_PX: NUMBERS.TILE_PX,
          TILE_DIFF_THRESHOLD: NUMBERS.TILE_DIFF_THRESHOLD,
          MAX_TILES: NUMBERS.MAX_TILES,
          SCALE: NUMBERS.SCALE,
          atob: () => "AAAA",
          Blob: function Blob() {},
          createImageBitmap: async () => ({ width: 32, height: 32, close() {} }),
          OffscreenCanvas: function OffscreenCanvas() { return canvas; },
          dbg: {
            sendCommand: async (tabId, cmd) => {
              if (cmd.method === "Page.captureScreenshot") return { data: "Zm9v" };
              if (cmd.method === "Runtime.evaluate") {
                calls.evaluates++;
                return { result: { value: { caret: caretRects, canvases, vw, vh } } };
              }
              return {};
            },
          },
        }),
      };
    };

    const run = makeRun([]);
    const h = run.api;
    check("the harness runs the real extracted control flow",
      typeof h.computeDelta === "function" && typeof h.clearDelta === "function",
      "computeDelta was not extracted out of delta.ts");

    const first = await h.computeDelta(7, "https://example.test/sheet");
    check("no previous frame ⇒ delta is omitted, not a false 'all changed'",
      first.delta === undefined, `got ${JSON.stringify(first)}`);

    // Same page, second capture, and the pixels genuinely differ — so the
    // omission above came from "no previous frame" and not from a diff that
    // failed to notice anything.
    run.shots.push(edited);
    const second = await h.computeDelta(7, "https://example.test/sheet");
    check("a real edit on the second observation IS reported",
      second.delta !== undefined && second.delta.changed === true,
      `got ${JSON.stringify(second)} — the first-observation omission above would ` +
      "have been a broken diff, not a truthful one");

    // A different URL: the retained frame is not this page.
    const afterNav = await h.computeDelta(7, "https://example.test/other");
    check("a navigation ⇒ delta is omitted too", afterNav.delta === undefined,
      `got ${JSON.stringify(afterNav)}`);
    const afterNavSettled = await h.computeDelta(7, "https://example.test/other");
    check("…and the frame after it diffs against the NEW page",
      afterNavSettled.delta !== undefined, "the navigation reset left nothing to diff");

    // An explicit reset — the onCommitted path in background.ts.
    const afterReset = await h.computeDelta(7, "https://example.test/other", { reset: true });
    check("an explicit reset ⇒ delta is omitted", afterReset.delta === undefined,
      `got ${JSON.stringify(afterReset)}`);

    h.clearDelta(7);
    check("clearing drops the retained frame", h.frames.size === 0,
      `${h.frames.size} frame(s) retained`);

    // The caret path end to end, with the mask built from a real DOM evaluate.
    // The rect is in CSS pixels and `lit` is in the downscaled buffer, so the
    // locator's output is the buffer coordinate divided by SCALE.
    const caretRun = makeRun([{ x: 20 / NUMBERS.SCALE, y: 20 / NUMBERS.SCALE, w: 2, h: 16 }]);
    await caretRun.api.computeDelta(7, "https://example.test/caret");
    caretRun.shots.push(lit);
    const caretDelta = await caretRun.api.computeDelta(7, "https://example.test/caret");
    check("a caret blink through the real capture path is not a change",
      caretDelta.delta !== undefined && caretDelta.delta.changed === false,
      `got ${JSON.stringify(caretDelta)}`);

    // canvasCovered rides the SAME pass — the harness reads it to decide
    // whether to ask for a screenshot, so it must be on the wire on the FIRST
    // observation too, not only alongside a delta.
    const canvasRun = makeRun([], [{ x: 0, y: 0, w: 1000, h: 800 }], 1000, 800);
    const firstCanvas = await canvasRun.api.computeDelta(7, "https://example.test/sheet");
    check("canvasCovered is present on the FIRST observation, with no delta",
      firstCanvas.delta === undefined && firstCanvas.canvasCovered === 1,
      `got ${JSON.stringify(firstCanvas)} — the harness cannot decide to ask for a ` +
      "screenshot before the first action if this rides the delta alone");
    check("canvasCovered is a top-level field, not nested in delta",
      typeof firstCanvas.canvasCovered === "number",
      `got ${JSON.stringify(firstCanvas)}`);

    const blankRun = makeRun([], [], 1000, 800);
    const blank = await blankRun.api.computeDelta(7, "https://example.test/plain");
    check("a page with no canvas reports canvasCovered 0.0",
      blank.canvasCovered === 0, `got ${JSON.stringify(blank)}`);

    // One Runtime.evaluate, not two. A per-step round trip on this path is the
    // cost the whole feature exists to avoid, so the count is asserted, not
    // assumed: makeRun records every method it is asked for.
    const spyRun = makeRun([], [{ x: 0, y: 0, w: 1000, h: 800 }], 1000, 800);
    await spyRun.api.computeDelta(7, "https://example.test/sheet");
    spyRun.shots.push(edited);
    await spyRun.api.computeDelta(7, "https://example.test/sheet");
    check("canvasCovered rides the existing DOM pass, not a second round trip",
      spyRun.evaluates === 2,
      `sent ${spyRun.evaluates} Runtime.evaluate calls across two steps`);
  }

  // ── 5. The wire shape ─────────────────────────────────────────────────────
  {
    const d = tileDelta(flat(64, 48, 250), paintRect(flat(64, 48, 250), 32, 32, 8, 8, 40), null);
    const keys = Object.keys(d).sort();
    check("delta is exactly {changed, tiles}", JSON.stringify(keys) === '["changed","tiles"]',
      `keys were ${JSON.stringify(keys)}`);
    const t = d.tiles[0];
    check("a tile is exactly {x, y, w, h, pct}",
      JSON.stringify(Object.keys(t).sort()) === '["h","pct","w","x","y"]',
      `keys were ${JSON.stringify(Object.keys(t))}`);
    check("the whole payload is small — integers, no pixels",
      JSON.stringify(d).length < 120, `was ${JSON.stringify(d).length} bytes`);
  }

  // ── 6. Worst first, capped at 5 ───────────────────────────────────────────
  {
    // 64×64 downscaled = 4×4 tiles, so all six below really are distinct
    // tiles (a 48-row frame has only three and two of them fall off the edge).
    const W = 64, H = 64;
    const before = flat(W, H, 250);
    // Six tiles change; the first is the biggest.
    let after = paintRect(before, 0, 0, 16, 16, 0);      // tile (0,0), 100% dark
    after = paintRect(after, 16, 16, 16, 16, 20);        // tile (1,1)
    after = paintRect(after, 32, 32, 16, 16, 60);
    after = paintRect(after, 48, 0, 16, 16, 100);
    after = paintRect(after, 0, 48, 16, 16, 130);
    after = paintRect(after, 48, 48, 16, 16, 160);
    const d = tileDelta(before, after, null);
    check("no more than 5 tiles cross the wire", d.tiles.length === 5,
      `got ${d.tiles.length}`);
    const pcts = d.tiles.map((x) => x.pct);
    check("tiles are ordered worst first",
      pcts.every((p, i) => i === 0 || pcts[i - 1] >= p),
      `order was ${JSON.stringify(pcts)}`);
    check("the worst tile is first", pcts[0] > pcts[pcts.length - 1],
      `order was ${JSON.stringify(pcts)}`);
  }

  // ── 7. canvasCovered — the page-level "can the model see this?" signal ───
  // Sheets, Docs, Figma and Canva draw the content; their AX tree is the
  // toolbar. Vocabulary overlap fires the vision fallback on the page chrome
  // ("Sheet1", "Name box") and not on the grid, so the harness needs the
  // occupancy fraction instead. Same numbers, same clamped type, no pixels.
  {
    const VW = 1000, VH = 800;

    const full = computeCanvasCovered([{ x: 0, y: 0, w: VW, h: VH }], VW, VH);
    check("a canvas filling the viewport reports 1.0", full === 1, `got ${full}`);

    const none = computeCanvasCovered([], VW, VH);
    check("no canvas reports 0.0", none === 0, `got ${none}`);

    // A toolbar-only canvas: a fifth of the viewport, well under the trigger.
    const half = computeCanvasCovered([{ x: 0, y: 0, w: VW, h: VH / 5 }], VW, VH);
    check("a canvas smaller than the viewport reports a fraction below 1.0",
      half > 0 && half < 1 && Math.abs(half - 0.2) < 1e-9, `got ${half}`);

    // Scrolled up off-screen: only the bottom sixth of the canvas is visible,
    // so the raw rect (800 tall) would report 1.0 and the model would be sent
    // a grid it cannot see.
    const scrolled = computeCanvasCovered(
      [{ x: 0, y: -VH * 5 / 6, w: VW, h: VH }], VW, VH);
    check("a canvas scrolled mostly off-screen is discounted",
      scrolled > 0 && scrolled < 0.2 && Math.abs(scrolled - 1 / 6) < 1e-9,
      `got ${scrolled}`);

    const over = computeCanvasCovered(
      [{ x: -500, y: -500, w: VW * 3, h: VH * 3 }], VW, VH);
    check("an over-large canvas is clamped to 1.0", over === 1, `got ${over}`);

    // A rect that overflows the viewport horizontally is clipped to it, so the
    // fraction can never exceed 1 even from a bad rect.
    const bad = computeCanvasCovered([{ x: NaN, y: 0, w: 100, h: 100 }], VW, VH);
    check("a NaN rect is dropped, not emitted", bad === 0, `got ${bad}`);

    const nanRect = computeCanvasCovered([{ x: 0, y: 0, w: NaN, h: NaN }], VW, VH);
    check("a NaN-sized rect is dropped, not emitted", nanRect === 0, `got ${nanRect}`);

    const junk = computeCanvasCovered("not a list", VW, VH);
    check("a non-array value is 0.0, not a throw", junk === 0, `got ${junk}`);

    const zeroVp = computeCanvasCovered([{ x: 0, y: 0, w: 10, h: 10 }], 0, 0);
    check("a zero-area viewport is 0.0, not Infinity", zeroVp === 0, `got ${zeroVp}`);

    // The largest single canvas wins — a page carries decorative canvases too.
    const biggest = computeCanvasCovered([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 0, y: 0, w: VW / 2, h: VH },
    ], VW, VH);
    check("the largest canvas is the one reported",
      Math.abs(biggest - 0.5) < 1e-9, `got ${biggest}`);
  }

  // ── The canvas enumeration is bounded, in the page and on the way in ──────
  // A page can put a thousand `<canvas>` elements in the DOM; the probe walks
  // them once per step. Both bounds are asserted against the REAL pageProbe
  // body and the REAL expression, not a hand-copy, so the bound cannot drift.
  console.log("\ncanvas enumeration bound");
  {
    const MAX_CANVASES = vm.runInNewContext(extractConst("MAX_CANVASES"));
    const SCAN_CANVASES = vm.runInNewContext(extractConst("SCAN_CANVASES"));
    const PAGE_EXPRESSION = vm.runInNewContext(
      `(function (MAX_CANVASES, SCAN_CANVASES) { return ${extractConstMultiline("PAGE_EXPRESSION")}; })(${MAX_CANVASES}, ${SCAN_CANVASES})`);

    check("the in-page expression caps how many elements it examines",
      PAGE_EXPRESSION.includes("cs2.length<" + SCAN_CANVASES), PAGE_EXPRESSION);
    // A decoy must not be able to spend the budget of a real canvas: the
    // kept-budget guard has to sit *inside* the loop, on the pushed rects.
    check("the kept budget is spent only by visible canvases, not by decoys",
      PAGE_EXPRESSION.includes("canv.length<" + MAX_CANVASES), PAGE_EXPRESSION);
    check("hitting the scan bound is reported as a cap, not as an answer",
      PAGE_EXPRESSION.includes("capped=cs2.length>lim"), PAGE_EXPRESSION);

    // The page hands back more rects than the cap allows anyway — which is
    // exactly what a page that rewrites the expression's surroundings would do.
    const many = Array.from({ length: 500 }, () => ({ x: 0, y: 0, w: 10, h: 10 }));
    const probe = async (value) => {
      const ctx = { Array, Number, PAGE_EXPRESSION: "", dbg: { sendCommand: async () => ({ result: { value } }) } };
      vm.createContext(ctx);
      // esbuild strips types without reading them; `vm` is plain JS, so the
      // casts have to come off by hand or the body will not parse.
      const body = extract("pageProbe").replace(/\s+as\s+(any|\{(?:[^{}]|\{[^{}]*\})*\})/g, "");
      await vm.runInContext(
        `const MAX_CANVASES = ${MAX_CANVASES};
         async function pageProbe(tabId) { ${body} }
         (async () => { pageResult = await pageProbe(1); })()`,
        ctx);
      return ctx.pageResult;
    };

    const over = await probe({ caret: [], canvases: many, vw: 1000, vh: 1000 });
    check("an oversized rect list is sliced to the cap",
      over.canvases.length === MAX_CANVASES, `got ${over.canvases.length}`);

    const under = await probe({ caret: [], canvases: many.slice(0, 3), vw: 1000, vh: 1000 });
    check("a list under the cap is untouched",
      under.canvases.length === 3, `got ${under.canvases.length}`);

    const malformed = await probe({ caret: [], canvases: { length: 9999 }, vw: 1000, vh: 1000 });
    check("a non-array canvases value is empty, not a length",
      Array.isArray(malformed.canvases) && malformed.canvases.length === 0,
      `got ${JSON.stringify(malformed.canvases)}`);

    // The bound must not change the answer for a page within it.
    check("the bound leaves a full-viewport canvas fully covered",
      computeCanvasCovered((await probe({ caret: [], canvases: [{ x: 0, y: 0, w: 800, h: 600 }], vw: 800, vh: 600 })).canvases, 800, 600) === 1);

    // A page that scanned more than the bound cannot vouch for the largest
    // rect, so the answer is unknown — and unknown must read as absent, not 0.
    check("a capped enumeration is reported as capped",
      (await probe({ caret: [], canvases: [], capped: true, vw: 100, vh: 100 })).capped === true
      && (await probe({ caret: [], canvases: [], vw: 100, vh: 100 })).capped === false);
    check("a capped enumeration yields no canvasCovered at all",
      extract("computeDelta").includes("!probe.capped"));
  }

  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});