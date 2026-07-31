import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import {
  AuditEvent,
  AuditEventSchema,
  DeviceInfo,
  BrowserInfo,
  ScreenshotHash,
  ProposedAction,
  PolicyResult,
  ApprovalDecisionRecord,
  ExecutedAction,
  ErrorRecord,
  TerminationReason,
  SessionState,
  AuditEventRow,
} from './types.js';

export interface RecorderConfig {
  organizationId: string;
  userId: string;
  device: DeviceInfo;
  modelVersion?: string;
  promptTemplateVersion?: string;
}

export interface SessionContext {
  sessionId: string;
  organizationId: string;
  userId: string;
  creator: {
    userId: string;
    email?: string;
    name?: string;
  };
  device: DeviceInfo;
  browser?: BrowserInfo;
  modelVersion?: string;
  promptTemplateVersion?: string;
  currentDomain?: string;
  sessionState?: SessionState;
}

export class AuditRecorder {
  private context: SessionContext;
  private eventQueue: AuditEvent[] = [];
  private maxQueueSize: number;
  private flushIntervalMs: number;
  private flushTimer?: NodeJS.Timeout;
  private persistenceAdapter?: PersistenceAdapter;

  constructor(config: RecorderConfig) {
    this.context = {
      sessionId: uuidv4(),
      organizationId: config.organizationId,
      userId: config.userId,
      creator: {
        userId: config.userId,
      },
      device: config.device,
      modelVersion: config.modelVersion,
      promptTemplateVersion: config.promptTemplateVersion,
    };
    this.maxQueueSize = 100;
    this.flushIntervalMs = 5000;
    this.startFlushTimer();
  }

  setPersistenceAdapter(adapter: PersistenceAdapter): void {
    this.persistenceAdapter = adapter;
  }

  setBrowser(browser: BrowserInfo): void {
    this.context.browser = browser;
  }

  setCurrentDomain(domain: string): void {
    this.context.currentDomain = domain;
  }

  setSessionState(state: SessionState): void {
    this.context.sessionState = state;
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        console.error('Failed to flush audit events:', err);
      });
    }, this.flushIntervalMs);
  }

  async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    if (this.persistenceAdapter) {
      await this.persistenceAdapter.persistEvents(events);
    }
  }

  private enqueue(event: AuditEvent): void {
    this.eventQueue.push(event);
    if (this.eventQueue.length >= this.maxQueueSize) {
      this.flush().catch((err) => {
        console.error('Failed to flush audit events:', err);
      });
    }
  }

  private createBaseEvent(): AuditEvent {
    return {
      sessionId: this.context.sessionId,
      organizationId: this.context.organizationId,
      userId: this.context.userId,
      creator: this.context.creator,
      device: this.context.device,
      browser: this.context.browser,
      modelVersion: this.context.modelVersion,
      promptTemplateVersion: this.context.promptTemplateVersion,
      currentDomain: this.context.currentDomain,
      sessionState: this.context.sessionState,
      timestamp: new Date().toISOString(),
    };
  }

  // Session lifecycle events
  recordSessionCreated(): void {
    const event = this.createBaseEvent();
    event.sessionState = 'CREATED';
    this.enqueue(AuditEventSchema.parse(event));
  }

  recordSessionConnected(): void {
    const event = this.createBaseEvent();
    event.sessionState = 'CONNECTED';
    this.enqueue(AuditEventSchema.parse(event));
  }

  recordSessionTerminated(reason: TerminationReason): void {
    const event = this.createBaseEvent();
    event.sessionState = reasonToSessionState(reason);
    event.terminationReason = reason;
    this.enqueue(AuditEventSchema.parse(event));
    this.flush();
  }

  // Screenshot hash recording (NOT the actual screenshot)
  recordScreenshotHash(
    observationId: string,
    screenshotBuffer: Buffer,
    width?: number,
    height?: number,
    truncated: boolean = false
  ): void {
    const hash = crypto.createHash('sha256').update(screenshotBuffer).digest('hex');
    const event = this.createBaseEvent();
    event.screenshotHash = {
      observationId,
      screenshotHash: hash,
      screenshotTimestamp: new Date().toISOString(),
      width,
      height,
      truncated,
    };
    this.enqueue(AuditEventSchema.parse(event));
  }

  // Record only the hash directly (if screenshot is already hashed externally)
  recordScreenshotHashOnly(
    observationId: string,
    hash: string,
    width?: number,
    height?: number,
    truncated: boolean = false
  ): void {
    const event = this.createBaseEvent();
    event.screenshotHash = {
      observationId,
      screenshotHash: hash,
      screenshotTimestamp: new Date().toISOString(),
      width,
      height,
      truncated,
    };
    this.enqueue(AuditEventSchema.parse(event));
  }

  // Action proposal recording
  recordProposedAction(
    actionType: ProposedAction['actionType'],
    targetUrl?: string,
    targetDomain?: string,
    coordinates?: { x: number; y: number },
    payload?: Record<string, unknown>,
    reasoning?: string,
    observationId?: string
  ): string {
    const actionId = uuidv4();
    const event = this.createBaseEvent();
    event.proposedAction = {
      actionId,
      actionType,
      targetUrl,
      targetDomain,
      coordinates,
      payload,
      reasoning,
      observationId: observationId || this.context.sessionId,
    };
    event.sessionState = 'PLANNING';
    this.enqueue(AuditEventSchema.parse(event));
    return actionId;
  }

  // Policy result recording
  recordPolicyResult(
    actionId: string,
    decision: PolicyResult['decision'],
    reason?: string,
    requiresConsent: boolean = false,
    consentCategories?: string[]
  ): void {
    const event = this.createBaseEvent();
    event.policyResult = {
      policyId: uuidv4(),
      decision,
      reason,
      requiresConsent,
      consentCategories,
    };
    event.sessionState = 'POLICY_CHECK';
    this.enqueue(AuditEventSchema.parse(event));
  }

  // Approval decision recording
  recordApprovalDecision(
    actionId: string,
    decision: ApprovalDecisionRecord['decision'],
    approverId?: string,
    approverReason?: string
  ): string {
    const approvalId = uuidv4();
    const event = this.createBaseEvent();
    event.approvalDecision = {
      approvalId,
      decision,
      approverId,
      approverReason,
      approvedAt: new Date().toISOString(),
    };
    event.sessionState = 'WAITING_FOR_APPROVAL';
    this.enqueue(AuditEventSchema.parse(event));
    return approvalId;
  }

  // Execution recording
  recordExecutedAction(
    actionId: string,
    actionType: ExecutedAction['actionType'],
    coordinates?: { x: number; y: number },
    payload?: Record<string, unknown>,
    success: boolean = true,
    errorMessage?: string,
    errorCode?: string,
    executionDurationMs?: number
  ): string {
    const executionId = uuidv4();
    const event = this.createBaseEvent();
    event.executedAction = {
      executionId,
      actionId,
      actionType,
      coordinates,
      payload,
      executedAt: new Date().toISOString(),
      executionDurationMs,
      success,
      errorMessage,
      errorCode,
    };
    event.sessionState = 'EXECUTING';
    this.enqueue(AuditEventSchema.parse(event));
    return executionId;
  }

  // Error recording
  recordError(
    errorCode: string,
    errorMessage: string,
    severity: ErrorRecord['severity'] = 'ERROR',
    relatedActionId?: string,
    errorStack?: string
  ): string {
    const errorId = uuidv4();
    const event = this.createBaseEvent();
    event.error = {
      errorId,
      errorCode,
      errorMessage,
      errorStack,
      severity,
      occurredAt: new Date().toISOString(),
      sessionId: this.context.sessionId,
      relatedActionId,
    };
    this.enqueue(AuditEventSchema.parse(event));
    return errorId;
  }

  // Get current session context
  getSessionContext(): SessionContext {
    return { ...this.context };
  }

  // Shutdown the recorder
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    await this.flush();
  }
}

// Persistence adapter interface for database storage
export interface PersistenceAdapter {
  persistEvents(events: AuditEvent[]): Promise<void>;
  queryEvents(filters: QueryFilters): Promise<AuditEventRow[]>;
}

// Query filters for retrieving events
export interface QueryFilters {
  organizationId?: string;
  userId?: string;
  sessionId?: string;
  startDate?: Date;
  endDate?: Date;
  eventTypes?: string[];
  limit?: number;
  offset?: number;
}

// Helper function to convert termination reason to session state
function reasonToSessionState(reason: TerminationReason): SessionState {
  switch (reason) {
    case 'COMPLETED':
      return 'COMPLETED';
    case 'USER_CANCELLED':
    case 'FORCED_TERMINATION':
      return 'CANCELLED';
    case 'TIMEOUT':
    case 'BUDGET_EXCEEDED':
    case 'ERROR':
    case 'POLICY_VIOLATION':
    case 'CLIENT_DISCONNECTED':
      return 'FAILED';
    default:
      return 'FAILED';
  }
}

// Factory function for creating a recorder with full context
export function createAuditRecorder(config: RecorderConfig): AuditRecorder {
  return new AuditRecorder(config);
}
