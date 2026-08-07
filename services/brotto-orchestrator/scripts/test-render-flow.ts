#!/usr/bin/env tsx
// ponytail: end-to-end visibility into what the model sees. Builds a
// realistic Gmail-like PageSnapshot, runs it through the actual render
// pipeline, prints each stage, then POSTs /plan so we see the model's
// response on the same fixture.
//
// Run with the demo-server up: pnpm demo:server in another terminal.
// Override with DEMO_PORT (default 3001) or BROTTO_PLAN_URL.

import type { PageSnapshot } from "../src/context/types.js";
import { renderContext, renderMemoryBlock } from "../src/context/render.js";
import { extractGoalKeywords, detectGoalMatch } from "../../../clients/brotto-extension/src/goal-detector.js";
import { extractFacts } from "../../../clients/brotto-extension/src/fact-extractor.js";
import { SNAPSHOT_FN_SRC } from "../src/context/render.js";

const PLAN_URL = process.env.BROTTO_PLAN_URL ?? `http://127.0.0.1:${process.env.DEMO_PORT ?? "3001"}/plan`;

// ─── STAGE 0: build a realistic Gmail inbox PageSnapshot fixture ──────────
// ponytail: simulate Gmail AFTER it loads — left-rail nav, search bar,
// several email rows. Mirrors the DOM shape the AX tree would actually
// produce. This is what the model SHOULD be seeing on the user's screen
// when they say "open my gmail".
const gmailSnapshot: PageSnapshot = {
  url: "https://mail.google.com/mail/u/0/#inbox",
  title: "Inbox - suryanshgupta9933@gmail.com - Gmail",
  bodyTextSnippet: [
    "=== HEADINGS ===",
    "H1: Inbox (2)",
    "H2: Primary",
    "H2: Promotions",
    "",
    "=== LABELS ===",
    "Compose",
    "Search mail",
    "",
    "=== CARDS & LIST ITEMS ===",
    "• Amazon Shipping: Your package with order 123-4567890-1234567 is out for delivery — Expected by 9 PM today (href: #inbox/123abc)",
    "• GitHub: New sign-in to your account from Chrome on macOS",
    "• Google Drive: Storage almost full — 95% of 15 GB used",
    "• LinkedIn: 3 new connection requests",
    "",
    "=== TEXT ===",
    "Inbox",
    "Starred",
    "Snoozed",
    "Sent",
    "Drafts",
    "Categories",
    "Primary",
    "Social",
    "Promotions",
    "More",
    "Labels",
    "1-25 of 47",
    "Compose",
    "Select",
    "Refresh",
    "More options",
    "Archive",
    "Report spam",
    "Delete",
    "Mark as read",
    "Snooze",
    "Move to",
    "Labels",
    "Done",
    "Settings",
  ].join("\n"),
  elements: [
    { id: "e_search", tag: "input", role: "textbox", name: "Search mail", value: "", type: "search", placeholder: "Search mail", visible: true, cx: 460, cy: 70 },
    { id: "e_compose", tag: "button", role: "button", name: "Compose", visible: true, cx: 80, cy: 70 },
    { id: "e_inbox", tag: "a", role: "link", name: "Inbox", visible: true, cx: 80, cy: 120, href: "#inbox" },
    { id: "e_starred", tag: "a", role: "link", name: "Starred", visible: true, cx: 80, cy: 150, href: "#starred" },
    { id: "e_sent", tag: "a", role: "link", name: "Sent", visible: true, cx: 80, cy: 180, href: "#sent" },
    { id: "e_drafts", tag: "a", role: "link", name: "Drafts", visible: true, cx: 80, cy: 210, href: "#drafts" },
    { id: "e_amazon_row", tag: "div", role: "row", name: "Amazon Shipping Your package with order 123-4567890-1234567 is out for delivery", visible: true, cx: 460, cy: 200 },
    { id: "e_github_row", tag: "div", role: "row", name: "GitHub New sign-in to your account", visible: true, cx: 460, cy: 240 },
    { id: "e_drive_row", tag: "div", role: "row", name: "Google Drive Storage almost full", visible: true, cx: 460, cy: 280 },
    { id: "e_settings", tag: "button", role: "button", name: "Settings", visible: true, cx: 1260, cy: 70 },
  ],
  focusedId: null,
  pagePurpose: "Email by Google",
  pageIdentity: "1a2b3c4d5e6f7g8h",
  links: [
    { text: "Inbox", href: "#inbox", axPath: [], attributeHash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2", bbox: { x: 60, y: 110, width: 200, height: 30 } },
    { text: "Starred", href: "#starred", axPath: [], attributeHash: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3", bbox: { x: 60, y: 140, width: 200, height: 30 } },
    { text: "Sent", href: "#sent", axPath: [], attributeHash: "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4", bbox: { x: 60, y: 170, width: 200, height: 30 } },
    { text: "Drafts", href: "#drafts", axPath: [], attributeHash: "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5", bbox: { x: 60, y: 200, width: 200, height: 30 } },
  ],
  buttons: [
    { text: "Compose", axPath: [], attributeHash: "01ab23cd45ef67ab89cd01ef23ab45cd67ef89ab01cd23ef45ab67cd89ef01ab", bbox: { x: 20, y: 50, width: 120, height: 40 } },
    { text: "Search mail", axPath: [], attributeHash: "12cd34ef56ab78cd90ef12ab34cd56ef78ab90cd12ef34ab56cd78ef90ab12cd", bbox: { x: 200, y: 50, width: 600, height: 40 } },
    { text: "Settings", axPath: [], attributeHash: "23cd45ef67ab89cd01ef23ab45cd67ef89ab01cd23ef45ab67cd89ef01ab23cd", bbox: { x: 1240, y: 50, width: 60, height: 40 } },
  ],
};

// ─── STAGE 1: dump the raw PageSnapshot ────────────────────────────────────
function dumpSnapshot(label: string, snap: PageSnapshot): void {
  console.log(`\n${"═".repeat(72)}\n  STAGE 1: ${label} — raw PageSnapshot\n${"═".repeat(72)}`);
  console.log(`  url         : ${snap.url}`);
  console.log(`  title       : ${snap.title}`);
  console.log(`  pagePurpose : ${snap.pagePurpose ?? "(none)"}`);
  console.log(`  pageIdentity: ${snap.pageIdentity ?? "(none)"}`);
  console.log(`  bodyText    : ${snap.bodyTextSnippet.length} chars across ${(snap.bodyTextSnippet.match(/=== /g) ?? []).length / 2 | 0} sections`);
  console.log(`  elements    : ${snap.elements.length} interactive (${snap.elements.filter((e) => e.tag === "a" || e.tag === "button").length} links/buttons)`);
  console.log(`  links       : ${snap.links?.length ?? 0}`);
  console.log(`  buttons     : ${snap.buttons?.length ?? 0}`);
}

// ─── STAGE 2: dump the rendered context (what becomes the user message) ───
function dumpContext(label: string, ctx: string): void {
  console.log(`\n${"═".repeat(72)}\n  STAGE 2: ${label} — rendered context (${ctx.length} chars)\n${"═".repeat(72)}`);
  console.log(ctx);
}

// ─── STAGE 3: print the full messages array (system + user) ───────────────
const SYSTEM_PROMPT = `You are Brotto, the user's shadow browser assistant. You are NOT the user — you cannot sign in as the user, you cannot see the user's inbox, you cannot use the user's account. You can ONLY see what is on the screen in front of you right now. The user signs in manually when a page requires it; you observe and act.

CRITICAL TOOL-CALLING MANDATE:
- EVERY SINGLE response from you MUST be a tool function call (visit_url, left_click, scroll, terminate, etc.). NEVER output plain text prose.

Loop: read the page context (URL + PAGE TEXT first, then elements + WORKING MEMORY) → identify the current stage and what to do next → call one tool → re-read context → repeat. Call terminate(finalAnswer) ONLY when you have found the answer in the page text.

MANDATORY on every tool call: include a \`reasoning\` field — one short plain-English sentence describing what you observe NOW (different from previous steps) and what you're doing.

MANDATORY on terminate: include \`finalAnswer\` — the actual answer to the user's original question in plain English. (Full prompt is longer; this is the abbreviated version for the test script.)`;

function dumpPrompt(goal: string, ctx: string): void {
  console.log(`\n${"═".repeat(72)}\n  STAGE 3: full messages array (system + user) sent to the model\n${"═".repeat(72)}`);
  console.log("\n── messages[0].role=system ──\n");
  console.log(SYSTEM_PROMPT);
  console.log("\n── messages[1].role=user ──\n");
  console.log(`GOAL: ${goal}\n\n${ctx}`);
  console.log(`\n── total: system ${SYSTEM_PROMPT.length} chars + user ${goal.length + ctx.length} chars = ${SYSTEM_PROMPT.length + goal.length + ctx.length} chars ──`);
}

// ─── STAGE 4: POST /plan and dump the response ────────────────────────────
async function callPlanner(workId: string, goal: string, ctx: string): Promise<unknown> {
  const body = { workId, taskId: workId, goal, context: ctx };
  const res = await fetch(PLAN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, raw: text };
  }
}

function dumpResponse(label: string, resp: unknown): void {
  console.log(`\n${"═".repeat(72)}\n  STAGE 4: ${label} — model response\n${"═".repeat(72)}`);
  console.log(JSON.stringify(resp, null, 2));
}

// ─── main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const goal = "open my gmail and check the status of latest amazon package";
  const workId = "render-flow-test-" + Date.now();

  dumpSnapshot("Gmail inbox (post-load fixture)", gmailSnapshot);
  const ctx = renderContext(gmailSnapshot, null, [], { facts: [] }, {
    goal,
    goalKeywords: extractGoalKeywords(goal),
    goalBanner: detectGoalMatch(goal, {
      url: gmailSnapshot.url,
      title: gmailSnapshot.title,
      pagePurpose: gmailSnapshot.pagePurpose,
      bodyText: gmailSnapshot.bodyTextSnippet,
    }).banner,
    stepInfo: { index: 1, totalBudget: 60_000, elapsedMs: 0, budgetMs: 60_000, pageIdentity: gmailSnapshot.pageIdentity ?? "" },
  });
  dumpContext("Gmail inbox (post-load fixture)", ctx);
  dumpPrompt(goal, ctx);

  console.log(`\n${"═".repeat(72)}\n  POST → ${PLAN_URL}\n${"═".repeat(72)}`);
  const resp = await callPlanner(workId, goal, ctx);
  dumpResponse("gpt-4o-mini on the Gmail fixture", resp);
  console.log(`\n[run log file] services/brotto-orchestrator/runs/${workId}-*.log — full request body captured server-side.`);
}

main().catch((err) => {
  console.error("[test-render-flow] failed:", err);
  process.exit(1);
});
