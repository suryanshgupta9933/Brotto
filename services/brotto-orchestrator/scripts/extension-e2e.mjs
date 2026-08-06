// ponytail: extension end-to-end test. Runs from the orchestrator package
// (which has playwright installed). Loads the built extension from
// clients/brotto-extension/dist into a real Chromium instance, opens the
// side panel, exercises Connect/Start/Stop/Refresh.
//
// Run: node scripts/extension-e2e.mjs (requires dist/ to be built first).

import { chromium } from "playwright";
import { resolve, join, dirname } from "node:path";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const EXT_DIST = join(REPO_ROOT, "clients", "brotto-extension", "dist");
const USER_DATA_DIR = join(__dirname, ".e2e-user-data");
const SCREENSHOT_DIR = join(__dirname, ".e2e-screenshots");

function loadManifest() {
  return JSON.parse(readFileSync(join(EXT_DIST, "manifest.json"), "utf8"));
}

async function main() {
  if (!existsSync(join(EXT_DIST, "background.js"))) {
    throw new Error(`dist/background.js missing at ${EXT_DIST} — run pnpm build in clients/brotto-extension first`);
  }
  rmSync(USER_DATA_DIR, { recursive: true, force: true });
  mkdirSync(USER_DATA_DIR, { recursive: true });
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log(`[e2e] launching chromium with extension from ${EXT_DIST}`);
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_DIST}`,
      `--load-extension=${EXT_DIST}`,
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--headless=new",
    ],
  });

  const consoleErrors = [];
  context.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
      console.log(`[console.error] ${msg.text()}`);
    }
  });

  // ponytail: extension service worker takes a moment to register. Wait
  // briefly, then continue regardless (UI tests don't depend on SW being ready).
  let sw = context.serviceWorkers()[0];
  for (let i = 0; i < 30 && !sw; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    sw = context.serviceWorkers()[0];
  }
  if (!sw) {
    throw new Error("Service worker did not register — extension failed to load");
  }
  console.log(`[e2e] service worker: ${sw.url()}`);

  // ponytail: extract extension id from the SW URL. Format is
  // chrome-extension://<id>/background.js
  const swMatch = sw.url().match(/^chrome-extension:\/\/([a-z]+)\//);
  if (!swMatch) {
    throw new Error(`Cannot parse extension id from SW URL: ${sw.url()}`);
  }
  const extId = swMatch[1];
  console.log(`[e2e] extension id: ${extId}`);

  const sidePanelUrl = `chrome-extension://${extId}/sidepanel.html`;
  console.log(`[e2e] opening side panel: ${sidePanelUrl}`);
  const panel = await context.newPage();
  const panelErrors = [];
  panel.on("console", (msg) => {
    if (msg.type() === "error") {
      panelErrors.push(msg.text());
      console.log(`[panel.error] ${msg.text()}`);
    }
  });
  panel.on("pageerror", (err) => {
    panelErrors.push(err.message);
    console.log(`[panel.pageerror] ${err.message}`);
  });
  await panel.goto(sidePanelUrl);
  await panel.waitForLoadState("domcontentloaded");
  await panel.waitForTimeout(500);

  const results = [];

  // 1. initial state
  const initialStatus = await panel.locator("#statusPill").textContent();
  results.push({ name: "initial status pill is Idle", pass: initialStatus?.toLowerCase().includes("idle") ?? false, detail: `got: ${initialStatus}` });
  const startDisabled = await panel.locator("#startBtn").isDisabled();
  results.push({ name: "start button disabled initially", pass: startDisabled });
  const connectEnabled = await panel.locator("#connectBtn").isEnabled();
  results.push({ name: "connect button enabled initially", pass: connectEnabled });

  // 2. Connect to non-existent planner — error path
  // ponytail: use an obviously closed port so the test passes regardless of
  // whether the demo-server is running locally.
  await panel.locator("#plannerUrl").fill("http://127.0.0.1:1");
  await panel.locator("#connectBtn").click();
  // ponytail: wait for connect to settle (either success or error). The
  // connectBtn gets re-enabled when phase is no longer 'connecting'.
  await panel.waitForFunction(() => {
    const btn = document.querySelector("#connectBtn");
    return btn !== null && !btn.disabled;
  }, { timeout: 5000 });
  const errorPill = await panel.locator("#statusPill").textContent();
  results.push({ name: "connect to bad URL surfaces error", pass: errorPill?.toLowerCase().includes("error") ?? false, detail: `got: ${errorPill}` });

  // 3. Click refresh — should reset
  await panel.locator("#refreshBtn").click();
  await panel.waitForTimeout(500);
  const afterRefresh = await panel.locator("#statusPill").textContent();
  results.push({
    name: "refresh resets pill to idle/connected",
    pass: !afterRefresh?.toLowerCase().includes("error"),
    detail: `got: ${afterRefresh}`,
  });

  // 4. Fill goal
  await panel.locator("#goal").fill("Open the page and report the title");
  const goalValue = await panel.locator("#goal").inputValue();
  results.push({ name: "goal input accepts text", pass: goalValue.includes("Open the page") });

  await panel.screenshot({ path: join(SCREENSHOT_DIR, "01-after-refresh.png"), fullPage: true });

  // 5. Try starting without a working planner
  await panel.locator("#startBtn").click();
  await panel.waitForTimeout(3000);
  const afterStart = await panel.locator("#statusPill").textContent();
  results.push({ name: "start with unreachable planner surfaces error", pass: afterStart?.toLowerCase().includes("error") ?? false, detail: `got: ${afterStart}` });
  await panel.screenshot({ path: join(SCREENSHOT_DIR, "02-after-bad-start.png"), fullPage: true });

  // ponytail: summary
  console.log("\n[e2e] === results ===");
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  if (panelErrors.length > 0) {
    console.log(`\n[e2e] ${panelErrors.length} panel console errors:`);
    for (const e of panelErrors) console.log(`  ${e}`);
  }
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.log(`\n[e2e] FAILED: ${failed.length} assertions failed`);
    process.exitCode = 1;
  } else {
    console.log(`\n[e2e] all assertions passed`);
  }

  await context.close();
  rmSync(USER_DATA_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  console.error("[e2e] crashed:", err);
  process.exit(1);
});
