import type { ObservationV1, SemanticTarget } from "@brotto/brotto-action-schema";
import { captureObservation } from "./canonical/observation";
import * as debuggerModule from "./debugger";

// ponytail: high enough that realistic multi-step research completes. The
// bound is a safety net, not a target — earlier 12 made the agent feel rushed.
const MAX_STEPS = 50;
const HISTORY_LIMIT = 6;
// ponytail: per-action pause so the demo loop can be cancelled cleanly and
// the model isn't given time to fly past user-visible state changes.
const POST_ACTION_PAUSE_MS = 400;

export interface LocalDriverOptions {
  plannerUrl: string;
  goal: string;
  startingUrl?: string;
  signal: AbortSignal;
  onTabOpened: (tabId: number) => void;
  // ponytail: tab lifecycle events for the side-panel "tabs" row. Keeps the
  // user oriented when the agent opens/closes/follows external links. Without
  // this a stray window.open or target=_blank navigation is invisible to the
  // user until the next observation lands.
  onTabEvent?: (event: { kind: "opened" | "closed" | "navigated" | "focused"; tabId: number; url: string; title: string }) => void;
  onStep: (step: { index: number; action: string; result: string; url: string; screenshot: string | null; iconKind: string; reasoning?: string }) => void;
  onLoginRequired: (info: { url: string; domain: string }) => void;
  // ponytail: finalAnswer is the user's actual answer in plain English. Comes
  // from the planner's terminate.finalAnswer; older planners emit a generic
  // summary instead and we fall back to it.
  onComplete: (info: { summary: string; steps: number; finalAnswer?: string }) => void;
  onError: (error: { code: string; message: string }) => void;
  onLog?: (message: string) => void;
  // ponytail: emit when the agent detects it can't make progress (same action
  // repeated, repeated failures, etc.). Side panel surfaces an input box so the
  // user can inject guidance. The next planner call gets the answer appended
  // to the goal.
  onClarify: (info: { reason: string; question: string; context: string }) => Promise<string>;
  // ponytail: emit when an action might be destructive. Side panel surfaces
  // an Approve/Deny prompt. Resolves to true if user approves.
  onApprovalRequired: (info: { reason: string; action: { type?: string; url?: string }; url: string }) => Promise<boolean>;
  // ponytail: optional callback invoked when a clarifying question is
  // answered, so the caller can log it back through the planner history.
  onAnswered?: (info: { question: string; answer: string }) => void;
  // ponytail: optional callback when approval is granted or denied.
  onApprovalResolved?: (info: { approved: boolean; action: { type?: string } }) => void;
}

interface MemoryUpdate {
  key: string;
  value: string;
  evidence: string;
}

interface PlanningOutcome {
  kind: "action" | "question" | "completion";
  // ponytail: per-step reasoning + finalAnswer. Planner emits `reasoning` on
  // every action; terminate actions also carry `finalAnswer`. Legacy field
  // `answer` is still accepted (mapped to finalAnswer by the planner).
  action?: { type?: string; x?: number; y?: number; text?: string; key?: string; url?: string; deltaX?: number; deltaY?: number; answer?: string; finalAnswer?: string; reasoning?: string; memoryUpdates?: MemoryUpdate[] };
  question?: string;
  summary?: string;
}

// ponytail: harness-owned working memory. Merges model-proposed updates with
// dedup-by-key. Renders into the planner context so the model sees findings
// across turns without re-discovering them.
class WorkingMemory {
  private facts = new Map<string, MemoryUpdate>();
  merge(updates: MemoryUpdate[] | undefined): void {
    if (!updates) return;
    for (const u of updates) {
      if (!u || typeof u.key !== "string") continue;
      const key = u.key.trim();
      const value = typeof u.value === "string" ? u.value.trim() : "";
      if (!key || !value) continue;
      const ev = typeof u.evidence === "string" ? u.evidence.trim() : "";
      const existing = this.facts.get(key);
      if (!existing || (!existing.evidence && ev)) {
        this.facts.set(key, { key, value, evidence: ev });
      }
    }
  }
  toView(): MemoryUpdate[] {
    return Array.from(this.facts.values());
  }
  get size(): number { return this.facts.size; }
}

function renderMemoryBlock(facts: MemoryUpdate[]): string {
  if (facts.length === 0) return "";
  const lines = facts.map((f) => {
    const ev = f.evidence ? `  (evidence: ${f.evidence})` : "";
    return `  - ${f.key} = "${f.value}"${ev}`;
  });
  return `Working memory (structured findings — do not re-record; carry these forward):\n${lines.join("\n")}\n\n`;
}

function log(opts: LocalDriverOptions, message: string): void {
  // ponytail: internal loop liveness goes to the background service worker
  // console (chrome://extensions → Inspect views). The side panel used to
  // surface every one of these as a system message in the chat which drowned
  // out the actual agent activity. Re-enable UI logging via opts.onLog if a
  // future debug build wants chat-level detail.
  console.log(`[local-driver] ${message}`);
  opts.onLog?.(message);
}

// ponytail: signature-based stagnation. Normalize action and observation to
// stable strings, then count identicals in a rolling window. Tighter than
// the original 5-of-8 — gpt-4o-mini can click the same wrong coordinate 4
// times without noticing the page didn't change. 3-of-6 catches the
// "looping on one spot" pattern after just 3 repeats; observation-stuck
// (page unchanged across multiple actions) is the most reliable signal.
export interface StagnationSignal {
  kind: "repeated_action" | "repeated_observation";
  signature: string;
  count: number;
  message: string;
}

const STAGNATION_REPEAT_THRESHOLD = 3;
const STAGNATION_WINDOW = 6;

export function actionSignature(action: { type?: string; url?: string; x?: number; y?: number; text?: string; key?: string }): string {
  const t = (action.type ?? "unknown").toLowerCase();
  switch (t) {
    case "visit_url": return `visit_url:${(action.url ?? "").trim()}`;
    case "left_click":
    case "double_click":
    case "right_click":
    case "mouse_move": return `${t}:${action.x ?? 0},${action.y ?? 0}`;
    case "insert_text": return `insert_text:${(action.text ?? "").slice(0, 40)}`;
    case "key": return `key:${action.key ?? ""}`;
    case "scroll":
    case "screenshot":
    case "wait":
    case "terminate":
    case "ask_user_question":
    case "history_back": return t;
    default: return t;
  }
}

export function observationSignature(obs: { url?: string; title?: string; elements?: Array<{ id?: string }> }): string {
  const firstId = obs.elements && obs.elements.length > 0 ? obs.elements[0]?.id ?? "" : "";
  return `${(obs.url ?? "").trim()}|${(obs.title ?? "").trim()}|${firstId}`;
}

export function detectStagnation(actionSigs: string[], obsSigs: string[]): StagnationSignal | null {
  const actionHit = lastNIdentical(actionSigs);
  if (actionHit) {
    return {
      kind: "repeated_action",
      signature: actionHit,
      count: STAGNATION_REPEAT_THRESHOLD,
      message: `STOP — you've called "${actionHit}" ${STAGNATION_REPEAT_THRESHOLD}+ times in a row. Repeating the same click coordinate won't change the result. Two possibilities: (1) the page already moved (the title/URL changed in a previous step) — read the new page text and look for the answer there, do NOT click again. (2) the click missed the target — pick a DIFFERENT coordinate or element. Do NOT call the same action again on the next turn.`,
    };
  }
  const obsHit = lastNIdentical(obsSigs);
  if (obsHit) {
    return {
      kind: "repeated_observation",
      signature: obsHit,
      count: STAGNATION_REPEAT_THRESHOLD,
      message: `STOP — the page hasn't changed for ${STAGNATION_REPEAT_THRESHOLD}+ steps. Your actions are not landing. Either (1) you've already found the answer in the current page text and should call terminate(finalAnswer='<value>'), or (2) your clicks are missing the target and you need to click a different element. Read the current page text carefully — the answer may already be there.`,
    };
  }
  return null;
}

function lastNIdentical(arr: string[]): string | null {
  if (arr.length < STAGNATION_REPEAT_THRESHOLD) return null;
  const tail = arr.slice(-STAGNATION_WINDOW);
  if (tail.length < STAGNATION_REPEAT_THRESHOLD) return null;
  const recent = tail.slice(-STAGNATION_REPEAT_THRESHOLD);
  const ref = recent[0];
  return recent.every((s) => s === ref) ? ref : null;
}

// ponytail: detect when the model is repeating the same action without state
// change. Three identical consecutive actions (same type + same target signature)
// = stuck. Surfacing as a clarifying question gives the user a chance to
// redirect.
export function detectLoop(history: Array<{ action: string; result: string }>, threshold = 3): { loop: boolean; action: string } {
  if (history.length < threshold) return { loop: false, action: "" };
  const tail = history.slice(-threshold).map((h) => h.action);
  if (tail.every((a) => a === tail[0])) return { loop: true, action: tail[0] };
  return { loop: false, action: "" };
}

// ponytail: detect when the same action has failed consecutively. Three
// failures on the same action = likely a broken page state, not a planning
// problem. Convert to clarifying question.
export interface FailureRecord {
  action: string;
  error: string;
  ts: number;
}

export function detectStuckFailures(
  failures: FailureRecord[],
  threshold = 3,
): { stuck: boolean; action: string; error: string } {
  if (failures.length < threshold) return { stuck: false, action: "", error: "" };
  const tail = failures.slice(-threshold);
  if (tail.every((f) => f.action === tail[0].action)) {
    return { stuck: true, action: tail[0].action, error: tail[0].error };
  }
  return { stuck: false, action: "", error: "" };
}

// ponytail: heuristic for "destructive" actions that should require approval.
// Click + insert_text on a page mentioning payment/checkout/delete/etc = pause.
// Visit_url to a banking or payment domain = pause.
const APPROVAL_KEYWORDS = [
  "delete", "remove", "pay", "checkout", "purchase", "confirm purchase",
  "send money", "transfer", "wire", "subscription",
];

const APPROVAL_DOMAINS = [
  "checkout", "pay.", "payments.", "stripe.com", "banking", "/pay/",
];

export function needsApproval(
  action: { type?: string; url?: string; text?: string },
  observation: { url: string; bodyText?: string; accessibilityNodes?: Array<{ name?: string; value?: string; role?: string }> },
): { needs: boolean; reason: string } {
  // ponytail: prefer bodyText (smart-extracted structured text) over
  // accessibilityNodes. Falls back to accessibilityNodes for older builds.
  const pageText = (
    observation.bodyText ??
    (observation.accessibilityNodes ?? [])
      .map((n) => `${n.name ?? ""} ${n.value ?? ""}`)
      .join(" ")
  ).toLowerCase();
  if (action.type === "visit_url" && typeof action.url === "string") {
    for (const kw of APPROVAL_DOMAINS) {
      if (action.url.toLowerCase().includes(kw)) {
        return { needs: true, reason: `Navigate to "${action.url}" matches approval pattern "${kw}"` };
      }
    }
  }
  if (action.type === "left_click" || action.type === "double_click") {
    for (const kw of APPROVAL_KEYWORDS) {
      if (pageText.includes(kw)) {
        return { needs: true, reason: `Page contains "${kw}" — clicking may be destructive` };
      }
    }
  }
  if (action.type === "insert_text" && typeof action.text === "string") {
    const lcText = action.text.toLowerCase();
    for (const kw of APPROVAL_KEYWORDS) {
      if (lcText.includes(kw) && pageText.includes(kw)) {
        return { needs: true, reason: `Typing "${action.text}" on a page mentioning "${kw}" may be destructive` };
      }
    }
  }
  return { needs: false, reason: "" };
}

function describeAction(a: { type?: string; x?: number; y?: number; text?: string; key?: string; url?: string }): string {
  switch (a.type) {
    case "left_click":
    case "double_click":
    case "right_click":
      return `${a.type} at (${a.x}, ${a.y})`;
    case "insert_text":
      return `insert_text "${(a.text ?? "").slice(0, 60)}"`;
    case "key":
      return `key "${a.key ?? ""}"`;
    case "visit_url":
      return `visit_url ${a.url ?? ""}`;
    case "scroll":
      return `scroll`;
    case "wait":
      return `wait`;
    case "terminate":
      return `terminate`;
    default:
      return a.type ?? "unknown";
  }
}

// ponytail: convert canonical ObservationV1 to the harness text format the
// OpenAI-compatible planner expects. Mirrors scripts/context-builder.ts so the
// model sees the same shape whether the observation came from Playwright or the
// extension.
export function renderObservationForPlanner(
  obs: ObservationV1,
  history: Array<{ action: string; result: string }>,
  guidance?: string,
  memory?: MemoryUpdate[],
): string {
  const lines: string[] = [];
  // ponytail: structured working memory rendered FIRST so the model sees
  // findings before any navigation prose. Empty blocks skipped.
  if (memory && memory.length > 0) {
    lines.push(renderMemoryBlock(memory).trimEnd());
    lines.push("");
  }
  lines.push(`URL: ${obs.url}`);
  lines.push(`Title: ${obs.title}`);
  lines.push("");
  if (guidance && guidance.length > 0) {
    lines.push(`User guidance: ${guidance}`);
    lines.push("");
  }
  lines.push("Elements (use IDs, click coords inline):");
  for (const t of obs.semanticTargets) {
    if (!t.visible) continue;
    const bb = t.boundingBox;
    const cx = Math.round(bb.x + bb.width / 2);
    const cy = Math.round(bb.y + bb.height / 2);
    const id = t.stableRef ?? t.targetId.slice(0, 8);
    const name = t.accessibleName?.text ?? t.attributes?.id ?? t.attributes?.name ?? "";
    const value = t.control.kind === "input" ? (t.control as { value?: string }).value ?? "" : "";
    const type = t.control.kind === "input" ? ` type=${(t.control as { type?: string }).type ?? ""}` : "";
    const tags: string[] = [];
    if (value) tags.push(`value="${value}"`);
    if (t.attributes?.placeholder) tags.push(`placeholder="${t.attributes.placeholder}"`);
    if (t.attributes?.href) tags.push(`href="${t.attributes.href}"`);
    const tagStr = tags.length ? ` (${tags.join(", ")})` : "";
    const nameStr = name ? ` "${name}"` : "";
    lines.push(`  [${id}] <${t.tag}>${nameStr}${type}${tagStr} click=(${cx}, ${cy})`);
  }
  if (obs.semanticTargets.length === 0) lines.push("  (no interactive elements)");
  if (history.length > 0) {
    const tail = history.slice(-HISTORY_LIMIT);
    lines.push("");
    lines.push("Previous steps (most recent last):");
    tail.forEach((h, i) => lines.push(`  ${i + 1}. ${h.action} → ${h.result}`));
  }
  if (obs.bodyText && obs.bodyText.length > 0) {
    lines.push("");
    lines.push("=== PAGE TEXT (HEADINGS + STATS + LABELS + TEXT — STATS contains the data the user asked for) ===");
    lines.push(obs.bodyText);
    lines.push("=== END PAGE TEXT ===");
  } else if (obs.accessibilityNodes && obs.accessibilityNodes.length > 0) {
    // ponytail: legacy fallback when bodyText isn't present (older extension
    // builds). Caps at 400 chars — keep until every build emits bodyText.
    const text = obs.accessibilityNodes
      .map((n: { name?: string; value?: string }) => n.name ?? n.value ?? "")
      .filter((s: string) => s.length > 0)
      .join(" ")
      .slice(0, 400);
    if (text) {
      lines.push("");
      lines.push(`Page text (first 400 chars): "${text}"`);
    }
  }
  return lines.join("\n");
}

// ponytail: login-page detector. Looks for a visible password input inside a
// form with a submit button. Heuristic only — false positives are OK because
// the user can ignore the prompt and click "Skip".
export function looksLikeLoginPage(obs: ObservationV1): { login: boolean; domain: string } {
  const hasPassword = obs.semanticTargets.some(
    (t: SemanticTarget) => t.control.kind === "input" && (t.control as { type?: string }).type === "password" && t.visible,
  );
  if (!hasPassword) return { login: false, domain: "" };
  const hasSubmit = obs.semanticTargets.some((t: SemanticTarget) => {
    const tag = t.tag.toLowerCase();
    const ctl = t.control;
    if (tag === "button") return true;
    if (tag === "input" && ctl.kind === "input" && (ctl as { type?: string }).type === "submit") return true;
    return false;
  });
  if (!hasSubmit) return { login: false, domain: "" };
  let domain = "";
  try {
    domain = new URL(obs.url).hostname;
  } catch {
    domain = "";
  }
  return { login: true, domain };
}

async function callPlanner(
  opts: LocalDriverOptions,
  context: string,
): Promise<PlanningOutcome> {
  // ponytail: short retry with backoff for transient 429s (matches demo-server).
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${opts.plannerUrl}/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workId: "ext-" + Date.now(),
          sessionId: "00000000-0000-4000-8000-000000000001",
          taskId: "00000000-0000-4000-8000-000000000002",
          goal: opts.goal,
          completionCriteria: [],
          context,
          recentResults: [],
          trajectory: [],
        }),
        signal: opts.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`planner HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return (await res.json()) as PlanningOutcome;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (lastErr.name === "AbortError") throw lastErr;
      const backoffMs = 500 * 2 ** attempt;
      log(opts, `planner call failed (attempt ${attempt + 1}/3), retrying in ${backoffMs}ms: ${lastErr.message}`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr ?? new Error("planner call failed");
}

async function executeAction(tabId: number, action: { type?: string; x?: number; y?: number; text?: string; key?: string; url?: string; deltaX?: number; deltaY?: number }): Promise<string> {
  switch (action.type) {
    case "left_click": {
      await debuggerModule.sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: action.x, y: action.y, button: "left", clickCount: 1 } });
      await debuggerModule.sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: action.x, y: action.y, button: "left", clickCount: 1 } });
      return `clicked (${action.x}, ${action.y})`;
    }
    case "double_click": {
      await debuggerModule.sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: action.x, y: action.y, button: "left", clickCount: 2 } });
      await debuggerModule.sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: action.x, y: action.y, button: "left", clickCount: 2 } });
      return `double-clicked (${action.x}, ${action.y})`;
    }
    case "right_click": {
      await debuggerModule.sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: action.x, y: action.y, button: "right", clickCount: 1 } });
      await debuggerModule.sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: action.x, y: action.y, button: "right", clickCount: 1 } });
      return `right-clicked (${action.x}, ${action.y})`;
    }
    case "insert_text": {
      if (typeof action.text !== "string") throw new Error("insert_text missing text");
      await debuggerModule.sendCommand(tabId, { method: "Input.insertText", params: { text: action.text } });
      return `typed "${action.text.slice(0, 40)}"`;
    }
    case "key": {
      if (typeof action.key !== "string") throw new Error("key missing key");
      await debuggerModule.sendCommand(tabId, { method: "Input.dispatchKeyEvent", params: { type: "keyDown", key: action.key } });
      await debuggerModule.sendCommand(tabId, { method: "Input.dispatchKeyEvent", params: { type: "keyUp", key: action.key } });
      return `pressed ${action.key}`;
    }
    case "visit_url": {
      if (typeof action.url !== "string") throw new Error("visit_url missing url");
      await debuggerModule.sendCommand(tabId, { method: "Page.navigate", params: { url: action.url } });
      return `navigated to ${action.url}`;
    }
    case "scroll": {
      const cx = action.x ?? 640;
      const cy = action.y ?? 360;
      await debuggerModule.sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mouseWheel", x: cx, y: cy, deltaX: action.deltaX ?? 0, deltaY: action.deltaY ?? 100 } });
      return `scrolled`;
    }
    case "wait":
      await new Promise((r) => setTimeout(r, 1000));
      return "waited 1s";
    case "history_back": {
      const steps = typeof (action as { steps?: number }).steps === "number" ? (action as { steps: number }).steps : 1;
      await debuggerModule.sendCommand(tabId, { method: "Page.navigateToHistoryEntry", params: {} }).catch(() => undefined);
      // chrome.debugger lacks a direct "back" — use Page.navigate with referrer reset via Runtime.evaluate.
      await debuggerModule.sendCommand(tabId, { method: "Runtime.evaluate", params: { expression: "history.back()" } });
      return `went back ${steps}`;
    }
    case "mouse_move": {
      await debuggerModule.sendCommand(tabId, { method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x: action.x ?? 0, y: action.y ?? 0 } });
      return `moved to (${action.x}, ${action.y})`;
    }
    case "screenshot":
      // ponytail: harness already captures a screenshot per step via captureVisibleTab.
      // Acknowledge so the model can use this as a no-op "let me look" beat.
      return "screenshot captured";
    case "memorize_fact":
      // ponytail: model-only working memory. The fact is carried via the next
      // step's context (renderHistory). Acknowledge so the loop doesn't crash.
      return `memorized: ${(action as { fact?: string }).fact ?? "(no fact)"}`;
    case "ask_user_question":
      // ponytail: in a real desktop/extension UI this would pop a prompt. The
      // demo loop just treats it as a question beat and continues.
      return `asked: ${(action as { question?: string }).question ?? "(no question)"}`;
    case "terminate":
      return "terminate";
    default:
      throw new Error(`unknown action type: ${action.type}`);
  }
}

async function openNewTab(startingUrl: string | undefined): Promise<number> {
  const url = startingUrl && /^https?:\/\//i.test(startingUrl) ? startingUrl : "about:blank";
  const tab = await chrome.tabs.create({ url, active: true });
  if (tab.id === undefined) throw new Error("failed to create tab");
  // ponytail: wait for the tab to settle on the initial URL before attaching
  // the debugger. about:blank settles immediately; http(s) pages need load.
  if (url !== "about:blank") {
    await new Promise<void>((resolve) => {
      const listener = (changedTabId: number, info: chrome.tabs.TabChangeInfo) => {
        if (changedTabId === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      // ponytail: 15s cap so we don't hang on dead pages.
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 15_000);
    });
  }
  return tab.id;
}

async function captureForDriver(tabId: number): Promise<ObservationV1> {
  return captureObservation(tabId);
}

// ponytail: capture with a hard timeout. Real Chrome's debugger.sendCommand
// can hang indefinitely if the tab is in a weird state (loading, crashed,
// detached). The race in captureVisibleTab is the usual culprit. Cap at
// 15s so the loop survives and surfaces the timeout as a recoverable
// error.
async function captureObservationWithTimeout(tabId: number, timeoutMs: number): Promise<ObservationV1> {
  return Promise.race([
    captureObservation(tabId),
    new Promise<ObservationV1>((_, reject) => {
      setTimeout(() => reject(new Error(`captureObservation timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}
const captureForDriverWithTimeout = (tabId: number, timeoutMs: number) => captureObservationWithTimeout(tabId, timeoutMs);

// ponytail: budgeted wait. We can't hook Network.requestWillBeSent without
// keeping a long-lived debugger session, and the existing Page lifecycle
// hooks are good enough — the planner's description of the new page is
// usually accurate after a short pause. Sleep for `timeoutMs` (default
// 500ms) and proceed.
async function waitForNetworkIdle(_tabId: number, timeoutMs = 500): Promise<void> {
  await new Promise((r) => setTimeout(r, timeoutMs));
}

export async function runLocalLoop(opts: LocalDriverOptions): Promise<void> {
  log(opts, `opening new tab${opts.startingUrl ? ` at ${opts.startingUrl}` : ""}`);
  let tabId: number;
  try {
    tabId = await openNewTab(opts.startingUrl);
  } catch (err) {
    opts.onError({ code: "TAB_OPEN_FAILED", message: err instanceof Error ? err.message : String(err) });
    return;
  }
  opts.onTabOpened(tabId);

  try {
    await debuggerModule.attachToTab(tabId);
  } catch (err) {
    opts.onError({ code: "DEBUGGER_ATTACH_FAILED", message: err instanceof Error ? err.message : String(err) });
    await chrome.tabs.remove(tabId).catch(() => undefined);
    return;
  }

  const history: Array<{ action: string; result: string }> = [];
  let stepIndex = 0;
  const failures: FailureRecord[] = [];
  let injectedGuidance: string | undefined;
  const memory = new WorkingMemory();
  // ponytail: stagnation tracking. Signature windows catch "model is stuck on
  // the same action" or "page hasn't changed" before the action budget burns
  // out. Bounded counter ends the loop with a clear blocked result instead of
  // burning MAX_STEPS in a tight repeat.
  const actionSigs: string[] = [];
  const obsSigs: string[] = [];
  let stagnationHits = 0;
  const STAGNATION_LIMIT = 2;
  // ponytail: track tab lifecycle (open / close / navigate / focus) for the
  // side-panel "Tabs" row. Chrome fires these globally; filter to tabs that
  // weren't around when the loop started — we don't want to surface every
  // backgrounded Gmail tab the user already had open. Detach listeners in
  // `finally` so the side panel stops receiving events when the loop ends.
  const initialTabIds = new Set<number>();
  try {
    const existing = await chrome.tabs.query({});
    for (const t of existing) if (typeof t.id === "number") initialTabIds.add(t.id);
  } catch {
    /* tab query failed — proceed without baseline */
  }
  const tabJournal = new Map<number, { url: string; title: string; openedAt: number }>();
  const emitTab = (
    kind: "opened" | "closed" | "navigated" | "focused",
    tab: chrome.tabs.Tab,
  ) => {
    if (typeof tab.id !== "number") return;
    const url = tab.url ?? "";
    const title = tab.title ?? "";
    if (kind === "opened" || kind === "navigated") {
      tabJournal.set(tab.id, { url, title, openedAt: Date.now() });
    } else if (kind === "closed") {
      tabJournal.delete(tab.id);
    }
    try {
      opts.onTabEvent?.({ kind, tabId: tab.id, url, title });
    } catch {
      /* listener threw — swallow, don't kill the loop */
    }
  };
  const tabListeners: Array<() => void> = [];
  if (chrome.tabs?.onCreated) {
    const handler = (tab: chrome.tabs.Tab) => {
      if (typeof tab.id === "number" && !initialTabIds.has(tab.id)) emitTab("opened", tab);
    };
    chrome.tabs.onCreated.addListener(handler);
    tabListeners.push(() => chrome.tabs.onCreated.removeListener(handler));
  }
  if (chrome.tabs?.onRemoved) {
    const handler = (tabId: number) => {
      if (!initialTabIds.has(tabId)) {
        const journal = tabJournal.get(tabId);
        tabJournal.delete(tabId);
        try { opts.onTabEvent?.({ kind: "closed", tabId, url: journal?.url ?? "", title: journal?.title ?? "" }); } catch { /* */ }
      }
    };
    chrome.tabs.onRemoved.addListener(handler);
    tabListeners.push(() => chrome.tabs.onRemoved.removeListener(handler));
  }
  if (chrome.tabs?.onUpdated) {
    const handler = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (initialTabIds.has(tabId)) return;
      if (changeInfo.url !== undefined || changeInfo.title !== undefined || changeInfo.status === "complete") {
        emitTab("navigated", tab);
      }
    };
    chrome.tabs.onUpdated.addListener(handler);
    tabListeners.push(() => chrome.tabs.onUpdated.removeListener(handler));
  }
  if (chrome.tabs?.onActivated) {
    const handler = (info: chrome.tabs.TabActiveInfo) => {
      if (!initialTabIds.has(info.tabId)) emitTab("focused", { id: info.tabId, url: "", title: "" } as chrome.tabs.Tab);
    };
    chrome.tabs.onActivated.addListener(handler);
    tabListeners.push(() => chrome.tabs.onActivated.removeListener(handler));
  }
  // ponytail: ensure the agent tab is the active tab in its window before
  // every observation capture. chrome.tabs.captureVisibleTab rejects when the
  // target tab isn't the visible one — and Gmail/real sites briefly switch
  // focus during redirects, causing "Target tab is not the active tab" errors.
  // Cheap (just sets focus) and idempotent.
  async function activateAgentTab(): Promise<void> {
    try {
      await chrome.tabs.update(tabId, { active: true });
    } catch {
      /* tab might be gone — let captureObservation surface the real error */
    }
  }
  let caughtError: Error | null = null;
  try {
    while (stepIndex < MAX_STEPS) {
      if (opts.signal.aborted) {
        opts.onError({ code: "ABORTED", message: "Loop was cancelled" });
        return;
      }
      log(opts, `step ${stepIndex + 1}`);
      await activateAgentTab();
      const obs = await captureForDriverWithTimeout(tabId, 15_000);
      // ponytail: detect login page BEFORE calling the planner so we don't burn
      // a plan step on "click this invisible login form". The model will see
      // the post-login observation on the next iteration.
      const login = looksLikeLoginPage(obs);
      if (login.login) {
        log(opts, `login page detected at ${login.domain} — pausing for user`);
        opts.onLoginRequired({ url: obs.url, domain: login.domain });
        // ponytail: pause until the user clicks Continue. We block on a
        // shared promise controlled by the background handler.
        await new Promise<void>((resolve) => {
          const onAbort = () => resolve();
          opts.signal.addEventListener("abort", onAbort, { once: true });
          const interval = setInterval(() => {
            if (opts.signal.aborted) {
              clearInterval(interval);
              resolve();
            }
          }, 500);
          pendingLoginResolvers.set(tabId, () => {
            clearInterval(interval);
            opts.signal.removeEventListener("abort", onAbort);
            resolve();
          });
        });
        pendingLoginResolvers.delete(tabId);
        log(opts, "user confirmed login — resuming loop");
        injectedGuidance = undefined;
        await waitForNetworkIdle(tabId).catch(() => undefined);
        continue;
      }
      const context = renderObservationForPlanner(obs, history, injectedGuidance, memory.toView());
      const outcome = await callPlanner(opts, context);
      if (opts.signal.aborted) {
        opts.onError({ code: "ABORTED", message: "Loop was cancelled" });
        return;
      }
      if (outcome.kind === "completion") {
        // ponytail: completion path doesn't carry finalAnswer (the planner
        // signals termination via action:terminate in this codebase). Fall
        // back to the summary so the UI still has something to show.
        opts.onComplete({ summary: outcome.summary ?? "task completed", steps: stepIndex + 1, finalAnswer: outcome.summary });
        return;
      }
      if (outcome.kind === "question") {
        // ponytail: planner can also emit a question. Surface it to the user,
        // append their answer to the goal as guidance for the next iteration.
        const question = outcome.question ?? "The agent needs more information.";
        const answer = await opts.onClarify({
          reason: "The planner asked a question",
          question,
          context: question,
        });
        injectedGuidance = answer;
        opts.onAnswered?.({ question, answer });
        continue;
      }
      const action = outcome.action ?? { type: "unknown" };
      // ponytail: merge working-memory updates proposed by the planner BEFORE
      // validating termination — a valid termination may rely on a finding that
      // was just recorded this turn.
      memory.merge(action.memoryUpdates);
      // ponytail: model emits terminate as an action (not a completion).
      if (action.type === "terminate") {
        log(opts, `model called terminate at step ${stepIndex + 1}`);
        // ponytail: prefer the planner's finalAnswer (the user's actual answer
        // in plain English). Fall back to legacy `answer` or generic message.
        const finalAnswer = typeof action.finalAnswer === "string" && action.finalAnswer.length > 0
          ? action.finalAnswer
          : typeof action.answer === "string" && action.answer.length > 0
            ? action.answer
            : "";
        // ponytail: terminate without finalAnswer is the exact failure mode the
        // planner normalizes server-side. If it slipped through (legacy
        // endpoint, direct schema), treat as a clarifying question so the loop
        // continues instead of presenting an empty result.
        if (!finalAnswer) {
          log(opts, "terminate without finalAnswer — re-prompting as a question");
          const answer = await opts.onClarify({
            reason: "terminate without finalAnswer",
            question: "The agent tried to end the task without providing an answer. What should it report?",
            context: memory.toView().map((f) => `${f.key}=${f.value}`).join("; "),
          });
          injectedGuidance = `Final answer to report: ${answer}. Use terminate(finalAnswer='<value>') next time.`;
          opts.onAnswered?.({ question: "terminate without finalAnswer", answer });
          continue;
        }
        opts.onComplete({ summary: finalAnswer, steps: stepIndex + 1, finalAnswer });
        return;
      }
      // ponytail: pause before destructive actions. The user sees the action
      // preview and approves or denies. Without this the agent could click
      // through a payment confirmation without checking.
      const approval = needsApproval(action, obs);
      if (approval.needs && opts.onApprovalRequired) {
        log(opts, `approval required: ${approval.reason}`);
        const approved = await opts.onApprovalRequired({
          reason: approval.reason,
          action: { type: action.type, url: action.url },
          url: obs.url,
        });
        opts.onApprovalResolved?.({ approved, action: { type: action.type } });
        if (!approved) {
          log(opts, "user denied approval — aborting task");
          opts.onError({ code: "APPROVAL_DENIED", message: `User denied: ${approval.reason}` });
          return;
        }
        log(opts, "user approved — proceeding");
      }
      const desc = describeAction(action);
      const iconKind = (action.type ?? "unknown").toString();
      let result: string;
      try {
        result = await executeAction(tabId, action);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(opts, `action failed (${failures.length + 1} in a row): ${message}`);
        failures.push({ action: desc, error: message, ts: Date.now() });
        // ponytail: same action failing 3+ times in a row = stuck. Surface a
        // clarifying question instead of crashing the loop.
        const stuck = detectStuckFailures(failures);
        if (stuck.stuck) {
          const answer = await opts.onClarify({
            reason: `Action "${stuck.action}" has failed ${failures.length} times in a row`,
            question: `The agent can't get "${stuck.action}" to work. The last error was: ${stuck.error}. What should it do instead?`,
            context: stuck.error,
          });
          injectedGuidance = answer;
          opts.onAnswered?.({ question: stuck.error, answer });
          failures.length = 0;
          continue;
        }
        opts.onError({ code: "ACTION_FAILED", message });
        return;
      }
      await waitForNetworkIdle(tabId).catch(() => undefined);
      await new Promise((r) => setTimeout(r, POST_ACTION_PAUSE_MS));
      let screenshot: string | null = null;
      let postUrl = obs.url;
      try {
        await activateAgentTab();
        const postObs = await captureObservationWithTimeout(tabId, 15_000);
        screenshot = postObs.screenshot && postObs.screenshot.data.length > 0 ? postObs.screenshot.data : null;
        postUrl = postObs.url;
      } catch (err) {
        log(opts, `post-action observation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      history.push({ action: desc, result });
      failures.length = 0;
      // ponytail: pass the planner's one-sentence reasoning to the UI. The
      // side panel uses it as the assistant bubble title instead of the raw
      // `desc` (which is the tool call like "visit_url ...").
      opts.onStep({ index: stepIndex, action: desc, result, url: postUrl, screenshot, iconKind, reasoning: action.reasoning });
      // ponytail: signature-based stagnation. Track normalized action+post
      // observation signatures; when 5+ of the last 8 match, surface a
      // corrective prompt with the exact guidance. Bounded by STAGNATION_LIMIT
      // so a stuck loop ends with a blocked result, not a silent burn.
      actionSigs.push(actionSignature(action));
      obsSigs.push(observationSignature({ url: postUrl, title: obs.title, elements: obs.semanticTargets.slice(0, 1).map((t: SemanticTarget) => ({ id: t.stableRef ?? t.targetId.slice(0, 8) })) }));
      const stagnation = detectStagnation(actionSigs, obsSigs);
      if (stagnation) {
        stagnationHits++;
        log(opts, `stagnation: ${stagnation.kind} signature="${stagnation.signature}" hit ${stagnationHits}/${STAGNATION_LIMIT}`);
        if (stagnationHits >= STAGNATION_LIMIT) {
          // ponytail: bounded break. Memory is preserved in the blocked result
          // so the user can see what was recorded before the agent gave up.
          const findings = memory.toView();
          const blockedMessage = `${stagnation.message}\n\nFindings so far:\n${findings.map((f) => `  - ${f.key} = "${f.value}"`).join("\n") || "  (none)"}`;
          opts.onError({ code: "STAGNATION", message: blockedMessage });
          return;
        }
        // ponytail: first stagnation hit is a recovery signal — re-prompt with
        // the corrective guidance injected into the next planner call.
        injectedGuidance = stagnation.message;
        opts.onAnswered?.({ question: stagnation.kind, answer: stagnation.message });
      }
      // ponytail: loop detection. Same action 3+ times in a row = stuck.
      // Surface a clarifying question so the user can redirect.
      const loop = detectLoop(history);
      if (loop.loop) {
        log(opts, `loop detected: ${loop.action} repeated ${history.length} times`);
        const answer = await opts.onClarify({
          reason: `Action "${loop.action}" repeated ${history.length} times in a row`,
          question: `The agent keeps doing "${loop.action}" without progress. How should it proceed?`,
          context: loop.action,
        });
        injectedGuidance = answer;
        opts.onAnswered?.({ question: loop.action, answer });
      }
      stepIndex++;
    }
    opts.onError({ code: "MAX_STEPS_EXCEEDED", message: `Did not complete in ${MAX_STEPS} steps` });
  } catch (err) {
    // ponytail: captureObservation timeout or any other loop error would
    // otherwise become an unhandled rejection and silently leave the
    // side panel in RUNNING. Surface as task_failed so the user sees it.
    caughtError = err instanceof Error ? err : new Error(String(err));
    log(opts, `loop crashed: ${caughtError.message}`);
    opts.onError({ code: "LOOP_CRASHED", message: caughtError.message });
  } finally {
    for (const off of tabListeners) { try { off(); } catch { /* */ } }
    await debuggerModule.detachFromTab(tabId).catch(() => undefined);
  }
}

// ponytail: module-level map of pending login pause resolvers, keyed by tabId.
// The background handler resolves these when login_complete arrives.
const pendingLoginResolvers = new Map<number, () => void>();

export function resolveLoginPause(tabId: number): boolean {
  const resolve = pendingLoginResolvers.get(tabId);
  if (resolve === undefined) return false;
  resolve();
  return true;
}
