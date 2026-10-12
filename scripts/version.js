#!/usr/bin/env node
// Read the places a version can live. Exit 1 if they disagree.
// Used by CI (a job runs this on every push) and by release.js (which writes
// the mirrors and then calls this to prove it worked).
//
// CommonJS on purpose: every other script in this directory is.
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ROOT = path.join(__dirname, "..");

function readVersions(root = DEFAULT_ROOT) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "clients/brotto-extension/manifest.json"), "utf8"));
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "clients/brotto-extension/package.json"), "utf8"));
  const pyproject = fs.readFileSync(path.join(root, "pyproject.toml"), "utf8");
  const pyMatch = /^version\s*=\s*"([^"]+)"/m.exec(pyproject);
  const pySrc = fs.readFileSync(
    path.join(root, "services/brotto-orchestrator/src/brotto_orchestrator/__version__.py"), "utf8");
  const pyConst = /__version__\s*=\s*"([^"]+)"/.exec(pySrc);
  return {
    manifest: manifest.version,
    pkg: pkg.version,
    pyproject: pyMatch ? pyMatch[1] : "",
    python: pyConst ? pyConst[1] : "",
  };
}

function checkVersions(root = DEFAULT_ROOT) {
  const values = readVersions(root);
  const entries = Object.entries(values);
  const [firstKey, firstVal] = entries[0];
  const mismatch = entries
    .filter(([, v]) => v !== firstVal)
    .map(([k, v]) => `${k}=${v} (want ${firstVal} from ${firstKey})`);
  return { ok: mismatch.length === 0 && Boolean(firstVal), values, mismatch };
}

// Paths whose change means "the shipped product moved". Everything else —
// docs, tests, CI config, these scripts — can land without a bump.
const SHIPPED_PATHS = [
  /^clients\/brotto-extension\/(src|public)\//,
  /^clients\/brotto-extension\/(manifest\.json|package\.json|build\.mjs)$/,
  /^services\/brotto-orchestrator\/src\//,
  /^pyproject\.toml$/,
  /^Dockerfile$/,
  /^Procfile$/,
  /^docker-compose\.yml$/,
];

function shippedChanged(files) {
  return files.filter((f) => SHIPPED_PATHS.some((re) => re.test(f)));
}

module.exports = { readVersions, checkVersions, shippedChanged, DEFAULT_ROOT };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const diffIdx = argv.indexOf("--shipped-diff");
  const root = (diffIdx === -1 ? argv[0] : argv.slice(0, diffIdx)[0]) || DEFAULT_ROOT;

  const { ok, values, mismatch } = checkVersions(root);
  for (const [k, v] of Object.entries(values)) console.log(`${k}=${v}`);
  if (!ok) {
    console.error(`mismatch: ${mismatch.join("; ")}`);
    process.exit(1);
  }

  if (diffIdx !== -1) {
    const base = argv[diffIdx + 1];
    if (!base) {
      console.error("--shipped-diff needs a base ref");
      process.exit(1);
    }
    const { execFileSync } = require("node:child_process");
    let files = [];
    try {
      files = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`],
        { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
    } catch {
      files = [];
    }
    const shipped = shippedChanged(files);
    const versionTouched = files.some((f) =>
      /manifest\.json$|package\.json$|pyproject\.toml$|__version__\.py$/.test(f));
    if (shipped.length > 0 && !versionTouched) {
      console.error("shipped code changed but no version bump:");
      for (const f of shipped) console.error(`  ${f}`);
      console.error("bump the version (node scripts/release.js patch) or revert the shipped change");
      process.exit(1);
    }
    console.log(shipped.length > 0
      ? `shipped: ${shipped.length} file(s), version bumped`
      : "shipped: no product code changed");
  }
}
