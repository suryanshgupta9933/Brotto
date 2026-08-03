import type {
  ActionCommandV1,
  ActionResultV1,
  AgentProposalV1,
  ObservationV1,
  PolicyDecisionV1,
  TrajectoryEventV1,
} from '@fara-platform/fara-action-schema';
import { InMemorySessionStore } from '../engine/session-store.js';
import { SessionEngine } from '../engine/session-engine.js';
import {
  actionSignature,
  detectTerminalReason,
  hasVerifiedEffect,
  observationSignature,
} from '../engine/progress.js';
import type {
  CommandSink,
  InferencePort,
  PolicyPort,
  TrajectorySink,
  StoredOutcome,
  CanonicalSession,
} from '../engine/types.js';

const ids = {
  session: '00000000-0000-4000-8000-000000000001',
  task: '00000000-0000-4000-8000-000000000002',
  observation1: '00000000-0000-4000-8000-000000000003',
  observation2: '00000000-0000-4000-8000-000000000004',
  action: '00000000-0000-4000-8000-000000000005',
  staleAction: '00000000-0000-4000-8000-000000000006',
  step: '00000000-0000-4000-8000-000000000007',
  policy: '00000000-0000-4000-8000-000000000008',
  approval: '00000000-0000-4000-8000-000000000012',
  tab: '00000000-0000-4000-8000-000000000009',
  frame: '00000000-0000-4000-8000-000000000010',
} as const;

function observation(observationId = ids.observation1): ObservationV1 {
  return {
    observationId,
    capturedAt: '2026-08-03T10:00:00.000Z',
    url: 'https://example.com/',
    title: 'Example',
    screenshot: {
      kind: 'artifact',
      artifactId: '00000000-0000-4000-8000-000000000011',
      sha256: 'a'.repeat(64),
      width: 1280,
      height: 720,
      encoding: 'png',
    },
    viewport: {
      width: 1280,
      height: 720,
      devicePixelRatio: 1,
      zoom: 1,
      scrollX: 0,
      scrollY: 0,
    },
    page: {
      tabId: ids.tab,
      frameId: ids.frame,
      lifecycle: 'complete',
      visibility: 'visible',
    },
    semanticTargets: [],
  } as ObservationV1;
}

class FakeInference implements InferencePort {
  readonly calls: unknown[] = [];

  constructor(private readonly proposals: AgentProposalV1[] = []) {}

  enqueue(proposal: AgentProposalV1): void {
    this.proposals.push(proposal);
  }

  async plan(input: Parameters<InferencePort['plan']>[0]): Promise<AgentProposalV1> {
    this.calls.push(input);
    return this.proposals.shift() ?? {
      kind: 'action',
      observationId: input.observation.observationId,
      proposedAt: '2026-08-03T10:00:01.000Z',
      action: { type: 'left_click', x: 10, y: 20 },
    };
  }
}

class FakePolicy implements PolicyPort {
  constructor(private readonly decision: PolicyDecisionV1['decision'] = 'allowed') {}

  async evaluate(input: Parameters<PolicyPort['evaluate']>[0]): Promise<PolicyDecisionV1> {
    return {
      policyDecisionId: ids.policy,
      actionId: input.actionId,
      observationId: input.proposal.observationId,
      decision: this.decision,
      decidedAt: '2026-08-03T10:00:02.000Z',
    };
  }
}

class DeferredPolicy implements PolicyPort {
  calls = 0;
  private releaseFirst!: () => void;
  private markFirstStarted!: () => void;
  readonly firstStarted = new Promise<void>((resolve) => { this.markFirstStarted = resolve; });
  private readonly firstReleased = new Promise<void>((resolve) => { this.releaseFirst = resolve; });

  release(): void {
    this.releaseFirst();
  }

  async evaluate(input: Parameters<PolicyPort['evaluate']>[0]): Promise<PolicyDecisionV1> {
    this.calls += 1;
    if (this.calls === 1) {
      this.markFirstStarted();
      await this.firstReleased;
    }
    return {
      policyDecisionId: ids.policy,
      actionId: input.actionId,
      observationId: input.proposal.observationId,
      decision: 'allowed',
      decidedAt: '2026-08-03T10:00:02.000Z',
    };
  }
}

class RecordingCommands implements CommandSink {
  readonly commands: ActionCommandV1[] = [];

  async send(command: ActionCommandV1): Promise<void> {
    this.commands.push(command);
  }
}

class FailOnceCommands extends RecordingCommands {
  attempts = 0;

  override async send(command: ActionCommandV1): Promise<void> {
    this.attempts += 1;
    if (this.attempts === 1) throw new Error('simulated send failure');
    await super.send(command);
  }
}

class PausingApprovalStore extends InMemorySessionStore {
  private releaseTransition!: () => void;
  private markPaused!: () => void;
  readonly paused = new Promise<void>((resolve) => { this.markPaused = resolve; });
  private readonly released = new Promise<void>((resolve) => { this.releaseTransition = resolve; });
  private didPause = false;

  release(): void {
    this.releaseTransition();
  }

  override async transition(
    session: CanonicalSession,
    expectedRevision: number,
    outcome?: StoredOutcome,
  ): Promise<void> {
    if (
      !this.didPause &&
      session.state === 'EXECUTING' &&
      (outcome?.messageId === '10000000-0000-4000-8000-000000000031' ||
        session.processedMessages['10000000-0000-4000-8000-000000000031'] !== undefined)
    ) {
      this.didPause = true;
      this.markPaused();
      await this.released;
    }
    await super.transition(session, expectedRevision, outcome);
  }
}

class RecordingTrajectory implements TrajectorySink {
  readonly events: TrajectoryEventV1[] = [];

  async append(event: TrajectoryEventV1): Promise<void> {
    this.events.push(event);
  }
}

function createEngine(options: {
  inference?: FakeInference;
  policy?: PolicyPort;
  store?: InMemorySessionStore;
  trajectorySink?: RecordingTrajectory;
  commandSink?: RecordingCommands;
  budgets?: ConstructorParameters<typeof SessionEngine>[0]['budgets'];
} = {}) {
  const commandSink = options.commandSink ?? new RecordingCommands();
  const store = options.store ?? new InMemorySessionStore();
  const inference = options.inference ?? new FakeInference();
  const trajectorySink = options.trajectorySink ?? new RecordingTrajectory();
  const engine = new SessionEngine({
    store,
    inference,
    policy: options.policy ?? new FakePolicy(),
    commandSink,
    trajectorySink,
    now: () => '2026-08-03T10:00:03.000Z',
    idGenerator: (() => {
      const generated = [ids.action, ids.step, ids.policy];
      return () => generated.shift() ?? '00000000-0000-4000-8000-000000000099';
    })(),
    budgets: options.budgets,
  });

  return { engine, commandSink, inference, store, trajectorySink };
}

async function open(engine: SessionEngine): Promise<void> {
  await engine.handle({
    type: 'session.open',
    messageId: '10000000-0000-4000-8000-000000000001',
    sessionId: ids.session,
    taskId: ids.task,
    goal: 'Click the target',
    completionCriteria: ['The target was clicked'],
    occurredAt: '2026-08-03T10:00:00.000Z',
  });
}

describe('SessionEngine', () => {
  it('dispatches only one action until its terminal result arrives', async () => {
    const { engine, commandSink } = createEngine();
    await open(engine);
    const obs = observation();

    await engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000002',
      sessionId: ids.session,
      observation: obs,
      occurredAt: obs.capturedAt,
    });
    await engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000003',
      sessionId: ids.session,
      observation: obs,
      occurredAt: obs.capturedAt,
    });

    expect(commandSink.commands).toHaveLength(1);
  });

  it('serializes concurrent observations without starting duplicate inference', async () => {
    const { engine, inference, commandSink } = createEngine();
    await open(engine);
    const obs = observation();

    await Promise.all([
      engine.handle({
        type: 'observation.submitted',
        messageId: '10000000-0000-4000-8000-000000000020',
        sessionId: ids.session,
        observation: obs,
        occurredAt: obs.capturedAt,
      }),
      engine.handle({
        type: 'observation.submitted',
        messageId: '10000000-0000-4000-8000-000000000021',
        sessionId: ids.session,
        observation: obs,
        occurredAt: obs.capturedAt,
      }),
    ]);

    expect(inference.calls).toHaveLength(1);
    expect(commandSink.commands).toHaveLength(1);
  });

  it('ignores a new observation while policy evaluation is active', async () => {
    const policy = new DeferredPolicy();
    const { engine, inference, commandSink } = createEngine({ policy });
    await open(engine);
    const first = engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000024',
      sessionId: ids.session,
      observation: observation(),
      occurredAt: '2026-08-03T10:00:00.000Z',
    });
    await policy.firstStarted;

    await engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000025',
      sessionId: ids.session,
      observation: observation(ids.observation2),
      occurredAt: '2026-08-03T10:00:01.000Z',
    });
    policy.release();
    await first;

    expect(inference.calls).toHaveLength(1);
    expect(commandSink.commands).toHaveLength(1);
  });

  it('does not let a late policy result revive a cancelled session', async () => {
    const policy = new DeferredPolicy();
    const { engine, commandSink, store } = createEngine({ policy });
    await open(engine);
    const planning = engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000026',
      sessionId: ids.session,
      observation: observation(),
      occurredAt: '2026-08-03T10:00:00.000Z',
    });
    await policy.firstStarted;
    await engine.handle({
      type: 'task.cancelled',
      messageId: '10000000-0000-4000-8000-000000000027',
      sessionId: ids.session,
      reason: 'User cancelled during policy evaluation',
      occurredAt: '2026-08-03T10:00:03.000Z',
    });
    policy.release();
    await planning;

    expect(commandSink.commands).toHaveLength(0);
    expect((await store.load(ids.session as never))?.state).toBe('CANCELLED');
  });

  it('rejects a result for a different observation/action pair', async () => {
    const { engine } = createEngine();
    await open(engine);
    const obs = observation();
    await engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000004',
      sessionId: ids.session,
      observation: obs,
      occurredAt: obs.capturedAt,
    });
    const staleResult = {
      actionId: ids.staleAction,
      stepId: ids.step,
      observationId: ids.observation2,
      sequence: 2,
      status: 'rejected_stale',
      startedAt: '2026-08-03T10:00:04.000Z',
      completedAt: '2026-08-03T10:00:05.000Z',
      durationMs: 1000,
      rejection: { code: 'STALE', message: 'stale', retryable: false },
    } as ActionResultV1;

    await expect(engine.handle({
      type: 'action.completed',
      messageId: '10000000-0000-4000-8000-000000000005',
      sessionId: ids.session,
      result: staleResult,
      occurredAt: staleResult.completedAt,
    })).rejects.toMatchObject({ code: 'STALE_ACTION_RESULT' });
  });

  it('persists an executable action before external dispatch', async () => {
    const store = new InMemorySessionStore();
    let persisted: CanonicalSession | null = null;
    const commandSink: RecordingCommands = new class extends RecordingCommands {
      override async send(command: ActionCommandV1): Promise<void> {
        persisted = await store.load(ids.session as never);
        await super.send(command);
      }
    }();
    const { engine } = createEngine({ store, commandSink });
    await open(engine);

    await engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000006',
      sessionId: ids.session,
      observation: observation(),
      occurredAt: '2026-08-03T10:00:00.000Z',
    });

    expect(persisted).toMatchObject({
      state: 'EXECUTING',
      activeAction: {
        command: commandSink.commands[0],
        delivery: { status: 'pending' },
      },
    });
  });

  it('persists the proposal and generated policy request before awaiting policy', async () => {
    const policy = new DeferredPolicy();
    const { engine, store } = createEngine({ policy });
    await open(engine);
    const planning = engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000028',
      sessionId: ids.session,
      observation: observation(),
      occurredAt: '2026-08-03T10:00:00.000Z',
    });
    await policy.firstStarted;

    expect(await store.load(ids.session as never)).toMatchObject({
      state: 'POLICY_CHECK',
      pendingPolicy: {
        actionId: ids.action,
        stepId: ids.step,
        policyDecisionId: ids.policy,
        proposal: { observationId: ids.observation1 },
      },
    });
    policy.release();
    await planning;
  });

  it('waits for a matching approval before dispatch', async () => {
    const { engine, commandSink, store } = createEngine({
      policy: new FakePolicy('approval_required'),
    });
    await open(engine);
    await engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000007',
      sessionId: ids.session,
      observation: observation(),
      occurredAt: '2026-08-03T10:00:00.000Z',
    });

    expect(commandSink.commands).toHaveLength(0);
    expect((await store.load(ids.session as never))?.state).toBe('WAITING_FOR_APPROVAL');

    await engine.handle({
      type: 'approval.resolved',
      messageId: '10000000-0000-4000-8000-000000000008',
      sessionId: ids.session,
      occurredAt: '2026-08-03T10:00:03.000Z',
      resolution: {
        approvalId: ids.approval,
        policyDecisionId: ids.policy,
        actionId: ids.action,
        status: 'approved',
        resolvedAt: '2026-08-03T10:00:03.000Z',
      },
    });

    expect(commandSink.commands).toHaveLength(1);
    expect(commandSink.commands[0]?.policyContext).toMatchObject({
      approved: true,
      approvalId: ids.approval,
    });
  });

  it('atomically commits approval processing with the pending command', async () => {
    const store = new PausingApprovalStore();
    const { engine, commandSink } = createEngine({
      store,
      policy: new FakePolicy('approval_required'),
    });
    await open(engine);
    await engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000029',
      sessionId: ids.session,
      observation: observation(),
      occurredAt: '2026-08-03T10:00:00.000Z',
    });
    const approval = engine.handle({
      type: 'approval.resolved',
      messageId: '10000000-0000-4000-8000-000000000031',
      sessionId: ids.session,
      occurredAt: '2026-08-03T10:00:03.000Z',
      resolution: {
        approvalId: ids.approval,
        policyDecisionId: ids.policy,
        actionId: ids.action,
        status: 'approved',
        resolvedAt: '2026-08-03T10:00:03.000Z',
      },
    });
    await store.paused;
    await engine.handle({
      type: 'task.cancelled',
      messageId: '10000000-0000-4000-8000-000000000032',
      sessionId: ids.session,
      reason: 'cancel won approval race',
      occurredAt: '2026-08-03T10:00:03.500Z',
    });
    store.release();

    await expect(approval).rejects.toMatchObject({ code: 'STALE_APPROVAL_RESOLUTION' });
    expect(commandSink.commands).toHaveLength(0);
    expect(await store.getProcessed('10000000-0000-4000-8000-000000000031' as never)).toMatchObject({
      kind: 'error',
    });
    expect((await store.load(ids.session as never))?.state).toBe('CANCELLED');
  });

  it('retries an atomically persisted approved command after a send crash', async () => {
    const commandSink = new FailOnceCommands();
    const { engine, store } = createEngine({
      commandSink,
      policy: new FakePolicy('approval_required'),
    });
    await open(engine);
    await engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000033',
      sessionId: ids.session,
      observation: observation(),
      occurredAt: '2026-08-03T10:00:00.000Z',
    });
    const approvalEvent = {
      type: 'approval.resolved' as const,
      messageId: '10000000-0000-4000-8000-000000000034',
      sessionId: ids.session,
      occurredAt: '2026-08-03T10:00:03.000Z',
      resolution: {
        approvalId: ids.approval,
        policyDecisionId: ids.policy,
        actionId: ids.action,
        status: 'approved' as const,
        resolvedAt: '2026-08-03T10:00:03.000Z',
      },
    };

    await expect(engine.handle(approvalEvent)).rejects.toThrow('simulated send failure');
    expect(await store.load(ids.session as never)).toMatchObject({
      state: 'EXECUTING',
      activeAction: { delivery: { status: 'pending', attempts: 1 } },
    });

    const retry = await engine.handle(approvalEvent);
    expect(retry.kind).toBe('accepted');
    expect(commandSink.attempts).toBe(2);
    expect(commandSink.commands).toHaveLength(1);
    expect((await store.load(ids.session as never))?.activeAction).toMatchObject({
      delivery: { status: 'sent', attempts: 2 },
    });
  });

  it('replays an undelivered command after process loss and reconnect', async () => {
    const commandSink = new FailOnceCommands();
    const store = new InMemorySessionStore();
    const first = createEngine({ store, commandSink });
    await open(first.engine);
    await expect(first.engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000035',
      sessionId: ids.session,
      observation: observation(),
      occurredAt: '2026-08-03T10:00:00.000Z',
    })).rejects.toThrow('simulated send failure');

    const restarted = createEngine({ store, commandSink });
    const outcome = await restarted.engine.handle({
      type: 'reconcile.request',
      messageId: '10000000-0000-4000-8000-000000000036',
      sessionId: ids.session,
      lastReceivedSequence: 0,
      pendingActionIds: [],
      occurredAt: '2026-08-03T10:00:05.000Z',
    });

    expect(outcome).toMatchObject({ kind: 'reconciled', pendingActionIds: [ids.action] });
    expect(commandSink.attempts).toBe(2);
    expect(commandSink.commands).toHaveLength(1);
  });

  it('accepts one matching terminal result and plans from its post-observation', async () => {
    const completion: AgentProposalV1 = {
      kind: 'completion',
      observationId: ids.observation2,
      type: 'terminate',
      status: 'succeeded',
      summary: 'Done',
      findings: [{ fact: 'Clicked', observationIds: [ids.observation2] }],
      unmetCriteria: [],
      confidence: 1,
    } as AgentProposalV1;
    const inference = new FakeInference([]);
    const { engine, commandSink, store } = createEngine({ inference });
    await open(engine);
    await engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000009',
      sessionId: ids.session,
      observation: observation(),
      occurredAt: '2026-08-03T10:00:00.000Z',
    });
    inference.enqueue(completion);
    const command = commandSink.commands[0]!;
    const postObservation = {
      ...observation(ids.observation2),
      capturedAt: '2026-08-03T10:00:06.000Z',
      screenshot: { ...observation(ids.observation2).screenshot, sha256: 'b'.repeat(64) },
    } as ObservationV1;
    const result = {
      actionId: command.actionId,
      stepId: command.stepId,
      observationId: command.observationId,
      sequence: command.sequence + 1,
      status: 'succeeded',
      startedAt: '2026-08-03T10:00:04.000Z',
      completedAt: '2026-08-03T10:00:05.000Z',
      durationMs: 1000,
      postObservation,
    } as ActionResultV1;

    const first = await engine.handle({
      type: 'action.completed',
      messageId: '10000000-0000-4000-8000-000000000010',
      sessionId: ids.session,
      result,
      occurredAt: result.completedAt,
    });
    const duplicate = await engine.handle({
      type: 'action.completed',
      messageId: '10000000-0000-4000-8000-000000000010',
      sessionId: ids.session,
      result,
      occurredAt: result.completedAt,
    });

    expect(duplicate).toEqual(first);
    expect(inference.calls).toHaveLength(2);
    const saved = await store.load(ids.session as never);
    expect(saved?.state).toBe('COMPLETED');
    expect(saved?.observationSignatures).toHaveLength(2);
  });

  it('rejects a completed-action duplicate whose full result tuple changed', async () => {
    const completion: AgentProposalV1 = {
      kind: 'completion',
      observationId: ids.observation2,
      type: 'terminate',
      status: 'succeeded',
      summary: 'Done',
      findings: [],
      unmetCriteria: [],
      confidence: 1,
    } as AgentProposalV1;
    const inference = new FakeInference([]);
    const { engine, commandSink } = createEngine({ inference });
    await open(engine);
    await engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000042',
      sessionId: ids.session,
      observation: observation(),
      occurredAt: '2026-08-03T10:00:00.000Z',
    });
    inference.enqueue(completion);
    const command = commandSink.commands[0]!;
    const result = {
      actionId: command.actionId,
      stepId: command.stepId,
      observationId: command.observationId,
      sequence: command.sequence + 1,
      status: 'succeeded',
      startedAt: '2026-08-03T10:00:04.000Z',
      completedAt: '2026-08-03T10:00:05.000Z',
      durationMs: 1000,
      postObservation: {
        ...observation(ids.observation2),
        capturedAt: '2026-08-03T10:00:06.000Z',
        screenshot: { ...observation(ids.observation2).screenshot, sha256: 'b'.repeat(64) },
      },
    } as ActionResultV1;
    await engine.handle({
      type: 'action.completed',
      messageId: '10000000-0000-4000-8000-000000000043',
      sessionId: ids.session,
      result,
      occurredAt: result.completedAt,
    });

    await expect(engine.handle({
      type: 'action.completed',
      messageId: '10000000-0000-4000-8000-000000000044',
      sessionId: ids.session,
      result: { ...result, durationMs: 999 },
      occurredAt: result.completedAt,
    })).rejects.toMatchObject({ code: 'STALE_ACTION_RESULT' });
  });

  it('emits monotonic trajectory sequences with explicit action lineage', async () => {
    const { engine, trajectorySink } = createEngine();
    await open(engine);
    await engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000045',
      sessionId: ids.session,
      observation: observation(),
      occurredAt: '2026-08-03T10:00:00.000Z',
    });

    expect(trajectorySink.events.map((event) => event.sequence)).toEqual(
      trajectorySink.events.map((_, index) => index),
    );
    for (const event of trajectorySink.events.filter((candidate) => [
      'action_proposed',
      'policy_decided',
      'action_acknowledged',
    ].includes(candidate.kind))) {
      expect(event).toMatchObject({
        stepId: ids.step,
        actionId: ids.action,
        observationId: ids.observation1,
      });
    }
  });

  it('returns the authoritative pending action during reconnect', async () => {
    const { engine, commandSink } = createEngine();
    await open(engine);
    await engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000011',
      sessionId: ids.session,
      observation: observation(),
      occurredAt: '2026-08-03T10:00:00.000Z',
    });

    const outcome = await engine.handle({
      type: 'reconcile.request',
      messageId: '10000000-0000-4000-8000-000000000012',
      sessionId: ids.session,
      lastReceivedSequence: 0,
      pendingActionIds: [],
      occurredAt: '2026-08-03T10:00:04.000Z',
    });

    expect(outcome).toMatchObject({
      kind: 'reconciled',
      pendingActionIds: [commandSink.commands[0]?.actionId],
    });
  });

  it('requires a fresh observation for unknown client pending actions', async () => {
    const { engine } = createEngine();
    await open(engine);

    const outcome = await engine.handle({
      type: 'reconcile.request',
      messageId: '10000000-0000-4000-8000-000000000037',
      sessionId: ids.session,
      lastReceivedSequence: 0,
      pendingActionIds: [ids.staleAction],
      occurredAt: '2026-08-03T10:00:05.000Z',
    });

    expect(outcome).toMatchObject({
      kind: 'reconciled',
      pendingActionIds: [],
      requiresFreshObservation: true,
    });
  });

  it('rejects a proposal correlated to a different planning observation', async () => {
    const inference = new FakeInference([{
      kind: 'action',
      observationId: ids.observation2,
      proposedAt: '2026-08-03T10:00:01.000Z',
      action: { type: 'left_click', x: 10, y: 20 },
    } as AgentProposalV1]);
    const { engine, commandSink } = createEngine({ inference });
    await open(engine);

    await expect(engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000038',
      sessionId: ids.session,
      observation: observation(),
      occurredAt: '2026-08-03T10:00:00.000Z',
    })).rejects.toMatchObject({ code: 'STALE_PROPOSAL' });
    expect(commandSink.commands).toHaveLength(0);
  });

  it('rejects a policy decision that does not match its persisted request tuple', async () => {
    const policy: PolicyPort = {
      evaluate: async () => ({
        policyDecisionId: ids.policy,
        actionId: ids.staleAction,
        observationId: ids.observation2,
        decision: 'allowed',
        decidedAt: '2026-08-03T10:00:02.000Z',
      } as PolicyDecisionV1),
    };
    const { engine, commandSink } = createEngine({ policy });
    await open(engine);

    await expect(engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000039',
      sessionId: ids.session,
      observation: observation(),
      occurredAt: '2026-08-03T10:00:00.000Z',
    })).rejects.toMatchObject({ code: 'STALE_POLICY_DECISION' });
    expect(commandSink.commands).toHaveLength(0);
  });

  it('rejects a reordered action result sequence', async () => {
    const { engine, commandSink } = createEngine();
    await open(engine);
    await engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000040',
      sessionId: ids.session,
      observation: observation(),
      occurredAt: '2026-08-03T10:00:00.000Z',
    });
    const command = commandSink.commands[0]!;
    const result = {
      actionId: command.actionId,
      stepId: command.stepId,
      observationId: command.observationId,
      sequence: command.sequence,
      status: 'rejected_stale',
      startedAt: '2026-08-03T10:00:04.000Z',
      completedAt: '2026-08-03T10:00:05.000Z',
      durationMs: 1000,
      rejection: { code: 'ORDER', message: 'reordered', retryable: false },
    } as ActionResultV1;

    await expect(engine.handle({
      type: 'action.completed',
      messageId: '10000000-0000-4000-8000-000000000041',
      sessionId: ids.session,
      result,
      occurredAt: result.completedAt,
    })).rejects.toMatchObject({ code: 'STALE_ACTION_RESULT' });
  });

  it('cancels once, clears active work, and emits one terminal event', async () => {
    const { engine, store, trajectorySink } = createEngine();
    await open(engine);
    await engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000013',
      sessionId: ids.session,
      observation: observation(),
      occurredAt: '2026-08-03T10:00:00.000Z',
    });
    const cancellation = {
      type: 'task.cancelled' as const,
      messageId: '10000000-0000-4000-8000-000000000014',
      sessionId: ids.session,
      reason: 'User cancelled',
      occurredAt: '2026-08-03T10:00:04.000Z',
    };

    const first = await engine.handle(cancellation);
    const duplicate = await engine.handle(cancellation);
    const saved = await store.load(ids.session as never);

    expect(duplicate).toEqual(first);
    expect(saved).toMatchObject({
      state: 'CANCELLED',
      activeInferenceId: null,
      activeAction: null,
      pendingApproval: null,
      terminalReason: { code: 'SESSION_CANCELLED' },
    });
    expect(trajectorySink.events.filter((event) => event.kind === 'task_terminal_outcome')).toHaveLength(1);
  });

  it('stops before replanning when repeated post-state exhausts the progress budget', async () => {
    const { engine, commandSink, inference, store } = createEngine({
      budgets: {
        maxRepeatedObservations: 2,
        maxNoVerifiedEffect: 10,
      },
    });
    await open(engine);
    await engine.handle({
      type: 'observation.submitted',
      messageId: '10000000-0000-4000-8000-000000000022',
      sessionId: ids.session,
      observation: observation(),
      occurredAt: '2026-08-03T10:00:00.000Z',
    });
    const command = commandSink.commands[0]!;
    const unchangedPostObservation = {
      ...observation(ids.observation2),
      capturedAt: '2026-08-03T10:00:06.000Z',
    } as ObservationV1;
    const result = {
      actionId: command.actionId,
      stepId: command.stepId,
      observationId: command.observationId,
      sequence: command.sequence + 1,
      status: 'succeeded',
      startedAt: '2026-08-03T10:00:04.000Z',
      completedAt: '2026-08-03T10:00:05.000Z',
      durationMs: 1000,
      postObservation: unchangedPostObservation,
    } as ActionResultV1;

    await engine.handle({
      type: 'action.completed',
      messageId: '10000000-0000-4000-8000-000000000023',
      sessionId: ids.session,
      result,
      occurredAt: result.completedAt,
    });

    expect(inference.calls).toHaveLength(1);
    expect(await store.load(ids.session as never)).toMatchObject({
      state: 'FAILED',
      terminalReason: { code: 'REPEATED_OBSERVATION' },
    });
  });
});

describe('canonical progress and budget detection', () => {
  const budgets = {
    maxSteps: 5,
    maxElapsedMs: 60_000,
    maxRepeatedActions: 3,
    maxRepeatedObservations: 3,
    maxNoVerifiedEffect: 2,
    maxConsecutiveActionFailures: 2,
    maxInferenceRepairAttempts: 2,
  };

  it('hashes normalized action parameters and observation URL/screenshot state', () => {
    expect(actionSignature({ type: 'key', key: 'Enter', modifiers: { shift: true, ctrl: false } }))
      .toBe(actionSignature({ modifiers: { ctrl: false, shift: true }, key: 'Enter', type: 'key' }));
    expect(observationSignature(observation())).toBe(
      observationSignature({ ...observation(), url: 'https://EXAMPLE.com/#ignored' }),
    );
    expect(actionSignature({ type: 'left_click', x: 1, y: 2 })).not.toBe(
      actionSignature({ type: 'left_click', x: 1, y: 3 }),
    );
  });

  it('requires an observable post-action state change for verified effect', () => {
    const before = observation();
    const unchanged = {
      status: 'succeeded',
      postObservation: { ...before, observationId: ids.observation2 },
    } as ActionResultV1;
    const changed = {
      ...unchanged,
      postObservation: {
        ...unchanged.postObservation,
        screenshot: { ...unchanged.postObservation.screenshot, sha256: 'b'.repeat(64) },
      },
    } as ActionResultV1;

    expect(hasVerifiedEffect(before, unchanged)).toBe(false);
    expect(hasVerifiedEffect(before, changed)).toBe(true);
  });

  it.each([
    ['STEP_LIMIT_REACHED', { stepCount: 5 }],
    ['TIME_LIMIT_REACHED', { startedAt: '2026-08-03T09:58:59.999Z' }],
    ['REPEATED_ACTION', { actionSignatures: ['x', 'x', 'x'] }],
    ['REPEATED_OBSERVATION', { observationSignatures: ['x', 'x', 'x'] }],
    ['NO_VERIFIED_EFFECT', { consecutiveNoVerifiedEffect: 2 }],
    ['CONSECUTIVE_ACTION_FAILURES', { consecutiveActionFailures: 2 }],
    ['INFERENCE_REPAIR_EXHAUSTED', { inferenceRepairAttempts: 2 }],
  ] as const)('returns typed terminal reason %s', (code, override) => {
    const reason = detectTerminalReason({
      startedAt: '2026-08-03T10:00:00.000Z',
      stepCount: 0,
      actionSignatures: [],
      observationSignatures: [],
      consecutiveNoVerifiedEffect: 0,
      consecutiveActionFailures: 0,
      inferenceRepairAttempts: 0,
      ...override,
    }, budgets, '2026-08-03T10:01:00.000Z');

    expect(reason).toMatchObject({ code });
  });
});
