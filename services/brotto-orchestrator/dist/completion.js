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
/**
 * Failure types for categorization
 */
export var FailureType;
(function (FailureType) {
    FailureType["NAVIGATION_ERROR"] = "navigation_error";
    FailureType["ACTION_ERROR"] = "action_error";
    FailureType["AUTHENTICATION_ERROR"] = "authentication_error";
    FailureType["TIMEOUT_ERROR"] = "timeout_error";
    FailureType["CONSENT_ERROR"] = "consent_error";
    FailureType["BUDGET_EXHAUSTED"] = "budget_exhausted";
    FailureType["POLICY_DENIED"] = "policy_denied";
    FailureType["UNKNOWN_ERROR"] = "unknown_error";
    FailureType["STALE_SCREENSHOT"] = "stale_screenshot";
    FailureType["REPEATED_FAILURE"] = "repeated_failure";
})(FailureType || (FailureType = {}));
/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
    maxConsecutiveFailures: 5,
    maxRepeatedActions: 3,
    completionConfidenceThreshold: 0.8,
};
/**
 * Completion and failure detector
 *
 * Uses hybrid approach per ARCHITECTURE.md section 3.6:
 * - Brotto's trained visual behavior for primary detection
 * - Deterministic browser information for safety and reliability
 */
export class CompletionDetector {
    config;
    recentActions = [];
    completedGoals = new Set();
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Record an action and its result for pattern analysis
     */
    recordAction(action, result) {
        this.recentActions.push({
            action,
            result,
            timestamp: new Date(),
        });
        // Keep only recent actions
        if (this.recentActions.length > 20) {
            this.recentActions = this.recentActions.slice(-20);
        }
    }
    /**
     * Detect completion based on goal and current state
     *
     * Per ARCHITECTURE.md section 3.6:
     * - Use accessibility snapshot as verifier
     * - Check whether expected content appeared
     * - Validate success before declaring complete
     */
    detectCompletion(options) {
        const { goalAchieved, goalConfidence } = options;
        // If goal is clearly achieved with high confidence
        if (goalAchieved && goalConfidence >= this.config.completionConfidenceThreshold) {
            return {
                isComplete: true,
                isFailed: false,
                shouldStop: true,
                reason: `Goal achieved with ${Math.round(goalConfidence * 100)}% confidence`,
                confidence: goalConfidence,
                suggestedNextAction: 'complete',
            };
        }
        // Check for repeated failures (suggests stuck)
        const repeatedFailureResult = this.checkRepeatedFailures();
        if (repeatedFailureResult.isFailure) {
            return {
                isComplete: false,
                isFailed: true,
                shouldStop: true,
                reason: repeatedFailureResult.reason,
                confidence: 0.9,
                suggestedNextAction: 'fail',
            };
        }
        // Check for repeated same actions without state change
        const repeatedActionResult = this.checkRepeatedActions();
        if (repeatedActionResult.isFailure) {
            return {
                isComplete: false,
                isFailed: true,
                shouldStop: true,
                reason: repeatedActionResult.reason,
                confidence: 0.85,
                suggestedNextAction: 'fail',
            };
        }
        // Check accessibility snapshot if available
        if (options.accessibilitySnapshot) {
            const snapshotResult = this.analyzeAccessibilitySnapshot(options.accessibilitySnapshot);
            if (snapshotResult.suggestStop) {
                return {
                    isComplete: snapshotResult.goalAchieved,
                    isFailed: false,
                    shouldStop: true,
                    reason: snapshotResult.reason,
                    confidence: snapshotResult.confidence,
                    suggestedNextAction: snapshotResult.goalAchieved ? 'complete' : 'observe',
                };
            }
        }
        // Not enough evidence to complete or fail
        return {
            isComplete: false,
            isFailed: false,
            shouldStop: false,
            reason: 'Task is still in progress',
            confidence: 0.5,
            suggestedNextAction: goalConfidence > 0.5 ? 'retry' : 'observe',
        };
    }
    /**
     * Detect failure based on action result
     */
    detectFailure(options) {
        const { result } = options;
        // Action succeeded
        if (result.success) {
            return {
                isFailure: false,
                isRecoverable: false,
                failureType: FailureType.UNKNOWN_ERROR,
                reason: 'Action succeeded',
            };
        }
        const error = result.error.message.toLowerCase();
        const errorCode = result.error.code;
        // Categorize the failure
        if (error.includes('navigation') || error.includes('url') || error.includes('timeout')) {
            // Check if it's a consent/gate page
            if (error.includes('consent') || error.includes('gate') || error.includes('age')) {
                return {
                    isFailure: true,
                    isRecoverable: false,
                    failureType: FailureType.CONSENT_ERROR,
                    reason: 'Navigation blocked by consent/gate page',
                    suggestion: 'This type of content cannot be automated',
                };
            }
            // Check for auth required
            if (error.includes('auth') || error.includes('login') || error.includes('signin')) {
                return {
                    isFailure: true,
                    isRecoverable: true,
                    failureType: FailureType.AUTHENTICATION_ERROR,
                    reason: 'Authentication required',
                    suggestion: 'Session may need re-authentication',
                };
            }
            return {
                isFailure: true,
                isRecoverable: true,
                failureType: FailureType.NAVIGATION_ERROR,
                reason: `Navigation failed: ${result.error.message}`,
                suggestion: 'Retry navigation or try an alternative approach',
            };
        }
        if (error.includes('timeout')) {
            return {
                isFailure: true,
                isRecoverable: true,
                failureType: FailureType.TIMEOUT_ERROR,
                reason: 'Action timed out',
                suggestion: 'Wait and retry, or try a different approach',
            };
        }
        if (error.includes('stale') || error.includes('observation')) {
            return {
                isFailure: true,
                isRecoverable: true,
                failureType: FailureType.STALE_SCREENSHOT,
                reason: 'Screenshot is stale, page may have changed',
                suggestion: 'Take a new screenshot and retry',
            };
        }
        if (errorCode === 'policy_denied') {
            return {
                isFailure: true,
                isRecoverable: false,
                failureType: FailureType.POLICY_DENIED,
                reason: 'Action denied by policy',
                suggestion: 'This action is not permitted',
            };
        }
        if (errorCode === 'budget_exhausted') {
            return {
                isFailure: true,
                isRecoverable: false,
                failureType: FailureType.BUDGET_EXHAUSTED,
                reason: 'Resource budget exhausted',
                suggestion: 'Session has exceeded its resource limits',
            };
        }
        // Generic action error - might be recoverable
        return {
            isFailure: true,
            isRecoverable: true,
            failureType: FailureType.ACTION_ERROR,
            reason: result.error.message || 'Action failed',
            suggestion: 'Retry the action or try an alternative approach',
        };
    }
    /**
     * Check for repeated consecutive failures
     */
    checkRepeatedFailures() {
        const recentFailures = this.recentActions.filter((a) => !a.result.success);
        if (recentFailures.length >= this.config.maxConsecutiveFailures) {
            return {
                isFailure: true,
                reason: `${recentFailures.length} consecutive failed actions`,
            };
        }
        return { isFailure: false, reason: '' };
    }
    /**
     * Check for repeated same action without state change
     */
    checkRepeatedActions() {
        if (this.recentActions.length < this.config.maxRepeatedActions) {
            return { isFailure: false, reason: '' };
        }
        const recent = this.recentActions.slice(-this.config.maxRepeatedActions);
        // Check if all recent actions are the same type
        const firstType = recent[0].action.type;
        if (recent.every((a) => a.action.type === firstType)) {
            // Check if they all failed or had no result change
            const allFailed = recent.every((a) => !a.result.success);
            if (allFailed) {
                return {
                    isFailure: true,
                    reason: `Same action (${firstType}) repeated ${this.config.maxRepeatedActions} times without success`,
                };
            }
        }
        return { isFailure: false, reason: '' };
    }
    /**
     * Analyze accessibility snapshot for verification
     *
     * Per ARCHITECTURE.md section 3.6, used as out-of-band verifier:
     * - Confirm button click opened expected dialog
     * - Confirm text appeared
     * - Check form field values
     * - Detect unexpected navigation
     */
    analyzeAccessibilitySnapshot(snapshot) {
        // Check for dialog opened
        if (snapshot.dialogOpened) {
            // If we were trying to click something that should open a dialog
            // and the dialog is now visible, that's good progress
            return {
                suggestStop: false,
                goalAchieved: false,
                reason: `Dialog detected: ${snapshot.dialogOpened}`,
                confidence: 0.7,
            };
        }
        // Check for expected text
        if (snapshot.expectedTextFound !== undefined) {
            if (snapshot.expectedTextFound) {
                return {
                    suggestStop: false,
                    goalAchieved: false,
                    reason: 'Expected text found on page',
                    confidence: 0.8,
                };
            }
            else {
                return {
                    suggestStop: false,
                    goalAchieved: false,
                    reason: 'Expected text not found, may need more actions',
                    confidence: 0.6,
                };
            }
        }
        // Check for unexpected navigation
        if (snapshot.unexpectedNavigation) {
            return {
                suggestStop: false,
                goalAchieved: false,
                reason: `Unexpected navigation to: ${snapshot.unexpectedNavigation}`,
                confidence: 0.5,
            };
        }
        // Check for form validation
        if (snapshot.formValidationErrors.length > 0) {
            return {
                suggestStop: false,
                goalAchieved: false,
                reason: `Form validation errors: ${snapshot.formValidationErrors.join(', ')}`,
                confidence: 0.7,
            };
        }
        // No specific patterns detected
        return {
            suggestStop: false,
            goalAchieved: false,
            reason: 'No completion signals detected',
            confidence: 0.3,
        };
    }
    /**
     * Check if goal was previously marked as completed
     */
    isGoalCompleted(goal) {
        return this.completedGoals.has(goal);
    }
    /**
     * Mark goal as completed
     */
    markGoalCompleted(goal) {
        this.completedGoals.add(goal);
    }
    /**
     * Clear recent action history
     */
    clear() {
        this.recentActions = [];
    }
    /**
     * Get recent action count
     */
    getRecentActionCount() {
        return this.recentActions.length;
    }
}
/**
 * Create a completion detector with defaults
 */
export function createCompletionDetector(config) {
    return new CompletionDetector(config);
}
//# sourceMappingURL=completion.js.map