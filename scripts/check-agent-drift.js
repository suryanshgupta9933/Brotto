#!/usr/bin/env node
// Drift check for `.claude/agents/*.md`.
//
// An agent file is only useful while its map of the code is true. A file path that
// moved, or a line count that has drifted past 15%, means the agent is confidently
// wrong — which is worse than no agent at all. This fails loudly and names both.
//
// Run from the repo root: `node scripts/check-agent-drift.js`
//
// LOCAL ONLY. `.claude/` is gitignored by owner choice, so a CI runner checks out
// no agent files and this would pass vacuously. It ships because the tool is
// useful on the machine the fleet actually runs on; wiring it into `ci.yml` would
// be a green check that proves nothing.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const AGENT_DIR = path.join(ROOT, ".claude", "agents");

// Only these roots are checked. A mention of `logs/sessions/` or `/data/sessions`
// is a runtime path, not a repo file, and checking it would fail on correct prose.
const ROOTS = [
  "docs/", "clients/", "services/", "scripts/", ".github/", "model/", "agent/",
  "session/", "cdp/", "policy/", "dev/", "domain/", "harness/", "testing/", "tests/",
];
const ROOT_FILES = [
  "main.py", "CLAUDE.md", "CLAUDE.md.full", "PRIVACY.md", "README.md",
  "ROADMAP.md", "CONTRIBUTING.md", "SECURITY.md", "Procfile",
  "docker-compose.yml", "Dockerfile", ".gitignore", ".dockerignore",
];

// Search order. The orchestrator package comes FIRST on purpose: `main.py` at the
// repo root is a 56-line shim, and every agent file means the 1648-line one. A
// root-first resolver would silently check the wrong file and pass.
const PREFIXES = [
  "services/brotto-orchestrator/src/brotto_orchestrator/",
  "services/brotto-orchestrator/",
  "clients/brotto-extension/",
  "",
];

const TOLERANCE = 0.15; // widen when the check rots, not to hide rot.

const failures = [];
const fail = (file, msg) => failures.push(`${file}: ${msg}`);

const exists = (rel) => PREFIXES.some((p) => fs.existsSync(path.join(ROOT, p, rel)));

function resolve(rel) {
  for (const p of PREFIXES) {
    const abs = path.join(ROOT, p, rel);
    if (fs.existsSync(abs) && !fs.statSync(abs).isDirectory()) return abs;
  }
  return null;
}

function countLines(rel) {
  const abs = resolve(rel);
  return abs === null ? null : fs.readFileSync(abs, "utf8").split("\n").length - 1;
}

// A repo path is anything under a known root, or a known root file. Trailing
// punctuation and `:NN` suffixes are stripped by the callers below.
function isRepoPath(token) {
  const clean = token.replace(/[:/]\d+$/, "").replace(/[.,;:)]+$/, "");
  if (clean.includes("*") || clean.includes("://") || clean.includes("…")) return false;
  if (ROOTS.some((r) => clean.startsWith(r))) return true;
  return ROOT_FILES.includes(clean);
}

// Every backticked token, plus bare `docs/architecture/*.md` mentions in prose.
function repoPathsIn(text) {
  const found = new Set();
  const tokens = text.match(/`[^`\n]+`/g) || [];
  for (const raw of tokens) {
    const token = raw.slice(1, -1).trim();
    // A bare code token like `harness.py:2174` is a basename, checked separately.
    if (isRepoPath(token)) found.add(token.replace(/[:/]\d+$/, ""));
  }
  for (const m of text.match(/\bdocs\/architecture\/[\w-]+\.md/g) || []) found.add(m);
  return found;
}

function checkAgent(name, body) {
  const paths = repoPathsIn(body);

  for (const p of paths) {
    if (!exists(p)) fail(name, `file does not exist: ${p}`);
  }

  // Line counts: "<path> — N lines", "N lines" beside a path, or a table row.
  const lines = body.split("\n");
  lines.forEach((line, i) => {
    const inline = /`([^`]+?)`\s*(?:—|--|-)?\s*(\d+)\s+lines/.exec(line);
    const tableRow = /^\|\s*`([^`]+?)`\s*\|\s*(\d+)\s*\|/.exec(line);
    const bare = /(\d+)\s+lines/.exec(line);

    let target = null;
    let count = null;
    if (tableRow) {
      target = tableRow[1];
      count = Number(tableRow[2]);
    } else if (inline) {
      target = inline[1];
      count = Number(inline[2]);
    } else if (bare) {
      // "the nine `docs/architecture/*.md` files (agent-loop 1313, ...)" style:
      // only trust it when the same line names a path we already resolved.
      count = Number(bare[1]);
      target = paths.size === 1 ? [...paths][0] : null;
    }
    if (!target || !count) return;

    const rel = target.replace(/[:/]\d+$/, "");
    if (!isRepoPath(rel)) return;
    if (!exists(rel)) return; // already reported as a dead path
    const actual = countLines(rel);
    if (actual === null) return;
    const drift = Math.abs(actual - count) / count;
    if (drift > TOLERANCE) {
      fail(
        name,
        `line count drifted: ${rel} recorded ${count}, actual ${actual} ` +
          `(${Math.round(drift * 100)}% > ${Math.round(TOLERANCE * 100)}%) — line ${i + 1}`
      );
    }
  });
}

// ─── run ────────────────────────────────────────────────────────────────────

if (!fs.existsSync(AGENT_DIR)) {
  console.error(`no agent directory at ${path.relative(ROOT, AGENT_DIR)}`);
  process.exit(1);
}

const files = fs.readdirSync(AGENT_DIR).filter((f) => f.endsWith(".md")).sort();
if (files.length === 0) {
  console.error("no agent files found in .claude/agents/");
  process.exit(1);
}

for (const file of files) {
  checkAgent(file, fs.readFileSync(path.join(AGENT_DIR, file), "utf8"));
}

if (failures.length) {
  console.error(`agent drift — ${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    "\nAn agent that names a file that moved or a count that drifted is confidently\n" +
      "wrong. Fix the agent in the same commit as whatever made it stale."
  );
  process.exit(1);
}

console.log(`agent drift: ${files.length} agents, no dead paths, no drifted counts`);