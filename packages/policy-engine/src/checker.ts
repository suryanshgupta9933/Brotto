/**
 * Session State Policy Checker
 *
 * Evaluates the current session state against policy rules and budgets
 * to determine if actions can proceed.
 */

import { z } from 'zod';
import { CriticalActionClassifier, classifyAction, ActionContext, ClassificationResult, ClassificationResultSchema } from './classifier.js';
import { DomainAllowlistEvaluator, evaluateDomain, DomainEvaluationResult, DomainEvaluationResultSchema } from './allowlist.js';
import { PolicyEngine, PolicyEvaluationContext, PolicyEvaluationResult, createDefaultStrictPolicySet, PolicyDecisionSchema } from './rules.js';
import { ApprovalRequest, ApprovalRequestFactory, ApprovalRequestManager, ApprovalRequestSchema, ApprovalStatusSchema, ApprovalUrgencySchema, DataFieldSchema, ActionTargetSchema, ConsequenceSchema, Consequence } from './approval.js';
import { generateConsequence, ConsequenceTemplate } from './consequences.js';
import { BudgetTracker, BudgetStatus, BudgetCheckResult, BudgetConfig, BudgetCheckResultSchema, BudgetUsageSchema, BudgetStatusSchema } from './budget.js';

/**
 * Session state
 */
export const SessionStateSchema = z.object({
  id: z.string(),
  isAuthenticated: z.boolean().default(false),
  authenticatedDomains: z.array(z.string()).default([]),
  currentDomain: z.string().optional(),
  currentUrl: z.string().optional(),
  actionCount: z.number().default(0),
  failedActionCount: z.number().default(0),
  isPaused: z.boolean().default(false),
  isTerminated: z.boolean().default(false),
  startedAt: z.date().optional(),
  lastActivityAt: z.date().optional(),
});

export type SessionState = z.infer<typeof SessionStateSchema>;

/**
 * Policy check result
 */
export const PolicyCheckResultSchema = z.object({
  allowed: z.boolean(),
  requiresApproval: z.boolean(),
  approvalRequest: ApprovalRequestSchema.optional(),
  reason: z.string(),
  warnings: z.array(z.string()).optional(),
  budgets: BudgetCheckResultSchema.optional(),
});

export const PolicyCheckResult = PolicyCheckResultSchema;
export type PolicyCheckResult = z.infer<typeof PolicyCheckResultSchema>;

/**
 * Policy check options
 */
export interface PolicyCheckOptions {
  sessionId: string;
  actionName: string;
  domain: string;
  url?: string;
  formFields?: Record<string, string>;
  dataFields?: Array<{
    name: string;
    value?: string;
    masked?: boolean;
    sensitive?: boolean;
  }>;
  userConsent?: boolean;
}

/**
 * Session policy checker configuration
 */
export interface SessionPolicyCheckerConfig {
  classifier?: CriticalActionClassifier;
  evaluator?: DomainAllowlistEvaluator;
  policyEngine?: PolicyEngine;
  budgetTracker?: BudgetTracker;
  approvalManager?: ApprovalRequestManager;
  requireApprovalForCritical?: boolean;
  allowAuthenticatedActions?: boolean;
}

/**
 * Session state policy checker
 */
export class SessionPolicyChecker {
  private classifier: CriticalActionClassifier;
  private evaluator: DomainAllowlistEvaluator;
  private policyEngine: PolicyEngine;
  private budgetTracker: BudgetTracker;
  private approvalManager: ApprovalRequestManager;
  private requireApprovalForCritical: boolean;
  private allowAuthenticatedActions: boolean;
  private sessions: Map<string, SessionState>;

  constructor(config: SessionPolicyCheckerConfig = {}) {
    this.classifier = config.classifier || new CriticalActionClassifier();
    this.evaluator = config.evaluator || new DomainAllowlistEvaluator({});
    this.policyEngine = config.policyEngine || new PolicyEngine();
    this.budgetTracker = config.budgetTracker || new BudgetTracker();
    this.approvalManager = config.approvalManager || new ApprovalRequestManager();
    this.requireApprovalForCritical = config.requireApprovalForCritical ?? true;
    this.allowAuthenticatedActions = config.allowAuthenticatedActions ?? true;
    this.sessions = new Map();

    // Initialize with default strict policy if engine is empty
    if (this.policyEngine.getAllPolicySets().length === 0) {
      this.policyEngine.addPolicySet(createDefaultStrictPolicySet());
    }
  }

  /**
   * Register a new session
   */
  registerSession(sessionId: string): SessionState {
    const state: SessionState = {
      id: sessionId,
      isAuthenticated: false,
      authenticatedDomains: [],
      actionCount: 0,
      failedActionCount: 0,
      isPaused: false,
      isTerminated: false,
      startedAt: new Date(),
      lastActivityAt: new Date(),
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  /**
   * Get session state
   */
  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Update session state
   */
  updateSession(sessionId: string, updates: Partial<SessionState>): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    Object.assign(session, updates, { lastActivityAt: new Date() });
    return true;
  }

  /**
   * Mark session as authenticated for a domain
   */
  markAuthenticated(sessionId: string, domain: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    if (!session.authenticatedDomains.includes(domain)) {
      session.authenticatedDomains.push(domain);
    }
    session.isAuthenticated = true;
    session.lastActivityAt = new Date();
    return true;
  }

  /**
   * Remove a session
   */
  removeSession(sessionId: string): boolean {
    this.approvalManager.clearSession(sessionId);
    return this.sessions.delete(sessionId);
  }

  /**
   * Check if a proposed action is allowed
   */
  check(options: PolicyCheckOptions): PolicyCheckResult {
    const { sessionId, actionName, domain, url, formFields, dataFields, userConsent } = options;

    // Get or create session
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = this.registerSession(sessionId);
    }

    // Check if session is terminated or paused
    if (session.isTerminated) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: 'Session has been terminated',
      };
    }

    if (session.isPaused) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: 'Session is paused',
      };
    }

    // Update current domain
    session.currentDomain = domain;
    session.currentUrl = url;

    const warnings: string[] = [];

    // Step 1: Check domain allowlist
    const domainResult = this.evaluator.evaluate(domain);
    if (!domainResult.allowed) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Domain not allowed: ${domainResult.reason}`,
      };
    }

    if (domainResult.matchType !== 'none') {
      warnings.push(`Domain matched ${domainResult.matchType} rule`);
    }

    // Step 2: Classify the action
    const actionContext: ActionContext = {
      domain,
      url,
      formFields,
      hasUserConsent: userConsent,
      isAuthenticatedSession: session.isAuthenticated,
    };

    const classification = this.classifier.classify(actionName, actionContext);

    // Step 3: Check budget
    const budgetCheck = this.budgetTracker.check();
    if (!budgetCheck.allowed) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `Budget exhausted: ${budgetCheck.exhaustedBudgets.join(', ')}`,
        budgets: budgetCheck,
      };
    }

    if (budgetCheck.warnings) {
      warnings.push(...budgetCheck.warnings);
    }

    // Step 4: Evaluate against policy engine
    const policyContext: PolicyEvaluationContext = {
      actionName,
      actionType: classification.actionType,
      domain,
      url,
      context: actionContext,
      domainEvaluation: domainResult,
      sessionState: {
        isAuthenticated: session.isAuthenticated,
        sessionAge: session.startedAt
          ? Date.now() - session.startedAt.getTime()
          : 0,
        actionCount: session.actionCount,
        failedActionCount: session.failedActionCount,
      },
    };

    const policyResult = this.policyEngine.evaluate(policyContext);

    // Step 5: Determine if approval is required
    let requiresApproval = false;

    if (policyResult.requiresApproval) {
      requiresApproval = true;
    } else if (this.requireApprovalForCritical && classification.requiresApproval) {
      // Critical action classification requires approval
      requiresApproval = true;
    } else if (classification.riskLevel === 'critical') {
      requiresApproval = true;
    }

    // Check if already authenticated for this domain (may skip approval)
    if (
      requiresApproval &&
      this.allowAuthenticatedActions &&
      session.isAuthenticated &&
      session.authenticatedDomains.includes(domain)
    ) {
      // Already authenticated, may not need approval for certain actions
      const authExemptTypes = ['navigate_to_domain', 'submit_form', 'fill_credential'];
      if (authExemptTypes.includes(classification.actionType)) {
        requiresApproval = false;
      }
    }

    // Generate consequence description
    let consequence: Consequence | undefined;
    if (requiresApproval) {
      consequence = generateConsequence(
        classification.actionType,
        actionContext,
        dataFields?.map((f) => ({
          name: f.name,
          value: f.value,
          masked: f.masked ?? false,
          sensitive: f.sensitive ?? false,
        }))
      );
    }

    // Create approval request if needed
    let approvalRequest: ApprovalRequest | undefined;
    if (requiresApproval && consequence) {
      approvalRequest = ApprovalRequestFactory.create({
        sessionId,
        actionName,
        actionType: classification.actionType,
        target: {
          domain,
          url,
          fieldNames: dataFields?.map((f) => f.name),
        },
        data: dataFields?.map((f) => ({
          name: f.name,
          value: f.value,
          masked: f.masked ?? false,
          sensitive: f.sensitive ?? false,
        })),
        consequence,
        classification,
        policyDecision: policyResult.decision,
        matchedRules: policyResult.matchedRules,
        timeoutMs: 300000,
      });
      this.approvalManager.add(approvalRequest);
    }

    return {
      allowed: !requiresApproval,
      requiresApproval,
      approvalRequest,
      reason: requiresApproval
        ? `Action requires approval: ${classification.reason}`
        : policyResult.reason || 'Action allowed',
      warnings: warnings.length > 0 ? warnings : undefined,
      budgets: budgetCheck,
    };
  }

  /**
   * Record action execution
   */
  recordAction(sessionId: string, success: boolean = true): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.actionCount++;
    session.lastActivityAt = new Date();
    this.budgetTracker.recordAction();

    if (success) {
      this.budgetTracker.recordSuccess();
    } else {
      this.budgetTracker.recordFailedAction();
      session.failedActionCount++;
    }
  }

  /**
   * Record navigation
   */
  recordNavigation(sessionId: string, domain: string, url: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.currentDomain = domain;
    session.currentUrl = url;
    session.lastActivityAt = new Date();
    this.budgetTracker.recordNavigation(domain, url);
  }

  /**
   * Get budget status
   */
  getBudgetStatus(): BudgetStatus {
    return this.budgetTracker.getStatus();
  }

  /**
   * Get pending approvals for session
   */
  getPendingApprovals(sessionId: string): ApprovalRequest[] {
    return this.approvalManager.getPendingForSession(sessionId);
  }

  /**
   * Approve a pending request
   */
  approveRequest(requestId: string, responderId: string, reason?: string): boolean {
    const request = this.approvalManager.get(requestId);
    if (!request || request.status !== 'pending') {
      return false;
    }

    this.approvalManager.respond({
      requestId,
      decision: 'approve',
      reason,
      responderId,
      respondedAt: new Date(),
    });

    return true;
  }

  /**
   * Deny a pending request
   */
  denyRequest(requestId: string, responderId: string, reason?: string): boolean {
    const request = this.approvalManager.get(requestId);
    if (!request || request.status !== 'pending') {
      return false;
    }

    this.approvalManager.respond({
      requestId,
      decision: 'deny',
      reason,
      responderId,
      respondedAt: new Date(),
    });

    return true;
  }

  /**
   * Pause session
   */
  pauseSession(sessionId: string): boolean {
    return this.updateSession(sessionId, { isPaused: true });
  }

  /**
   * Resume session
   */
  resumeSession(sessionId: string): boolean {
    return this.updateSession(sessionId, { isPaused: false });
  }

  /**
   * Terminate session
   */
  terminateSession(sessionId: string): boolean {
    return this.updateSession(sessionId, { isTerminated: true });
  }

  /**
   * Update budget configuration
   */
  updateBudgetConfig(config: Partial<BudgetConfig>): void {
    this.budgetTracker.updateConfig(config);
  }

  /**
   * Add domain to allowlist
   */
  addToAllowlist(pattern: string, description?: string): void {
    this.evaluator.addToAllowlist(pattern, description);
  }

  /**
   * Add domain to blocklist
   */
  addToBlocklist(pattern: string, description?: string): void {
    this.evaluator.addToBlocklist(pattern, description);
  }

  /**
   * Get all sessions
   */
  getAllSessions(): SessionState[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get approval manager stats
   */
  getApprovalStats(): ReturnType<ApprovalRequestManager['getStats']> {
    return this.approvalManager.getStats();
  }

  /**
   * Expire old approval requests
   */
  expireOldRequests(maxAgeMs?: number): string[] {
    return this.approvalManager.expireOldRequests(maxAgeMs);
  }
}

// Default singleton instance
let defaultChecker: SessionPolicyChecker | null = null;

export function getDefaultPolicyChecker(): SessionPolicyChecker {
  if (!defaultChecker) {
    defaultChecker = new SessionPolicyChecker();
  }
  return defaultChecker;
}

/**
 * Convenience function to check a single action
 */
export function checkAction(options: PolicyCheckOptions): PolicyCheckResult {
  return getDefaultPolicyChecker().check(options);
}
