// The panel must not fetch a font from anywhere.
//
// The bug this pins: both extension pages loaded Geist from
// `fonts.googleapis.com` with a `<link>`, so every side-panel open and every
// welcome page made two requests to Google — a remote request from an
// extension page, which is a Chrome Web Store data-disclosure item and a
// privacy-policy claim ("the extension makes no outbound requests of its
// own") that was simply false. The fonts are now bundled in `src/assets/`.
//
// Adding a webfont is the ordinary way a panel gets its typography, so this
// is the kind of change that comes back on its own. A restored `<link>` or a
// `url(https://…)` is invisible in review — it is an addition, and additions
// look like improvements. Hence the test.
//
//   node scripts/test-bundled-fonts.test.js

"use strict";

const fs = require("fs");
const path = require("path");

const EXT = path.join(__dirname, "..", "clients", "brotto-extension");
const SRC = path.join(EXT, "src");
const ASSETS = path.join(SRC, "assets");

/** Everything that ends up in the panel and could carry a reference. */
const SCANNED = ["sidepanel.html", "welcome.html", "panel-tokens.css", "sidepanel.js"];

let failed = 0;
function check(ok, label, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  failed++;
  console.log(`FAIL  ${label}`);
  if (detail) console.log(`      ${detail}`);
}

const sources = SCANNED.map((f) => [f, fs.readFileSync(path.join(SRC, f), "utf8")]);

// ── No remote origin, anywhere a panel reads ─────────────────────────────────
//
// Scoped to the shipped sources, not dist/: dist is generated, and a
// regression there is a build bug, not a source bug.
console.log("\nno shipped source references a remote font origin");
for (const [file, src] of sources) {
  const remote = /https?:\/\/(?!localhost|127\.0\.0\.1)[^\s"'`)]*/g;
  const hits = [...new Set(src.match(remote) ?? [])].filter(
    (u) => u.includes("fonts.") || /\.woff2?|\.ttf|\.otf/i.test(u) || u.endsWith(".css"),
  );
  check(
    hits.length === 0,
    `${file} loads no remote font`,
    hits.length ? `found: ${hits.join(", ")}` : "",
  );
}

// ── Every @font-face src is a file that actually ships ───────────────────────
//
// The other half of the regression. Bundling the CSS rule while the woff2
// fails to copy into dist/ is a silent fallback to the system sans — the page
// looks fine in review and is typographically wrong in the product.
const css = fs.readFileSync(path.join(SRC, "panel-tokens.css"), "utf8");
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
console.log(`\nall ${faces.length} @font-face srcs resolve to a bundled file`);
for (const body of faces) {
  const url = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(body)?.[1];
  const name = /font-family:\s*['"]?([^;'"]+)/.exec(body)?.[1]?.trim() ?? "?";
  if (!url) {
    check(false, `${name}: has a src url`, "an @font-face with no url() renders nothing");
    continue;
  }
  check(
    !/^([a-z]+:)?\/\//i.test(url) && !url.startsWith("data:"),
    `${name}: ${url} is a local path`,
    "a remote or data url reopens the request this test exists to close",
  );
  check(
    fs.existsSync(path.join(SRC, url)),
    `${name}: ${url} exists`,
    "the CSS names a file that is not in src/, so dist/ cannot carry it",
  );
}

// ── The build must carry them, and the licence must ship ─────────────────────
//
// build.mjs copies src/assets by extension allowlist, so a bundled font that
// is not on the list leaves the build green and the panel fontless.
const build = fs.readFileSync(path.join(EXT, "build.mjs"), "utf8");
const allowlist = /\[([^\]]*)\]\.includes\(ext\)/.exec(build)?.[1] ?? "";
console.log("\nthe build copies the font files out");
for (const ext of ["woff2"]) {
  check(
    new RegExp(`["']${ext}["']`).test(allowlist),
    `build.mjs allowlist includes ${ext}`,
    "src/assets is copied by extension allowlist; a missing entry is a silent 404",
  );
}
check(
  fs.existsSync(path.join(ASSETS, "OFL.txt")),
  "the font licence ships alongside the fonts",
  "SIL OFL 1.1 requires the licence and copyright notice to accompany the fonts",
);

console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
