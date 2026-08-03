import { randomUUID } from 'node:crypto';
import type {
  ActionCommandV1,
  ActionId,
  EventId,
  MessageId,
  PolicyDecisionV1,
  StepId,
  TrajectoryEventKindV1,
  TrajectoryEventV1,
} from '@fara-platform/fara-action-schema';
import type {
  CanonicalSession,
  PendingApproval,
  PendingPolicy,
  SessionEngineEvent,
  SessionEngineOptions,
  StoredOutcome,
  WorkClaim,
} from './types.js';
import { InferenceContractError, SessionEngineError } from './types.js';
import { CompletionVerifier } from './completion-verifier.js';
import {
  actionSignature,
  DEFAULT_ENGINE_BUDGETS,
  detectTerminalReason,
  hasVerifiedEffect,
  observationSignature,
} from './progress.js';

interface TrajectoryReferences {
  stepId?: StepId;
  actionId?: ActionId;
  observationId?: PendingApproval['observationId'];
}

interface TrajectorySpec extends TrajectoryReferences {
  kind: TrajectoryEventKindV1;
  correlationId: MessageId;
  summary: string;
  occurredAt?: string;
}

export class SessionEngine {
  private readonly now: () => string;
  private readonly idGenerator: () => string;
  private readonly budgets;
  private readonly claimantId: string;
  private readonly workClaimTtlMs: number;
  private readonly completionVerifier;
  private readonly recoveringSessions = new Set<string>();
  private readonly requestedRecovery = new Map<string, boolean>();
  private readonly workControllers = new Map<string, {
    sessionId: CanonicalSession['sessionId'];
    controller: AbortController;
  }>();

  constructor(private readonly options: SessionEngineOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.budgets = { ...DEFAULT_ENGINE_BUDGETS, ...options.budgets };
    this.claimantId = options.claimantId ?? randomUUID();
    this.workClaimTtlMs = options.workClaimTtlMs ?? 30_000;
    this.completionVerifier = options.completionVerifier ?? new CompletionVerifier();
  }

  async handle(event: SessionEngineEvent): Promise<StoredOutcome> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.handleOnce(event);
      } catch (error) {
        if (!(error instanceof SessionEngineError) || error.code !== 'STORE_CONFLICT' || attempt === 2) {
          throw error;
        }
      }
    }
    throw new SessionEngineError('STORE_CONFLICT', 'Session update could not be serialized');
  }

  private async handleOnce(event: SessionEngineEvent): Promise<StoredOutcome> {
    const processed = await this.options.store.getProcessed(event.messageId);
    if (event.type === 'session.open') {
      if (processed !== null) return this.returnProcessed(event.sessionId, processed);
      return this.open(event);
    }

    await this.flushTrajectoryOutbox(event.sessionId);
    if (processed !== null) return this.returnProcessed(event.sessionId, processed);

    if (event.type === 'reconcile.request') {
      await this.resumeSession(event.sessionId, false);
      return this.reconcile(event);
    }
    if (event.type === 'task.cancelled') return this.cancel(event);
    if (event.type === 'observation.submitted') {
      await this.resumeSession(event.sessionId, true);
      return this.observe(event);
    }
    if (event.type === 'action.completed') {
      await this.resumeSession(event.sessionId, false);
      return this.completeAction(event);
    }
    return this.resolveApproval(event);
  }

  private async returnProcessed(
    sessionId: CanonicalSession['sessionId'],
    processed: StoredOutcome,
  ): Promise<StoredOutcome> {
    if (processed.kind === 'error' && processed.error !== undefined) {
      throw new SessionEngineError(processed.error.code, processed.error.message);
    }
    await this.resumeSession(sessionId, true);
    return processed;
  }

  private async open(event: Extract<SessionEngineEvent, { type: 'session.open' }>): Promise<StoredOutcome> {
    const existing = await this.options.store.load(event.sessionId);
    if (existing !== null) {
      throw new SessionEngineError('SESSION_ALREADY_EXISTS', `Session ${event.sessionId} already exists`);
    }

    const session: CanonicalSession = {
      sessionId: event.sessionId,
      taskId: event.taskId,
      goal: event.goal,
      completionCriteria: [...event.completionCriteria],
      state: 'OBSERVING',
      revision: 0,
      nextSequence: 1,
      eventSequence: 0,
      trajectoryOutbox: [],
      startedAt: event.occurredAt,
      updatedAt: event.occurredAt,
      lastObservation: null,
      activeInferenceId: null,
      workClaim: null,
      activeAction: null,
      pendingPostObservation: null,
      pendingPolicy: null,
      pendingApproval: null,
      recentResults: [],
      processedMessages: {},
      completedActions: {},
      actionSignatures: [],
      observationSignatures: [],
      consecutiveActionFailures: 0,
      consecutiveNoVerifiedEffect: 0,
      inferenceRepairAttempts: 0,
      stepCount: 0,
      terminalReason: null,
    };
    this.queueTrajectory(session, [{
      kind: 'session_lifecycle',
      correlationId: event.messageId,
      summary: 'Session opened',
      occurredAt: event.occurredAt,
    }]);
    const outcome = this.addOutcome(session, event.messageId, 'accepted');
    await this.options.store.transition(session, 0, outcome);
    await this.resumeSession(event.sessionId, true);
    return outcome;
  }

  private async observe(
    event: Extract<SessionEngineEvent, { type: 'observation.submitted' }>,
  ): Promise<StoredOutcome> {
    const session = await this.requireSession(event.sessionId);
    if (this.isTerminal(session)) {
      throw new SessionEngineError('SESSION_TERMINAL', `Session ${session.sessionId} is terminal`);
    }
    if (!this.canObserve(session)) return this.persistOutcome(session, event.messageId, 'ignored');

    const outcome = await this.acceptObservation(
      session,
      event.messageId,
      event.observation,
      event.occurredAt,
    );
    await this.resumeSession(event.sessionId, true);
    return outcome;
  }

  private async acceptObservation(
    session: CanonicalSession,
    messageId: MessageId,
    observation: NonNullable<CanonicalSession['lastObservation']>,
    occurredAt: string,
  ): Promise<StoredOutcome> {
    const expectedRevision = session.revision;
    session.state = 'PLANNING';
    session.activeInferenceId = `inference:${messageId}`;
    session.workClaim = null;
    session.pendingPostObservation = null;
    session.lastObservation = observation;
    session.observationSignatures.push(observationSignature(observation));
    session.updatedAt = occurredAt;
    const terminalReason = detectTerminalReason(session, this.budgets, occurredAt);
    if (terminalReason !== null) {
      session.state = 'FAILED';
      session.activeInferenceId = null;
      session.workClaim = null;
      session.terminalReason = terminalReason;
    }
    this.queueTrajectory(session, [
      {
        kind: 'observation_captured',
        correlationId: messageId,
        summary: 'Observation accepted',
        observationId: observation.observationId,
        occurredAt,
      },
      terminalReason === null
        ? {
            kind: 'model_request',
            correlationId: messageId,
            summary: 'Planning requested',
            observationId: observation.observationId,
          }
        : {
            kind: 'task_terminal_outcome',
            correlationId: messageId,
            summary: terminalReason.message,
            observationId: observation.observationId,
          },
    ]);
    const outcome = this.addOutcome(
      session,
      messageId,
      terminalReason === null ? 'accepted' : 'terminal',
    );
    await this.options.store.transition(session, expectedRevision, outcome);
    return outcome;
  }

  private async resumeSession(
    sessionId: CanonicalSession['sessionId'],
    deliverCommand: boolean,
  ): Promise<void> {
    if (this.recoveringSessions.has(sessionId)) {
      this.requestedRecovery.set(
        sessionId,
        (this.requestedRecovery.get(sessionId) ?? false) || deliverCommand,
      );
      return;
    }
    this.recoveringSessions.add(sessionId);
    try {
      let shouldDeliver = deliverCommand;
      do {
        this.requestedRecovery.delete(sessionId);
        await this.resumeSessionWork(sessionId, shouldDeliver);
        const requested = this.requestedRecovery.get(sessionId);
        if (requested === undefined) break;
        shouldDeliver ||= requested;
      } while (true);
    } finally {
      this.requestedRecovery.delete(sessionId);
      this.recoveringSessions.delete(sessionId);
    }
  }

  private async resumeSessionWork(
    sessionId: CanonicalSession['sessionId'],
    deliverCommand: boolean,
  ): Promise<void> {
    for (let iteration = 0; iteration < 50; iteration += 1) {
      await this.flushTrajectoryOutbox(sessionId);
      const session = await this.requireSession(sessionId);
      if (session.state === 'PLANNING' && session.activeInferenceId !== null) {
        if (!await this.resumePlanning(session)) return;
        continue;
      }
      if (session.state === 'POLICY_CHECK' && session.pendingPolicy !== null) {
        if (!await this.resumePolicy(session)) return;
        continue;
      }
      if (session.state === 'VERIFYING' && session.pendingPostObservation !== null) {
        await this.resumeVerification(session);
        continue;
      }
      if (session.state === 'EXECUTING' && deliverCommand) {
        await this.deliverPendingCommand(sessionId);
      }
      return;
    }
    throw new SessionEngineError('STORE_CONFLICT', 'Session recovery exceeded its transition limit');
  }

  private async resumePlanning(session: CanonicalSession): Promise<boolean> {
    const inferenceId = session.activeInferenceId;
    const observation = session.lastObservation;
    if (inferenceId === null || observation === null) return false;
    if (!await this.claimWork(session, 'inference', inferenceId)) return false;
    const controller = this.beginWorkController(session.sessionId, inferenceId);
    try {
      const proposal = await this.options.inference.plan({
        workId: inferenceId,
        sessionId: session.sessionId,
        taskId: session.taskId,
        goal: session.goal,
        completionCriteria: session.completionCriteria,
        observation,
        recentResults: session.recentResults,
        trajectory: session.trajectoryOutbox.map((entry) => entry.event).slice(-100),
      }, controller.signal);
      await this.applyProposal(session.sessionId, inferenceId, proposal);
      return true;
    } catch (error) {
      if (controller.signal.aborted) return false;
      if (error instanceof InferenceContractError) {
        await this.applyInferenceContractFailure(session.sessionId, inferenceId, error);
        return true;
      }
      throw error;
    } finally {
      this.endWorkController(inferenceId, controller);
    }
  }

  private async applyInferenceContractFailure(
    sessionId: CanonicalSession['sessionId'],
    inferenceId: string,
    error: InferenceContractError,
  ): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (
      session.activeInferenceId !== inferenceId ||
      session.state !== 'PLANNING' ||
      !this.ownsWorkClaim(session, 'inference', inferenceId)
    ) return;
    const expectedRevision = session.revision;
    const causationMessageId = inferenceId.slice('inference:'.length) as MessageId;
    session.workClaim = null;
    session.inferenceRepairAttempts += 1;
    if (!error.retryable) {
      session.inferenceRepairAttempts = Math.max(
        session.inferenceRepairAttempts,
        this.budgets.maxInferenceRepairAttempts,
      );
    }
    const terminalReason = detectTerminalReason(session, this.budgets, this.now());
    if (terminalReason !== null) {
      session.state = 'FAILED';
      session.activeInferenceId = null;
      session.terminalReason = terminalReason;
      this.abortSessionWork(sessionId, terminalReason.message);
    }
    session.updatedAt = this.now();
    this.queueTrajectory(session, [
      {
        kind: 'model_parse_failure',
        correlationId: causationMessageId,
        summary: error.message,
        observationId: session.lastObservation?.observationId,
      },
      ...(terminalReason === null ? [] : [{
        kind: 'task_terminal_outcome' as const,
        correlationId: causationMessageId,
        summary: terminalReason.message,
        observationId: session.lastObservation?.observationId,
      }]),
    ]);
    session.revision = expectedRevision + 1;
    await this.options.store.transition(session, expectedRevision);
  }

  private async applyProposal(
    sessionId: CanonicalSession['sessionId'],
    inferenceId: string,
    proposal: Awaited<ReturnType<SessionEngineOptions['inference']['plan']>>,
  ): Promise<void> {
    const session = await this.requireSession(sessionId);
    if (
      session.activeInferenceId !== inferenceId ||
      session.state !== 'PLANNING' ||
      !this.ownsWorkClaim(session, 'inference', inferenceId)
    ) return;
    const causationMessageId = inferenceId.slice('inference:'.length) as MessageId;
    const expectedObservationId = session.lastObservation?.observationId;
    if (expectedObservationId === undefined || proposal.observationId !== expectedObservationId) {
      session.workClaim = null;
      await this.persistError(session, causationMessageId, new SessionEngineError(
        'STALE_PROPOSAL',
        'Model proposal does not match the persisted planning observation',
      ));
    }

    const expectedRevision = session.revision;
    session.activeInferenceId = null;
    session.workClaim = null;
    session.inferenceRepairAttempts = 0;
    if (proposal.kind === 'completion') {
      const verification = this.completionVerifier.verify(
        proposal,
        session.trajectoryOutbox.map((entry) => entry.event),
      );
      session.state = verification.outcome === 'accepted'
        ? 'COMPLETED'
        : verification.outcome === 'failed' ? 'FAILED' : 'OBSERVING';
      session.terminalReason = verification.outcome === 'continue' ? null : {
        code: 'MODEL_COMPLETION',
        message: proposal.summary,
        detectedAt: this.now(),
      };
      session.updatedAt = this.now();
      this.queueTrajectory(session, [
        {
          kind: 'model_response',
          correlationId: causationMessageId,
          summary: proposal.summary,
          observationId: proposal.observationId,
        },
        {
          kind: 'verification_result',
          correlationId: causationMessageId,
          summary: `${verification.code}: ${verification.reason}`,
          observationId: proposal.observationId,
        },
        ...(verification.outcome === 'continue' ? [] : [{
          kind: 'task_terminal_outcome' as const,
          correlationId: causationMessageId,
          summary: proposal.summary,
          observationId: proposal.observationId,
        }]),
      ]);
      if (verification.outcome !== 'continue') this.abortSessionWork(sessionId, verification.reason);
      session.revision = expectedRevision + 1;
      await this.options.store.transition(session, expectedRevision);
      return;
    }

    const actionId = this.idGenerator() as ActionId;
    const stepId = this.idGenerator() as StepId;
    const policyDecisionId = this.idGenerator() as PolicyDecisionV1['policyDecisionId'];
    const pending: PendingPolicy = {
      causationMessageId,
      actionId,
      stepId,
      observationId: proposal.observationId,
      policyDecisionId,
      proposal,
    };
    session.state = 'POLICY_CHECK';
    session.pendingPolicy = pending;
    session.updatedAt = this.now();
    const references = this.pendingReferences(pending);
    this.queueTrajectory(session, [
      {
        kind: 'model_response',
        correlationId: causationMessageId,
        summary: 'Action proposal received',
        ...references,
      },
      {
        kind: 'action_proposed',
        correlationId: causationMessageId,
        summary: proposal.action.type,
        ...references,
      },
    ]);
    session.revision = expectedRevision + 1;
    await this.options.store.transition(session, expectedRevision);
  }

  private async resumePolicy(session: CanonicalSession): Promise<boolean> {
    const pending = session.pendingPolicy;
    if (pending === null) return false;
    if (!await this.claimWork(session, 'policy', pending.policyDecisionId)) return false;
    const controller = this.beginWorkController(session.sessionId, pending.policyDecisionId);
    try {
      const decision = await this.options.policy.evaluate({
        workId: pending.policyDecisionId,
        sessionId: session.sessionId,
        taskId: session.taskId,
        actionId: pending.actionId,
        policyDecisionId: pending.policyDecisionId,
        proposal: pending.proposal,
        observation: session.lastObservation!,
      }, controller.signal);
      await this.applyPolicyDecision(session.sessionId, pending, decision);
      return true;
    } catch (error) {
      if (controller.signal.aborted) return false;
      throw error;
    } finally {
      this.endWorkController(pending.policyDecisionId, controller);
    }
  }

  private async applyPolicyDecision(
    sessionId: CanonicalSession['sessionId'],
    expected: PendingPolicy,
    decision: PolicyDecisionV1,
  ): Promise<void> {
    const session = await this.requireSession(sessionId);
    const pending = session.pendingPolicy;
    if (
      session.state !== 'POLICY_CHECK' ||
      pending === null ||
      !this.samePendingPolicy(pending, expected) ||
      !this.ownsWorkClaim(session, 'policy', pending.policyDecisionId)
    ) return;
    if (
      decision.policyDecisionId !== pending.policyDecisionId ||
      decision.actionId !== pending.actionId ||
      decision.observationId !== pending.observationId
    ) {
      session.workClaim = null;
      await this.persistError(session, pending.causationMessageId, new SessionEngineError(
        'STALE_POLICY_DECISION',
        'Policy decision does not match the persisted policy request',
      ));
    }

    session.workClaim = null;
    const references = this.pendingReferences(pending);
    if (decision.decision === 'denied') {
      const expectedRevision = session.revision;
      const reason = {
        code: 'POLICY_DENIED' as const,
        message: 'Server policy denied the proposed action',
        detectedAt: this.now(),
      };
      session.state = 'FAILED';
      session.pendingPolicy = null;
      session.terminalReason = reason;
      session.updatedAt = reason.detectedAt;
      this.abortSessionWork(sessionId, reason.message);
      this.queueTrajectory(session, [
        {
          kind: 'policy_decided',
          correlationId: pending.causationMessageId,
          summary: decision.decision,
          ...references,
        },
        {
          kind: 'task_terminal_outcome',
          correlationId: pending.causationMessageId,
          summary: reason.message,
          ...references,
        },
      ]);
      session.revision = expectedRevision + 1;
      await this.options.store.transition(session, expectedRevision);
      return;
    }

    if (decision.decision === 'approval_required') {
      const expectedRevision = session.revision;
      session.state = 'WAITING_FOR_APPROVAL';
      session.pendingPolicy = null;
      session.pendingApproval = {
        actionId: pending.actionId,
        stepId: pending.stepId,
        observationId: pending.observationId,
        proposal: pending.proposal,
        policyDecision: decision,
      };
      session.updatedAt = this.now();
      this.queueTrajectory(session, [
        {
          kind: 'policy_decided',
          correlationId: pending.causationMessageId,
          summary: decision.decision,
          ...references,
        },
        {
          kind: 'approval_requested',
          correlationId: pending.causationMessageId,
          summary: 'Approval required',
          ...references,
        },
      ]);
      session.revision = expectedRevision + 1;
      await this.options.store.transition(session, expectedRevision);
      return;
    }

    await this.persistDispatch(session, {
      actionId: pending.actionId,
      stepId: pending.stepId,
      observationId: pending.observationId,
      proposal: pending.proposal,
      policyDecision: decision,
    }, pending.causationMessageId, [{
      kind: 'policy_decided',
      correlationId: pending.causationMessageId,
      summary: decision.decision,
      ...references,
    }]);
  }

  private async persistDispatch(
    session: CanonicalSession,
    pending: PendingApproval,
    causationMessageId: MessageId,
    precedingEvents: TrajectorySpec[],
    approval?: Extract<SessionEngineEvent, { type: 'approval.resolved' }>['resolution'],
  ): Promise<StoredOutcome | null> {
    const expectedRevision = session.revision;
    const now = this.timestampAfter(approval?.resolvedAt ?? pending.policyDecision.decidedAt);
    const references = this.pendingReferences(pending);
    const command: ActionCommandV1 = {
      actionId: pending.actionId,
      stepId: pending.stepId,
      observationId: pending.observationId,
      sequence: session.nextSequence,
      action: pending.proposal.action,
      policyContext: {
        policyDecisionId: pending.policyDecision.policyDecisionId,
        policyVersion: 'v1',
        approved: true,
        ...(approval === undefined ? {} : { approvalId: approval.approvalId }),
      },
      dispatchedAt: now,
      expiresAt: new Date(Date.parse(now) + 60_000).toISOString(),
      idempotencyKey: `${session.sessionId}:${pending.actionId}`,
    };
    session.actionSignatures.push(actionSignature(pending.proposal.action));
    const terminalReason = detectTerminalReason(session, this.budgets, now);
    if (terminalReason !== null) {
      session.state = 'FAILED';
      session.pendingPolicy = null;
      session.pendingApproval = null;
      session.terminalReason = terminalReason;
      session.updatedAt = now;
      this.queueTrajectory(session, [
        ...precedingEvents,
        {
          kind: 'task_terminal_outcome',
          correlationId: causationMessageId,
          summary: terminalReason.message,
          ...references,
        },
      ]);
      const outcome = approval === undefined
        ? null
        : this.addOutcome(session, causationMessageId, 'terminal');
      if (outcome === null) session.revision = expectedRevision + 1;
      await this.options.store.transition(session, expectedRevision, outcome ?? undefined);
      return outcome;
    }

    session.state = 'EXECUTING';
    session.nextSequence += 1;
    session.stepCount += 1;
    session.activeAction = {
      ...pending,
      command,
      delivery: {
        status: 'pending',
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
      },
    };
    session.pendingPolicy = null;
    session.pendingApproval = null;
    session.updatedAt = now;
    this.queueTrajectory(session, [
      ...precedingEvents,
      {
        kind: 'action_acknowledged',
        correlationId: causationMessageId,
        summary: 'Action command persisted for dispatch',
        ...references,
      },
    ]);
    const outcome = approval === undefined
      ? null
      : this.addOutcome(session, causationMessageId, 'accepted');
    if (outcome === null) session.revision = expectedRevision + 1;
    await this.options.store.transition(session, expectedRevision, outcome ?? undefined);
    return outcome;
  }

  private async deliverPendingCommand(sessionId: CanonicalSession['sessionId']): Promise<void> {
    let session = await this.requireSession(sessionId);
    const active = session.activeAction;
    if (active === null || active.delivery.status !== 'pending' || this.isTerminal(session)) return;

    const expectedRevision = session.revision;
    active.delivery.attempts += 1;
    active.delivery.lastAttemptAt = this.now();
    active.delivery.lastError = null;
    session.updatedAt = this.now();
    session.revision = expectedRevision + 1;
    await this.options.store.transition(session, expectedRevision);

    try {
      await this.options.commandSink.send(active.command);
    } catch (error) {
      session = await this.requireSession(sessionId);
      if (session.activeAction?.actionId === active.actionId && session.activeAction.delivery.status === 'pending') {
        const failureRevision = session.revision;
        session.activeAction.delivery.lastError = error instanceof Error ? error.message : String(error);
        session.updatedAt = this.now();
        session.revision = failureRevision + 1;
        await this.options.store.transition(session, failureRevision);
      }
      throw error;
    }

    session = await this.requireSession(sessionId);
    if (session.activeAction?.actionId !== active.actionId || session.activeAction.delivery.status !== 'pending') return;
    const sentRevision = session.revision;
    session.activeAction.delivery.status = 'sent';
    session.activeAction.delivery.lastError = null;
    session.updatedAt = this.now();
    session.revision = sentRevision + 1;
    await this.options.store.transition(session, sentRevision);
  }

  private async resolveApproval(
    event: Extract<SessionEngineEvent, { type: 'approval.resolved' }>,
  ): Promise<StoredOutcome> {
    const session = await this.requireSession(event.sessionId);
    const pending = session.pendingApproval;
    if (
      session.state !== 'WAITING_FOR_APPROVAL' ||
      pending === null ||
      pending.actionId !== event.resolution.actionId ||
      pending.policyDecision.policyDecisionId !== event.resolution.policyDecisionId
    ) {
      return this.persistError(
        session,
        event.messageId,
        new SessionEngineError('STALE_APPROVAL_RESOLUTION', 'Approval does not match the pending action'),
      );
    }
    const references = this.pendingReferences(pending);

    if (event.resolution.status === 'denied') {
      const expectedRevision = session.revision;
      session.state = 'FAILED';
      session.pendingApproval = null;
      session.terminalReason = {
        code: 'POLICY_DENIED',
        message: 'User denied the requested approval',
        detectedAt: event.occurredAt,
      };
      session.updatedAt = event.occurredAt;
      this.queueTrajectory(session, [
        {
          kind: 'approval_resolved',
          correlationId: event.messageId,
          summary: 'Approval denied',
          ...references,
        },
        {
          kind: 'task_terminal_outcome',
          correlationId: event.messageId,
          summary: 'Approval denied',
          ...references,
        },
      ]);
      const outcome = this.addOutcome(session, event.messageId, 'terminal');
      await this.options.store.transition(session, expectedRevision, outcome);
      await this.resumeSession(event.sessionId, true);
      return outcome;
    }

    const outcome = await this.persistDispatch(session, pending, event.messageId, [{
      kind: 'approval_resolved',
      correlationId: event.messageId,
      summary: 'Approval granted',
      ...references,
    }], event.resolution);
    if (outcome === null) {
      throw new SessionEngineError('STORE_CONFLICT', 'Approval outcome was not persisted with its command');
    }
    await this.resumeSession(event.sessionId, true);
    return outcome;
  }

  private async completeAction(
    event: Extract<SessionEngineEvent, { type: 'action.completed' }>,
  ): Promise<StoredOutcome> {
    const session = await this.requireSession(event.sessionId);
    const completed = session.completedActions[event.result.actionId];
    if (completed !== undefined) {
      if (!this.sameJson(completed.result, event.result)) {
        return this.persistError(session, event.messageId, new SessionEngineError(
          'STALE_ACTION_RESULT',
          'Duplicate action result does not match the authoritative completed result',
        ));
      }
      return this.persistOutcome(session, event.messageId, 'ignored');
    }
    const active = session.activeAction;
    if (
      active === null ||
      active.actionId !== event.result.actionId ||
      active.stepId !== event.result.stepId ||
      active.observationId !== event.result.observationId ||
      event.result.sequence !== active.command.sequence + 1
    ) {
      return this.persistError(session, event.messageId, new SessionEngineError(
        'STALE_ACTION_RESULT',
        'Action result does not match the active command tuple and sequence',
      ));
    }

    const references = this.pendingReferences(active);
    const expectedRevision = session.revision;
    session.activeAction = null;
    session.recentResults = [...session.recentResults.slice(-19), event.result];
    const failed = event.result.status !== 'succeeded';
    session.consecutiveActionFailures = failed ? session.consecutiveActionFailures + 1 : 0;
    session.consecutiveNoVerifiedEffect = hasVerifiedEffect(session.lastObservation!, event.result)
      ? 0
      : session.consecutiveNoVerifiedEffect + 1;
    session.updatedAt = event.occurredAt;
    const terminalReason = event.result.status === 'failed_terminal'
      ? {
          code: 'ACTION_FAILED_TERMINAL' as const,
          message: event.result.error.message,
          detectedAt: event.occurredAt,
        }
      : detectTerminalReason(session, this.budgets, event.occurredAt);
    if (terminalReason !== null) {
      session.state = 'FAILED';
      session.terminalReason = terminalReason;
      session.pendingPostObservation = null;
    } else if ('postObservation' in event.result) {
      session.state = 'VERIFYING';
      session.pendingPostObservation = {
        messageId: randomUUID() as MessageId,
        observation: event.result.postObservation,
      };
    } else {
      session.state = 'OBSERVING';
      session.pendingPostObservation = null;
    }
    this.queueTrajectory(session, [
      {
        kind: 'action_completed',
        correlationId: event.messageId,
        summary: event.result.status,
        ...references,
      },
      ...(terminalReason === null ? [] : [{
        kind: 'task_terminal_outcome' as const,
        correlationId: event.messageId,
        summary: terminalReason.message,
        ...references,
      }]),
    ]);
    const outcome = this.addOutcome(
      session,
      event.messageId,
      terminalReason === null ? 'accepted' : 'terminal',
    );
    session.completedActions[event.result.actionId] = { result: event.result, outcome };
    await this.options.store.transition(session, expectedRevision, outcome);
    await this.resumeSession(event.sessionId, true);
    return outcome;
  }

  private async resumeVerification(session: CanonicalSession): Promise<void> {
    const pending = session.pendingPostObservation;
    if (pending === null) return;
    await this.acceptObservation(
      session,
      pending.messageId,
      pending.observation,
      pending.observation.capturedAt,
    );
  }

  private async reconcile(
    event: Extract<SessionEngineEvent, { type: 'reconcile.request' }>,
  ): Promise<StoredOutcome> {
    const session = await this.requireSession(event.sessionId);
    const expectedRevision = session.revision;
    const active = session.activeAction;
    const authoritative = active === null ? [] : [active.actionId];
    const requiresFreshObservation = event.pendingActionIds.some((id) => !authoritative.includes(id));
    if (active !== null) {
      const clientHasCommand = event.pendingActionIds.includes(active.actionId) ||
        event.lastReceivedSequence >= active.command.sequence;
      active.delivery.status = clientHasCommand ? 'sent' : 'pending';
      active.delivery.lastError = null;
    }
    const outcome = this.addOutcome(session, event.messageId, 'reconciled', undefined, requiresFreshObservation);
    await this.options.store.transition(session, expectedRevision, outcome);
    await this.resumeSession(event.sessionId, true);
    return outcome;
  }

  private async cancel(
    event: Extract<SessionEngineEvent, { type: 'task.cancelled' }>,
  ): Promise<StoredOutcome> {
    const session = await this.requireSession(event.sessionId);
    if (this.isTerminal(session)) return this.persistOutcome(session, event.messageId, 'ignored');
    this.abortSessionWork(event.sessionId, event.reason);
    const references = session.activeAction === null
      ? session.pendingApproval === null
        ? session.pendingPolicy === null ? {} : this.pendingReferences(session.pendingPolicy)
        : this.pendingReferences(session.pendingApproval)
      : this.pendingReferences(session.activeAction);
    const expectedRevision = session.revision;
    session.state = 'CANCELLED';
    session.activeInferenceId = null;
    session.workClaim = null;
    session.activeAction = null;
    session.pendingPostObservation = null;
    session.pendingPolicy = null;
    session.pendingApproval = null;
    session.terminalReason = {
      code: 'SESSION_CANCELLED',
      message: event.reason,
      detectedAt: event.occurredAt,
    };
    session.updatedAt = event.occurredAt;
    this.queueTrajectory(session, [{
      kind: 'task_terminal_outcome',
      correlationId: event.messageId,
      summary: event.reason,
      ...references,
    }]);
    const outcome = this.addOutcome(session, event.messageId, 'terminal');
    await this.options.store.transition(session, expectedRevision, outcome);
    await this.resumeSession(event.sessionId, true);
    return outcome;
  }

  private async flushTrajectoryOutbox(sessionId: CanonicalSession['sessionId']): Promise<void> {
    for (;;) {
      let session = await this.requireSession(sessionId);
      const entry = session.trajectoryOutbox.find((candidate) => candidate.status === 'pending');
      if (entry === undefined) return;
      const eventId = entry.event.eventId;

      try {
        await this.options.trajectorySink.append(entry.event);
      } catch (error) {
        await this.recordTrajectoryError(sessionId, eventId, error);
        throw error;
      }

      session = await this.requireSession(sessionId);
      const delivered = session.trajectoryOutbox.find((candidate) => candidate.event.eventId === eventId);
      if (delivered === undefined || delivered.status === 'sent') continue;
      const deliveredRevision = session.revision;
      delivered.status = 'sent';
      delivered.attempts += 1;
      delivered.lastAttemptAt = this.now();
      delivered.lastError = null;
      session.revision = deliveredRevision + 1;
      try {
        await this.options.store.transition(session, deliveredRevision);
      } catch (error) {
        if (error instanceof SessionEngineError && error.code === 'STORE_CONFLICT') continue;
        throw error;
      }
    }
  }

  private async recordTrajectoryError(
    sessionId: CanonicalSession['sessionId'],
    eventId: EventId,
    error: unknown,
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const session = await this.requireSession(sessionId);
      const entry = session.trajectoryOutbox.find((candidate) => candidate.event.eventId === eventId);
      if (entry === undefined || entry.status === 'sent') return;
      const expectedRevision = session.revision;
      entry.attempts += 1;
      entry.lastAttemptAt = this.now();
      entry.lastError = error instanceof Error ? error.message : String(error);
      session.revision = expectedRevision + 1;
      try {
        await this.options.store.transition(session, expectedRevision);
        return;
      } catch (transitionError) {
        if (!(transitionError instanceof SessionEngineError) || transitionError.code !== 'STORE_CONFLICT') {
          throw transitionError;
        }
      }
    }
  }

  private queueTrajectory(session: CanonicalSession, specs: TrajectorySpec[]): void {
    for (const spec of specs) {
      const { actionId, correlationId, kind, observationId, occurredAt, stepId, summary } = spec;
      const event: TrajectoryEventV1 = {
        eventId: randomUUID() as EventId,
        sessionId: session.sessionId,
        taskId: session.taskId,
        ...(stepId === undefined ? {} : { stepId }),
        ...(actionId === undefined ? {} : { actionId }),
        ...(observationId === undefined ? {} : { observationId }),
        correlationId,
        sequence: session.eventSequence,
        occurredAt: occurredAt ?? this.now(),
        kind,
        summary,
      };
      session.eventSequence += 1;
      session.trajectoryOutbox.push({
        event,
        status: 'pending',
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
      });
    }
  }

  private async persistError(
    session: CanonicalSession,
    messageId: MessageId,
    error: SessionEngineError,
  ): Promise<never> {
    const expectedRevision = session.revision;
    const outcome = this.addOutcome(session, messageId, 'error', error);
    await this.options.store.transition(session, expectedRevision, outcome);
    throw error;
  }

  private async persistOutcome(
    session: CanonicalSession,
    messageId: MessageId,
    kind: StoredOutcome['kind'],
  ): Promise<StoredOutcome> {
    const expectedRevision = session.revision;
    const outcome = this.addOutcome(session, messageId, kind);
    await this.options.store.transition(session, expectedRevision, outcome);
    return outcome;
  }

  private addOutcome(
    session: CanonicalSession,
    messageId: MessageId,
    kind: StoredOutcome['kind'],
    error?: SessionEngineError,
    requiresFreshObservation = false,
  ): StoredOutcome {
    session.revision += 1;
    const outcome = this.outcome(
      messageId,
      session.sessionId,
      session.revision,
      session.state,
      kind,
      session.activeAction === null ? [] : [session.activeAction.actionId],
      error,
      requiresFreshObservation,
    );
    if (session.terminalReason !== null) outcome.terminalReason = session.terminalReason;
    session.processedMessages[messageId] = outcome;
    return outcome;
  }

  private outcome(
    messageId: MessageId,
    sessionId: CanonicalSession['sessionId'],
    revision: number,
    state: CanonicalSession['state'],
    kind: StoredOutcome['kind'],
    pendingActionIds: ActionId[],
    error?: SessionEngineError,
    requiresFreshObservation = false,
  ): StoredOutcome {
    return {
      kind,
      sessionId,
      messageId,
      revision,
      state,
      pendingActionIds,
      ...(requiresFreshObservation ? { requiresFreshObservation: true } : {}),
      ...(error === undefined ? {} : { error: { code: error.code, message: error.message } }),
    };
  }

  private async requireSession(sessionId: CanonicalSession['sessionId']): Promise<CanonicalSession> {
    const session = await this.options.store.load(sessionId);
    if (session === null) {
      throw new SessionEngineError('SESSION_NOT_FOUND', `Session ${sessionId} was not found`);
    }
    return session;
  }

  private async claimWork(
    session: CanonicalSession,
    kind: WorkClaim['kind'],
    workId: string,
  ): Promise<boolean> {
    const now = this.now();
    if (session.workClaim !== null && Date.parse(session.workClaim.leaseExpiresAt) > Date.parse(now)) {
      return false;
    }
    const expectedRevision = session.revision;
    session.workClaim = {
      kind,
      workId,
      claimantId: this.claimantId,
      leaseExpiresAt: new Date(Date.parse(now) + this.workClaimTtlMs).toISOString(),
    };
    session.updatedAt = now;
    session.revision = expectedRevision + 1;
    try {
      await this.options.store.compareAndSwap(session, expectedRevision);
      this.abortSupersededLocalWork(session.sessionId, workId);
      return true;
    } catch (error) {
      if (error instanceof SessionEngineError && error.code === 'STORE_CONFLICT') return false;
      throw error;
    }
  }

  private ownsWorkClaim(
    session: CanonicalSession,
    kind: WorkClaim['kind'],
    workId: string,
  ): boolean {
    return session.workClaim?.kind === kind &&
      session.workClaim.workId === workId &&
      session.workClaim.claimantId === this.claimantId;
  }

  private beginWorkController(
    sessionId: CanonicalSession['sessionId'],
    workId: string,
  ): AbortController {
    this.abortSupersededLocalWork(sessionId, workId);
    const existing = this.workControllers.get(workId);
    existing?.controller.abort(new DOMException('Work claim superseded', 'AbortError'));
    const controller = new AbortController();
    this.workControllers.set(workId, { sessionId, controller });
    return controller;
  }

  private endWorkController(workId: string, controller: AbortController): void {
    if (this.workControllers.get(workId)?.controller === controller) {
      this.workControllers.delete(workId);
    }
  }

  private abortSupersededLocalWork(
    sessionId: CanonicalSession['sessionId'],
    currentWorkId: string,
  ): void {
    for (const [workId, active] of this.workControllers) {
      if (active.sessionId === sessionId && workId !== currentWorkId) {
        active.controller.abort(new DOMException('Work claim superseded', 'AbortError'));
        this.workControllers.delete(workId);
      }
    }
  }

  private abortSessionWork(sessionId: CanonicalSession['sessionId'], reason: string): void {
    for (const [workId, active] of this.workControllers) {
      if (active.sessionId === sessionId) {
        active.controller.abort(new DOMException(reason, 'AbortError'));
        this.workControllers.delete(workId);
      }
    }
  }

  private canObserve(session: CanonicalSession): boolean {
    return session.activeInferenceId === null &&
      session.activeAction === null &&
      session.pendingPolicy === null &&
      session.pendingApproval === null &&
      (session.state === 'OBSERVING' || session.state === 'VERIFYING');
  }

  private isTerminal(session: CanonicalSession): boolean {
    return session.state === 'COMPLETED' || session.state === 'FAILED' || session.state === 'CANCELLED';
  }

  private timestampAfter(timestamp?: string): string {
    const now = this.now();
    if (timestamp === undefined || Date.parse(now) > Date.parse(timestamp)) return now;
    return new Date(Date.parse(timestamp) + 1).toISOString();
  }

  private pendingReferences(pending: Pick<PendingApproval, 'stepId' | 'actionId' | 'observationId'>): TrajectoryReferences {
    return {
      stepId: pending.stepId,
      actionId: pending.actionId,
      observationId: pending.observationId,
    };
  }

  private samePendingPolicy(left: PendingPolicy, right: PendingPolicy): boolean {
    return left.causationMessageId === right.causationMessageId &&
      left.actionId === right.actionId &&
      left.stepId === right.stepId &&
      left.observationId === right.observationId &&
      left.policyDecisionId === right.policyDecisionId &&
      this.sameJson(left.proposal, right.proposal);
  }

  private sameJson(left: unknown, right: unknown): boolean {
    return JSON.stringify(this.normalizeJson(left)) === JSON.stringify(this.normalizeJson(right));
  }

  private normalizeJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((nested) => this.normalizeJson(nested));
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
          .map(([key, nested]) => [key, this.normalizeJson(nested)]),
      );
    }
    return value;
  }
}
