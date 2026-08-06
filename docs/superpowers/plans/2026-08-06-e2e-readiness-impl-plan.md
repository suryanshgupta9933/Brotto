# E2E Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the MVP loop works end-to-end on a real task — headless Chrome → orchestrator → local Ollama → action → Playwright executes — with one real login task and perf metrics captured.

**Architecture:** Three slices. Slice A: refactor `AgentOrchestrator.plan()` to route through the new `InferencePort`-based planner (Brotto + OpenAI share one path). Slice B: build validation + smoke script + README updates + extension packaging script. Slice C: real E2E test with Ollama subprocess + Playwright Chromium + the-internet login flow + GitHub Actions CI.

**Tech Stack:** TypeScript, Node 20, Playwright (Chromium), Ollama (`qwen2.5:3b`), Jest (split unit + e2e configs), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-06-e2e-readiness-design.md`

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `services/brotto-orchestrator/src/server.ts` | MODIFY | Refactor `plan()` to use `planner.plan()`; remove `FaraInferenceClient` from active path |
| `services/brotto-orchestrator/scripts/smoke.ts` | CREATE | Local Ollama smoke (~80 lines) |
| `services/brotto-orchestrator/__e2e__/fixtures/ollama.ts` | CREATE | Start/stop Ollama subprocess + model pull (~60 lines) |
| `services/brotto-orchestrator/__e2e__/fixtures/playwright-observation.ts` | CREATE | Build `ObservationV1` from Playwright page (~80 lines) |
| `services/brotto-orchestrator/__e2e__/helpers/metrics.ts` | CREATE | Capture + print perf metrics (~40 lines) |
| `services/brotto-orchestrator/__e2e__/mvp.test.ts` | CREATE | Real form-login E2E test (~280 lines) |
| `services/brotto-orchestrator/jest.e2e.config.js` | CREATE | Separate Jest config for E2E |
| `services/brotto-orchestrator/package.json` | MODIFY | Add `smoke` + `test:e2e` scripts; add `playwright` devDep |
| `services/brotto-orchestrator/README.md` | MODIFY | "Run with Ollama" section |
| `clients/brotto-extension/scripts/build-extension.sh` | CREATE | Package extension as `.zip` |
| `clients/brotto-extension/README.md` | MODIFY | Manual install steps |
| `.github/workflows/build.yml` | CREATE | Node + pnpm + `pnpm build` + `pnpm test` |
| `.github/workflows/e2e.yml` | CREATE | Ollama install + Playwright + E2E |

**Dependency order (sequential):** Task 1 (wire planner) → Task 2 (smoke) → Task 3 (extension packaging) → Task 4 (orchestrator README) → Task 5 (extension README) → Task 6 (Ollama fixture) → Task 7 (Playwright observation) → Task 8 (metrics) → Task 9 (E2E test) → Task 10 (CI workflows).

---

## Task 1: Wire `planner.plan()` into `AgentOrchestrator.plan()`

**Files:**
- Modify: `services/brotto-orchestrator/src/server.ts` (~lines 285-340 — the `plan()` method)
- Modify: `services/brotto-orchestrator/src/server.ts` (constructor and `OrchestratorConfig`)

- [ ] **Step 1: Read the relevant slices**

Open `services/brotto-orchestrator/src/server.ts`:
- Line ~47: `OrchestratorConfig` interface
- Line ~85: `private inference: FaraInferenceClient;`
- Line ~120: `this.inference = new FaraInferenceClient(config.inference);`
- Lines ~285-340: `plan()` method using `this.inference.infer(...)`

- [ ] **Step 2: Make `LegacyInferenceConfig` optional and add `plannerConfig` as required**

In `OrchestratorConfig`:

```typescript
export interface OrchestratorConfig {
  session: { ... };
  /** @deprecated Legacy path; use plannerConfig */
  inference?: LegacyInferenceConfig;
  plannerConfig: InferenceConfig;  // NEW: required
  mcpGateway: McpGatewayClient;
  budget?: { ... };
}
```

In the constructor (around line 120), replace:

```typescript
    if (!config.plannerConfig) {
      throw new Error("plannerConfig is required on OrchestratorConfig");
    }
    this.planner = createPlanner(config.plannerConfig);
    this.legacyInference = config.inference ? new FaraInferenceClient(config.inference) : null;
```

Add a new field:
```typescript
  private legacyInference: FaraInferenceClient | null = null;
```

- [ ] **Step 3: Refactor `plan()` method to call `this.planner.plan(input, signal)`**

Find the `plan()` method (around line 285). Replace the inference call block (the `this.inference.infer(...)` section). The replacement:

```typescript
  private async plan(): Promise<void> {
    const context = this.session.getContext();
    const goal = context.goal;

    const planningInput: PlanningInput = {
      workId: this.session.id,
      sessionId: this.session.id as SessionId,
      taskId: this.taskId as TaskId,
      goal,
      completionCriteria: context.completionCriteria ?? [],
      observation: await this.captureObservation(),
      recentResults: this.history.getRecentResults(),
      trajectory: this.history.getTrajectory(),
    };

    const outcome = await this.resilient.execute(
      'inference',
      async () => this.planner.plan(planningInput, this.abortController.signal),
    );

    this.handlePlanningOutcome(outcome);
  }

  private handlePlanningOutcome(outcome: PlanningOutcome): void {
    if (outcome.kind === 'completion') {
      this.session.complete(outcome.reason);
      this.emit('completed', outcome.reason);
      return;
    }
    if (outcome.kind === 'question') {
      this.session.askUser(outcome.question);
      return;
    }
    // action_proposal: existing flow continues
    this.pendingAction = outcome.proposal;
    this.session.checkPolicy();
  }
```

The `handlePlanningOutcome` method replaces the existing action-proposal handling logic in `plan()`. Read the existing code carefully to preserve the policy-check + budget recording + parser behavior.

Add imports at top:
```typescript
import type { PlanningInput, PlanningOutcome } from './engine/types.js';
```

Add `captureObservation()` method (placeholder for now; real impl comes later in Task 7 when Playwright fixture lands):

```typescript
  protected async captureObservation(): Promise<ObservationV1> {
    // Returns a placeholder observation; real Playwright-based capture is in __e2e__/
    return this.lastObservation ?? this.buildEmptyObservation();
  }

  private buildEmptyObservation(): ObservationV1 {
    return {
      observationId: crypto.randomUUID() as ObservationV1['observationId'],
      capturedAt: new Date().toISOString(),
      url: '',
      title: '',
      page: { tabId: '00000000-0000-4000-8000-000000000001' as never, frameId: '00000000-0000-4000-8000-000000000002' as never, lifecycle: 'complete', visibility: 'visible' },
      viewport: { width: 1280, height: 720, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
      screenshot: { kind: 'inline', encoding: 'base64', data: '', sha256: 'a'.repeat(64), width: 0, height: 0 },
      semanticTargets: [],
    };
  }
```

- [ ] **Step 4: Add regression test for planner invocation**

Create `services/brotto-orchestrator/src/__tests__/planner-wiring.test.ts`:

```typescript
import { jest } from '@jest/globals';
import { AgentOrchestrator } from '../server';
import type { InferencePort, PlanningInput, PlanningOutcome } from '../engine/types';

const VALID_HASH = 'a'.repeat(64);

const fakeOutcome: PlanningOutcome = {
  kind: 'action_proposal',
  proposal: {
    actionId: '00000000-0000-4000-8000-000000000010' as never,
    observationId: '00000000-0000-4000-8000-000000000011' as never,
    taskId: '00000000-0000-4000-8000-000000000012' as never,
    proposedAt: '2026-08-06T00:00:00.000Z',
    action: {
      kind: 'left_click',
      x: 0,
      y: 0,
      targetId: '00000000-0000-4000-8000-000000000013' as never,
    },
  },
};

const stubPlanner: InferencePort = {
  plan: jest.fn(async (_input: PlanningInput, _signal: AbortSignal) => fakeOutcome),
};

describe('AgentOrchestrator.plan() routes through InferencePort', () => {
  it('calls planner.plan() instead of legacy FaraInferenceClient', async () => {
    const orch = new AgentOrchestrator({
      session: { sessionId: 's1', goal: 'click buy', tenantId: 't1', userId: 'u1' },
      plannerConfig: { family: 'openai-compatible', baseUrl: 'http://x', model: 'y', apiKey: 'k', transport: jest.fn() as never },
      mcpGateway: {} as never,
    });
    orch.setPlannerForTesting(stubPlanner);
    await (orch as unknown as { triggerPlan: () => Promise<void> }).triggerPlan();
    expect(stubPlanner.plan).toHaveBeenCalledTimes(1);
  });
});
```

To make the test work, add a `setPlannerForTesting(planner: InferencePort)` method to `AgentOrchestrator` and a `triggerPlan()` test-only method:

```typescript
  setPlannerForTesting(planner: InferencePort): void {
    this.planner = planner;
  }

  async triggerPlan(): Promise<void> {
    await this.plan();
  }
```

- [ ] **Step 5: Run tests**

Run: `cd services/brotto-orchestrator && npx jest --testPathPattern planner-wiring`
Expected: PASS, 1 test.

Run full suite: `cd services/brotto-orchestrator && npx jest`
Expected: PASS — all 30 existing tests + 1 new.

- [ ] **Step 6: Typecheck**

Run: `cd services/brotto-orchestrator && npx tsc --noEmit`
Expected: clean (pre-existing `terminalId` error in `session-engine.ts:1256` is unrelated).

- [ ] **Step 7: Commit**

```bash
git add services/brotto-orchestrator/src/server.ts services/brotto-orchestrator/src/__tests__/planner-wiring.test.ts
git commit -m "refactor(orchestrator): route plan() through InferencePort planner"
```

---

## Task 2: Local Smoke Script

**Files:**
- Create: `services/brotto-orchestrator/scripts/smoke.ts` (~80 lines)
- Modify: `services/brotto-orchestrator/package.json` (add `smoke` script)

- [ ] **Step 1: Create scripts directory and smoke.ts**

Create directory: `services/brotto-orchestrator/scripts/`

Create `services/brotto-orchestrator/scripts/smoke.ts`:

```typescript
#!/usr/bin/env tsx
import { createPlanner, inferFamilyFromEnv, type InferenceConfig } from "../src/inference-registry.js";
import type { PlanningInput, PlanningOutcome } from "../src/engine/types.js";

const VALID_HASH = "a".repeat(64);

function buildConfigFromEnv(family: ReturnType<typeof inferFamilyFromEnv>): InferenceConfig {
  if (family === "fara") {
    const endpoint = process.env.FARA_ENDPOINT;
    if (!endpoint) throw new Error("FARA_ENDPOINT required when family=fara");
    return { family: "fara", endpoint };
  }
  const baseUrl = process.env.OLLAMA_HOST
    ? `${process.env.OLLAMA_HOST.replace(/\/$/, "")}/v1`
    : process.env.AZURE_OPENAI_ENDPOINT
      ? `${process.env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, "")}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`
      : "https://api.openai.com/v1";
  return {
    family: "openai-compatible",
    baseUrl,
    apiKey: process.env.OPENAI_API_KEY ?? process.env.AZURE_OPENAI_API_KEY ?? process.env.OLLAMA_HOST ? undefined : "missing",
    apiKeyHeader: process.env.AZURE_OPENAI_API_KEY ? "api-key" : "authorization",
    apiKeyPrefix: process.env.AZURE_OPENAI_API_KEY ? "" : "Bearer ",
    model: process.env.SMOKE_MODEL ?? "qwen2.5:3b",
  };
}

function buildCannedInput(): PlanningInput {
  return {
    workId: "smoke-" + Date.now(),
    sessionId: "00000000-0000-4000-8000-000000000001" as never,
    taskId: "00000000-0000-4000-8000-000000000002" as never,
    goal: "Click the search button",
    completionCriteria: ["search button clicked"],
    observation: {
      observationId: "00000000-0000-4000-8000-000000000003" as never,
      capturedAt: new Date().toISOString(),
      url: "https://example.test",
      title: "Smoke",
      page: { tabId: "00000000-0000-4000-8000-000000000010" as never, frameId: "00000000-0000-4000-8000-000000000011" as never, lifecycle: "complete", visibility: "visible" },
      viewport: { width: 1280, height: 720, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
      screenshot: { kind: "inline", encoding: "base64", data: "a", sha256: VALID_HASH, width: 1, height: 1 },
      semanticTargets: [],
    },
    recentResults: [],
    trajectory: [],
  };
}

async function main() {
  const family = inferFamilyFromEnv();
  const config = buildConfigFromEnv(family);
  const planner = createPlanner(config);

  console.log(`[smoke] family=${family} model=${config.model} baseUrl=${config.baseUrl}`);
  const start = Date.now();
  const outcome: PlanningOutcome = await planner.plan(buildCannedInput(), new AbortController().signal);
  const elapsed = Date.now() - start;

  console.log(`[smoke] responded in ${elapsed}ms`);
  console.log(`[smoke] outcome: ${JSON.stringify(outcome, null, 2)}`);
}

main().catch((err) => {
  console.error("[smoke] failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add `smoke` script to package.json**

In `services/brotto-orchestrator/package.json`, add to `"scripts"`:

```json
"smoke": "tsx scripts/smoke.ts"
```

- [ ] **Step 3: Run smoke with Ollama (requires Ollama running locally)**

If Ollama is running:
```bash
cd services/brotto-orchestrator && OLLAMA_HOST=http://127.0.0.1:11434 SMOKE_MODEL=qwen2.5:3b pnpm smoke
```

Expected: prints `[smoke] family=openai-compatible ... responded in <Xms>` with outcome JSON.

If Ollama is not running, expect connection error.

- [ ] **Step 4: Commit**

```bash
git add services/brotto-orchestrator/scripts/smoke.ts services/brotto-orchestrator/package.json
git commit -m "feat(orchestrator): add local smoke script for planner validation"
```

---

## Task 3: Extension Packaging Script

**Files:**
- Create: `clients/brotto-extension/scripts/build-extension.sh` (~30 lines)

- [ ] **Step 1: Create scripts directory and build script**

Create directory: `clients/brotto-extension/scripts/`

Create `clients/brotto-extension/scripts/build-extension.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

EXT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$EXT_DIR/dist"
OUT_DIR="$EXT_DIR/build"
NAME=$(basename "$EXT_DIR")
VERSION=$(node -p "require('$EXT_DIR/package.json').version")
ZIP="$OUT_DIR/${NAME}-${VERSION}.zip"

mkdir -p "$OUT_DIR"

# Run existing build (produces dist/ with manifest.json, *.js, *.html)
cd "$EXT_DIR"
node build.mjs

# Zip the dist/ folder
cd "$BUILD_DIR"
rm -f "$ZIP"
zip -r "$ZIP" . -x "*.map"

echo "Built $ZIP"
ls -lh "$ZIP"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x clients/brotto-extension/scripts/build-extension.sh`

- [ ] **Step 3: Verify the script runs (without errors)**

```bash
cd clients/brotto-extension && bash scripts/build-extension.sh
```

Expected: ends with `Built .../build/browser-extension-1.0.0.zip`. If the existing `build.mjs` fails (e.g., missing node_modules in fresh checkout), that's a pre-existing issue — note it and continue.

- [ ] **Step 4: Commit**

```bash
git add clients/brotto-extension/scripts/build-extension.sh
git commit -m "feat(extension): add build-extension.sh packaging script"
```

---

## Task 4: Orchestrator README Update

**Files:**
- Modify: `services/brotto-orchestrator/README.md`

- [ ] **Step 1: Read existing README**

Open `services/brotto-orchestrator/README.md` to find the existing structure.

- [ ] **Step 2: Add "Run with Ollama" section**

After the existing "Development" section, add:

```markdown
## Run with Ollama (local development)

Prerequisites: [Ollama](https://ollama.ai) installed, model pulled.

```bash
# Install Ollama (Linux)
curl -fsSL https://ollama.ai/install.sh | sh

# Start the Ollama server
ollama serve &

# Pull a small model (3B; first run downloads ~2GB)
ollama pull qwen2.5:3b

# Install dependencies and build
pnpm install
pnpm build

# Run smoke (canned observation → model → action)
OLLAMA_HOST=http://127.0.0.1:11434 SMOKE_MODEL=qwen2.5:3b pnpm smoke
```

Expected: prints `[smoke] responded in <X>ms` with a `PlanningOutcome` JSON.

For OpenAI / Azure OpenAI, set `OPENAI_API_KEY` or `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_DEPLOYMENT` instead.
```

- [ ] **Step 3: Commit**

```bash
git add services/brotto-orchestrator/README.md
git commit -m "docs(orchestrator): add Run with Ollama section"
```

---

## Task 5: Extension README Update

**Files:**
- Modify: `clients/brotto-extension/README.md`

- [ ] **Step 1: Read existing README**

Open `clients/brotto-extension/README.md` to find existing structure.

- [ ] **Step 2: Add "Manual Install" section**

Add (or extend) an "Install in Chrome" section:

```markdown
## Install in Chrome (development)

1. Build the extension:
   ```bash
   pnpm install
   bash scripts/build-extension.sh
   ```
2. Open `chrome://extensions/` in Chrome
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select `clients/brotto-extension/dist/`
5. Or drag `clients/brotto-extension/build/browser-extension-<version>.zip` onto the extensions page

The extension connects to the orchestrator via WSS. Configure the server URL in the extension's options page.
```

- [ ] **Step 3: Commit**

```bash
git add clients/brotto-extension/README.md
git commit -m "docs(extension): add manual Chrome install steps"
```

---

## Task 6: Ollama Fixture for E2E

**Files:**
- Create: `services/brotto-orchestrator/__e2e__/fixtures/ollama.ts`

- [ ] **Step 1: Create __e2e__ directory and fixture**

Create directory: `services/brotto-orchestrator/__e2e__/fixtures/`

Create `services/brotto-orchestrator/__e2e__/fixtures/ollama.ts`:

```typescript
import { spawn, exec as execCb } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execCb);

export interface OllamaFixture {
  url: string;
  cleanup: () => Promise<void>;
}

async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export async function startOllama(
  model = process.env.E2E_MODEL ?? "qwen2.5:3b",
): Promise<OllamaFixture> {
  const binary = process.env.OLLAMA_BINARY ?? "ollama";
  const host = "127.0.0.1:11434";
  const proc = spawn(binary, ["serve"], { stdio: "pipe", env: { ...process.env, OLLAMA_HOST: host } });
  proc.stderr?.on("data", (chunk) => process.stderr.write(`[ollama] ${chunk}`));

  try {
    await waitForUrl(`http://${host}/api/tags`, 30_000);
  } catch (err) {
    proc.kill("SIGTERM");
    throw err;
  }

  // Pull model if missing
  try {
    await exec(`${binary} pull ${model}`, { env: { ...process.env, OLLAMA_HOST: host } });
  } catch (err) {
    proc.kill("SIGTERM");
    throw new Error(`Failed to pull model ${model}: ${(err as Error).message}`);
  }

  return {
    url: `http://${host}/v1`,
    cleanup: async () => {
      proc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 1000));
    },
  };
}

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags");
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Sanity-check the file compiles**

Run: `cd services/brotto-orchestrator && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add services/brotto-orchestrator/__e2e__/fixtures/ollama.ts
git commit -m "test(orchestrator): add Ollama subprocess fixture for E2E"
```

---

## Task 7: Playwright Observation Builder

**Files:**
- Create: `services/brotto-orchestrator/__e2e__/fixtures/playwright-observation.ts`

- [ ] **Step 1: Add Playwright devDep**

In `services/brotto-orchestrator/package.json` `devDependencies`, add:

```json
"playwright": "^1.45.0"
```

Run: `cd services/brotto-orchestrator && pnpm install`

- [ ] **Step 2: Create observation builder**

Create `services/brotto-orchestrator/__e2e__/fixtures/playwright-observation.ts`:

```typescript
import type { Page } from "playwright";
import type { ObservationV1, SemanticTarget, AccessibilityNode } from "@brotto/brotto-action-schema";

const VALID_HASH = "a".repeat(64);

function uuid(): string {
  return crypto.randomUUID();
}

interface SemanticTargetInput {
  tag: string;
  role?: string;
  accessibleName?: string;
  label?: string;
  attributes?: Record<string, string>;
  boundingBox: { x: number; y: number; width: number; height: number };
  visible?: boolean;
}

async function extractSemanticTargets(page: Page): Promise<SemanticTarget[]> {
  return page.evaluate((urls) => {
    const interactives = Array.from(document.querySelectorAll("input, button, a, select, textarea, [role=button], [role=link]"));
    return interactives.map((el, i) => {
      const rect = el.getBoundingClientRect();
      const accessibleName =
        el.getAttribute("aria-label") ??
        (el.textContent ?? "").trim().slice(0, 200) ??
        (el as HTMLInputElement).value ??
        "";
      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") ?? el.tagName.toLowerCase(),
        accessibleName: { source: "visible_text", text: accessibleName },
        label: accessibleName,
        attributes: Object.fromEntries(
          Array.from(el.attributes).map((a) => [a.name, a.value]),
        ),
        boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        visible: rect.width > 0 && rect.height > 0,
        framePath: [],
        locatorCandidates: [],
        targetId: `t${i}` as never,
      };
    });
  }, []);
}

interface FlatAxNode {
  role: string;
  name?: string;
  axNodeId: string;
  axPath: Array<{ role: string; index: number; name?: string }>;
}

async function extractAxSnapshot(page: Page): Promise<FlatAxNode[]> {
  const snapshot = await page.accessibility.snapshot({ interestingOnly: true });
  if (!snapshot) return [];

  const flat: FlatAxNode[] = [];
  const walk = (node: { role?: string; name?: string; children?: unknown[] }, path: Array<{ role: string; index: number; name?: string }>) => {
    const role = node.role ?? "generic";
    const siblingsAtLevel = (node === snapshot ? [snapshot] : []) as unknown[];
    const idx = siblingsAtLevel.findIndex((s) => s === node);
    flat.push({ role, name: node.name, axNodeId: `${path.length}-${flat.length}`, axPath: [...path, { role, index: Math.max(0, idx) }] });
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child as { role?: string; name?: string; children?: unknown[] }, [...path, { role, index: Math.max(0, idx), name: node.name }]);
      }
    }
  };
  walk(snapshot, []);
  return flat;
}

export async function captureObservation(page: Page): Promise<ObservationV1> {
  const url = page.url();
  const title = await page.title();
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const semanticTargets = await extractSemanticTargets(page);
  const flatAx = await extractAxSnapshot(page);
  const accessibilityNodes: AccessibilityNode[] = flatAx.map((n) => ({
    axNodeId: n.axNodeId,
    role: n.role,
    name: n.name,
    axPath: n.axPath,
    attributeHash: VALID_HASH,
  }));
  return {
    observationId: uuid() as never,
    capturedAt: new Date().toISOString(),
    url,
    title,
    page: {
      tabId: uuid() as never,
      frameId: uuid() as never,
      lifecycle: "complete",
      visibility: "visible",
    },
    viewport: { ...viewport, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
    screenshot: { kind: "inline", encoding: "base64", data: "a", sha256: VALID_HASH, width: 1, height: 1 },
    semanticTargets: semanticTargets as never,
    accessibilityNodes,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd services/brotto-orchestrator && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add services/brotto-orchestrator/__e2e__/fixtures/playwright-observation.ts services/brotto-orchestrator/package.json pnpm-lock.yaml
git commit -m "test(orchestrator): add Playwright observation builder for E2E"
```

---

## Task 8: Metrics Helper

**Files:**
- Create: `services/brotto-orchestrator/__e2e__/helpers/metrics.ts`

- [ ] **Step 1: Create helper**

Create `services/brotto-orchestrator/__e2e__/helpers/metrics.ts`:

```typescript
interface StepRecord {
  stepIndex: number;
  elapsedMs: number;
  promptTokens: number;
  completionTokens: number;
}

export class MetricsCollector {
  private steps: StepRecord[] = [];
  private startedAt = Date.now();

  recordStep(elapsedMs: number, tokens: { prompt: number; completion: number }): void {
    this.steps.push({
      stepIndex: this.steps.length,
      elapsedMs,
      promptTokens: tokens.prompt,
      completionTokens: tokens.completion,
    });
  }

  printSummary(): void {
    const total = Date.now() - this.startedAt;
    const steps = this.steps.length;
    const stepLatencies = this.steps.map((s) => s.elapsedMs).sort((a, b) => a - b);
    const p50 = stepLatencies[Math.floor(steps / 2)] ?? 0;
    const p95 = stepLatencies[Math.floor(steps * 0.95)] ?? 0;
    const max = stepLatencies[stepLatencies.length - 1] ?? 0;
    const totalPrompt = this.steps.reduce((s, r) => s + r.promptTokens, 0);
    const totalCompletion = this.steps.reduce((s, r) => s + r.completionTokens, 0);
    const totalTokens = totalPrompt + totalCompletion;

    console.log("\n=== E2E Metrics ===");
    console.log(`Total wall time:    ${(total / 1000).toFixed(2)}s`);
    console.log(`Steps:              ${steps}`);
    console.log(`Per-step latency:   p50=${p50}ms p95=${p95}ms max=${max}ms`);
    console.log(`Prompt tokens:      ${totalPrompt}`);
    console.log(`Completion tokens:  ${totalCompletion}`);
    console.log(`Total tokens:       ${totalTokens}`);
    console.log("====================\n");
  }

  printOnSuccess(stepCount: number): void {
    console.log(`[e2e] task completed in ${stepCount} steps`);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd services/brotto-orchestrator && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add services/brotto-orchestrator/__e2e__/helpers/metrics.ts
git commit -m "test(orchestrator): add metrics collector for E2E"
```

---

## Task 9: E2E Test (the real one)

**Files:**
- Create: `services/brotto-orchestrator/__e2e__/mvp.test.ts` (~280 lines)
- Create: `services/brotto-orchestrator/jest.e2e.config.js`

- [ ] **Step 1: Create Jest E2E config**

Create `services/brotto-orchestrator/jest.e2e.config.js`:

```javascript
export default {
  testEnvironment: "node",
  testMatch: ["<rootDir>/__e2e__/**/*.test.ts"],
  testTimeout: 180_000,
  setupFilesAfterEach: [],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
  },
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
};
```

- [ ] **Step 2: Add `test:e2e` script**

In `services/brotto-orchestrator/package.json` `scripts`:

```json
"test:e2e": "NODE_OPTIONS='--experimental-vm-modules' jest --config jest.e2e.config.js --runInBand"
```

- [ ] **Step 3: Create orchestrator fixture**

Create `services/brotto-orchestrator/__e2e__/fixtures/orchestrator.ts`:

```typescript
import { AgentOrchestrator, type OrchestratorConfig } from "../../src/server.js";
import type { PlanningInput, PlanningOutcome } from "../../src/engine/types.js";
import type { ObservationV1 } from "@brotto/brotto-action-schema";

export interface OrchestratorFixture {
  planStep: (observation: ObservationV1) => Promise<PlanningOutcome>;
  stop: () => Promise<void>;
}

export async function startOrchestrator(config: Partial<OrchestratorConfig> & { plannerConfig: OrchestratorConfig["plannerConfig"] }): Promise<OrchestratorFixture> {
  const orch = new AgentOrchestrator({
    session: { sessionId: "e2e-" + Date.now(), goal: "login", tenantId: "t", userId: "u", ...config.session },
    plannerConfig: config.plannerConfig,
    mcpGateway: config.mcpGateway ?? ({} as never),
  });

  let lastTokens = { prompt: 0, completion: 0 };

  return {
    planStep: async (observation) => {
      const input: PlanningInput = {
        workId: "e2e-step-" + Date.now(),
        sessionId: orch.sessionIdForTesting() as never,
        taskId: orch.taskIdForTesting() as never,
        goal: "login",
        completionCriteria: ["Welcome to the Secure Area visible"],
        observation,
        recentResults: [],
        trajectory: [],
      };
      const t0 = Date.now();
      const outcome = await orch.runPlannerForTesting(input);
      lastTokens = { prompt: orch.lastPromptTokensForTesting(), completion: orch.lastCompletionTokensForTesting() };
      void t0;
      return outcome;
    },
    stop: async () => { /* orchestrator has no async cleanup */ },
  };
}
```

To support this fixture, add to `AgentOrchestrator`:

```typescript
  sessionIdForTesting(): string { return this.session.id; }
  taskIdForTesting(): string { return this.taskId; }
  lastPromptTokensForTesting(): number { return this.lastPromptTokens ?? 0; }
  lastCompletionTokensForTesting(): number { return this.lastCompletionTokens ?? 0; }
  async runPlannerForTesting(input: PlanningInput): Promise<PlanningOutcome> {
    return this.planner.plan(input, new AbortController().signal);
  }
```

Add tracking fields in the constructor or `plan()`:

```typescript
  private lastPromptTokens = 0;
  private lastCompletionTokens = 0;
```

In `plan()`, after `this.planner.plan(...)` returns:

```typescript
    // Token tracking (best-effort; depends on outcome shape)
    if ('usage' in outcome && outcome.usage) {
      this.lastPromptTokens = (outcome.usage as { promptTokens?: number }).promptTokens ?? 0;
      this.lastCompletionTokens = (outcome.usage as { completionTokens?: number }).completionTokens ?? 0;
    }
```

(Skip the usage tracking if `PlanningOutcome` doesn't have it; the metrics helper handles 0 tokens gracefully.)

- [ ] **Step 4: Create the E2E test**

Create `services/brotto-orchestrator/__e2e__/mvp.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { chromium, type Browser, type Page } from "playwright";
import { startOllama, isOllamaAvailable, type OllamaFixture } from "./fixtures/ollama.js";
import { captureObservation } from "./fixtures/playwright-observation.js";
import { startOrchestrator, type OrchestratorFixture } from "./fixtures/orchestrator.js";
import { MetricsCollector } from "./helpers/metrics.js";
import type { ObservationV1, PlanningOutcome } from "../src/engine/types.js";

const TEST_URL = "https://the-internet.herokuapp.com/login";
const USERNAME = "tomsmith";
const PASSWORD = "SuperSecretPassword!";
const SUCCESS_TEXT = "Welcome to the Secure Area";
const MAX_STEPS = 10;

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
    orch = await startOrchestrator({
      plannerConfig: { family: "openai-compatible", baseUrl: ollama.url, model: process.env.E2E_MODEL ?? "qwen2.5:3b" },
    });
  }, 120_000);

  afterAll(async () => {
    await orch?.stop();
    await browser?.close();
    await ollama?.cleanup();
    if (ollama) metrics.printSummary();
  });

  async function executeAction(page: Page, outcome: PlanningOutcome): Promise<void> {
    if (outcome.kind !== "action_proposal") return;
    const action = outcome.proposal.action as { kind?: string; x?: number; y?: number; text?: string; selector?: string };

    if (action.kind === "left_click" && typeof action.x === "number" && typeof action.y === "number") {
      await page.mouse.click(action.x, action.y);
      return;
    }
    if (action.kind === "type" && typeof action.text === "string") {
      // Try to focus on the first input/textarea; fall back to clicking at (10, 10)
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
        return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      });
      if (!focused) {
        await page.evaluate(() => (document.querySelector("input, textarea") as HTMLElement | null)?.focus());
      }
      await page.keyboard.type(action.text);
      return;
    }
    throw new Error(`Unsupported action: ${JSON.stringify(action)}`);
  }

  it("logs in to the-internet.herokuapp.com", async () => {
    if (!ollama || !browser || !orch) {
      console.warn("[e2e] skipping — Ollama fixture not initialized");
      return;
    }
    page = await browser.newPage();
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
```

- [ ] **Step 5: Verify test compiles**

Run: `cd services/brotto-orchestrator && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Run E2E locally (requires Ollama)**

```bash
cd services/brotto-orchestrator && ollama serve &
ollama pull qwen2.5:3b
pnpm test:e2e
```

Expected: test logs `[e2e] task completed in <N> steps` followed by metrics block.

If the test fails because the model is too weak for the form-login task, switch to a larger model (e.g., `qwen2.5:7b`) and rerun.

- [ ] **Step 7: Commit**

```bash
git add services/brotto-orchestrator/__e2e__ services/brotto-orchestrator/jest.e2e.config.js services/brotto-orchestrator/package.json
git commit -m "test(orchestrator): add E2E test for form-login with Ollama+Playwright"
```

---

## Task 10: GitHub Actions CI Workflows

**Files:**
- Create: `.github/workflows/build.yml`
- Create: `.github/workflows/e2e.yml`

- [ ] **Step 1: Create .github/workflows directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Write build.yml**

Create `.github/workflows/build.yml`:

```yaml
name: build

on:
  pull_request:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test
```

- [ ] **Step 3: Write e2e.yml**

Create `.github/workflows/e2e.yml`:

```yaml
name: e2e

on:
  pull_request:
    paths:
      - "services/brotto-orchestrator/**"
      - "packages/brotto-action-schema/**"
      - ".github/workflows/e2e.yml"
  workflow_dispatch:

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install Ollama
        run: curl -fsSL https://ollama.ai/install.sh | sh

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm build

      - name: Start Ollama
        run: |
          ollama serve &
          for i in {1..30}; do
            if curl -sf http://127.0.0.1:11434/api/tags > /dev/null; then break; fi
            sleep 1
          done

      - name: Pull model
        run: ollama pull qwen2.5:3b

      - name: Cache Ollama model
        uses: actions/cache@v4
        with:
          path: ~/.ollama
          key: ollama-qwen2.5-3b
          restore-keys: ollama-

      - name: Install Playwright Chromium
        run: cd services/brotto-orchestrator && pnpm exec playwright install chromium

      - name: Run E2E test
        run: cd services/brotto-orchestrator && pnpm test:e2e

      - name: Upload metrics
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-metrics
          path: services/brotto-orchestrator/__e2e__/metrics.log
          if-no-files-found: ignore
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/build.yml .github/workflows/e2e.yml
git commit -m "ci: add GitHub Actions for build and E2E with Ollama"
```

---

## Self-Review Checklist

After completing all tasks:

1. **Spec coverage:**
   - Slice A wire planner → Task 1 ✓
   - Slice B smoke + extension packaging + READMEs → Tasks 2-5 ✓
   - Slice C fixtures + E2E + CI → Tasks 6-10 ✓
   - All real-task, Playwright, Ollama, GitHub Actions ✓
   - Performance metrics captured ✓

2. **Type consistency:**
   - `PlanningInput`, `PlanningOutcome` shapes used in Task 9 match Task 7 observation builder
   - `OllamaFixture.url` used by orchestrator config matches `OpenAICompatibleConfig.baseUrl` shape
   - `OrchestratorConfig.plannerConfig` made required in Task 1, used by orchestrator fixture in Task 9

3. **No regressions:**
   - Task 1 explicitly preserves `legacyInference: FaraInferenceClient | null` (kept for back-compat)
   - Existing 30 unit tests + planner-wiring test must still pass
   - Pre-existing `terminalId` TS error in `session-engine.ts:1256` is unrelated

4. **Order:**
   - Task 1 → Task 2 (smoke can run once planner is wired)
   - Task 2 → Task 9 (E2E depends on planner)
   - Tasks 6-9 sequential (fixtures before test)
   - Tasks 3-5 (extension + READMEs) independent; can run in parallel

## Verification Checklist (from spec)

- [ ] `pnpm build` succeeds for orchestrator and extension
- [ ] `pnpm smoke` runs locally; planner responds with valid `PlanningOutcome`
- [ ] `pnpm test:e2e` passes locally with Ollama running
- [ ] GitHub Actions E2E workflow passes on a test PR
- [ ] Manual: load built extension in Chrome, point at orchestrator with Ollama, run real task
- [ ] Performance baseline captured: wall time, per-step p95, total tokens, step count
