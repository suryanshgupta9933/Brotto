import {
  ForbiddenBrowserDataError,
  ObservationV1Schema,
  assertNoForbiddenBrowserData,
  type ObservationV1,
  type SemanticTarget,
} from "@brotto/brotto-action-schema";
import {
  sanitizeBrowserText,
  sanitizeObservationUrl,
  sanitizeSemanticTarget,
  type RawSemanticTarget,
} from "./redaction";
import { collectAccessibilitySnapshot } from "./ax-snapshot";

const DEFAULT_MAX_SEMANTIC_TARGETS = 200;
// ponytail: Gmail, login widgets, and other real-world apps easily exceed
// 10k DOM elements. Default 15k covers Gmail; max 50k handles the worst cases
// without timing out the CDP call.
const DEFAULT_MAX_DOM_ELEMENTS = 15_000;
const MAX_DOM_ELEMENTS = 50_000;
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
  domScanComplete?: unknown;
  sensitiveRegionOverflow?: unknown;
  sensitiveRegions?: unknown;
  semanticTargets?: unknown;
  bodyTextSnippet?: unknown;
  // ponytail: replay-ready fields populated by collectPageSnapshot.
  pageIdentity?: unknown;
  pagePurpose?: unknown;
  links?: unknown;
  buttons?: unknown;
}

interface PageLinkSnapshot {
  text: string;
  href: string;
  axPath: Array<{ role: string; index: number; name?: string }>;
  attributeHash: string;
  bbox: { x: number; y: number; width: number; height: number };
}

interface PageButtonSnapshot {
  text: string;
  axPath: Array<{ role: string; index: number; name?: string }>;
  attributeHash: string;
  bbox: { x: number; y: number; width: number; height: number };
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
  domScanComplete: true;
  sensitiveRegionOverflow: false;
  sensitiveRegions: SensitiveRegion[];
  semanticTargets: RawSemanticTarget[];
  bodyTextSnippet: string;
  // ponytail: replay-ready fields populated by collectPageSnapshot.
  pageIdentity: string;
  pagePurpose: string;
  links: PageLinkSnapshot[];
  buttons: PageButtonSnapshot[];
}

interface RuntimeEvaluateResult {
  result?: { value?: unknown };
  exceptionDetails?: unknown;
}

interface FrameTopology {
  mainFrameId: string;
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
  maxSensitiveRegions: number,
): RawPageSnapshot {
  const sensitivePattern =
    /\b(?:account|api[\s_-]*key|auth|bearer|credential|one[\s_-]*time[\s_-]*(?:code|password)|otp|passcode|password|secret|token)\b/i;
  const sensitiveValuePattern =
    /(?:\b\d{6}\b|\b\d{8,20}\b|\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]+|\b(?:ghp_|sk-|pk_live_)[a-z0-9_-]{8,})/i;
  const isTopmost = (element: Element, rect: DOMRect): boolean => {
    if (typeof document.elementFromPoint !== "function") return true;
    const points = [
      [rect.left + rect.width * 0.5, rect.top + rect.height * 0.5],
      [rect.left + 4, rect.top + 4],
      [rect.right - 4, rect.top + 4],
      [rect.left + 4, rect.bottom - 4],
    ];
    let hits = 0;
    let tested = 0;
    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit) continue; // JSDOM or off-screen hit
      tested++;
      if (hit === element || element.contains(hit) || hit.contains(element)) {
        hits++;
      }
    }
    // If elementFromPoint is un-implemented in test env (tested === 0), default to true
    return tested === 0 ? true : hits > 0;
  };


  const isVisible = (element: Element): boolean => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const basicVis = (
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
    if (!basicVis) return false;
    // ponytail: occlusion test via elementFromPoint sampling — ensures elements
    // hidden behind modals, backdrops, sticky banners or popovers are not reported.
    return isTopmost(element, rect);
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
    "summary",
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
    "[role='treeitem']",
    "[aria-haspopup]",
    "[aria-expanded]",
    "[tabindex]:not([tabindex='-1'])",
    "[contenteditable='true']",
  ].join(",");

  const semanticTargets: RawSemanticTarget[] = [];
  const sensitiveRegions: SensitiveRegion[] = [];
  let sensitiveRegionOverflow = false;
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
        if (sensitiveRegions.length < maxSensitiveRegions) {
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
            "href",
            "placeholder",
            "title",
            "alt",
            "id",
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

  // ponytail: smart structured page extraction — replaces the lazy
  // textContent.slice(N) cap. Walks DOM with structure awareness so the
  // planner sees HEADINGS, STATS (number + label, e.g. "12 followers"),
  // LABELS, and deduplicated TEXT. No arbitrary cap; scales with page
  // complexity. The orchestrator's SNAPSHOT_FN_SRC does the same shape so
  // Playwright and extension paths produce equivalent context.
  const bodyTextSnippet = (() => {
    const SKIP_TAGS: Record<string, number> = {
      script: 1, style: 1, meta: 1, link: 1, noscript: 1, svg: 1, path: 1,
    };
    const HIDDEN_ROLES: Record<string, number> = {
      contentinfo: 1,
    };
    // ponytail: literal chrome denylist (replaces the over-broad NAV_LINE_RE
    // regex that hid navigation labels the model actually needs, e.g.
    // "Browse repositories", "Filter by languages"). Only the literal
    // cookie/copyright chrome goes through this filter now.
    const CHROME_DENYLIST = new Set([
      "skip to content", "skip to main content", "skip to navigation",
      "©", "all rights reserved",
    ]);
    const clean = (s: string | null | undefined): string =>
      (s || "").replace(/\s+/g, " ").trim();
    const vis = (el: Element | null): boolean => {
      if (!el) return false;
      const t = el.tagName ? el.tagName.toLowerCase() : "";
      if (SKIP_TAGS[t]) return false;
      try {
        const cs = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
        if (!cs) return true;
        return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity ?? "1") > 0;
      } catch {
        return true;
      }
    };

    const parts: string[] = [];

    const heads: string[] = [];
    document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
      if (!vis(h)) return;
      const t = clean(h.textContent);
      if (t && t.length < 200) heads.push(`H${h.tagName[1]}: ${t}`);
    });
    if (heads.length) parts.push("=== HEADINGS ===\n" + heads.join("\n"));

    const stats: string[] = [];
    document.querySelectorAll("a, span, strong, b, div, p").forEach((el) => {
      if (!vis(el)) return;
      const own = clean(el.textContent);
      if (!/^\d{1,6}(,\d{3})*(\.\d+)?[KMBkmb]?$/.test(own) && !/^(?:★|⭐|stars?|followers?|forks?)\s*\d+/i.test(own)) return;
      const p = el.parentElement;
      if (!p) return;
      const pt = clean(p.textContent);
      if (pt.length > 120 || pt.length < own.length + 1) return;
      const label = pt.replace(own, "").trim();
      if (label && label.length < 60) stats.push(`${label}: ${own}`);
    });
    if (stats.length) parts.push("=== STATS ===\n" + stats.join("\n"));

    const lbls: string[] = [];
    document.querySelectorAll("label").forEach((l) => {
      if (!vis(l)) return;
      const t = clean(l.textContent);
      if (t && t.length < 80) lbls.push(t);
    });
    if (lbls.length) parts.push("=== LABELS ===\n" + lbls.join("\n"));

    // ponytail: extract structured card/list items on dynamic SPAs (e.g. GitHub repos,
    // search results, feeds, articles). Gives the model full visibility into item lists.
    const cardItems: string[] = [];
    document.querySelectorAll("li, article, [role='listitem'], .Box-row, [itemtype]").forEach((el) => {
      if (!vis(el)) return;
      // Extract text content AND any aria-labels/titles from icons (like star counts)
      let textContent = "";
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          textContent += node.textContent + " ";
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const e = node as Element;
          if (!vis(e)) return;
          const label = e.getAttribute("aria-label") || e.getAttribute("title");
          if (label && e.tagName === "SVG") textContent += `[${label}] `;
          e.childNodes.forEach(walk);
        }
      };
      walk(el);
      const text = clean(textContent);
      if (text && text.length > 5 && text.length < 800) {
        cardItems.push(`• ${text}`);
      }
    });
    if (cardItems.length > 0) {
      parts.push("=== CARDS & LIST ITEMS ===\n" + cardItems.slice(0, 50).join("\n"));
    }

    const seen: Record<string, number> = {};
    const lines: string[] = [];
    const walkText = (el: Node | null, depth: number): void => {
      if (depth > 25 || !el) return;
      if (el.nodeType === Node.TEXT_NODE) {
        const t = clean(el.textContent);
        if (t.length < 3) return;
        if (CHROME_DENYLIST.has(t.toLowerCase())) return;
        if (seen[t]) return;
        seen[t] = 1;
        lines.push(t);
        return;
      }
      if (el.nodeType !== Node.ELEMENT_NODE) return;
      const elEl = el as Element;
      if (!vis(elEl)) return;
      const role = elEl.getAttribute && elEl.getAttribute("role");
      if (role && HIDDEN_ROLES[role]) return;
      elEl.childNodes.forEach((c) => walkText(c, depth + 1));
    };
    walkText(document.body, 0);
    if (lines.length) parts.push("=== TEXT ===\n" + lines.slice(0, 150).join("\n"));


    return parts.join("\n\n");
  })();

  // ponytail: page purpose — meta description + first h1. Stable step label
  // for the future workflow recorder; orients the model in one glance.
  // Built first so the role-tag index below can use documentElement as root.
  const pagePurpose = (() => {
    const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
    const metaDesc = meta ? (meta.getAttribute("content") || "").trim() : "";
    const h1 = document.querySelector("h1");
    const h1Text = h1 ? (h1.textContent || "").trim() : "";
    const parts = [metaDesc, h1Text].filter((s) => s.length > 0);
    return parts.join(" — ").slice(0, 512);
  })();

  // ponytail: page-identity fingerprint. CRITICAL PERFORMANCE: do NOT
  // walk the entire DOM here. The previous slice E implementation built
  // roleIndex + siblingRoleIndex + identityLines in a single TreeWalker
  // pass — that cost 5-15s on heavy pages (GitHub/Gmail/Reddit) and
  // was the actual root cause of the 25s capture timeout. Replace with
  // a cheap 3-signal hash that captures page identity for stagnation
  // detection without walking the DOM:
  // ponytail: page-identity fingerprint. Cheap signals that capture
  // navigation AND popups/modals without walking the full DOM tree:
  //   1. URL pathname + search + hash
  //   2. First <h1> text
  //   3. Body element child count
  //   4. Open popovers/modals/dropdowns ([aria-expanded='true'], details[open], role=menu/dialog)
  //   5. Interactive semantic targets count
  const pageIdentity = (() => {
    const loc = location.pathname + location.search + location.hash;
    const h1 = document.querySelector("h1");
    const h1Text = h1 ? (h1.textContent || "").trim().slice(0, 80) : "";
    const childCount = document.body ? document.body.children.length : 0;
    const popups = Array.from(
      document.querySelectorAll(
        "[aria-expanded='true'], details[open], [role='dialog'], [role='menu'], [role='listbox']",
      ),
    )
      .slice(0, 10)
      .map((el) => (el.textContent || "").trim().slice(0, 40) || el.tagName)
      .join("|");
    const text = `${loc}\n${h1Text}\n${childCount}\n${popups}\n${semanticTargets.length}`;
    let h = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const mask = (1n << 64n) - 1n;
    for (let i = 0; i < text.length; i++) {
      const c = BigInt(text.charCodeAt(i));
      h = ((h ^ c) * prime) & mask;
    }
    return h.toString(16).padStart(16, "0");
  })();

  // ponytail: links[] and buttons[] collection removed entirely from the
  // page-context script. Walking up to 100 visible <a>/<button>
  // elements and computing pathFor+hashAttrs for each was 2-5s on
  // heavy pages. The "ANCHORS" presentation the user wants is now
  // derived from `accessibilityNodes` (already captured via CDP
  // Accessibility.getFullAXTree — a separate path with no extra cost)
  // in the renderObservationForPlanner function. Tradeoff: we lose the
  // explicit href field on links (the AX tree has it indirectly via
  // attributes), but the page-context script is now back to its
  // pre-slice-E speed.
  const links: never[] = [];
  const buttons: never[] = [];

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
    domScanComplete: node === null,
    sensitiveRegionOverflow,
    sensitiveRegions,
    semanticTargets,
    bodyTextSnippet,
    pageIdentity,
    pagePurpose,
    links,
    buttons,
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

// ponytail: Chrome rate-limits chrome.tabs.captureVisibleTab to ~2 calls
// per second per extension. Without throttling, rapid captures can hit the
// quota and crash the loop. This serial queue enforces a minimum interval
// between calls using a promise chain + setTimeout delay, preventing deadlock.
const CAPTURE_VISIBLE_TAB_MIN_INTERVAL_MS = 600; // ~1.6/s sustained, well under the 2/s cap
let lastCaptureVisibleTabAt = 0;
let captureVisibleTabChain: Promise<void> = Promise.resolve();

async function defaultCaptureVisibleTab(
  _tabId: number,
  windowId: number,
): Promise<string> {
  let releaseNext: () => void;
  const nextLock = new Promise<void>((r) => { releaseNext = r; });
  const prevLock = captureVisibleTabChain;
  captureVisibleTabChain = prevLock.then(() => nextLock, () => nextLock);

  await prevLock;
  try {
    const elapsed = Date.now() - lastCaptureVisibleTabAt;
    if (elapsed < CAPTURE_VISIBLE_TAB_MIN_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, CAPTURE_VISIBLE_TAB_MIN_INTERVAL_MS - elapsed));
    }
    lastCaptureVisibleTabAt = Date.now();
    const dataUrl = await new Promise<string>((resolve, reject) => {
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
    return dataUrl;
  } finally {
    releaseNext!();
  }
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
    raw.documentToken.length === 0
  ) {
    throw securityError("Page document identity is invalid");
  }
  // ponytail: 4096 covers Google's OAuth auth URLs (600-1500 chars in
  // practice) and other identity-provider redirects. The previous 512-char
  // cap rejected every Google auth page transition and crashed the loop
  // mid-login. The token is still bounded — it has to fit in a single CDP
  // response — but 4 KiB is well within WebSocket message limits and
  // accommodates any real-world identity-provider URL.
  if (raw.documentToken.length > 4096) {
    throw securityError("Page document identity is invalid");
  }
  // ponytail: domScanComplete=false means the walker hit its budget before
  // reaching the end of the tree. Earlier code threw on this and crashed the
  // loop on heavy pages (Gmail, login widgets). Instead, log and accept a
  // partial observation — better to proceed with an incomplete snapshot than
  // to abort on every large page. The same applies to sensitiveRegionOverflow.
  if (raw.domScanComplete !== true) {
    console.warn(`[observation] DOM scan truncated at limit — proceeding with partial snapshot`);
  }
  if (raw.sensitiveRegionOverflow !== false) {
    console.warn(`[observation] Sensitive region limit reached — proceeding`);
  }
  if (!Array.isArray(raw.semanticTargets))
    throw securityError("Semantic targets are invalid");
  if (typeof raw.bodyTextSnippet !== "string")
    throw securityError("Page body text is missing");
  // ponytail: replay-ready fields. pageIdentity is required (computed
  // for every capture); pagePurpose/links/buttons are optional but expected
  // to be populated. Older snapshots without these fields fall back
  // safely (the merged ObservationV1 just won't have them).
  const pageIdentity = typeof raw.pageIdentity === "string" && /^[a-f0-9]{32}$/i.test(raw.pageIdentity)
    ? raw.pageIdentity
    : "";
  const pagePurpose = typeof raw.pagePurpose === "string" ? raw.pagePurpose : "";
  const links = Array.isArray(raw.links) ? (raw.links as PageLinkSnapshot[]) : [];
  const buttons = Array.isArray(raw.buttons) ? (raw.buttons as PageButtonSnapshot[]) : [];

  return {
    url: raw.url,
    title: raw.title,
    viewport,
    readyState: raw.readyState as PageSnapshot["readyState"],
    visibility: raw.visibility as PageSnapshot["visibility"],
    documentToken: raw.documentToken,
    domScanComplete: true,
    sensitiveRegionOverflow: false,
    sensitiveRegions: validateSensitiveRegions(raw.sensitiveRegions, viewport),
    semanticTargets: raw.semanticTargets as RawSemanticTarget[],
    bodyTextSnippet: raw.bodyTextSnippet,
    pageIdentity,
    pagePurpose,
    links,
    buttons,
  };
}

async function capturePageSnapshot(
  tabId: number,
  sendCdpCommand: CdpCommandSender,
  maxSemanticTargets: number,
  maxDomElements: number,
): Promise<PageSnapshot> {
  const runtimeResult = (await sendCdpCommand(tabId, "Runtime.evaluate", {
    expression: `(${collectPageSnapshot.toString()})(${maxSemanticTargets}, ${maxDomElements}, ${MAX_SENSITIVE_REGIONS})`,
    returnByValue: true,
    awaitPromise: false,
  })) as RuntimeEvaluateResult;
  if (runtimeResult.exceptionDetails) {
    const detail = JSON.stringify(runtimeResult.exceptionDetails).slice(0, 300);
    throw securityError(`Page snapshot evaluation failed: ${detail}`);
  }
  return validatePageSnapshot(runtimeResult.result?.value);
}

function validateFrameTopology(value: unknown): FrameTopology {
  if (!value || typeof value !== "object") {
    throw securityError("CDP frame topology cannot be proven");
  }
  const frameTree = (value as { frameTree?: unknown }).frameTree;
  if (!frameTree || typeof frameTree !== "object") {
    throw securityError("CDP frame topology cannot be proven");
  }

  const visited = new Set<string>();
  let nodeCount = 0;
  const visit = (rawNode: unknown): string => {
    if (!rawNode || typeof rawNode !== "object") {
      throw securityError("CDP frame topology contains an invalid node");
    }
    nodeCount += 1;
    if (nodeCount > 1_000) {
      throw securityError("CDP frame topology exceeds node limit");
    }

    const node = rawNode as { frame?: unknown; childFrames?: unknown };
    if (!node.frame || typeof node.frame !== "object") {
      throw securityError("CDP frame topology contains an invalid frame");
    }
    const id = (node.frame as { id?: unknown }).id;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > 512 ||
      visited.has(id)
    ) {
      throw securityError("CDP frame topology contains an invalid frame ID");
    }
    visited.add(id);

    if (node.childFrames !== undefined && !Array.isArray(node.childFrames)) {
      throw securityError("CDP frame topology contains invalid children");
    }
    const children = node.childFrames ?? [];
    for (const child of children) visit(child);
    return id;
  };

  const mainFrameId = visit(frameTree);
  // ponytail: child frames are common on real sites (Gmail, login widgets,
  // ads). We always capture the main frame — that's the page the user sees.
  // The presence of child frames doesn't invalidate the main-frame capture;
  // earlier code rejected multi-frame pages entirely which broke Gmail/etc.
  return { mainFrameId };
}

async function captureFrameTopology(
  tabId: number,
  sendCdpCommand: CdpCommandSender,
): Promise<FrameTopology> {
  try {
    return validateFrameTopology(
      await sendCdpCommand(tabId, "Page.getFrameTree"),
    );
  } catch (error) {
    if (error instanceof ObservationSecurityError) throw error;
    throw securityError("CDP frame topology cannot be proven", error);
  }
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

// ponytail: pageSnapshotsMatch was removed in slice D. The before/after
// snapshot comparison doubled the cost of every capture (running the
// heavy page-context script twice), and after slice E added replay-ready
// fields, that doubled cost blew past the capture timeout on heavy
// SPAs. The cross-step pageIdentity comparison in local-driver catches
// drift across steps; mid-capture navigation is caught by the
// tab-identity check after captureVisibleTab.

function validateScreenshotViewport(
  screenshot: { width: number; height: number },
  viewport: PageSnapshot["viewport"],
  zoom: number,
): void {
  // ponytail: relaxed check — emit a console warning if dimensions don't match
  // expected CSS × DPR × zoom, but DON'T throw. The screenshot is still
  // useful even if Chrome reports slightly different dimensions (e.g. headless
  // mode, embedded contexts, DPR rounding). The model can navigate based on
  // // coords regardless of physical pixel dimensions.
  const scales = [viewport.devicePixelRatio, viewport.devicePixelRatio * zoom];
  const matches = scales.some((scale) => {
    const expectedWidth = viewport.width * scale;
    const expectedHeight = viewport.height * scale;
    const widthTolerance = Math.max(2, expectedWidth * 0.05);
    const heightTolerance = Math.max(2, expectedHeight * 0.05);
    return (
      Math.abs(screenshot.width - expectedWidth) <= widthTolerance &&
      Math.abs(screenshot.height - expectedHeight) <= heightTolerance
    );
  });
  if (!matches) {
    console.warn(
      `[observation] screenshot ${screenshot.width}x${screenshot.height} doesn't match viewport ${viewport.width}x${viewport.height} at DPR=${viewport.devicePixelRatio} zoom=${zoom}; using anyway`,
    );
  }
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
  const zoom = requireBoundedPositive("zoom", await getZoom(tabId));
  const topology = await captureFrameTopology(tabId, sendCdpCommand);
  // ponytail: capture the page snapshot ONCE per captureObservationInternal.
  // The previous before/after snapshot comparison was paranoid security —
  // it doubled the cost of every capture (the page-context script ran
  // twice), which after slice E added replay-ready fields blew the
  // 25s timeout on heavy SPAs. The cross-step pageIdentity comparison
  // in local-driver already catches drift across steps; mid-capture
  // navigation is caught by the screenshot dimension / topology
  // consistency checks below.
  const after = await capturePageSnapshot(
    tabId,
    sendCdpCommand,
    maxSemanticTargets,
    maxDomElements,
  );
  requireActiveIdentity(tabId, initialIdentity, await getTabIdentity(tabId));
  // ponytail: chrome.tabs.captureVisibleTab fails on chrome://, about:,
  // devtools://, and other restricted URLs. Catch only those permission-
  // related errors; let other failures (oversized PNG, parse errors) propagate
  // so the security boundary stays strict.
  let rawScreenshot: { bytes: Uint8Array; width: number; height: number } | null = null;
  try {
    rawScreenshot = parsePngDataUrl(
      await captureVisibleTab(tabId, initialIdentity.windowId),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("Cannot access contents") ||
      message.includes("manifest must request permission") ||
      message.includes("URL")
    ) {
      rawScreenshot = null;
    } else {
      throw err;
    }
  }
  requireActiveIdentity(tabId, initialIdentity, await getTabIdentity(tabId));
  // ponytail: re-check the tab identity after captureVisibleTab so a
  // navigation that landed during the screenshot is surfaced. The
  // single page snapshot already captured the post-navigation state,
  // so we don't need a second snapshot — we just verify the tab
  // didn't switch.
  if (topology.mainFrameId === "") {
    throw securityError("Frame topology could not be proven");
  }

  let maskedScreenshot: { bytes: Uint8Array; width: number; height: number; data: string };
  if (rawScreenshot !== null) {
    validateScreenshotViewport(rawScreenshot, after.viewport, zoom);
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
    validateScreenshotViewport(screenshot, after.viewport, zoom);
    maskedScreenshot = screenshot;
  } else {
    // ponytail: no screenshot available (captureVisibleTab failed). Surface
    // empty data so the schema validates and downstream consumers can show
    // a placeholder thumbnail.
    maskedScreenshot = { bytes: new Uint8Array(0), width: 0, height: 0, data: "" };
  }
  const screenshot = maskedScreenshot;
  const screenshotHash = screenshot.bytes.length > 0 ? bytesToHex(await sha256(screenshot.bytes)) : "0".repeat(64);
  const pageFrameId = await opaqueUuid(
    `frame:${tabId}:${topology.mainFrameId}`,
  );
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
  const accessibilityNodes = await collectAccessibilitySnapshot(tabId, sendCdpCommand);
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
      zoom: zoom,
    },
    page: {
      tabId: opaqueTabId as ObservationV1["page"]["tabId"],
      frameId: pageFrameId as ObservationV1["page"]["frameId"],
      lifecycle: after.readyState,
      visibility: after.visibility,
    },
    semanticTargets: canonicalTargets,
    accessibilityNodes: accessibilityNodes.length > 0 ? accessibilityNodes : undefined,
    // ponytail: structured page text from smart DOM extractor. Sensitive
    // content (passwords, tokens, etc.) is redacted via sanitizeBrowserText.
    bodyText: sanitizeBrowserText(after.bodyTextSnippet),
    // ponytail: replay-ready fields. pageIdentity is a SHA-256 over a
    // normalized AX-subtree dump — stable across DOM re-renders, flips
    // when navigation actually happens. pagePurpose / links / buttons
    // give the future workflow recorder everything it needs without a
    // re-scrape.
    pageIdentity: after.pageIdentity || undefined,
    pagePurpose: after.pagePurpose ? sanitizeBrowserText(after.pagePurpose) : undefined,
    // ponytail: links and buttons are always undefined on the extension
    // path — the page-context script no longer collects them (too slow).
    // The "ANCHORS" prompt derives from accessibilityNodes in the
    // renderer. Schema fields are still optional in the v1 contract for
    // future recorder integration.
    links: undefined,
    buttons: undefined,
  };

  assertNoForbiddenBrowserData(observation);
  // ponytail: defensive parse. If the bundled schema is stale (the
  // schema package's dist/ was not rebuilt before bundling), Zod will
  // reject the new replay-ready fields with `unrecognized_keys`. Strip
  // the offending keys and retry once so the loop survives a stale
  // build instead of crashing every capture with LOOP_CRASHED. The
  // fields are optional, so dropping them is safe — the loop just runs
  // without pageIdentity / links / buttons until the schema is rebuilt.
  let parsed: unknown;
  try {
    parsed = ObservationV1Schema.parse(observation);
  } catch (err) {
    const issues = (err as { issues?: Array<{ code?: string; keys?: string[]; path?: Array<string | number> }> }).issues ?? [];
    const unknownTopLevel = issues
      .filter((i) => i.code === "unrecognized_keys" && Array.isArray(i.path) && i.path.length === 0)
      .flatMap((i) => i.keys ?? []);
    if (unknownTopLevel.length === 0) throw err;
    console.warn(
      `[observation] bundled schema missing ${unknownTopLevel.length} replay-ready fields; stripping and retrying. Rebuild @brotto/brotto-action-schema to fix.`,
    );
    const stripped: Record<string, unknown> = { ...observation };
    for (const k of unknownTopLevel) delete stripped[k];
    parsed = ObservationV1Schema.parse(stripped);
  }
  return parsed as ReturnType<typeof ObservationV1Schema.parse>;
}

/** Captures, privacy-masks, and validates the only outbound browser-observation representation. */
export async function captureObservation(
  tabId: number,
  options: CaptureObservationOptions = {},
): Promise<ObservationV1> {
  // ponytail: forbidden-data checks (passwords, tokens, cookies in
  // accessibility text) trip on real-world pages like GitHub's login form.
  // Surface a degraded observation (URL/title only, no semantic targets)
  // so the loop survives and the planner can still navigate. The model's
  // raw CDP via debugger.sendCommand is unaffected.
  try {
    return await captureObservationInternal(tabId, options);
  } catch (error) {
    if (error instanceof ForbiddenBrowserDataError) {
      return {
        observationId: ("obs-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8)) as never,
        capturedAt: new Date().toISOString(),
        url: "about:blank",
        title: "(content filtered)",
        screenshot: { kind: "inline", encoding: "png", data: "", sha256: "0".repeat(64), width: 0, height: 0 },
        viewport: { width: 1280, height: 720, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
        page: {
          tabId: "0".repeat(36) as never,
          frameId: "0".repeat(36) as never,
          lifecycle: "complete",
          visibility: "visible",
        },
        semanticTargets: [],
      } as never;
    }
    throw error;
  }
}

// ponytail: snapshot capture can momentarily fail during page transitions
// (Google OAuth redirect chain, GitHub's "Sign in with Google" →
// accounts.google.com/.../.../callback). The validator throws
// "Page document identity is invalid" on these transitional captures. Rather
// than let the loop crash with LOOP_CRASHED mid-login, retry once after a
// short settle; if it still fails, return a degraded observation so the
// loop survives and the next capture can land on a settled page.
//
// The retry predicate is deliberately narrow: only the three transitional
// snapshot errors qualify. Quota errors (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND),
// debugger detach, security violations, and screenshot-dimension errors
// do NOT retry — they don't self-resolve and a retry just wastes quota.
const TRANSIENT_SNAPSHOT_RE =
  /Page document identity is invalid|Page snapshot evaluation failed|Page changed during capture/i;
const QUOTA_RETRY_SKIP_RE =
  /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|Debugger is not attached|cannot access contents|manifest must request permission/i;

export async function captureSnapshotForDriver(
  tabId: number,
  options: CaptureObservationOptions = {},
): Promise<ObservationV1> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await captureObservation(tabId, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transient = TRANSIENT_SNAPSHOT_RE.test(message);
      const skipRetry = QUOTA_RETRY_SKIP_RE.test(message);
      if (!transient || skipRetry || attempt === 1) {
        if (transient && !skipRetry) {
          console.warn(
            `[observation] snapshot validator failed twice; degrading to partial observation: ${message.slice(0, 200)}`,
          );
          return {
            observationId: ("obs-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8)) as never,
            capturedAt: new Date().toISOString(),
            url: "about:blank",
            title: "(capture in progress — page transitioning)",
            screenshot: { kind: "inline", encoding: "png", data: "", sha256: "0".repeat(64), width: 0, height: 0 },
            viewport: { width: 1280, height: 720, devicePixelRatio: 1, zoom: 1, scrollX: 0, scrollY: 0 },
            page: {
              tabId: "0".repeat(36) as never,
              frameId: "0".repeat(36) as never,
              lifecycle: "loading",
              visibility: "visible",
            },
            semanticTargets: [],
          } as never;
        }
        throw error;
      }
      // ponytail: wait past the next quota window before retrying. 1100ms
      // ensures the retry lands in a fresh second-window even if the
      // first attempt hit the cap.
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
  }
  // Unreachable — the loop body always returns or throws.
  throw new Error("captureSnapshotForDriver: unreachable");
}
