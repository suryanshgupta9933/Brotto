import {
  ObservationV1Schema,
  assertNoForbiddenBrowserData,
  type ObservationV1,
  type SemanticTarget,
} from "@fara-platform/fara-action-schema";
import {
  sanitizeBrowserText,
  sanitizeObservationUrl,
  sanitizeSemanticTarget,
  type RawSemanticTarget,
} from "./redaction";

const DEFAULT_MAX_SEMANTIC_TARGETS = 200;
const UUID_BYTE_LENGTH = 16;

export type CdpCommandSender = (
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

export interface CaptureObservationOptions {
  captureVisibleTab?: (tabId: number) => Promise<string>;
  getZoom?: (tabId: number) => Promise<number>;
  maxSemanticTargets?: number;
  now?: () => Date;
  sendCdpCommand?: CdpCommandSender;
}

interface PageSnapshot {
  url: unknown;
  title: unknown;
  viewport: {
    width: unknown;
    height: unknown;
    devicePixelRatio: unknown;
    scrollX: unknown;
    scrollY: unknown;
  };
  readyState: unknown;
  visibility: unknown;
  semanticTargets: RawSemanticTarget[];
}

interface RuntimeEvaluateResult {
  result?: {
    value?: unknown;
  };
  exceptionDetails?: unknown;
}

export class ObservationSecurityError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ObservationSecurityError";
    this.cause = cause;
  }
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = asFiniteNumber(value, fallback);
  return Math.max(1, Math.floor(number));
}

function boundedPositive(value: unknown, fallback: number): number {
  return Math.min(8, Math.max(Number.EPSILON, asFiniteNumber(value, fallback)));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const input = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(input).set(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}

function decodeBase64(data: string): Uint8Array {
  const decoded = atob(data);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function parsePngDataUrl(dataUrl: string): {
  bytes: Uint8Array;
  data: string;
  width: number;
  height: number;
} {
  const match = /^data:image\/png;base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match)
    throw new Error("Visible-tab capture did not return a PNG data URL");

  const data = match[1];
  const bytes = decodeBase64(data);
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 24 ||
    !pngSignature.every((byte, index) => bytes[index] === byte)
  ) {
    throw new Error("Visible-tab capture returned an invalid PNG");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1)
    throw new Error("Visible-tab capture returned invalid dimensions");

  return { bytes, data, width, height };
}

async function opaqueUuid(seed: string): Promise<string> {
  const digest = await sha256(new TextEncoder().encode(seed));
  const bytes = digest.slice(0, UUID_BYTE_LENGTH);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function collectPageSnapshot(maxCandidates: number): PageSnapshot {
  const isVisible = (element: Element): boolean => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      element.getAttribute("aria-hidden") !== "true" &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth
    );
  };

  const visibleText = (element: Element | null): string | undefined => {
    if (!element || !isVisible(element)) return undefined;
    const text = (element as HTMLElement).innerText;
    return typeof text === "string" ? text : undefined;
  };

  const implicitRole = (element: Element): string | undefined => {
    const tag = element.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (element.getAttribute("contenteditable") === "true") return "textbox";
    if (tag === "input") {
      const type = (element.getAttribute("type") ?? "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    return undefined;
  };

  const selector = [
    "a[href]",
    "button",
    "input:not([type='hidden']):not([type='password'])",
    "select",
    "textarea",
    "[role='button']",
    "[role='checkbox']",
    "[role='combobox']",
    "[role='link']",
    "[role='listbox']",
    "[role='menuitem']",
    "[role='option']",
    "[role='radio']",
    "[role='searchbox']",
    "[role='slider']",
    "[role='spinbutton']",
    "[role='switch']",
    "[role='tab']",
    "[role='textbox']",
    "[tabindex]:not([tabindex='-1'])",
    "[contenteditable='true']",
  ].join(",");

  const semanticTargets: RawSemanticTarget[] = [];
  for (const element of Array.from(document.querySelectorAll(selector))) {
    if (semanticTargets.length >= maxCandidates || !isVisible(element))
      continue;

    const type = element.getAttribute("type") ?? undefined;
    if (
      element.tagName.toLowerCase() === "input" &&
      ["password", "hidden"].includes((type ?? "text").toLowerCase())
    ) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    const ariaLabel = element.getAttribute("aria-label") ?? undefined;
    const labelledBy = element.getAttribute("aria-labelledby");
    const labelledByText = labelledBy
      ? labelledBy
          .split(/\s+/)
          .map((id) => visibleText(document.getElementById(id)))
          .filter(Boolean)
          .join(" ")
      : undefined;
    const inputLabels =
      "labels" in element ? (element as HTMLInputElement).labels : null;
    const label = visibleText(inputLabels?.item(0) ?? null);
    const ownText = visibleText(element);
    const accessibleName = ariaLabel
      ? { source: "aria-label", text: ariaLabel }
      : labelledByText
        ? { source: "aria-labelledby", text: labelledByText }
        : (label ?? ownText)
          ? { source: "visible_text", text: label ?? ownText }
          : undefined;

    const attributes: Record<string, string> = {};
    for (const attribute of [
      "aria-label",
      "aria-describedby",
      "aria-controls",
      "aria-expanded",
      "aria-haspopup",
      "aria-current",
      "aria-pressed",
      "aria-selected",
      "data-testid",
      "name",
      "type",
    ]) {
      const value = element.getAttribute(attribute);
      if (value !== null) attributes[attribute] = value;
    }

    semanticTargets.push({
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") ?? implicitRole(element),
      accessibleName,
      label,
      attributes,
      boundingBox: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      visible: true,
      framePath: [],
      locatorCandidates: [],
    });
  }

  return {
    url: location.href,
    title: document.title,
    viewport: {
      width: innerWidth,
      height: innerHeight,
      devicePixelRatio,
      scrollX,
      scrollY,
    },
    readyState: document.readyState,
    visibility: document.visibilityState,
    semanticTargets,
  };
}

async function defaultSendCdpCommand(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(`Observation CDP command failed: ${error.message}`));
        return;
      }
      resolve(result);
    });
  });
}

async function defaultCaptureVisibleTab(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(
      tab.windowId,
      { format: "png" },
      (dataUrl) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(`Visible-tab capture failed: ${error.message}`));
          return;
        }
        if (!dataUrl) {
          reject(new Error("Visible-tab capture returned no data"));
          return;
        }
        resolve(dataUrl);
      },
    );
  });
}

async function defaultGetZoom(tabId: number): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.tabs.getZoom(tabId, (zoomFactor) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(`Tab zoom capture failed: ${error.message}`));
        return;
      }
      resolve(zoomFactor);
    });
  });
}

function parsePageSnapshot(value: unknown): PageSnapshot {
  if (!value || typeof value !== "object")
    throw new Error("Runtime evaluation returned no page snapshot");
  const snapshot = value as Partial<PageSnapshot>;
  if (!snapshot.viewport || typeof snapshot.viewport !== "object") {
    throw new Error("Runtime evaluation returned no viewport");
  }
  return {
    url: snapshot.url,
    title: snapshot.title,
    viewport: snapshot.viewport,
    readyState: snapshot.readyState,
    visibility: snapshot.visibility,
    semanticTargets: Array.isArray(snapshot.semanticTargets)
      ? snapshot.semanticTargets
      : [],
  };
}

function lifecycle(value: unknown): ObservationV1["page"]["lifecycle"] {
  if (
    value === "loading" ||
    value === "interactive" ||
    value === "complete" ||
    value === "frozen"
  ) {
    return value;
  }
  return "loading";
}

function visibility(value: unknown): ObservationV1["page"]["visibility"] {
  if (value === "hidden" || value === "prerender" || value === "visible")
    return value;
  return "hidden";
}

/** Captures and validates the only outbound browser-observation representation. */
export async function captureObservation(
  tabId: number,
  options: CaptureObservationOptions = {},
): Promise<ObservationV1> {
  const maxSemanticTargets = Math.min(
    DEFAULT_MAX_SEMANTIC_TARGETS,
    Math.max(
      0,
      Math.floor(options.maxSemanticTargets ?? DEFAULT_MAX_SEMANTIC_TARGETS),
    ),
  );
  const sendCdpCommand = options.sendCdpCommand ?? defaultSendCdpCommand;
  const captureVisibleTab =
    options.captureVisibleTab ?? defaultCaptureVisibleTab;
  const getZoom = options.getZoom ?? defaultGetZoom;
  const capturedAt = (options.now ?? (() => new Date()))().toISOString();

  const [runtimeResult, screenshotDataUrl, zoom] = await Promise.all([
    sendCdpCommand(tabId, "Runtime.evaluate", {
      expression: `(${collectPageSnapshot.toString()})(${maxSemanticTargets})`,
      returnByValue: true,
      awaitPromise: false,
    }),
    captureVisibleTab(tabId),
    getZoom(tabId),
  ]);

  const evaluation = runtimeResult as RuntimeEvaluateResult;
  if (evaluation.exceptionDetails)
    throw new Error("Page snapshot evaluation failed");
  const snapshot = parsePageSnapshot(evaluation.result?.value);
  const screenshot = parsePngDataUrl(screenshotDataUrl);
  const screenshotHash = bytesToHex(await sha256(screenshot.bytes));
  const pageFrameId = await opaqueUuid(`frame:${tabId}:main`);
  const canonicalTargets: SemanticTarget[] = [];

  for (const [index, rawTarget] of snapshot.semanticTargets.entries()) {
    if (canonicalTargets.length >= maxSemanticTargets) break;
    const seed = JSON.stringify({
      tabId,
      frame: pageFrameId,
      index,
      tag: rawTarget.tag,
      role: rawTarget.role,
      boundingBox: rawTarget.boundingBox,
    });
    const targetId = await opaqueUuid(`target:${seed}`);
    const target = sanitizeSemanticTarget({ ...rawTarget, targetId });
    if (target) canonicalTargets.push(target);
  }

  const observationId = await opaqueUuid(
    `observation:${tabId}:${capturedAt}:${screenshotHash}`,
  );
  const opaqueTabId = await opaqueUuid(`tab:${tabId}`);
  const observation: ObservationV1 = {
    observationId: observationId as ObservationV1["observationId"],
    capturedAt,
    url: sanitizeObservationUrl(snapshot.url),
    title: sanitizeBrowserText(snapshot.title),
    screenshot: {
      kind: "inline",
      encoding: "png",
      data: screenshot.data,
      sha256: screenshotHash,
      width: screenshot.width,
      height: screenshot.height,
    },
    viewport: {
      width: positiveInteger(snapshot.viewport.width, 1),
      height: positiveInteger(snapshot.viewport.height, 1),
      devicePixelRatio: boundedPositive(snapshot.viewport.devicePixelRatio, 1),
      zoom: boundedPositive(zoom, 1),
      scrollX: asFiniteNumber(snapshot.viewport.scrollX, 0),
      scrollY: asFiniteNumber(snapshot.viewport.scrollY, 0),
    },
    page: {
      tabId: opaqueTabId as ObservationV1["page"]["tabId"],
      frameId: pageFrameId as ObservationV1["page"]["frameId"],
      lifecycle: lifecycle(snapshot.readyState),
      visibility: visibility(snapshot.visibility),
    },
    semanticTargets: canonicalTargets,
  };

  try {
    assertNoForbiddenBrowserData(observation);
    return ObservationV1Schema.parse(observation);
  } catch (error) {
    throw new ObservationSecurityError(
      "Captured observation failed the local outbound security boundary",
      error,
    );
  }
}
