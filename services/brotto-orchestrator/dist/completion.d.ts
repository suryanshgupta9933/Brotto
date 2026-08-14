/**
 * Completion and Failure Detection
 *
 * Detects when a task is complete, has failed, or should be cancelled
 * as specified in ARCHITECTURE.md section 3.2
 *
 * Per ARCHITECTURE.md section 3.6, uses accessibility snapshot as verifier:
 * - Confirm button click opened expected dialog
 * - Confirm text appeared
 * - Check form field values
 * - Detect unexpected navigation
 * - Validate success before declaring complete
 */
import type { FaraAction, ActionResult } from '@brotto/brotto-action-schema';
/**
 * Completion detection result
 */
export interface CompletionDetectionResult {
    isComplete: boolean;
    isFailed: boolean;
    shouldStop: boolean;
    reason: string;
    confidence: number;
    suggestedNextAction?: 'retry' | 'wait' | 'observe' | 'complete' | 'fail';
}
/**
 * Failure detection result
 */
export interface FailureDetectionResult {
    isFailure: boolean;
    isRecoverable: boolean;
    failureType: FailureType;
    reason: string;
    suggestion?: string;
}
/**
 * Failure types for categorization
 */
export declare enum FailureType {
    NAVIGATION_ERROR = "navigation_error",
    ACTION_ERROR = "action_error",
    AUTHENTICATION_ERROR = "authentication_error",
    TIMEOUT_ERROR = "timeout_error",
    CONSENT_ERROR = "consent_error",
    BUDGET_EXHAUSTED = "budget_exhausted",
    POLICY_DENIED = "policy_denied",
    UNKNOWN_ERROR = "unknown_error",
    STALE_SCREENSHOT = "stale_screenshot",
    REPEATED_FAILURE = "repeated_failure"
}
/**
 * Detection configuration
 */
export interface DetectionConfig {
    maxConsecutiveFailures?: number;
    maxRepeatedActions?: number;
    completionConfidenceThreshold?: number;
}
/**
 * Completion and failure detector
 *
 * Uses hybrid approach per ARCHITECTURE.md section 3.6:
 * - Brotto's trained visual behavior for primary detection
 * - Deterministic browser information for safety and reliability
 */
export declare class CompletionDetector {
    private config;
    private recentActions;
    private completedGoals;
    constructor(config?: DetectionConfig);
    /**
     * Record an action and its result for pattern analysis
     */
    recordAction(action: FaraAction, result: ActionResult): void;
    /**
     * Detect completion based on goal and current state
     *
     * Per ARCHITECTURE.md section 3.6:
     * - Use accessibility snapshot as verifier
     * - Check whether expected content appeared
     * - Validate success before declaring complete
     */
    detectCompletion(options: {
        goal: string;
        goalAchieved: boolean;
        goalConfidence: number;
        screenshotAvailable: boolean;
        currentUrl?: string;
        accessibilitySnapshot?: AccessibilitySnapshotResult;
    }): CompletionDetectionResult;
    /**
     * Detect failure based on action result
     */
    detectFailure(options: {
        action: FaraAction;
        result: ActionResult;
        lastUrl?: string;
        currentUrl?: string;
    }): FailureDetectionResult;
    /**
     * Check for repeated consecutive failures
     */
    private checkRepeatedFailures;
    /**
     * Check for repeated same action without state change
     */
    private checkRepeatedActions;
    /**
     * Analyze accessibility snapshot for verification
     *
     * Per ARCHITECTURE.md section 3.6, used as out-of-band verifier:
     * - Confirm button click opened expected dialog
     * - Confirm text appeared
     * - Check form field values
     * - Detect unexpected navigation
     */
    private analyzeAccessibilitySnapshot;
    /**
     * Check if goal was previously marked as completed
     */
    isGoalCompleted(goal: string): boolean;
    /**
     * Mark goal as completed
     */
    markGoalCompleted(goal: string): void;
    /**
     * Clear recent action history
     */
    clear(): void;
    /**
     * Get recent action count
     */
    getRecentActionCount(): number;
}
/**
 * Accessibility snapshot verification result
 *
 * Per ARCHITECTURE.md section 3.6, used as out-of-band verifier
 */
export interface AccessibilitySnapshotResult {
    /** Dialog that was opened, if any */
    dialogOpened?: string;
    /** Whether expected text was found */
    expectedTextFound?: boolean;
    /** Unexpected navigation URL, if any */
    unexpectedNavigation?: string;
    /** Form validation errors, if any */
    formValidationErrors: string[];
    /** DOM content snapshot */
    content?: string;
    /** Page title */
    title?: string;
    /** Whether accessibility tree was captured */
    hasAccessibilityTree: boolean;
}
/**
 * Create a completion detector with defaults
 */
export declare function createCompletionDetector(config?: DetectionConfig): CompletionDetector;
//# sourceMappingURL=completion.d.ts.map