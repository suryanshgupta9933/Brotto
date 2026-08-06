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
    try {
      // ponytail: pass the rendered context directly as the user message text;
      // the planner uses it verbatim. This lets the demo control the harness
      // shape (IDs, diffs, inline coords) without touching planner internals.
      const outcome = await planner.plan({
        workId: req.body.workId,
        sessionId: "00000000-0000-4000-8000-000000000001" as never,
        taskId: "00000000-0000-4000-8000-000000000002" as never,
        goal: req.body.goal,
        completionCriteria: [],
        observation: { url: "", title: "", page: { tabId: "x" as never, frameId: "x" as never, lifecycle: "complete", visibility: "visible" }, viewport: { width: 0, height: 0, devicePixelRatio: 0, zoom: 0, scrollX: 0, scrollY: 0 }, screenshot: { kind: "inline", encoding: "base64", data: "", sha256: "a".repeat(64), width: 0, height: 0 }, semanticTargets: [] },
        recentResults: (req.body.recentResults ?? []) as never,
        trajectory: (req.body.trajectory ?? []) as never,
        context: req.body.context,
      } as never, new AbortController().signal);
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
