import {
  ActionCommandV1Schema,
  type ActionCommandV1,
  type SemanticTarget,
} from "@fara-platform/fara-action-schema";
import {
  type ActionExecutionResult,
  type CdpSender,
} from "./action-executor";
import { transformCapturedPoint, type CapturedCoordinateContext } from "./coordinate-context";
import {
  ClientPolicy,
  type ClientPolicyObservation,
} from "./client-policy";
import type { PageSettlementResult, PageSettler } from "./page-settler";

export interface DnsResolver {
  resolve(hostname: string, signal?: AbortSignal): Promise<readonly string[]>;
}

export interface TrustedExecutionContext {
  readonly observation: ClientPolicyObservation;
  readonly capture: CapturedCoordinateContext;
  readonly mainFrameId: string;
}

export interface ObservationAuthority {
  verify(tabId: number, observationId: string, signal?: AbortSignal): Promise<TrustedExecutionContext>;
}

export interface TrustedHostnamePolicy {
  isTrusted(hostname: string): boolean;
}

export interface ApprovalGrant {
  readonly approvalId: string;
  readonly actionId: string;
  readonly policyDecisionId: string;
  readonly observationId: string;
  readonly actionDigest: string;
  readonly idempotencyKey: string;
  readonly expiresAt: string;
  readonly commandExpiresAt: string;
}

export class InMemoryApprovalStore {
  private readonly grants = new Map<string, ApprovalGrant>();

  register(grant: ApprovalGrant): void {
    this.grants.set(grant.approvalId, { ...grant });
  }

  consume(command: ActionCommandV1, actionDigest: string, now: number): boolean {
    return this.consumeGrant(command, actionDigest, now) !== undefined;
  }

  consumeGrant(command: ActionCommandV1, actionDigest: string, now: number): ApprovalGrant | undefined {
    const approvalId = command.policyContext.approvalId;
    if (!command.policyContext.approved || approvalId === undefined) return undefined;
    const grant = this.grants.get(approvalId);
    if (grant === undefined) return undefined;
    const matches = grant.actionId === command.actionId &&
      grant.policyDecisionId === command.policyContext.policyDecisionId &&
      grant.observationId === command.observationId &&
      grant.actionDigest === actionDigest &&
      grant.idempotencyKey === command.idempotencyKey &&
      grant.commandExpiresAt === command.expiresAt &&
      Date.parse(grant.expiresAt) >= now && Date.parse(command.expiresAt) >= now;
    if (!matches) return undefined;
    this.grants.delete(approvalId);
    return grant;
  }
}

export type PipelineResult =
  | { readonly status: "succeeded"; readonly code: "ACTION_SUCCEEDED"; readonly execution: ActionExecutionResult; readonly settlement: PageSettlementResult }
  | { readonly status: "denied"; readonly code: string }
  | { readonly status: "approval_required"; readonly code: string }
  | { readonly status: "failed"; readonly code: string }
  | { readonly status: "cancelled"; readonly code: "ACTION_CANCELLED" };

export interface CanonicalExecutionPipelineOptions {
  readonly tabId: number;
  readonly observationAuthority: ObservationAuthority;
  readonly resolver: DnsResolver;
  readonly resolverTimeoutMs?: number;
  readonly trustedHostnamePolicy?: TrustedHostnamePolicy;
  readonly approvals: InMemoryApprovalStore;
  readonly createSettler: (mainFrameId: string, initialPageState: { url: string; lifecycle: "loading" | "interactive" | "complete" | "frozen" }) => PageSettler;
  readonly send?: CdpSender;
  readonly wait?: (durationMs: number) => Promise<void>;
  readonly now?: () => number;
  readonly allowedOrigins?: readonly string[];
  readonly privateNetworkOrigins?: readonly string[];
}

type ExecutePhysicalAction = (command: ActionCommandV1, context: TrustedExecutionContext, signal?: AbortSignal) => Promise<ActionExecutionResult>;

class CanonicalExecutionPipeline {
  private readonly options: CanonicalExecutionPipelineOptions;
  private readonly executePhysicalAction: ExecutePhysicalAction;
  private readonly policy: ClientPolicy;
  private readonly completed = new Map<string, PipelineResult>();
  private readonly inFlight = new Map<string, Promise<PipelineResult>>();
  private readonly idempotencySignatures = new Map<string, string>();

  constructor(options: CanonicalExecutionPipelineOptions, executePhysicalAction: ExecutePhysicalAction) {
    this.options = options;
    this.executePhysicalAction = executePhysicalAction;
    this.policy = new ClientPolicy({
      allowedOrigins: options.allowedOrigins,
      privateNetworkOrigins: options.privateNetworkOrigins,
    });
  }

  execute(input: unknown, signal?: AbortSignal): Promise<PipelineResult> {
    const parsed = ActionCommandV1Schema.safeParse(input);
    if (!parsed.success) return Promise.resolve({ status: "denied", code: "COMMAND_SCHEMA_INVALID" });
    const command = parsed.data as ActionCommandV1;
    const signature = canonicalJson(command);
    const previousSignature = this.idempotencySignatures.get(command.idempotencyKey);
    if (previousSignature !== undefined && previousSignature !== signature) {
      return Promise.resolve({ status: "denied", code: "IDEMPOTENCY_CONFLICT" });
    }
    this.idempotencySignatures.set(command.idempotencyKey, signature);
    const cached = this.completed.get(command.idempotencyKey);
    if (cached !== undefined) return Promise.resolve(cached);
    const active = this.inFlight.get(command.idempotencyKey);
    if (active !== undefined) return active;
    const execution = this.executeOnce(command, signal)
      .then((result) => {
        this.completed.set(command.idempotencyKey, result);
        return result;
      })
      .finally(() => this.inFlight.delete(command.idempotencyKey));
    this.inFlight.set(command.idempotencyKey, execution);
    return execution;
  }

  private async executeOnce(command: ActionCommandV1, signal?: AbortSignal): Promise<PipelineResult> {
    if (signal?.aborted) return { status: "cancelled", code: "ACTION_CANCELLED" };
    const now = (this.options.now ?? Date.now)();
    if (Date.parse(command.expiresAt) <= now) return { status: "denied", code: "COMMAND_EXPIRED" };

    let trusted: TrustedExecutionContext;
    try {
      trusted = await this.options.observationAuthority.verify(this.options.tabId, command.observationId, signal);
    } catch {
      return signal?.aborted
        ? { status: "cancelled", code: "ACTION_CANCELLED" }
        : { status: "denied", code: "OBSERVATION_AUTHORITY_DENIED" };
    }

    const targetCheck = verifyTargetFidelity(command, trusted.observation.semanticTargets, trusted.capture);
    if (targetCheck !== undefined) return { status: "denied", code: targetCheck };

    if (command.action.type === "visit_url") {
      const hostname = stripBrackets(new URL(command.action.url).hostname);
      if (!isIpLiteral(hostname) && this.options.trustedHostnamePolicy?.isTrusted(hostname) !== true) {
        return { status: "denied", code: "HOSTNAME_NOT_TRUSTED" };
      }
    }
    const destinations = navigationDestinations(command, trusted.observation.url);
    const pins = new Map<string, readonly string[]>();
    for (const destination of destinations) {
      const resolution = await resolvePublic(destination, this.options.resolver, signal, this.options.resolverTimeoutMs ?? 1_000);
      if (resolution.code === "ACTION_CANCELLED") return { status: "cancelled", code: "ACTION_CANCELLED" };
      if (resolution.code !== undefined) return { status: "denied", code: resolution.code };
      pins.set(destination.hostname, resolution.addresses);
    }
    if (signal?.aborted) return { status: "cancelled", code: "ACTION_CANCELLED" };

    const digest = await actionAuthorizationDigest(command as never);
    const approvalGrant = this.options.approvals.consumeGrant(command, digest, now);
    const approvalValid = approvalGrant !== undefined;
    const policy = this.policy.evaluate(command as never, {
      tabId: this.options.tabId,
      attachedTabIds: new Set([this.options.tabId]),
      approvedApprovalIds: approvalValid && command.policyContext.approvalId
        ? new Set([command.policyContext.approvalId])
        : new Set(),
      observation: trusted.observation,
      capture: trusted.capture,
    });
    if (policy.decision === "requires_approval") return { status: "approval_required", code: policy.code };
    if (policy.decision === "denied") return { status: "denied", code: policy.code };

    if (command.action.type === "visit_url") {
      const destination = new URL(command.action.url);
      const second = await resolvePublic(destination, this.options.resolver, signal, this.options.resolverTimeoutMs ?? 1_000);
      if (second.code === "ACTION_CANCELLED") return { status: "cancelled", code: "ACTION_CANCELLED" };
      const first = pins.get(destination.hostname) ?? [];
      if (second.code !== undefined || !sameAddresses(first, second.addresses)) {
        return { status: "denied", code: "DNS_REBINDING_DETECTED" };
      }
    }
    if (signal?.aborted) return { status: "cancelled", code: "ACTION_CANCELLED" };
    if (Date.parse(command.expiresAt) <= (this.options.now ?? Date.now)()) return { status: "denied", code: "COMMAND_EXPIRED" };

    let execution: ActionExecutionResult | undefined;
    let preExecutionDenial: "COMMAND_EXPIRED" | "APPROVAL_PROOF_INVALID" | undefined;
    const settlement = await this.options.createSettler(trusted.mainFrameId, {
      url: trusted.observation.url,
      lifecycle: "interactive",
    }).settle(async () => {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const executionNow = (this.options.now ?? Date.now)();
      if (Date.parse(command.expiresAt) <= executionNow) {
        preExecutionDenial = "COMMAND_EXPIRED";
        return;
      }
      if (approvalGrant !== undefined && Date.parse(approvalGrant.expiresAt) <= executionNow) {
        preExecutionDenial = "APPROVAL_PROOF_INVALID";
        return;
      }
      execution = await this.executePhysicalAction(command, trusted, signal);
      if (!execution.ok) throw new Error("Controlled action failed");
    }, signal);
    if (signal?.aborted || settlement.status === "cancelled") return { status: "cancelled", code: "ACTION_CANCELLED" };
    if (preExecutionDenial !== undefined) return { status: "denied", code: preExecutionDenial };
    if (execution === undefined || !execution.ok) return { status: "failed", code: execution?.error.code ?? "ACTION_EXECUTION_FAILED" };
    if (settlement.status !== "settled") return { status: "failed", code: "SETTLEMENT_FAILED" };
    return { status: "succeeded", code: "ACTION_SUCCEEDED", execution, settlement };
  }
}

/** @internal Called only by the public factory that owns the physical executor. */
export function buildCanonicalExecutionPipeline(
  options: CanonicalExecutionPipelineOptions,
  executePhysicalAction: ExecutePhysicalAction,
): { execute(input: unknown, signal?: AbortSignal): Promise<PipelineResult> } {
  return new CanonicalExecutionPipeline(options, executePhysicalAction);
}

export async function actionAuthorizationDigest(command: Pick<ActionCommandV1, "action" | "actionId" | "observationId" | "idempotencyKey">): Promise<string> {
  const serialized = canonicalJson({
    actionId: command.actionId,
    observationId: command.observationId,
    idempotencyKey: command.idempotencyKey,
    action: command.action,
  });
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(",")}}`;
}

function verifyTargetFidelity(command: ActionCommandV1, targets: readonly SemanticTarget[], capture: CapturedCoordinateContext): string | undefined {
  const action = command.action;
  if (!("targetId" in action) || action.targetId === undefined || !("x" in action) || !("y" in action)) return undefined;
  const target = targets.find((candidate) => candidate.visible && candidate.targetId === action.targetId);
  if (target === undefined) return "TARGET_NOT_FOUND";
  const point = transformCapturedPoint(action.x, action.y, capture);
  if ("error" in point) return point.error.code;
  const box = target.boundingBox;
  return point.x < box.x || point.x > box.x + box.width || point.y < box.y || point.y > box.y + box.height
    ? "TARGET_COORDINATE_MISMATCH"
    : undefined;
}

function navigationDestinations(command: ActionCommandV1, currentUrl: string): URL[] {
  const values = [new URL(currentUrl)];
  if (command.action.type === "visit_url") values.push(new URL(command.action.url));
  return values;
}

async function resolvePublic(url: URL, resolver: DnsResolver, signal: AbortSignal | undefined, timeoutMs: number): Promise<{ addresses: readonly string[]; code?: string }> {
  if (signal?.aborted) return { addresses: [], code: "ACTION_CANCELLED" };
  let addresses: readonly string[];
  try {
    addresses = isIpLiteral(url.hostname)
      ? [stripBrackets(url.hostname)]
      : await resolveWithDeadline(resolver, url.hostname, signal, timeoutMs);
  } catch {
    return { addresses: [], code: signal?.aborted ? "ACTION_CANCELLED" : "DNS_RESOLUTION_FAILED" };
  }
  const normalized = [...new Set(addresses.map(stripBrackets))].sort();
  if (normalized.length === 0) return { addresses: [], code: "DNS_RESOLUTION_FAILED" };
  if (normalized.some((address) => !isPublicAddress(address))) return { addresses: normalized, code: "PRIVATE_NETWORK_DENIED" };
  return { addresses: normalized };
}

async function resolveWithDeadline(resolver: DnsResolver, hostname: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<readonly string[]> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  let rejectAbort: ((reason?: unknown) => void) | undefined;
  const onAbortRace = () => rejectAbort?.(new DOMException("Aborted", "AbortError"));
  signal?.addEventListener("abort", onAbort, { once: true });
  signal?.addEventListener("abort", onAbortRace, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolver.resolve(hostname, controller.signal),
      new Promise<readonly string[]>((_, reject) => {
        rejectAbort = reject;
        if (signal?.aborted) onAbortRace();
      }),
      new Promise<readonly string[]>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("deadline")); }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    signal?.removeEventListener("abort", onAbortRace);
  }
}

function sameAddresses(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stripBrackets(value: string): string { return value.toLowerCase().replace(/^\[/, "").replace(/\]$/, ""); }
function isIpLiteral(value: string): boolean { return /^\[?[0-9a-f:.]+\]?$/i.test(value); }

function isPublicAddress(raw: string): boolean {
  const address = stripBrackets(raw);
  if (address.includes(":")) {
    if (address.startsWith("::ffff:")) return isPublicAddress(address.slice(7));
    const first = Number.parseInt(address.split(":")[0] || "0", 16);
    return first >= 0x2000 && first <= 0x3fff &&
      !address.startsWith("2001:db8:") && !address.startsWith("2001:0:") &&
      !address.startsWith("2001:2:") && !address.startsWith("2001:10:");
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts as [number, number, number, number];
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) ||
    (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113));
}
