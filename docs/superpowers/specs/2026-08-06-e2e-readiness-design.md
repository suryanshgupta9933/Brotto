# E2E Readiness Design

**Date:** 2026-08-06
**Status:** Draft for review
**Scope:** Wire the new planner into the active orchestrator path; build validation; one real-task E2E with Ollama + Playwright + headless Chrome. No postgres, no redis, no extension relay.

## Goal

Prove the MVP loop works end-to-end on a real task: headless Chrome → orchestrator → local Ollama → action proposal → Playwright executes. Capture performance metrics (latency, tokens, steps).

## Non-Goals

- Postgres / redis (orchestrator runs in-memory)
- Browser extension (Playwright simulates what the extension would observe)
- Multiple real tasks (one is enough to prove the architecture)
- Cross-browser (Chromium only)
- 9B / 27B model (3B is enough; faster, less RAM)

## Architecture

```
[Test fixture: the-internet.herokuapp.com/login]
   ↓ Playwright opens page, captures DOM + AX
[Observation builder]
   ↓ PlanningInput
[Orchestrator planner.plan()]
   ↓ SSE POST
[Local Ollama (qwen2.5:3b)]
   ↓ tool_calls: [{browser_action: type}, {browser_action: click}, {browser_action: click}, {finish: "logged in"}]
[Action validator + Playwright executor]
   ↓ page.type("#username", ...), page.click(...)
[Re-observe, loop]
   ↓
[Verifier: "Welcome to the Secure Area" visible → task complete]
```

**Real task chosen:** Open `https://the-internet.herokuapp.com/login`, fill `#username` with `tomsmith`, fill `#password` with `SuperSecretPassword!`, click the submit button, verify page contains "Welcome to the Secure Area". ~10s expected.

## Module Layout

```
services/agent-orchestrator/
├── src/
│   ├── server.ts                       MODIFY — wire planner into plan()
│   └── ...
├── scripts/
│   └── smoke.ts                        NEW — local Ollama smoke (~80 lines)
├── __e2e__/
│   ├── mvp.test.ts                     NEW — real Ollama + Playwright (~280 lines)
│   ├── fixtures/
│   │   ├── ollama.ts                   NEW — start/stop Ollama subprocess (~60 lines)
│   │   └── playwright-observation.ts   NEW — capture observation via Playwright (~80 lines)
│   └── helpers/
│       └── metrics.ts                  NEW — perf metrics (~40 lines)
├── package.json                        MODIFY — add e2e script + playwright dev dep
└── README.md                           MODIFY — "Run with Ollama" section

clients/browser-extension/
├── scripts/
│   └── build-extension.sh              NEW — package as .zip for Chrome load
└── README.md                           MODIFY — manual install steps

.github/
├── workflows/
│   ├── build.yml                       NEW — basic build + unit tests (~50 lines)
│   └── e2e.yml                         NEW — Ollama + Playwright E2E (~80 lines)
```

## Components

### 1. `services/agent-orchestrator/src/server.ts` — wire planner

Refactor `plan()` method (around line 285):

Before:
```typescript
const result = await this.resilient.execute(
  'inference',
  async () =>
    this.inference.infer([{role:'system',content:systemMessage}, {role:'user',content:userMessage}], {...})
);
```

After:
```typescript
const planningInput: PlanningInput = {
  workId: this.session.id,
  sessionId: this.session.id as SessionId,
  taskId: this.taskId as TaskId,
  goal: this.session.getContext().goal,
  completionCriteria: this.session.getContext().completionCriteria ?? [],
  observation: this.buildObservation(),
  recentResults: this.history.getRecentResults(),
  trajectory: this.history.getTrajectory(),
};
const outcome = await this.resilient.execute(
  'inference',
  async () => this.planner.plan(planningInput, this.abortController.signal),
);
```

Add `buildObservation(): ObservationV1` method — converts internal state into the schema shape. Fara path and OpenAI path now share this code.

`inference: LegacyInferenceConfig` becomes optional with `plannerConfig: InferenceConfig` required. Server boot fails fast if neither is set. Migration: `plannerConfig` derives from `inferFamilyFromEnv()` plus env-driven config.

### 2. `services/agent-orchestrator/scripts/smoke.ts` — local smoke (~80 lines)

```typescript
import { createPlanner, inferFamilyFromEnv } from "../dist/inference-registry.js";
import type { PlanningInput } from "../dist/engine/types.js";

const family = inferFamilyFromEnv();
const config = buildConfigFromEnv(family);  // reads OLLAMA_HOST, OPENAI_API_KEY, etc.
const planner = createPlanner(config);

const sampleObservation = buildSampleObservation();  // canned ObservationV1
const sampleInput: PlanningInput = { /* ... */ };

const start = Date.now();
const outcome = await planner.plan(sampleInput, new AbortController().signal);
const elapsed = Date.now() - start;
console.log(`Planner responded in ${elapsed}ms:`, JSON.stringify(outcome, null, 2));
```

Run: `pnpm smoke` after `pnpm build`. Asserts the planner responds to a canned observation; doesn't verify correctness.

### 3. `services/agent-orchestrator/__e2e__/fixtures/ollama.ts` — Ollama lifecycle

```typescript
export async function startOllama(): Promise<{ url: string; cleanup: () => Promise<void> }> {
  const binary = process.env.OLLAMA_BINARY ?? "ollama";
  const proc = spawn(binary, ["serve"], { stdio: "pipe" });
  // wait for /api/tags to respond
  await waitForUrl("http://127.0.0.1:11434/api/tags", 30_000);
  // pull model if missing
  await exec(`${binary} pull qwen2.5:3b`);
  return {
    url: "http://127.0.0.1:11434/v1",
    cleanup: async () => { proc.kill("SIGTERM"); },
  };
}
```

### 4. `services/agent-orchestrator/__e2e__/fixtures/playwright-observation.ts` — observation builder

```typescript
import { chromium } from "playwright";
import type { ObservationV1 } from "@fara-platform/fara-action-schema";

export async function captureObservation(page: Page, workId: string): Promise<ObservationV1> {
  const url = page.url();
  const title = await page.title();
  const axSnapshot = await page.accessibility.snapshot({ interestingOnly: true });
  const semanticTargets = await page.evaluate(extractSemanticTargets);
  const screenshot = await page.screenshot({ type: "png" });
  return {
    observationId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    url,
    title,
    page: { tabId: "...", frameId: "...", lifecycle: "complete", visibility: "visible" },
    viewport: await page.viewportSize(),
    screenshot: { kind: "inline", encoding: "base64", data: screenshot.toString("base64"), sha256: "x", width: 0, height: 0 },
    semanticTargets,
    accessibilityNodes: flattenAx(axSnapshot),
  };
}
```

### 5. `services/agent-orchestrator/__e2e__/mvp.test.ts` — the real test

```typescript
describe("MVP E2E (real Ollama + Playwright)", () => {
  let ollama: OllamaFixture;
  let browser: Browser;
  let page: Page;
  let orchestrator: OrchestratorFixture;
  const metrics = new MetricsCollector();

  beforeAll(async () => {
    ollama = await startOllama();
    browser = await chromium.launch({ headless: true });
    orchestrator = await OrchestratorFixture.start({ plannerConfig: openAiCompatibleConfig(ollama.url) });
  }, 120_000);

  afterAll(async () => {
    await orchestrator?.stop();
    await browser?.close();
    await ollama?.cleanup();
    metrics.printSummary();
  });

  it("logs in to the-internet.herokuapp.com", async () => {
    page = await browser.newPage();
    const t0 = Date.now();
    await page.goto("https://the-internet.herokuapp.com/login");

    const goal = "Log in to the site with username 'tomsmith' and password 'SuperSecretPassword!' and verify the page says 'Welcome to the Secure Area'";
    const session = await orchestrator.startSession({ goal });

    let stepCount = 0;
    while (stepCount < 10) {
      const observation = await captureObservation(page);
      const outcome = await orchestrator.planStep(observation);
      metrics.recordStep(Date.now() - t0, await orchestrator.lastTokenUsage());

      if (outcome.kind === "completion") {
        const bodyText = await page.textContent("body");
        expect(bodyText).toContain("Welcome to the Secure Area");
        metrics.printOnSuccess(stepCount);
        return;
      }

      if (outcome.kind === "action_proposal") {
        await executeAction(page, outcome.action);
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      }
      stepCount++;
    }
    throw new Error("Did not complete task within 10 steps");
  }, 120_000);
});
```

### 6. `services/agent-orchestrator/__e2e__/helpers/metrics.ts`

Captures and prints: total wall time, per-step latency (p50, p95, max), prompt tokens, completion tokens, total steps. Printed at end of run for perf visibility.

### 7. `.github/workflows/build.yml` — basic CI

- Node 20 setup, pnpm install, `pnpm build`, `pnpm test` (unit only)
- Runs on PR and push to main

### 8. `.github/workflows/e2e.yml` — full E2E

- Linux runner
- Install Ollama (`curl -fsSL https://ollama.ai/install.sh | sh`)
- Start Ollama, pull qwen2.5:3b (cached if possible)
- Install Playwright Chromium browser (`pnpm exec playwright install chromium`)
- Run `pnpm test:e2e` with extended timeout (5 min)
- Upload metrics as artifact

## Data Flow (real task run)

1. Test starts: `ollama serve`, `chromium.launch({headless: true})`, `OrchestratorFixture.start()`
2. Test opens `https://the-internet.herokuapp.com/login`
3. Goal: "Log in with tomsmith/SuperSecretPassword!, verify 'Welcome to the Secure Area'"
4. Loop (target: 3-5 steps):
   - **Step 1**: Observe page (username field, password field, submit button). Plan → `browser_action type "#username" "tomsmith"`
   - Execute: `page.type("#username", "tomsmith")`. Wait for stable.
   - **Step 2**: Observe. Plan → `browser_action type "#password" "SuperSecretPassword!"`
   - Execute: `page.type("#password", "SuperSecretPassword!")`. Wait.
   - **Step 3**: Observe. Plan → `browser_action click "button[type=submit]"`
   - Execute: `page.click("button[type=submit]")`. Wait for navigation.
   - **Step 4**: Observe secure area page. Plan → `finish "Logged in successfully"`
5. Verify: page text contains "Welcome to the Secure Area"
6. Report metrics: total time, per-step latency, total tokens

## Error Handling

| Failure | Behavior |
|---|---|
| Ollama not running | `beforeAll` fails; clear error message in test output |
| Model not pulled | Auto-pull during `beforeAll`; fail test if pull fails (network) |
| Playwright Chromium not installed | `pnpm exec playwright install chromium` during CI setup |
| Tool-call parse failure | Log parse error; orchestrator retries once; second failure fails test |
| Action validation failure (e.g., unknown action type) | Log action; fail test with diagnostic |
| Page navigation timeout | 5s timeout per step; orchestrator re-observes and re-plans |
| Max steps (10) reached | Fail test; metrics show where it got stuck |
| Ollama SSE timeout | 30s timeout per request; fail test |
| Selector not found in Playwright | Action validator rejects; orchestrator retries with new observation |

## Code Hygiene

- **Test fixtures in `__e2e__/` separate from `src/__tests__/`** — E2E uses real I/O, unit tests don't. Different Jest config in `jest.e2e.config.js`.
- **Real browser, real model** — no mocks. We're proving the system works.
- **One task only** — YAGNI. Two tasks = 2x maintenance; one is enough to prove the architecture.
- **Metrics printed, not asserted** — capture perf for visibility, don't fail on slow runs.
- **Ponytail `ponytail:` comments on cuts** — see below.

## Testing

| Test | Asserts |
|---|---|
| Slice A: planner wired | `Orchestrator.planStep()` calls `planner.plan()` (spy or log assertion) |
| Slice A: Fara path still works | Existing 30 unit tests + 1 new that the planner is called |
| Slice B: `pnpm smoke` | Local script completes; planner responds; prints outcome |
| Slice B: `pnpm build` succeeds | Both extension and orchestrator compile clean |
| Slice C: `pnpm test:e2e` (local with Ollama) | Real task completes; metrics printed |
| Slice C: GitHub Actions E2E | Same test in CI; Ollama installed; passes |
| Slice C: Metrics baseline | First run establishes: ~X seconds, ~Y tokens, ~Z steps |

## Ponytail Cuts (deliberate simplifications)

- **One real task, not a suite.** `# ponytail: single-task E2E, add more when the architecture needs broader proof`
- **Chromium only.** `# ponytail: Chromium-only Playwright, add Firefox/Safari when needed`
- **Small model (qwen2.5:3b).** `# ponytail: 3B model, swap to 9B/27B when CI has GPU runners`
- **No screenshots sent to model.** `# ponytail: no screenshot in observation (text-only), add when 3B struggles`
- **No retry inside orchestrator for the test.** `# ponytail: fail-fast on errors, retry is tested in unit`
- **In-memory orchestrator state.** `# ponytail: no postgres/redis, add when we need persistence`
- **Manual extension load** — extension build produces .zip but E2E doesn't load it. `# ponytail: extension is built but not loaded in E2E, manual Chrome load via README`
- **No cost tracking beyond token counts.** `# ponytail: tokens only, add cost when billing exists`
- **Metrics printed not asserted.** `# ponytail: metrics are diagnostic, not gating, until perf budget is set`

## Files Touched (~570 lines added, ~30 modified)

| File | Lines |
|---|---|
| `services/agent-orchestrator/src/server.ts` | +30 (modified) |
| `services/agent-orchestrator/scripts/smoke.ts` | +80 (new) |
| `services/agent-orchestrator/__e2e__/mvp.test.ts` | +280 (new) |
| `services/agent-orchestrator/__e2e__/fixtures/ollama.ts` | +60 (new) |
| `services/agent-orchestrator/__e2e__/fixtures/playwright-observation.ts` | +80 (new) |
| `services/agent-orchestrator/__e2e__/helpers/metrics.ts` | +40 (new) |
| `services/agent-orchestrator/package.json` | +10 (modified — e2e script + playwright dep) |
| `services/agent-orchestrator/README.md` | +30 (modified) |
| `clients/browser-extension/scripts/build-extension.sh` | +30 (new) |
| `clients/browser-extension/README.md` | +20 (modified) |
| `.github/workflows/build.yml` | +50 (new) |
| `.github/workflows/e2e.yml` | +80 (new) |

## Verification Checklist

- [ ] `pnpm build` succeeds for orchestrator and extension
- [ ] `pnpm smoke` runs locally; planner responds with valid `PlanningOutcome`
- [ ] `pnpm test:e2e` passes locally with Ollama running
- [ ] GitHub Actions E2E workflow passes on a test PR
- [ ] Manual: load built extension in Chrome, point at orchestrator with Ollama, run real task
- [ ] Performance baseline captured: wall time, per-step p95, total tokens, step count
- [ ] Test logs show: 3-5 steps, <15s wall time, <5k total tokens (target — adjust based on first run)

## Open Questions

1. **Where to host the E2E?** GitHub Actions is conventional; user may prefer self-hosted runner. **Decision: GitHub-hosted for now.**
2. **Ollama model size in CI?** 3B is fastest; might be too dumb for the form login. **Decision: start with 3B; if first run fails, swap to 7B or 14B.**
3. **Network in CI?** Ollama pull is ~2GB; first run is slow. **Decision: cache the model in GitHub Actions cache; subsequent runs fast.**
4. **Manual extension load instructions?** README addition; covered by Slice B. **Decision: ship README update as part of Slice B.**
