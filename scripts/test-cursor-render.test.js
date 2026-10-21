// The cursor's label must actually render.
//
// `scripts/test-cursor.test.js` asserts on the *source* of the draw snippet:
// that the words are capped, that the host carries no text node, that no
// `<style>` element is injected. None of that is evidence the words appear on
// screen. The first version of the label rendered them with a `::after` rule
// in an injected `<style>` element — which is not a text node, and so passes
// every one of those source assertions — and on Google Sheets it rendered an
// *empty black pill*, because the page's Content-Security-Policy refuses a
// `<style>` element that carries no nonce.
//
// So this file renders the marker in a real browser, on a page with a strict
// CSP, and asks the page what it drew.
//
//   node --test scripts/test-cursor-render.test.js
//
// Needs a Chrome on the machine. GitHub's ubuntu runners have one; a dev
// machine usually does. If there is none the file says so loudly and passes —
// which is a skip, not a green, and is why the source assertions in
// `test-cursor.test.js` stay.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const SRC = path.join(__dirname, "..", "clients", "brotto-extension", "src", "observation", "pointer.ts");
const src = fs.readFileSync(SRC, "utf8");

// The one template literal, sliced between the backticks — never copied.
function extractTemplate(name, from = src) {
  const marker = `const ${name} = \``;
  const start = from.indexOf(marker);
  if (start < 0) throw new Error(`no template const ${name} — renamed?`);
  const end = from.indexOf("`;", start);
  if (end < 0) throw new Error(`unterminated template ${name}`);
  return from.slice(start + marker.length, end);
}

const MAX_CURSOR_LABEL = src.match(/^export const MAX_CURSOR_LABEL = (\d+);$/m)[1];
const DRAW_CURSOR = extractTemplate("DRAW_CURSOR").replace("${MAX_CURSOR_LABEL}", MAX_CURSOR_LABEL);
const CURSOR_ID = src.match(/^export const CURSOR_ID = "(.*)";$/m)[1];

// The words, unique, so a page that happens to contain them cannot pass the
// check for the wrong reason.
const WORDS = "BrottoLabelProbe7Q";

/** A Chrome to render with, or null. */
function findChrome() {
  const candidates = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    candidates.push("/Applications/Chromium.app/Contents/MacOS/Chromium");
  } else if (process.platform === "linux") {
    for (const bin of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
      const p = execFileSync("sh", ["-c", `command -v ${bin} || true`], { encoding: "utf8" }).trim();
      if (p) candidates.push(p);
    }
  }
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {
      // A path we cannot stat is not a browser.
    }
  }
  return null;
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(`FAIL  ${name}\n      ${detail}`); }
}

// The page. A strict CSP — `style-src 'self'`, no `'unsafe-inline'` — so the
// route that broke in production is refused here too, and the marker still has
// to draw. The page carries no stylesheet of its own, because a strict CSP
// would refuse that as well; a bare white page is the point.
const page = `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; script-src 'self' 'unsafe-inline'">
<title>cursor render</title></head>
<body>
<div id="host">a cell grid would be here</div>
<script>
window.__draw = (${DRAW_CURSOR});
var out = { errors: [] };
// Find the words wherever they are — light DOM or shadow root — so this
// measures what the marker drew rather than assuming a structure.
function findWords(node, words) {
  if (!node) return null;
  var kids = node.childNodes || [];
  for (var i = 0; i < kids.length; i++) {
    var kid = kids[i];
    if (kid.nodeType === 3 && String(kid.nodeValue || "").indexOf(words) >= 0) return kid;
    if (kid.nodeType === 1) {
      // The page's own script mentions the words; that is source, not paint.
      var tag = String(kid.tagName || "").toLowerCase();
      if (tag === "script" || tag === "style") continue;
      var hit = findWords(kid, words);
      if (hit) return hit;
      if (kid.shadowRoot) {
        var deep = findWords(kid.shadowRoot, words);
        if (deep) return deep;
      }
    }
  }
  return null;
}
try {
  out.drawn = window.__draw(40, 20, ${JSON.stringify(WORDS)}, ${JSON.stringify(CURSOR_ID)});
  var textNode = findWords(document, ${JSON.stringify(WORDS)});
  out.wordsFound = !!textNode;
  if (textNode) {
    var range = document.createRange();
    range.selectNodeContents(textNode);
    // A text node that is laid out, not one that is merely in the DOM.
    out.textRects = range.getClientRects().length;
    out.textWidth = range.getBoundingClientRect().width;
    out.textHeight = range.getBoundingClientRect().height;
    var box = textNode.parentElement.getBoundingClientRect();
    out.chipWidth = box.width;
    out.chipHeight = box.height;
    out.chipDisplay = getComputedStyle(textNode.parentElement).display;
    out.chipVisibility = getComputedStyle(textNode.parentElement).visibility;
    // The words must not be in the light DOM: that is the page's text.
    var root = textNode.parentElement.getRootNode();
    out.inShadowRoot = !!(root && root.host);
  }
  // The page's own text, which is what the model reads. The words must not be
  // in it.
  out.innerTextHasWords = (document.body.innerText || "").indexOf(${JSON.stringify(WORDS)}) >= 0;
  // And no stylesheet was injected: the marker must not need one.
  out.styleElements = document.querySelectorAll("style").length;
  // Proof that this page's CSP really does refuse a stylesheet — otherwise
  // the checks above would pass for the wrong reason.
  var probe = document.createElement("style");
  probe.textContent = "body { color: red; }";
  document.head.appendChild(probe);
  out.cspBlocksStylesheets = probe.sheet === null;
  probe.remove();
} catch (e) {
  out.errors.push(String(e && e.message ? e.message : e));
}
var pre = document.createElement("pre");
pre.id = "brotto-render-result";
pre.textContent = JSON.stringify(out);
document.body.appendChild(pre);
</script>
</body></html>`;

(async () => {
  console.log("the cursor's label renders on a CSP-restricted page");
  const chrome = findChrome();
  if (!chrome) {
    console.log("  SKIP  no Chrome on this machine (set CHROME_PATH) — the rendering check did not run");
    console.log("\nall cursor render cases pass (skipped)");
    process.exit(0);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brotto-cursor-"));
  const file = path.join(dir, "cursor.html");
  fs.writeFileSync(file, page);

  let dom = "";
  try {
    dom = execFileSync(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--user-data-dir=" + path.join(dir, "profile"),
      "--virtual-time-budget=2000",
      "--dump-dom",
      "file://" + file,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000 });
  } catch (e) {
    failures++;
    console.log(`FAIL  headless Chrome ran\n      ${String(e && e.message ? e.message : e).slice(0, 400)}`);
  }

  const m = dom.match(/<pre id="brotto-render-result">([\s\S]*?)<\/pre>/);
  if (!m) {
    failures++;
    console.log("FAIL  the page reported a result\n      no result element in the dumped DOM");
  } else {
    const out = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
    check("the page ran without throwing", (out.errors || []).length === 0,
      `errors: ${JSON.stringify(out.errors)}`);
    check("the marker drew", out.drawn && out.drawn.drawn === true,
      `draw answered ${JSON.stringify(out.drawn)}`);
    check("this page's CSP refuses a stylesheet (the reason the ::after route died)",
      out.cspBlocksStylesheets === true,
      "the page accepted a <style> element, so the CSP is not strict and the rest proves nothing");
    check("the marker injected no stylesheet", out.styleElements === 0,
      `${out.styleElements} <style> elements in the page`);
    check("the words are in a text node somewhere", out.wordsFound === true,
      "the label's words are in no text node at all, so nothing painted them");
    check("the words are painted, not merely in the DOM",
      out.textRects > 0 && out.textWidth > 0 && out.textHeight > 0,
      `the text has ${out.textRects} client rects, ${out.textWidth}x${out.textHeight}px`);
    check("the label is a laid-out box", out.chipWidth > 0 && out.chipHeight > 0,
      `the label's box is ${out.chipWidth}x${out.chipHeight}`);
    check("the label is visible", out.chipDisplay !== "none" && out.chipVisibility === "visible",
      `display ${out.chipDisplay}, visibility ${out.chipVisibility}`);
    check("the words are out of the light DOM", out.inShadowRoot === true,
      "the words are in the page's own tree, where the model's page text would find them");
    check("the words are not in the page text the model reads",
      out.innerTextHasWords === false,
      "the label's words are in document.body.innerText — the model would read the agent's own annotation");
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures === 0 ? "\nall cursor render cases pass" : `\n${failures} failing`);
  process.exit(failures === 0 ? 0 : 1);
})();
