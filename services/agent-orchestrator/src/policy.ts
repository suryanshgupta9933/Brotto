/**
 * Policy Integration
 *
 * Integrates with the policy-engine package to evaluate actions,
 * request approvals, and enforce security policies as specified in
 * ARCHITECTURE.md section 3.2 and 8.3-8.6
 */

import {
  CriticalActionClassifier,
  type ActionContext,
  type ClassificationResult,
  getDefaultClassifier,
  type ApprovalRequest,
  ApprovalRequestFactory,
  type ApprovalResponse,
  ApprovalRequestManager,
  type PolicyEvaluationResult,
  PolicyEngine,
  type PolicyEvaluationContext,
  type ActionTarget,
  type Consequence,
  getDefaultPolicyEngine,
  type BudgetTracker,
  type BudgetCheckResult,
} from 'policy-engine';
import { ActionType, type FaraAction } from '@fara-platform/fara-action-schema';

/**
 * Policy evaluation result for orchestrator
 */
export interface PolicyEvaluationOrchestratorResult {
  allowed: boolean;
  requiresApproval: boolean;
  approvalRequest?: ApprovalRequest;
  classification?: ClassificationResult;
  policyResult?: PolicyEvaluationResult;
  budgetResult?: BudgetCheckResult;
  reason: string;
}

/**
 * Policy integration configuration
 */
export interface PolicyConfig {
  sessionId: string;
  userId: string;
  classifier?: CriticalActionClassifier;
  policyEngine?: PolicyEngine;
  approvalManager?: ApprovalRequestManager;
  budgetTracker?: BudgetTracker;
  defaultTimeoutMs?: number;
}

/**
 * Policy integrator for the agent orchestrator
 *
 * Per ARCHITECTURE.md section 3.2:
 * - Request policy approval for critical actions
 * - Enforce security policies
 *
 * Per ARCHITECTURE.md section 8.3:
 * - Critical-action approval for sign_in, enter_password, etc.
 */
export class PolicyIntegrator {
  private sessionId: string;
  private classifier: CriticalActionClassifier;
  private policyEngine: PolicyEngine;
  private approvalManager: ApprovalRequestManager;
  private budgetTracker: BudgetTracker | undefined;
  private defaultTimeoutMs: number;

  constructor(config: PolicyConfig) {
    this.sessionId = config.sessionId;
    this.classifier = config.classifier ?? getDefaultClassifier();
    this.policyEngine = config.policyEngine ?? getDefaultPolicyEngine();
    this.approvalManager = config.approvalManager ?? new ApprovalRequestManager();
    this.budgetTracker = config.budgetTracker;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 300000; // 5 minutes
  }

  /**
   * Evaluate an action against policies
   *
   * Returns whether the action is allowed, requires approval, or should be blocked
   */
  evaluateAction(
    action: FaraAction,
    context: {
      domain: string;
      url: string;
      formFields?: Record<string, string>;
      isAuthenticatedSession?: boolean;
    }
  ): PolicyEvaluationOrchestratorResult {
    // First check budget
    if (this.budgetTracker) {
      const budgetResult = this.budgetTracker.check();
      if (!budgetResult.allowed) {
        return {
          allowed: false,
          requiresApproval: false,
          reason: `Budget exhausted: ${budgetResult.exhaustedBudgets.join(', ')}`,
          budgetResult,
        };
      }
    }

    // Classify the action
    const actionContext: ActionContext = {
      domain: context.domain,
      url: context.url,
      formFields: context.formFields,
      isAuthenticatedSession: context.isAuthenticatedSession,
      actionDescription: this.getActionDescription(action),
    };

    const classification = this.classifier.classify(action.type, actionContext);

    // Evaluate against policy engine
    const policyContext: PolicyEvaluationContext = {
      actionName: action.type,
      actionType: classification.actionType,
      domain: context.domain,
      url: context.url,
      context: actionContext,
    };

    const policyResult = this.policyEngine.evaluate(policyContext);

    // Determine if approval is required
    let requiresApproval = false;
    let approvalRequest: ApprovalRequest | undefined;

    if (classification.requiresApproval || policyResult.requiresApproval) {
      requiresApproval = true;
    }

    // Check policy decision
    if (policyResult.decision === 'deny' || policyResult.decision === 'block') {
      return {
        allowed: false,
        requiresApproval: false,
        classification,
        policyResult,
        reason: policyResult.reason,
      };
    }

    // If requires approval, create approval request
    if (requiresApproval) {
      const actionTarget: ActionTarget = {
        domain: context.domain,
        url: context.url,
        fieldNames: context.formFields ? Object.keys(context.formFields) : undefined,
      };

      const consequence: Consequence = {
        summary: this.generateConsequenceSummary(action, classification),
        risks: this.generateRiskList(classification),
        expectedOutcome: this.generateExpectedOutcome(action),
        reversible: this.isReversibleAction(action.type),
      };

      approvalRequest = ApprovalRequestFactory.fromClassification(
        this.sessionId,
        action.type,
        classification.actionType,
        classification,
        actionTarget,
        consequence
      );

      this.approvalManager.add(approvalRequest);

      return {
        allowed: false,
        requiresApproval: true,
        approvalRequest,
        classification,
        policyResult,
        reason: `Action requires approval: ${classification.reason}`,
      };
    }

    return {
      allowed: true,
      requiresApproval: false,
      classification,
      policyResult,
      reason: 'Action allowed by policy',
    };
  }

  /**
   * Check approval response
   */
  checkApproval(approvalId: string): {
    approved: boolean;
    denied: boolean;
    pending: boolean;
    expired: boolean;
    cancelled: boolean;
  } {
    const request = this.approvalManager.get(approvalId);
    if (!request) {
      return {
        approved: false,
        denied: false,
        pending: false,
        expired: false,
        cancelled: true,
      };
    }

    return {
      approved: request.status === 'approved',
      denied: request.status === 'denied',
      pending: request.status === 'pending',
      expired: request.status === 'expired',
      cancelled: request.status === 'cancelled',
    };
  }

  /**
   * Respond to approval request
   */
  respondToApproval(response: ApprovalResponse): ApprovalRequest | undefined {
    return this.approvalManager.respond(response);
  }

  /**
   * Get pending approvals for session
   */
  getPendingApprovals(): ApprovalRequest[] {
    return this.approvalManager.getPendingForSession(this.sessionId);
  }

  /**
   * Expire old pending requests
   */
  expireOldRequests(maxAgeMs?: number): string[] {
    return this.approvalManager.expireOldRequests(maxAgeMs ?? this.defaultTimeoutMs);
  }

  /**
   * Clear session approvals
   */
  clearSessionApprovals(): void {
    this.approvalManager.clearSession(this.sessionId);
  }

  /**
   * Get action description for logging
   */
  private getActionDescription(action: FaraAction): string {
    switch (action.type) {
      case ActionType.VISIT_URL:
        return `Navigate to ${action.url}`;
      case ActionType.LEFT_CLICK:
        return `Click at (${action.coordinates.x}, ${action.coordinates.y})`;
      case ActionType.DOUBLE_CLICK:
        return `Double-click at (${action.coordinates.x}, ${action.coordinates.y})`;
      case ActionType.RIGHT_CLICK:
        return `Right-click at (${action.coordinates.x}, ${action.coordinates.y})`;
      case ActionType.DRAG:
        return `Drag from (${action.coordinates.start.x}, ${action.coordinates.start.y}) to (${action.coordinates.end.x}, ${action.coordinates.end.y})`;
      case ActionType.MOUSE_MOVE:
        return `Move mouse to (${action.coordinates.x}, ${action.coordinates.y})`;
      case ActionType.SCROLL:
        return `Scroll at (${action.coordinates.x}, ${action.coordinates.y}) by (${action.delta.deltaX}, ${action.delta.deltaY})`;
      case ActionType.KEY:
        return `Press key: ${action.key}`;
      case ActionType.HISTORY_BACK:
        return `Navigate back ${action.steps || 1} step(s)`;
      case ActionType.SCREENSHOT:
        return 'Take screenshot';
      case ActionType.WAIT:
        return `Wait for ${action.duration}ms`;
      case ActionType.ASK_USER_QUESTION:
        return `Ask user: ${action.question}`;
      case ActionType.TERMINATE:
        return `Terminate session${action.reason ? `: ${action.reason}` : ''}`;
      case ActionType.PAUSE_AND_MEMORIZE_FACT:
        return `Memorize: ${action.fact}`;
      default:
        return 'Unknown action';
    }
  }

  /**
   * Generate consequence summary
   */
  private generateConsequenceSummary(
    _action: FaraAction,
    classification: ClassificationResult
  ): string {
    const baseDescriptions: Record<string, string> = {
      sign_in: 'You will be signed in to the website',
      enter_password: 'A password will be entered',
      enter_otp: 'A verification code will be entered',
      enter_personal_info: 'Personal information will be submitted',
      send_email: 'An email will be sent',
      send_message: 'A message will be sent',
      publish_content: 'Content will be published',
      submit_form: 'A form will be submitted',
      make_purchase: 'A purchase will be made',
      accept_terms: 'Terms or agreement will be accepted',
      change_account_permissions: 'Account permissions will be changed',
      delete_data: 'Data will be deleted',
      upload_file: 'A file will be uploaded',
      download_sensitive: 'Sensitive data will be downloaded',
      navigate_to_domain: 'You will navigate to a different website',
    };

    const description = baseDescriptions[classification.actionType] || classification.reason;
    return description;
  }

  /**
   * Generate risk list for approval
   */
  private generateRiskList(classification: ClassificationResult): string[] {
    const risks: string[] = [];

    if (classification.riskLevel === 'critical') {
      risks.push('This action has critical risk and may have irreversible consequences');
    }
    if (classification.riskLevel === 'high') {
      risks.push('This action involves sensitive data or significant changes');
    }

    return risks;
  }

  /**
   * Generate expected outcome description
   */
  private generateExpectedOutcome(action: FaraAction): string {
    switch (action.type) {
      case ActionType.VISIT_URL:
        return `Browser will navigate to ${action.url}`;
      case ActionType.LEFT_CLICK:
        return 'Element at specified coordinates will be clicked';
      case ActionType.KEY:
        return `Keyboard key '${action.key}' will be pressed`;
      default:
        return 'Action will be executed in the browser';
    }
  }

  /**
   * Check if action is reversible
   */
  private isReversibleAction(actionType: ActionType): boolean {
    const irreversibleActions: ActionType[] = [
      ActionType.VISIT_URL, // May log user out
      ActionType.TERMINATE, // Cannot be undone
    ];
    return !irreversibleActions.includes(actionType);
  }
}

/**
 * Create a policy integrator with defaults
 */
export function createPolicyIntegrator(config: PolicyConfig): PolicyIntegrator {
  return new PolicyIntegrator(config);
}
