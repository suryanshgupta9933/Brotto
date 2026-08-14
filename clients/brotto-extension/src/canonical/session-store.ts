import type { CanonicalBootstrapMaterial } from "./transport";
import { AgentMessageV1Schema, type AgentMessageV1 } from "@brotto/relay-protocol";
import { ActionResultV1Schema, type ActionResultV1 } from "@brotto/brotto-action-schema";

const RECOVERY_KEY = "canonicalRecovery";
const BOOTSTRAP_KEY = "canonicalBootstrap";
const TRAJECTORY_KEY = "canonicalTrajectory";
const ACTION_EXECUTION_KEY = "canonicalActionExecution";
const TERMINAL_KEY = "canonicalTerminal";
const APPROVAL_KEY = "canonicalApproval";
const MAX_TRAJECTORY_EVENTS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_SUMMARY = /(?:https?:\/\/|authorization|bearer|cookie|credential|local\s*storage|password|profile|secret|session\s*storage|token)/i;

export type CanonicalRecoveryStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "executing"
  | "waiting_for_approval"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed"
  | "disconnected";

export interface CanonicalRecoveryState {
  readonly version: 1;
  readonly serverUrl: string;
  readonly sessionId: string;
  readonly deviceId: string;
  readonly lastReceivedSequence: number;
  readonly lastSentSequence: number;
  readonly attachedTabId: number | null;
  readonly taskId: string;
  readonly lastObservationId: string | null;
  readonly pendingActionId: string | null;
  readonly status: CanonicalRecoveryStatus;
}

export interface SanitizedTrajectorySummary {
  readonly type: "connection" | "observation" | "action" | "approval" | "terminal" | "error";
  readonly summary: string;
  readonly occurredAt: string;
}

export type DurableActionExecution = {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly observationId: string;
  readonly status: "started";
} | {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly observationId: string;
  readonly status: "completed";
  readonly result: ActionResultV1;
};

export interface DurableApprovalMetadata {
  readonly approvalId: string;
  readonly policyDecisionId: string;
  readonly actionId: string;
  readonly observationId: string;
  readonly requestedAt: string;
  readonly reason: "Approval required";
}

export type DurableTerminalMessage = Extract<AgentMessageV1, {
  type: "task.completed" | "task.failed" | "task.cancelled";
}>;

export interface StorageAreaPort {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface CanonicalSessionStoreOptions {
  readonly local: StorageAreaPort;
  readonly session?: StorageAreaPort;
  readonly now?: () => number;
}

/** Owns the extension's minimal restart state. Browser/page data is never accepted. */
export class CanonicalSessionStore {
  private readonly local: StorageAreaPort;
  private readonly session?: StorageAreaPort;
  private readonly now: () => number;
  private memoryBootstrap: CanonicalBootstrapMaterial | null = null;

  constructor(options: CanonicalSessionStoreOptions) {
    this.local = options.local;
    this.session = options.session;
    this.now = options.now ?? Date.now;
  }

  async saveRecovery(input: unknown): Promise<void> {
    await this.local.set({ [RECOVERY_KEY]: parseRecovery(input) });
  }

  async loadRecovery(): Promise<CanonicalRecoveryState | null> {
    const raw = (await this.local.get(RECOVERY_KEY))[RECOVERY_KEY];
    if (raw === undefined) return null;
    try {
      return parseRecovery(raw);
    } catch {
      await this.local.remove(RECOVERY_KEY);
      return null;
    }
  }

  async clearRecovery(): Promise<void> {
    await this.local.remove(RECOVERY_KEY);
  }

  async saveBootstrap(material: CanonicalBootstrapMaterial): Promise<void> {
    const value = parseBootstrap(material);
    this.memoryBootstrap = value;
    if (this.session !== undefined) await this.session.set({ [BOOTSTRAP_KEY]: value });
  }

  async loadBootstrap(): Promise<CanonicalBootstrapMaterial | null> {
    const raw = this.session === undefined
      ? this.memoryBootstrap
      : (await this.session.get(BOOTSTRAP_KEY))[BOOTSTRAP_KEY];
    if (raw === undefined || raw === null) return null;
    try {
      const material = parseBootstrap(raw);
      if (material.expiresAt <= this.now()) {
        await this.clearBootstrap();
        return null;
      }
      this.memoryBootstrap = material;
      return material;
    } catch {
      await this.clearBootstrap();
      return null;
    }
  }

  async clearBootstrap(): Promise<void> {
    this.memoryBootstrap = null;
    if (this.session !== undefined) await this.session.remove(BOOTSTRAP_KEY);
  }

  async appendTrajectory(input: SanitizedTrajectorySummary): Promise<void> {
    const event = sanitizeTrajectory(input);
    const existing = await this.loadTrajectory();
    const next = [...existing, event].slice(-MAX_TRAJECTORY_EVENTS);
    await this.local.set({ [TRAJECTORY_KEY]: next });
  }

  async loadTrajectory(): Promise<SanitizedTrajectorySummary[]> {
    const raw = (await this.local.get(TRAJECTORY_KEY))[TRAJECTORY_KEY];
    if (!Array.isArray(raw)) return [];
    return raw.slice(-MAX_TRAJECTORY_EVENTS).flatMap((value) => {
      try {
        return [sanitizeTrajectory(value as SanitizedTrajectorySummary)];
      } catch {
        return [];
      }
    });
  }

  async clearTrajectory(): Promise<void> {
    await this.local.remove(TRAJECTORY_KEY);
  }

  async saveActionExecution(input: unknown): Promise<void> {
    await this.local.set({ [ACTION_EXECUTION_KEY]: parseActionExecution(input) });
  }

  async loadActionExecution(): Promise<DurableActionExecution | null> {
    return this.loadValidated(ACTION_EXECUTION_KEY, parseActionExecution);
  }

  async clearActionExecution(): Promise<void> {
    await this.local.remove(ACTION_EXECUTION_KEY);
  }

  async saveTerminal(input: unknown): Promise<void> {
    await this.local.set({ [TERMINAL_KEY]: parseTerminal(input) });
  }

  async loadTerminal(): Promise<DurableTerminalMessage | null> {
    return this.loadValidated(TERMINAL_KEY, parseTerminal);
  }

  async clearTerminal(): Promise<void> {
    await this.local.remove(TERMINAL_KEY);
  }

  async saveApproval(input: unknown): Promise<void> {
    await this.local.set({ [APPROVAL_KEY]: parseApproval(input) });
  }

  async loadApproval(): Promise<DurableApprovalMetadata | null> {
    return this.loadValidated(APPROVAL_KEY, parseApproval);
  }

  async clearApproval(): Promise<void> {
    await this.local.remove(APPROVAL_KEY);
  }

  private async loadValidated<T>(key: string, parse: (input: unknown) => T): Promise<T | null> {
    const raw = (await this.local.get(key))[key];
    if (raw === undefined) return null;
    try {
      return parse(raw);
    } catch {
      await this.local.remove(key);
      return null;
    }
  }
}

function parseActionExecution(input: unknown): DurableActionExecution {
  const value = record(input, "Action execution");
  const base = {
    actionId: uuid(value.actionId, "actionId"),
    idempotencyKey: boundedString(value.idempotencyKey, "idempotencyKey", 256),
    observationId: uuid(value.observationId, "observationId"),
  };
  if (value.status === "started") return { ...base, status: "started" };
  if (value.status === "completed") return {
    ...base,
    status: "completed",
    result: ActionResultV1Schema.parse(value.result),
  };
  throw new TypeError("Action execution status is invalid");
}

function parseTerminal(input: unknown): DurableTerminalMessage {
  const message = AgentMessageV1Schema.parse(input);
  if (message.type !== "task.completed" && message.type !== "task.failed" && message.type !== "task.cancelled") {
    throw new TypeError("Terminal message is invalid");
  }
  return message;
}

function parseApproval(input: unknown): DurableApprovalMetadata {
  const value = record(input, "Approval metadata");
  const requestedAt = boundedString(value.requestedAt, "requestedAt", 64);
  if (!Number.isFinite(Date.parse(requestedAt))) throw new TypeError("Approval timestamp is invalid");
  return {
    approvalId: uuid(value.approvalId, "approvalId"),
    policyDecisionId: uuid(value.policyDecisionId, "policyDecisionId"),
    actionId: uuid(value.actionId, "actionId"),
    observationId: uuid(value.observationId, "observationId"),
    requestedAt: new Date(requestedAt).toISOString(),
    reason: "Approval required",
  };
}

function parseRecovery(input: unknown): CanonicalRecoveryState {
  const value = record(input, "Recovery state");
  const status = value.status;
  if (![
    "connecting", "connected", "reconnecting", "executing", "waiting_for_approval",
    "cancelling", "cancelled", "completed", "failed", "disconnected",
  ].includes(String(status))) throw new TypeError("Recovery status is invalid");
  return {
    version: value.version === 1 ? 1 : fail("Recovery version is invalid"),
    serverUrl: wssUrl(value.serverUrl),
    sessionId: uuid(value.sessionId, "sessionId"),
    deviceId: uuid(value.deviceId, "deviceId"),
    lastReceivedSequence: sequence(value.lastReceivedSequence, "lastReceivedSequence"),
    lastSentSequence: sequence(value.lastSentSequence, "lastSentSequence"),
    attachedTabId: nullablePositiveInteger(value.attachedTabId, "attachedTabId"),
    taskId: uuid(value.taskId, "taskId"),
    lastObservationId: nullableUuid(value.lastObservationId, "lastObservationId"),
    pendingActionId: nullableUuid(value.pendingActionId, "pendingActionId"),
    status: status as CanonicalRecoveryStatus,
  };
}

function parseBootstrap(input: unknown): CanonicalBootstrapMaterial {
  const value = record(input, "Bootstrap material");
  const credential = boundedString(value.connectionCredential, "connectionCredential", 16_384);
  const hmacKey = boundedString(value.hmacKey, "hmacKey", 4_096);
  const tenantId = boundedString(value.tenantId, "tenantId", 256);
  const expiresAt = value.expiresAt;
  if (!Number.isInteger(expiresAt) || (expiresAt as number) <= 0) throw new TypeError("Bootstrap expiry is invalid");
  return {
    serverUrl: wssUrl(value.serverUrl),
    connectionCredential: credential,
    serverRecipientId: uuid(value.serverRecipientId, "serverRecipientId"),
    tenantId,
    deviceId: uuid(value.deviceId, "deviceId"),
    sessionId: uuid(value.sessionId, "sessionId"),
    expiresAt: expiresAt as number,
    hmacKey,
  };
}

function sanitizeTrajectory(input: SanitizedTrajectorySummary): SanitizedTrajectorySummary {
  const value = record(input, "Trajectory summary");
  if (!["connection", "observation", "action", "approval", "terminal", "error"].includes(String(value.type))) {
    throw new TypeError("Trajectory type is invalid");
  }
  const occurredAt = boundedString(value.occurredAt, "occurredAt", 64);
  if (!Number.isFinite(Date.parse(occurredAt))) throw new TypeError("Trajectory timestamp is invalid");
  const rawSummary = boundedString(value.summary, "summary", 256);
  return {
    type: value.type as SanitizedTrajectorySummary["type"],
    summary: SENSITIVE_SUMMARY.test(rawSummary) ? "Sensitive step" : rawSummary,
    occurredAt: new Date(occurredAt).toISOString(),
  };
}

function record(input: unknown, name: string): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError(`${name} is invalid`);
  return input as Record<string, unknown>;
}

function wssUrl(input: unknown): string {
  const value = boundedString(input, "serverUrl", 2_048);
  const url = new URL(value);
  if (url.protocol !== "wss:" || url.username !== "" || url.password !== "") throw new TypeError("Server URL must use authenticated WSS");
  return url.href;
}

function uuid(input: unknown, name: string): string {
  if (typeof input !== "string" || !UUID.test(input)) throw new TypeError(`${name} must be an opaque UUID`);
  return input;
}

function nullableUuid(input: unknown, name: string): string | null {
  return input === null ? null : uuid(input, name);
}

function nullablePositiveInteger(input: unknown, name: string): number | null {
  if (input === null) return null;
  if (!Number.isInteger(input) || (input as number) <= 0) throw new TypeError(`${name} is invalid`);
  return input as number;
}

function sequence(input: unknown, name: string): number {
  if (!Number.isInteger(input) || (input as number) < 0) throw new TypeError(`${name} is invalid`);
  return input as number;
}

function boundedString(input: unknown, name: string, maximum: number): string {
  if (typeof input !== "string" || input.length === 0 || input.length > maximum) throw new TypeError(`${name} is invalid`);
  return input;
}

function fail(message: string): never {
  throw new TypeError(message);
}
