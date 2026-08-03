import type {
  ActionCommandV1,
  ActionId,
  ActionProposalV1,
  ActionResultV1,
  AgentProposalV1,
  ApprovalResolutionV1,
  MessageId,
  ObservationV1,
  PolicyDecisionV1,
  SessionId,
  StepId,
  TaskId,
  TrajectoryEventV1,
} from '@fara-platform/fara-action-schema';

export type CanonicalSessionState =
  | 'CREATED'
  | 'OBSERVING'
  | 'PLANNING'
  | 'VALIDATING'
  | 'POLICY_CHECK'
  | 'WAITING_FOR_APPROVAL'
  | 'DISPATCHING'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type TerminalReasonCode =
  | 'MODEL_COMPLETION'
  | 'POLICY_DENIED'
  | 'ACTION_FAILED_TERMINAL'
  | 'SESSION_CANCELLED'
  | 'STEP_LIMIT_REACHED'
  | 'TIME_LIMIT_REACHED'
  | 'REPEATED_ACTION'
  | 'REPEATED_OBSERVATION'
  | 'NO_VERIFIED_EFFECT'
  | 'CONSECUTIVE_ACTION_FAILURES'
  | 'INFERENCE_REPAIR_EXHAUSTED';

export interface TerminalReason {
  code: TerminalReasonCode;
  message: string;
  detectedAt: string;
}

export interface EngineBudgets {
  maxSteps: number;
  maxElapsedMs: number;
  maxRepeatedActions: number;
  maxRepeatedObservations: number;
  maxNoVerifiedEffect: number;
  maxConsecutiveActionFailures: number;
  maxInferenceRepairAttempts: number;
}

export interface PlanningInput {
  sessionId: SessionId;
  taskId: TaskId;
  goal: string;
  completionCriteria: string[];
  observation: ObservationV1;
  recentResults: ActionResultV1[];
}

export interface PolicyInput {
  sessionId: SessionId;
  taskId: TaskId;
  actionId: ActionId;
  proposal: ActionProposalV1;
}

export interface InferencePort {
  plan(input: PlanningInput): Promise<AgentProposalV1>;
}

export interface PolicyPort {
  evaluate(input: PolicyInput): Promise<PolicyDecisionV1>;
}

export interface CommandSink {
  send(command: ActionCommandV1): Promise<void>;
}

export interface TrajectorySink {
  append(event: TrajectoryEventV1): Promise<void>;
}

export interface StoredOutcome {
  kind: 'accepted' | 'ignored' | 'reconciled' | 'terminal' | 'error';
  sessionId: SessionId;
  messageId: MessageId;
  revision: number;
  state: CanonicalSessionState;
  pendingActionIds: ActionId[];
  terminalReason?: TerminalReason;
  error?: { code: EngineErrorCode; message: string };
}

export interface ActiveAction {
  actionId: ActionId;
  stepId: StepId;
  observationId: ObservationV1['observationId'];
  proposal: ActionProposalV1;
  policyDecision: PolicyDecisionV1;
  command: ActionCommandV1;
}

export interface PendingApproval {
  actionId: ActionId;
  stepId: StepId;
  observationId: ObservationV1['observationId'];
  proposal: ActionProposalV1;
  policyDecision: PolicyDecisionV1;
}

export interface CanonicalSession {
  sessionId: SessionId;
  taskId: TaskId;
  goal: string;
  completionCriteria: string[];
  state: CanonicalSessionState;
  revision: number;
  nextSequence: number;
  startedAt: string;
  updatedAt: string;
  lastObservation: ObservationV1 | null;
  activeInferenceId: string | null;
  activeAction: ActiveAction | null;
  pendingApproval: PendingApproval | null;
  recentResults: ActionResultV1[];
  processedMessages: Record<string, StoredOutcome>;
  completedActions: Record<string, StoredOutcome>;
  actionSignatures: string[];
  observationSignatures: string[];
  consecutiveActionFailures: number;
  consecutiveNoVerifiedEffect: number;
  inferenceRepairAttempts: number;
  stepCount: number;
  terminalReason: TerminalReason | null;
}

export interface SessionStore {
  load(sessionId: SessionId): Promise<CanonicalSession | null>;
  compareAndSwap(session: CanonicalSession, expectedRevision: number): Promise<void>;
  getProcessed(messageId: MessageId): Promise<StoredOutcome | null>;
}

interface EventMetadata {
  sessionId: SessionId;
  messageId: MessageId;
  occurredAt: string;
}

export type SessionEngineEvent =
  | (EventMetadata & {
      type: 'session.open';
      taskId: TaskId;
      goal: string;
      completionCriteria: string[];
    })
  | (EventMetadata & {
      type: 'observation.submitted';
      observation: ObservationV1;
    })
  | (EventMetadata & {
      type: 'approval.resolved';
      resolution: ApprovalResolutionV1;
    })
  | (EventMetadata & {
      type: 'action.completed';
      result: ActionResultV1;
    })
  | (EventMetadata & {
      type: 'reconcile.request';
      lastReceivedSequence: number;
      pendingActionIds: ActionId[];
    })
  | (EventMetadata & {
      type: 'task.cancelled';
      reason: string;
    });

export type EngineErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_ALREADY_EXISTS'
  | 'SESSION_TERMINAL'
  | 'STALE_ACTION_RESULT'
  | 'STALE_APPROVAL_RESOLUTION'
  | 'STORE_CONFLICT';

export class SessionEngineError extends Error {
  constructor(
    public readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SessionEngineError';
  }
}

export interface SessionEngineOptions {
  store: SessionStore;
  inference: InferencePort;
  policy: PolicyPort;
  commandSink: CommandSink;
  trajectorySink: TrajectorySink;
  budgets?: Partial<EngineBudgets>;
  now?: () => string;
  idGenerator?: () => string;
}
