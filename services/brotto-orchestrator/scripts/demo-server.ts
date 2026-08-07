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

  // ponytail: turn counter so each request/response is easy to correlate with
  // a step in the agent loop. The local-driver fires /plan sequentially, so a
  // bare increment is safe (no concurrent handlers). Counter resets to 1
  // when a new taskId arrives (different goal = fresh counter) so the
  // operator's log doesn't accumulate across runs.
  let turnCounter = 0;
  let lastTaskId = "";

  const app = Fastify({ logger: false });
  app.get("/health", async () => ({ status: "ok", family, model: config.model }));
  app.post<{ Body: PlanRequest }>("/plan", async (req) => {
    // ponytail: reset counter on a new task. The local-driver sends a
    // stable taskId per run_local_task; when that changes the counter
    // restarts at 1 so each new goal has its own turn numbering.
    const taskId = String(req.body.taskId ?? "");
    if (taskId && taskId !== lastTaskId) {
      turnCounter = 0;
      lastTaskId = taskId;
      console.log(`[demo-server] new task ${taskId} (goal: ${req.body.goal.slice(0, 60)}) — turn counter reset`);
    }
    const myTurn = ++turnCounter;
    const t0 = Date.now();
    // ponytail: log the incoming request — goal + context size + key signals
    // (current URL, page text snippet). Verbose by design; the demo terminal
    // is the operator's window into what the model is actually seeing.
    const ctx = req.body.context ?? "";
    const urlLine = ctx.match(/URL:\s*(.+)/)?.[1]?.trim() ?? "?";
    const titleLine = ctx.match(/Title:\s*(.+)/)?.[1]?.trim() ?? "?";
    const textStart = ctx.indexOf("=== PAGE TEXT");
    const textEnd = textStart >= 0 ? ctx.indexOf("=== END PAGE TEXT", textStart) : -1;
    const pageTextRaw = textStart >= 0 && textEnd >= 0 ? ctx.slice(textStart, textEnd) : "";
    const pageTextChars = pageTextRaw.replace(/=== PAGE TEXT[^=]*===/g, "").replace(/=== END PAGE TEXT ===/g, "").trim().length;
    const pageTextSnippet = textStart >= 0
      ? ctx.slice(textStart, Math.min(textStart + 240, textEnd > 0 ? textEnd : textStart + 240)).replace(/\n/g, " ").trim()
      : "(no page text)";
    const memLines = ctx.match(/Working memory[^\n]*\n((?:\s+- [^\n]+\n?)+)/)?.[1]?.trim().split("\n").filter(Boolean) ?? [];
    const historyLines = ctx.match(/Previous steps[^\n]*\n((?:\s+\d+\.[^\n]+\n?)+)/)?.[1]?.trim().split("\n").filter(Boolean) ?? [];
    const elementCount = (ctx.match(/click=\(\d+, \d+\)/g) ?? []).length;
    const sep = `── /plan turn #${myTurn} ${"─".repeat(Math.max(0, 50 - String(myTurn).length))}`;
    console.log("");
    console.log(`[demo-server] ${sep}`);
    console.log(`[demo-server]   REQ  ${req.body.workId}`);
    console.log(`[demo-server]   goal      : ${req.body.goal}`);
    console.log(`[demo-server]   url       : ${urlLine}`);
    console.log(`[demo-server]   title     : ${titleLine}`);
    console.log(`[demo-server]   ctx chars : ${ctx.length} (page text ${pageTextChars}, ${elementCount} elements)`);
    if (memLines.length > 0) {
      console.log(`[demo-server]   memory (${memLines.length} fact${memLines.length === 1 ? "" : "s"}):`);
      for (const l of memLines) console.log(`[demo-server]      ${l.trim()}`);
    } else {
      console.log(`[demo-server]   memory    : (none yet)`);
    }
    if (historyLines.length > 0) {
      console.log(`[demo-server]   history (${historyLines.length} step${historyLines.length === 1 ? "" : "s"}):`);
      for (const l of historyLines) console.log(`[demo-server]      ${l.trim()}`);
    } else {
      console.log(`[demo-server]   history   : (no prior steps — first turn)`);
    }
    console.log(`[demo-server]   page text : ${pageTextSnippet.slice(0, 200)}…`);
    // ponytail: short retry/backoff for transient 429s. Vision mode sends
    // heavier payloads and can blow past OpenAI's per-minute token limit; a
    // 1-2s wait usually clears it. Cap at 3 retries so the demo doesn't hang.
    let outcome;
    let lastErrMessage: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        outcome = await planner.plan({
        workId: req.body.workId,
        sessionId: "00000000-0000-4000-8000-000000000001" as never,
        taskId: "00000000-0000-4000-8000-000000000002" as never,
        goal: req.body.goal,
        completionCriteria: [],
        // ponytail: placeholder observation must carry a real observationId
        // (UUID) — CompletionProposalV1Schema requires it and the planner
        // throws on validation failure. Without this fix the loop crashes
        // with "Completion proposal schema validation failed: Invalid input"
        // whenever the model returns content (no tool call) to signal
        // termination. crypto.randomUUID() generates a fresh UUID per
        // request; the value is opaque to the planner (just a brand token).
        observation: { observationId: crypto.randomUUID(), url: "", title: "", page: { tabId: "x" as never, frameId: "x" as never, lifecycle: "complete", visibility: "visible" }, viewport: { width: 0, height: 0, devicePixelRatio: 0, zoom: 0, scrollX: 0, scrollY: 0 }, screenshot: { kind: "inline", encoding: "base64", data: "", sha256: "a".repeat(64), width: 0, height: 0 }, semanticTargets: [] },
        recentResults: (req.body.recentResults ?? []) as never,
        trajectory: (req.body.trajectory ?? []) as never,
        context: req.body.context,
        ...(req.body.screenshot ? { screenshot: req.body.screenshot } : {}),
      } as never, new AbortController().signal);
        // ponytail: mark the response when the planner emitted an internal
        // corrective question (prose-only OR tool-parse-error). The
        // local-driver uses proseOnly=true to (a) silently inject guidance
        // instead of surfacing a user input card, and (b) count consecutive
        // prose-only responses so the model gets one corrective chance
        // before the loop fails loudly with PLANNER_PROSE_INSTEAD_OF_TOOL.
        if (outcome && typeof outcome === "object" && outcome.kind === "question"
            && (/prose without a tool call/i.test(outcome.question ?? "")
                || /invalid arguments/i.test(outcome.question ?? ""))) {
          (outcome as { proseOnly?: boolean }).proseOnly = true;
        }
        break;
      } catch (err) {
        lastErrMessage = err instanceof Error ? err.message : String(err);
        const e = err as { retryable?: boolean; retryAfterMs?: number; code?: string };
        const retryable = e.retryable === true;
        if (!retryable || attempt === 2) throw err;
        // ponytail: prefer the planner's retryAfterMs hint (from Retry-After
        // header); fall back to exponential backoff. Min 1s so the TPM window
        // has a chance to clear before we burn another request.
        const hint = e.retryAfterMs;
        const backoffMs = Math.max(hint ?? 0, 1000 * 2 ** attempt);
        console.warn(`[demo-server] turn #${myTurn} retryable error, backing off ${backoffMs}ms (attempt ${attempt + 1}/3, code=${e.code ?? "?"}): ${lastErrMessage.slice(0, 240)}`);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
    try {
      const elapsed = Date.now() - t0;
      const respSep = `── /plan turn #${myTurn} resp ${"─".repeat(Math.max(0, 44 - String(myTurn).length))}`;
      console.log(`[demo-server] ${respSep} ${elapsed}ms`);
      if (outcome.kind === "action") {
        const a = (outcome as { action: Record<string, unknown> }).action;
        const type = a.type ?? "?";
        const reasoning = typeof a.reasoning === "string" ? a.reasoning : "";
        const memUpdates = Array.isArray(a.memoryUpdates) ? a.memoryUpdates as Array<{ key: string; value: string; evidence: string }> : [];
        // ponytail: action signature is the same logic the harness uses to
        // detect stagnation. Logging it server-side lets the operator spot a
        // repeat without scrolling back to prior turns.
        const sig = (() => {
          const t = String(type).toLowerCase();
          if (t === "visit_url") return `visit_url:${a.url ?? ""}`;
          if (t === "left_click" || t === "double_click" || t === "right_click") return `${t}:${a.x ?? 0},${a.y ?? 0}`;
          if (t === "insert_text") return `insert_text:${String(a.text ?? "").slice(0, 40)}`;
          if (t === "key") return `key:${a.key ?? ""}`;
          return t;
        })();
        const argParts: string[] = [];
        if (typeof a.x === "number" && typeof a.y === "number") argParts.push(`(${a.x}, ${a.y})`);
        if (typeof a.url === "string") argParts.push(a.url);
        if (typeof a.text === "string") argParts.push(`"${a.text.slice(0, 60)}"`);
        if (typeof a.key === "string") argParts.push(`key=${a.key}`);
        if (typeof a.finalAnswer === "string" && a.finalAnswer) argParts.push(`finalAnswer="${a.finalAnswer.slice(0, 80)}"`);
        if (typeof a.question === "string") argParts.push(`question="${a.question.slice(0, 80)}"`);
        console.log(`[demo-server]   kind      : action (${type})`);
        console.log(`[demo-server]   args      : ${argParts.join(" ") || "(none)"}`);
        console.log(`[demo-server]   signature : ${sig}`);
        if (reasoning) console.log(`[demo-server]   reason    : ${reasoning}`);
        if (memUpdates.length > 0) {
          console.log(`[demo-server]   memory updates (${memUpdates.length}):`);
          for (const m of memUpdates) {
            console.log(`[demo-server]      + ${m.key} = "${m.value}"${m.evidence ? ` (evidence: ${m.evidence})` : ""}`);
          }
        }
      } else if (outcome.kind === "question") {
        const q = (outcome as { question: string }).question;
        console.log(`[demo-server]   kind      : question`);
        console.log(`[demo-server]   question  : ${q}`);
      } else if (outcome.kind === "completion") {
        const c = outcome as { summary?: string };
        console.log(`[demo-server]   kind      : completion`);
        if (c.summary) console.log(`[demo-server]   summary   : ${c.summary.slice(0, 160)}`);
      } else {
        console.log(`[demo-server]   kind      : ${outcome.kind}`);
      }
      return outcome;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[demo-server] turn #${myTurn} failed after ${Date.now() - t0}ms: ${message}`);
      if (lastErrMessage && lastErrMessage !== message) console.error(`[demo-server] turn #${myTurn} prior error: ${lastErrMessage.slice(0, 400)}`);
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
