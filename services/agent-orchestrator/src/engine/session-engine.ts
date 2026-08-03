import { randomUUID } from 'node:crypto';
import type {
  ActionCommandV1,
  ActionId,
  EventId,
  MessageId,
  StepId,
  TrajectoryEventKindV1,
  TrajectoryEventV1,
} from '@fara-platform/fara-action-schema';
import type {
  CanonicalSession,
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
        return this.recordIgnored(event, 'reconciled');
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
      startedAt: event.occurredAt,
      updatedAt: event.occurredAt,
      lastObservation: null,
      activeInferenceId: null,
      activeAction: null,
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
    await this.options.store.compareAndSwap(session, 0);
    await this.emit(session, 'session_lifecycle', event.messageId, 'Session opened');
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
      session.pendingApproval !== null ||
      (session.state !== 'OBSERVING' && session.state !== 'VERIFYING')
    ) {
      return this.persistOutcome(session, event.messageId, 'ignored');
    }

    const expectedRevision = session.revision;
    session.state = 'PLANNING';
    const inferenceId = `inference:${event.messageId}`;
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
    await this.options.store.compareAndSwap(session, expectedRevision);
    await this.emit(session, 'observation_captured', event.messageId, 'Observation accepted');
    if (terminalReason !== null) {
      await this.emit(session, 'task_terminal_outcome', event.messageId, terminalReason.message);
      return accepted;
    }
    await this.emit(session, 'model_request', event.messageId, 'Planning requested');

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
    let session: CanonicalSession | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      session = await this.requireSession(sessionId);
      if (session.activeInferenceId !== inferenceId) return;
      const expectedRevision = session.revision;
      session.activeInferenceId = null;
      if (proposal.kind === 'completion') {
        session.state = proposal.status === 'succeeded' ? 'COMPLETED' : 'FAILED';
        session.terminalReason = {
          code: 'MODEL_COMPLETION',
          message: proposal.summary,
          detectedAt: this.now(),
        };
      } else {
        session.state = 'POLICY_CHECK';
      }
      session.updatedAt = this.now();
      session.revision = expectedRevision + 1;
      try {
        await this.options.store.compareAndSwap(session, expectedRevision);
        break;
      } catch (error) {
        if (!(error instanceof SessionEngineError) || error.code !== 'STORE_CONFLICT' || attempt === 2) {
          throw error;
        }
        session = null;
      }
    }
    if (session === null) {
      throw new SessionEngineError('STORE_CONFLICT', 'Inference result could not be persisted');
    }
    if (proposal.kind === 'completion') {
      await this.emit(session, 'task_terminal_outcome', causationMessageId, proposal.summary);
      return;
    }

    await this.emit(session, 'model_response', causationMessageId, 'Action proposal received');
    await this.emit(session, 'action_proposed', causationMessageId, proposal.action.type);

    const actionId = this.idGenerator() as ActionId;
    const stepId = this.idGenerator() as StepId;
    const decision = await this.options.policy.evaluate({
      sessionId: session.sessionId,
      taskId: session.taskId,
      actionId,
      proposal,
    });

    session = await this.requireSession(sessionId);
    if (session.state !== 'POLICY_CHECK') return;
    const expectedRevision = session.revision;
    if (decision.decision === 'denied') {
      const reason = {
        code: 'POLICY_DENIED' as const,
        message: 'Server policy denied the proposed action',
        detectedAt: this.now(),
      };
      session.state = 'FAILED';
      session.terminalReason = reason;
      session.updatedAt = reason.detectedAt;
      session.revision = expectedRevision + 1;
      await this.options.store.compareAndSwap(session, expectedRevision);
      await this.emit(session, 'policy_decided', causationMessageId, decision.decision);
      await this.emit(session, 'task_terminal_outcome', causationMessageId, reason.message);
      return;
    }

    if (decision.decision === 'approval_required') {
      session.state = 'WAITING_FOR_APPROVAL';
      session.pendingApproval = {
        actionId,
        stepId,
        observationId: proposal.observationId,
        proposal,
        policyDecision: decision,
      };
      session.updatedAt = this.now();
      session.revision = expectedRevision + 1;
      await this.options.store.compareAndSwap(session, expectedRevision);
      await this.emit(session, 'policy_decided', causationMessageId, decision.decision);
      await this.emit(session, 'approval_requested', causationMessageId, 'Approval required');
      return;
    }

    await this.dispatch(session, {
      actionId,
      stepId,
      observationId: proposal.observationId,
      proposal,
      policyDecision: decision,
    }, causationMessageId);
  }

  private async dispatch(
    session: CanonicalSession,
    pending: NonNullable<CanonicalSession['pendingApproval']>,
    causationMessageId: MessageId,
    approval?: Extract<SessionEngineEvent, { type: 'approval.resolved' }>['resolution'],
  ): Promise<void> {
    const expectedRevision = session.revision;
    const now = this.timestampAfter(approval?.resolvedAt);
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
      session.pendingApproval = null;
      session.terminalReason = terminalReason;
      session.updatedAt = now;
      session.revision = expectedRevision + 1;
      await this.options.store.compareAndSwap(session, expectedRevision);
      await this.emit(session, 'task_terminal_outcome', causationMessageId, terminalReason.message);
      return;
    }

    session.state = 'EXECUTING';
    session.nextSequence += 1;
    session.stepCount += 1;
    session.activeAction = {
      ...pending,
      command,
    };
    session.pendingApproval = null;
    session.updatedAt = now;
    session.revision = expectedRevision + 1;
    await this.options.store.compareAndSwap(session, expectedRevision);
    await this.options.commandSink.send(command);
  }

  private async resolveApproval(
    event: Extract<SessionEngineEvent, { type: 'approval.resolved' }>,
  ): Promise<StoredOutcome> {
    const session = await this.requireSession(event.sessionId);
    const pending = session.pendingApproval;
    if (
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

    if (event.resolution.status === 'denied') {
      const expectedRevision = session.revision;
      session.state = 'FAILED';
      session.pendingApproval = null;
      session.terminalReason = {
        code: 'POLICY_DENIED',
        message: 'User denied the requested approval',
        detectedAt: event.occurredAt,
      };
      const outcome = this.addOutcome(session, event.messageId, 'terminal');
      await this.options.store.compareAndSwap(session, expectedRevision);
      await this.emit(session, 'approval_resolved', event.messageId, 'Approval denied');
      await this.emit(session, 'task_terminal_outcome', event.messageId, 'Approval denied');
      return outcome;
    }

    const expectedRevision = session.revision;
    const outcome = this.addOutcome(session, event.messageId, 'accepted');
    await this.options.store.compareAndSwap(session, expectedRevision);
    const persisted = await this.requireSession(event.sessionId);
    await this.emit(persisted, 'approval_resolved', event.messageId, 'Approval granted');
    await this.dispatch(persisted, pending, event.messageId, event.resolution);
    return outcome;
  }

  private async completeAction(
    event: Extract<SessionEngineEvent, { type: 'action.completed' }>,
  ): Promise<StoredOutcome> {
    const session = await this.requireSession(event.sessionId);
    const completed = session.completedActions[event.result.actionId];
    if (completed !== undefined) {
      const expectedRevision = session.revision;
      session.processedMessages[event.messageId] = completed;
      session.revision += 1;
      await this.options.store.compareAndSwap(session, expectedRevision);
      return completed;
    }
    const active = session.activeAction;
    if (
      active === null ||
      active.actionId !== event.result.actionId ||
      active.stepId !== event.result.stepId ||
      active.observationId !== event.result.observationId
    ) {
      return this.persistError(session, event.messageId, new SessionEngineError(
        'STALE_ACTION_RESULT',
        'Action result does not match the active action and source observation',
      ));
    }

    const expectedRevision = session.revision;
    session.activeAction = null;
    session.state = 'VERIFYING';
    session.recentResults = [...session.recentResults.slice(-19), event.result];
    if ('postObservation' in event.result) {
      session.observationSignatures.push(observationSignature(event.result.postObservation));
    }
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
    session.completedActions[event.result.actionId] = outcome;
    await this.options.store.compareAndSwap(session, expectedRevision);
    await this.emit(session, 'action_completed', event.messageId, event.result.status);

    if (terminalReason !== null) {
      await this.emit(session, 'task_terminal_outcome', event.messageId, terminalReason.message);
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
      latest.revision += 1;
      await this.options.store.compareAndSwap(latest, latestRevision);
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
    const expectedRevision = session.revision;
    session.state = 'CANCELLED';
    session.activeInferenceId = null;
    session.activeAction = null;
    session.pendingApproval = null;
    session.terminalReason = {
      code: 'SESSION_CANCELLED',
      message: event.reason,
      detectedAt: event.occurredAt,
    };
    session.updatedAt = event.occurredAt;
    const outcome = this.addOutcome(session, event.messageId, 'terminal');
    await this.options.store.compareAndSwap(session, expectedRevision);
    await this.emit(session, 'task_terminal_outcome', event.messageId, event.reason);
    return outcome;
  }

  private async persistError(
    session: CanonicalSession,
    messageId: MessageId,
    error: SessionEngineError,
  ): Promise<never> {
    const expectedRevision = session.revision;
    this.addOutcome(session, messageId, 'error', error);
    await this.options.store.compareAndSwap(session, expectedRevision);
    throw error;
  }

  private async recordIgnored(
    event: SessionEngineEvent,
    kind: 'reconciled' | 'terminal',
  ): Promise<StoredOutcome> {
    const session = await this.requireSession(event.sessionId);
    return this.persistOutcome(session, event.messageId, kind);
  }

  private async persistOutcome(
    session: CanonicalSession,
    messageId: MessageId,
    kind: StoredOutcome['kind'],
  ): Promise<StoredOutcome> {
    const expectedRevision = session.revision;
    const outcome = this.addOutcome(session, messageId, kind);
    await this.options.store.compareAndSwap(session, expectedRevision);
    return outcome;
  }

  private addOutcome(
    session: CanonicalSession,
    messageId: MessageId,
    kind: StoredOutcome['kind'],
    error?: SessionEngineError,
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
  ): StoredOutcome {
    return {
      kind,
      sessionId,
      messageId,
      revision,
      state,
      pendingActionIds,
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

  private async emit(
    session: CanonicalSession,
    kind: TrajectoryEventKindV1,
    correlationId: MessageId,
    summary: string,
  ): Promise<void> {
    const event: TrajectoryEventV1 = {
      eventId: randomUUID() as EventId,
      sessionId: session.sessionId,
      taskId: session.taskId,
      ...(session.activeAction === null ? {} : {
        stepId: session.activeAction.stepId,
        actionId: session.activeAction.actionId,
        observationId: session.activeAction.observationId,
      }),
      correlationId,
      sequence: session.nextSequence,
      occurredAt: this.now(),
      kind,
      summary,
    };
    await this.options.trajectorySink.append(event);
  }
}
