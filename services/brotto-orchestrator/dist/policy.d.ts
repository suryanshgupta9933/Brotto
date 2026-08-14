/**
 * Policy Integration
 *
 * Integrates with the policy-engine package to evaluate actions,
 * request approvals, and enforce security policies as specified in
 * ARCHITECTURE.md section 3.2 and 8.3-8.6
 */
import { CriticalActionClassifier, type ClassificationResult, type ApprovalRequest, type ApprovalResponse, ApprovalRequestManager, type PolicyEvaluationResult, PolicyEngine, type BudgetTracker, type BudgetCheckResult } from 'policy-engine';
import { type FaraAction } from '@brotto/brotto-action-schema';
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
export declare class PolicyIntegrator {
    private sessionId;
    private classifier;
    private policyEngine;
    private approvalManager;
    private budgetTracker;
    private defaultTimeoutMs;
    constructor(config: PolicyConfig);
    /**
     * Evaluate an action against policies
     *
     * Returns whether the action is allowed, requires approval, or should be blocked
     */
    evaluateAction(action: FaraAction, context: {
        domain: string;
        url: string;
        formFields?: Record<string, string>;
        isAuthenticatedSession?: boolean;
    }): PolicyEvaluationOrchestratorResult;
    /**
     * Check approval response
     */
    checkApproval(approvalId: string): {
        approved: boolean;
        denied: boolean;
        pending: boolean;
        expired: boolean;
        cancelled: boolean;
    };
    /**
     * Respond to approval request
     */
    respondToApproval(response: ApprovalResponse): ApprovalRequest | undefined;
    /**
     * Get pending approvals for session
     */
    getPendingApprovals(): ApprovalRequest[];
    /**
     * Expire old pending requests
     */
    expireOldRequests(maxAgeMs?: number): string[];
    /**
     * Clear session approvals
     */
    clearSessionApprovals(): void;
    /**
     * Get action description for logging
     */
    private getActionDescription;
    /**
     * Generate consequence summary
     */
    private generateConsequenceSummary;
    /**
     * Generate risk list for approval
     */
    private generateRiskList;
    /**
     * Generate expected outcome description
     */
    private generateExpectedOutcome;
    /**
     * Check if action is reversible
     */
    private isReversibleAction;
}
/**
 * Create a policy integrator with defaults
 */
export declare function createPolicyIntegrator(config: PolicyConfig): PolicyIntegrator;
//# sourceMappingURL=policy.d.ts.map