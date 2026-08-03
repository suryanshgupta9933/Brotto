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
} from './types.js';
import { SessionEngineError } from './types.js';
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

export class SessionEngine {
  private readonly now: () => string;
  private readonly idGenerator: () => string;
  private readonly budgets;

  constructor(private readonly options: SessionEngineOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.budgets = { ...DEFAULT_ENGINE_BUDGETS, ...options.budgets };
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
    if (processed !== null) {
      if (processed.kind === 'error' && processed.error !== undefined) {
        throw new SessionEngineError(processed.error.code, processed.error.message);
      }
      await this.deliverPendingCommand(event.sessionId);
      return processed;
    }

    switch (event.type) {
      case 'session.open':
        return this.open(event);
      case 'observation.submitted':
        return this.observe(event);
      case 'action.completed':
        return this.completeAction(event);
      case 'approval.resolved':
        return this.resolveApproval(event);
      case 'reconcile.request':
        return this.reconcile(event);
      case 'task.cancelled':
        return this.cancel(event);
    }
  }

  private async open(event: Extract<SessionEngineEvent, { type: 'session.open' }>): Promise<StoredOutcome> {
    const existing = await this.options.store.load(event.sessionId);
    if (existing !== null) {
      throw new SessionEngineError('SESSION_ALREADY_EXISTS', `Session ${event.sessionId} already exists`);
    }

    const outcome = this.outcome(event.messageId, event.sessionId, 1, 'OBSERVING', 'accepted', []);
    const session: CanonicalSession = {
      sessionId: event.sessionId,
      taskId: event.taskId,
      goal: event.goal,
      completionCriteria: [...event.completionCriteria],
      state: 'OBSERVING',
      revision: 1,
      nextSequence: 0,
      eventSequence: 0,
      startedAt: event.occurredAt,
      updatedAt: event.occurredAt,
      lastObservation: null,
      activeInferenceId: null,
      activeAction: null,
      pendingPolicy: null,
      pendingApproval: null,
      recentResults: [],
      processedMessages: { [event.messageId]: outcome },
      completedActions: {},
      actionSignatures: [],
      observationSignatures: [],
      consecutiveActionFailures: 0,
      consecutiveNoVerifiedEffect: 0,
      inferenceRepairAttempts: 0,
      stepCount: 0,
      terminalReason: null,
    };
    await this.options.store.transition(session, 0, outcome);
    await this.emit(event.sessionId, 'session_lifecycle', event.messageId, 'Session opened');
    return outcome;
  }

  private async observe(
    event: Extract<SessionEngineEvent, { type: 'observation.submitted' }>,
  ): Promise<StoredOutcome> {
    const session = await this.requireSession(event.sessionId);
    if (this.isTerminal(session)) {
      throw new SessionEngineError('SESSION_TERMINAL', `Session ${session.sessionId} is terminal`);
    }
    if (
      session.activeInferenceId !== null ||
      session.activeAction !== null ||
      session.pendingPolicy !== null ||
      session.pendingApproval !== null ||
      (session.state !== 'OBSERVING' && session.state !== 'VERIFYING')
    ) {
      return this.persistOutcome(session, event.messageId, 'ignored');
    }

    const expectedRevision = session.revision;
    const inferenceId = `inference:${event.messageId}`;
    session.state = 'PLANNING';
    session.activeInferenceId = inferenceId;
    session.lastObservation = event.observation;
    session.observationSignatures.push(observationSignature(event.observation));
    session.updatedAt = event.occurredAt;
    const terminalReason = detectTerminalReason(session, this.budgets, event.occurredAt);
    if (terminalReason !== null) {
      session.state = 'FAILED';
      session.activeInferenceId = null;
      session.terminalReason = terminalReason;
    }
    const accepted = this.addOutcome(
      session,
      event.messageId,
      terminalReason === null ? 'accepted' : 'terminal',
    );
    await this.options.store.transition(session, expectedRevision, accepted);
    await this.emit(event.sessionId, 'observation_captured', event.messageId, 'Observation accepted', {
      observationId: event.observation.observationId,
    });
    if (terminalReason !== null) {
      await this.emit(event.sessionId, 'task_terminal_outcome', event.messageId, terminalReason.message, {
        observationId: event.observation.observationId,
      });
      return accepted;
    }
    await this.emit(event.sessionId, 'model_request', event.messageId, 'Planning requested', {
      observationId: event.observation.observationId,
    });

    const proposal = await this.options.inference.plan({
      sessionId: session.sessionId,
      taskId: session.taskId,
      goal: session.goal,
      completionCriteria: session.completionCriteria,
      observation: event.observation,
      recentResults: session.recentResults,
    });
    await this.applyProposal(session.sessionId, inferenceId, proposal, event.messageId);
    return accepted;
  }

  private async applyProposal(
    sessionId: CanonicalSession['sessionId'],
    inferenceId: string,
    proposal: Awaited<ReturnType<SessionEngineOptions['inference']['plan']>>,
    causationMessageId: MessageId,
  ): Promise<void> {
    let session = await this.requireSession(sessionId);
    if (session.activeInferenceId !== inferenceId || session.state !== 'PLANNING') return;
    const expectedObservationId = session.lastObservation?.observationId;
    if (expectedObservationId === undefined || proposal.observationId !== expectedObservationId) {
      await this.persistError(session, causationMessageId, new SessionEngineError(
        'STALE_PROPOSAL',
        'Model proposal does not match the persisted planning observation',
      ));
    }

    if (proposal.kind === 'completion') {
      const expectedRevision = session.revision;
      session.activeInferenceId = null;
      session.state = proposal.status === 'succeeded' ? 'COMPLETED' : 'FAILED';
      session.terminalReason = {
        code: 'MODEL_COMPLETION',
        message: proposal.summary,
        detectedAt: this.now(),
      };
      session.updatedAt = this.now();
      session.revision = expectedRevision + 1;
      await this.options.store.transition(session, expectedRevision);
      await this.emit(sessionId, 'model_response', causationMessageId, proposal.summary, {
        observationId: proposal.observationId,
      });
      await this.emit(sessionId, 'task_terminal_outcome', causationMessageId, proposal.summary, {
        observationId: proposal.observationId,
      });
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
    const expectedRevision = session.revision;
    session.activeInferenceId = null;
    session.state = 'POLICY_CHECK';
    session.pendingPolicy = pending;
    session.updatedAt = this.now();
    session.revision = expectedRevision + 1;
    await this.options.store.transition(session, expectedRevision);
    const references = this.pendingReferences(pending);
    await this.emit(sessionId, 'model_response', causationMessageId, 'Action proposal received', references);
    await this.emit(sessionId, 'action_proposed', causationMessageId, proposal.action.type, references);

    const decision = await this.options.policy.evaluate({
      sessionId: session.sessionId,
      taskId: session.taskId,
      actionId,
      policyDecisionId,
      proposal,
    });
    await this.applyPolicyDecision(sessionId, pending, decision);
  }

  private async applyPolicyDecision(
    sessionId: CanonicalSession['sessionId'],
    expected: PendingPolicy,
    decision: PolicyDecisionV1,
  ): Promise<void> {
    let session = await this.requireSession(sessionId);
    const pending = session.pendingPolicy;
    if (session.state !== 'POLICY_CHECK' || pending === null || !this.samePendingPolicy(pending, expected)) return;
    if (
      decision.policyDecisionId !== pending.policyDecisionId ||
      decision.actionId !== pending.actionId ||
      decision.observationId !== pending.observationId
    ) {
      await this.persistError(session, pending.causationMessageId, new SessionEngineError(
        'STALE_POLICY_DECISION',
        'Policy decision does not match the persisted policy request',
      ));
    }

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
      session.revision = expectedRevision + 1;
      await this.options.store.transition(session, expectedRevision);
      await this.emit(sessionId, 'policy_decided', pending.causationMessageId, decision.decision, references);
      await this.emit(sessionId, 'task_terminal_outcome', pending.causationMessageId, reason.message, references);
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
      session.revision = expectedRevision + 1;
      await this.options.store.transition(session, expectedRevision);
      await this.emit(sessionId, 'policy_decided', pending.causationMessageId, decision.decision, references);
      await this.emit(sessionId, 'approval_requested', pending.causationMessageId, 'Approval required', references);
      return;
    }

    await this.emit(sessionId, 'policy_decided', pending.causationMessageId, decision.decision, references);
    session = await this.requireSession(sessionId);
    if (session.state !== 'POLICY_CHECK' || session.pendingPolicy === null ||
      !this.samePendingPolicy(session.pendingPolicy, pending)) return;
    await this.persistDispatch(session, {
      actionId: pending.actionId,
      stepId: pending.stepId,
      observationId: pending.observationId,
      proposal: pending.proposal,
      policyDecision: decision,
    }, pending.causationMessageId);
  }

  private async persistDispatch(
    session: CanonicalSession,
    pending: PendingApproval,
    causationMessageId: MessageId,
    approval?: Extract<SessionEngineEvent, { type: 'approval.resolved' }>['resolution'],
  ): Promise<StoredOutcome | null> {
    const expectedRevision = session.revision;
    const now = this.timestampAfter(approval?.resolvedAt ?? pending.policyDecision.decidedAt);
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
      const outcome = approval === undefined
        ? null
        : this.addOutcome(session, causationMessageId, 'terminal');
      if (outcome === null) session.revision = expectedRevision + 1;
      await this.options.store.transition(session, expectedRevision, outcome ?? undefined);
      await this.emit(session.sessionId, 'task_terminal_outcome', causationMessageId, terminalReason.message,
        this.pendingReferences(pending));
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
    const outcome = approval === undefined
      ? null
      : this.addOutcome(session, causationMessageId, 'accepted');
    if (outcome === null) session.revision = expectedRevision + 1;
    await this.options.store.transition(session, expectedRevision, outcome ?? undefined);
    await this.emit(session.sessionId, 'action_acknowledged', causationMessageId,
      'Action command persisted for dispatch', this.pendingReferences(pending));
    await this.deliverPendingCommand(session.sessionId);
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
      const outcome = this.addOutcome(session, event.messageId, 'terminal');
      await this.options.store.transition(session, expectedRevision, outcome);
      await this.emit(session.sessionId, 'approval_resolved', event.messageId, 'Approval denied', references);
      await this.emit(session.sessionId, 'task_terminal_outcome', event.messageId, 'Approval denied', references);
      return outcome;
    }

    const outcome = await this.persistDispatch(session, pending, event.messageId, event.resolution);
    if (outcome === null) {
      throw new SessionEngineError('STORE_CONFLICT', 'Approval outcome was not persisted with its command');
    }
    await this.emit(session.sessionId, 'approval_resolved', event.messageId, 'Approval granted', references);
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
    session.state = 'VERIFYING';
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
    }
    const outcome = this.addOutcome(
      session,
      event.messageId,
      terminalReason === null ? 'accepted' : 'terminal',
    );
    session.completedActions[event.result.actionId] = { result: event.result, outcome };
    await this.options.store.transition(session, expectedRevision, outcome);
    await this.emit(session.sessionId, 'action_completed', event.messageId, event.result.status, references);

    if (terminalReason !== null) {
      await this.emit(session.sessionId, 'task_terminal_outcome', event.messageId, terminalReason.message, references);
      return outcome;
    }

    if ('postObservation' in event.result) {
      const planningMessageId = randomUUID() as MessageId;
      await this.observe({
        type: 'observation.submitted',
        sessionId: event.sessionId,
        messageId: planningMessageId,
        occurredAt: event.result.postObservation.capturedAt,
        observation: event.result.postObservation,
      });
    } else {
      const latest = await this.requireSession(event.sessionId);
      const latestRevision = latest.revision;
      latest.state = 'OBSERVING';
      latest.revision = latestRevision + 1;
      await this.options.store.transition(latest, latestRevision);
    }
    return outcome;
  }

  private async reconcile(
    event: Extract<SessionEngineEvent, { type: 'reconcile.request' }>,
  ): Promise<StoredOutcome> {
    const session = await this.requireSession(event.sessionId);
    const expectedRevision = session.revision;
    const active = session.activeAction;
    const authoritative = active === null ? [] : [active.actionId];
    let requiresFreshObservation = event.pendingActionIds.some((id) => !authoritative.includes(id));

    if (session.state === 'PLANNING' || session.state === 'POLICY_CHECK') {
      session.state = 'OBSERVING';
      session.activeInferenceId = null;
      session.pendingPolicy = null;
      requiresFreshObservation = true;
    }
    if (
      active !== null &&
      active.delivery.status === 'pending' &&
      event.pendingActionIds.includes(active.actionId)
    ) {
      active.delivery.status = 'sent';
      active.delivery.lastError = null;
    }
    const clientHasCommand = active !== null && (
      event.pendingActionIds.includes(active.actionId) || event.lastReceivedSequence >= active.command.sequence
    );
    const shouldReplay = active !== null && active.delivery.status === 'pending' && !event.pendingActionIds.includes(active.actionId);
    if (active !== null && active.delivery.status === 'sent' && !clientHasCommand) {
      active.delivery.status = 'pending';
    }
    const outcome = this.addOutcome(session, event.messageId, 'reconciled', undefined, requiresFreshObservation);
    await this.options.store.transition(session, expectedRevision, outcome);
    if (shouldReplay || (active !== null && active.delivery.status === 'pending' && !clientHasCommand)) {
      await this.deliverPendingCommand(event.sessionId);
    }
    return outcome;
  }

  private async cancel(
    event: Extract<SessionEngineEvent, { type: 'task.cancelled' }>,
  ): Promise<StoredOutcome> {
    const session = await this.requireSession(event.sessionId);
    if (this.isTerminal(session)) {
      return this.persistOutcome(session, event.messageId, 'ignored');
    }
    const references = session.activeAction === null
      ? session.pendingApproval === null
        ? session.pendingPolicy === null ? {} : this.pendingReferences(session.pendingPolicy)
        : this.pendingReferences(session.pendingApproval)
      : this.pendingReferences(session.activeAction);
    const expectedRevision = session.revision;
    session.state = 'CANCELLED';
    session.activeInferenceId = null;
    session.activeAction = null;
    session.pendingPolicy = null;
    session.pendingApproval = null;
    session.terminalReason = {
      code: 'SESSION_CANCELLED',
      message: event.reason,
      detectedAt: event.occurredAt,
    };
    session.updatedAt = event.occurredAt;
    const outcome = this.addOutcome(session, event.messageId, 'terminal');
    await this.options.store.transition(session, expectedRevision, outcome);
    await this.emit(session.sessionId, 'task_terminal_outcome', event.messageId, event.reason, references);
    return outcome;
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

  private async emit(
    sessionId: CanonicalSession['sessionId'],
    kind: TrajectoryEventKindV1,
    correlationId: MessageId,
    summary: string,
    references: TrajectoryReferences = {},
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const session = await this.requireSession(sessionId);
      const expectedRevision = session.revision;
      const event: TrajectoryEventV1 = {
        eventId: randomUUID() as EventId,
        sessionId: session.sessionId,
        taskId: session.taskId,
        ...references,
        correlationId,
        sequence: session.eventSequence,
        occurredAt: this.now(),
        kind,
        summary,
      };
      session.eventSequence += 1;
      session.revision = expectedRevision + 1;
      try {
        await this.options.store.transition(session, expectedRevision);
        await this.options.trajectorySink.append(event);
        return;
      } catch (error) {
        if (!(error instanceof SessionEngineError) || error.code !== 'STORE_CONFLICT' || attempt === 2) {
          throw error;
        }
      }
    }
  }
}
