import type {
  ActionCommandV1,
  ActionId,
  ActionProposalV1,
  ActionResultV1,
  ApprovalResolutionV1,
  CompletionProposalV1,
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
  | 'WAITING_FOR_USER'
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
  | 'INFERENCE_REPAIR_EXHAUSTED'
  | 'VERIFIER_FAILURE_LIMIT_REACHED';

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
  maxVerifierFailures: number;
}

export interface PlanningInput {
  workId: string;
  sessionId: SessionId;
  taskId: TaskId;
  goal: string;
  completionCriteria: string[];
  observation: ObservationV1;
  recentResults: ActionResultV1[];
  trajectory: TrajectoryEventV1[];
}

export interface PolicyInput {
  workId: string;
  sessionId: SessionId;
  taskId: TaskId;
  actionId: ActionId;
  policyDecisionId: PolicyDecisionV1['policyDecisionId'];
  proposal: ActionProposalV1;
  observation: ObservationV1;
}

export interface InferencePort {
  plan(input: PlanningInput, signal: AbortSignal): Promise<PlanningOutcome>;
}

export interface QuestionProposal {
  kind: 'question';
  observationId: ObservationV1['observationId'];
  question: string;
  choices?: string[];
}

export type PlanningOutcome = ActionProposalV1 | CompletionProposalV1 | QuestionProposal;

export interface PolicyPort {
  evaluate(input: PolicyInput, signal: AbortSignal): Promise<PolicyDecisionV1>;
}

export type CompletionVerificationCode =
  | 'VERIFIED_COMPLETION'
  | 'INSUFFICIENT_EVIDENCE'
  | 'STALE_EVIDENCE'
  | 'UNMET_CRITERIA'
  | 'SPECULATIVE_EVIDENCE'
  | 'MODEL_REPORTED_FAILURE';

export interface CompletionVerificationDecision {
  outcome: 'accepted' | 'continue' | 'failed';
  accepted: boolean;
  code: CompletionVerificationCode;
  reason: string;
}

export interface CompletionVerificationPort {
  verify(
    proposal: CompletionProposalV1,
    trajectory: TrajectoryEventV1[],
  ): CompletionVerificationDecision;
}

export class InferenceContractError extends Error {
  readonly code = 'INFERENCE_CONTRACT_ERROR';

  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'InferenceContractError';
  }
}

export interface CommandSink {
  send(command: ActionCommandV1): Promise<void>;
}

export interface TrajectorySink {
  /** Append is idempotent by event.eventId. */
  append(event: TrajectoryEventV1): Promise<void>;
}

export interface StoredOutcome {
  kind: 'accepted' | 'ignored' | 'reconciled' | 'terminal' | 'error';
  sessionId: SessionId;
  messageId: MessageId;
  revision: number;
  state: CanonicalSessionState;
  pendingActionIds: ActionId[];
  requiresFreshObservation?: boolean;
  terminalReason?: TerminalReason;
  error?: { code: EngineErrorCode; message: string };
}

export interface CommandDelivery {
  status: 'pending' | 'sent';
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
}

export interface TrajectoryDelivery {
  event: TrajectoryEventV1;
  status: 'pending' | 'sent';
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
}

export interface PendingPostObservation {
  messageId: MessageId;
  observation: ObservationV1;
}

export interface ActiveAction {
  actionId: ActionId;
  stepId: StepId;
  observationId: ObservationV1['observationId'];
  proposal: ActionProposalV1;
  policyDecision: PolicyDecisionV1;
  command: ActionCommandV1;
  delivery: CommandDelivery;
}

export interface PendingPolicy {
  causationMessageId: MessageId;
  actionId: ActionId;
  stepId: StepId;
  observationId: ObservationV1['observationId'];
  policyDecisionId: PolicyDecisionV1['policyDecisionId'];
  proposal: ActionProposalV1;
}

export interface PendingApproval {
  actionId: ActionId;
  stepId: StepId;
  observationId: ObservationV1['observationId'];
  proposal: ActionProposalV1;
  policyDecision: PolicyDecisionV1;
}

export type PendingUserQuestion = Omit<QuestionProposal, 'kind'>;

export interface WorkClaim {
  kind: 'inference' | 'policy';
  workId: string;
  claimantId: string;
  leaseExpiresAt: string;
}

export interface CanonicalSession {
  sessionId: SessionId;
  taskId: TaskId;
  goal: string;
  completionCriteria: string[];
  state: CanonicalSessionState;
  revision: number;
  nextSequence: number;
  eventSequence: number;
  trajectoryOutbox: TrajectoryDelivery[];
  startedAt: string;
  updatedAt: string;
  lastObservation: ObservationV1 | null;
  activeInferenceId: string | null;
  workClaim: WorkClaim | null;
  activeAction: ActiveAction | null;
  pendingPostObservation: PendingPostObservation | null;
  pendingPolicy: PendingPolicy | null;
  pendingApproval: PendingApproval | null;
  pendingUserQuestion: PendingUserQuestion | null;
  recentResults: ActionResultV1[];
  processedMessages: Record<string, StoredOutcome>;
  completedActions: Record<string, { result: ActionResultV1; outcome: StoredOutcome }>;
  actionSignatures: string[];
  observationSignatures: string[];
  consecutiveActionFailures: number;
  consecutiveNoVerifiedEffect: number;
  inferenceRepairAttempts: number;
  verifierFailureCount: number;
  maxVerifierFailures: number;
  stepCount: number;
  terminalReason: TerminalReason | null;
}

export interface SessionStore {
  load(sessionId: SessionId): Promise<CanonicalSession | null>;
  transition(
    session: CanonicalSession,
    expectedRevision: number,
    outcome?: StoredOutcome,
    expectedConnectionFence?: number,
  ): Promise<void>;
  compareAndSwap(session: CanonicalSession, expectedRevision: number, expectedConnectionFence?: number): Promise<void>;
  getProcessed(messageId: MessageId): Promise<StoredOutcome | null>;
  claimConnectionFence?(sessionId: SessionId, fence: number): Promise<boolean>;
  admitInbound?(input: { sessionId: SessionId; messageId: MessageId; sequence: number; event: SessionEngineEvent }): Promise<'accepted' | 'resume' | 'duplicate' | 'gap'>;
  loadInbound?(messageId: MessageId): Promise<SessionEngineEvent | null>;
}

interface EventMetadata {
  sessionId: SessionId;
  messageId: MessageId;
  occurredAt: string;
  connectionFence?: number;
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
      lastSentClientSequence: number;
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
  | 'STALE_PROPOSAL'
  | 'STALE_POLICY_DECISION'
  | 'STALE_ACTION_RESULT'
  | 'STALE_APPROVAL_RESOLUTION'
  | 'STORE_CONFLICT'
  | 'STALE_CONNECTION_FENCE';

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
  completionVerifier?: CompletionVerificationPort;
  budgets?: Partial<EngineBudgets>;
  now?: () => string;
  idGenerator?: () => string;
  claimantId?: string;
  workClaimTtlMs?: number;
}
