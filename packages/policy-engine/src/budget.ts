/**
 * Budget Tracking
 *
 * Tracks resource usage including steps, time, tokens, and cost.
 * Implements resource budgets as specified in ARCHITECTURE.md section 8.8.
 */

import { z } from 'zod';

/**
 * Budget configuration
 */
export const BudgetConfigSchema = z.object({
  maxSteps: z.number().min(1).default(100),
  maxSessionDurationMs: z.number().min(0).default(3600000), // 1 hour default
  maxConsecutiveFailedActions: z.number().min(1).default(5),
  maxRepeatedNavigationLoops: z.number().min(1).default(3),
  maxScreenshotSizeBytes: z.number().min(0).default(10 * 1024 * 1024), // 10MB
  maxUploadSizeBytes: z.number().min(0).default(100 * 1024 * 1024), // 100MB
  maxDownloadSizeBytes: z.number().min(0).default(500 * 1024 * 1024), // 500MB
  maxModelTokens: z.number().min(0).default(100000),
  maxExternalDomains: z.number().min(1).default(20),
  maxTabCount: z.number().min(1).default(10),
  maxRetryCount: z.number().min(0).default(3),
  maxCostCents: z.number().min(0).default(10000), // $100 default
});

export type BudgetConfig = z.infer<typeof BudgetConfigSchema>;

/**
 * Usage metrics for a session
 */
export const BudgetUsageSchema = z.object({
  steps: z.number().default(0),
  sessionStartTime: z.date().optional(),
  lastActionTime: z.date().optional(),
  consecutiveFailedActions: z.number().default(0),
  repeatedNavigationCount: z.number().default(0),
  navigationHistory: z.array(z.string()).default([]),
  totalTokensUsed: z.number().default(0),
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  totalExternalDomains: z.number().default(0),
  externalDomainsVisited: z.array(z.string()).default([]),
  currentTabCount: z.number().default(1),
  totalRetryCount: z.number().default(0),
  totalCostCents: z.number().default(0),
  screenshotBytesTotal: z.number().default(0),
  uploadBytesTotal: z.number().default(0),
  downloadBytesTotal: z.number().default(0),
});

export type BudgetUsage = z.infer<typeof BudgetUsageSchema>;

/**
 * Budget exhaustion strategy
 */
export const ExhaustionStrategySchema = z.enum(['stop', 'warn', 'continue']);
export type ExhaustionStrategy = z.infer<typeof ExhaustionStrategySchema>;

/**
 * Budget check result
 */
export const BudgetCheckResultSchema = z.object({
  allowed: z.boolean(),
  exhaustedBudgets: z.array(z.string()),
  warnings: z.array(z.string()).optional(),
  remaining: z.record(z.number()).optional(),
});

export type BudgetCheckResult = z.infer<typeof BudgetCheckResultSchema>;

/**
 * Budget status for reporting
 */
export const BudgetStatusSchema = z.object({
  isWithinBudget: z.boolean(),
  usage: BudgetUsageSchema,
  config: BudgetConfigSchema,
  exhaustedBudgets: z.array(z.string()),
  warnings: z.array(z.string()),
  percentages: z.record(z.number()),
});

export type BudgetStatus = z.infer<typeof BudgetStatusSchema>;

/**
 * Token pricing information
 */
export interface TokenPricing {
  inputCostPer1MTokens: number; // cents per 1M tokens
  outputCostPer1MTokens: number;
}

/**
 * Default token pricing (example rates)
 */
const DEFAULT_TOKEN_PRICING: TokenPricing = {
  inputCostPer1MTokens: 0.1, // $0.10 per 1M input tokens
  outputCostPer1MTokens: 0.3, // $0.30 per 1M output tokens
};

/**
 * Budget tracker for monitoring resource usage
 */
export class BudgetTracker {
  private config: BudgetConfig;
  private usage: BudgetUsage;
  private tokenPricing: TokenPricing;
  private exhaustionStrategies: Map<string, ExhaustionStrategy>;
  private warnings: Set<string>;

  constructor(config?: Partial<BudgetConfig>) {
    this.config = BudgetConfigSchema.parse({ ...BudgetConfigSchema.parse({}), ...config });
    this.usage = BudgetUsageSchema.parse({});
    this.tokenPricing = DEFAULT_TOKEN_PRICING;
    this.exhaustionStrategies = new Map();
    this.warnings = new Set();

    // Default exhaustion strategies
    this.exhaustionStrategies.set('maxSteps', 'stop');
    this.exhaustionStrategies.set('maxSessionDurationMs', 'stop');
    this.exhaustionStrategies.set('maxConsecutiveFailedActions', 'stop');
    this.exhaustionStrategies.set('maxRepeatedNavigationLoops', 'stop');
    this.exhaustionStrategies.set('maxCostCents', 'stop');
  }

  /**
   * Initialize tracking for a new session
   */
  startSession(): void {
    const now = new Date();
    this.usage = BudgetUsageSchema.parse({
      sessionStartTime: now,
      lastActionTime: now,
      steps: 0,
      consecutiveFailedActions: 0,
      repeatedNavigationCount: 0,
      navigationHistory: [],
      totalTokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalExternalDomains: 0,
      externalDomainsVisited: [],
      currentTabCount: 1,
      totalRetryCount: 0,
      totalCostCents: 0,
      screenshotBytesTotal: 0,
      uploadBytesTotal: 0,
      downloadBytesTotal: 0,
    });
    this.warnings.clear();
  }

  /**
   * Record an action being taken
   */
  recordAction(): void {
    const now = new Date();
    this.usage.steps++;
    this.usage.lastActionTime = now;
  }

  /**
   * Record a failed action
   */
  recordFailedAction(): void {
    this.usage.consecutiveFailedActions++;
  }

  /**
   * Record a successful action (resets consecutive failures)
   */
  recordSuccess(): void {
    this.usage.consecutiveFailedActions = 0;
  }

  /**
   * Record navigation to a domain
   */
  recordNavigation(domain: string, url: string): void {
    // Check for repeated navigation (same URL consecutively)
    if (this.usage.navigationHistory.length > 0) {
      const lastNav = this.usage.navigationHistory[this.usage.navigationHistory.length - 1];
      if (lastNav === url) {
        this.usage.repeatedNavigationCount++;
      } else {
        this.usage.repeatedNavigationCount = 0;
      }
    }

    // Track external domains
    if (!this.usage.externalDomainsVisited.includes(domain)) {
      this.usage.externalDomainsVisited.push(domain);
      this.usage.totalExternalDomains = this.usage.externalDomainsVisited.length;
    }

    // Keep navigation history limited
    this.usage.navigationHistory.push(url);
    if (this.usage.navigationHistory.length > 100) {
      this.usage.navigationHistory = this.usage.navigationHistory.slice(-100);
    }
  }

  /**
   * Record token usage
   */
  recordTokens(inputTokens: number, outputTokens: number): void {
    this.usage.inputTokens += inputTokens;
    this.usage.outputTokens += outputTokens;
    this.usage.totalTokensUsed = this.usage.inputTokens + this.usage.outputTokens;

    // Calculate cost
    const inputCost =
      (inputTokens / 1000000) * this.tokenPricing.inputCostPer1MTokens;
    const outputCost =
      (outputTokens / 1000000) * this.tokenPricing.outputCostPer1MTokens;
    this.usage.totalCostCents += inputCost + outputCost;
  }

  /**
   * Record screenshot bytes
   */
  recordScreenshot(bytes: number): void {
    this.usage.screenshotBytesTotal += bytes;
  }

  /**
   * Record upload bytes
   */
  recordUpload(bytes: number): void {
    this.usage.uploadBytesTotal += bytes;
  }

  /**
   * Record download bytes
   */
  recordDownload(bytes: number): void {
    this.usage.downloadBytesTotal += bytes;
  }

  /**
   * Update tab count
   */
  updateTabCount(count: number): void {
    this.usage.currentTabCount = count;
  }

  /**
   * Record a retry
   */
  recordRetry(): void {
    this.usage.totalRetryCount++;
  }

  /**
   * Check if all budgets are within limits
   */
  check(): BudgetCheckResult {
    const exhaustedBudgets: string[] = [];
    const warnings: string[] = [];

    // Check each budget
    if (this.usage.steps >= this.config.maxSteps) {
      exhaustedBudgets.push('maxSteps');
    } else if (this.usage.steps >= this.config.maxSteps * 0.9) {
      warnings.push('Approaching step limit');
    }

    if (this.usage.consecutiveFailedActions >= this.config.maxConsecutiveFailedActions) {
      exhaustedBudgets.push('maxConsecutiveFailedActions');
    }

    if (this.usage.repeatedNavigationCount >= this.config.maxRepeatedNavigationLoops) {
      exhaustedBudgets.push('maxRepeatedNavigationLoops');
    }

    if (this.usage.totalTokensUsed >= this.config.maxModelTokens) {
      exhaustedBudgets.push('maxModelTokens');
    }

    if (this.usage.totalExternalDomains >= this.config.maxExternalDomains) {
      exhaustedBudgets.push('maxExternalDomains');
    }

    if (this.usage.currentTabCount >= this.config.maxTabCount) {
      exhaustedBudgets.push('maxTabCount');
    }

    if (this.usage.totalRetryCount >= this.config.maxRetryCount) {
      exhaustedBudgets.push('maxRetryCount');
    }

    if (this.usage.totalCostCents >= this.config.maxCostCents) {
      exhaustedBudgets.push('maxCostCents');
    }

    // Check session duration
    if (this.usage.sessionStartTime) {
      const elapsed = Date.now() - this.usage.sessionStartTime.getTime();
      if (elapsed >= this.config.maxSessionDurationMs) {
        exhaustedBudgets.push('maxSessionDurationMs');
      }
    }

    // Check screenshot size
    if (
      this.usage.screenshotBytesTotal > 0 &&
      this.usage.screenshotBytesTotal >= this.config.maxScreenshotSizeBytes
    ) {
      exhaustedBudgets.push('maxScreenshotSizeBytes');
    }

    // Check upload size
    if (
      this.usage.uploadBytesTotal > 0 &&
      this.usage.uploadBytesTotal >= this.config.maxUploadSizeBytes
    ) {
      exhaustedBudgets.push('maxUploadSizeBytes');
    }

    // Check download size
    if (
      this.usage.downloadBytesTotal > 0 &&
      this.usage.downloadBytesTotal >= this.config.maxDownloadSizeBytes
    ) {
      exhaustedBudgets.push('maxDownloadSizeBytes');
    }

    // Determine if allowed based on exhaustion strategies
    let allowed = exhaustedBudgets.length === 0;
    if (!allowed) {
      for (const budget of exhaustedBudgets) {
        const strategy = this.exhaustionStrategies.get(budget) || 'stop';
        if (strategy === 'warn') {
          warnings.push(`${budget} exhausted but configured to continue`);
          allowed = true;
        }
      }
    }

    // Add warnings for items approaching limits
    if (this.usage.inputTokens >= this.config.maxModelTokens * 0.8) {
      warnings.push('Approaching token limit');
    }
    if (this.usage.totalCostCents >= this.config.maxCostCents * 0.8) {
      warnings.push('Approaching cost limit');
    }

    return {
      allowed,
      exhaustedBudgets,
      warnings: warnings.length > 0 ? warnings : undefined,
      remaining: this.getRemaining(),
    };
  }

  /**
   * Get remaining budget for each resource
   */
  getRemaining(): Record<string, number> {
    const remaining: Record<string, number> = {};

    remaining.steps = Math.max(0, this.config.maxSteps - this.usage.steps);
    remaining.consecutiveFailedActions = Math.max(
      0,
      this.config.maxConsecutiveFailedActions - this.usage.consecutiveFailedActions
    );
    remaining.repeatedNavigationLoops = Math.max(
      0,
      this.config.maxRepeatedNavigationLoops - this.usage.repeatedNavigationCount
    );
    remaining.tokens = Math.max(
      0,
      this.config.maxModelTokens - this.usage.totalTokensUsed
    );
    remaining.externalDomains = Math.max(
      0,
      this.config.maxExternalDomains - this.usage.totalExternalDomains
    );
    remaining.tabCount = Math.max(
      0,
      this.config.maxTabCount - this.usage.currentTabCount
    );
    remaining.retryCount = Math.max(
      0,
      this.config.maxRetryCount - this.usage.totalRetryCount
    );
    remaining.costCents = Math.max(
      0,
      this.config.maxCostCents - this.usage.totalCostCents
    );

    if (this.usage.sessionStartTime) {
      const elapsed = Date.now() - this.usage.sessionStartTime.getTime();
      remaining.sessionDurationMs = Math.max(
        0,
        this.config.maxSessionDurationMs - elapsed
      );
    }

    return remaining;
  }

  /**
   * Get full budget status
   */
  getStatus(): BudgetStatus {
    const check = this.check();
    const percentages: Record<string, number> = {};

    percentages.steps =
      this.config.maxSteps > 0
        ? (this.usage.steps / this.config.maxSteps) * 100
        : 0;
    percentages.tokens =
      this.config.maxModelTokens > 0
        ? (this.usage.totalTokensUsed / this.config.maxModelTokens) * 100
        : 0;
    percentages.cost =
      this.config.maxCostCents > 0
        ? (this.usage.totalCostCents / this.config.maxCostCents) * 100
        : 0;

    if (this.usage.sessionStartTime) {
      const elapsed = Date.now() - this.usage.sessionStartTime.getTime();
      percentages.sessionDuration =
        this.config.maxSessionDurationMs > 0
          ? (elapsed / this.config.maxSessionDurationMs) * 100
          : 0;
    }

    return {
      isWithinBudget: check.allowed,
      usage: { ...this.usage },
      config: { ...this.config },
      exhaustedBudgets: check.exhaustedBudgets,
      warnings: check.warnings || [],
      percentages,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BudgetConfig>): void {
    this.config = BudgetConfigSchema.parse({ ...this.config, ...config });
  }

  /**
   * Set exhaustion strategy for a budget
   */
  setExhaustionStrategy(budget: string, strategy: ExhaustionStrategy): void {
    this.exhaustionStrategies.set(budget, strategy);
  }

  /**
   * Update token pricing
   */
  setTokenPricing(pricing: Partial<TokenPricing>): void {
    this.tokenPricing = { ...this.tokenPricing, ...pricing };
  }

  /**
   * Get current usage
   */
  getUsage(): BudgetUsage {
    return { ...this.usage };
  }

  /**
   * Get current config
   */
  getConfig(): BudgetConfig {
    return { ...this.config };
  }

  /**
   * Reset usage counters only (keep config)
   */
  resetUsage(): void {
    this.usage = BudgetUsageSchema.parse({});
    this.warnings.clear();
  }

  /**
   * Export usage for external tracking
   */
  exportUsage(): Record<string, unknown> {
    return {
      usage: this.getUsage(),
      config: this.getConfig(),
      status: this.getStatus(),
      exportedAt: new Date().toISOString(),
    };
  }
}

// Default singleton instance
let defaultTracker: BudgetTracker | null = null;

export function getDefaultBudgetTracker(): BudgetTracker {
  if (!defaultTracker) {
    defaultTracker = new BudgetTracker();
  }
  return defaultTracker;
}

/**
 * Create a new budget tracker with default config
 */
export function createBudgetTracker(config?: Partial<BudgetConfig>): BudgetTracker {
  return new BudgetTracker(config);
}

/**
 * Predefined budget configurations
 */
export const PRESET_BUDGETS = {
  conservative: {
    maxSteps: 50,
    maxSessionDurationMs: 1800000, // 30 minutes
    maxConsecutiveFailedActions: 3,
    maxRepeatedNavigationLoops: 2,
    maxModelTokens: 50000,
    maxCostCents: 5000, // $50
  } as BudgetConfig,

  standard: {
    maxSteps: 100,
    maxSessionDurationMs: 3600000, // 1 hour
    maxConsecutiveFailedActions: 5,
    maxRepeatedNavigationLoops: 3,
    maxModelTokens: 100000,
    maxCostCents: 10000, // $100
  } as BudgetConfig,

  generous: {
    maxSteps: 200,
    maxSessionDurationMs: 7200000, // 2 hours
    maxConsecutiveFailedActions: 10,
    maxRepeatedNavigationLoops: 5,
    maxModelTokens: 250000,
    maxCostCents: 25000, // $250
  } as BudgetConfig,
};
