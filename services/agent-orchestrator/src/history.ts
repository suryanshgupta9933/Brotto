/**
 * History Management
 *
 * Maintains bounded action and screenshot history as specified in
 * ARCHITECTURE.md section 3.2 and 3.6
 *
 * Keeps only recent N actions and screenshots in the active prompt,
 * stores full trajectory separately.
 */

import type {
  FaraAction,
  ActionResult,
  ObservationId,
} from '@fara/fara-action-schema';

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
  actionThatLedToThis?: string; // action ID that caused navigation to this state
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
 * Default configuration
 */
const DEFAULT_CONFIG: Required<HistoryConfig> = {
  maxActionHistory: 100,
  maxScreenshotHistory: 10,
  maxRecentActionsForPrompt: 5,
};

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
export class HistoryManager {
  private config: Required<HistoryConfig>;
  private actionHistory: HistoryEntry[] = [];
  private screenshotHistory: ScreenshotEntry[] = [];
  private memory: MemoryEntry[] = [];
  private trajectory: FullTrajectoryEntry[] = [];

  constructor(config: HistoryConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record an action and its result
   */
  recordAction(entry: HistoryEntry): void {
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
  recordScreenshot(entry: ScreenshotEntry): void {
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
  storeMemory(entry: MemoryEntry): void {
    this.memory.push(entry);
  }

  /**
   * Get recent actions for prompt context
   * Returns the most recent N actions that led to current state
   */
  getRecentActions(count?: number): HistoryEntry[] {
    const n = count ?? this.config.maxRecentActionsForPrompt;
    return this.actionHistory.slice(-n);
  }

  /**
   * Get all action history
   */
  getActionHistory(): ReadonlyArray<HistoryEntry> {
    return [...this.actionHistory];
  }

  /**
   * Get screenshot history
   */
  getScreenshotHistory(): ReadonlyArray<ScreenshotEntry> {
    return [...this.screenshotHistory];
  }

  /**
   * Get most recent screenshot
   */
  getMostRecentScreenshot(): ScreenshotEntry | null {
    if (this.screenshotHistory.length === 0) {
      return null;
    }
    return this.screenshotHistory[this.screenshotHistory.length - 1];
  }

  /**
   * Get memories for a category
   */
  getMemories(category?: string): ReadonlyArray<MemoryEntry> {
    if (category) {
      return this.memory.filter((m) => m.category === category);
    }
    return [...this.memory];
  }

  /**
   * Get all memories
   */
  getAllMemories(): ReadonlyArray<MemoryEntry> {
    return [...this.memory];
  }

  /**
   * Get full trajectory for debugging/audit
   */
  getTrajectory(): ReadonlyArray<FullTrajectoryEntry> {
    return [...this.trajectory];
  }

  /**
   * Build prompt context for Fara inference
   *
   * Per ARCHITECTURE.md section 3.6, Fara should receive:
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
  }): PromptContext {
    const actions = this.getRecentActions(options.includeActionsCount);
    const memories = options.includeMemories ? this.getAllMemories() : [];

    // Build recent actions summary
    const recentActionsSummary = actions.map((entry) => ({
      actionType: entry.action.type,
      actionId: entry.action.id,
      success: entry.result.success,
      error: entry.result.error,
      timestamp: entry.executedAt.toISOString(),
    }));

    // Get last action result
    const lastResult = actions.length > 0 ? actions[actions.length - 1].result : null;

    // Build failure message if last action failed
    let failureMessage: string | undefined;
    if (lastResult && !lastResult.success && lastResult.error) {
      failureMessage = `Last action failed: ${lastResult.error}`;
    }

    return {
      goal: options.goal,
      recentActions: recentActionsSummary,
      lastActionResult: lastResult
        ? {
            success: lastResult.success,
            error: lastResult.error,
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
  clear(): void {
    this.actionHistory = [];
    this.screenshotHistory = [];
    this.memory = [];
    this.trajectory = [];
  }

  /**
   * Get statistics
   */
  getStats(): HistoryStats {
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

/**
 * Full trajectory entry for audit/debugging
 */
export interface FullTrajectoryEntry {
  type: 'action' | 'screenshot' | 'memory' | 'approval';
  timestamp: Date;
  data: unknown;
}

/**
 * Prompt context structure for Fara
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
