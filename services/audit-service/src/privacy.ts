import crypto from 'crypto';
import { AuditEvent, RetentionPolicy, AuditEventRow } from './types.js';

// Default retention policy (most restrictive by default per ARCHITECTURE.md)
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  organizationId: '',
  screenshotRetentionDays: 0, // Disabled by default
  auditRetentionDays: 90, // 90 days default
  enableFullScreenshotConsent: false,
  redactScreenshots: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// Sensitive field patterns for redaction
const SENSITIVE_PATTERNS = [
  // Passwords and secrets
  { pattern: /password["']?\s*[:=]\s*["']?[^"',\s]+/gi, replacement: 'password=[REDACTED]' },
  { pattern: /secret["']?\s*[:=]\s*["']?[^"',\s]+/gi, replacement: 'secret=[REDACTED]' },
  { pattern: /token["']?\s*[:=]\s*["']?[^"',\s]+/gi, replacement: 'token=[REDACTED]' },
  { pattern: /api[_-]?key["']?\s*[:=]\s*["']?[^"',\s]+/gi, replacement: 'api_key=[REDACTED]' },
  { pattern: /authorization["']?\s*[:=]\s*["']?[^"',\s]+/gi, replacement: 'authorization=[REDACTED]' },
  // Cookie values
  { pattern: /cookie["']?\s*[:=]\s*["']?[^"',\s]+/gi, replacement: 'cookie=[REDACTED]' },
  // Credit card patterns (basic)
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: '[CREDIT_CARD_REDACTED]' },
  // Email addresses in non-essential contexts (optional, may want to keep for audit)
  // Commented out as audit usually wants to track who did what
  // { pattern: /[\w.-]+@[\w.-]+\.\w+/g, replacement: '[EMAIL_REDACTED]' },
  // SSN patterns
  { pattern: /\b\d{3}[\s-]?\d{2}[\s-]?\d{4}\b/g, replacement: '[SSN_REDACTED]' },
];

// Redaction result
export interface RedactionResult {
  redactedEvent: AuditEvent;
  redactionCount: number;
}

// Privacy manager for handling redaction and retention
export class PrivacyManager {
  private organizationPolicies: Map<string, RetentionPolicy> = new Map();

  setRetentionPolicy(organizationId: string, policy: Partial<RetentionPolicy>): void {
    const existingPolicy = this.organizationPolicies.get(organizationId) || {
      ...DEFAULT_RETENTION_POLICY,
      organizationId,
    };
    this.organizationPolicies.set(organizationId, {
      ...existingPolicy,
      ...policy,
      updatedAt: new Date().toISOString(),
    });
  }

  getRetentionPolicy(organizationId: string): RetentionPolicy {
    return (
      this.organizationPolicies.get(organizationId) || {
        ...DEFAULT_RETENTION_POLICY,
        organizationId,
      }
    );
  }

  // Redact sensitive information from an audit event
  redactEvent(event: AuditEvent): RedactionResult {
    let redactionCount = 0;
    const redactedEvent = JSON.parse(JSON.stringify(event)) as AuditEvent; // Deep clone

    // Redact from proposed action payload
    if (redactedEvent.proposedAction?.payload) {
      const [redactedPayload, count] = this.redactObject(redactedEvent.proposedAction.payload);
      redactedEvent.proposedAction.payload = redactedPayload;
      redactionCount += count;
    }

    // Redact from executed action payload
    if (redactedEvent.executedAction?.payload) {
      const [redactedPayload, count] = this.redactObject(redactedEvent.executedAction.payload);
      redactedEvent.executedAction.payload = redactedPayload;
      redactionCount += count;
    }

    // Redact from target URLs (remove query params that may contain sensitive data)
    if (redactedEvent.proposedAction?.targetUrl) {
      const redacted = this.redactUrl(redactedEvent.proposedAction.targetUrl);
      if (redacted !== redactedEvent.proposedAction.targetUrl) {
        redactionCount++;
        redactedEvent.proposedAction.targetUrl = redacted;
      }
    }

    // Redact error messages
    if (redactedEvent.error?.errorMessage) {
      const [redacted, count] = this.redactString(redactedEvent.error.errorMessage);
      redactedEvent.error.errorMessage = redacted;
      redactionCount += count;
    }

    // Redact action reasoning (may contain sensitive context)
    if (redactedEvent.proposedAction?.reasoning) {
      const [redacted, count] = this.redactString(redactedEvent.proposedAction.reasoning);
      redactedEvent.proposedAction.reasoning = redacted;
      redactionCount += count;
    }

    return { redactedEvent, redactionCount };
  }

  // Redact sensitive patterns from an object
  private redactObject(obj: Record<string, unknown>): [Record<string, unknown>, number] {
    let count = 0;
    const redacted = { ...obj };

    for (const key of Object.keys(redacted)) {
      const value = redacted[key];

      if (typeof value === 'string') {
        const [redactedValue, c] = this.redactString(value);
        if (redactedValue !== value) {
          redacted[key] = redactedValue;
          count += c;
        }
      } else if (typeof value === 'object' && value !== null) {
        const [redactedValue, c] = this.redactObject(value as Record<string, unknown>);
        redacted[key] = redactedValue;
        count += c;
      }
    }

    return [redacted, count];
  }

  // Redact sensitive patterns from a string
  private redactString(str: string): [string, number] {
    let result = str;
    let count = 0;

    for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
      const matches = result.match(pattern);
      if (matches) {
        count += matches.length;
        result = result.replace(pattern, replacement);
      }
    }

    return [result, count];
  }

  // Redact URL by removing query parameters that may contain sensitive data
  private redactUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove or redact query parameters
      const sensitiveParams = ['token', 'key', 'secret', 'password', 'auth', 'credential'];
      const params = parsed.searchParams;

      let modified = false;
      for (const param of sensitiveParams) {
        if (params.has(param)) {
          params.set(param, '[REDACTED]');
          modified = true;
        }
      }

      // Decode to get human-readable format (URLSearchParams encodes special chars)
      return decodeURIComponent(parsed.toString());
    } catch {
      // If URL parsing fails, return as-is
      return url;
    }
  }

  // Check if an event should be retained based on retention policy
  shouldRetainEvent(
    eventTimestamp: Date,
    organizationId: string,
    eventType: 'screenshot' | 'action' | 'session'
  ): boolean {
    const policy = this.getRetentionPolicy(organizationId);
    const ageDays = (Date.now() - eventTimestamp.getTime()) / (1000 * 60 * 60 * 24);

    if (eventType === 'screenshot') {
      return policy.screenshotRetentionDays > 0 && ageDays <= policy.screenshotRetentionDays;
    }

    // Audit events (non-screenshot) retention
    return ageDays <= policy.auditRetentionDays;
  }

  // Calculate screenshot hash for verification without storing screenshot
  calculateScreenshotHash(screenshotBuffer: Buffer): string {
    return crypto.createHash('sha256').update(screenshotBuffer).digest('hex');
  }

  // Verify screenshot integrity by comparing hash
  verifyScreenshotHash(screenshotBuffer: Buffer, expectedHash: string): boolean {
    const actualHash = this.calculateScreenshotHash(screenshotBuffer);
    return actualHash === expectedHash;
  }

  // Generate a truncated hash for quick lookups (first 16 bytes hex)
  generateShortHash(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
  }

  // Create a redaction mask for display purposes
  createRedactedDisplay(value: string, visibleChars: number = 4): string {
    if (value.length <= visibleChars) {
      return '*'.repeat(value.length);
    }
    return value.substring(0, visibleChars) + '*'.repeat(value.length - visibleChars);
  }
}

// Privacy service singleton
let privacyManagerInstance: PrivacyManager | null = null;

export function getPrivacyManager(): PrivacyManager {
  if (!privacyManagerInstance) {
    privacyManagerInstance = new PrivacyManager();
  }
  return privacyManagerInstance;
}

export function resetPrivacyManager(): void {
  privacyManagerInstance = null;
}
