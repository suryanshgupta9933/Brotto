/**
 * Tests for Budget Tracker
 */

import {
  BudgetTracker,
  createBudgetTracker,
  PRESET_BUDGETS,
  BudgetConfig,
} from '../budget.js';

describe('BudgetTracker', () => {
  let tracker: BudgetTracker;

  beforeEach(() => {
    tracker = new BudgetTracker();
    tracker.startSession();
  });

  describe('startSession', () => {
    it('should initialize session tracking', () => {
      tracker.startSession();
      const usage = tracker.getUsage();
      expect(usage.sessionStartTime).toBeDefined();
      expect(usage.steps).toBe(0);
    });
  });

  describe('recordAction', () => {
    it('should increment step count', () => {
      tracker.recordAction();
      tracker.recordAction();
      tracker.recordAction();

      const usage = tracker.getUsage();
      expect(usage.steps).toBe(3);
    });

    it('should update last action time', () => {
      tracker.recordAction();
      const usage = tracker.getUsage();
      expect(usage.lastActionTime).toBeDefined();
    });
  });

  describe('failed actions tracking', () => {
    it('should track consecutive failed actions', () => {
      tracker.recordFailedAction();
      tracker.recordFailedAction();

      const usage = tracker.getUsage();
      expect(usage.consecutiveFailedActions).toBe(2);
    });

    it('should reset consecutive failures on success', () => {
      tracker.recordFailedAction();
      tracker.recordFailedAction();
      tracker.recordSuccess();

      const usage = tracker.getUsage();
      expect(usage.consecutiveFailedActions).toBe(0);
    });

    it('should check budget when consecutive failures exceed limit', () => {
      tracker.updateConfig({ maxConsecutiveFailedActions: 3 });
      tracker.recordFailedAction();
      tracker.recordFailedAction();

      let check = tracker.check();
      expect(check.allowed).toBe(true);

      tracker.recordFailedAction();
      check = tracker.check();
      expect(check.allowed).toBe(false);
      expect(check.exhaustedBudgets).toContain('maxConsecutiveFailedActions');
    });
  });

  describe('navigation tracking', () => {
    it('should track external domains', () => {
      tracker.recordNavigation('example.com', 'https://example.com/page1');
      tracker.recordNavigation('another.com', 'https://another.com/page');

      const usage = tracker.getUsage();
      expect(usage.externalDomainsVisited).toContain('example.com');
      expect(usage.externalDomainsVisited).toContain('another.com');
      expect(usage.totalExternalDomains).toBe(2);
    });

    it('should not duplicate domain counts', () => {
      tracker.recordNavigation('example.com', 'https://example.com/page1');
      tracker.recordNavigation('example.com', 'https://example.com/page2');

      const usage = tracker.getUsage();
      expect(usage.totalExternalDomains).toBe(1);
    });

    it('should detect repeated navigation loops', () => {
      tracker.updateConfig({ maxRepeatedNavigationLoops: 2 });

      tracker.recordNavigation('example.com', 'https://example.com/page1');
      tracker.recordNavigation('example.com', 'https://example.com/page2');
      tracker.recordNavigation('example.com', 'https://example.com/page2'); // Same URL
      tracker.recordNavigation('example.com', 'https://example.com/page2'); // Same URL again

      const check = tracker.check();
      expect(check.exhaustedBudgets).toContain('maxRepeatedNavigationLoops');
    });
  });

  describe('token tracking', () => {
    it('should track input and output tokens', () => {
      tracker.recordTokens(1000, 500);

      const usage = tracker.getUsage();
      expect(usage.inputTokens).toBe(1000);
      expect(usage.outputTokens).toBe(500);
      expect(usage.totalTokensUsed).toBe(1500);
    });

    it('should accumulate token usage', () => {
      tracker.recordTokens(1000, 500);
      tracker.recordTokens(2000, 1000);

      const usage = tracker.getUsage();
      expect(usage.inputTokens).toBe(3000);
      expect(usage.outputTokens).toBe(1500);
      expect(usage.totalTokensUsed).toBe(4500);
    });

    it('should calculate cost based on token pricing', () => {
      tracker.setTokenPricing({
        inputCostPer1MTokens: 1, // $1 per 1M
        outputCostPer1MTokens: 2, // $2 per 1M
      });

      // 1M input + 0.5M output
      tracker.recordTokens(1000000, 500000);

      const usage = tracker.getUsage();
      // 1 * 1 + 0.5 * 2 = 2 cents
      expect(usage.totalCostCents).toBe(2);
    });
  });

  describe('check and limits', () => {
    it('should allow actions within budget', () => {
      tracker.updateConfig({ maxSteps: 10 });
      tracker.recordAction();
      tracker.recordAction();

      const check = tracker.check();
      expect(check.allowed).toBe(true);
      expect(check.exhaustedBudgets).toHaveLength(0);
    });

    it('should deny actions when budget exhausted', () => {
      tracker.updateConfig({ maxSteps: 2 });
      tracker.recordAction();
      tracker.recordAction();
      tracker.recordAction(); // Over limit

      const check = tracker.check();
      expect(check.allowed).toBe(false);
      expect(check.exhaustedBudgets).toContain('maxSteps');
    });

    it('should warn when approaching limits', () => {
      tracker.updateConfig({ maxSteps: 10 });
      for (let i = 0; i < 9; i++) {
        tracker.recordAction();
      }

      const check = tracker.check();
      expect(check.warnings).toContain('Approaching step limit');
    });
  });

  describe('remaining budget', () => {
    it('should calculate remaining steps', () => {
      tracker.updateConfig({ maxSteps: 10 });
      tracker.recordAction();
      tracker.recordAction();
      tracker.recordAction();

      const remaining = tracker.getRemaining();
      expect(remaining.steps).toBe(7);
    });

    it('should calculate remaining tokens', () => {
      tracker.updateConfig({ maxModelTokens: 10000 });
      tracker.recordTokens(3000, 2000);

      const remaining = tracker.getRemaining();
      expect(remaining.tokens).toBe(5000);
    });
  });

  describe('config updates', () => {
    it('should update configuration', () => {
      tracker.updateConfig({ maxSteps: 50, maxSessionDurationMs: 60000 });

      const config = tracker.getConfig();
      expect(config.maxSteps).toBe(50);
      expect(config.maxSessionDurationMs).toBe(60000);
    });

    it('should set exhaustion strategy', () => {
      tracker.setExhaustionStrategy('maxSteps', 'warn');

      tracker.updateConfig({ maxSteps: 1 });
      tracker.recordAction();
      tracker.recordAction(); // Over limit

      const check = tracker.check();
      expect(check.allowed).toBe(true); // Strategy is warn
      expect(check.warnings).toContain('maxSteps exhausted but configured to continue');
    });
  });

  describe('status reporting', () => {
    it('should return full budget status', () => {
      tracker.updateConfig({ maxSteps: 100, maxModelTokens: 50000 });
      tracker.recordAction();
      tracker.recordTokens(10000, 5000);

      const status = tracker.getStatus();
      expect(status.isWithinBudget).toBe(true);
      expect(status.percentages.steps).toBe(1);
      expect(status.percentages.tokens).toBe(30); // 15000 / 50000 * 100
    });
  });

  describe('data tracking', () => {
    it('should track screenshot bytes', () => {
      tracker.recordScreenshot(1024 * 1024); // 1MB
      tracker.recordScreenshot(512 * 1024); // 512KB

      const usage = tracker.getUsage();
      expect(usage.screenshotBytesTotal).toBe(1024 * 1024 + 512 * 1024);
    });

    it('should track upload bytes', () => {
      tracker.recordUpload(1024 * 1024 * 10); // 10MB

      const usage = tracker.getUsage();
      expect(usage.uploadBytesTotal).toBe(1024 * 1024 * 10);
    });

    it('should track download bytes', () => {
      tracker.recordDownload(1024 * 1024 * 50); // 50MB

      const usage = tracker.getUsage();
      expect(usage.downloadBytesTotal).toBe(1024 * 1024 * 50);
    });
  });

  describe('tab count', () => {
    it('should track current tab count', () => {
      tracker.updateTabCount(5);

      const usage = tracker.getUsage();
      expect(usage.currentTabCount).toBe(5);
    });

    it('should check tab count limit', () => {
      tracker.updateConfig({ maxTabCount: 3 });
      tracker.updateTabCount(4);

      const check = tracker.check();
      expect(check.exhaustedBudgets).toContain('maxTabCount');
    });
  });

  describe('retry tracking', () => {
    it('should track retry count', () => {
      tracker.recordRetry();
      tracker.recordRetry();
      tracker.recordRetry();

      const usage = tracker.getUsage();
      expect(usage.totalRetryCount).toBe(3);
    });

    it('should check retry limit', () => {
      tracker.updateConfig({ maxRetryCount: 2 });
      tracker.recordRetry();
      tracker.recordRetry();
      tracker.recordRetry();

      const check = tracker.check();
      expect(check.exhaustedBudgets).toContain('maxRetryCount');
    });
  });

  describe('export', () => {
    it('should export usage data', () => {
      tracker.recordAction();
      tracker.recordTokens(1000, 500);

      const exported = tracker.exportUsage();
      expect(exported.usage).toBeDefined();
      expect(exported.config).toBeDefined();
      expect(exported.status).toBeDefined();
      expect(exported.exportedAt).toBeDefined();
    });
  });
});

describe('PRESET_BUDGETS', () => {
  it('should have conservative preset', () => {
    expect(PRESET_BUDGETS.conservative.maxSteps).toBe(50);
    expect(PRESET_BUDGETS.conservative.maxCostCents).toBe(5000);
  });

  it('should have standard preset', () => {
    expect(PRESET_BUDGETS.standard.maxSteps).toBe(100);
    expect(PRESET_BUDGETS.standard.maxCostCents).toBe(10000);
  });

  it('should have generous preset', () => {
    expect(PRESET_BUDGETS.generous.maxSteps).toBe(200);
    expect(PRESET_BUDGETS.generous.maxCostCents).toBe(25000);
  });
});

describe('createBudgetTracker', () => {
  it('should create tracker with custom config', () => {
    const tracker = createBudgetTracker({ maxSteps: 25 });
    tracker.startSession();
    tracker.recordAction();

    expect(tracker.getConfig().maxSteps).toBe(25);
  });
});
