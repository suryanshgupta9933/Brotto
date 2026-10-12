#!/usr/bin/env node
// Bump the one product version and cut the tag that marks it.
//
//   node scripts/release.js patch     # 0.2.0 -> 0.2.1
//   node scripts/release.js minor     # 0.2.0 -> 0.3.0   (breaking protocol)
//   node scripts/release.js major     # 0.2.0 -> 1.0.0   (public launch)
//   node scripts/release.js 0.3.0     # explicit
//
// Writes every mirror, verifies, commits, tags, writes notes. Then stops.
// Pushing, merging, and the store are separate human acts.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { readVersions } = require("./version.js");

const ROOT = path.join(__dirname, "..");

function bump(v, kind) {
  const parts = v.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`cannot bump non-semver version ${v}`);
  }
  if (kind === "patch") parts[2] += 1;
  else if (kind === "minor") { parts[1] += 1; parts[2] = 0; }
  else if (kind === "major") { parts[0] += 1; parts[1] = 0; parts[2] = 0; }
  else throw new Error(`unknown bump ${kind}`);
  return parts.join(".");
}

function writeVersion(root, v) {
  const manPath = path.join(root, "clients/brotto-extension/manifest.json");
  const man = JSON.parse(fs.readFileSync(manPath, "utf8"));
  man.version = v;
  fs.writeFileSync(manPath, JSON.stringify(man, null, 2) + "\n");

  const pkgPath = path.join(root, "clients/brotto-extension/package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.version = v;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  const pyPath = path.join(root, "pyproject.toml");
  fs.writeFileSync(pyPath, fs.readFileSync(pyPath, "utf8")
    .replace(/^version\s*=\s*"[^"]+"/m, `version = "${v}"`));

  fs.writeFileSync(
    path.join(root, "services/brotto-orchestrator/src/brotto_orchestrator/__version__.py"),
    '"""The one product version. manifest.json is authoritative; this is a mirror.\n\n' +
    "Written by scripts/release.js. Read by main.py. Never hand-edited to\n" +
    '"catch up" — if this disagrees with manifest.json, scripts/version.js\n' +
    'fails the build, and that is the point.\n"""\n\n' +
    `__version__ = "${v}"\n`);
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/release.js <patch|minor|major|x.y.z>");
  process.exit(1);
}

const current = readVersions(ROOT).manifest;
const next = /^\d+\.\d+\.\d+$/.test(arg) ? arg : bump(current, arg);
if (next === current) {
  console.error(`version is already ${current}`);
  process.exit(1);
}

writeVersion(ROOT, next);
execFileSync(process.execPath, [path.join(ROOT, "scripts", "version.js"), ROOT], { stdio: "inherit" });

// Notes come from git, never from memory.
let since = "";
try {
  since = git(["describe", "--tags", "--abbrev=0"]).replace(/^v/, "");
} catch {
  since = "";
}
const range = since ? `v${since}..HEAD` : "HEAD";
const log = git(["log", "--oneline", range]).trim() || "(no commits in range)";
const notesPath = `/tmp/brotto-release-${next}.md`;
fs.writeFileSync(notesPath, `# Brotto v${next}\n\n${log}\n`);

git(["add",
  "clients/brotto-extension/manifest.json",
  "clients/brotto-extension/package.json",
  "pyproject.toml",
  "services/brotto-orchestrator/src/brotto_orchestrator/__version__.py",
]);
git(["commit", "-m", `Release v${next}`]);
git(["tag", `v${next}`, "-m", `v${next}`]);

console.log(`\n  version  ${current} -> ${next}`);
console.log(`  tag      v${next}`);
console.log(`  notes    ${notesPath}`);
console.log("\nNext, by hand:");
console.log("  git push origin HEAD --follow-tags");
console.log("  # merge the PR, then push the tag: git push origin v" + next);
console.log("  # pushing the tag fires CD. CWS publish and the Heroku approve are still yours.");
