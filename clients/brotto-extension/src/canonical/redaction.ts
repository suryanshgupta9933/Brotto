import type {
  LocatorCandidateV1,
  SanitizedAccessibleName,
  SemanticTarget,
} from "@brotto/brotto-action-schema";

const MAX_SEMANTIC_TEXT_LENGTH = 512;
const MAX_TAG_LENGTH = 64;
const MAX_ROLE_LENGTH = 128;
const MAX_LOCATOR_CANDIDATES = 10;
const MAX_OBSERVATION_URL_LENGTH = 2048;
const STABLE_REF_HEX_LENGTH = 16;

const SENSITIVE_BROWSER_WORDS =
  /\b(?:api[\s_-]*keys?|auth(?:entication|orization)?|bearer|cookies?|credentials?|local[\s_-]*storage|password|passcode|profile|proxy[\s_-]*authorization|secret|session[\s_-]*storage|tokens?)\b/i;
const STRONG_CREDENTIAL_VALUE =
  /(?:\beyj[a-z0-9_-]{10,}\.[a-z0-9_-]+(?:\.[a-z0-9_-]+)?|\bsk[\s_-]*live[\s_-]*[a-z0-9_-]{8,}|\bbearer\s+[a-z0-9._~+/-]{3,})/i;
const NORMALIZED_CREDENTIAL_SIGNAL =
  /(?:accesstoken|apikey|authorization|authtoken|bearer|clientsecret|credential|idtoken|password|passcode|refreshtoken|secretkey|sessiontoken|sklive)/;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "tel",
  "url",
  "number",
  "date",
  "checkbox",
  "radio",
]);

const ACTIONABLE_TAGS = new Set(["a", "button", "input", "select", "textarea"]);
const ACTIONABLE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
]);

const ACCESSIBLE_NAME_SOURCES = new Set([
  "aria-label",
  "aria-labelledby",
  "visible_text",
]);

const ENUMERATED_ARIA_ATTRIBUTES = {
  "aria-expanded": new Set(["true", "false"]),
  "aria-haspopup": new Set([
    "true",
    "false",
    "menu",
    "listbox",
    "tree",
    "grid",
    "dialog",
  ]),
  "aria-current": new Set([
    "true",
    "false",
    "page",
    "step",
    "location",
    "date",
    "time",
  ]),
  "aria-pressed": new Set(["true", "false", "mixed"]),
  "aria-selected": new Set(["true", "false"]),
} as const;

const TEXT_ARIA_ATTRIBUTES = new Set([
  "aria-label",
  "aria-describedby",
  "aria-controls",
]);

const SAFE_QUERY_KEYS = new Set([
  "category",
  "filter",
  "lang",
  "locale",
  "order",
  "page",
  "q",
  "query",
  "search",
  "sort",
]);

export interface RawAccessibleName {
  source?: unknown;
  text?: unknown;
}

export interface RawBoundingBox {
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
}

export interface RawSemanticTarget {
  targetId?: unknown;
  tag?: unknown;
  role?: unknown;
  accessibleName?: RawAccessibleName | string | null;
  label?: unknown;
  attributes?: Record<string, unknown> | null;
  boundingBox?: RawBoundingBox | null;
  visible?: unknown;
  framePath?: unknown;
  shadowPath?: unknown;
  locatorCandidates?: unknown;
}

function normalizedText(
  value: unknown,
  maxLength = MAX_SEMANTIC_TEXT_LENGTH,
): string | undefined {
  if (typeof value !== "string") return undefined;

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || containsSensitiveBrowserData(normalized)) return undefined;

  return normalized.slice(0, maxLength);
}

interface StableRefInput {
  tag: string;
  role?: string;
  accessibleName?: string;
  attributes: Record<string, string | undefined>;
}

export function computeStableRef(input: StableRefInput): string | undefined {
  const parts = [
    input.tag,
    input.role ?? "",
    input.accessibleName ?? "",
    input.attributes["data-testid"] ?? "",
    input.attributes.name ?? "",
    input.attributes["aria-label"] ?? "",
    input.attributes.type ?? "",
  ].map((part) => part.toLowerCase());
  const seed = parts.join("\x1f");
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return (hex + hex).slice(0, STABLE_REF_HEX_LENGTH);
}

function sanitizeAccessibleName(
  value: RawSemanticTarget["accessibleName"],
): SanitizedAccessibleName | undefined {
  if (typeof value === "string") {
    const text = normalizedText(value);
    return text ? { source: "visible_text", text } : undefined;
  }

  if (!value || typeof value !== "object") return undefined;
  if (
    typeof value.source !== "string" ||
    !ACCESSIBLE_NAME_SOURCES.has(value.source)
  )
    return undefined;

  const text = normalizedText(value.text);
  if (!text) return undefined;

  return {
    source: value.source as SanitizedAccessibleName["source"],
    text,
  };
}

function sanitizeBoundingBox(
  value: RawSemanticTarget["boundingBox"],
): SemanticTarget["boundingBox"] | undefined {
  if (!value) return undefined;

  const { x, y, width, height } = value;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }

  return { x, y, width, height };
}

function sanitizeOpaquePath(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length > 20) return undefined;
  if (
    !value.every(
      (segment): segment is string =>
        typeof segment === "string" && UUID.test(segment),
    )
  ) {
    return undefined;
  }
  return value;
}

function sanitizeAttributes(
  attributes: Record<string, unknown>,
): SemanticTarget["attributes"] | undefined {
  const safe: Record<string, string> = {};

  for (const key of TEXT_ARIA_ATTRIBUTES) {
    const value = normalizedText(attributes[key]);
    if (value) safe[key] = value;
  }

  for (const [key, allowedValues] of Object.entries(
    ENUMERATED_ARIA_ATTRIBUTES,
  )) {
    const value = attributes[key];
    if (
      typeof value === "string" &&
      (allowedValues as ReadonlySet<string>).has(value)
    ) {
      safe[key] = value;
    }
  }

  return Object.keys(safe).length > 0
    ? (safe as NonNullable<SemanticTarget["attributes"]>)
    : undefined;
}

function sanitizeLocatorCandidate(
  value: unknown,
): LocatorCandidateV1 | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;

  if (candidate.kind === "test_id") {
    const testId = normalizedText(candidate.testId);
    return testId ? { kind: "test_id", testId } : undefined;
  }

  if (candidate.kind === "label") {
    const label = sanitizeAccessibleName(candidate.label as RawAccessibleName);
    return label ? { kind: "label", label } : undefined;
  }

  if (candidate.kind === "role_name") {
    const role = normalizedText(candidate.role, MAX_ROLE_LENGTH);
    const name = sanitizeAccessibleName(candidate.name as RawAccessibleName);
    return role && name ? { kind: "role_name", role, name } : undefined;
  }

  if (candidate.kind === "safe_attribute") {
    const attribute = candidate.attribute;
    const valueText = normalizedText(candidate.value);
    const allowed = new Set([
      "aria-label",
      "aria-describedby",
      "aria-controls",
      "aria-current",
    ]);
    if (typeof attribute === "string" && allowed.has(attribute) && valueText) {
      return {
        kind: "safe_attribute",
        attribute: attribute as
          "aria-label" | "aria-describedby" | "aria-controls" | "aria-current",
        value: valueText,
      };
    }
  }

  return undefined;
}

function addLocator(
  candidates: LocatorCandidateV1[],
  candidate: LocatorCandidateV1 | undefined,
): void {
  if (!candidate || candidates.length >= MAX_LOCATOR_CANDIDATES) return;
  const encoded = JSON.stringify(candidate);
  if (!candidates.some((existing) => JSON.stringify(existing) === encoded)) {
    candidates.push(candidate);
  }
}

/**
 * Converts a page-local candidate into the strict canonical allowlist.
 * Returning null prevents hidden, password, malformed, or unsupported targets
 * from reaching an outbound observation.
 */
export function sanitizeSemanticTarget(
  raw: RawSemanticTarget,
): SemanticTarget | null {
  if (raw.visible !== true) return null;

  const targetId =
    typeof raw.targetId === "string" && UUID.test(raw.targetId)
      ? raw.targetId
      : undefined;
  const tag = normalizedText(raw.tag, MAX_TAG_LENGTH)?.toLowerCase();
  const boundingBox = sanitizeBoundingBox(raw.boundingBox);
  const framePath = sanitizeOpaquePath(raw.framePath);
  if (!targetId || !tag || !boundingBox || !framePath) return null;

  const attributes =
    raw.attributes && typeof raw.attributes === "object" ? raw.attributes : {};
  const rawInputType =
    typeof attributes.type === "string"
      ? attributes.type.toLowerCase()
      : undefined;
  if (
    tag === "input" &&
    (rawInputType === "password" || rawInputType === "hidden")
  )
    return null;
  if (tag === "input" && rawInputType && !INPUT_TYPES.has(rawInputType))
    return null;

  const role = normalizedText(raw.role, MAX_ROLE_LENGTH)?.toLowerCase();
  if (!ACTIONABLE_TAGS.has(tag) && (!role || !ACTIONABLE_ROLES.has(role)))
    return null;
  const explicitName = sanitizeAccessibleName(raw.accessibleName);
  const labelText = normalizedText(raw.label);
  const fallbackName = labelText ?? normalizedText(attributes.name);
  const accessibleName =
    explicitName ??
    (fallbackName
      ? { source: "visible_text" as const, text: fallbackName }
      : undefined);
  const safeAttributes = sanitizeAttributes(attributes);
  const locatorCandidates: LocatorCandidateV1[] = [];

  if (role && accessibleName) {
    addLocator(locatorCandidates, {
      kind: "role_name",
      role,
      name: accessibleName,
    });
  }
  if (labelText) {
    addLocator(locatorCandidates, {
      kind: "label",
      label: { source: "visible_text", text: labelText },
    });
  }

  const testId = normalizedText(attributes["data-testid"]);
  if (testId) addLocator(locatorCandidates, { kind: "test_id", testId });

  for (const attribute of [
    "aria-label",
    "aria-describedby",
    "aria-controls",
    "aria-current",
  ] as const) {
    const value = safeAttributes?.[attribute];
    if (value)
      addLocator(locatorCandidates, {
        kind: "safe_attribute",
        attribute,
        value,
      });
  }

  if (Array.isArray(raw.locatorCandidates)) {
    for (const candidate of raw.locatorCandidates) {
      addLocator(locatorCandidates, sanitizeLocatorCandidate(candidate));
    }
  }

  const shadowPath = sanitizeOpaquePath(raw.shadowPath);
  if (raw.shadowPath !== undefined && !shadowPath) return null;
  const control: SemanticTarget["control"] =
    tag === "input"
      ? {
          kind: "input",
          inputType: (rawInputType ?? "text") as Extract<
            SemanticTarget["control"],
            { kind: "input" }
          >["inputType"],
        }
      : { kind: "non_input" };

  const stableRef = computeStableRef({
    tag,
    role,
    accessibleName: accessibleName?.text,
    attributes: {
      "data-testid": testId,
      name: normalizedText(attributes.name),
      "aria-label": safeAttributes?.["aria-label"],
      type: rawInputType,
    },
  });

  return {
    targetId: targetId as SemanticTarget["targetId"],
    ...(stableRef ? { stableRef } : {}),
    tag,
    ...(role ? { role } : {}),
    ...(accessibleName ? { accessibleName } : {}),
    ...(safeAttributes ? { attributes: safeAttributes } : {}),
    control,
    boundingBox,
    visible: true,
    framePath: framePath as SemanticTarget["framePath"],
    ...(shadowPath
      ? { shadowPath: shadowPath as NonNullable<SemanticTarget["shadowPath"]> }
      : {}),
    locatorCandidates,
  };
}

export function sanitizeBrowserText(
  value: unknown,
  maxLength = MAX_SEMANTIC_TEXT_LENGTH,
): string {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return containsSensitiveBrowserData(normalized)
    ? "[redacted]"
    : normalized.slice(0, maxLength);
}

export function containsSensitiveBrowserData(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.normalize("NFKC").toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  return (
    SENSITIVE_BROWSER_WORDS.test(normalized) ||
    STRONG_CREDENTIAL_VALUE.test(normalized) ||
    NORMALIZED_CREDENTIAL_SIGNAL.test(compact)
  );
}

export function sanitizeObservationUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Observation URL is missing");

  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Observation URL must use HTTP(S)");
  }

  url.username = "";
  url.password = "";
  url.hash = "";

  for (const [key, entryValue] of [...url.searchParams.entries()]) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      !SAFE_QUERY_KEYS.has(normalizedKey) ||
      containsSensitiveBrowserData(key) ||
      containsSensitiveBrowserData(entryValue)
    ) {
      url.searchParams.delete(key);
    }
  }

  if (containsSensitiveBrowserData(decodeURIComponent(url.pathname))) {
    url.pathname = "/";
  }

  const sanitized = url.toString();
  if (sanitized.length > MAX_OBSERVATION_URL_LENGTH) {
    throw new Error("Observation URL exceeds maximum length");
  }
  return sanitized;
}
