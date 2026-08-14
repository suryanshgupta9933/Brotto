/**
 * History Management
 *
 * Maintains bounded action and screenshot history as specified in
 * ARCHITECTURE.md section 3.2 and 3.6
 *
 * Keeps only recent N actions and screenshots in the active prompt,
 * stores full trajectory separately.
 */
/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
    maxActionHistory: 100,
    maxScreenshotHistory: 10,
    maxRecentActionsForPrompt: 5,
};
/**
 * History manager for bounded action and screenshot history
 *
 * Per ARCHITECTURE.md section 3.6:
 * - Keep only a limited number of screenshots in the active prompt
 * - Store the full trajectory separately
 */
export class HistoryManager {
    config;
    actionHistory = [];
    screenshotHistory = [];
    memory = [];
    trajectory = [];
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Record an action and its result
     */
    recordAction(entry) {
        // Add to history
        this.actionHistory.push(entry);
        // Trim if exceeds max
        if (this.actionHistory.length > this.config.maxActionHistory) {
            this.actionHistory = this.actionHistory.slice(-this.config.maxActionHistory);
        }
        // Add to full trajectory
        this.trajectory.push({
            type: 'action',
            timestamp: new Date(),
            data: entry,
        });
    }
    /**
     * Record a screenshot observation
     */
    recordScreenshot(entry) {
        // Add to screenshot history
        this.screenshotHistory.push(entry);
        // Trim if exceeds max
        if (this.screenshotHistory.length > this.config.maxScreenshotHistory) {
            this.screenshotHistory = this.screenshotHistory.slice(-this.config.maxScreenshotHistory);
        }
        // Add to full trajectory
        this.trajectory.push({
            type: 'screenshot',
            timestamp: new Date(),
            data: entry,
        });
    }
    /**
     * Store a memory entry (pause_and_memorize_fact action)
     */
    storeMemory(entry) {
        this.memory.push(entry);
    }
    /**
     * Get recent actions for prompt context
     * Returns the most recent N actions that led to current state
     */
    getRecentActions(count) {
        const n = count ?? this.config.maxRecentActionsForPrompt;
        return this.actionHistory.slice(-n);
    }
    /**
     * Get all action history
     */
    getActionHistory() {
        return [...this.actionHistory];
    }
    /**
     * Get screenshot history
     */
    getScreenshotHistory() {
        return [...this.screenshotHistory];
    }
    /**
     * Get most recent screenshot
     */
    getMostRecentScreenshot() {
        if (this.screenshotHistory.length === 0) {
            return null;
        }
        return this.screenshotHistory[this.screenshotHistory.length - 1];
    }
    /**
     * Get memories for a category
     */
    getMemories(category) {
        if (category) {
            return this.memory.filter((m) => m.category === category);
        }
        return [...this.memory];
    }
    /**
     * Get all memories
     */
    getAllMemories() {
        return [...this.memory];
    }
    /**
     * Get full trajectory for debugging/audit
     */
    getTrajectory() {
        return [...this.trajectory];
    }
    /**
     * Build prompt context for Brotto inference
     *
     * Per ARCHITECTURE.md section 3.6, Brotto should receive:
     * - Current screenshot (handled separately)
     * - User's original goal (passed separately)
     * - Relevant recent actions
     * - Relevant approved user answers
     * - Result of previous action
     * - Concise failure message when action failed
     */
    buildPromptContext(options) {
        const actions = this.getRecentActions(options.includeActionsCount);
        const memories = options.includeMemories ? this.getAllMemories() : [];
        // Build recent actions summary
        const errorMessage = (result) => (result.success ? undefined : result.error.message);
        const recentActionsSummary = actions.map((entry) => ({
            actionType: entry.action.type,
            actionId: entry.action.id,
            success: entry.result.success,
            error: errorMessage(entry.result),
            timestamp: entry.executedAt.toISOString(),
        }));
        // Get last action result
        const lastResult = actions.length > 0 ? actions[actions.length - 1].result : null;
        // Build failure message if last action failed
        let failureMessage;
        if (lastResult && !lastResult.success) {
            failureMessage = `Last action failed: ${lastResult.error.message}`;
        }
        return {
            goal: options.goal,
            recentActions: recentActionsSummary,
            lastActionResult: lastResult
                ? {
                    success: lastResult.success,
                    error: errorMessage(lastResult),
                }
                : null,
            failureMessage,
            memories: memories.map((m) => ({
                fact: m.fact,
                category: m.category,
            })),
            totalActionsCount: this.actionHistory.length,
            totalScreenshotsCount: this.screenshotHistory.length,
        };
    }
    /**
     * Clear all history
     */
    clear() {
        this.actionHistory = [];
        this.screenshotHistory = [];
        this.memory = [];
        this.trajectory = [];
    }
    /**
     * Get statistics
     */
    getStats() {
        return {
            actionHistorySize: this.actionHistory.length,
            screenshotHistorySize: this.screenshotHistory.length,
            memorySize: this.memory.length,
            trajectorySize: this.trajectory.length,
            maxActionHistory: this.config.maxActionHistory,
            maxScreenshotHistory: this.config.maxScreenshotHistory,
        };
    }
}
//# sourceMappingURL=history.js.map