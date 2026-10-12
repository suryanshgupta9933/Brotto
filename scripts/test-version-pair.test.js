const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const bg = fs.readFileSync(path.join(ROOT, "clients/brotto-extension/src/background.ts"), "utf8");
const panel = fs.readFileSync(path.join(ROOT, "clients/brotto-extension/src/sidepanel.js"), "utf8");

test("task_start carries ext_version from the manifest", () => {
  const i = bg.indexOf('type: "task_start"');
  assert.ok(i !== -1, "task_start payload not found");
  const slice = bg.slice(i, i + 800);
  assert.match(slice, /ext_version/);
  assert.match(slice, /getManifest\(\)\.version/);
});

test("panel composes ext and relay into the connection title", () => {
  assert.match(panel, /state\.relayVersion/);
  assert.match(panel, /ext /);
  assert.match(panel, /relay /);
  assert.match(panel, /Connection: /);
});

test("/health body is read for version as well as auth_mode", () => {
  assert.match(panel, /body\.version/);
});
