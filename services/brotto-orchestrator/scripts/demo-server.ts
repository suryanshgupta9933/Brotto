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
    // ponytail: log the incoming request — goal + context size + key signals
    // (current URL, page text snippet). Verbose by design; the demo terminal
    // is the operator's window into what the model is actually seeing.
    const ctx = req.body.context ?? "";
    const urlLine = ctx.match(/URL:\s*(.+)/)?.[1]?.trim() ?? "?";
    const titleLine = ctx.match(/Title:\s*(.+)/)?.[1]?.trim() ?? "?";
    const textStart = ctx.indexOf("=== PAGE TEXT");
    const textSnippet = textStart >= 0
      ? ctx.slice(textStart, textStart + 200).replace(/\n/g, " ").trim()
      : "(no page text)";
    const memLine = ctx.match(/Working memory[^\n]*\n((?:\s+- [^\n]+\n?)+)/)?.[1]?.trim() ?? "";
    const historyLines = ctx.match(/Previous steps[^\n]*\n((?:\s+\d+\.[^\n]+\n?)+)/)?.[1]?.trim() ?? "";
    console.log(`[demo-server] ── /plan req ─────────────────────────────`);
    console.log(`[demo-server]   goal:      ${req.body.goal}`);
    console.log(`[demo-server]   url:       ${urlLine}`);
    console.log(`[demo-server]   title:     ${titleLine}`);
    console.log(`[demo-server]   context:   ${ctx.length} chars`);
    if (memLine) console.log(`[demo-server]   memory:\n${memLine.split("\n").map((l) => `               ${l}`).join("\n")}`);
    if (historyLines) console.log(`[demo-server]   history:\n${historyLines.split("\n").map((l) => `               ${l}`).join("\n")}`);
    console.log(`[demo-server]   page text: ${textSnippet.slice(0, 160)}…`);
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
      console.log(`[demo-server] ── /plan resp in ${elapsed}ms ─────────────`);
      if (outcome.kind === "action") {
        const a = (outcome as { action: Record<string, unknown> }).action;
        const type = a.type ?? "?";
        const reasoning = typeof a.reasoning === "string" ? a.reasoning : "";
        const memUpdates = Array.isArray(a.memoryUpdates) ? a.memoryUpdates as Array<{ key: string; value: string; evidence: string }> : [];
        const argParts: string[] = [];
        if (typeof a.x === "number" && typeof a.y === "number") argParts.push(`(${a.x}, ${a.y})`);
        if (typeof a.url === "string") argParts.push(a.url);
        if (typeof a.text === "string") argParts.push(`"${a.text.slice(0, 60)}"`);
        if (typeof a.key === "string") argParts.push(`key=${a.key}`);
        if (typeof a.finalAnswer === "string" && a.finalAnswer) argParts.push(`finalAnswer="${a.finalAnswer.slice(0, 80)}"`);
        if (typeof a.question === "string") argParts.push(`question="${a.question.slice(0, 80)}"`);
        console.log(`[demo-server]   kind:    action`);
        console.log(`[demo-server]   type:    ${type} ${argParts.join(" ")}`);
        if (reasoning) console.log(`[demo-server]   reason:  ${reasoning}`);
        if (memUpdates.length > 0) {
          console.log(`[demo-server]   memory:`);
          for (const m of memUpdates) {
            console.log(`[demo-server]     - ${m.key} = "${m.value}"${m.evidence ? ` (evidence: ${m.evidence})` : ""}`);
          }
        }
      } else if (outcome.kind === "question") {
        const q = (outcome as { question: string }).question;
        console.log(`[demo-server]   kind:     question`);
        console.log(`[demo-server]   question: ${q}`);
      } else if (outcome.kind === "completion") {
        const c = outcome as { summary?: string };
        console.log(`[demo-server]   kind:    completion`);
        if (c.summary) console.log(`[demo-server]   summary: ${c.summary.slice(0, 160)}`);
      } else {
        console.log(`[demo-server]   kind:    ${outcome.kind}`);
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
