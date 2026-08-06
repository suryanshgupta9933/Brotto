/**
 * Policy Engine Package
 *
 * A comprehensive policy enforcement library for the Brotto Browser Automation Platform.
 * Provides critical action classification, domain allowlisting, policy evaluation,
 * approval management, consequence description, budget tracking, and session state checking.
 *
 * @package policy-engine
 */

// Re-export all public types and classes

// Classifier
export {
  CriticalActionType,
  ActionContext,
  ActionContextSchema,
  ClassificationResult,
  ClassificationResultSchema,
  CriticalActionClassifier,
  getDefaultClassifier,
  classifyAction,
} from './classifier.js';

// Allowlist
export {
  DomainEvaluationResult,
  DomainEvaluationResultSchema,
  DomainEntry,
  DomainEntrySchema,
  DomainAllowlistConfig,
  DomainAllowlistConfigSchema,
  DomainAllowlistEvaluator,
  getDefaultEvaluator,
  evaluateDomain,
} from './allowlist.js';

// Rules
export {
  PolicyDecision,
  PolicyDecisionSchema,
  PolicyEffect,
  PolicyEffectSchema,
  ConditionOperator,
  ConditionOperatorSchema,
  PolicyCondition,
  PolicyConditionSchema,
  ConditionGroup,
  ConditionGroupSchema,
  PolicyRule,
  PolicyRuleSchema,
  PolicyEvaluationContext,
  PolicyEvaluationContextSchema,
  PolicyEvaluationResult,
  PolicyEvaluationResultSchema,
  PolicySet,
  PolicySetSchema,
  PolicyEngine,
  createDefaultStrictPolicySet,
  getDefaultPolicyEngine,
} from './rules.js';

// Approval
export {
  ApprovalStatus,
  ApprovalStatusSchema,
  ApprovalUrgency,
  ApprovalUrgencySchema,
  DataField,
  DataFieldSchema,
  Consequence,
  ConsequenceSchema,
  ActionTarget,
  ActionTargetSchema,
  ApprovalRequest,
  ApprovalRequestSchema,
  ApprovalDecision,
  ApprovalDecisionSchema,
  ApprovalResponse,
  ApprovalResponseSchema,
  CreateApprovalRequestOptions,
  CreateApprovalRequestOptionsSchema,
  BatchApprovalOptions,
  BatchApprovalOptionsSchema,
  ApprovalRequestFactory,
  ApprovalRequestManager,
  getDefaultApprovalManager,
} from './approval.js';

// Consequences
export {
  ConsequenceTemplate,
  ConsequenceTemplateSchema,
  generateConsequence,
  generateMultipleConsequences,
  generateRiskAssessment,
  ConsequenceGenerator,
} from './consequences.js';

// Budget
export {
  BudgetConfig,
  BudgetConfigSchema,
  BudgetUsage,
  BudgetUsageSchema,
  ExhaustionStrategy,
  ExhaustionStrategySchema,
  BudgetCheckResult,
  BudgetCheckResultSchema,
  BudgetStatus,
  BudgetStatusSchema,
  TokenPricing,
  PRESET_BUDGETS,
  BudgetTracker,
  createBudgetTracker,
  getDefaultBudgetTracker,
} from './budget.js';

// Checker
export {
  SessionState,
  SessionStateSchema,
  PolicyCheckResult,
  PolicyCheckResultSchema,
  PolicyCheckOptions,
  SessionPolicyCheckerConfig,
  SessionPolicyChecker,
  getDefaultPolicyChecker,
  checkAction,
} from './checker.js';
