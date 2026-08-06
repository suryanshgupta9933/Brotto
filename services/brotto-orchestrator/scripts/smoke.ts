#!/usr/bin/env tsx
import { createPlanner, inferFamilyFromEnv } from "../src/inference-registry.js";
import type { InferenceConfig } from "../src/inference-registry.js";
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
  const hasOllama = !!process.env.OLLAMA_HOST;
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AZURE_OPENAI_API_KEY ?? (hasOllama ? undefined : "missing");
  return {
    family: "openai-compatible",
    baseUrl,
    apiKey,
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
      page: {
        tabId: "00000000-0000-4000-8000-000000000010" as never,
        frameId: "00000000-0000-4000-8000-000000000011" as never,
        lifecycle: "complete" as const,
        visibility: "visible" as const,
      },
      viewport: { width: 1280, height: 720, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
      screenshot: { kind: "inline" as const, encoding: "base64" as const, data: "a", sha256: VALID_HASH, width: 1, height: 1 },
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

  console.log(`[smoke] family=${family} model=${(config as {model?: string}).model ?? "(fara)"} baseUrl=${(config as {baseUrl?: string; endpoint?: string}).baseUrl ?? (config as {endpoint: string}).endpoint}`);
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
