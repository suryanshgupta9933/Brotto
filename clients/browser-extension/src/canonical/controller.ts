import {
  ActionCommandMessageSchema,
  AgentMessageV1Schema,
  type AgentEnvelopeV1,
  type AgentMessageV1,
} from "@fara-platform/relay-protocol";
import {
  ActionResultV1Schema,
  type ActionCommandV1,
  type ActionResultV1,
  type ApprovalResolutionV1,
  type ObservationV1,
} from "@fara-platform/fara-action-schema";
import {
  InMemoryApprovalStore,
  actionAuthorizationDigest,
  type ObservationAuthority,
  type PipelineResult,
  type TrustedExecutionContext,
} from "./execution-pipeline";
import {
  CanonicalSessionStore,
  type CanonicalRecoveryState,
  type CanonicalRecoveryStatus,
} from "./session-store";
import type {
  CanonicalBootstrapMaterial,
  SendEnvelopeLinkage,
  TransportMessage,
  TransportSnapshot,
} from "./transport";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BootstrapInput =
  | { readonly mode: "open"; readonly goal: string; readonly taskId: string }
  | { readonly mode: "resume"; readonly recovery: CanonicalRecoveryState };

export interface ConnectionBootstrapPort {
  bootstrap(input: BootstrapInput, signal: AbortSignal): Promise<CanonicalBootstrapMaterial>;
}

export interface CanonicalTransportPort {
  connect(): Promise<void>;
  send(message: AgentMessageV1, linkage?: SendEnvelopeLinkage): Promise<AgentEnvelopeV1>;
  close(reason?: string): Promise<void>;
  snapshot(): TransportSnapshot;
}

export interface CapturedControllerObservation {
  readonly observation: ObservationV1;
  readonly mainFrameId: string;
}

export interface ControllerTabsPort {
  activeTabId(): Promise<number>;
  attach(tabId: number): Promise<void>;
  detach(tabId: number): Promise<void>;
  isAttached(tabId: number): boolean | Promise<boolean>;
}

export interface ControllerExecutionPipeline {
  execute(input: unknown, signal?: AbortSignal): Promise<PipelineResult>;
}

export interface ControllerPipelineContext {
  readonly tabId: number;
  readonly serverUrl: string;
  readonly observationAuthority: ObservationAuthority;
  readonly approvals: InMemoryApprovalStore;
}

export interface ControllerTransportContext {
  readonly material: CanonicalBootstrapMaterial;
  readonly recovery: CanonicalRecoveryState;
  readonly pendingActionIds: () => readonly string[];
  readonly getReconnectMaterial: (signal: AbortSignal) => Promise<CanonicalBootstrapMaterial>;
  readonly onMaterial: (material: CanonicalBootstrapMaterial) => Promise<void>;
  readonly onMessage: (message: TransportMessage) => Promise<void>;
  readonly onStateChange: (snapshot: TransportSnapshot) => void;
}

export type ControllerUiEvent =
  | { readonly type: "canonical_status"; readonly status: CanonicalRecoveryStatus; readonly reconnectAttempt?: number }
  | { readonly type: "canonical_step"; readonly kind: "observation" | "acknowledged" | "action" | "result"; readonly summary: string; readonly actionId?: string }
  | { readonly type: "canonical_approval"; readonly request: Extract<AgentMessageV1, { type: "approval.requested" }> }
  | { readonly type: "canonical_terminal"; readonly message: Extract<AgentMessageV1, { type: "task.completed" | "task.failed" | "task.cancelled" }> }
  | { readonly type: "canonical_error"; readonly code: string; readonly message: string }
  | { readonly type: "canonical_reconnect"; readonly status: TransportSnapshot["status"]; readonly attempt: number };

export interface CanonicalExtensionControllerOptions {
  readonly bootstrap: ConnectionBootstrapPort;
  readonly store: CanonicalSessionStore;
  readonly transportFactory: (context: ControllerTransportContext) => CanonicalTransportPort;
  readonly tabs: ControllerTabsPort;
  readonly capture: (tabId: number, signal?: AbortSignal) => Promise<CapturedControllerObservation>;
  readonly executionPipelineFactory: (context: ControllerPipelineContext) => ControllerExecutionPipeline;
  readonly emitUiEvent?: (event: ControllerUiEvent) => void;
  readonly now?: () => number;
  readonly idGenerator?: () => string;
}

interface CachedActionResult {
  readonly signature: string;
  readonly message: Extract<AgentMessageV1, { type: "action.completed" }>;
}

/** MV3 composition-safe owner of the canonical task, action, approval, and recovery lifecycle. */
export class CanonicalExtensionController {
  private readonly options: CanonicalExtensionControllerOptions;
  private readonly now: () => number;
  private readonly idGenerator: () => string;
  private readonly approvals = new InMemoryApprovalStore();
  private readonly resultCache = new Map<string, CachedActionResult>();
  private readonly inFlightResults = new Map<string, Promise<Extract<AgentMessageV1, { type: "action.completed" }>>>();
  private readonly approvalResolutions = new Map<string, ApprovalResolutionV1>();
  private lifecycleAbort = new AbortController();
  private actionAbort: AbortController | null = null;
  private activeAction: Promise<unknown> | null = null;
  private transport: CanonicalTransportPort | null = null;
  private recovery: CanonicalRecoveryState | null = null;
  private pipeline: ControllerExecutionPipeline | null = null;
  private captured: CapturedControllerObservation | null = null;
  private pendingApproval: Extract<AgentMessageV1, { type: "approval.requested" }> | null = null;
  private terminalEmitted = false;
  private restoredLease = false;

  constructor(options: CanonicalExtensionControllerOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
  }

  async startTask(rawGoal: string): Promise<void> {
    if (this.recovery !== null && !isTerminalStatus(this.recovery.status)) throw new Error("A canonical task is already active");
    const goal = validateGoal(rawGoal);
    const taskId = requireUuid(this.idGenerator(), "task ID");
    this.resetLease();
    await Promise.all([
      this.options.store.clearTerminal(),
      this.options.store.clearApproval(),
      this.options.store.clearActionExecution(),
    ]);
    let tabId: number | null = null;
    try {
      this.emit({ type: "canonical_status", status: "connecting" });
      tabId = await this.options.tabs.activeTabId();
      await this.options.tabs.attach(tabId);
      const material = await this.options.bootstrap.bootstrap({ mode: "open", goal, taskId }, this.lifecycleAbort.signal);
      await this.options.store.saveBootstrap(material);
      this.recovery = recoveryFrom(material, taskId, tabId, "connecting");
      await this.options.store.saveRecovery(this.recovery);
      this.prepareAttachedRuntime(tabId);
      this.transport = this.options.transportFactory(this.transportContext(material));
      await this.transport.connect();
      await this.transport.send({ type: "session.open", client: "browser_extension", goal }, {
        correlationId: taskId,
        causationId: taskId,
      });
      this.captured = await this.options.capture(tabId, this.lifecycleAbort.signal);
      await this.transport.send({ type: "observation.submitted", observation: this.captured.observation }, {
        correlationId: taskId,
        causationId: taskId,
      });
      await this.updateRecovery({
        status: "connected",
        lastObservationId: this.captured.observation.observationId,
      });
      await this.options.store.appendTrajectory(trajectory("observation", "Initial observation submitted", this.now()));
      this.emit({ type: "canonical_step", kind: "observation", summary: "Initial observation submitted" });
      this.emit({ type: "canonical_status", status: "connected" });
    } catch (error) {
      if (tabId !== null) await boundedCleanup(this.safeDetach(tabId));
      await boundedCleanup(this.transport?.close("startup failed"));
      this.transport = null;
      await this.options.store.clearBootstrap();
      this.emitError("SESSION_START_FAILED", error);
      throw error;
    }
  }

  async restore(): Promise<boolean> {
    const recovery = await this.options.store.loadRecovery();
    if (recovery === null || recovery.attachedTabId === null) return false;
    if (isTerminalStatus(recovery.status)) {
      this.recovery = recovery;
      return false;
    }
    this.resetLease();
    this.restoredLease = true;
    let material = await this.options.store.loadBootstrap();
    if (material === null) {
      material = await this.options.bootstrap.bootstrap({ mode: "resume", recovery }, this.lifecycleAbort.signal);
      await this.options.store.saveBootstrap(material);
    }
    assertRecoveryBinding(recovery, material);
    this.recovery = recovery;
    const approval = await this.options.store.loadApproval();
    if (approval !== null) this.pendingApproval = AgentMessageV1Schema.parse({
      type: "approval.requested",
      ...approval,
    }) as Extract<AgentMessageV1, { type: "approval.requested" }>;
    const attached = await this.options.tabs.isAttached(recovery.attachedTabId);
    if (!attached) await this.options.tabs.attach(recovery.attachedTabId);
    this.prepareAttachedRuntime(recovery.attachedTabId);
    this.transport = this.options.transportFactory(this.transportContext(material));
    await this.transport.connect();
    await this.updateRecovery({ status: "reconnecting" });
    this.emit({ type: "canonical_status", status: "reconnecting" });
    return true;
  }

  async handleTransportMessage(input: TransportMessage): Promise<void> {
    const message = AgentMessageV1Schema.parse(input.message);
    switch (message.type) {
      case "action.command":
        await this.handleCommand(message);
        return;
      case "approval.requested":
        this.pendingApproval = message;
        await this.options.store.saveApproval(message);
        await this.updateRecovery({ status: "waiting_for_approval", pendingActionId: message.actionId });
        await this.options.store.appendTrajectory(trajectory("approval", "Approval required", this.now()));
        this.emit({ type: "canonical_approval", request: message });
        return;
      case "reconcile.response":
        await this.handleReconciliation(message);
        return;
      case "task.completed":
      case "task.failed":
      case "task.cancelled":
        await this.handleTerminal(message);
        return;
      case "protocol.error":
        this.emit({ type: "canonical_error", code: message.code, message: message.message });
        return;
      default:
        return;
    }
  }

  async resolveApproval(approved: boolean): Promise<void> {
    const request = this.pendingApproval;
    const transport = this.requireTransport();
    if (request === null) throw new Error("No canonical approval is pending");
    const resolution: ApprovalResolutionV1 = {
      approvalId: request.approvalId,
      policyDecisionId: request.policyDecisionId,
      actionId: request.actionId,
      status: approved ? "approved" : "denied",
      resolvedAt: new Date(this.now()).toISOString(),
    } as ApprovalResolutionV1;
    await transport.send({ type: "approval.resolved", resolution }, {
      correlationId: request.actionId,
      causationId: request.approvalId,
    });
    this.approvalResolutions.set(request.actionId, resolution);
    this.pendingApproval = null;
    await this.options.store.clearApproval();
    await this.options.store.appendTrajectory(trajectory("approval", approved ? "Approval granted" : "Approval denied", this.now()));
    await this.updateRecovery({ status: "connected", pendingActionId: null });
  }

  async cancel(reason = "User cancelled the task"): Promise<void> {
    const recovery = this.recovery;
    this.lifecycleAbort.abort();
    this.actionAbort?.abort();
    if (recovery === null) {
      await this.disconnectRuntime("cancelled", true);
      return;
    }
    await this.updateRecovery({ status: "cancelling" });
    this.emit({ type: "canonical_status", status: "cancelling" });
    if (this.transport !== null && recovery.lastObservationId !== null) {
      await this.transport.send({
        type: "task.cancelled",
        taskId: recovery.taskId as never,
        occurredAt: new Date(this.now()).toISOString(),
        reason: sanitizeReason(reason),
        observationId: recovery.lastObservationId as never,
        ...(recovery.pendingActionId === null ? {} : { actionId: recovery.pendingActionId as never }),
      }, {
        correlationId: recovery.taskId,
        causationId: recovery.pendingActionId ?? recovery.taskId,
      }).catch((error) => this.emitError("CANCELLATION_SEND_FAILED", error));
    }
    await this.disconnectRuntime("cancelled", true);
    await this.updateRecovery({ status: "cancelled", pendingActionId: null });
    this.emit({ type: "canonical_status", status: "cancelled" });
  }

  async disconnect(): Promise<void> {
    this.lifecycleAbort.abort();
    this.actionAbort?.abort();
    await this.disconnectRuntime("disconnected", true);
    if (this.recovery !== null) await this.updateRecovery({ status: "disconnected", pendingActionId: null });
    this.emit({ type: "canonical_status", status: "disconnected" });
  }

  async submitFreshObservation(summary = "Fresh observation submitted"): Promise<void> {
    const recovery = this.recovery;
    if (recovery?.attachedTabId === null || recovery?.attachedTabId === undefined) throw new Error("No canonical tab is attached");
    this.captured = await this.options.capture(recovery.attachedTabId, this.lifecycleAbort.signal);
    await this.requireTransport().send({ type: "observation.submitted", observation: this.captured.observation }, {
      correlationId: recovery.taskId,
      causationId: recovery.lastObservationId ?? recovery.taskId,
    });
    await this.updateRecovery({ lastObservationId: this.captured.observation.observationId, status: "connected" });
    await this.options.store.appendTrajectory(trajectory("observation", summary, this.now()));
    this.emit({ type: "canonical_step", kind: "observation", summary });
  }

  async viewState(): Promise<{
    recovery: CanonicalRecoveryState | null;
    transport: TransportSnapshot | null;
    trajectory: Awaited<ReturnType<CanonicalSessionStore["loadTrajectory"]>>;
    terminal: Awaited<ReturnType<CanonicalSessionStore["loadTerminal"]>>;
    approval: Awaited<ReturnType<CanonicalSessionStore["loadApproval"]>>;
  }> {
    return {
      recovery: this.recovery ?? await this.options.store.loadRecovery(),
      transport: this.transport?.snapshot() ?? null,
      trajectory: await this.options.store.loadTrajectory(),
      terminal: await this.options.store.loadTerminal(),
      approval: await this.options.store.loadApproval(),
    };
  }

  /** Called by tab lifecycle listeners so commands cannot use a page that changed after observation. */
  invalidateObservation(tabId: number): void {
    if (this.recovery?.attachedTabId === tabId) this.captured = null;
  }

  private async handleCommand(raw: Extract<AgentMessageV1, { type: "action.command" }>): Promise<void> {
    const parsed = ActionCommandMessageSchema.parse(raw);
    const command = parsed.command as ActionCommandV1;
    const transport = this.requireTransport();
    await this.updateRecovery({ status: "executing", pendingActionId: command.actionId });
    await transport.send({
      type: "action.acknowledged",
      actionId: command.actionId,
      stepId: command.stepId,
      observationId: command.observationId,
      acknowledgedAt: new Date(this.now()).toISOString(),
    }, {
      correlationId: command.actionId,
      causationId: command.observationId,
    });
    this.emit({ type: "canonical_step", kind: "acknowledged", summary: "Action acknowledged", actionId: command.actionId });

    const signature = canonicalCommandSignature(command);
    const durable = await this.options.store.loadActionExecution();
    const durableMatches = durable !== null && durable.actionId === command.actionId && durable.idempotencyKey === command.idempotencyKey &&
      durable.observationId === command.observationId;
    const unknownRestoredAction = durable === null && this.restoredLease && this.recovery?.pendingActionId === command.actionId;
    if (durableMatches || unknownRestoredAction) {
      const message = {
        type: "action.completed",
        result: durable?.status === "completed" ? durable.result : indeterminateResult(command, this.now()),
      } as const;
      if (durable?.status !== "completed") await this.options.store.saveActionExecution({
        actionId: command.actionId,
        idempotencyKey: command.idempotencyKey,
        observationId: command.observationId,
        status: "completed",
        result: message.result,
      });
      this.resultCache.set(command.idempotencyKey, { signature, message });
      await transport.send(message, { correlationId: command.actionId, causationId: command.actionId });
      await this.updateRecovery({ status: "connected", pendingActionId: null, lastObservationId: resultObservationId(message.result) });
      return;
    }
    const cached = this.resultCache.get(command.idempotencyKey);
    if (cached !== undefined && cached.signature === signature) {
      await transport.send(cached.message, { correlationId: command.actionId, causationId: command.actionId });
      return;
    }
    const active = this.inFlightResults.get(command.idempotencyKey);
    if (active !== undefined) {
      const message = await active;
      await transport.send(message, { correlationId: command.actionId, causationId: command.actionId });
      return;
    }

    if (command.policyContext.approved) await this.registerApproval(command);
    await this.options.store.saveActionExecution({
      actionId: command.actionId,
      idempotencyKey: command.idempotencyKey,
      observationId: command.observationId,
      status: "started",
    });
    const work = this.executeCommand(command, signature);
    this.inFlightResults.set(command.idempotencyKey, work);
    this.activeAction = work;
    try {
      const completed = await work;
      await transport.send(completed, { correlationId: command.actionId, causationId: command.actionId });
      await this.updateRecovery({ status: "connected", pendingActionId: null, lastObservationId: resultObservationId(completed.result) });
    } finally {
      this.inFlightResults.delete(command.idempotencyKey);
      if (this.activeAction === work) this.activeAction = null;
      this.actionAbort = null;
    }
  }

  private async executeCommand(
    command: ActionCommandV1,
    signature: string,
  ): Promise<Extract<AgentMessageV1, { type: "action.completed" }>> {
    const pipeline = this.pipeline;
    this.actionAbort = new AbortController();
    const startedAtMs = Math.max(this.now(), Date.parse(command.dispatchedAt));
    this.emit({ type: "canonical_step", kind: "action", summary: actionSummary(command), actionId: command.actionId });
    let result: ActionResultV1;
    try {
      if (pipeline === null) throw new Error("Trusted canonical execution pipeline is unavailable");
      const pipelineResult = await pipeline.execute(command, this.actionAbort.signal);
      result = await this.toActionResult(command, pipelineResult, startedAtMs, this.actionAbort.signal);
    } catch {
      result = indeterminateResult(command, this.now(), startedAtMs, "CLIENT_EXECUTION_INDETERMINATE");
    }
    const message = { type: "action.completed", result } as const;
    await this.options.store.saveActionExecution({
      actionId: command.actionId,
      idempotencyKey: command.idempotencyKey,
      observationId: command.observationId,
      status: "completed",
      result,
    });
    this.resultCache.set(command.idempotencyKey, { signature, message });
    await this.options.store.appendTrajectory(trajectory("action", resultSummary(command, result), this.now()));
    this.emit({ type: "canonical_step", kind: "result", summary: resultSummary(command, result), actionId: command.actionId });
    return message;
  }

  private async toActionResult(
    command: ActionCommandV1,
    pipelineResult: PipelineResult,
    startedAtMs: number,
    signal: AbortSignal,
  ): Promise<ActionResultV1> {
    const baseCompletedAt = Math.max(startedAtMs, this.now());
    const base = {
      actionId: command.actionId,
      stepId: command.stepId,
      observationId: command.observationId,
      sequence: command.sequence + 1,
      startedAt: new Date(startedAtMs).toISOString(),
      completedAt: new Date(baseCompletedAt).toISOString(),
      durationMs: baseCompletedAt - startedAtMs,
    };
    if (pipelineResult.status === "denied" || pipelineResult.status === "approval_required") {
      return ActionResultV1Schema.parse({
        ...base,
        status: pipelineResult.status === "approval_required"
          ? "approval_required"
          : staleCode(pipelineResult.code) ? "rejected_stale" : "rejected_policy",
        rejection: { code: pipelineResult.code, message: safeResultMessage(pipelineResult.code), retryable: pipelineResult.status === "approval_required" },
      });
    }
    const post = await this.capturePostObservation(signal);
    const chronology = chronologicalTimes(startedAtMs, baseCompletedAt, Date.parse(post.observation.capturedAt));
    const executedBase = {
      ...base,
      startedAt: new Date(chronology.startedAt).toISOString(),
      completedAt: new Date(chronology.completedAt).toISOString(),
      durationMs: chronology.completedAt - chronology.startedAt,
      postObservation: post.observation,
    };
    if (pipelineResult.status === "succeeded") return ActionResultV1Schema.parse({ ...executedBase, status: "succeeded" });
    if (pipelineResult.status === "cancelled") return ActionResultV1Schema.parse({
      ...executedBase,
      status: "cancelled",
      cancellation: { reason: "Action cancelled" },
    });
    return ActionResultV1Schema.parse({
      ...executedBase,
      status: pipelineResult.status === "failed" ? "failed_recoverable" : "failed_terminal",
      error: { code: pipelineResult.code, message: safeResultMessage(pipelineResult.code), retryable: pipelineResult.status === "failed" },
    });
  }

  private async capturePostObservation(signal: AbortSignal): Promise<CapturedControllerObservation> {
    const tabId = this.recovery?.attachedTabId;
    if (tabId === null || tabId === undefined) throw new Error("Attached tab is unavailable for post-observation");
    const captured = await this.options.capture(tabId, signal);
    this.captured = captured;
    return captured;
  }

  private async registerApproval(command: ActionCommandV1): Promise<void> {
    const resolution = this.approvalResolutions.get(command.actionId);
    if (resolution?.status !== "approved" || resolution.approvalId !== command.policyContext.approvalId) return;
    this.approvals.register({
      approvalId: resolution.approvalId,
      actionId: command.actionId,
      policyDecisionId: command.policyContext.policyDecisionId,
      observationId: command.observationId,
      actionDigest: await actionAuthorizationDigest(command as never),
      idempotencyKey: command.idempotencyKey,
      expiresAt: command.expiresAt,
      commandExpiresAt: command.expiresAt,
    });
  }

  private async handleReconciliation(message: Extract<AgentMessageV1, { type: "reconcile.response" }>): Promise<void> {
    if (message.terminal !== undefined) {
      await this.handleTerminal(message.terminal);
      return;
    }
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(message.authoritativeState)) {
      await this.disconnectRuntime("terminal reconciliation missing result", true);
      throw new Error("Authoritative terminal reconciliation omitted its structured terminal result");
    }
    if (message.storedResult !== undefined) {
      await this.updateRecovery({ pendingActionId: null, status: terminalStateStatus(message.authoritativeState) });
      return;
    }
    if (message.requiresFreshObservation || (message.command !== undefined && this.captured === null)) {
      const tabId = this.recovery?.attachedTabId;
      if (tabId === null || tabId === undefined) throw new Error("Cannot reconcile without an attached tab");
      this.captured = await this.options.capture(tabId, this.lifecycleAbort.signal);
      await this.requireTransport().send({ type: "observation.submitted", observation: this.captured.observation }, {
        correlationId: this.recovery!.taskId,
        causationId: this.recovery!.taskId,
      });
      await this.updateRecovery({ lastObservationId: this.captured.observation.observationId, pendingActionId: null, status: "connected" });
      return;
    }
    if (message.command !== undefined) await this.handleCommand(message.command);
  }

  private async handleTerminal(message: Extract<AgentMessageV1, { type: "task.completed" | "task.failed" | "task.cancelled" }>): Promise<void> {
    if (this.terminalEmitted) return;
    this.terminalEmitted = true;
    this.actionAbort?.abort();
    const status = message.type === "task.completed" ? "completed" : message.type === "task.failed" ? "failed" : "cancelled";
    await this.options.store.saveTerminal(message);
    await this.options.store.clearApproval();
    await this.updateRecovery({ status, pendingActionId: null });
    await this.options.store.appendTrajectory(trajectory("terminal", `Task ${status}`, this.now()));
    this.emit({ type: "canonical_terminal", message });
    await this.disconnectRuntime("terminal", true);
  }

  private prepareAttachedRuntime(tabId: number): void {
    const authority: ObservationAuthority = {
      verify: async (requestedTabId, observationId, signal) => {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (requestedTabId !== tabId || !await this.options.tabs.isAttached(tabId)) throw new Error("Tab attachment is not authoritative");
        const captured = this.captured;
        if (captured === null || captured.observation.observationId !== observationId) throw new Error("Observation is stale");
        return trustedContext(captured);
      },
    };
    if (this.recovery === null) throw new Error("Recovery state is unavailable for pipeline construction");
    this.pipeline = this.options.executionPipelineFactory({
      tabId,
      serverUrl: this.recovery.serverUrl,
      observationAuthority: authority,
      approvals: this.approvals,
    });
  }

  private transportContext(material: CanonicalBootstrapMaterial): ControllerTransportContext {
    const recovery = this.recovery;
    if (recovery === null) throw new Error("Recovery state is unavailable");
    return {
      material,
      recovery,
      pendingActionIds: () => this.recovery?.pendingActionId ? [this.recovery.pendingActionId] : [],
      getReconnectMaterial: async (signal) => {
        const current = this.recovery;
        if (current === null) throw new Error("Cannot reconnect a missing session");
        const refreshed = await this.options.bootstrap.bootstrap({ mode: "resume", recovery: current }, signal);
        assertRecoveryBinding(current, refreshed);
        await this.options.store.saveBootstrap(refreshed);
        return refreshed;
      },
      onMaterial: async (refreshed) => { await this.options.store.saveBootstrap(refreshed); },
      onMessage: async (message) => { await this.handleTransportMessage(message); },
      onStateChange: (snapshot) => { void this.handleTransportState(snapshot); },
    };
  }

  private async handleTransportState(snapshot: TransportSnapshot): Promise<void> {
    if (this.recovery === null) return;
    const status: CanonicalRecoveryStatus = snapshot.status === "reconnecting" ? "reconnecting"
      : snapshot.status === "open" ? "connected"
        : snapshot.status === "failed" ? "failed"
          : this.recovery.status;
    await this.updateRecovery({
      status,
      lastReceivedSequence: snapshot.lastReceivedSequence,
      lastSentSequence: snapshot.lastSentSequence,
    });
    if (snapshot.status === "reconnecting" || snapshot.status === "failed") {
      this.emit({ type: "canonical_reconnect", status: snapshot.status, attempt: snapshot.reconnectAttempt });
    }
  }

  private async updateRecovery(patch: Partial<CanonicalRecoveryState>): Promise<void> {
    if (this.recovery === null) return;
    const transport = this.transport?.snapshot();
    this.recovery = {
      ...this.recovery,
      ...(transport === undefined ? {} : {
        lastReceivedSequence: transport.lastReceivedSequence,
        lastSentSequence: transport.lastSentSequence,
      }),
      ...patch,
    };
    await this.options.store.saveRecovery(this.recovery);
  }

  private async disconnectRuntime(reason: string, clearBootstrap: boolean): Promise<void> {
    const transport = this.transport;
    this.transport = null;
    await boundedCleanup(transport?.close(reason));
    const tabId = this.recovery?.attachedTabId;
    if (tabId !== null && tabId !== undefined) await boundedCleanup(this.safeDetach(tabId));
    if (clearBootstrap) await this.options.store.clearBootstrap();
  }

  private async safeDetach(tabId: number): Promise<void> {
    try { await this.options.tabs.detach(tabId); } catch { /* already detached */ }
  }

  private requireTransport(): CanonicalTransportPort {
    if (this.transport === null) throw new Error("Canonical transport is unavailable");
    return this.transport;
  }

  private resetLease(): void {
    this.lifecycleAbort.abort();
    this.lifecycleAbort = new AbortController();
    this.actionAbort = null;
    this.activeAction = null;
    this.resultCache.clear();
    this.inFlightResults.clear();
    this.approvalResolutions.clear();
    this.pendingApproval = null;
    this.terminalEmitted = false;
    this.restoredLease = false;
    this.captured = null;
    this.pipeline = null;
    this.transport = null;
    this.recovery = null;
  }

  private emit(event: ControllerUiEvent): void {
    this.options.emitUiEvent?.(event);
  }

  private emitError(code: string, error: unknown): void {
    this.emit({ type: "canonical_error", code, message: error instanceof Error ? error.message : "Canonical operation failed" });
  }
}

export class ControlPlaneConnectionBootstrap implements ConnectionBootstrapPort {
  constructor(
    private readonly endpoint: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") throw new TypeError("Control-plane bootstrap requires HTTPS");
  }

  async bootstrap(input: BootstrapInput, signal: AbortSignal): Promise<CanonicalBootstrapMaterial> {
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
    if (!response.ok) throw new Error(`Control-plane bootstrap failed (${response.status})`);
    return await response.json() as CanonicalBootstrapMaterial;
  }
}

/** Explicit deterministic adapter for Task 11 fixtures; production never constructs it. */
export class DeterministicConnectionBootstrap implements ConnectionBootstrapPort {
  constructor(private readonly resolveMaterial: (input: BootstrapInput) => CanonicalBootstrapMaterial | Promise<CanonicalBootstrapMaterial>) {}

  async bootstrap(input: BootstrapInput, signal: AbortSignal): Promise<CanonicalBootstrapMaterial> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return this.resolveMaterial(input);
  }
}

function recoveryFrom(material: CanonicalBootstrapMaterial, taskId: string, tabId: number, status: CanonicalRecoveryStatus): CanonicalRecoveryState {
  return {
    version: 1,
    serverUrl: material.serverUrl,
    sessionId: material.sessionId,
    deviceId: material.deviceId,
    lastReceivedSequence: 0,
    lastSentSequence: 0,
    attachedTabId: tabId,
    taskId,
    lastObservationId: null,
    pendingActionId: null,
    status,
  };
}

function trustedContext(captured: CapturedControllerObservation): TrustedExecutionContext {
  return {
    observation: captured.observation,
    capture: {
      viewportWidth: captured.observation.viewport.width,
      viewportHeight: captured.observation.viewport.height,
      devicePixelRatio: captured.observation.viewport.devicePixelRatio,
      zoom: captured.observation.viewport.zoom,
    },
    mainFrameId: captured.mainFrameId,
  };
}

function assertRecoveryBinding(recovery: CanonicalRecoveryState, material: CanonicalBootstrapMaterial): void {
  if (recovery.serverUrl !== material.serverUrl || recovery.sessionId !== material.sessionId || recovery.deviceId !== material.deviceId) {
    throw new Error("Bootstrap material does not match the recoverable session");
  }
}

function canonicalCommandSignature(command: ActionCommandV1): string {
  return canonicalJson(command);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Command contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new TypeError("Command contains a non-canonical value");
}

function actionSummary(command: ActionCommandV1): string {
  return `${command.action.type.toUpperCase()} executing`;
}

function resultSummary(command: ActionCommandV1, result: ActionResultV1): string {
  return `${command.action.type.toUpperCase()} ${result.status}`;
}

function resultObservationId(result: ActionResultV1): string | null {
  return "postObservation" in result ? result.postObservation.observationId : result.observationId;
}

function indeterminateResult(
  command: ActionCommandV1,
  completedAtMs: number,
  startedAtMs = completedAtMs,
  code = "EXECUTION_OUTCOME_INDETERMINATE",
): ActionResultV1 {
  const completed = Math.max(startedAtMs, completedAtMs);
  return ActionResultV1Schema.parse({
    actionId: command.actionId,
    stepId: command.stepId,
    observationId: command.observationId,
    sequence: command.sequence + 1,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completed).toISOString(),
    durationMs: completed - startedAtMs,
    status: "rejected_stale",
    rejection: {
      code,
      message: "Execution outcome is indeterminate; a fresh observation is required",
      retryable: true,
    },
  });
}

async function boundedCleanup(work: Promise<void> | undefined, timeoutMs = 1_000): Promise<void> {
  if (work === undefined) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    work.catch(() => undefined),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
}

function trajectory(type: "connection" | "observation" | "action" | "approval" | "terminal" | "error", summary: string, now: number) {
  return { type, summary, occurredAt: new Date(now).toISOString() } as const;
}

function chronologicalTimes(startedAt: number, completedAt: number, capturedAt: number): { startedAt: number; completedAt: number } {
  if (!Number.isFinite(capturedAt)) throw new Error("Post-observation timestamp is invalid");
  const safeCompleted = Math.min(completedAt, capturedAt - 1);
  const safeStarted = Math.min(startedAt, safeCompleted);
  return { startedAt: safeStarted, completedAt: safeCompleted };
}

function staleCode(code: string): boolean {
  return code === "COMMAND_EXPIRED" || code.includes("OBSERVATION") || code.includes("STALE") || code.includes("TARGET_NOT_FOUND");
}

function safeResultMessage(code: string): string {
  return `Canonical action outcome: ${code}`.slice(0, 2_000);
}

function sanitizeReason(reason: string): string {
  const value = reason.trim().slice(0, 2_000);
  return value.length > 0 ? value : "User cancelled the task";
}

function terminalStateStatus(state: string): CanonicalRecoveryStatus {
  return state === "COMPLETED" ? "completed" : state === "FAILED" ? "failed" : state === "CANCELLED" ? "cancelled" : "connected";
}

function isTerminalStatus(status: CanonicalRecoveryStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "disconnected";
}

function validateGoal(raw: string): string {
  const goal = raw.trim();
  if (goal.length === 0 || goal.length > 4_000) throw new TypeError("Task goal must contain 1 to 4000 characters");
  return goal;
}

function requireUuid(value: string, name: string): string {
  if (!UUID.test(value)) throw new TypeError(`${name} must be an opaque UUID`);
  return value;
}
