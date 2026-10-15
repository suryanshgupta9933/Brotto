// Tests the real script against real fixtures — a guard tested against a
// mock is a guard that has never run.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "version.js");

function fixture({ manifest = "0.2.0", pkg = "0.2.0", pyproject = "0.2.0", python = "0.2.0" }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brotto-version-"));
  fs.mkdirSync(path.join(dir, "clients/brotto-extension"), { recursive: true });
  fs.mkdirSync(path.join(dir, "services/brotto-orchestrator/src/brotto_orchestrator"), { recursive: true });
  fs.writeFileSync(path.join(dir, "clients/brotto-extension/manifest.json"),
    JSON.stringify({ manifest_version: 3, version: manifest }));
  fs.writeFileSync(path.join(dir, "clients/brotto-extension/package.json"),
    JSON.stringify({ name: "x", version: pkg }));
  fs.writeFileSync(path.join(dir, "pyproject.toml"),
    `[project]\nname = "brotto-orchestrator"\nversion = "${pyproject}"\n`);
  fs.writeFileSync(
    path.join(dir, "services/brotto-orchestrator/src/brotto_orchestrator/__version__.py"),
    `__version__ = "${python}"\n`);
  return dir;
}

function run(dir) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: String(err.stdout || "") + String(err.stderr || "") };
  }
}

test("all four mirrors agree → exit 0", () => {
  const dir = fixture({});
  try {
    const r = run(dir);
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /0\.2\.0/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("one mirror disagrees → exit 1 and names it", () => {
  const dir = fixture({ pyproject: "0.1.9" });
  try {
    const r = run(dir);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /pyproject/);
    assert.match(r.stdout, /mismatch/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("real repo agrees", () => {
  const r = run(ROOT);
  assert.equal(r.code, 0, r.stdout);
});

test("version.js exports readVersions and checkVersions", () => {
  const mod = require(SCRIPT);
  assert.equal(typeof mod.checkVersions, "function");
  assert.equal(typeof mod.readVersions, "function");
  const v = mod.readVersions(ROOT);
  assert.equal(v.manifest, v.pkg);
  assert.equal(v.manifest, v.pyproject);
  assert.equal(v.manifest, v.python);
});
