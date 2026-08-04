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
const DEFAULT_MAX_DOM_ELEMENTS = 5_000;
const MAX_DOM_ELEMENTS = 10_000;
const MAX_SENSITIVE_REGIONS = 200;
const MAX_ENCODED_PNG_LENGTH = 10_000_000;
const MAX_PNG_BYTES = 7_500_000;
const MAX_PNG_DIMENSION = 16_384;
const MAX_PNG_PIXELS = 50_000_000;
const UUID_BYTE_LENGTH = 16;

export type CdpCommandSender = (
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

export interface TabIdentity {
  id: number;
  windowId: number;
  active: boolean;
}

export interface SensitiveRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotMaskInput {
  pngBytes: Uint8Array;
  width: number;
  height: number;
  viewport: PageSnapshot["viewport"];
  sensitiveRegions: SensitiveRegion[];
}

export interface CaptureObservationOptions {
  captureVisibleTab?: (tabId: number, windowId: number) => Promise<string>;
  getTabIdentity?: (tabId: number) => Promise<TabIdentity>;
  getZoom?: (tabId: number) => Promise<number>;
  maskScreenshot?: (input: ScreenshotMaskInput) => Promise<Uint8Array>;
  maxDomElements?: number;
  maxSemanticTargets?: number;
  now?: () => Date;
  sendCdpCommand?: CdpCommandSender;
}

interface RawPageSnapshot {
  url?: unknown;
  title?: unknown;
  viewport?: unknown;
  readyState?: unknown;
  visibility?: unknown;
  documentToken?: unknown;
  childFrameCount?: unknown;
  domScanComplete?: unknown;
  sensitiveRegionOverflow?: unknown;
  sensitiveRegions?: unknown;
  semanticTargets?: unknown;
}

interface PageSnapshot {
  url: string;
  title: string;
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
    scrollX: number;
    scrollY: number;
  };
  readyState: ObservationV1["page"]["lifecycle"];
  visibility: ObservationV1["page"]["visibility"];
  documentToken: string;
  childFrameCount: number;
  domScanComplete: true;
  sensitiveRegionOverflow: false;
  sensitiveRegions: SensitiveRegion[];
  semanticTargets: RawSemanticTarget[];
}

interface RuntimeEvaluateResult {
  result?: { value?: unknown };
  exceptionDetails?: unknown;
}

interface ParsedPng {
  bytes: Uint8Array;
  data: string;
  width: number;
  height: number;
}

export class ObservationSecurityError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ObservationSecurityError";
    this.cause = cause;
  }
}

function securityError(
  message: string,
  cause?: unknown,
): ObservationSecurityError {
  return new ObservationSecurityError(message, cause);
}

function requireIntegerOption(
  name: string,
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isFinite(resolved) ||
    !Number.isInteger(resolved) ||
    resolved < 0 ||
    resolved > maximum
  ) {
    throw securityError(
      `${name} must be a finite integer between 0 and ${maximum}`,
    );
  }
  return resolved;
}

function requireFiniteNumber(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw securityError(`${name} must be finite`);
  }
  return value;
}

function requirePositiveInteger(name: string, value: unknown): number {
  const resolved = requireFiniteNumber(name, value);
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw securityError(`${name} must be a positive integer`);
  }
  return resolved;
}

function requireBoundedPositive(name: string, value: unknown): number {
  const resolved = requireFiniteNumber(name, value);
  if (resolved <= 0 || resolved > 8) {
    throw securityError(`${name} must be greater than zero and at most 8`);
  }
  return resolved;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const input = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(input).set(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}

function decodedBase64Length(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

function decodeBase64(data: string): Uint8Array {
  const decoded = atob(data);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function validatePngHeader(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 24 ||
    !signature.every((byte, index) => bytes[index] === byte)
  ) {
    throw securityError("Visible-tab capture returned an invalid PNG");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width * height > MAX_PNG_PIXELS) {
    throw securityError("Visible-tab PNG exceeds pixel limit");
  }
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_PNG_DIMENSION ||
    height > MAX_PNG_DIMENSION
  ) {
    throw securityError("Visible-tab PNG exceeds dimension limit");
  }
  return { width, height };
}

function parsePngDataUrl(dataUrl: string): ParsedPng {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) {
    throw securityError("Visible-tab capture did not return a PNG data URL");
  }

  const data = dataUrl.slice(prefix.length);
  if (data.length === 0 || data.length > MAX_ENCODED_PNG_LENGTH) {
    throw securityError("Visible-tab PNG exceeds encoded byte limit");
  }
  if (!/^[a-z0-9+/]+={0,2}$/i.test(data) || data.length % 4 === 1) {
    throw securityError("Visible-tab capture returned invalid base64");
  }

  const estimatedBytes = decodedBase64Length(data);
  if (estimatedBytes < 24 || estimatedBytes > MAX_PNG_BYTES) {
    throw securityError("Visible-tab PNG exceeds decoded byte limit");
  }

  const header = decodeBase64(data.slice(0, 32));
  const { width, height } = validatePngHeader(header);
  const bytes = decodeBase64(data);
  if (bytes.length !== estimatedBytes || bytes.length > MAX_PNG_BYTES) {
    throw securityError("Visible-tab PNG decoded length is invalid");
  }
  return { bytes, data, width, height };
}

function parseMaskedPng(bytes: Uint8Array): ParsedPng {
  if (bytes.length > MAX_PNG_BYTES) {
    throw securityError("Masked PNG exceeds decoded byte limit");
  }
  const { width, height } = validatePngHeader(bytes);
  const data = encodeBase64(bytes);
  if (data.length > MAX_ENCODED_PNG_LENGTH) {
    throw securityError("Masked PNG exceeds encoded byte limit");
  }
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

function collectPageSnapshot(
  maxCandidates: number,
  maxDomElements: number,
): RawPageSnapshot {
  const sensitivePattern =
    /\b(?:account|api[\s_-]*key|auth|bearer|credential|one[\s_-]*time[\s_-]*(?:code|password)|otp|passcode|password|secret|token)\b/i;
  const sensitiveValuePattern =
    /(?:\b\d{6}\b|\b\d{8,20}\b|\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]+|\b(?:ghp_|sk-|pk_live_)[a-z0-9_-]{8,})/i;
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

  const safeSemanticText = (text: string | undefined): string | undefined =>
    text && !sensitivePattern.test(text) && !sensitiveValuePattern.test(text)
      ? text
      : undefined;

  const implicitRole = (element: Element): string | undefined => {
    const tag = element.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (tag === "select") return "combobox";
    if (
      tag === "textarea" ||
      element.getAttribute("contenteditable") === "true"
    )
      return "textbox";
    if (tag === "input") {
      const type = (element.getAttribute("type") ?? "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    return undefined;
  };

  const actionableSelector = [
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
  const sensitiveRegions: SensitiveRegion[] = [];
  let sensitiveRegionOverflow = false;
  let childFrameCount = 0;
  let inspected = 0;
  const walker = document.createTreeWalker(
    document.documentElement,
    NodeFilter.SHOW_ELEMENT,
  );
  let node: Node | null = walker.currentNode;

  while (node && inspected < maxDomElements) {
    inspected += 1;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (tag === "iframe" || tag === "frame") childFrameCount += 1;

    if (isVisible(element)) {
      const rect = element.getBoundingClientRect();
      const type = element.getAttribute("type") ?? "";
      const metadata = [
        type,
        element.getAttribute("autocomplete") ?? "",
        element.getAttribute("name") ?? "",
        element.id,
        element.getAttribute("aria-label") ?? "",
      ].join(" ");
      const leafText =
        element.children.length === 0 ? visibleText(element) : undefined;
      const sensitiveLeafText =
        leafText !== undefined &&
        (sensitivePattern.test(leafText) ||
          sensitiveValuePattern.test(leafText));
      if (
        (tag === "input" && type.toLowerCase() === "password") ||
        tag === "canvas" ||
        tag === "video" ||
        sensitivePattern.test(metadata) ||
        sensitiveValuePattern.test(metadata) ||
        sensitiveLeafText
      ) {
        const maskElement =
          sensitiveLeafText && element.parentElement
            ? element.parentElement
            : element;
        const maskRect = maskElement.getBoundingClientRect();
        if (sensitiveRegions.length < MAX_SENSITIVE_REGIONS) {
          sensitiveRegions.push({
            x: maskRect.x,
            y: maskRect.y,
            width: maskRect.width,
            height: maskRect.height,
          });
        } else {
          sensitiveRegionOverflow = true;
        }
      }

      if (
        semanticTargets.length < maxCandidates &&
        element.matches(actionableSelector)
      ) {
        if (!(
          tag === "input" && ["password", "hidden"].includes(type.toLowerCase())
        )) {
          const ariaLabel = safeSemanticText(
            element.getAttribute("aria-label") ?? undefined,
          );
          const labelledBy = element.getAttribute("aria-labelledby");
          const labelledByText = labelledBy
            ? labelledBy
                .split(/\s+/)
                .map((id) =>
                  safeSemanticText(visibleText(document.getElementById(id))),
                )
                .filter(Boolean)
                .join(" ")
            : undefined;
          const inputLabels =
            "labels" in element ? (element as HTMLInputElement).labels : null;
          const label = safeSemanticText(
            visibleText(inputLabels?.item(0) ?? null),
          );
          const ownText = safeSemanticText(visibleText(element));
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
            if (value !== null && !sensitivePattern.test(value)) {
              attributes[attribute] = value;
            }
          }
          semanticTargets.push({
            tag,
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
      }
    }
    node = walker.nextNode();
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
    documentToken: `${performance.timeOrigin}:${location.href}`,
    childFrameCount,
    domScanComplete: node === null,
    sensitiveRegionOverflow,
    sensitiveRegions,
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
        reject(
          securityError(`Observation CDP command failed: ${error.message}`),
        );
        return;
      }
      resolve(result);
    });
  });
}

async function defaultGetTabIdentity(tabId: number): Promise<TabIdentity> {
  const tab = await chrome.tabs.get(tabId);
  const activeTabs = await chrome.tabs.query({
    active: true,
    windowId: tab.windowId,
  });
  return {
    id: tab.id ?? -1,
    windowId: tab.windowId,
    active:
      tab.active === true &&
      activeTabs.length === 1 &&
      activeTabs[0]?.id === tabId,
  };
}

async function defaultCaptureVisibleTab(
  _tabId: number,
  windowId: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(securityError(`Visible-tab capture failed: ${error.message}`));
        return;
      }
      if (!dataUrl) {
        reject(securityError("Visible-tab capture returned no data"));
        return;
      }
      resolve(dataUrl);
    });
  });
}

async function defaultGetZoom(tabId: number): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.tabs.getZoom(tabId, (zoomFactor) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(securityError(`Tab zoom capture failed: ${error.message}`));
        return;
      }
      resolve(zoomFactor);
    });
  });
}

async function defaultMaskScreenshot(
  input: ScreenshotMaskInput,
): Promise<Uint8Array> {
  if (input.sensitiveRegions.length === 0) return input.pngBytes;
  if (
    typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap === "undefined"
  ) {
    throw securityError("Sensitive screenshot masking is unavailable");
  }

  const sourceBuffer = new ArrayBuffer(input.pngBytes.byteLength);
  new Uint8Array(sourceBuffer).set(input.pngBytes);
  const bitmap = await createImageBitmap(
    new Blob([sourceBuffer], { type: "image/png" }),
  );
  try {
    if (bitmap.width !== input.width || bitmap.height !== input.height) {
      throw securityError("Decoded PNG dimensions do not match its header");
    }
    const canvas = new OffscreenCanvas(input.width, input.height);
    const context = canvas.getContext("2d");
    if (!context)
      throw securityError(
        "Sensitive screenshot masking context is unavailable",
      );
    context.drawImage(bitmap, 0, 0);
    context.fillStyle = "#000000";
    const scaleX = input.width / input.viewport.width;
    const scaleY = input.height / input.viewport.height;
    for (const region of input.sensitiveRegions) {
      const x = Math.max(0, Math.floor(region.x * scaleX));
      const y = Math.max(0, Math.floor(region.y * scaleY));
      const right = Math.min(
        input.width,
        Math.ceil((region.x + region.width) * scaleX),
      );
      const bottom = Math.min(
        input.height,
        Math.ceil((region.y + region.height) * scaleY),
      );
      if (right <= x || bottom <= y)
        throw securityError("Sensitive region cannot be masked");
      context.fillRect(x, y, right - x, bottom - y);
    }
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

function validateSensitiveRegions(
  value: unknown,
  viewport: PageSnapshot["viewport"],
): SensitiveRegion[] {
  if (!Array.isArray(value) || value.length > MAX_SENSITIVE_REGIONS) {
    throw securityError("Sensitive region list exceeds limit");
  }
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object")
      throw securityError(`Sensitive region ${index} is invalid`);
    const region = raw as Record<string, unknown>;
    const x = requireFiniteNumber(`sensitiveRegions[${index}].x`, region.x);
    const y = requireFiniteNumber(`sensitiveRegions[${index}].y`, region.y);
    const width = requireFiniteNumber(
      `sensitiveRegions[${index}].width`,
      region.width,
    );
    const height = requireFiniteNumber(
      `sensitiveRegions[${index}].height`,
      region.height,
    );
    if (
      width <= 0 ||
      height <= 0 ||
      x >= viewport.width ||
      y >= viewport.height ||
      x + width <= 0 ||
      y + height <= 0
    ) {
      throw securityError(`Sensitive region ${index} is outside the viewport`);
    }
    return { x, y, width, height };
  });
}

function validatePageSnapshot(value: unknown): PageSnapshot {
  if (!value || typeof value !== "object")
    throw securityError("Runtime evaluation returned no page snapshot");
  const raw = value as RawPageSnapshot;
  if (!raw.viewport || typeof raw.viewport !== "object")
    throw securityError("Runtime evaluation returned no viewport");
  const viewportValue = raw.viewport as Record<string, unknown>;
  const viewport: PageSnapshot["viewport"] = {
    width: requirePositiveInteger("viewport.width", viewportValue.width),
    height: requirePositiveInteger("viewport.height", viewportValue.height),
    devicePixelRatio: requireBoundedPositive(
      "viewport.devicePixelRatio",
      viewportValue.devicePixelRatio,
    ),
    scrollX: requireFiniteNumber("viewport.scrollX", viewportValue.scrollX),
    scrollY: requireFiniteNumber("viewport.scrollY", viewportValue.scrollY),
  };
  if (typeof raw.url !== "string" || typeof raw.title !== "string") {
    throw securityError("Page URL and title must be strings");
  }
  if (
    !(["loading", "interactive", "complete", "frozen"] as unknown[]).includes(
      raw.readyState,
    )
  ) {
    throw securityError("Page lifecycle is invalid");
  }
  if (
    !(["visible", "hidden", "prerender"] as unknown[]).includes(raw.visibility)
  ) {
    throw securityError("Page visibility is invalid");
  }
  if (
    typeof raw.documentToken !== "string" ||
    raw.documentToken.length === 0 ||
    raw.documentToken.length > 512
  ) {
    throw securityError("Page document identity is invalid");
  }
  const childFrameCount = requireFiniteNumber(
    "childFrameCount",
    raw.childFrameCount,
  );
  if (!Number.isInteger(childFrameCount) || childFrameCount < 0)
    throw securityError("Child frame count is invalid");
  if (raw.domScanComplete !== true)
    throw securityError("DOM scan limit reached before privacy scan completed");
  if (raw.sensitiveRegionOverflow !== false)
    throw securityError("Sensitive region limit reached");
  if (!Array.isArray(raw.semanticTargets))
    throw securityError("Semantic targets are invalid");

  return {
    url: raw.url,
    title: raw.title,
    viewport,
    readyState: raw.readyState as PageSnapshot["readyState"],
    visibility: raw.visibility as PageSnapshot["visibility"],
    documentToken: raw.documentToken,
    childFrameCount,
    domScanComplete: true,
    sensitiveRegionOverflow: false,
    sensitiveRegions: validateSensitiveRegions(raw.sensitiveRegions, viewport),
    semanticTargets: raw.semanticTargets as RawSemanticTarget[],
  };
}

async function capturePageSnapshot(
  tabId: number,
  sendCdpCommand: CdpCommandSender,
  maxSemanticTargets: number,
  maxDomElements: number,
): Promise<PageSnapshot> {
  const runtimeResult = (await sendCdpCommand(tabId, "Runtime.evaluate", {
    expression: `(${collectPageSnapshot.toString()})(${maxSemanticTargets}, ${maxDomElements})`,
    returnByValue: true,
    awaitPromise: false,
  })) as RuntimeEvaluateResult;
  if (runtimeResult.exceptionDetails)
    throw securityError("Page snapshot evaluation failed");
  return validatePageSnapshot(runtimeResult.result?.value);
}

function requireActiveIdentity(
  tabId: number,
  expected: TabIdentity | undefined,
  actual: TabIdentity,
): TabIdentity {
  if (
    !Number.isInteger(actual.id) ||
    !Number.isInteger(actual.windowId) ||
    actual.id !== tabId ||
    actual.active !== true ||
    (expected &&
      (actual.id !== expected.id || actual.windowId !== expected.windowId))
  ) {
    throw securityError(
      expected
        ? "The active tab changed during visible capture"
        : "Target tab is not the active tab",
    );
  }
  return actual;
}

function pageSnapshotsMatch(
  before: PageSnapshot,
  after: PageSnapshot,
): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

function validateScreenshotViewport(
  screenshot: { width: number; height: number },
  viewport: PageSnapshot["viewport"],
  zoom: number,
): void {
  const scales = [viewport.devicePixelRatio, viewport.devicePixelRatio * zoom];
  const matches = scales.some((scale) => {
    const expectedWidth = viewport.width * scale;
    const expectedHeight = viewport.height * scale;
    const widthTolerance = Math.max(0.5, expectedWidth * 0.01);
    const heightTolerance = Math.max(0.5, expectedHeight * 0.01);
    return (
      Math.abs(screenshot.width - expectedWidth) <= widthTolerance &&
      Math.abs(screenshot.height - expectedHeight) <= heightTolerance
    );
  });
  if (!matches)
    throw securityError(
      "Screenshot does not match viewport dimensions, DPR, and zoom",
    );
}

async function captureObservationInternal(
  tabId: number,
  options: CaptureObservationOptions,
): Promise<ObservationV1> {
  if (!Number.isInteger(tabId) || tabId <= 0)
    throw securityError("tabId must be a positive integer");
  const maxSemanticTargets = requireIntegerOption(
    "maxSemanticTargets",
    options.maxSemanticTargets,
    DEFAULT_MAX_SEMANTIC_TARGETS,
    DEFAULT_MAX_SEMANTIC_TARGETS,
  );
  const maxDomElements = requireIntegerOption(
    "maxDomElements",
    options.maxDomElements,
    DEFAULT_MAX_DOM_ELEMENTS,
    MAX_DOM_ELEMENTS,
  );
  if (maxDomElements === 0)
    throw securityError("maxDomElements must be greater than zero");
  const now = (options.now ?? (() => new Date()))();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw securityError("Capture time is invalid");
  const capturedAt = now.toISOString();
  const sendCdpCommand = options.sendCdpCommand ?? defaultSendCdpCommand;
  const captureVisibleTab =
    options.captureVisibleTab ?? defaultCaptureVisibleTab;
  const getTabIdentity = options.getTabIdentity ?? defaultGetTabIdentity;
  const getZoom = options.getZoom ?? defaultGetZoom;
  const maskScreenshot = options.maskScreenshot ?? defaultMaskScreenshot;

  const initialIdentity = requireActiveIdentity(
    tabId,
    undefined,
    await getTabIdentity(tabId),
  );
  const zoomBefore = requireBoundedPositive("zoom", await getZoom(tabId));
  const before = await capturePageSnapshot(
    tabId,
    sendCdpCommand,
    maxSemanticTargets,
    maxDomElements,
  );
  if (before.childFrameCount > 0) {
    throw securityError(
      "Observation capture does not support child frames; capture is incomplete",
    );
  }

  requireActiveIdentity(tabId, initialIdentity, await getTabIdentity(tabId));
  const rawScreenshot = parsePngDataUrl(
    await captureVisibleTab(tabId, initialIdentity.windowId),
  );
  requireActiveIdentity(tabId, initialIdentity, await getTabIdentity(tabId));

  const after = await capturePageSnapshot(
    tabId,
    sendCdpCommand,
    maxSemanticTargets,
    maxDomElements,
  );
  const zoomAfter = requireBoundedPositive("zoom", await getZoom(tabId));
  if (after.childFrameCount > 0) {
    throw securityError(
      "Observation capture does not support child frames; capture is incomplete",
    );
  }
  if (zoomBefore !== zoomAfter || !pageSnapshotsMatch(before, after)) {
    throw securityError(
      "The page changed during capture; observation rejected",
    );
  }
  validateScreenshotViewport(rawScreenshot, after.viewport, zoomAfter);

  const maskedBytes = await maskScreenshot({
    pngBytes: rawScreenshot.bytes,
    width: rawScreenshot.width,
    height: rawScreenshot.height,
    viewport: after.viewport,
    sensitiveRegions: after.sensitiveRegions,
  });
  if (
    after.sensitiveRegions.length > 0 &&
    maskedBytes.length === rawScreenshot.bytes.length &&
    maskedBytes.every((byte, index) => byte === rawScreenshot.bytes[index])
  ) {
    throw securityError("Masker returned an unchanged sensitive screenshot");
  }
  const screenshot = parseMaskedPng(maskedBytes);
  if (
    screenshot.width !== rawScreenshot.width ||
    screenshot.height !== rawScreenshot.height
  ) {
    throw securityError("Masked screenshot dimensions changed");
  }
  validateScreenshotViewport(screenshot, after.viewport, zoomAfter);
  const screenshotHash = bytesToHex(await sha256(screenshot.bytes));
  const pageFrameId = await opaqueUuid(`frame:${tabId}:main`);
  const canonicalTargets: SemanticTarget[] = [];

  for (const [index, rawTarget] of after.semanticTargets.entries()) {
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
    url: sanitizeObservationUrl(after.url),
    title: sanitizeBrowserText(after.title),
    screenshot: {
      kind: "inline",
      encoding: "png",
      data: screenshot.data,
      sha256: screenshotHash,
      width: screenshot.width,
      height: screenshot.height,
    },
    viewport: {
      ...after.viewport,
      zoom: zoomAfter,
    },
    page: {
      tabId: opaqueTabId as ObservationV1["page"]["tabId"],
      frameId: pageFrameId as ObservationV1["page"]["frameId"],
      lifecycle: after.readyState,
      visibility: after.visibility,
    },
    semanticTargets: canonicalTargets,
  };

  assertNoForbiddenBrowserData(observation);
  return ObservationV1Schema.parse(observation);
}

/** Captures, privacy-masks, and validates the only outbound browser-observation representation. */
export async function captureObservation(
  tabId: number,
  options: CaptureObservationOptions = {},
): Promise<ObservationV1> {
  try {
    return await captureObservationInternal(tabId, options);
  } catch (error) {
    if (error instanceof ObservationSecurityError) throw error;
    throw securityError(
      "Captured observation failed the local outbound security boundary",
      error,
    );
  }
}
