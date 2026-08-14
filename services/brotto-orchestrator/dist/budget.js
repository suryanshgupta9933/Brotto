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
import { createBudgetTracker, PRESET_BUDGETS, } from 'policy-engine';
/**
 * Budget event types
 */
export var BudgetEventType;
(function (BudgetEventType) {
    BudgetEventType["STEP_LIMIT_REACHED"] = "step_limit_reached";
    BudgetEventType["TIME_LIMIT_REACHED"] = "time_limit_reached";
    BudgetEventType["CONSECUTIVE_FAILURES_LIMIT"] = "consecutive_failures_limit";
    BudgetEventType["NAVIGATION_LOOPS_LIMIT"] = "navigation_loops_limit";
    BudgetEventType["TOKEN_LIMIT_REACHED"] = "token_limit_reached";
    BudgetEventType["COST_LIMIT_REACHED"] = "cost_limit_reached";
    BudgetEventType["RETRY_LIMIT_REACHED"] = "retry_limit_reached";
    BudgetEventType["WARNING"] = "warning";
})(BudgetEventType || (BudgetEventType = {}));
/**
 * Budget tracking wrapper with event emission
 */
export class AgentBudgetTracker {
    tracker;
    listeners = new Set();
    sessionStartTime = null;
    constructor(config) {
        this.tracker = createBudgetTracker(config);
    }
    /**
     * Start tracking a new session
     */
    startSession() {
        this.tracker.startSession();
        this.sessionStartTime = new Date();
    }
    /**
     * Record an agent step
     */
    recordStep() {
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
    recordFailedAction() {
        this.tracker.recordFailedAction();
        const status = this.tracker.getStatus();
        if (status.usage.consecutiveFailedActions >=
            status.config.maxConsecutiveFailedActions) {
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
    recordSuccess() {
        this.tracker.recordSuccess();
    }
    /**
     * Record navigation
     */
    recordNavigation(domain, url) {
        this.tracker.recordNavigation(domain, url);
        const status = this.tracker.getStatus();
        if (status.usage.repeatedNavigationCount >=
            status.config.maxRepeatedNavigationLoops) {
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
    recordTokens(inputTokens, outputTokens) {
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
    recordScreenshot(bytes) {
        this.tracker.recordScreenshot(bytes);
    }
    /**
     * Record a retry
     */
    recordRetry() {
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
    updateTabCount(count) {
        this.tracker.updateTabCount(count);
    }
    /**
     * Check all budgets
     */
    check() {
        return this.tracker.check();
    }
    /**
     * Get full budget status
     */
    getStatus() {
        return this.tracker.getStatus();
    }
    /**
     * Get remaining budget
     */
    getRemaining() {
        return this.tracker.getRemaining();
    }
    /**
     * Get current usage
     */
    getUsage() {
        return this.tracker.getUsage();
    }
    /**
     * Check if session is within budget
     */
    isWithinBudget() {
        return this.check().allowed;
    }
    /**
     * Check if any critical budget is exhausted
     */
    isExhausted() {
        const result = this.check();
        return !result.allowed;
    }
    /**
     * Get exhausted budgets
     */
    getExhaustedBudgets() {
        return this.check().exhaustedBudgets;
    }
    /**
     * Update configuration
     */
    updateConfig(config) {
        this.tracker.updateConfig(config);
    }
    /**
     * Add event listener
     */
    addListener(listener) {
        this.listeners.add(listener);
    }
    /**
     * Remove event listener
     */
    removeListener(listener) {
        this.listeners.delete(listener);
    }
    /**
     * Emit budget event
     */
    emit(event) {
        for (const listener of this.listeners) {
            try {
                listener(event);
            }
            catch (e) {
                console.error('Budget event listener error:', e);
            }
        }
    }
    /**
     * Get elapsed session time in ms
     */
    getElapsedTimeMs() {
        if (!this.sessionStartTime) {
            return 0;
        }
        return Date.now() - this.sessionStartTime.getTime();
    }
    /**
     * Check session duration
     */
    checkSessionDuration() {
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
    exportUsage() {
        return this.tracker.exportUsage();
    }
}
/**
 * Create a budget tracker with preset configuration
 */
export function createAgentBudgetTracker(preset, overrides) {
    let config;
    if (preset && PRESET_BUDGETS[preset]) {
        config = { ...PRESET_BUDGETS[preset], ...overrides };
    }
    else if (overrides) {
        config = overrides;
    }
    else {
        config = PRESET_BUDGETS.standard;
    }
    return new AgentBudgetTracker(config);
}
export { PRESET_BUDGETS };
//# sourceMappingURL=budget.js.map