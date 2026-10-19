/**
 * The page-delta signal: "did the page change, and where", per step, without
 * a single pixel leaving this file.
 *
 * WHY THIS EXISTS. On a Google Sheet the accessibility tree measures 71 targets
 * / ~11 KB and is *byte-identical across 15 consecutive steps* no matter what
 * the agent types. The agent has no evidence its action landed, correctly
 * concludes nothing happened, and repeats. A screenshot every step would fix
 * that, at the token cost nobody wants; the difference is worth ~100 bytes.
 *
 * THE CONTRACT (fixed; the server side is built against this exact shape):
 *
 *   delta: {
 *     changed: boolean,
 *     tiles: [ { x, y, w, h, pct } ],   // worst first, max 5
 *   }
 *
 * `tiles` are 16×16 tiles in FULL-RESOLUTION viewport CSS pixels. `pct` is the
 * tile's mean absolute luminance difference, as a percentage of full scale.
 *
 * The same pass also yields, on every observation:
 *
 *   canvasCovered: 0.0 .. 1.0
 *
 * The fraction of the visible viewport occupied by the largest single
 * `<canvas>` — Sheets, Docs, Figma, Canva. It rides the existing DOM
 * evaluation below, so it costs one `getBoundingClientRect` loop and no round
 * trip; the harness reads it to decide whether to ask for a screenshot, so it
 * must be present before that decision. Fixed wire name and type; do not nest
 * or rename it.
 *
 * ── Locked decision D2, and it is the reason this file ends where it ends ──
 * These coordinates are EVIDENCE, NEVER A TARGET. Nothing in the extension may
 * consume them; the server is forbidden from feeding a tile to a coordinate
 * action. A tile is a region that *moved or changed*, which is not a claim
 * about what is there now — the page repaints after the diff. Do not re-point
 * `_coordinate_action` at a tile. That re-pointing is how D2 gets broken a year
 * from now, and it will look like an obvious optimisation.
 *
 * ── Privacy: the pixels never leave the service worker ──────────────────────
 * The capture is decoded, differenced, and dropped. Nothing here is cached to
 * disk, written into the audit document, or put on the wire: the wire carries
 * ~100 bytes of derived integers, and the JPEG/PNG bytes exist only as a local
 * `Blob`. The one frame retained per tab lives in `frames` below and is cleared
 * on navigation, on task start, on tab close and on detach. If you find
 * yourself wanting to send these bytes anywhere, that is a different feature
 * with a different privacy analysis — not a line to change here.
 */

import * as dbg from "../debugger";

// Tile edge in the *downscaled* buffer, i.e. in device pixels we actually
// compare. 16 × 16 = 256 samples is enough for a stable mean and cheap enough
// to walk a 1920×1080 viewport at ~80k samples per step.
const TILE_PX = 16;

/**
 * Mean absolute luminance difference (0–255 scale) a tile must exceed.
 *
 * Per-tile and absolute, and both properties are deliberate:
 *
 * - **Per-tile, not one global number.** A single character in a large mostly-
 *   white grid is ~0.01% of the pixels; a global mean is swamped by whatever
 *   else moved and will miss it. Tiling makes the false-negative rate depend on
 *   tile size, not on page size — which is the whole reason this detects a
 *   cell edit in a 40×200 Sheet.
 * - **Absolute, not a fraction of the page.** "N pixels changed" is robust;
 *   "% of page changed" is the most mis-set parameter in visual regression
 *   testing, because the same fraction means a scroll on a small page and
 *   nothing at all on a large one.
 *
 * The noise floor it implies: at 2.0 a tile must have moved by ~0.8% of full
 * scale, on average, over its whole area. A changed glyph in a 16×16 cell
 * tile is worth roughly 15 — one glyph's worth of black-on-white coverage at
 * full contrast. So the signal sits ~7× above the threshold and the threshold
 * sits well above lossless-codec noise, which is ~0.
 *
 * HONEST CAVEAT: 2.0 was chosen against synthetic pixels, not against a real
 * Google Sheet capture. It needs pinning against real captures before it is
 * trusted — see the "false-negative risk" note in the task report. The knob is
 * deliberately a single named constant so that pinning it is a one-line change.
 */
const TILE_DIFF_THRESHOLD = 2.0;

const MAX_TILES = 5;

/** Downscale factor. Half, not an eighth: an eighth of a 1920×1080 viewport is
 *  240×135, and one 16×16 tile there covers 128 real CSS pixels — too coarse to
 *  localise a cell edit. Half keeps a tile at 32 CSS px, which is cell-sized. */
const SCALE = 0.5;

/** PNG, not JPEG, and this is load-bearing for the threshold above. JPEG q60
 *  re-encodes every capture, so two identical frames differ by codec ringing
 *  (a mean abs difference of ~1–3 on dense text) — which is the same order as
 *  the signal. Lossless removes the codec from the measurement entirely. The
 *  bytes are decoded here and never leave, so the larger payload buys nothing
 *  and costs nothing but local CPU. */
const FORMAT = "png";

/** Cap on `<canvas>` elements enumerated per observation. 64 is far above any
 *  real page — Sheets, Docs, Figma and Canva have one or two each — and keeps
 *  the probe payload in the low kilobytes. It is a bound on attacker-controlled
 *  input on a per-step hot path, so it is enforced twice: once in the page
 *  expression (before any `getBoundingClientRect` is read) and once on the
 *  consumer side (the expression is a string; the first thing a page can try
 *  to break). */
const MAX_CANVASES = 64;

export interface Tile { x: number; y: number; w: number; h: number; pct: number }
export interface Delta { changed: boolean; tiles: Tile[] }

/** What one page pass yields: the per-step diff when there is one truthful to
 *  report, and the canvas occupancy fraction always (it is a property of the
 *  page, not of the previous frame, so the first observation has it too). */
export interface PageSignal { delta?: Delta; canvasCovered?: number }

/** Named rather than inline, because `scripts/test-observation-delta.test.js`
 *  extracts this function by brace matching and an inline `{ reset?: boolean }`
 *  in the signature is a brace it will match as the body. */
export interface DeltaOpts { reset?: boolean }

/** One retained frame per tab, held only to compute the next diff. */
interface Frame { url: string; data: ImageData }

const frames = new Map<number, Frame>();

/** Drop every retained frame, or just one tab's. Nothing here is persisted, so
 *  this is the whole deletion story. */
export function clearDelta(tabId?: number): void {
  if (tabId === undefined) frames.clear();
  else frames.delete(tabId);
}

/**
 * The pure half: two downscaled frames in, the wire shape out.
 *
 * Written without local type annotations for the same reason as `anyCommand` in
 * `surfaces.ts` — `scripts/test-observation-delta.test.js` extracts this body
 * by brace matching and evaluates it as plain JavaScript, and `: Tile[]` is a
 * syntax error there. The signature is deliberately brace-free; the test
 * fails loudly if that changes.
 *
 * `masked` marks pixels excluded from the sum — the caret rect. A masked pixel
 * contributes nothing rather than contributing zero to a denominator that is
 * already over unmasked pixels, so a caret in a tile does not dilute the real
 * edit sitting in the same tile.
 */
export function tileDelta(prev, cur, masked) {
  const w = Math.min(prev.width, cur.width);
  const h = Math.min(prev.height, cur.height);
  const pa = prev.data;
  const ca = cur.data;
  const hasMask = masked !== null && masked !== undefined;
  const cols = Math.ceil(w / TILE_PX);
  const rows = Math.ceil(h / TILE_PX);
  const hot = [];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x0 = tx * TILE_PX;
      const y0 = ty * TILE_PX;
      const x1 = Math.min(x0 + TILE_PX, w);
      const y1 = Math.min(y0 + TILE_PX, h);
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          if (hasMask && masked[i]) continue;
          const p = i * 4;
          // Rec. 601 luminance. The channels are then summed rather than
          // averaged: the factor is a constant, so it cancels in the ratio and
          // the three reads are cheaper than three multiplies.
          const lum = pa[p] * 0.299 + pa[p + 1] * 0.587 + pa[p + 2] * 0.114;
          const lum2 = ca[p] * 0.299 + ca[p + 1] * 0.587 + ca[p + 2] * 0.114;
          sum += lum > lum2 ? lum - lum2 : lum2 - lum;
          n++;
        }
      }
      if (n === 0) continue;
      const mean = sum / n;
      if (mean < TILE_DIFF_THRESHOLD) continue;
      hot.push({ mean, x0, y0, x1, y1 });
    }
  }
  hot.sort((a, b) => b.mean - a.mean);
  const tiles = hot.slice(0, MAX_TILES).map((t) => ({
    // Full-resolution CSS pixels: one downscaled pixel is 1/SCALE of one.
    x: Math.round(t.x0 / SCALE),
    y: Math.round(t.y0 / SCALE),
    w: Math.round((t.x1 - t.x0) / SCALE),
    h: Math.round((t.y1 - t.y0) / SCALE),
    pct: Math.round(t.mean * 10) / 10,
  }));
  return { changed: hot.length > 0, tiles };
}

/**
 * Where the text caret is, in CSS pixels, or `[]`.
 *
 * A blinking caret in a cell is a permanent change and would make every diff
 * meaningless on exactly the pages this feature exists for. It cannot be found
 * in the pixels — by the time you can see it, it is already a diff — so it is
 * asked for from the DOM, which is the only place that knows.
 *
 * Two shapes, because a caret is two different things:
 *
 * - **contenteditable**: the selection range has a client rect. Exact.
 * - **input / textarea**: there is no range rect for a value selection, so the
 *   prefix before the caret is measured with `canvas.measureText` under the
 *   element's own computed font and added to its content-box origin. Accurate
 *   to a pixel or two, which is why the mask is drawn 3 CSS px wide and padded
 *   — the mask only has to cover the bar, not frame it.
 *
 * HONEST LIMIT: a caret drawn by a grid widget that is *not* a value-bearing
 * input — Google Sheets' cell cursor is the motivating case — is not reachable
 * by either branch and is not masked. That is a real gap on the page this
 * feature was built for, and it is why the threshold needs pinning against real
 * captures rather than trusted from a unit test. Widening this locator means
 * looking for the widget's own cursor element, which is per-product and is not
   * a general fix.
 */
const PAGE_EXPRESSION =
  "(function(){var a=document.activeElement;var out=[];try{" +
  "if(a&&a.isContentEditable){var s=window.getSelection();" +
  "if(s&&s.rangeCount){var r=s.getRangeAt(0).getBoundingClientRect();" +
  "if(r.width||r.height)out.push({x:r.x,y:r.y,w:2,h:r.height||16});}}" +
  "else if(a&&typeof a.value==='string'&&a.selectionStart!==undefined&&a.selectionStart!==null){" +
  "var cs=getComputedStyle(a);var b=a.getBoundingClientRect();" +
  "var x=b.left+parseFloat(cs.borderLeftWidth||0)+parseFloat(cs.paddingLeft||0);" +
  "var c=document.createElement('canvas').getContext('2d');" +
  "if(c){c.font=cs.fontWeight+' '+cs.fontSize+' '+cs.fontFamily;" +
  "x+=c.measureText(a.value.slice(0,a.selectionStart)).width;}" +
  "out.push({x:x,y:b.top,w:2,h:b.height||16});}}catch(e){}" +
  "var canv=[];try{var cs2=document.getElementsByTagName('canvas');" +
  "var lim=cs2.length<" + MAX_CANVASES + "?cs2.length:" + MAX_CANVASES + ";" +
  "for(var i=0;i<lim;i++){var cr=cs2[i].getBoundingClientRect();" +
  "if(cr.width>0&&cr.height>0)canv.push({x:cr.left,y:cr.top,w:cr.width,h:cr.height});}}catch(e){}" +
  "return {caret:out,canvases:canv,vw:window.innerWidth,vh:window.innerHeight};})()";

async function pageProbe(tabId: number): Promise<{ caret: any[]; canvases: any[]; vw: number; vh: number } | null> {
  try {
    const r = await dbg.sendCommand(tabId, {
      method: "Runtime.evaluate",
      params: { expression: PAGE_EXPRESSION, returnByValue: true },
    }) as { result?: { value?: unknown } };
    const v = r?.result?.value;
    if (!v || typeof v !== "object") return null;
    return {
      caret: Array.isArray((v as any).caret) ? (v as any).caret : [],
      canvases: Array.isArray((v as any).canvases)
        ? (v as any).canvases.slice(0, MAX_CANVASES)
        : [],
      vw: Number((v as any).vw) || 0,
      vh: Number((v as any).vh) || 0,
    };
  } catch {
    // Tab mid-navigation, or the debugger went. The diff still works; it just
    // does not know about a caret this time.
    return null;
  }
}

/**
 * The fraction of the visible viewport occupied by the largest single
 * `<canvas>`, in `[0, 1]`.
 *
 * WHY. Google Sheets, Docs, Figma and Canva draw their content to a canvas.
 * Their AX tree is the toolbar and the menu bar and nothing else, so the
 * vision-fallback trigger — which fires on vocabulary overlap — reads the
 * word "Sheet1" and "Name box" in the page chrome and decides the model can
 * see the grid. It cannot. This is the honest, cheap page-level signal, and it
 * is one number: no pixels, no second round trip, no new frame type.
 *
 * The question asked is what the canvas *occupies*, not what is on top of it,
 * so it is `getBoundingClientRect()` area and deliberately NOT
 * `elementFromPoint` sampling: a grid's own overlay divs would sample over the
 * canvas in places and undercount it. Rects are intersected with the viewport
 * so a grid scrolled half off-screen reports what it actually shows.
 *
 * Written without local type annotations for the same reason as `tileDelta`:
 * the test extracts this body by brace matching and evals it as plain
 * JavaScript.
 */
export function computeCanvasCovered(rects, vw, vh) {
  const area = vw * vh;
  if (!(area > 0) || !Array.isArray(rects)) return 0;
  let best = 0;
  for (const r of rects) {
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(vw, r.x + (r.w || 0));
    const y1 = Math.min(vh, r.y + (r.h || 0));
    const a = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    // A NaN coordinate makes `a` NaN, and the comparison is false, so a
    // malformed rect is dropped rather than emitted.
    if (a > best) best = a;
  }
  let f = best / area;
  if (!isFinite(f) || f < 0) f = 0;
  return f > 1 ? 1 : f;
}

/** Rasterise caret rects (CSS px) into a per-pixel mask at the frame's own
 *  scale. `null` when there is nothing to mask, so the diff loop skips the
 *  lookup entirely on a page with no caret. */
export function buildCaretMask(width, height, rects) {
  if (!rects || rects.length === 0) return null;
  const mask = new Uint8Array(width * height);
  // Three CSS pixels of padding: the input branch of the locator is accurate
  // to a pixel or two, and the mask only has to cover the bar, not frame it.
  const pad = 3 * SCALE;
  let any = false;
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x * SCALE - pad));
    const y0 = Math.max(0, Math.floor(r.y * SCALE - pad));
    const x1 = Math.min(width, Math.ceil((r.x + (r.w || 2)) * SCALE + pad));
    const y1 = Math.min(height, Math.ceil((r.y + (r.h || 16)) * SCALE + pad));
    for (let y = y0; y < y1; y++) {
      mask.fill(1, y * width + x0, y * width + x1);
    }
    any = true;
  }
  return any ? mask : null;
}

async function captureFrame(tabId: number) {
  const r = await dbg.sendCommand(tabId, {
    method: "Page.captureScreenshot",
    params: {
      format: FORMAT,
      clip: { x: 0, y: 0, width: 0, height: 0, scale: SCALE },
      captureBeyondViewport: false,
    },
  }) as { data?: unknown };
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
  // The decoded pixels go no further than this function's return value and the
  // single retained frame. Nothing above is written anywhere.
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * The per-step delta for this tab, plus the canvas occupancy fraction.
 *
 * `delta` is absent for every case where a comparison would be a lie: first
 * observation, a different URL, a viewport that changed size, or a capture
 * that failed. Reporting `changed: false` in any of those would tell the
 * model "I checked and nothing happened" when in fact nothing was checked,
 * and the whole point of this feature is that the model trusts `false`.
 *
 * `canvasCovered` is present whenever the DOM pass returned at all, including
 * on the first observation: it describes the page, not the previous frame, and
 * the harness reads it to decide whether to ask for a screenshot — so it has
 * to be there before that decision. It is ABSENT when the DOM pass itself
 * failed (tab gone, debugger detached): the harness treats a missing value as
 * unknown, and `0` would be a claim — "not a canvas" — that nothing checked.
 */
export async function computeDelta(
  tabId: number,
  url: string,
  opts?: DeltaOpts,
): Promise<PageSignal> {
  const probe = await pageProbe(tabId);
  const canvasCovered = probe
    ? computeCanvasCovered(probe.canvases, probe.vw, probe.vh)
    : undefined;

  const prev = frames.get(tabId);
  if (opts?.reset || (prev && prev.url !== url)) {
    clearDelta(tabId);
    try {
      const first = await captureFrame(tabId);
      if (first) frames.set(tabId, { url, data: first });
    } catch { /* capture failed; the next step still has nothing to compare */ }
    return signal(canvasCovered);
  }

  let cur;
  try {
    cur = await captureFrame(tabId);
  } catch {
    return signal(canvasCovered);
  }
  if (!cur) return signal(canvasCovered);
  if (!prev) {
    frames.set(tabId, { url, data: cur });
    return signal(canvasCovered);
  }
  // A resized window is not a page change; it is a different buffer. Comparing
  // them would report the whole viewport as changed.
  if (prev.data.width !== cur.width || prev.data.height !== cur.height) {
    frames.set(tabId, { url, data: cur });
    return signal(canvasCovered);
  }

  const mask = buildCaretMask(cur.width, cur.height, probe ? probe.caret : []);
  const delta = tileDelta(prev.data, cur, mask);
  frames.set(tabId, { url, data: cur });
  return { delta, ...(canvasCovered === undefined ? {} : { canvasCovered }) };
}

/** `undefined` here means "not measured", and is spread away rather than
 *  defaulted to 0 — see the note on `computeDelta`. */
function signal(canvasCovered) {
  return canvasCovered === undefined ? {} : { canvasCovered };
}