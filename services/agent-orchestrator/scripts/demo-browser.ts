#!/usr/bin/env tsx
// Playwright headful demo driver.
// Uses the context-builder harness for stable element IDs, diff, and inline
// click coordinates. Model sees a structured tree, not a raw JSON dump.

import { chromium, type Browser, type Page } from "playwright";
import { snapshotPage, renderSnapshot, type PageSnapshot } from "./context-builder.js";
import type { PlanningOutcome } from "../src/engine/types.js";

const SERVER_URL = process.env.DEMO_SERVER ?? "http://127.0.0.1:3001";
const TARGET_URL = process.env.DEMO_TARGET_URL ?? "https://the-internet.herokuapp.com/login";
// ponytail: abstract goal. The harness provides page text + element details —
// the model must extract credentials from the page itself, not from the goal.
// That's how browser-use works in production: one short goal string, all
// concrete values come from the live page.
const GOAL = process.env.DEMO_GOAL ?? "Log in to the site. The page tells you what credentials to use. Stop when you see a 'Welcome' or 'Secure Area' indicator.";
const MAX_STEPS = Number(process.env.DEMO_MAX_STEPS ?? "15");
const HEADLESS = process.env.DEMO_HEADLESS !== "1";

async function plan(renderedContext: string): Promise<PlanningOutcome> {
  const res = await fetch(`${SERVER_URL}/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workId: "demo-" + Date.now(),
      sessionId: "00000000-0000-4000-8000-000000000001",
      taskId: "00000000-0000-4000-8000-000000000002",
      goal: GOAL,
      completionCriteria: ["Welcome to the Secure Area visible in page text"],
      context: renderedContext,
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
        await page.keyboard.type(action.text, { delay: 35 });
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
    case "terminate": {
      console.log(`  → terminate (model says done)`);
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
  let prev: PageSnapshot | null = null;
  let stepCount = 0;
  while (stepCount < MAX_STEPS) {
    console.log(`\n[demo-browser] step ${stepCount + 1}/${MAX_STEPS}`);
    const snap = await snapshotPage(page);
    const rendered = renderSnapshot(snap, prev);
    if (process.env.DEMO_VERBOSE === "1") {
      console.log("---- context ----");
      console.log(rendered);
      console.log("-----------------");
    }

    const outcome = await plan(rendered);
    if (outcome.kind === "action") {
      const a = (outcome as { action: { type?: string; x?: number; y?: number; text?: string; key?: string } }).action;
      console.log(`  action: type=${a.type} ${a.x !== undefined ? `at (${a.x}, ${a.y})` : ""} ${a.text ? `text="${a.text.slice(0, 40)}"` : ""} ${a.key ? `key="${a.key}"` : ""}`);
    } else if (outcome.kind === "question") {
      console.log(`  question: "${(outcome as { question: string }).question}"`);
    } else if (outcome.kind === "completion") {
      const summary = (outcome as { summary?: string }).summary ?? "";
      const bodyText = (await page.textContent("body")) ?? "";
      const success = bodyText.includes("Welcome to the Secure Area");
      console.log(`[demo-browser] completion: "${summary}"`);
      console.log(`[demo-browser] success=${success}`);
      console.log(`[demo-browser] total time ${Date.now() - t0}ms, ${stepCount + 1} steps`);
      await browser.close();
      process.exit(success ? 0 : 1);
    } else {
      console.log(`  outcome: kind=${outcome.kind}`);
    }

    await executeAction(page, outcome);
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    prev = snap;
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
