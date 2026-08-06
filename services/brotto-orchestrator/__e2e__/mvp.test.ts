import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { chromium, type Browser, type Page } from "playwright";
import { startOllama, isOllamaAvailable, type OllamaFixture } from "./fixtures/ollama.js";
import { captureObservation } from "./fixtures/playwright-observation.js";
import { startOrchestrator, type OrchestratorFixture } from "./fixtures/orchestrator.js";
import { MetricsCollector } from "./helpers/metrics.js";
import type { PlanningOutcome } from "../src/engine/types.js";
import type { ObservationV1 } from "@brotto/brotto-action-schema";

const TEST_URL = "https://the-internet.herokuapp.com/login";
const USERNAME = "tomsmith";
const PASSWORD = "SuperSecretPassword!";
const SUCCESS_TEXT = "Welcome to the Secure Area";
const MAX_STEPS = 10;

async function executeAction(page: Page, outcome: PlanningOutcome): Promise<void> {
  if (outcome.kind !== "action") return;
  const action = outcome.action;

  if (action.type === "left_click" && "x" in action && "y" in action) {
    await page.mouse.click(action.x, action.y);
    return;
  }
  if (action.type === "insert_text" && "text" in action) {
    // Focus the first input/textarea before typing
    await page.evaluate(() => {
      const el = document.querySelector("input, textarea") as HTMLElement | null;
      el?.focus();
    });
    await page.keyboard.type(action.text);
    return;
  }
  throw new Error(`Unsupported action: ${JSON.stringify(action)}`);
}

describe("MVP E2E (Ollama + Playwright)", () => {
  let ollama: OllamaFixture | null = null;
  let browser: Browser | null = null;
  let page: Page | null = null;
  let orch: OrchestratorFixture | null = null;
  const metrics = new MetricsCollector();

  beforeAll(async () => {
    if (!(await isOllamaAvailable())) {
      console.warn("[e2e] Ollama not available at 127.0.0.1:11434 — skipping E2E");
      return;
    }
    ollama = await startOllama();
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    orch = await startOrchestrator({ plannerConfig: { family: "openai-compatible", baseUrl: ollama.url, model: process.env.E2E_MODEL ?? "qwen2.5:3b" } as never, ollamaUrl: ollama.url });
  }, 120_000);

  afterAll(async () => {
    await orch?.stop();
    await browser?.close();
    await ollama?.cleanup();
    if (ollama) metrics.printSummary();
  });

  it("logs in to the-internet.herokuapp.com", async () => {
    if (!ollama || !browser || !page || !orch) {
      console.warn("[e2e] skipping — Ollama fixture not initialized");
      return;
    }
    const t0 = Date.now();
    await page.goto(TEST_URL, { waitUntil: "domcontentloaded" });

    let stepCount = 0;
    while (stepCount < MAX_STEPS) {
      const observation: ObservationV1 = await captureObservation(page);
      const outcome = await orch.planStep(observation);
      metrics.recordStep(Date.now() - t0, { prompt: 0, completion: 0 });

      if (outcome.kind === "completion") {
        const bodyText = (await page.textContent("body")) ?? "";
        expect(bodyText).toContain(SUCCESS_TEXT);
        metrics.printOnSuccess(stepCount);
        return;
      }

      await executeAction(page, outcome);
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      stepCount++;
    }
    throw new Error(`Did not complete task within ${MAX_STEPS} steps`);
  }, 120_000);
});
