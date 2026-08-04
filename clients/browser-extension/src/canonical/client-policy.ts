import type {
  ActionCommandV1,
  ExecutableActionV1,
  ObservationV1,
  SemanticTarget,
} from "@fara-platform/fara-action-schema";

export type ClientPolicyDecision = "allowed" | "requires_approval" | "denied";

export type ClientPolicyCode =
  | "ALLOWED"
  | "TAB_NOT_ATTACHED"
  | "STALE_OBSERVATION"
  | "CURRENT_URL_DENIED"
  | "NAVIGATION_URL_INVALID"
  | "NAVIGATION_SCHEME_DENIED"
  | "NAVIGATION_CREDENTIALS_DENIED"
  | "NAVIGATION_ORIGIN_DENIED"
  | "PRIVATE_NETWORK_DENIED"
  | "HIGH_IMPACT_APPROVAL_REQUIRED"
  | "APPROVAL_PROOF_INVALID";

export interface ClientPolicyResult {
  readonly decision: ClientPolicyDecision;
  readonly code: ClientPolicyCode;
  readonly reason: string;
}

export type ClientPolicyCommand = Pick<
  ActionCommandV1,
  "action" | "observationId" | "policyContext"
>;

export interface ClientPolicyObservation extends Pick<ObservationV1, "observationId" | "url"> {
  readonly semanticTargets: readonly SemanticTarget[];
}

export interface ClientPolicyContext {
  readonly tabId: number;
  readonly attachedTabIds: ReadonlySet<number>;
  /** Approval IDs resolved and retained locally for the active session. */
  readonly approvedApprovalIds: ReadonlySet<string>;
  readonly observation: ClientPolicyObservation;
}

export interface ClientPolicyOptions {
  /** Empty means any public HTTP(S) origin is permitted. */
  readonly allowedOrigins?: readonly string[];
  /** Exact origins explicitly authorized for private-network navigation. */
  readonly privateNetworkOrigins?: readonly string[];
}

const HIGH_IMPACT_WORDS = /\b(?:buy|purchase|checkout|pay(?:ment)?|place order|book|reserve|send|publish|post|submit|confirm|accept|agree|delete|remove|upload|download|sign[ -]?in|log[ -]?in|password|passcode|otp|verification code|credential|account|billing|credit card)\b/i;

export class ClientPolicy {
  private readonly allowedOrigins: ReadonlySet<string> | undefined;
  private readonly privateNetworkOrigins: ReadonlySet<string>;

  constructor(options: ClientPolicyOptions = {}) {
    this.allowedOrigins = options.allowedOrigins === undefined
      ? undefined
      : new Set(options.allowedOrigins.map(normalizeOrigin));
    this.privateNetworkOrigins = new Set(
      (options.privateNetworkOrigins ?? []).map(normalizeOrigin),
    );
  }

  evaluate(command: ClientPolicyCommand, context: ClientPolicyContext): ClientPolicyResult {
    if (!context.attachedTabIds.has(context.tabId)) {
      return denied("TAB_NOT_ATTACHED", "The target tab is not explicitly attached");
    }
    if (command.observationId !== context.observation.observationId) {
      return denied("STALE_OBSERVATION", "The command does not reference the current observation");
    }
    if (!safeHttpUrl(context.observation.url)) {
      return denied("CURRENT_URL_DENIED", "The attached page is not an allowed HTTP(S) URL");
    }
    const currentPageDecision = this.evaluateNavigation(context.observation.url);
    if (currentPageDecision !== undefined) return currentPageDecision;

    if (command.action.type === "visit_url") {
      const navigationDecision = this.evaluateNavigation(command.action.url);
      if (navigationDecision !== undefined) return navigationDecision;
    }

    if (isHighImpact(command.action, context.observation.semanticTargets)) {
      if (!hasValidApprovalProof(command, context.approvedApprovalIds)) {
        if (command.policyContext.approved || command.policyContext.approvalId !== undefined) {
          return denied("APPROVAL_PROOF_INVALID", "High-impact action approval proof is incomplete");
        }
        return {
          decision: "requires_approval",
          code: "HIGH_IMPACT_APPROVAL_REQUIRED",
          reason: "This action may have an external consequence and requires explicit approval",
        };
      }
    }

    return { decision: "allowed", code: "ALLOWED", reason: "Client policy permits the action" };
  }

  private evaluateNavigation(rawUrl: string): ClientPolicyResult | undefined {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return denied("NAVIGATION_URL_INVALID", "The navigation URL is malformed");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return denied("NAVIGATION_SCHEME_DENIED", `Navigation scheme ${url.protocol} is not permitted`);
    }
    if (url.username !== "" || url.password !== "") {
      return denied("NAVIGATION_CREDENTIALS_DENIED", "Navigation URLs must not contain embedded credentials");
    }

    const origin = normalizeOrigin(url.origin);
    if (isPrivateHostname(url.hostname) && !this.privateNetworkOrigins.has(origin)) {
      return denied("PRIVATE_NETWORK_DENIED", "Private, loopback, link-local, and metadata destinations require explicit local policy");
    }
    if (this.allowedOrigins !== undefined && !this.allowedOrigins.has(origin)) {
      return denied("NAVIGATION_ORIGIN_DENIED", "The navigation origin is outside the configured allowlist");
    }
    return undefined;
  }
}

function denied(code: Exclude<ClientPolicyCode, "ALLOWED" | "HIGH_IMPACT_APPROVAL_REQUIRED">, reason: string): ClientPolicyResult {
  return { decision: "denied", code, reason };
}

function normalizeOrigin(raw: string): string {
  try {
    return new URL(raw).origin.toLowerCase();
  } catch {
    return raw.toLowerCase().replace(/\/$/, "");
  }
}

function safeHttpUrl(raw: string): boolean {
  try {
    const protocol = new URL(raw).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function hasValidApprovalProof(command: ClientPolicyCommand, approvedApprovalIds: ReadonlySet<string>): boolean {
  return command.policyContext.approved === true &&
    typeof command.policyContext.approvalId === "string" &&
    command.policyContext.approvalId.length > 0 &&
    approvedApprovalIds.has(command.policyContext.approvalId) &&
    typeof command.policyContext.policyDecisionId === "string" &&
    command.policyContext.policyDecisionId.length > 0;
}

function isHighImpact(action: ExecutableActionV1, targets: readonly SemanticTarget[]): boolean {
  if (action.type === "key" && action.key.toLowerCase() === "enter") return true;

  return actionTargets(action, targets).some((target) => {
    if (action.type === "insert_text" && target.control.kind === "input") {
      if (["email", "tel"].includes(target.control.inputType)) return true;
    }

    const attributes = target.attributes ?? {};
    const description = [
      target.accessibleName?.text,
      attributes["aria-label"],
      attributes.name,
      attributes.type,
      target.role,
      target.tag,
    ].filter((value): value is string => typeof value === "string").join(" ");

    return attributes.type?.toLowerCase() === "submit" || HIGH_IMPACT_WORDS.test(description);
  });
}

function actionTargets(action: ExecutableActionV1, targets: readonly SemanticTarget[]): SemanticTarget[] {
  const matches = new Map<string, SemanticTarget>();
  if ("targetId" in action && action.targetId !== undefined) {
    const declared = targets.find((candidate) => candidate.visible && candidate.targetId === action.targetId);
    if (declared !== undefined) matches.set(declared.targetId, declared);
  }
  if ("x" in action && "y" in action) {
    for (const candidate of targets) {
      if (!candidate.visible) continue;
      const box = candidate.boundingBox;
      if (action.x >= box.x && action.x <= box.x + box.width &&
          action.y >= box.y && action.y <= box.y + box.height) {
        matches.set(candidate.targetId, candidate);
      }
    }
  }
  return [...matches.values()];
}

function isPrivateHostname(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (
    hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  ) return true;

  if (hostname.includes(":")) {
    return hostname === "::" || hostname === "::1" ||
      hostname.startsWith("fc") || hostname.startsWith("fd") ||
      /^fe[89ab]/.test(hostname) || hostname.startsWith("2001:db8:");
  }

  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = octets as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}
