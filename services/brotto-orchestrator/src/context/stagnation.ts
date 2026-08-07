/**
 * Stagnation detection: track normalized action/observation signatures in a
 * rolling window. Repeated decisions are first a recovery signal sent to the
 * model (via system prompt feedback), then a bounded loop break.
 */

import type { StagnationSignal } from "./decision.js";

const REPEAT_THRESHOLD = 5;
const WINDOW_SIZE = 8;

export interface ActionSigInput {
  type?: string;
  url?: string;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  fact?: string;
}

export interface ObservationSigInput {
  url?: string;
  title?: string;
  elements?: Array<{ id?: string }>;
}

export function actionSignature(action: ActionSigInput): string {
  const t = (action.type ?? "unknown").toLowerCase();
  switch (t) {
    case "visit_url":
      return `visit_url:${(action.url ?? "").trim()}`;
    case "left_click":
    case "double_click":
    case "right_click":
    case "mouse_move":
      return `${t}:${action.x ?? 0},${action.y ?? 0}`;
    case "insert_text":
      return `insert_text:${(action.text ?? "").slice(0, 40)}`;
    case "key":
      return `key:${action.key ?? ""}`;
    case "scroll":
      return "scroll";
    case "screenshot":
      return "screenshot";
    case "wait":
      return "wait";
    case "memorize_fact":
    case "pause_and_memorize_fact":
      return `${t}:${(action.fact ?? "").slice(0, 80)}`;
    case "terminate":
      return "terminate";
    case "ask_user_question":
      return `ask_user_question`;
    case "history_back":
      return "history_back";
    default:
      return t;
  }
}

export function observationSignature(obs: ObservationSigInput): string {
  const url = (obs.url ?? "").trim();
  const title = (obs.title ?? "").trim();
  const firstId = obs.elements && obs.elements.length > 0 ? obs.elements[0]?.id ?? "" : "";
  return `${url}|${title}|${firstId}`;
}

export function detectStagnation(
  actionSigs: string[],
  obsSigs: string[],
): StagnationSignal | null {
  const actionHit = lastNIdentical(actionSigs, REPEAT_THRESHOLD, WINDOW_SIZE);
  if (actionHit) {
    return {
      kind: "repeated_action",
      signature: actionHit,
      count: countOccurrences(actionSigs.slice(-WINDOW_SIZE), actionHit),
      message: `Action "${actionHit}" repeated ${REPEAT_THRESHOLD}+ times in the last ${WINDOW_SIZE} steps. Either pick a materially different action, or if the goal is satisfied, call terminate(finalAnswer='the verified answer').`,
    };
  }
  const obsHit = lastNIdentical(obsSigs, REPEAT_THRESHOLD, WINDOW_SIZE);
  if (obsHit) {
    return {
      kind: "repeated_observation",
      signature: obsHit,
      count: countOccurrences(obsSigs.slice(-WINDOW_SIZE), obsHit),
      message: `Page hasn't changed for ${REPEAT_THRESHOLD}+ steps. Verify you've found the answer in the current page text. If yes, call terminate(finalAnswer='<value>') with the verified value. If not, try a different action.`,
    };
  }
  return null;
}

function lastNIdentical(arr: string[], n: number, window: number): string | null {
  if (arr.length < n) return null;
  const tail = arr.slice(-window);
  if (tail.length < n) return null;
  const recent = tail.slice(-n);
  const ref = recent[0];
  if (recent.every((s) => s === ref)) return ref;
  return null;
}

function countOccurrences(arr: string[], sig: string): number {
  return arr.filter((s) => s === sig).length;
}
