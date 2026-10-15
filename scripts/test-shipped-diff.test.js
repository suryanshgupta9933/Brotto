const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "version.js");
const { shippedChanged } = require(SCRIPT);

function git(dir, args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function repoWith(commits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brotto-shipped-"));
  fs.mkdirSync(path.join(dir, "clients/brotto-extension/src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "services/brotto-orchestrator/src/brotto_orchestrator"), { recursive: true });
  fs.writeFileSync(path.join(dir, "clients/brotto-extension/manifest.json"),
    JSON.stringify({ manifest_version: 3, version: "0.2.0" }));
  fs.writeFileSync(path.join(dir, "clients/brotto-extension/package.json"),
    JSON.stringify({ name: "x", version: "0.2.0" }));
  fs.writeFileSync(path.join(dir, "pyproject.toml"),
    `[project]\nname = "brotto-orchestrator"\nversion = "0.2.0"\n`);
  fs.writeFileSync(
    path.join(dir, "services/brotto-orchestrator/src/brotto_orchestrator/__version__.py"),
    `__version__ = "0.2.0"\n`);
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-qm", "base"]);
  for (const fn of commits) fn(dir);
  return dir;
}

function runDiff(dir, base = "HEAD~1") {
  try {
    const stdout = execFileSync(process.execPath,
      [SCRIPT, dir, "--shipped-diff", base], { encoding: "utf8" });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: String(err.stdout || "") + String(err.stderr || "") };
  }
}

test("shippedChanged classifies by path", () => {
  assert.deepEqual(shippedChanged(["README.md", "docs/a.md"]), []);
  assert.deepEqual(shippedChanged(["clients/brotto-extension/src/background.ts"]),
    ["clients/brotto-extension/src/background.ts"]);
  assert.deepEqual(shippedChanged(["services/brotto-orchestrator/src/brotto_orchestrator/main.py"]),
    ["services/brotto-orchestrator/src/brotto_orchestrator/main.py"]);
  assert.deepEqual(shippedChanged(["scripts/version.js"]), []);
  assert.deepEqual(shippedChanged(["requirements.txt"]), ["requirements.txt"]);
  assert.deepEqual(shippedChanged(["requirements-dev.txt"]), []);
});

test("shipped change with no bump → exit 1", () => {
  const dir = repoWith([(d) => {
    fs.writeFileSync(path.join(d, "clients/brotto-extension/src/background.ts"), "// touched\n");
    git(d, ["add", "."]);
    git(d, ["commit", "-qm", "touch shipped code"]);
  }]);
  try {
    const r = runDiff(dir);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /no version bump/i);
    assert.match(r.stdout, /background\.ts/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("shipped change with a bump → exit 0", () => {
  const dir = repoWith([(d) => {
    fs.writeFileSync(path.join(d, "clients/brotto-extension/src/background.ts"), "// touched\n");
    fs.writeFileSync(path.join(d, "clients/brotto-extension/manifest.json"),
      JSON.stringify({ manifest_version: 3, version: "0.2.1" }));
    fs.writeFileSync(path.join(d, "clients/brotto-extension/package.json"),
      JSON.stringify({ name: "x", version: "0.2.1" }));
    fs.writeFileSync(path.join(d, "pyproject.toml"),
      `[project]\nname = "brotto-orchestrator"\nversion = "0.2.1"\n`);
    fs.writeFileSync(
      path.join(d, "services/brotto-orchestrator/src/brotto_orchestrator/__version__.py"),
      `__version__ = "0.2.1"\n`);
    git(d, ["add", "."]);
    git(d, ["commit", "-qm", "touch and bump"]);
  }]);
  try {
    const r = runDiff(dir);
    assert.equal(r.code, 0, r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("docs-only change with no bump → exit 0", () => {
  const dir = repoWith([(d) => {
    fs.writeFileSync(path.join(d, "README.md"), "# docs only\n");
    git(d, ["add", "."]);
    git(d, ["commit", "-qm", "docs"]);
  }]);
  try {
    const r = runDiff(dir);
    assert.equal(r.code, 0, r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("missing base ref → exit 1, not a silent pass", () => {
  const dir = repoWith([]);
  try {
    const r = runDiff(dir, "no-such-ref");
    assert.equal(r.code, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
