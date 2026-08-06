// ponytail: end-to-end task test. Loads extension, starts a real task
// against demo-server, observes the loop progress. Verifies the loop
// actually executes steps (not just opens a tab and hangs).

import { chromium } from "playwright";
import { resolve, join, dirname } from "node:path";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const EXT_DIST = join(REPO_ROOT, "clients", "brotto-extension", "dist");
const USER_DATA_DIR = join(__dirname, ".e2e-task-user-data");

async function main() {
  if (!existsSync(join(EXT_DIST, "background.js"))) {
    throw new Error(`dist/background.js missing — run pnpm build in clients/brotto-extension first`);
  }
  rmSync(USER_DATA_DIR, { recursive: true, force: true });
  mkdirSync(USER_DATA_DIR, { recursive: true });

  console.log(`[e2e-task] launching chromium with extension`);
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

  let sw = context.serviceWorkers()[0];
  for (let i = 0; i < 30 && !sw; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    sw = context.serviceWorkers()[0];
  }
  if (!sw) throw new Error("service worker did not register");
  const extId = sw.url().match(/^chrome-extension:\/\/([a-z]+)\//)[1];
  console.log(`[e2e-task] extension id: ${extId}`);

  // ponytail: capture all console errors from both SW and side panel.
  const errors = [];
  context.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(`[sw.error] ${msg.text()}`);
      console.log(`[sw.error] ${msg.text()}`);
    }
  });

  const sidePanel = await context.newPage();
  sidePanel.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(`[panel.error] ${msg.text()}`);
      console.log(`[panel.error] ${msg.text()}`);
    }
  });
  sidePanel.on("pageerror", (err) => {
    errors.push(`[panel.pageerror] ${err.message}`);
    console.log(`[panel.pageerror] ${err.message}`);
  });

  await sidePanel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await sidePanel.waitForLoadState("domcontentloaded");
  await sidePanel.waitForTimeout(500);

  // connect to the demo-server (which is running on the host's :3001 — playwright
  // host network is reachable from the extension context).
  await sidePanel.locator("#plannerUrl").fill("http://127.0.0.1:3001");
  await sidePanel.locator("#connectBtn").click();
  await sidePanel.waitForFunction(() => {
    const pill = document.querySelector("#statusPill");
    return pill && (pill.textContent ?? "").toLowerCase().includes("connected");
  }, { timeout: 5000 });
  console.log("[e2e-task] connected to planner");

  // run a real task against a real test page (data: URL so it loads instantly)
  await sidePanel.locator("#goal").fill("Navigate to https://example.com and report the page title.");
  await sidePanel.locator("#startingUrl").fill("https://example.com");
  await sidePanel.locator("#startBtn").click();

  // ponytail: poll the activity stream for at most 45s. We expect to see:
  //   - "opening new tab" log
  //   - step 1/12, step 2/12, etc.
  //   - a final "task_completed" or "task_failed" card
  const seen = { logs: [], completed: false, errored: false };
  const t0 = Date.now();
  while (Date.now() - t0 < 45_000) {
    const cards = await sidePanel.locator("#stream .card").allTextContents();
    const newLogs = cards.filter((t) => !seen.logs.includes(t));
    if (newLogs.length > 0) {
      for (const t of newLogs) {
        console.log(`[e2e-task] card: ${t.slice(0, 80)}`);
        seen.logs.push(t);
      }
    }
    // check for completion or error
    const status = await sidePanel.locator("#statusPill").textContent();
    if ((status ?? "").toLowerCase().includes("done")) seen.completed = true;
    if ((status ?? "").toLowerCase().includes("error")) seen.errored = true;
    if (seen.completed || seen.errored) break;
    await sidePanel.waitForTimeout(500);
  }

  console.log(`\n[e2e-task] === summary ===`);
  console.log(`  elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  cards seen: ${seen.logs.length}`);
  console.log(`  completed: ${seen.completed}`);
  console.log(`  errored: ${seen.errored}`);
  console.log(`  console errors: ${errors.length}`);
  if (errors.length > 0) {
    for (const e of errors) console.log(`    ${e}`);
  }

  await sidePanel.screenshot({ path: join(__dirname, ".e2e-task-screenshot.png"), fullPage: true });

  if (!seen.completed && !seen.errored) {
    console.log("[e2e-task] FAIL: loop did not complete or error within 45s");
    process.exitCode = 1;
  } else if (seen.logs.length < 3) {
    console.log(`[e2e-task] FAIL: only ${seen.logs.length} cards seen, expected at least 3 (start, step, done/error)`);
    process.exitCode = 1;
  } else {
    console.log("[e2e-task] PASS");
  }

  await context.close();
  rmSync(USER_DATA_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  console.error("[e2e-task] crashed:", err);
  process.exit(1);
});
