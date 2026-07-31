/**
 * Policy Rule Types and Evaluation Engine
 *
 * Defines policy rule schemas and provides evaluation logic for
 * determining if an action should be allowed, denied, or requires approval.
 */

import { z } from 'zod';
import { CriticalActionType, ActionContextSchema, ActionContext } from './classifier.js';
import { DomainEvaluationResultSchema, DomainEvaluationResult } from './allowlist.js';

/**
 * Policy decision types
 */
export const PolicyDecisionSchema = z.enum(['allow', 'deny', 'approve', 'block']);
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

/**
 * Policy effect - how a rule affects the decision
 */
export const PolicyEffectSchema = z.enum(['allow', 'deny', 'require_approval', 'log_only', 'block']);
export type PolicyEffect = z.infer<typeof PolicyEffectSchema>;

/**
 * Condition operators for rule matching
 */
export const ConditionOperatorSchema = z.enum([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'matches',
  'in',
  'not_in',
  'greater_than',
  'less_than',
  'regex',
]);
export type ConditionOperator = z.infer<typeof ConditionOperatorSchema>;

/**
 * Single condition for rule matching
 */
export const PolicyConditionSchema = z.object({
  field: z.string(),
  operator: ConditionOperatorSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
});

export type PolicyCondition = z.infer<typeof PolicyConditionSchema>;

/**
 * Condition group with AND/OR logic
 */
export const ConditionGroupSchema = z.object({
  and: z.array(z.lazy(() => PolicyConditionSchema)).optional(),
  or: z.array(z.lazy(() => PolicyConditionSchema)).optional(),
});

export type ConditionGroup = z.infer<typeof ConditionGroupSchema>;

/**
 * Policy rule definition
 */
export const PolicyRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  priority: z.number().default(0),
  effect: PolicyEffectSchema,
  enabled: z.boolean().default(true),
  conditions: z.union([PolicyConditionSchema, ConditionGroupSchema]).optional(),
  actionTypes: z.array(CriticalActionType).optional(),
  domains: z.array(z.string()).optional(),
  exemptDomains: z.array(z.string()).optional(),
  createdAt: z.date().optional(),
  expiresAt: z.date().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

/**
 * Policy evaluation context
 */
export const PolicyEvaluationContextSchema = z.object({
  actionName: z.string(),
  actionType: CriticalActionType.optional(),
  domain: z.string(),
  url: z.string().optional(),
  context: ActionContextSchema.optional(),
  domainEvaluation: DomainEvaluationResultSchema.optional(),
  sessionState: z
    .object({
      isAuthenticated: z.boolean().optional(),
      sessionAge: z.number().optional(),
      actionCount: z.number().optional(),
      failedActionCount: z.number().optional(),
    })
    .optional(),
});

export type PolicyEvaluationContext = z.infer<typeof PolicyEvaluationContextSchema>;

/**
 * Policy evaluation result
 */
export const PolicyEvaluationResultSchema = z.object({
  decision: PolicyDecisionSchema,
  reason: z.string(),
  matchedRules: z.array(z.string()),
  evaluatedAt: z.date(),
  requiresApproval: z.boolean(),
  approvalTypes: z.array(CriticalActionType).optional(),
});

export type PolicyEvaluationResult = z.infer<typeof PolicyEvaluationResultSchema>;

/**
 * Policy set containing multiple rules
 */
export const PolicySetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  rules: z.array(PolicyRuleSchema),
  defaultEffect: PolicyEffectSchema.default('allow'),
  enabled: z.boolean().default(true),
});

export type PolicySet = z.infer<typeof PolicySetSchema>;

/**
 * Check if a condition is satisfied
 */
function evaluateCondition(condition: PolicyCondition, context: Record<string, unknown>): boolean {
  const fieldValue = getNestedValue(context, condition.field);
  const targetValue = condition.value;

  switch (condition.operator) {
    case 'equals':
      return fieldValue === targetValue;

    case 'not_equals':
      return fieldValue !== targetValue;

    case 'contains':
      if (typeof fieldValue === 'string' && typeof targetValue === 'string') {
        return fieldValue.includes(targetValue);
      }
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(targetValue);
      }
      return false;

    case 'not_contains':
      if (typeof fieldValue === 'string' && typeof targetValue === 'string') {
        return !fieldValue.includes(targetValue);
      }
      if (Array.isArray(fieldValue)) {
        return !fieldValue.includes(targetValue);
      }
      return true;

    case 'starts_with':
      if (typeof fieldValue === 'string' && typeof targetValue === 'string') {
        return fieldValue.startsWith(targetValue);
      }
      return false;

    case 'ends_with':
      if (typeof fieldValue === 'string' && typeof targetValue === 'string') {
        return fieldValue.endsWith(targetValue);
      }
      return false;

    case 'matches':
    case 'regex':
      if (typeof fieldValue === 'string' && typeof targetValue === 'string') {
        try {
          return new RegExp(targetValue).test(fieldValue);
        } catch {
          return false;
        }
      }
      return false;

    case 'in':
      if (Array.isArray(targetValue)) {
        return targetValue.includes(fieldValue as string);
      }
      return false;

    case 'not_in':
      if (Array.isArray(targetValue)) {
        return !targetValue.includes(fieldValue as string);
      }
      return true;

    case 'greater_than':
      if (typeof fieldValue === 'number' && typeof targetValue === 'number') {
        return fieldValue > targetValue;
      }
      return false;

    case 'less_than':
      if (typeof fieldValue === 'number' && typeof targetValue === 'number') {
        return fieldValue < targetValue;
      }
      return false;

    default:
      return false;
  }
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Evaluate a condition group
 */
function evaluateConditionGroup(
  group: ConditionGroup,
  context: Record<string, unknown>
): boolean {
  // Evaluate AND conditions
  if (group.and && group.and.length > 0) {
    const andResults = group.and.map((c) => evaluateCondition(c, context));
    if (!andResults.every((r) => r)) {
      return false;
    }
  }

  // Evaluate OR conditions
  if (group.or && group.or.length > 0) {
    const orResults = group.or.map((c) => evaluateCondition(c, context));
    if (!orResults.some((r) => r)) {
      return false;
    }
  }

  // If no conditions failed and we had some conditions, return true
  if ((group.and && group.and.length > 0) || (group.or && group.or.length > 0)) {
    return true;
  }

  return false;
}

/**
 * Check if a rule matches the given context
 */
function ruleMatches(
  rule: PolicyRule,
  context: PolicyEvaluationContext
): boolean {
  // Check if rule is enabled
  if (!rule.enabled) {
    return false;
  }

  // Check if rule is expired
  if (rule.expiresAt && rule.expiresAt < new Date()) {
    return false;
  }

  // Check action type filter
  if (rule.actionTypes && rule.actionTypes.length > 0) {
    if (!context.actionType || !rule.actionTypes.includes(context.actionType)) {
      return false;
    }
  }

  // Check domain filter
  if (rule.domains && rule.domains.length > 0) {
    const domainMatches = rule.domains.some(
      (pattern) =>
        context.domain === pattern ||
        context.domain.endsWith('.' + pattern) ||
        new RegExp(pattern.replace(/\*/g, '.*')).test(context.domain)
    );
    if (!domainMatches) {
      return false;
    }
  }

  // Check exempt domains
  if (rule.exemptDomains && rule.exemptDomains.length > 0) {
    const exemptMatches = rule.exemptDomains.some(
      (pattern) =>
        context.domain === pattern ||
        context.domain.endsWith('.' + pattern) ||
        new RegExp(pattern.replace(/\*/g, '.*')).test(context.domain)
    );
    if (exemptMatches) {
      return false; // Rule doesn't apply to exempt domains
    }
  }

  // Evaluate conditions if present
  if (rule.conditions) {
    // Build flat context for condition evaluation
    const flatContext: Record<string, unknown> = {
      actionName: context.actionName,
      actionType: context.actionType,
      domain: context.domain,
      url: context.url,
      ...(context.sessionState || {}),
    };

    // Add context fields if present
    if (context.context) {
      Object.assign(flatContext, {
        hasUserConsent: context.context.hasUserConsent,
        isAuthenticatedSession: context.context.isAuthenticatedSession,
        actionDescription: context.context.actionDescription,
      });
    }

    // Check if conditions is a group or single condition
    if ('and' in rule.conditions || 'or' in rule.conditions) {
      if (!evaluateConditionGroup(rule.conditions as ConditionGroup, flatContext)) {
        return false;
      }
    } else {
      if (!evaluateCondition(rule.conditions as PolicyCondition, flatContext)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Policy evaluation engine
 */
export class PolicyEngine {
  private policySets: Map<string, PolicySet>;

  constructor() {
    this.policySets = new Map();
  }

  /**
   * Add a policy set
   */
  addPolicySet(policySet: PolicySet): void {
    this.policySets.set(policySet.id, policySet);
  }

  /**
   * Remove a policy set
   */
  removePolicySet(id: string): boolean {
    return this.policySets.delete(id);
  }

  /**
   * Get a policy set by ID
   */
  getPolicySet(id: string): PolicySet | undefined {
    return this.policySets.get(id);
  }

  /**
   * Get all policy sets
   */
  getAllPolicySets(): PolicySet[] {
    return Array.from(this.policySets.values());
  }

  /**
   * Add a rule to a policy set
   */
  addRule(policySetId: string, rule: PolicyRule): boolean {
    const policySet = this.policySets.get(policySetId);
    if (!policySet) {
      return false;
    }
    policySet.rules.push(rule);
    return true;
  }

  /**
   * Remove a rule from a policy set
   */
  removeRule(policySetId: string, ruleId: string): boolean {
    const policySet = this.policySets.get(policySetId);
    if (!policySet) {
      return false;
    }
    const index = policySet.rules.findIndex((r) => r.id === ruleId);
    if (index !== -1) {
      policySet.rules.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Evaluate a context against all policy sets
   */
  evaluate(context: PolicyEvaluationContext): PolicyEvaluationResult {
    const matchedRules: PolicyRule[] = [];
    let finalDecision: PolicyDecision = 'allow';
    const approvalTypes: Set<CriticalActionType> = new Set();

    // Collect all enabled policy sets
    const enabledPolicySets = Array.from(this.policySets.values()).filter(
      (ps) => ps.enabled
    );

    // If no policy sets, use default allow
    if (enabledPolicySets.length === 0) {
      return {
        decision: 'allow',
        reason: 'No policy sets configured, defaulting to allow',
        matchedRules: [],
        evaluatedAt: new Date(),
        requiresApproval: false,
      };
    }

    // Sort rules by priority (higher first)
    const allRules = enabledPolicySets
      .flatMap((ps) => ps.rules)
      .filter((r) => r.enabled && (!r.expiresAt || r.expiresAt > new Date()))
      .sort((a, b) => b.priority - a.priority);

    // Evaluate rules in priority order
    for (const rule of allRules) {
      if (ruleMatches(rule, context)) {
        matchedRules.push(rule);

        switch (rule.effect) {
          case 'deny':
            return {
              decision: 'deny',
              reason: `Denied by rule: ${rule.name}`,
              matchedRules: matchedRules.map((r) => r.id),
              evaluatedAt: new Date(),
              requiresApproval: false,
            };

          case 'block':
            return {
              decision: 'block',
              reason: `Blocked by rule: ${rule.name}`,
              matchedRules: matchedRules.map((r) => r.id),
              evaluatedAt: new Date(),
              requiresApproval: false,
            };

          case 'require_approval':
            finalDecision = 'approve';
            if (rule.actionTypes) {
              rule.actionTypes.forEach((t) => approvalTypes.add(t));
            } else if (context.actionType) {
              approvalTypes.add(context.actionType);
            }
            break;

          case 'allow':
          case 'log_only':
            // Continue evaluating other rules
            break;
        }
      }
    }

    // If we found any require_approval rules, return approve
    if (finalDecision === 'approve') {
      return {
        decision: 'approve',
        reason: matchedRules.length > 0
          ? `Requires approval based on ${matchedRules.length} matching rule(s)`
          : 'Requires approval (default)',
        matchedRules: matchedRules.map((r) => r.id),
        evaluatedAt: new Date(),
        requiresApproval: true,
        approvalTypes: Array.from(approvalTypes),
      };
    }

    // Default decision based on most recent policy set's default effect
    const defaultEffect = enabledPolicySets[enabledPolicySets.length - 1].defaultEffect;

    return {
      decision: defaultEffect === 'deny' ? 'deny' : 'allow',
      reason: matchedRules.length > 0
        ? `Allowed by default (${matchedRules.length} matching rule(s) with allow/log_only effect)`
        : 'Allowed by default (no matching rules)',
      matchedRules: matchedRules.map((r) => r.id),
      evaluatedAt: new Date(),
      requiresApproval: false,
    };
  }

  /**
   * Evaluate with a specific policy set only
   */
  evaluateWithPolicySet(policySetId: string, context: PolicyEvaluationContext): PolicyEvaluationResult {
    const policySet = this.policySets.get(policySetId);
    if (!policySet) {
      return {
        decision: 'deny',
        reason: `Policy set not found: ${policySetId}`,
        matchedRules: [],
        evaluatedAt: new Date(),
        requiresApproval: false,
      };
    }

    const matchedRules: PolicyRule[] = [];
    let finalDecision: PolicyDecision = 'allow';
    const approvalTypes: Set<CriticalActionType> = new Set();

    // Sort rules by priority
    const sortedRules = [...policySet.rules]
      .filter((r) => r.enabled && (!r.expiresAt || r.expiresAt > new Date()))
      .sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      if (ruleMatches(rule, context)) {
        matchedRules.push(rule);

        switch (rule.effect) {
          case 'deny':
            return {
              decision: 'deny',
              reason: `Denied by rule: ${rule.name}`,
              matchedRules: matchedRules.map((r) => r.id),
              evaluatedAt: new Date(),
              requiresApproval: false,
            };

          case 'block':
            return {
              decision: 'block',
              reason: `Blocked by rule: ${rule.name}`,
              matchedRules: matchedRules.map((r) => r.id),
              evaluatedAt: new Date(),
              requiresApproval: false,
            };

          case 'require_approval':
            finalDecision = 'approve';
            if (rule.actionTypes) {
              rule.actionTypes.forEach((t) => approvalTypes.add(t));
            }
            break;

          case 'allow':
          case 'log_only':
            break;
        }
      }
    }

    if (finalDecision === 'approve') {
      return {
        decision: 'approve',
        reason: `Requires approval by rule: ${matchedRules.find((r) => r.effect === 'require_approval')?.name}`,
        matchedRules: matchedRules.map((r) => r.id),
        evaluatedAt: new Date(),
        requiresApproval: true,
        approvalTypes: Array.from(approvalTypes),
      };
    }

    return {
      decision: policySet.defaultEffect === 'deny' ? 'deny' : 'allow',
      reason: matchedRules.length > 0
        ? 'Allowed by matching rules'
        : `Allowed by default (defaultEffect: ${policySet.defaultEffect})`,
      matchedRules: matchedRules.map((r) => r.id),
      evaluatedAt: new Date(),
      requiresApproval: false,
    };
  }

  /**
   * Clear all policy sets
   */
  clear(): void {
    this.policySets.clear();
  }
}

/**
 * Create a default strict policy set
 */
export function createDefaultStrictPolicySet(): PolicySet {
  return {
    id: 'default-strict',
    name: 'Default Strict Policy',
    description: 'Strict policy requiring approval for all critical actions',
    defaultEffect: 'allow',
    enabled: true,
    rules: [
      {
        id: 'require-approval-critical',
        name: 'Require approval for critical actions',
        description: 'All critical actions require explicit user approval',
        priority: 100,
        effect: 'require_approval',
        enabled: true,
        actionTypes: [
          'sign_in',
          'enter_password',
          'enter_otp',
          'make_purchase',
          'delete_data',
          'change_account_permissions',
          'change_payment_details',
          'create_api_key',
        ],
      },
      {
        id: 'require-approval-high-risk',
        name: 'Require approval for high-risk actions',
        description: 'High-risk actions like sending emails or uploading files',
        priority: 90,
        effect: 'require_approval',
        enabled: true,
        actionTypes: [
          'send_email',
          'send_message',
          'upload_file',
          'download_sensitive',
          'fill_credential',
          'publish_content',
        ],
      },
      {
        id: 'block-dangerous-actions',
        name: 'Block dangerous actions',
        description: 'Block execution of arbitrary scripts',
        priority: 200,
        effect: 'block',
        enabled: true,
        actionTypes: ['execute_script'],
      },
    ],
  };
}

// Default singleton instance
let defaultEngine: PolicyEngine | null = null;

export function getDefaultPolicyEngine(): PolicyEngine {
  if (!defaultEngine) {
    defaultEngine = new PolicyEngine();
    defaultEngine.addPolicySet(createDefaultStrictPolicySet());
  }
  return defaultEngine;
}
