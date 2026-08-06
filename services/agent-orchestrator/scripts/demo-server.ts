#!/usr/bin/env tsx
// Minimal HTTP server exposing POST /plan.
// Takes { workId, goal, context, recentResults, trajectory } — context is
// pre-rendered text (from context-builder.renderSnapshot). Returns a
// PlanningOutcome. Wraps the same planner the orchestrator uses.

import Fastify from "fastify";
import { createPlanner, inferFamilyFromEnv, type InferenceConfig } from "../src/inference-registry.js";

const PORT = Number(process.env.DEMO_PORT ?? "3001");

interface PlanRequest {
  workId: string;
  goal: string;
  context: string;
  recentResults?: unknown[];
  trajectory?: unknown[];
  screenshot?: string;
}

function buildConfigFromEnv(family: ReturnType<typeof inferFamilyFromEnv>): InferenceConfig {
  if (family === "fara") {
    return { family: "fara", endpoint: process.env.FARA_ENDPOINT ?? "" };
  }
  const isAzure = !!process.env.AZURE_OPENAI_API_KEY;
  const baseUrl = process.env.OLLAMA_HOST
    ? `${process.env.OLLAMA_HOST.replace(/\/$/, "")}/v1`
    : isAzure
      ? `${process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, "") ?? ""}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT ?? ""}`
      : "https://api.openai.com/v1";
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
  const baseUrlWithVersion = isAzure && apiVersion
    ? `${baseUrl}?api-version=${encodeURIComponent(apiVersion)}`
    : baseUrl;
  const hasOllama = !!process.env.OLLAMA_HOST;
  return {
    family: "openai-compatible",
    baseUrl: baseUrlWithVersion,
    apiKey: process.env.OPENAI_API_KEY ?? process.env.AZURE_OPENAI_API_KEY ?? (hasOllama ? undefined : "missing"),
    apiKeyHeader: isAzure ? "api-key" : "authorization",
    apiKeyPrefix: isAzure ? "" : "Bearer ",
    model: process.env.SMOKE_MODEL ?? process.env.AZURE_OPENAI_MODEL_NAME ?? "qwen2.5:3b",
  };
}

async function main() {
  const family = inferFamilyFromEnv();
  const config = buildConfigFromEnv(family);
  const planner = createPlanner(config);

  console.log(`[demo-server] family=${family} model=${config.model}`);

  const app = Fastify({ logger: false });
  app.get("/health", async () => ({ status: "ok", family, model: config.model }));
  app.post<{ Body: PlanRequest }>("/plan", async (req) => {
    const t0 = Date.now();
    // ponytail: short retry/backoff for transient 429s. Vision mode sends
    // heavier payloads and can blow past OpenAI's per-minute token limit; a
    // 1-2s wait usually clears it. Cap at 3 retries so the demo doesn't hang.
    let outcome;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        outcome = await planner.plan({
        workId: req.body.workId,
        sessionId: "00000000-0000-4000-8000-000000000001" as never,
        taskId: "00000000-0000-4000-8000-000000000002" as never,
        goal: req.body.goal,
        completionCriteria: [],
        observation: { url: "", title: "", page: { tabId: "x" as never, frameId: "x" as never, lifecycle: "complete", visibility: "visible" }, viewport: { width: 0, height: 0, devicePixelRatio: 0, zoom: 0, scrollX: 0, scrollY: 0 }, screenshot: { kind: "inline", encoding: "base64", data: "", sha256: "a".repeat(64), width: 0, height: 0 }, semanticTargets: [] },
        recentResults: (req.body.recentResults ?? []) as never,
        trajectory: (req.body.trajectory ?? []) as never,
        context: req.body.context,
        ...(req.body.screenshot ? { screenshot: req.body.screenshot } : {}),
      } as never, new AbortController().signal);
        break;
      } catch (err) {
        const e = err as { retryable?: boolean; retryAfterMs?: number };
        const retryable = e.retryable === true;
        if (!retryable || attempt === 2) throw err;
        // ponytail: prefer the planner's retryAfterMs hint (from Retry-After
        // header); fall back to exponential backoff. Min 1s so the TPM window
        // has a chance to clear before we burn another request.
        const hint = e.retryAfterMs;
        const backoffMs = Math.max(hint ?? 0, 1000 * 2 ** attempt);
        console.warn(`[demo-server] retryable error, backing off ${backoffMs}ms (attempt ${attempt + 1}/3): ${err instanceof Error ? err.message : String(err)}`);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
    try {
      const elapsed = Date.now() - t0;
      console.log(`[demo-server] /plan responded in ${elapsed}ms kind=${outcome.kind}`);
      if (outcome.kind === "action") {
        const a = (outcome as { action: { type?: string; x?: number; y?: number; text?: string } }).action;
        console.log(`[demo-server]   action: ${a.type} ${a.x !== undefined ? `(${a.x}, ${a.y})` : ""} ${a.text ? `"${a.text.slice(0, 30)}"` : ""}`);
      } else if (outcome.kind === "question") {
        console.log(`[demo-server]   question: ${(outcome as { question: string }).question.slice(0, 80)}`);
      }
      return outcome;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[demo-server] /plan error: ${message}`);
      throw err;
    }
  });

  await app.listen({ port: PORT, host: "127.0.0.1" });
  console.log(`[demo-server] listening on http://127.0.0.1:${PORT}`);
  console.log(`[demo-server] POST /plan with { goal, context } to get PlanningOutcome`);
}

main().catch((err) => {
  console.error("[demo-server] failed:", err);
  process.exit(1);
});
