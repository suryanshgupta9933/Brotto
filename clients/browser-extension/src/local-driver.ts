import type { ObservationV1, SemanticTarget } from "@fara-platform/fara-action-schema";
import { captureObservation } from "./canonical/observation";
import * as debuggerModule from "./debugger";

const MAX_STEPS = 12;
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
  onStep: (step: { index: number; action: string; result: string }) => void;
  onLoginRequired: (info: { url: string; domain: string }) => void;
  onComplete: (info: { summary: string; steps: number }) => void;
  onError: (error: { code: string; message: string }) => void;
  onLog?: (message: string) => void;
}

interface PlanningOutcome {
  kind: "action" | "question" | "completion";
  action?: { type?: string; x?: number; y?: number; text?: string; key?: string; url?: string; deltaX?: number; deltaY?: number };
  question?: string;
  summary?: string;
}

function log(opts: LocalDriverOptions, message: string): void {
  opts.onLog?.(message);
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
export function renderObservationForPlanner(obs: ObservationV1, history: Array<{ action: string; result: string }>): string {
  const lines: string[] = [];
  lines.push(`URL: ${obs.url}`);
  lines.push(`Title: ${obs.title}`);
  lines.push("");
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
  if (obs.accessibilityNodes && obs.accessibilityNodes.length > 0) {
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

async function waitForNetworkIdle(tabId: number, timeoutMs = 5000): Promise<void> {
  await new Promise<void>((resolve) => {
    const start = Date.now();
    let pendingRequests = 0;
    const off: Array<() => void> = [];
    const onRequest = () => {
      pendingRequests++;
    };
    const onComplete = () => {
      pendingRequests = Math.max(0, pendingRequests - 1);
    };
    // ponytail: best-effort — we can't hook chrome.debugger events from outside
    // the debuggee easily, so just sleep a fixed budget. The planner's
    // description of the new page is usually accurate enough after 500ms.
    void onRequest;
    void onComplete;
    const timer = setTimeout(() => {
      off.forEach((fn) => fn());
      resolve();
    }, timeoutMs);
    const elapsed = () => Date.now() - start;
    const interval = setInterval(() => {
      if (pendingRequests === 0 && elapsed() > 500) {
        clearInterval(interval);
        clearTimeout(timer);
        off.forEach((fn) => fn());
        resolve();
      }
    }, 200);
    off.push(() => clearInterval(interval));
    off.push(() => clearTimeout(timer));
  });
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
  try {
    while (stepIndex < MAX_STEPS) {
      if (opts.signal.aborted) {
        opts.onError({ code: "ABORTED", message: "Loop was cancelled" });
        return;
      }
      log(opts, `step ${stepIndex + 1}/${MAX_STEPS}`);
      const obs = await captureForDriver(tabId);
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
          // ponytail: the background handler resolves this when login_complete
          // arrives. We expose the resolve via a one-shot listener on a
          // module-level map keyed by tabId.
          pendingLoginResolvers.set(tabId, () => {
            clearInterval(interval);
            opts.signal.removeEventListener("abort", onAbort);
            resolve();
          });
        });
        pendingLoginResolvers.delete(tabId);
        log(opts, "user confirmed login — resuming loop");
        await waitForNetworkIdle(tabId).catch(() => undefined);
        continue;
      }
      const context = renderObservationForPlanner(obs, history);
      const outcome = await callPlanner(opts, context);
      if (opts.signal.aborted) {
        opts.onError({ code: "ABORTED", message: "Loop was cancelled" });
        return;
      }
      if (outcome.kind === "completion") {
        opts.onComplete({ summary: outcome.summary ?? "task completed", steps: stepIndex + 1 });
        return;
      }
      if (outcome.kind === "question") {
        log(opts, `planner returned a question, treating as no-op: ${outcome.question?.slice(0, 80)}`);
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      const action = outcome.action ?? { type: "unknown" };
      const desc = describeAction(action);
      let result: string;
      try {
        result = await executeAction(tabId, action);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(opts, `action failed: ${message}`);
        opts.onError({ code: "ACTION_FAILED", message });
        return;
      }
      history.push({ action: desc, result });
      opts.onStep({ index: stepIndex, action: desc, result });
      await waitForNetworkIdle(tabId).catch(() => undefined);
      await new Promise((r) => setTimeout(r, POST_ACTION_PAUSE_MS));
      stepIndex++;
    }
    opts.onError({ code: "MAX_STEPS_EXCEEDED", message: `Did not complete in ${MAX_STEPS} steps` });
  } finally {
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
