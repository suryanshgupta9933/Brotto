/**
 * Accessibility Snapshot Verifier
 * Re-exports from adapter.ts to avoid circular dependencies
 */

// Re-export the verifier from adapter
export { AccessibilityVerifier, createAccessibilityVerifier } from './adapter.js';
export type { VerificationCondition } from './adapter.js';
