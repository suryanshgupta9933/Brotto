#!/usr/bin/env tsx
// ponytail: standalone debug script. Given a run-log file, prints what the
// model saw at each turn — the rendered context, the action it emitted,
// the harness's response. Useful for diagnosing "why did the model pick
// that element" without re-running the harness.
//
// Usage: tsx scripts/show-context.ts <run-log-file> [turn-number]
//   turn-number (optional): show only that turn. Default: all turns.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: tsx scripts/show-context.ts <run-log-file> [turn-number]");
  process.exit(1);
}

const filePath = args[0];
const onlyTurn = args[1] !== undefined ? parseInt(args[1], 10) : null;

const txt = readFileSync(filePath, "utf8");

// Parse out each turn block: "=== TURN N INCOMING ... ===" through the
// next "=== TURN N OUTCOME ... ===" or EOF.
interface TurnBlock {
  index: number;
  incoming: string;
  outcome: string;
  modelEmission: string | null;
}

const turnBlocks: TurnBlock[] = [];
const turnRe = /=== TURN (\d+) (INCOMING|OUTCOME) [^=]+===/g;
const matches: Array<{ kind: string; num: number; ts: string; idx: number }> = [];
let m: RegExpExecArray | null;
while ((m = turnRe.exec(txt)) !== null) {
  matches.push({ kind: m[2], num: parseInt(m[1], 10), ts: m[3], idx: m.index });
}

// Pair up INCOMING/OUTCOME markers sequentially.
for (let i = 0; i + 1 < matches.length; i += 2) {
  const incoming = matches[i];
  const outcome = matches[i + 1];
  if (!incoming || !outcome || incoming.kind !== "INCOMING" || outcome.kind !== "OUTCOME") continue;
  const start = incoming.idx;
  const fullMatch = txt.slice(outcome.idx).match(/=== TURN \d+ OUTCOME [^=]+===/);
  const end = outcome.idx + (fullMatch?.[0].length ?? 100);
  const block = txt.slice(start, end);
  // Extract model tool-call emission from outcome
  const emissionMatch = block.match(/"model_proposal"[\s\S]*?"tool_call"[\s\S]*?"function"[\s\S]*?"arguments":\s*"((?:[^"\\]|\\.)*)"/);
  turnBlocks.push({
    index: incoming.num,
    incoming: block.split("=== TURN " + outcome.num + " OUTCOME")[0] ?? "",
    outcome: block.split("=== TURN " + outcome.num + " OUTCOME")[1] ?? "",
    modelEmission: emissionMatch ? emissionMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : null,
  });
}

function extractContextFromIncoming(block: string): string {
  const m = block.match(/"context":\s*"((?:[^"\\]|\\.)*)"/);
  return m ? JSON.parse(`"${m[1]}"`) as string : "(no context)";
}

function extractActionFromOutcome(block: string): { type: string; rest: string } | null {
  const m = block.match(/"action":\s*\{([\s\S]*?)\}/);
  if (!m) return null;
  const inner = m[1];
  const typeMatch = inner.match(/"type":\s*"([^"]+)"/);
  const xMatch = inner.match(/"x":\s*(-?\d+(?:\.\d+)?)/);
  const yMatch = inner.match(/"y":\s*(-?\d+(?:\.\d+)?)/);
  const urlMatch = inner.match(/"url":\s*"([^"]+)"/);
  const textMatch = inner.match(/"text":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
  const finalAnswerMatch = inner.match(/"finalAnswer":\s*"((?:[^"\\]|\\.)*)"/);
  const targetIdMatch = inner.match(/"targetId":\s*"([^"]+)"/);
  return {
    type: typeMatch?.[1] ?? "?",
    rest: JSON.stringify({
      x: xMatch?.[1],
      y: yMatch?.[1],
      url: urlMatch?.[1],
      text: textMatch?.[1]?.replace(/\\n/g, " "),
      targetId: targetIdMatch?.[1],
      finalAnswer: finalAnswerMatch?.[1]?.slice(0, 200),
    }),
  };
}

for (const turn of turnBlocks) {
  if (onlyTurn !== null && turn.index !== onlyTurn) continue;
  const ctx = extractContextFromIncoming(turn.incoming);
  const action = extractActionFromOutcome(turn.outcome);
  console.log("\n" + "=".repeat(80));
  console.log(`TURN ${turn.index}`);
  console.log("=".repeat(80));
  console.log("\n--- INCOMING CONTEXT (what the model sees) ---");
  console.log(ctx);
  if (turn.modelEmission) {
    console.log("\n--- MODEL TOOL CALL EMISSION ---");
    console.log(turn.modelEmission);
  }
  if (action) {
    console.log(`\n--- HARNESS ACTION ---`);
    console.log(`${action.type} ${action.rest}`);
  }
}
