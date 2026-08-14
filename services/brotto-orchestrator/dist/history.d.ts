/**
 * History Management
 *
 * Maintains bounded action and screenshot history as specified in
 * ARCHITECTURE.md section 3.2 and 3.6
 *
 * Keeps only recent N actions and screenshots in the active prompt,
 * stores full trajectory separately.
 */
import type { FaraAction, ActionResult, ObservationId } from '@brotto/brotto-action-schema';
/**
 * Action history entry
 */
export interface HistoryEntry {
    action: FaraAction;
    result: ActionResult;
    observationIdAtExecution: ObservationId;
    executedAt: Date;
    durationMs: number;
}
/**
 * Screenshot history entry
 */
export interface ScreenshotEntry {
    observationId: ObservationId;
    screenshot: Buffer;
    url: string;
    domain: string;
    timestamp: Date;
    actionThatLedToThis?: string;
}
/**
 * History configuration
 */
export interface HistoryConfig {
    maxActionHistory?: number;
    maxScreenshotHistory?: number;
    maxRecentActionsForPrompt?: number;
}
/**
 * Session memory for pause_and_memorize_fact actions
 */
export interface MemoryEntry {
    fact: string;
    category?: string;
    timestamp: Date;
    actionId: string;
}
/**
 * History manager for bounded action and screenshot history
 *
 * Per ARCHITECTURE.md section 3.6:
 * - Keep only a limited number of screenshots in the active prompt
 * - Store the full trajectory separately
 */
export declare class HistoryManager {
    private config;
    private actionHistory;
    private screenshotHistory;
    private memory;
    private trajectory;
    constructor(config?: HistoryConfig);
    /**
     * Record an action and its result
     */
    recordAction(entry: HistoryEntry): void;
    /**
     * Record a screenshot observation
     */
    recordScreenshot(entry: ScreenshotEntry): void;
    /**
     * Store a memory entry (pause_and_memorize_fact action)
     */
    storeMemory(entry: MemoryEntry): void;
    /**
     * Get recent actions for prompt context
     * Returns the most recent N actions that led to current state
     */
    getRecentActions(count?: number): HistoryEntry[];
    /**
     * Get all action history
     */
    getActionHistory(): ReadonlyArray<HistoryEntry>;
    /**
     * Get screenshot history
     */
    getScreenshotHistory(): ReadonlyArray<ScreenshotEntry>;
    /**
     * Get most recent screenshot
     */
    getMostRecentScreenshot(): ScreenshotEntry | null;
    /**
     * Get memories for a category
     */
    getMemories(category?: string): ReadonlyArray<MemoryEntry>;
    /**
     * Get all memories
     */
    getAllMemories(): ReadonlyArray<MemoryEntry>;
    /**
     * Get full trajectory for debugging/audit
     */
    getTrajectory(): ReadonlyArray<FullTrajectoryEntry>;
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
    buildPromptContext(options: {
        goal: string;
        includeActionsCount?: number;
        includeMemories?: boolean;
    }): PromptContext;
    /**
     * Clear all history
     */
    clear(): void;
    /**
     * Get statistics
     */
    getStats(): HistoryStats;
}
/**
 * Full trajectory entry for audit/debugging
 */
export interface FullTrajectoryEntry {
    type: 'action' | 'screenshot' | 'memory' | 'approval';
    timestamp: Date;
    data: unknown;
}
/**
 * Prompt context structure for Brotto
 */
export interface PromptContext {
    goal: string;
    recentActions: Array<{
        actionType: string;
        actionId: string;
        success: boolean;
        error?: string;
        timestamp: string;
    }>;
    lastActionResult: {
        success: boolean;
        error?: string;
    } | null;
    failureMessage?: string;
    memories: Array<{
        fact: string;
        category?: string;
    }>;
    totalActionsCount: number;
    totalScreenshotsCount: number;
}
/**
 * History statistics
 */
export interface HistoryStats {
    actionHistorySize: number;
    screenshotHistorySize: number;
    memorySize: number;
    trajectorySize: number;
    maxActionHistory: number;
    maxScreenshotHistory: number;
}
//# sourceMappingURL=history.d.ts.map