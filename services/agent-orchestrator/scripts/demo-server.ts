#!/usr/bin/env tsx
// Minimal HTTP server exposing POST /plan.
// Takes PlanningInput JSON, returns PlanningOutcome JSON.
// Wraps the same planner the orchestrator uses.

import Fastify from "fastify";
import { createPlanner, inferFamilyFromEnv, type InferenceConfig } from "../src/inference-registry.js";
import type { PlanningInput, PlanningOutcome } from "../src/engine/types.js";

const PORT = Number(process.env.DEMO_PORT ?? "3001");

function buildConfigFromEnv(family: ReturnType<typeof inferFamilyFromEnv>): InferenceConfig {
  if (family === "fara") {
    return { family: "fara", endpoint: process.env.FARA_ENDPOINT ?? "" };
  }
  const baseUrl = process.env.OLLAMA_HOST
    ? `${process.env.OLLAMA_HOST.replace(/\/$/, "")}/v1`
    : process.env.AZURE_OPENAI_ENDPOINT
      ? `${process.env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, "")}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`
      : "https://api.openai.com/v1";
  const hasOllama = !!process.env.OLLAMA_HOST;
  return {
    family: "openai-compatible",
    baseUrl,
    apiKey: process.env.OPENAI_API_KEY ?? process.env.AZURE_OPENAI_API_KEY ?? (hasOllama ? undefined : "missing"),
    apiKeyHeader: process.env.AZURE_OPENAI_API_KEY ? "api-key" : "authorization",
    apiKeyPrefix: process.env.AZURE_OPENAI_API_KEY ? "" : "Bearer ",
    model: process.env.SMOKE_MODEL ?? "qwen2.5:3b",
  };
}

async function main() {
  const family = inferFamilyFromEnv();
  const config = buildConfigFromEnv(family);
  const planner = createPlanner(config);

  console.log(`[demo-server] family=${family} model=${config.model}`);

  const app = Fastify({ logger: false });
  app.get("/health", async () => ({ status: "ok", family, model: config.model }));
  app.post<{ Body: PlanningInput }>("/plan", async (req) => {
    const t0 = Date.now();
    const outcome = await planner.plan(req.body, new AbortController().signal);
    const elapsed = Date.now() - t0;
    console.log(`[demo-server] /plan responded in ${elapsed}ms`);
    return outcome;
  });

  await app.listen({ port: PORT, host: "127.0.0.1" });
  console.log(`[demo-server] listening on http://127.0.0.1:${PORT}`);
  console.log(`[demo-server] POST /plan with PlanningInput JSON to get PlanningOutcome`);
}

main().catch((err) => {
  console.error("[demo-server] failed:", err);
  process.exit(1);
});
