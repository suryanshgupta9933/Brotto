// W1 — the screenshot path is mostly an absence, so it needs a test.
//
// The failure that matters is not "the wrong quality" — it is an observation
// that should have carried an image and did not, or a base64 string that was
// truncated on the way and decodes to a corrupt picture a vision model reads
// as a page. Both read clean in a diff. So the branch is extracted from
// `background.ts` by brace matching and run against a fake socket, exactly
// like `test-key-dispatch.test.js`, and the relay's half is extracted from
// `extension_relay.py` the same way.
//
// It also pins two decisions that are otherwise free to drift: JPEG at q60
// (PNG is ~10x the tokens per step for no benefit) and no `notifyUi` in the
// branch — a frame forwarded to a panel with no `case` for it is a run that
// never ends (`test-no-orphan-frames.test.js`).

//   node scripts/test-screenshot-frames.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const bg = fs.readFileSync(
  path.join(ROOT, "clients", "brotto-extension", "src", "background.ts"), "utf8");
const relay = fs.readFileSync(
  path.join(ROOT, "services", "brotto-orchestrator", "src", "brotto_orchestrator",
    "cdp", "extension_relay.py"), "utf8");

/** The `case "capture_screenshot":` body, with TypeScript annotations stripped. */
function extractBranch() {
  const start = bg.search(/case "capture_screenshot":/);
  if (start < 0) throw new Error('no `case "capture_screenshot"` — renamed?');
  const open = bg.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < bg.length; i++) {
    if (bg[i] === "{") depth++;
    else if (bg[i] === "}" && --depth === 0) {
      return bg.slice(open + 1, i)
        .replace(/ as \{[^}]*\}/g, "")   // `x as { data?: unknown }`
        .replace(/ as [A-Za-z<>\[\]| ]+;/g, "")
        .replace(/ws!/g, "ws")          // the non-null assertion
        .replace(/^\s*break;\s*$/m, ""); // the switch's, with no switch here
    }
  }
  throw new Error("unterminated capture_screenshot branch");
}

/** Run the branch against a fake socket and a fake debugger. */
function runBranch({ sendCommand, tid = 1, msg = {}, vp = { width: 1512, height: 945, scale: 0.5 } }) {
  const sent = [];
  const ctx = {
    tid,
    msg,
    ws: { send: (s) => sent.push(JSON.parse(s)) },
    dbg: { sendCommand },
    cssViewport: async () => vp,
    MAX_SCREENSHOT_CHARS: 4000000,
  };
  vm.createContext(ctx);
  const body = extractBranch();
  vm.runInContext(`(async () => {${body}})()`, ctx);
  return new Promise((resolve) => {
    ctx.__done = resolve;
    // The branch resolves before its own promise is awaited; poll-free
    // because `run` returns synchronously once the last send has happened.
    setTimeout(() => resolve(sent), 10);
  });
}

const JPEG = "/9j/4AAQSkZJRgABAQAAAQ==";
let failed = 0;
function check(ok, label, detail) {
  console.log(ok ? `  ok  ${label}` : `FAIL  ${label}`);
  if (!ok) {
    failed++;
    if (detail) console.log(`      ${detail}`);
  }
}

(async () => {
  console.log("the capture command is JPEG at quality 60, clipped to the viewport");
  const calls = [];
  const sent = await runBranch({
    sendCommand: (tab, cmd) => {
      calls.push([tab, cmd]);
      return Promise.resolve({ data: JPEG });
    },
  });
  check(calls.length === 1, "one CDP command is issued");
  check(calls[0] && calls[0][1].method === "Page.captureScreenshot",
    "the method is Page.captureScreenshot",
    calls[0] && `got ${calls[0][1].method}`);
  const p = (calls[0] && calls[0][1].params) || {};
  check(p.format === "jpeg", "format is jpeg, not png — ~10x the tokens per step");
  check(p.quality === 60, "quality is 60");
  check(p.clip === undefined, "no clip: the default viewport, not a full-page shot");

  // ── CSS resolution ──────────────────────────────────────────────────────
  // A canvas page has no text worth reading at 2x, and the model clicks in CSS
  // pixels whatever the picture is, so the retina copy is 2.6x the bytes for
  // detail nothing reads. (Measured on Chrome: 223 KB -> 85 KB. The *token*
  // saving is only ~7%, because the 3024px shot is downscaled to a 1568px long
  // edge on the way in regardless.) The request is the harness's — it owns
  // `_is_canvas_page` — and the card capture, the user's own approval surface,
  // keeps the retina copy.
  console.log("\ncss_resolution asks for a CSS-pixel image, and nothing else does");
  const cssCalls = [];
  await runBranch({
    msg: { type: "capture_screenshot", css_resolution: true },
    sendCommand: (tab, cmd) => {
      cssCalls.push([tab, cmd]);
      return Promise.resolve({ data: JPEG });
    },
    vp: { width: 1512, height: 945, scale: 0.5 },
  });
  const cp = (cssCalls.find((c) => c[1].method === "Page.captureScreenshot") || [])[1];
  const clip = (cp && cp.params) || {};
  check(!!clip.clip, "a css_resolution capture carries a clip",
    `params = ${JSON.stringify(clip)}`);
  check(clip.clip && clip.clip.x === 0 && clip.clip.y === 0,
    "the clip starts at the viewport origin");
  check(clip.clip && clip.clip.width === 1512 && clip.clip.height === 945,
    "the clip's extent is the CSS viewport, not the device viewport",
    clip.clip && `${clip.clip.width}x${clip.clip.height}`);
  // Measured on Chrome, not assumed: at dpr 2 a clip of scale 1 comes back
  // 3024x1890 — the same device picture as no clip at all. It is 1/dpr that
  // lands on 1512x945.
  check(clip.clip && clip.clip.scale === 0.5,
    "the clip scale is 1/devicePixelRatio — scale 1 is the device shot again",
    clip.clip && `scale = ${clip.clip.scale}`);
  check(clip.format === "jpeg" && clip.quality === 60,
    "css_resolution does not change format or quality");

  // A viewport we could not measure must fall back to the device capture, not
  // to a clip of a guessed size: a wrong clip is a picture that does not show
  // the page the model is clicking on.
  const noVp = [];
  await runBranch({
    msg: { type: "capture_screenshot", css_resolution: true },
    sendCommand: (tab, cmd) => {
      noVp.push(cmd);
      return Promise.resolve({ data: JPEG });
    },
    vp: null,
  });
  const vpClip = (noVp.find((c) => c.method === "Page.captureScreenshot").params).clip;
  check(vpClip === undefined,
    "an unmeasurable viewport falls back to the device capture, not a guess",
    `clip = ${JSON.stringify(vpClip)}`);

  // `css_resolution: false` and a missing key are the same answer: today's
  // behaviour, so nothing but the canvas path can change.
  for (const msg of [{ type: "capture_screenshot" },
                     { type: "capture_screenshot", css_resolution: false },
                     { type: "capture_screenshot", css_resolution: "yes" }]) {
    const seen = [];
    await runBranch({
      msg,
      sendCommand: (tab, cmd) => { seen.push(cmd); return Promise.resolve({ data: JPEG }); },
    });
    const got = seen.find((c) => c.method === "Page.captureScreenshot").params;
    check(got.clip === undefined,
      `css_resolution ${JSON.stringify(msg)} leaves the capture alone`);
  }

  console.log("\nthe answer is one screenshot_result frame carrying base64");
  check(sent.length === 1 && sent[0].type === "screenshot_result",
    "exactly one screenshot_result is sent");
  check(sent[0] && sent[0].data === JPEG, "the base64 arrives intact");
  check(sent[0] && sent[0].error === undefined,
    "a success carries no error key — the server's branch tests for it");

  console.log("\nthe branch is never forwarded to the panel");
  check(!/notifyUi/.test(extractBranch()),
    "no notifyUi in the capture branch",
    "the panel has no `case 'screenshot_result'`, and forwarding it is a run " +
      "that never ends; the image is for the server");

  console.log("\nan absent or corrupt image is refused, never half-sent");
  const empty = await runBranch({ sendCommand: () => Promise.resolve({ data: "" }) });
  check(empty.length === 1 && empty[0].error && empty[0].data === "",
    "an empty capture answers with an error, not a blank page");

  const huge = "A".repeat(4000001);
  const big = await runBranch({ sendCommand: () => Promise.resolve({ data: huge }) });
  check(big.length === 1 && /too large/.test(big[0].error || ""),
    "an oversized capture is refused — truncated base64 decodes to a corrupt image");

  const threw = await runBranch({
    sendCommand: () => Promise.reject(new Error("detached")),
  });
  check(threw.length === 1 && threw[0].error && threw[0].data === "",
    "a CDP failure answers with an error rather than silence");

  const noTab = await runBranch({
    tid: null,
    sendCommand: () => Promise.reject(new Error("should not be called")),
  });
  check(noTab.length === 1 && !!noTab[0].error,
    "no attached tab answers with an error rather than hanging the caller");

  console.log("\nthe frame contract is additive — nothing was renamed or removed");
  check(/case "evaluate":/.test(bg), "the evaluate frame still exists");
  check(/evaluate_result/.test(bg), "the extension still answers evaluate_result");

  console.log("\nthe relay half asks, waits, and returns the base64");
  for (const sig of [
    "async def capture_screenshot(self, css_resolution: bool = False)",
    "async def deliver_screenshot_result(self, message: dict)",
    '"type": "capture_screenshot"',
  ]) {
    check(relay.includes(sig), `extension_relay.py has ${sig}`);
  }
  // The base64 must not reach a log line or the relay's cached state.
  // Scoped to the function body, not to a run of neighbours: a region between
  // two method names silently widens every time a method is added between them.
  const method = relay.slice(
    relay.indexOf("async def capture_screenshot"),
    relay.indexOf("\n    async def ", relay.indexOf("async def capture_screenshot") + 1));
  check(!/log\.(info|debug|warning)\([^)]*data\b/.test(method),
    "the relay never logs the payload — the log line would be the picture on disk");
  check(!/self\._cached_obs/.test(method),
    "the image is not stored on the relay — transit only");

  console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
})();