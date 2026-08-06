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

  // ponytail: the redesigned UI hides the planner URL behind a Settings gear.
  // The extension auto-connects when the user sends a task — no separate
  // Connect button. Set planner URL via the settings panel.
  await sidePanel.locator("#settingsBtn").click();
  await sidePanel.waitForSelector("#settingsOverlay.open", { timeout: 3000 });
  await sidePanel.locator("#plannerUrlSetting").fill("http://127.0.0.1:3001");
  await sidePanel.locator("#settingsClose").click();
  console.log("[e2e-task] planner URL configured");

  // ponytail: send the task. sendUserMessage() auto-connects, then submits
  // via run_local_task. Connection + task kickoff happen in one shot.
  await sidePanel.locator("#goal").fill("Navigate to https://example.com and report the page title.");
  await sidePanel.locator("#sendBtn").click();

  // ponytail: poll the messages area for at most 60s. The redesigned UI
  // renders everything as chat bubbles inside #messages (replacing the
  // old #stream activity stream). We expect to see:
  //   - "Starting task" bubble (user message mirrored)
  //   - assistant bubbles showing each step
  //   - a final "Completed" or error bubble
  const seen = { messages: [], completed: false, errored: false };
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    const cards = await sidePanel.locator("#messages .message, #messages .bubble, #messages .plan-card, #messages > *").allTextContents();
    const newTexts = cards.filter((t) => t.trim().length > 0 && !seen.messages.includes(t));
    if (newTexts.length > 0) {
      for (const t of newTexts) {
        console.log(`[e2e-task] msg: ${t}`);
        seen.messages.push(t);
      }
    }
    const status = await sidePanel.locator("#statusPill").textContent().catch(() => "");
    if ((status ?? "").toLowerCase().includes("done")) seen.completed = true;
    if ((status ?? "").toLowerCase().includes("error")) seen.errored = true;
    // ponytail: also recognize the "Task completed" card text as success —
    // the status pill sometimes lags the actual completion event.
    if (seen.messages.some((t) => /Task completed/i.test(t))) seen.completed = true;
    if (seen.messages.some((t) => /loop crashed|task_failed|Error:/i.test(t))) seen.errored = true;
    if (seen.completed || seen.errored) break;
    await sidePanel.waitForTimeout(500);
  }

  console.log(`\n[e2e-task] === summary ===`);
  console.log(`  elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  messages seen: ${seen.messages.length}`);
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
  } else if (seen.messages.length < 3) {
    console.log(`[e2e-task] FAIL: only ${seen.messages.length} messages seen, expected at least 3 (start, step, done/error)`);
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
