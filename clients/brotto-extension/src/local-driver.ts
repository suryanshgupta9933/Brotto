import type { ObservationV1, SemanticTarget } from "@brotto/brotto-action-schema";
import { captureSnapshotForDriver } from "./canonical/observation";
import * as debuggerModule from "./debugger";

// ponytail: high enough that realistic multi-step research completes. The
// bound is a safety net, not a target — earlier 12 made the agent feel rushed.
const MAX_STEPS = 50;
const HISTORY_LIMIT = 10;
// ponytail: capture timeout bumped to 25s after slice E added replay-ready
// fields (pageIdentity, links, buttons, pagePurpose). The page-context
// script now does significantly more DOM walking — on heavy SPAs
// (GitHub, Gmail, Reddit) it can take 15-20s. The 15s ceiling caused
// LOOP_CRASHED on the very first capture.
const CAPTURE_TIMEOUT_MS = 25_000;
// ponytail: per-action pause so the demo loop can be cancelled cleanly and
// the model isn't given time to fly past user-visible state changes.
const POST_ACTION_PAUSE_MS = 400;

export interface LocalDriverOptions {
  plannerUrl: string;
  goal: string;
  startingUrl?: string;
  signal: AbortSignal;
  // ponytail: stable per-task id so the demo-server's turn counter can
  // reset between runs (rather than incrementing forever across tasks).
  taskId?: string;
  // ponytail: per-iteration wall-clock budget in ms. Default 60s. When
  // exceeded the loop surfaces a clarifying question to the user.
  stepBudgetMs?: number;
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
  // ponytail: true when the planner returned a corrective QuestionProposal
  // because the model emitted prose without a tool call. The local driver
  // counts consecutive prose-only responses and fails after 2.
  proseOnly?: boolean;
  // ponytail: true when the planner emitted a corrective QuestionProposal
  // because the model's tool call failed validation (missing fields, bad
  // arguments). Same UX as proseOnly — silent internal correction, never
  // surfaced to the user as an input card.
  toolError?: boolean;
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

// ponytail: page-identity stagnation. The Observation's `pageIdentity` is a
// SHA-256 over a normalized AX-subtree dump — stable across re-renders,
// flips when navigation actually happens. 3 consecutive identical
// identities = the agent's clicks aren't landing on a new page. This
// replaces the older obs-sig heuristic (which used only the first
// semanticTarget's stableRef and drifted on every render).
export function detectPageStagnation(pageIdentities: string[]): StagnationSignal | null {
  if (pageIdentities.length < STAGNATION_REPEAT_THRESHOLD) return null;
  const tail = pageIdentities.slice(-STAGNATION_WINDOW);
  if (tail.length < STAGNATION_REPEAT_THRESHOLD) return null;
  const recent = tail.slice(-STAGNATION_REPEAT_THRESHOLD);
  const ref = recent[0];
  if (ref.length === 0) return null; // empty pageIdentity = uncomputable, skip
  return recent.every((s) => s === ref)
    ? {
        kind: "repeated_observation",
        signature: ref,
        count: STAGNATION_REPEAT_THRESHOLD,
        message: `STOP — the page hasn't changed for ${STAGNATION_REPEAT_THRESHOLD}+ steps (same page identity). Your clicks aren't navigating to a new page. Either (1) you've already found the answer in the current page text and should call terminate(finalAnswer='<value>'), or (2) your clicks are missing the target — pick a DIFFERENT element or read the page's anchors/buttons to find a different path.`,
      }
    : null;
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
// ponytail: detect when the same action string repeats in history. Three
// identical consecutive actions (same description, e.g. "scroll") = stuck.
// NOTE: pure scroll repetition is intentional on long pages, so the loop
// threshold is 5 for scroll-only patterns (agent may need to scroll several
// times). For other actions (click coord, visit_url) 3 is fine.
export function detectLoop(history: Array<{ action: string; result: string }>, threshold = 3): { loop: boolean; action: string } {
  if (history.length < threshold) return { loop: false, action: "" };
  const tail = history.slice(-threshold).map((h) => h.action);
  const ref = tail[0];
  if (!tail.every((a) => a === ref)) return { loop: false, action: "" };
  // ponytail: pure scroll loops get extra rope — scrolling multiple times is
  // often intentional on paginated or long-scroll pages like GitHub repos.
  // Only raise the alarm if scroll has looped threshold+2 times.
  if (ref === "scroll") {
    const scrollThreshold = threshold + 2;
    if (history.length < scrollThreshold) return { loop: false, action: "" };
    const scrollTail = history.slice(-scrollThreshold).map((h) => h.action);
    if (!scrollTail.every((a) => a === "scroll")) return { loop: false, action: "" };
  }
  return { loop: true, action: ref };
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
  const firstAction = tail[0]?.action ?? "";
  if (tail.every((f) => f.action === firstAction)) {
    return {
      stuck: true,
      action: firstAction,
      error: tail[0]?.error ?? "",

    };
  }
  return { stuck: false, action: "", error: "" };
}

// ponytail: auto-extract structured findings from observation URL, title, and body text
// into WorkingMemory so the agent continuously retains context even if the planner model
// forgets to emit explicit memoryUpdates.
export function autoExtractWorkingMemory(obs: ObservationV1, memory: WorkingMemory): void {
  if (!obs.url || obs.url === "about:blank") return;
  try {
    const u = new URL(obs.url);
    if (u.hostname.includes("github.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length === 1 && !["settings", "notifications", "explore", "orgs", "login"].includes(parts[0]!)) {
        memory.merge([{ key: "profile_username", value: parts[0]!, evidence: obs.url }]);
      } else if (parts.length >= 2 && !["orgs", "settings", "login"].includes(parts[0]!)) {
        memory.merge([{ key: "viewed_repo", value: `${parts[0]}/${parts[1]}`, evidence: obs.url }]);
      }
    }
  } catch { /* invalid URL */ }

  if (obs.bodyText) {
    const cardMatches = obs.bodyText.match(/•\s*([A-Za-z0-9_.-]+)\s+[^•\n]*(?:★|⭐|stars?)\s*(\d+)/gi);
    if (cardMatches && cardMatches.length > 0) {
      const parsed = cardMatches.slice(0, 5).map((m: string) => m.replace(/•\s*/, "").trim());
      memory.merge([{ key: "detected_repos_stars", value: parsed.join("; "), evidence: obs.url }]);
    }
  }

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

  // ponytail: URL/PATH/Title/PURPOSE at the top — orients the model in one glance.
  lines.push(`URL: ${obs.url}`);
  try {
    const u = new URL(obs.url);
    lines.push(`PATH: ${u.pathname}${u.search}`);
  } catch {
    /* keep URL only */
  }
  lines.push(`Title: ${obs.title}`);
  if (obs.pagePurpose) lines.push(`PURPOSE: ${obs.pagePurpose}`);
  lines.push("");

  if (guidance && guidance.length > 0) {
    lines.push(`User guidance / harness note: ${guidance}`);
    lines.push("");
  }

  const vpWidth = obs.viewport?.width ?? 1280;
  const vpHeight = obs.viewport?.height ?? 720;

  const inViewport: string[] = [];
  const offScreen: string[] = [];

  const formatTarget = (t: SemanticTarget): string => {
    const bb = t.boundingBox;
    const cx = Math.round(bb.x + bb.width / 2);
    const cy = Math.round(bb.y + bb.height / 2);
    const id = t.stableRef ?? t.targetId.slice(0, 8);
    const name = t.accessibleName?.text ?? t.attributes?.id ?? t.attributes?.name ?? "";
    const role = t.role ? ` role=${t.role}` : "";
    const value = t.control.kind === "input" ? (t.control as { value?: string }).value ?? "" : "";
    const type = t.control.kind === "input" ? ` type=${(t.control as { type?: string }).type ?? ""}` : "";
    const tags: string[] = [];
    if (value) tags.push(`value="${value}"`);
    if (t.attributes?.placeholder) tags.push(`placeholder="${t.attributes.placeholder}"`);
    if (t.attributes?.href) tags.push(`href="${t.attributes.href}"`);
    if (t.attributes?.title) tags.push(`title="${t.attributes.title}"`);
    if (t.attributes?.["aria-expanded"]) tags.push(`expanded=${t.attributes["aria-expanded"]}`);
    if (t.attributes?.["aria-haspopup"]) tags.push(`haspopup=${t.attributes["aria-haspopup"]}`);
    if (t.control.kind === "checkbox" || t.control.kind === "radio") {
      const checked = (t.control as { checked?: boolean }).checked;
      if (typeof checked === "boolean") tags.push(`checked=${checked}`);
    }
    const tagStr = tags.length ? ` (${tags.join(", ")})` : "";
    const nameStr = name ? ` "${name}"` : "";
    return `  [${id}] <${t.tag}>${nameStr}${role}${type}${tagStr} click=(${cx}, ${cy})`;
  };

  const targets = (obs.semanticTargets ?? []).filter((t: SemanticTarget) => t.visible);

  if (targets.length > 0) {
    for (const t of targets) {
      const bb = t.boundingBox;
      const isInVp =
        bb.x < vpWidth &&
        bb.y < vpHeight &&
        bb.x + bb.width > 0 &&
        bb.y + bb.height > 0;
      if (isInVp) {
        inViewport.push(formatTarget(t));
      } else {
        offScreen.push(formatTarget(t));
      }
    }
  } else if (obs.accessibilityNodes && obs.accessibilityNodes.length > 0) {
    const INTERACTIVE_AX_ROLES = new Set([
      "button", "link", "textbox", "checkbox", "radio", "combobox",
      "searchbox", "tab", "menuitem", "option", "switch"
    ]);
    for (const node of obs.accessibilityNodes) {
      if (node.role && INTERACTIVE_AX_ROLES.has(node.role.toLowerCase())) {
        const nameStr = node.name ? ` "${node.name}"` : "";
        const id = node.axNodeId.slice(-8);
        const bb = node.bounds;
        const cx = bb ? Math.round(bb.x + bb.width / 2) : 0;
        const cy = bb ? Math.round(bb.y + bb.height / 2) : 0;
        const line = `  [${id}] <ax:${node.role}>${nameStr} click=(${cx}, ${cy})`;
        if (bb && bb.x < vpWidth && bb.y < vpHeight) {
          inViewport.push(line);
        } else {
          offScreen.push(line);
        }
      }
    }
  }

  lines.push("=== INTERACTIVE ELEMENTS (In Viewport) ===");
  if (inViewport.length > 0) {
    inViewport.slice(0, 80).forEach((l) => lines.push(l));
    if (inViewport.length > 80) lines.push(`  ... (${inViewport.length - 80} additional viewport elements truncated)`);
  } else {
    lines.push("  (no interactive elements in current viewport)");
  }

  if (offScreen.length > 0) {
    lines.push("");
    lines.push(`=== OFF-SCREEN ELEMENTS (${offScreen.length} total - scroll to interact) ===`);
    offScreen.slice(0, 20).forEach((l) => lines.push(l));
    if (offScreen.length > 20) lines.push(`  ... (${offScreen.length - 20} additional off-screen elements omitted)`);
  }

  if (history.length > 0) {
    const tail = history.slice(-HISTORY_LIMIT);
    lines.push("");
    lines.push("=== RECENT STEPS & VERIFIED OUTCOMES ===");
    tail.forEach((h, i) => lines.push(`  ${i + 1}. ${h.action} → ${h.result}`));
  }

  if (obs.bodyText && obs.bodyText.length > 0) {
    lines.push("");
    lines.push("=== PAGE TEXT (HEADINGS + STATS + LABELS + TEXT — STATS contains key data) ===");
    lines.push(obs.bodyText);
    lines.push("=== END PAGE TEXT ===");
  } else if (obs.accessibilityNodes && obs.accessibilityNodes.length > 0) {
    const text = obs.accessibilityNodes
      .map((n: { name?: string; value?: string }) => n.name ?? n.value ?? "")
      .filter((s: string) => s.length > 0)
      .join(" ")
      .slice(0, 600);
    if (text) {
      lines.push("");
      lines.push(`Page text (first 600 chars): "${text}"`);
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

// ponytail: auth-challenge detector. Catches pages that demand authentication
// even when the form is not yet rendered (e.g. GitHub's /login redirect, "verify
// you are human" interstitials, 2FA landing pages, consent screens). URL and
// title are the most reliable signals; semanticTargets is too sparse on the
// initial redirect to be useful.
const AUTH_PATH_RE = /(\/|\?)(login|signin|sign-in|log-in|auth|authenticate|consent|two[-_]?factor|2fa|verify|challenge|account\/login|login\/verify|oauth\/authorize|passkey)(\/|\?|$|&)/i;
const AUTH_TITLE_RE = /(sign in|log in|login|continue to|verify|captcha|authenticate|authentication|2-?step|two[- ]?factor|consent|password)/i;

export function looksLikeAuthChallenge(obs: ObservationV1): { auth: boolean; domain: string; reason: string } {
  let host = "";
  let path = "";
  try {
    const u = new URL(obs.url);
    host = u.hostname;
    path = `${u.pathname}${u.search}`;
  } catch {
    return { auth: false, domain: "", reason: "" };
  }
  if (AUTH_PATH_RE.test(path)) {
    return { auth: true, domain: host, reason: `url matches ${path}` };
  }
  if (typeof obs.title === "string" && AUTH_TITLE_RE.test(obs.title)) {
    return { auth: true, domain: host, reason: `title="${obs.title}"` };
  }
  return { auth: false, domain: "", reason: "" };
}

// ponytail: sign-in link detector. Catches logged-out landing pages (GitHub,
// Twitter, Reddit) that show a "Sign in" / "Log in" anchor without rendering
// the form yet. Returns the targetId of the first matching element so the
// planner can click it on the next turn.
const SIGNIN_TEXT_RE = /^(sign\s*in|log\s*in|continue\s*with\s*\w+|continue|log\s*on)$/i;

export function looksLikeSignInLink(obs: ObservationV1): { link: boolean; targetId: string; label: string } {
  for (const t of obs.semanticTargets) {
    if (!t.visible) continue;
    const tag = t.tag.toLowerCase();
    if (tag !== "a" && tag !== "button") continue;
    const label = (
      t.accessibleName?.text ??
      t.attributes?.id ??
      t.attributes?.name ??
      ""
    ).trim();
    if (label && SIGNIN_TEXT_RE.test(label)) {
      return { link: true, targetId: t.stableRef ?? t.targetId, label };
    }
  }
  return { link: false, targetId: "", label: "" };
}

// ponytail: race the auto-resume signal (webNavigation onCommitted off the
// login domain, or a tab URL change) against the manual Continue button. The
// first signal wins. A 60s ceiling matches typical sign-in timeouts.
async function waitForLoginResume(
  tabId: number,
  loginDomain: string,
  signal: AbortSignal,
): Promise<{ auto: boolean; kind: "redirect" | "manual" | "aborted" | "timeout" }> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (auto: boolean, kind: "redirect" | "manual" | "aborted" | "timeout") => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (webNavListener) {
        try { chrome.webNavigation.onCommitted.removeListener(webNavListener); } catch { /* */ }
      }
      if (tabsListener) {
        try { chrome.tabs.onUpdated.removeListener(tabsListener); } catch { /* */ }
      }
      if (interval) clearInterval(interval);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve({ auto, kind });
    };
    const onAbort = () => settle(false, "aborted");
    signal.addEventListener("abort", onAbort, { once: true });
    let webNavListener: ((d: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => void) | null = null;
    let tabsListener: ((updatedTabId: number, info: chrome.tabs.TabChangeInfo) => void) | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    // ponytail: any committed navigation off the login domain (including the
    // first commit AFTER the user clicks "Sign in" — Google login, GitHub
    // OAuth callbacks, etc.) unblocks the loop. Same-origin continuations
    // (e.g. the auth provider's own subpages) are ignored deliberately.
    try {
      webNavListener = (details) => {
        if (details.tabId !== tabId) return;
        let host = "";
        try { host = new URL(details.url).hostname; } catch { return; }
        if (host && host !== loginDomain) {
          settle(true, "redirect");
        }
      };
      chrome.webNavigation.onCommitted.addListener(webNavListener);
    } catch {
      // ponytail: webNavigation permission missing in some test envs — fall
      // through to the tabs.onUpdated watcher.
    }
    try {
      tabsListener = (updatedTabId, info) => {
        if (updatedTabId !== tabId) return;
        if (typeof info.url !== "string") return;
        let host = "";
        try { host = new URL(info.url).hostname; } catch { return; }
        if (host && host !== loginDomain) {
          settle(true, "redirect");
        }
      };
      chrome.tabs.onUpdated.addListener(tabsListener);
    } catch { /* */ }
    // ponytail: poll for the manual Continue path (background fires
    // resolveLoginPause on local_login_complete) and the abort signal.
    interval = setInterval(() => {
      if (signal.aborted) { settle(false, "aborted"); return; }
      if (pendingLoginResolvers.get(tabId)) {
        // the resolver will be invoked; release on next microtask
        pendingLoginResolvers.delete(tabId);
        settle(false, "manual");
      }
    }, 200);
    // ponytail: 60s ceiling. Real auth flows complete in <30s; longer means
    // the user stepped away, in which case the loop ends in a normal "needs
    // login" state via the next capture, not by waiting forever.
    timeoutHandle = setTimeout(() => settle(false, "timeout"), 60_000);
  });
}

async function callPlanner(
  opts: LocalDriverOptions,
  context: string,
): Promise<PlanningOutcome> {
  // ponytail: short retry with backoff for transient 429s (matches demo-server).
  let lastErr: Error | null = null;
  // ponytail: stable per-run taskId so the demo-server can reset its turn
  // counter when a new task starts (instead of incrementing forever across
  // runs). sessionId is a constant placeholder for now; the local-driver
  // owns a per-run uuid so the demo-server's logs reflect "new task" cleanly.
  const driverTaskId = (opts as { taskId?: string }).taskId ?? "ext-task";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${opts.plannerUrl}/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workId: "ext-" + Date.now(),
          sessionId: "00000000-0000-4000-8000-000000000001",
          taskId: driverTaskId,
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
      }, CAPTURE_TIMEOUT_MS);
    });
  }
  return tab.id;
}

async function captureForDriver(tabId: number): Promise<ObservationV1> {
  return captureSnapshotForDriver(tabId);
}

// ponytail: capture with a hard timeout. Real Chrome's debugger.sendCommand
// can hang indefinitely if the tab is in a weird state (loading, crashed,
// detached). The race in captureVisibleTab is the usual culprit. Cap at
// 15s so the loop survives and surfaces the timeout as a recoverable
// error.
async function captureObservationWithTimeout(tabId: number, timeoutMs: number): Promise<ObservationV1> {
  return Promise.race([
    captureSnapshotForDriver(tabId),
    new Promise<ObservationV1>((_, reject) => {
      setTimeout(() => reject(new Error(`captureObservation timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}
const captureForDriverWithTimeout = (tabId: number, timeoutMs: number) => captureObservationWithTimeout(tabId, timeoutMs);

// ponytail: real page settlement wait. Polls tab status === "complete" and runs an
// in-page MutationObserver to wait until DOM mutations quiet down for 200ms (max 1500ms).
// Critical for React/Vue SPAs where status === "complete" fires before hydration/re-renders.
async function waitForNetworkIdle(tabId: number, _timeoutMs = 800): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 1500) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") break;
    } catch {
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // ponytail: MutationObserver quiet check — waits up to 800ms for 200ms of DOM quietness.
  try {
    await debuggerModule.sendCommand(tabId, {
      method: "Runtime.evaluate",
      params: {
        expression: `new Promise((resolve) => {
          let timer = setTimeout(finish, 200);
          const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(finish, 200);
          });
          function finish() {
            observer.disconnect();
            resolve(true);
          }
          if (document.documentElement) {
            observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
          }
          setTimeout(() => { observer.disconnect(); resolve(false); }, 800);
        })`,
        awaitPromise: true,
        returnByValue: true,
      },
    });
  } catch {
    // fallback sleep if CDP or script fails
    await new Promise((r) => setTimeout(r, 250));
  }

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
  // ponytail: per-domain login cooldown. Once the loop has paused for
  // login on a domain, do not pause again until the user navigates off
  // that domain. Cleared on domain change (above) or on terminal exit.
  const loginPauseDomains = new Set<string>();
  // ponytail: stagnation tracking. Signature windows catch "model is stuck on
  // the same action" or "page hasn't changed" before the action budget burns
  // out. Bounded counter ends the loop with a clear blocked result instead of
  // burning MAX_STEPS in a tight repeat.
  const actionSigs: string[] = [];
  const obsSigs: string[] = [];
  // ponytail: page-identity signatures for the slice-E stagnation detector.
  // Each entry is the post-action observation's pageIdentity (SHA-256 of
  // normalized AX subtree); identical entries across STAGNATION_REPEAT_THRESHOLD
  // turns mean the agent's clicks aren't navigating.
  const pageIdentities: string[] = [];
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
  // ponytail: detect whether the click opened a new tab to an external origin
  // (e.g. Gmail's "Track package" link → amazon.in) and follow it. Without
  // this the loop keeps capturing the original tab while the answer sits in
  // a tab the planner never sees. Returns null when no followable tab opened
  // — same-origin tabs (popups from the same site) are skipped deliberately.
  async function followNewTabIfExternal(
    currentTabId: number,
    sinceMs: number,
  ): Promise<{ id: number; url: string; title: string } | null> {
    try {
      let currentOrigin = "";
      try {
        const t = await chrome.tabs.get(currentTabId);
        currentOrigin = new URL(t.url ?? "").origin;
      } catch {
        /* current tab went away */
      }
      // ponytail: pick the most recently opened tab whose openedAt is
      // after `sinceMs`. Filter out the current tab (impossible but safe),
      // unparseable URLs (about:blank chrome:// pages), and the baseline
      // tabs the user already had open before the loop started.
      let candidate: { id: number; url: string; title: string; openedAt: number } | null = null;
      for (const [id, info] of tabJournal.entries()) {
        if (id === currentTabId) continue;
        if (typeof id !== "number") continue;
        if (info.openedAt <= sinceMs) continue;
        if (initialTabIds.has(id)) continue;
        if (candidate === null || info.openedAt > candidate.openedAt) {
          candidate = { id, url: info.url, title: info.title, openedAt: info.openedAt };
        }
      }
      if (candidate === null) return null;
      let candidateOrigin = "";
      try { candidateOrigin = new URL(candidate.url).origin; } catch { /* leave empty */ }
      // ponytail: same-origin tab = same-site UI panel (e.g. login popup),
      // not what we want to follow. Different origin = the user clearly
      // meant to navigate elsewhere; switch.
      if (currentOrigin && candidateOrigin && currentOrigin === candidateOrigin) return null;
      try {
        await chrome.tabs.update(candidate.id, { active: true });
      } catch {
        /* tab may have closed; let the caller re-evaluate */
        return null;
      }
      return { id: candidate.id, url: candidate.url, title: candidate.title };
    } catch {
      return null;
    }
  }
  let caughtError: Error | null = null;
  // ponytail: defer the terminal emit until the loop's `finally` block has
  // detached the debugger and torn down listeners. The background layer reads
  // `terminal` after the runLocalLoop promise resolves and only then forwards
  // the terminal UI event. Without this, a new run_local_task message
  // arriving in the cleanup window races with the terminal event and may be
  // rejected as "A local task is already running" even though the panel is
  // already in the `done` phase.
  type LocalTerminal =
    | { kind: "complete"; complete: { summary: string; steps: number; finalAnswer?: string } }
    | { kind: "error"; error: { code: string; message: string } };
  let terminal: LocalTerminal | null = null;
  // ponytail: track consecutive prose-only responses so the model gets a single
  // corrective chance; the second consecutive prose response surfaces a clear
  // failure (PLANNER_PROSE_INSTEAD_OF_TOOL) instead of silently looping. Reset
  // whenever the model emits a real tool call.
  let consecutiveProseOnly = 0;
  const PROSE_ONLY_LIMIT = 2;
  // ponytail: per-iteration time budget. Tracks wall time INSIDE the
  // iteration (capture + planner + execute + post-capture). 60s default
  // — when exceeded, surface a clarifying question rather than burning
  // more model turns on the same page. Configurable per-run.
  const STEP_BUDGET_MS = Number(opts.stepBudgetMs ?? 60_000);
  try {
    while (stepIndex < MAX_STEPS) {
      if (opts.signal.aborted) {
        terminal = { kind: "error", error: { code: "ABORTED", message: "Loop was cancelled" } };
        return;
      }
      const iterationStartedAt = Date.now();
      log(opts, `step ${stepIndex + 1}`);
      await activateAgentTab();
      const obs = await captureForDriverWithTimeout(tabId, CAPTURE_TIMEOUT_MS);
      // ponytail: detect login / auth challenge BEFORE calling the planner so
      // we don't burn a plan step on "click this invisible login form". Catches
      // both the password-form case (looksLikeLoginPage) and the URL/title
      // challenge case (looksLikeAuthChallenge) — GitHub's /login redirect,
      // consent pages, and 2FA landings hit the second path. The model will
      // see the post-login observation on the next iteration.
      const login = looksLikeLoginPage(obs);
      const challenge = login.login ? null : looksLikeAuthChallenge(obs);
      if (login.login || (challenge && challenge.auth)) {
        const domain = login.login ? login.domain : (challenge as { domain: string }).domain;
        const reason = login.login
          ? `password form on ${login.domain}`
          : `auth challenge (${(challenge as { reason: string }).reason})`;
        // ponytail: per-domain login cooldown. Once we have paused for
        // login on `github.com`, do NOT pause again for the same domain
        // until we observe a page on a DIFFERENT domain first. Without
        // this, the Google OAuth round-trip makes the loop pause three
        // times in a row (github.com/login → accounts.google.com/... →
        // github.com/login/oauth/...) — the third pause is post-callback
        // and the user has already authenticated.
        if (loginPauseDomains.has(domain)) {
          log(opts, `login pause skipped (already paused for ${domain})`);
        } else {
          log(opts, `login pause: ${reason}`);
          loginPauseDomains.add(domain);
          opts.onLoginRequired({ url: obs.url, domain });
          // ponytail: race auto-resume (URL/tab update off the login domain)
          // against the manual Continue button. Whichever fires first
          // unblocks the loop. Abort also resolves immediately so
          // cancellation is clean.
          const loginResume = await waitForLoginResume(tabId, domain, opts.signal);
          pendingLoginResolvers.delete(tabId);
          if (opts.signal.aborted) {
            terminal = { kind: "error", error: { code: "ABORTED", message: "Loop was cancelled" } };
            return;
          }
          log(opts, loginResume.auto ? `login resume: ${loginResume.kind}` : "user confirmed login — resuming loop");
        }
        // ponytail: any navigation off the login domain clears the
        // cooldown so a future visit (e.g. back to /login after signing
        // out) can pause again.
        try {
          const currentHost = new URL(obs.url).hostname;
          if (currentHost && currentHost !== domain) {
            loginPauseDomains.delete(domain);
          }
        } catch { /* invalid URL */ }
        injectedGuidance = undefined;
        await waitForNetworkIdle(tabId).catch(() => undefined);
        continue;
      }
      // ponytail: logged-out landing page (e.g. GitHub, Reddit) shows a
      // Sign in / Log in anchor but no auth form. Nudge the model to click
      // it before doing anything else — without this hint the planner keeps
      // reasoning about why it can't act and the loop burns model turns.
      const signIn = looksLikeSignInLink(obs);
      if (signIn.link && !injectedGuidance) {
        const targetHint = signIn.targetId
          ? ` Look for element [${signIn.targetId.slice(0, 8)}] "${signIn.label}" and click its center.`
          : ` Look for a "${signIn.label}" link/button and click it.`;
        injectedGuidance = `This page is a logged-out landing page. Click the Sign in / Log in link to authenticate — never type credentials.${targetHint}`;
      }
      // ponytail: auto-extract working memory from obs so key entities (username, repo, stars, prices)
      // are continuously preserved in working memory even if the planner model omits memoryUpdates.
      autoExtractWorkingMemory(obs, memory);
      const context = renderObservationForPlanner(obs, history, injectedGuidance, memory.toView());
      const outcome = await callPlanner(opts, context);
      if (opts.signal.aborted) {
        terminal = { kind: "error", error: { code: "ABORTED", message: "Loop was cancelled" } };
        return;
      }
      if (outcome.kind === "completion") {
        // ponytail: completion path doesn't carry finalAnswer (the planner
        // signals termination via action:terminate in this codebase). Fall
        // back to the summary so the UI still has something to show.
        terminal = { kind: "complete", complete: { summary: outcome.summary ?? "task completed", steps: stepIndex + 1, finalAnswer: outcome.summary } };
        return;
      }
      if (outcome.kind === "question") {
        // ponytail: prose-only / clarification paths. Track consecutive
        // prose-only responses; two in a row = the model is stuck narrating
        // instead of acting, so fail loudly with the prose quoted.
        const questionText = outcome.question ?? "The agent needs more information.";
        const isProseOnly = outcome.proseOnly === true || outcome.toolError === true;
        if (isProseOnly) {
          consecutiveProseOnly += 1;
        } else {
          consecutiveProseOnly = 0;
        }
        if (isProseOnly && consecutiveProseOnly >= PROSE_ONLY_LIMIT) {
          log(opts, `planner returned prose ${consecutiveProseOnly} times in a row — aborting`);
          terminal = {
            kind: "error",
            error: {
              code: "PLANNER_PROSE_INSTEAD_OF_TOOL",
              message: `The model returned plain text instead of a tool call ${consecutiveProseOnly} times in a row. Last response: "${questionText.slice(0, 240)}". Send it an explicit action (visit_url, terminate, ask_user_question) or use a stronger model.`,
            },
          };
          return;
        }
        // ponytail: prose-only is an INTERNAL harness correction — the user
        // does not need to see a clarify-card. Inject the corrective guidance
        // and continue. Genuine model clarifications still go through the
        // onClarify path so the user can answer.
        if (isProseOnly) {
          injectedGuidance = questionText;
          log(opts, `prose-only response #${consecutiveProseOnly}: injecting corrective guidance`);
          continue;
        }
        const answer = await opts.onClarify({
          reason: "The planner asked a question",
          question: questionText,
          context: questionText,
        });
        injectedGuidance = answer;
        opts.onAnswered?.({ question: questionText, answer });
        continue;
      }
      const action = outcome.action ?? { type: "unknown" };
      // ponytail: any real tool call resets the prose-only counter.
      consecutiveProseOnly = 0;
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
        // ponytail: append the recorded memory as a "Notes recorded during
        // run" block so the user always sees structured findings even if the
        // model's finalAnswer is terse. The model's answer takes priority;
        // we add facts the harness collected independently. Memory entries
        // with key starting with "_" are skipped (internal markers).
        const findings = memory.toView().filter((f) => !f.key.startsWith("_"));
        let richAnswer = finalAnswer;
        if (findings.length > 0) {
          const lines = findings.map((f) => `  • ${f.key} = ${f.value}${f.evidence ? `  (${f.evidence})` : ""}`);
          richAnswer = `${finalAnswer}\n\nNotes recorded during run:\n${lines.join("\n")}`;
        }
        terminal = { kind: "complete", complete: { summary: richAnswer, steps: stepIndex + 1, finalAnswer: richAnswer } };
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
          terminal = { kind: "error", error: { code: "APPROVAL_DENIED", message: `User denied: ${approval.reason}` } };
          return;
        }
        log(opts, "user approved — proceeding");
      }
      const desc = describeAction(action);
      const iconKind = (action.type ?? "unknown").toString();

      // ponytail: HARD ACTION REJECTION — if the model proposes a non-scroll action signature
      // that already resulted in [Unchanged: ...] in history, do NOT execute it again!
      // Instantly reject execution, record the rejection in history, inject strict guidance,
      // and loop to the next turn so the model is forced to pivot without wasting time/CDP.
      // NOTE: `scroll` is explicitly excluded from Hard Action Rejection because scrolling down
      // long pages or lists is a normal multi-step action that doesn't change URL.
      const actionSig = actionSignature(action);
      const isRepeatUnchanged = action.type !== "scroll" && history.some(
        (h) => (h.action === desc || actionSigs.includes(actionSig)) && h.result.includes("[Unchanged"),
      );

      if (isRepeatUnchanged) {
        log(opts, `action hard-rejected by harness: "${desc}" already resulted in [Unchanged]`);
        const rejectMsg = `[REJECTED BY HARNESS]: Action "${desc}" was ALREADY attempted and had NO effect [Unchanged: URL and page state remained identical]. Repeating this action is FORBIDDEN. You MUST pick a DIFFERENT strategy (e.g. direct visit_url to a specific URL with query parameters like ?sort=stargazers, scroll down, or click a different element ID).`;
        history.push({ action: desc, result: rejectMsg });
        injectedGuidance = rejectMsg;
        opts.onStep({ index: stepIndex, action: desc, result: rejectMsg, url: obs.url, screenshot: null, iconKind, reasoning: action.reasoning });
        actionSigs.push(actionSig);
        const currentTitle = obs.title;
        obsSigs.push(observationSignature({ url: obs.url, title: currentTitle, elements: obs.semanticTargets.slice(0, 1).map((t: SemanticTarget) => ({ id: t.stableRef ?? t.targetId.slice(0, 8) })) }));
        pageIdentities.push(obs.pageIdentity || `${obs.url}|${currentTitle}`);
        stagnationHits++;
        if (stagnationHits >= STAGNATION_LIMIT) {
          const findings = memory.toView();
          const blockedMessage = `STOP — repeated invalid actions rejected by harness.\n\nFindings so far:\n${findings.map((f) => `  - ${f.key} = "${f.value}"`).join("\n") || "  (none)"}`;
          terminal = { kind: "error", error: { code: "STAGNATION", message: blockedMessage } };
          return;
        }
        stepIndex++;
        continue;
      }

      let result: string;
      const actionTs = Date.now();

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
        terminal = { kind: "error", error: { code: "ACTION_FAILED", message } };
        return;
      }
      await waitForNetworkIdle(tabId).catch(() => undefined);
      await new Promise((r) => setTimeout(r, POST_ACTION_PAUSE_MS));
      // ponytail: check for tabs that opened during the click (e.g.
      // Gmail's "Track package" link → amazon.in opens in a new tab). The
      // CDP click dispatches the synthetic event but doesn't update our
      // active tabId, so without this the loop keeps capturing the Gmail
      // tab and stagnation fires before the planner sees the answer that
      // is already loaded in the new tab. We follow external-origin tabs
      // (different origin = new window-like context the user clearly
      // intended to open).
      const followed = await followNewTabIfExternal(tabId, actionTs);
      if (followed !== null) {
        const oldTabId = tabId;
        tabId = followed.id;
        log(opts, `following click into new tab ${tabId} (${followed.url.slice(0, 80)})`);
        await debuggerModule.detachFromTab(oldTabId).catch(() => undefined);
        try {
          await debuggerModule.attachToTab(tabId);
        } catch (err) {
          log(opts, `failed to attach to new tab ${tabId}: ${err instanceof Error ? err.message : String(err)}`);
        }
        await waitForNetworkIdle(tabId).catch(() => undefined);
      }
      let screenshot: string | null = null;
      let postUrl = obs.url;
      let postObs: ObservationV1 | null = null;
      try {
        await activateAgentTab();
        postObs = await captureObservationWithTimeout(tabId, CAPTURE_TIMEOUT_MS);
        screenshot = postObs.screenshot && postObs.screenshot.data.length > 0 ? postObs.screenshot.data : null;
        postUrl = postObs.url;
      } catch (err) {
        log(opts, `post-action observation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      let outcomeTag = "";
      let pageChanged = false;
      if (postObs) {
        if (postObs.url !== obs.url) {
          outcomeTag = ` [Verified: Navigated to ${postObs.url}]`;
          pageChanged = true;
        } else if (postObs.pageIdentity && obs.pageIdentity && postObs.pageIdentity !== obs.pageIdentity) {
          outcomeTag = ` [Verified: Page content updated]`;
          pageChanged = true;
        } else if (action.type === "scroll") {
          outcomeTag = ` [Verified: Scrolled page]`;
          pageChanged = true;
        } else {
          outcomeTag = ` [Unchanged: URL and page state remained identical]`;
        }
      }

      const verifiedResult = `${result}${outcomeTag}`;
      history.push({ action: desc, result: verifiedResult });
      failures.length = 0;
      // ponytail: pass the planner's one-sentence reasoning to the UI. The
      // side panel uses it as the assistant bubble title instead of the raw
      // `desc` (which is the tool call like "visit_url ...").
      opts.onStep({ index: stepIndex, action: desc, result, url: postUrl, screenshot, iconKind, reasoning: action.reasoning });
      // ponytail: reset stagnation counters when the page actually changed.
      // This gives the agent a fresh budget after every successful navigation,
      // preventing false stagnation on multi-step tasks where the agent
      // navigates several pages but then gets briefly stuck on one.
      if (pageChanged) {
        actionSigs.length = 0;
        obsSigs.length = 0;
        pageIdentities.length = 0;
        stagnationHits = 0;
      }
      // ponytail: signature-based stagnation. Two parallel signals:
      //   - pageIdentities: post-action pageIdentity hash. MUST use postObs,
      //     not obs (pre-action). Using obs was a bug that made every step
      //     compare pre-action identity to itself → always identical.
      //   - actionSigs: detect same click coord repeated.
      // Whichever fires first wins.
      actionSigs.push(actionSignature(action));
      const postTitle = postObs?.title ?? obs.title;
      const postTargets = postObs?.semanticTargets ?? obs.semanticTargets;
      obsSigs.push(observationSignature({ url: postUrl, title: postTitle, elements: postTargets.slice(0, 1).map((t: SemanticTarget) => ({ id: t.stableRef ?? t.targetId.slice(0, 8) })) }));
      // ponytail: CRITICAL — use postObs.pageIdentity (post-action), not
      // obs.pageIdentity (pre-action). The old code pushed the pre-action
      // identity which was always the same if the page didn't change,
      // causing false stagnation after just 3 steps on the same page.
      const postObsPageIdentity = postObs?.pageIdentity && postObs.pageIdentity.length > 0
        ? postObs.pageIdentity
        : `${postUrl}|${postTitle}`;
      pageIdentities.push(postObsPageIdentity);
      const pageStag = detectPageStagnation(pageIdentities);
      const actionStag = detectStagnation(actionSigs, obsSigs);
      const stagnation = pageStag ?? actionStag;
      if (stagnation) {
        stagnationHits++;
        log(opts, `stagnation: ${stagnation.kind} signature="${stagnation.signature}" hit ${stagnationHits}/${STAGNATION_LIMIT}`);
        if (stagnationHits >= STAGNATION_LIMIT) {
          // ponytail: bounded break. Memory is preserved in the blocked result
          // so the user can see what was recorded before the agent gave up.
          const findings = memory.toView();
          const blockedMessage = `${stagnation.message}\n\nFindings so far:\n${findings.map((f) => `  - ${f.key} = "${f.value}"`).join("\n") || "  (none)"}`;
          terminal = { kind: "error", error: { code: "STAGNATION", message: blockedMessage } };
          return;
        }
        // ponytail: first stagnation hit is a recovery signal. Inject
        // corrective guidance with concrete alternative strategies.
        const recoveryHint = `\n\nRECOVERY STRATEGIES (try one of these):\n` +
          `1. Use visit_url with a direct URL (e.g. visit_url('https://github.com/<username>?tab=repositories')) instead of clicking UI elements.\n` +
          `2. Scroll down to reveal more elements: scroll(direction='down').\n` +
          `3. Click a DIFFERENT element — look at the interactive elements list for alternatives you haven't tried.\n` +
          `4. If the answer is already in the page text, call terminate(finalAnswer='<the answer>').`;
        injectedGuidance = stagnation.message + recoveryHint;
        // ponytail: reset stagnation tracking after injecting guidance so
        // the agent gets a fresh window to try the recovery strategies.
        actionSigs.length = 0;
        obsSigs.length = 0;
        pageIdentities.length = 0;
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
        // ponytail: do NOT reset history on loop recovery — history is the
        // model's working memory of what it has tried. Wiping it causes the
        // model to repeat the same path from scratch, re-triggering the loop.
        // Instead, reset only the action/obs/page signature arrays (those
        // exist purely for stagnation detection, not for model context) and
        // keep history intact so the model can see what failed and pick a
        // genuinely different strategy.
        actionSigs.length = 0;
        obsSigs.length = 0;
        pageIdentities.length = 0;
        stagnationHits = 0;
        opts.onAnswered?.({ question: loop.action, answer });
      }
      // ponytail: per-iteration time budget check. If the iteration took
      // longer than STEP_BUDGET_MS, surface a clarifying question so the
      // user can redirect before the loop burns more model turns. The
      // budget resets each iteration (it's per-step, not cumulative).
      const iterationElapsedMs = Date.now() - iterationStartedAt;
      if (iterationElapsedMs > STEP_BUDGET_MS) {
        log(opts, `step budget exceeded: ${iterationElapsedMs}ms > ${STEP_BUDGET_MS}ms`);
        const answer = await opts.onClarify({
          reason: `Step exceeded ${Math.round(STEP_BUDGET_MS / 1000)}s budget`,
          question: `The agent spent ${Math.round(iterationElapsedMs / 1000)}s on this step without making progress. How would you like it to proceed?`,
          context: `Current URL: ${obs.url}. Current title: ${obs.title}. Steps so far: ${stepIndex + 1}.`,
        });
        injectedGuidance = answer;
        opts.onAnswered?.({ question: `step budget exceeded`, answer });
      }
      stepIndex++;
    }
    terminal = { kind: "error", error: { code: "MAX_STEPS_EXCEEDED", message: `Did not complete in ${MAX_STEPS} steps` } };
  } catch (err) {
    // ponytail: captureObservation timeout or any other loop error would
    // otherwise become an unhandled rejection and silently leave the
    // side panel in RUNNING. Surface as task_failed so the user sees it.
    caughtError = err instanceof Error ? err : new Error(String(err));
    log(opts, `loop crashed: ${caughtError.message}`);
    terminal = { kind: "error", error: { code: "LOOP_CRASHED", message: caughtError.message } };
  } finally {
    for (const off of tabListeners) { try { off(); } catch { /* */ } }
    await debuggerModule.detachFromTab(tabId).catch(() => undefined);
    // ponytail: emit the terminal event AFTER cleanup completes. This is the
    // single source of truth for the loop's terminal state — the background
    // sees this once the runLocalLoop promise resolves, then nulls its own
    // localAbortController / localTabId, then forwards the event to the side
    // panel. No other path calls opts.onComplete / opts.onError.
    if (terminal !== null) {
      if (terminal.kind === "complete") {
        try { opts.onComplete(terminal.complete); } catch { /* listener threw */ }
      } else {
        try { opts.onError(terminal.error); } catch { /* listener threw */ }
      }
    }
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
