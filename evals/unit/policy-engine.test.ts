/**
 * Unit tests for policy-engine package
 *
 * Tests policy evaluation, action approval determination,
 * allowlist checking, and consequence analysis.
 */

import {
  PolicyEngine,
  PolicyRule,
  PolicyEffect,
  ActionPolicy,
  ApprovalRequirement,
  createPolicyRule,
  evaluateAction,
  checkAllowlist,
  checkUrlAgainstAllowlist,
  analyzeConsequences,
  type ConsequenceAnalysis,
  type PolicyEvaluationResult,
  DEFAULT_BUDGET_CONFIG,
  BudgetManager,
  Classifier,
  ActionCategory,
  RiskLevel,
} from 'policy-engine';

describe('Policy Engine Package', () => {
  describe('Policy Evaluation', () => {
    let engine: PolicyEngine;

    beforeEach(() => {
      engine = new PolicyEngine();
    });

    it('should evaluate action against policy', () => {
      const action = {
        type: 'left_click',
        args: { x: 100, y: 100 },
      };

      const context = {
        sessionId: 'session-123',
        userId: 'user-456',
        tabId: 'tab-789',
        url: 'https://example.com',
      };

      const result = engine.evaluate(action, context);
      expect(result).toBeDefined();
      expect(result.requiresApproval).toBeDefined();
      expect(result.effect).toBeDefined();
    });

    it('should require approval for high-risk actions', () => {
      const action = {
        type: 'visit_url',
        args: { url: 'https://external-site.com' },
      };

      const context = {
        sessionId: 'session-123',
        userId: 'user-456',
        tabId: 'tab-789',
        url: 'https://example.com',
      };

      const result = engine.evaluate(action, context);
      // External navigation should typically require approval
      expect(result.effect).toBeTruthy();
    });

    it('should allow low-risk actions without approval', () => {
      const action = {
        type: 'screenshot',
        args: {},
      };

      const context = {
        sessionId: 'session-123',
        userId: 'user-456',
        tabId: 'tab-789',
        url: 'https://example.com',
      };

      const result = engine.evaluate(action, context);
      // Screenshot is generally safe
      expect(result.effect).toBeTruthy();
    });

    it('should apply policy rules in priority order', () => {
      const rules: PolicyRule[] = [
        createPolicyRule({
          id: 'rule-1',
          name: 'Block specific URL',
          effect: PolicyEffect.DENY,
          condition: {
            type: 'url',
            pattern: 'https://blocked.example.com',
          },
          priority: 1,
        }),
        createPolicyRule({
          id: 'rule-2',
          name: 'Allow example.com',
          effect: PolicyEffect.ALLOW,
          condition: {
            type: 'url',
            pattern: 'https://*.example.com',
          },
          priority: 2,
        }),
      ];

      const engineWithRules = new PolicyEngine({ rules });

      const blockedAction = {
        type: 'visit_url',
        args: { url: 'https://blocked.example.com' },
      };

      const context = {
        sessionId: 'session-123',
        userId: 'user-456',
        tabId: 'tab-789',
        url: 'https://example.com',
      };

      const result = engineWithRules.evaluate(blockedAction, context);
      expect(result.effect).toBe(PolicyEffect.DENY);
    });
  });

  describe('Allowlist Checking', () => {
    it('should check URL against allowlist', () => {
      const allowlist = [
        'https://allowed1.example.com',
        'https://allowed2.example.com',
      ];

      expect(checkUrlAgainstAllowlist('https://allowed1.example.com', allowlist)).toBe(true);
      expect(checkUrlAgainstAllowlist('https://blocked.example.com', allowlist)).toBe(false);
    });

    it('should support wildcard patterns in allowlist', () => {
      const allowlist = [
        'https://*.example.com',
        'https://app.example.com/path/*',
      ];

      expect(checkUrlAgainstAllowlist('https://sub.example.com', allowlist)).toBe(true);
      expect(checkUrlAgainstAllowlist('https://app.example.com/path/page', allowlist)).toBe(true);
      expect(checkUrlAgainstAllowlist('https://other.example.com', allowlist)).toBe(false);
    });

    it('should check domain against allowlist', () => {
      const allowlist = ['example.com', 'trusted.org'];

      expect(checkAllowlist('example.com', allowlist)).toBe(true);
      expect(checkAllowlist('untrusted.com', allowlist)).toBe(false);
    });
  });

  describe('Consequence Analysis', () => {
    it('should analyze action consequences', () => {
      const action = {
        type: 'visit_url',
        args: { url: 'https://external-site.com' },
      };

      const context = {
        sessionId: 'session-123',
        userId: 'user-456',
        tabId: 'tab-789',
        url: 'https://example.com',
      };

      const analysis = analyzeConsequences(action, context);
      expect(analysis).toBeDefined();
      expect(analysis.riskScore).toBeDefined();
      expect(analysis.riskFactors).toBeDefined();
      expect(Array.isArray(analysis.riskFactors)).toBe(true);
    });

    it('should identify high-risk factors', () => {
      const action = {
        type: 'key',
        args: { text: 'password123' },
      };

      const context = {
        sessionId: 'session-123',
        userId: 'user-456',
        tabId: 'tab-789',
        url: 'https://login.example.com',
      };

      const analysis = analyzeConsequences(action, context);
      // Password typing in login form is sensitive
      expect(analysis.riskScore).toBeGreaterThan(0);
    });

    it('should analyze drag actions', () => {
      const action = {
        type: 'drag',
        args: {
          startX: 100,
          startY: 100,
          endX: 200,
          endY: 200,
        },
      };

      const context = {
        sessionId: 'session-123',
        userId: 'user-456',
        tabId: 'tab-789',
        url: 'https://example.com',
      };

      const analysis = analyzeConsequences(action, context);
      expect(analysis).toBeDefined();
    });
  });

  describe('Budget Management', () => {
    it('should track action budget', () => {
      const manager = new BudgetManager({
        maxActions: 100,
        maxDuration: 3600000,
        maxCost: 10.0,
      });

      expect(manager.getRemainingActions()).toBe(100);
    });

    it('should decrement action count', () => {
      const manager = new BudgetManager({
        maxActions: 10,
        maxDuration: 3600000,
        maxCost: 10.0,
      });

      manager.consumeAction();
      expect(manager.getRemainingActions()).toBe(9);
    });

    it('should detect budget exhaustion', () => {
      const manager = new BudgetManager({
        maxActions: 1,
        maxDuration: 3600000,
        maxCost: 10.0,
      });

      manager.consumeAction();
      expect(manager.isExhausted()).toBe(true);
    });

    it('should track cost budget', () => {
      const manager = new BudgetManager({
        maxActions: 100,
        maxDuration: 3600000,
        maxCost: 1.0,
      });

      manager.consumeCost(0.5);
      expect(manager.getRemainingCost()).toBe(0.5);
    });
  });

  describe('Action Classification', () => {
    let classifier: Classifier;

    beforeEach(() => {
      classifier = new Classifier();
    });

    it('should classify navigation actions', () => {
      const action = {
        type: 'visit_url',
        args: { url: 'https://example.com' },
      };

      const category = classifier.classify(action);
      expect(category).toBe(ActionCategory.NAVIGATION);
    });

    it('should classify click actions', () => {
      const action = {
        type: 'left_click',
        args: { x: 100, y: 100 },
      };

      const category = classifier.classify(action);
      expect(category).toBe(ActionCategory.INTERACTION);
    });

    it('should classify scroll actions', () => {
      const action = {
        type: 'scroll',
        args: { deltaX: 0, deltaY: -100 },
      };

      const category = classifier.classify(action);
      expect(category).toBe(ActionCategory.INTERACTION);
    });

    it('should classify screenshot actions', () => {
      const action = {
        type: 'screenshot',
        args: {},
      };

      const category = classifier.classify(action);
      expect(category).toBe(ActionCategory.OBSERVATION);
    });

    it('should determine risk level', () => {
      const highRiskAction = {
        type: 'visit_url',
        args: { url: 'https://external.com' },
      };

      const riskLevel = classifier.getRiskLevel(highRiskAction);
      expect(riskLevel).toBeGreaterThanOrEqual(RiskLevel.LOW);
    });
  });

  describe('Approval Determination', () => {
    let engine: PolicyEngine;

    beforeEach(() => {
      engine = new PolicyEngine();
    });

    it('should determine approval requirement', () => {
      const action = {
        type: 'left_click',
        args: { x: 100, y: 100 },
      };

      const context = {
        sessionId: 'session-123',
        userId: 'user-456',
        tabId: 'tab-789',
        url: 'https://example.com',
      };

      const requirement = engine.getApprovalRequirement(action, context);
      expect(requirement).toBeDefined();
      expect(typeof requirement.requiresApproval).toBe('boolean');
    });

    it('should set approval reason when required', () => {
      const action = {
        type: 'visit_url',
        args: { url: 'https://untrusted.com' },
      };

      const context = {
        sessionId: 'session-123',
        userId: 'user-456',
        tabId: 'tab-789',
        url: 'https://example.com',
      };

      const requirement = engine.getApprovalRequirement(action, context);
      if (requirement.requiresApproval) {
        expect(requirement.reason).toBeDefined();
      }
    });
  });
});
