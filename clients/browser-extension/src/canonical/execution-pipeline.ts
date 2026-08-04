import {
  ActionCommandV1Schema,
  type ActionCommandV1,
  type SemanticTarget,
} from "@fara-platform/fara-action-schema";
import {
  CanonicalActionExecutor,
  transformCapturedPoint,
  type ActionExecutionResult,
  type CanonicalActionExecutorOptions,
  type CapturedCoordinateContext,
  type CdpSender,
} from "./action-executor";
import {
  ClientPolicy,
  type ClientPolicyObservation,
} from "./client-policy";
import type { PageSettlementResult, PageSettler } from "./page-settler";

export interface DnsResolver {
  resolve(hostname: string, signal?: AbortSignal): Promise<readonly string[]>;
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
    const approvalId = command.policyContext.approvalId;
    if (!command.policyContext.approved || approvalId === undefined) return false;
    const grant = this.grants.get(approvalId);
    if (grant === undefined) return false;
    const matches = grant.actionId === command.actionId &&
      grant.policyDecisionId === command.policyContext.policyDecisionId &&
      grant.observationId === command.observationId &&
      grant.actionDigest === actionDigest &&
      grant.idempotencyKey === command.idempotencyKey &&
      grant.commandExpiresAt === command.expiresAt &&
      Date.parse(grant.expiresAt) >= now && Date.parse(command.expiresAt) >= now;
    if (!matches) return false;
    this.grants.delete(approvalId);
    return true;
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
  readonly attachedTabIds: ReadonlySet<number>;
  readonly observation: ClientPolicyObservation;
  readonly capture: CapturedCoordinateContext;
  readonly resolver: DnsResolver;
  readonly approvals: InMemoryApprovalStore;
  readonly settler: PageSettler;
  readonly send?: CdpSender;
  readonly wait?: CanonicalActionExecutorOptions["wait"];
  readonly now?: () => number;
  readonly allowedOrigins?: readonly string[];
  readonly privateNetworkOrigins?: readonly string[];
}

export class CanonicalExecutionPipeline {
  private readonly options: CanonicalExecutionPipelineOptions;
  private readonly executor: CanonicalActionExecutor;
  private readonly policy: ClientPolicy;
  private readonly completed = new Map<string, PipelineResult>();
  private readonly inFlight = new Map<string, Promise<PipelineResult>>();
  private readonly idempotencySignatures = new Map<string, string>();

  constructor(options: CanonicalExecutionPipelineOptions) {
    this.options = options;
    this.executor = new CanonicalActionExecutor({
      tabId: options.tabId,
      capture: options.capture,
      observation: options.observation,
      send: options.send,
      wait: options.wait,
    });
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

    const targetCheck = verifyTargetFidelity(command, this.options.observation.semanticTargets, this.options.capture);
    if (targetCheck !== undefined) return { status: "denied", code: targetCheck };

    const destinations = navigationDestinations(command, this.options.observation.url);
    const pins = new Map<string, readonly string[]>();
    for (const destination of destinations) {
      const resolution = await resolvePublic(destination, this.options.resolver, signal);
      if (resolution.code !== undefined) return { status: "denied", code: resolution.code };
      pins.set(destination.hostname, resolution.addresses);
    }
    if (signal?.aborted) return { status: "cancelled", code: "ACTION_CANCELLED" };

    const digest = await actionAuthorizationDigest(command as never);
    const approvalValid = this.options.approvals.consume(command, digest, now);
    const policy = this.policy.evaluate(command as never, {
      tabId: this.options.tabId,
      attachedTabIds: this.options.attachedTabIds,
      approvedApprovalIds: approvalValid && command.policyContext.approvalId
        ? new Set([command.policyContext.approvalId])
        : new Set(),
      observation: this.options.observation,
      capture: this.options.capture,
    });
    if (policy.decision === "requires_approval") return { status: "approval_required", code: policy.code };
    if (policy.decision === "denied") return { status: "denied", code: policy.code };

    if (command.action.type === "visit_url") {
      const destination = new URL(command.action.url);
      const second = await resolvePublic(destination, this.options.resolver, signal);
      const first = pins.get(destination.hostname) ?? [];
      if (second.code !== undefined || !sameAddresses(first, second.addresses)) {
        return { status: "denied", code: "DNS_REBINDING_DETECTED" };
      }
    }
    if (signal?.aborted) return { status: "cancelled", code: "ACTION_CANCELLED" };

    let execution: ActionExecutionResult | undefined;
    const settlement = await this.options.settler.settle(async () => {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      execution = await this.executor.execute(command as never, signal, policy.authorization);
      if (!execution.ok) throw new Error("Controlled action failed");
    }, signal);
    if (signal?.aborted || settlement.status === "cancelled") return { status: "cancelled", code: "ACTION_CANCELLED" };
    if (execution === undefined || !execution.ok) return { status: "failed", code: execution?.error.code ?? "ACTION_EXECUTION_FAILED" };
    if (settlement.status !== "settled") return { status: "failed", code: "SETTLEMENT_FAILED" };
    return { status: "succeeded", code: "ACTION_SUCCEEDED", execution, settlement };
  }
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

async function resolvePublic(url: URL, resolver: DnsResolver, signal?: AbortSignal): Promise<{ addresses: readonly string[]; code?: string }> {
  if (signal?.aborted) return { addresses: [], code: "ACTION_CANCELLED" };
  let addresses: readonly string[];
  try {
    addresses = isIpLiteral(url.hostname) ? [stripBrackets(url.hostname)] : await resolver.resolve(url.hostname, signal);
  } catch {
    return { addresses: [], code: "DNS_RESOLUTION_FAILED" };
  }
  const normalized = [...new Set(addresses.map(stripBrackets))].sort();
  if (normalized.length === 0) return { addresses: [], code: "DNS_RESOLUTION_FAILED" };
  if (normalized.some((address) => !isPublicAddress(address))) return { addresses: normalized, code: "PRIVATE_NETWORK_DENIED" };
  return { addresses: normalized };
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
