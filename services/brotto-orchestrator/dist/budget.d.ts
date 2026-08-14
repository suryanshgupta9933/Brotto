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
import { BudgetConfig, BudgetStatus, BudgetCheckResult, PRESET_BUDGETS, type BudgetUsage } from 'policy-engine';
/**
 * Budget event types
 */
export declare enum BudgetEventType {
    STEP_LIMIT_REACHED = "step_limit_reached",
    TIME_LIMIT_REACHED = "time_limit_reached",
    CONSECUTIVE_FAILURES_LIMIT = "consecutive_failures_limit",
    NAVIGATION_LOOPS_LIMIT = "navigation_loops_limit",
    TOKEN_LIMIT_REACHED = "token_limit_reached",
    COST_LIMIT_REACHED = "cost_limit_reached",
    RETRY_LIMIT_REACHED = "retry_limit_reached",
    WARNING = "warning"
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
export declare class AgentBudgetTracker {
    private tracker;
    private listeners;
    private sessionStartTime;
    constructor(config?: Partial<BudgetConfig>);
    /**
     * Start tracking a new session
     */
    startSession(): void;
    /**
     * Record an agent step
     */
    recordStep(): void;
    /**
     * Record a failed action
     */
    recordFailedAction(): void;
    /**
     * Record a successful action
     */
    recordSuccess(): void;
    /**
     * Record navigation
     */
    recordNavigation(domain: string, url: string): void;
    /**
     * Record token usage from inference
     */
    recordTokens(inputTokens: number, outputTokens: number): void;
    /**
     * Record screenshot bytes
     */
    recordScreenshot(bytes: number): void;
    /**
     * Record a retry
     */
    recordRetry(): void;
    /**
     * Update tab count
     */
    updateTabCount(count: number): void;
    /**
     * Check all budgets
     */
    check(): BudgetCheckResult;
    /**
     * Get full budget status
     */
    getStatus(): BudgetStatus;
    /**
     * Get remaining budget
     */
    getRemaining(): Record<string, number>;
    /**
     * Get current usage
     */
    getUsage(): BudgetUsage;
    /**
     * Check if session is within budget
     */
    isWithinBudget(): boolean;
    /**
     * Check if any critical budget is exhausted
     */
    isExhausted(): boolean;
    /**
     * Get exhausted budgets
     */
    getExhaustedBudgets(): string[];
    /**
     * Update configuration
     */
    updateConfig(config: Partial<BudgetConfig>): void;
    /**
     * Add event listener
     */
    addListener(listener: BudgetEventListener): void;
    /**
     * Remove event listener
     */
    removeListener(listener: BudgetEventListener): void;
    /**
     * Emit budget event
     */
    private emit;
    /**
     * Get elapsed session time in ms
     */
    getElapsedTimeMs(): number;
    /**
     * Check session duration
     */
    checkSessionDuration(): {
        withinLimit: boolean;
        elapsedMs: number;
        limitMs: number;
    };
    /**
     * Export usage for external tracking
     */
    exportUsage(): Record<string, unknown>;
}
/**
 * Create a budget tracker with preset configuration
 */
export declare function createAgentBudgetTracker(preset?: 'conservative' | 'standard' | 'generous', overrides?: Partial<BudgetConfig>): AgentBudgetTracker;
export { PRESET_BUDGETS };
//# sourceMappingURL=budget.d.ts.map