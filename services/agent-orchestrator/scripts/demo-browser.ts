#!/usr/bin/env tsx
// Playwright headful demo driver.
// Launches a visible Chrome window, runs a real task against a real website,
// captures observation, sends to demo-server, executes returned action, loops.
// You watch Chrome take actions in real time.

import { chromium, type Browser, type Page } from "playwright";
import { captureObservation } from "../__e2e__/fixtures/playwright-observation.js";
import type { PlanningOutcome } from "../src/engine/types.js";

const SERVER_URL = process.env.DEMO_SERVER ?? "http://127.0.0.1:3001";
const TARGET_URL = process.env.DEMO_TARGET_URL ?? "https://the-internet.herokuapp.com/login";
const GOAL = process.env.DEMO_GOAL ?? "Log in with username 'tomsmith' and password 'SuperSecretPassword!' and verify the page contains 'Welcome to the Secure Area'";
const MAX_STEPS = Number(process.env.DEMO_MAX_STEPS ?? "10");
const HEADLESS = process.env.DEMO_HEADLESS !== "1";

async function plan(observation: unknown): Promise<PlanningOutcome> {
  const res = await fetch(`${SERVER_URL}/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workId: "demo-" + Date.now(),
      sessionId: "00000000-0000-4000-8000-000000000001",
      taskId: "00000000-0000-4000-8000-000000000002",
      goal: GOAL,
      completionCriteria: ["Welcome to the Secure Area visible"],
      observation,
      recentResults: [],
      trajectory: [],
    }),
  });
  if (!res.ok) throw new Error(`plan failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<PlanningOutcome>;
}

async function executeAction(page: Page, outcome: PlanningOutcome): Promise<void> {
  if (outcome.kind !== "action") return;
  const action = outcome.action as { type?: string; x?: number; y?: number; text?: string; key?: string; url?: string };

  switch (action.type) {
    case "left_click":
    case "double_click":
    case "right_click":
    case "mouse_move": {
      if (typeof action.x === "number" && typeof action.y === "number") {
        console.log(`  → ${action.type} at (${action.x}, ${action.y})`);
        if (action.type === "left_click") await page.mouse.click(action.x, action.y);
        else if (action.type === "double_click") await page.mouse.dblclick(action.x, action.y);
        else if (action.type === "right_click") await page.mouse.click(action.x, action.y, { button: "right" });
        else await page.mouse.move(action.x, action.y);
      }
      break;
    }
    case "insert_text": {
      if (typeof action.text === "string") {
        console.log(`  → insert_text "${action.text.slice(0, 40)}${action.text.length > 40 ? "…" : ""}"`);
        await page.keyboard.type(action.text);
      }
      break;
    }
    case "key": {
      if (typeof action.key === "string") {
        console.log(`  → key "${action.key}"`);
        await page.keyboard.press(action.key);
      }
      break;
    }
    case "visit_url": {
      if (typeof action.url === "string") {
        console.log(`  → visit_url ${action.url}`);
        await page.goto(action.url);
      }
      break;
    }
    case "scroll": {
      const a = action as { deltaX?: number; deltaY?: number };
      console.log(`  → scroll dx=${a.deltaX ?? 0} dy=${a.deltaY ?? 0}`);
      await page.mouse.wheel(a.deltaX ?? 0, a.deltaY ?? 0);
      break;
    }
    case "wait": {
      const a = action as { durationMs?: number };
      console.log(`  → wait ${a.durationMs ?? 1000}ms`);
      await page.waitForTimeout(a.durationMs ?? 1000);
      break;
    }
    case "screenshot": {
      console.log(`  → screenshot (skipped in demo)`);
      break;
    }
    default:
      console.log(`  → ${action.type ?? "unknown"} (no executor, skipping)`);
  }
}

async function main() {
  console.log(`[demo-browser] connecting to ${SERVER_URL}`);
  const healthRes = await fetch(`${SERVER_URL}/health`);
  if (!healthRes.ok) {
    console.error(`[demo-browser] server not reachable: ${healthRes.status}`);
    process.exit(1);
  }
  const health = await healthRes.json() as { family: string; model: string };
  console.log(`[demo-browser] server: family=${health.family} model=${health.model}`);

  console.log(`[demo-browser] launching ${HEADLESS ? "headless" : "visible"} chromium`);
  const browser: Browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  console.log(`[demo-browser] navigating to ${TARGET_URL}`);
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

  const t0 = Date.now();
  let stepCount = 0;
  while (stepCount < MAX_STEPS) {
    console.log(`\n[demo-browser] step ${stepCount + 1}/${MAX_STEPS}`);
    const observation = await captureObservation(page);
    console.log(`  observed: url=${observation.url} title=${observation.title} targets=${observation.semanticTargets.length} ax=${observation.accessibilityNodes?.length ?? 0}`);

    const outcome = await plan(observation);
    console.log(`  outcome: kind=${outcome.kind} action.type=${(outcome as { action?: { type?: string } }).action?.type ?? "n/a"}`);

    if (outcome.kind === "completion") {
      const summary = (outcome as { summary?: string }).summary ?? "";
      const bodyText = (await page.textContent("body")) ?? "";
      const success = bodyText.includes("Welcome to the Secure Area");
      console.log(`[demo-browser] completion: "${summary}"`);
      console.log(`[demo-browser] success=${success}`);
      console.log(`[demo-browser] total time ${Date.now() - t0}ms, ${stepCount + 1} steps`);
      await browser.close();
      process.exit(success ? 0 : 1);
    }

    await executeAction(page, outcome);
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    stepCount++;
  }

  console.log(`[demo-browser] did not complete in ${MAX_STEPS} steps`);
  await browser.close();
  process.exit(1);
}

main().catch((err) => {
  console.error("[demo-browser] failed:", err);
  process.exit(1);
});
