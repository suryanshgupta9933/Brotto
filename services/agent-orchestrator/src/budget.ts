/**
 * Budget Tracking
 *
 * Implements resource budgets as specified in ARCHITECTURE.md section 8.8
 *
 * Budgets enforced:
 * - Maximum agent steps
 * - Maximum session duration
 * - Maximum consecutive failed actions
 * - Maximum repeated navigation loops
 * - Maximum screenshot size
 * - Maximum model tokens
 * - Maximum retry count
 */

import {
  BudgetTracker,
  BudgetConfig,
  BudgetStatus,
  BudgetCheckResult,
  createBudgetTracker,
  PRESET_BUDGETS,
  type BudgetUsage,
} from '@fara/policy-engine';

/**
 * Budget event types
 */
export enum BudgetEventType {
  STEP_LIMIT_REACHED = 'step_limit_reached',
  TIME_LIMIT_REACHED = 'time_limit_reached',
  CONSECUTIVE_FAILURES_LIMIT = 'consecutive_failures_limit',
  NAVIGATION_LOOPS_LIMIT = 'navigation_loops_limit',
  TOKEN_LIMIT_REACHED = 'token_limit_reached',
  COST_LIMIT_REACHED = 'cost_limit_reached',
  RETRY_LIMIT_REACHED = 'retry_limit_reached',
  WARNING = 'warning',
}

/**
 * Budget event
 */
export interface BudgetEvent {
  type: BudgetEventType;
  message: string;
  timestamp: Date;
  details?: Record<string, unknown>;
}

/**
 * Budget event listener
 */
export type BudgetEventListener = (event: BudgetEvent) => void;

/**
 * Budget tracking wrapper with event emission
 */
export class AgentBudgetTracker {
  private tracker: BudgetTracker;
  private listeners: Set<BudgetEventListener> = new Set();
  private sessionStartTime: Date | null = null;

  constructor(config?: Partial<BudgetConfig>) {
    this.tracker = createBudgetTracker(config);
  }

  /**
   * Start tracking a new session
   */
  startSession(): void {
    this.tracker.startSession();
    this.sessionStartTime = new Date();
  }

  /**
   * Record an agent step
   */
  recordStep(): void {
    this.tracker.recordAction();

    // Check if we've hit step limit
    const status = this.tracker.getStatus();
    if (status.usage.steps >= status.config.maxSteps) {
      this.emit({
        type: BudgetEventType.STEP_LIMIT_REACHED,
        message: `Step limit reached: ${status.usage.steps}/${status.config.maxSteps}`,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Record a failed action
   */
  recordFailedAction(): void {
    this.tracker.recordFailedAction();

    const status = this.tracker.getStatus();
    if (
      status.usage.consecutiveFailedActions >=
      status.config.maxConsecutiveFailedActions
    ) {
      this.emit({
        type: BudgetEventType.CONSECUTIVE_FAILURES_LIMIT,
        message: `Consecutive failure limit reached: ${status.usage.consecutiveFailedActions}`,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Record a successful action
   */
  recordSuccess(): void {
    this.tracker.recordSuccess();
  }

  /**
   * Record navigation
   */
  recordNavigation(domain: string, url: string): void {
    this.tracker.recordNavigation(domain, url);

    const status = this.tracker.getStatus();
    if (
      status.usage.repeatedNavigationCount >=
      status.config.maxRepeatedNavigationLoops
    ) {
      this.emit({
        type: BudgetEventType.NAVIGATION_LOOPS_LIMIT,
        message: `Repeated navigation limit reached: ${status.usage.repeatedNavigationCount}`,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Record token usage from inference
   */
  recordTokens(inputTokens: number, outputTokens: number): void {
    this.tracker.recordTokens(inputTokens, outputTokens);

    const status = this.tracker.getStatus();
    if (status.usage.totalTokensUsed >= status.config.maxModelTokens) {
      this.emit({
        type: BudgetEventType.TOKEN_LIMIT_REACHED,
        message: `Token limit reached: ${status.usage.totalTokensUsed}/${status.config.maxModelTokens}`,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Record screenshot bytes
   */
  recordScreenshot(bytes: number): void {
    this.tracker.recordScreenshot(bytes);
  }

  /**
   * Record a retry
   */
  recordRetry(): void {
    this.tracker.recordRetry();

    const status = this.tracker.getStatus();
    if (status.usage.totalRetryCount >= status.config.maxRetryCount) {
      this.emit({
        type: BudgetEventType.RETRY_LIMIT_REACHED,
        message: `Retry limit reached: ${status.usage.totalRetryCount}`,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Update tab count
   */
  updateTabCount(count: number): void {
    this.tracker.updateTabCount(count);
  }

  /**
   * Check all budgets
   */
  check(): BudgetCheckResult {
    return this.tracker.check();
  }

  /**
   * Get full budget status
   */
  getStatus(): BudgetStatus {
    return this.tracker.getStatus();
  }

  /**
   * Get remaining budget
   */
  getRemaining(): Record<string, number> {
    return this.tracker.getRemaining();
  }

  /**
   * Get current usage
   */
  getUsage(): BudgetUsage {
    return this.tracker.getUsage();
  }

  /**
   * Check if session is within budget
   */
  isWithinBudget(): boolean {
    return this.check().allowed;
  }

  /**
   * Check if any critical budget is exhausted
   */
  isExhausted(): boolean {
    const result = this.check();
    return !result.allowed;
  }

  /**
   * Get exhausted budgets
   */
  getExhaustedBudgets(): string[] {
    return this.check().exhaustedBudgets;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BudgetConfig>): void {
    this.tracker.updateConfig(config);
  }

  /**
   * Add event listener
   */
  addListener(listener: BudgetEventListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove event listener
   */
  removeListener(listener: BudgetEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit budget event
   */
  private emit(event: BudgetEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('Budget event listener error:', e);
      }
    }
  }

  /**
   * Get elapsed session time in ms
   */
  getElapsedTimeMs(): number {
    if (!this.sessionStartTime) {
      return 0;
    }
    return Date.now() - this.sessionStartTime.getTime();
  }

  /**
   * Check session duration
   */
  checkSessionDuration(): { withinLimit: boolean; elapsedMs: number; limitMs: number } {
    const status = this.tracker.getStatus();
    const elapsedMs = this.sessionStartTime
      ? Date.now() - this.sessionStartTime.getTime()
      : 0;

    return {
      withinLimit: elapsedMs < status.config.maxSessionDurationMs,
      elapsedMs,
      limitMs: status.config.maxSessionDurationMs,
    };
  }

  /**
   * Export usage for external tracking
   */
  exportUsage(): Record<string, unknown> {
    return this.tracker.exportUsage();
  }
}

/**
 * Create a budget tracker with preset configuration
 */
export function createAgentBudgetTracker(
  preset?: 'conservative' | 'standard' | 'generous',
  overrides?: Partial<BudgetConfig>
): AgentBudgetTracker {
  let config: Partial<BudgetConfig>;

  if (preset && PRESET_BUDGETS[preset]) {
    config = { ...PRESET_BUDGETS[preset], ...overrides };
  } else if (overrides) {
    config = overrides;
  } else {
    config = PRESET_BUDGETS.standard;
  }

  return new AgentBudgetTracker(config);
}

export { PRESET_BUDGETS };
