import type {
  ActionCommandV1,
  ActionResultV1,
  AgentProposalV1,
  ObservationV1,
  PolicyDecisionV1,
  SemanticTarget,
  SessionId,
  TaskId,
  TrajectoryEventV1,
} from '@fara-platform/fara-action-schema';
import {
  InMemorySessionStore,
  SessionEngine,
  type CommandSink,
  type EngineBudgets,
  type InferencePort,
  type PlanningOutcome,
  type PolicyPort,
  type TerminalNotification,
  type TerminalSink,
  type TrajectorySink,
} from '@fara/agent-orchestrator';

export const IDS = {
  session: '10000000-0000-4000-8000-000000000001' as SessionId,
  task: '10000000-0000-4000-8000-000000000002' as TaskId,
  observationBlank: '10000000-0000-4000-8000-000000000003',
  observationTarget: '10000000-0000-4000-8000-000000000004',
  observationResults: '10000000-0000-4000-8000-000000000005',
  tab: '10000000-0000-4000-8000-000000000006',
  frame: '10000000-0000-4000-8000-000000000007',
  target: '10000000-0000-4000-8000-000000000008',
  artifact: '10000000-0000-4000-8000-000000000009',
} as const;

export class DeterministicClock {
  constructor(private value = Date.parse('2026-08-04T10:00:00.000Z')) {}

  nowMs = (): number => this.value;
  nowIso = (): string => new Date(this.value).toISOString();
  advance(milliseconds = 1_000): void { this.value += milliseconds; }
}

export class ScriptedInference implements InferencePort {
  readonly inputs: Parameters<InferencePort['plan']>[0][] = [];
  maxConcurrent = 0;
  private concurrent = 0;

  constructor(private readonly outcomes: Array<PlanningOutcome | Error>) {}

  async plan(input: Parameters<InferencePort['plan']>[0], signal: AbortSignal): Promise<PlanningOutcome> {
    signal.throwIfAborted();
    this.inputs.push(structuredClone(input));
    this.concurrent += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
    try {
      const outcome = this.outcomes.shift();
      if (outcome === undefined) throw new Error('Inference script exhausted');
      if (outcome instanceof Error) throw outcome;
      return structuredClone(outcome);
    } finally {
      this.concurrent -= 1;
    }
  }
}

export class ScriptedPolicy implements PolicyPort {
  readonly inputs: Parameters<PolicyPort['evaluate']>[0][] = [];

  constructor(private readonly decisions: PolicyDecisionV1['decision'][] = []) {}

  async evaluate(input: Parameters<PolicyPort['evaluate']>[0], signal: AbortSignal): Promise<PolicyDecisionV1> {
    signal.throwIfAborted();
    this.inputs.push(structuredClone(input));
    return {
      policyDecisionId: input.policyDecisionId,
      actionId: input.actionId,
      observationId: input.observation.observationId,
      decision: this.decisions.shift() ?? 'allowed',
      decidedAt: new Date(Date.parse(input.proposal.proposedAt) + 1_000).toISOString(),
    } as PolicyDecisionV1;
  }
}

export class RecordingTrajectory implements TrajectorySink {
  readonly events: TrajectoryEventV1[] = [];

  async append(event: TrajectoryEventV1): Promise<void> {
    if (!this.events.some((existing) => existing.eventId === event.eventId)) {
      this.events.push(structuredClone(event));
    }
  }
}

export class RecordingTerminals implements TerminalSink {
  readonly notifications: TerminalNotification[] = [];
  attempts = 0;

  constructor(private failAfterDeliveryOnce = false) {}

  async sendTerminal(notification: TerminalNotification): Promise<void> {
    this.attempts += 1;
    if (!this.notifications.some((existing) => existing.messageId === notification.messageId)) {
      this.notifications.push(structuredClone(notification));
    }
    if (this.failAfterDeliveryOnce) {
      this.failAfterDeliveryOnce = false;
      throw new Error('simulated terminal response loss');
    }
  }
}

export class SimulatedClient implements CommandSink {
  readonly commands: ActionCommandV1[] = [];
  private active = 0;
  maxInFlight = 0;

  async send(command: ActionCommandV1): Promise<void> {
    this.commands.push(structuredClone(command));
    this.active += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.active);
  }

  settled(): void {
    if (this.active !== 1) throw new Error(`Expected one in-flight command, found ${this.active}`);
    this.active -= 1;
  }
}

export function observation(input: {
  observationId: string;
  capturedAt: string;
  url: string;
  title: string;
  screenshotByte?: string;
  semanticTargets?: SemanticTarget[];
}): ObservationV1 {
  return {
    observationId: input.observationId,
    capturedAt: input.capturedAt,
    url: input.url,
    title: input.title,
    screenshot: {
      kind: 'artifact',
      artifactId: IDS.artifact,
      sha256: (input.screenshotByte ?? 'a').repeat(64),
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
      tabId: IDS.tab,
      frameId: IDS.frame,
      lifecycle: 'complete',
      visibility: 'visible',
    },
    semanticTargets: input.semanticTargets ?? [],
  } as ObservationV1;
}

export function succeededResult(command: ActionCommandV1, postObservation: ObservationV1): ActionResultV1 {
  const startedAt = new Date(Date.parse(command.dispatchedAt) + 1_000).toISOString();
  const completedAt = new Date(Date.parse(startedAt) + 1_000).toISOString();
  return {
    actionId: command.actionId,
    stepId: command.stepId,
    observationId: command.observationId,
    sequence: command.sequence + 1,
    status: 'succeeded',
    startedAt,
    completedAt,
    durationMs: 1_000,
    postObservation,
  } as ActionResultV1;
}

export function action(observationId: string, proposedAt: string, value: AgentProposalV1 & { kind: 'action' }): AgentProposalV1 {
  return { ...value, observationId, proposedAt } as AgentProposalV1;
}

export function createHarness(
  outcomes: Array<PlanningOutcome | Error>,
  decisions: PolicyDecisionV1['decision'][] = [],
  options: { failTerminalAfterDeliveryOnce?: boolean; budgets?: Partial<EngineBudgets> } = {},
) {
  const clock = new DeterministicClock();
  const inference = new ScriptedInference(outcomes);
  const policy = new ScriptedPolicy(decisions);
  const store = new InMemorySessionStore();
  const client = new SimulatedClient();
  const trajectory = new RecordingTrajectory();
  const terminals = new RecordingTerminals(options.failTerminalAfterDeliveryOnce);
  let generated = 20;
  const engine = new SessionEngine({
    store,
    inference,
    policy,
    commandSink: client,
    terminalSink: terminals,
    trajectorySink: trajectory,
    now: clock.nowIso,
    idGenerator: () => `10000000-0000-4000-8000-${String(generated++).padStart(12, '0')}`,
    budgets: options.budgets,
  });
  return { client, clock, engine, inference, policy, store, terminals, trajectory };
}
