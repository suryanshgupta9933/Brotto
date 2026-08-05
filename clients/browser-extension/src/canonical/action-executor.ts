import type { ActionCommandV1, ExecutableActionV1, SemanticTarget } from "@fara-platform/fara-action-schema";
import type { AccessibilityNode } from "@fara-platform/fara-action-schema";
import { sendCommand } from "../debugger";
import { sanitizeObservationUrl } from "./redaction";
import { transformCapturedPoint, type CapturedCoordinateContext } from "./coordinate-context";
import { matchStableRef, MATCH_CONFIDENCE_THRESHOLD } from "./ref-matcher";
import type { StableRef } from "./stable-ref";
import {
  type CanonicalExecutionPipelineOptions,
  type PipelineResult,
  consumePhysicalExecutionPermit,
} from "./execution-pipeline";

export { transformCapturedPoint } from "./coordinate-context";
export type { CapturedCoordinateContext } from "./coordinate-context";

type MouseButton = "left" | "right";

export type AllowedCdpCommand =
  | { readonly method: "Input.dispatchMouseEvent"; readonly params: Record<string, unknown> }
  | { readonly method: "Input.dispatchKeyEvent"; readonly params: Record<string, unknown> }
  | { readonly method: "Input.insertText"; readonly params: { readonly text: string } }
  | { readonly method: "Page.navigate"; readonly params: { readonly url: string } }
  | { readonly method: "Page.getNavigationHistory" };

export type CdpSender = (tabId: number, command: AllowedCdpCommand) => Promise<unknown>;

export interface CanonicalActionExecutorOptions {
  readonly tabId: number;
  readonly capture: CapturedCoordinateContext;
  readonly observation?: { readonly semanticTargets: readonly SemanticTarget[] };
  readonly send?: CdpSender;
  readonly wait?: (durationMs: number) => Promise<void>;
}

export interface ActionExecutionError {
  readonly code:
    | "MISSING_ACTION_PARAMETER"
    | "INVALID_ACTION_PARAMETER"
    | "COORDINATE_OUT_OF_BOUNDS"
    | "INVALID_NAVIGATION_URL"
    | "HISTORY_ENTRY_UNAVAILABLE"
    | "UNKNOWN_ACTION"
    | "POLICY_AUTHORIZATION_REQUIRED"
    | "TARGET_NOT_FOUND"
    | "TARGET_COORDINATE_MISMATCH"
    | "CDP_COMMAND_FAILED";
  readonly message: string;
  readonly retryable: boolean;
}

export type ActionExecutionResult =
  | { readonly ok: true; readonly effect?: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly error: ActionExecutionError };

type ActionExecutionFailure = Extract<ActionExecutionResult, { readonly ok: false }>;

export type CanonicalExecutionCommand = Pick<ActionCommandV1, "action">;

class CanonicalActionExecutor {
  private readonly tabId: number;
  private readonly capture: CapturedCoordinateContext;
  private readonly send: CdpSender;
  private readonly observation?: { readonly semanticTargets: readonly SemanticTarget[] };
  private readonly wait: (durationMs: number) => Promise<void>;
  private active = false;
  private activeSignal?: AbortSignal;

  constructor(options: CanonicalActionExecutorOptions) {
    this.tabId = options.tabId;
    this.capture = options.capture;
    this.observation = options.observation;
    this.send = options.send ?? ((tabId, command) => sendCommand(tabId, command));
    this.wait = options.wait ?? ((durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)));
  }

  async execute(command: CanonicalExecutionCommand, signal?: AbortSignal): Promise<ActionExecutionResult> {
    if (signal?.aborted) return failure("CDP_COMMAND_FAILED", "Controlled action was cancelled", false);
    const action = command?.action as ExecutableActionV1 | undefined;
    if (!action || typeof action !== "object" || typeof (action as { type?: unknown }).type !== "string") {
      return failure("MISSING_ACTION_PARAMETER", "The action type is required", false);
    }
    const targetFailure = this.verifyDeclaredTarget(action);
    if (targetFailure !== undefined) return targetFailure;
    if (this.active) return failure("CDP_COMMAND_FAILED", "Another controlled action is already executing", true);
    this.active = true;
    this.activeSignal = signal;

    try {
      switch (action.type) {
        case "left_click": return await this.click(action, "left", 1);
        case "double_click": return await this.click(action, "left", 2);
        case "right_click": return await this.click(action, "right", 1);
        case "mouse_move": return await this.mouseMove(action);
        case "drag": return await this.drag(action);
        case "scroll": return await this.scroll(action);
        case "key": return await this.key(action);
        case "insert_text": return await this.insertText(action);
        case "visit_url": return await this.navigate(action);
        case "history_back": return await this.historyBack(action);
        case "wait": return await this.waitFor(action);
        case "ask_user_question":
        case "memorize_fact":
          return failure("UNKNOWN_ACTION", `${action.type} is not a browser execution action`, false);
        default:
          return failure("UNKNOWN_ACTION", "The requested action type is not supported", false);
      }
    } catch (error) {
      return failure(
        "CDP_COMMAND_FAILED",
        "The controlled browser command failed",
        true,
      );
    } finally {
      this.active = false;
      this.activeSignal = undefined;
    }
  }

  private async click(action: { x?: unknown; y?: unknown }, button: MouseButton, clickCount: number): Promise<ActionExecutionResult> {
    const point = this.point(action.x, action.y);
    if ("error" in point) return point;
    await this.mouse({ type: "mouseMoved", ...point });
    await this.mouse({ type: "mousePressed", ...point, button, clickCount });
    await this.mouse({ type: "mouseReleased", ...point, button, clickCount });
    return { ok: true, effect: { kind: "pointer", button, clickCount, x: point.x, y: point.y } };
  }

  private async mouseMove(action: { x?: unknown; y?: unknown }): Promise<ActionExecutionResult> {
    const point = this.point(action.x, action.y);
    if ("error" in point) return point;
    await this.mouse({ type: "mouseMoved", ...point });
    return { ok: true, effect: { kind: "pointer_move", x: point.x, y: point.y } };
  }

  private async drag(action: { startX?: unknown; startY?: unknown; endX?: unknown; endY?: unknown }): Promise<ActionExecutionResult> {
    const start = this.point(action.startX, action.startY);
    if ("error" in start) return start;
    const end = this.point(action.endX, action.endY);
    if ("error" in end) return end;
    await this.mouse({ type: "mouseMoved", ...start });
    await this.mouse({ type: "mousePressed", ...start, button: "left", clickCount: 1 });
    await this.mouse({ type: "mouseMoved", ...end, button: "left", buttons: 1 });
    await this.mouse({ type: "mouseReleased", ...end, button: "left", clickCount: 1 });
    return { ok: true, effect: { kind: "drag", start, end } };
  }

  private async scroll(action: { deltaX?: unknown; deltaY?: unknown }): Promise<ActionExecutionResult> {
    if (!finite(action.deltaX) || !finite(action.deltaY)) {
      return failure("MISSING_ACTION_PARAMETER", "Scroll requires finite deltaX and deltaY", false);
    }
    await this.mouse({
      type: "mouseWheel",
      x: this.capture.viewportWidth / 2,
      y: this.capture.viewportHeight / 2,
      deltaX: action.deltaX,
      deltaY: action.deltaY,
    });
    return { ok: true, effect: { kind: "scroll", deltaX: action.deltaX, deltaY: action.deltaY } };
  }

  private async key(action: { key?: unknown; modifiers?: unknown }): Promise<ActionExecutionResult> {
    if (typeof action.key !== "string" || action.key.length === 0) {
      return failure("MISSING_ACTION_PARAMETER", "Key action requires a non-empty key", false);
    }
    const modifiers = modifierMask(action.modifiers);
    if (modifiers === undefined) {
      return failure("INVALID_ACTION_PARAMETER", "Key modifiers must be booleans", false);
    }
    await this.keyboard({ type: "keyDown", key: action.key, modifiers });
    await this.keyboard({ type: "keyUp", key: action.key, modifiers });
    return { ok: true, effect: { kind: "key", modifiers } };
  }

  private async insertText(action: { text?: unknown }): Promise<ActionExecutionResult> {
    if (typeof action.text !== "string" || action.text.length === 0) {
      return failure("MISSING_ACTION_PARAMETER", "Text insertion requires non-empty text", false);
    }
    await this.sendAllowed({ method: "Input.insertText", params: { text: action.text } });
    return { ok: true, effect: { kind: "text_inserted", characterCount: [...action.text].length } };
  }

  private async navigate(action: { url?: unknown }): Promise<ActionExecutionResult> {
    if (typeof action.url !== "string") {
      return failure("MISSING_ACTION_PARAMETER", "Navigation requires a URL", false);
    }
    let url: URL;
    try { url = new URL(action.url); } catch {
      return failure("INVALID_NAVIGATION_URL", "Navigation URL is malformed", false);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return failure("INVALID_NAVIGATION_URL", "Only HTTP(S) navigation is supported", false);
    }
    if (url.username !== "" || url.password !== "") {
      return failure("INVALID_NAVIGATION_URL", "Navigation URL must not contain embedded credentials", false);
    }
    await this.sendAllowed({ method: "Page.navigate", params: { url: url.href } });
    return { ok: true, effect: { kind: "navigation", url: sanitizeObservationUrl(url.href) } };
  }

  private async historyBack(action: { steps?: unknown }): Promise<ActionExecutionResult> {
    const steps = action.steps ?? 1;
    if (!Number.isInteger(steps) || (steps as number) < 1 || (steps as number) > 20) {
      return failure("INVALID_ACTION_PARAMETER", "History steps must be an integer from 1 to 20", false);
    }
    const history = await this.sendAllowed({ method: "Page.getNavigationHistory" });
    const parsed = navigationHistory(history);
    if (!parsed) return failure("CDP_COMMAND_FAILED", "Navigation history response was invalid", true);
    const target = parsed.entries[parsed.currentIndex - (steps as number)];
    if (!target) return failure("HISTORY_ENTRY_UNAVAILABLE", "Requested history entry does not exist", true);
    const url = new URL(target.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return failure("INVALID_NAVIGATION_URL", "History target is not HTTP(S)", false);
    }
    if (url.username !== "" || url.password !== "") {
      return failure("INVALID_NAVIGATION_URL", "History target contains embedded credentials", false);
    }
    await this.sendAllowed({ method: "Page.navigate", params: { url: url.href } });
    return { ok: true, effect: { kind: "navigation", url: sanitizeObservationUrl(url.href) } };
  }

  private async waitFor(action: { durationMs?: unknown }): Promise<ActionExecutionResult> {
    if (!Number.isInteger(action.durationMs) || (action.durationMs as number) < 1 || (action.durationMs as number) > 60_000) {
      return failure("INVALID_ACTION_PARAMETER", "Wait duration must be from 1 to 60000 milliseconds", false);
    }
    await this.wait(action.durationMs as number);
    this.throwIfAborted();
    return { ok: true, effect: { kind: "wait", durationMs: action.durationMs } };
  }

  private point(rawX: unknown, rawY: unknown): { x: number; y: number } | ActionExecutionFailure {
    if (!finite(rawX) || !finite(rawY)) {
      return failure("MISSING_ACTION_PARAMETER", "Pointer actions require finite x and y coordinates", false);
    }
    return transformCapturedPoint(rawX, rawY, this.capture);
  }

  private verifyDeclaredTarget(action: ExecutableActionV1): ActionExecutionFailure | undefined {
    return verifyDeclaredTarget(action, this.observation, this.capture);
  }

  private mouse(params: Record<string, unknown>): Promise<unknown> {
    return this.sendAllowed({ method: "Input.dispatchMouseEvent", params });
  }

  private keyboard(params: Record<string, unknown>): Promise<unknown> {
    return this.sendAllowed({ method: "Input.dispatchKeyEvent", params });
  }

  private sendAllowed(command: AllowedCdpCommand): Promise<unknown> {
    this.throwIfAborted();
    return this.send(this.tabId, command);
  }

  private throwIfAborted(): void {
    if (this.activeSignal?.aborted) throw new DOMException("Aborted", "AbortError");
  }
}

export type { ObservationAuthority } from "./execution-pipeline";

export { createCanonicalExecutionPipeline } from "./execution-pipeline";

/** @internal Unusable without the one-shot module-private permit minted by the pipeline. */
export async function executePermittedPhysicalAction(
  permit: object,
  options: CanonicalExecutionPipelineOptions,
  command: ActionCommandV1,
  trusted: import("./execution-pipeline").TrustedExecutionContext,
  signal?: AbortSignal,
): Promise<ActionExecutionResult> {
  if (!consumePhysicalExecutionPermit(permit)) {
    return failure("POLICY_AUTHORIZATION_REQUIRED", "Physical execution permit is invalid", false);
  }
    const executor = new CanonicalActionExecutor({
      tabId: options.tabId,
      capture: trusted.capture,
      observation: trusted.observation,
      send: options.send,
      wait: options.wait,
    });
    return executor.execute(command as never, signal);
}

/**
 * Verifies an action's declared target using stable ref matching first,
 * falling back to coordinate verification if ref match confidence is insufficient.
 *
 * @param action - The action to verify, may contain a `ref` property with a StableRef
 * @param observation - The observation containing accessibilityNodes for ref matching
 * @param capture - The coordinate capture context for coordinate verification
 * @returns undefined if verified (proceed), or an ActionExecutionFailure if verification fails
 */
export function verifyDeclaredTarget(
  action: ExecutableActionV1,
  observation: { readonly semanticTargets: readonly SemanticTarget[]; readonly accessibilityNodes?: readonly AccessibilityNode[] } | undefined,
  capture: CapturedCoordinateContext,
): ActionExecutionFailure | undefined {
  const ref = (action as { ref?: StableRef }).ref;
  const axNodes = observation?.accessibilityNodes;
  if (ref && axNodes && axNodes.length > 0) {
    const match = matchStableRef(ref, Array.from(axNodes));
    if (match.confidence >= MATCH_CONFIDENCE_THRESHOLD) {
      return undefined; // verified via stable-ref; skip coordinate fallback
    }
  }
  if (observation === undefined || !("targetId" in action) || action.targetId === undefined) return undefined;
  const target = observation.semanticTargets.find((candidate) => candidate.visible && candidate.targetId === action.targetId);
  if (target === undefined) return failure("TARGET_NOT_FOUND", "Declared semantic target is unavailable", true);
  if (!("x" in action) || !("y" in action)) return undefined;
  const point = transformCapturedPoint(action.x, action.y, capture);
  if ("error" in point) return point;
  const box = target.boundingBox;
  if (point.x < box.x || point.x > box.x + box.width || point.y < box.y || point.y > box.y + box.height) {
    return failure("TARGET_COORDINATE_MISMATCH", "Pointer coordinate does not match the declared semantic target", true);
  }
  return undefined;
}


function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function modifierMask(raw: unknown): number | undefined {
  if (raw === undefined) return 0;
  if (!raw || typeof raw !== "object") return undefined;
  const modifiers = raw as Record<string, unknown>;
  for (const name of ["alt", "ctrl", "meta", "shift"]) {
    if (modifiers[name] !== undefined && typeof modifiers[name] !== "boolean") return undefined;
  }
  return (modifiers.alt ? 1 : 0) |
    (modifiers.ctrl ? 2 : 0) |
    (modifiers.meta ? 4 : 0) |
    (modifiers.shift ? 8 : 0);
}

function navigationHistory(raw: unknown): { currentIndex: number; entries: Array<{ url: string }> } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as { currentIndex?: unknown; entries?: unknown };
  if (!Number.isInteger(value.currentIndex) || !Array.isArray(value.entries)) return undefined;
  const entries: Array<{ url: string }> = [];
  for (const entry of value.entries) {
    if (!entry || typeof entry !== "object" || typeof (entry as { url?: unknown }).url !== "string") return undefined;
    entries.push({ url: (entry as { url: string }).url });
  }
  return { currentIndex: value.currentIndex as number, entries };
}

function failure(code: ActionExecutionError["code"], message: string, retryable: boolean): ActionExecutionFailure {
  return { ok: false, error: { code, message, retryable } };
}
