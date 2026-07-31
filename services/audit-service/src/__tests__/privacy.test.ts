import { v4 as uuidv4 } from 'uuid';
import {
  PrivacyManager,
  getPrivacyManager,
  DEFAULT_RETENTION_POLICY,
} from '../privacy';
import { AuditEvent, RetentionPolicy } from '../types';

describe('PrivacyManager', () => {
  let privacyManager: PrivacyManager;
  let testOrgId: string;

  beforeEach(() => {
    privacyManager = new PrivacyManager();
    testOrgId = uuidv4();
  });

  describe('retention policy management', () => {
    it('should return default policy for unknown organization', () => {
      const policy = privacyManager.getRetentionPolicy(testOrgId);
      expect(policy.organizationId).toBe(testOrgId);
      expect(policy.screenshotRetentionDays).toBe(0);
      expect(policy.auditRetentionDays).toBe(90);
      expect(policy.redactScreenshots).toBe(true);
    });

    it('should set and retrieve custom retention policy', () => {
      const policy: Partial<RetentionPolicy> = {
        screenshotRetentionDays: 7,
        auditRetentionDays: 180,
        enableFullScreenshotConsent: true,
      };

      privacyManager.setRetentionPolicy(testOrgId, policy);
      const retrieved = privacyManager.getRetentionPolicy(testOrgId);

      expect(retrieved.screenshotRetentionDays).toBe(7);
      expect(retrieved.auditRetentionDays).toBe(180);
      expect(retrieved.enableFullScreenshotConsent).toBe(true);
    });

    it('should update existing policy', () => {
      privacyManager.setRetentionPolicy(testOrgId, {
        screenshotRetentionDays: 30,
        auditRetentionDays: 365,
      });

      privacyManager.setRetentionPolicy(testOrgId, {
        screenshotRetentionDays: 60,
      });

      const retrieved = privacyManager.getRetentionPolicy(testOrgId);
      expect(retrieved.screenshotRetentionDays).toBe(60);
      expect(retrieved.auditRetentionDays).toBe(365);
    });
  });

  describe('event redaction', () => {
    function createTestEvent(overrides?: Partial<AuditEvent>): AuditEvent {
      return {
        sessionId: uuidv4(),
        organizationId: testOrgId,
        userId: uuidv4(),
        creator: {
          userId: uuidv4(),
          email: 'user@example.com',
          name: 'Test User',
        },
        device: {
          deviceId: uuidv4(),
          clientType: 'desktop_connector',
        },
        timestamp: new Date().toISOString(),
        ...overrides,
      };
    }

    it('should redact sensitive patterns from strings', () => {
      const event = createTestEvent();
      // Use actual pattern format that matches the regex
      event.proposedAction = {
        actionId: uuidv4(),
        actionType: 'keyboard_insert_text',
        payload: {
          // Password in format "password=secret" should be redacted
          credentials: 'password=super_secret_123',
        },
        observationId: 'obs-123',
      };

      const { redactedEvent, redactionCount } = privacyManager.redactEvent(event);

      expect(redactionCount).toBeGreaterThan(0);
      const payload = redactedEvent.proposedAction?.payload as Record<string, unknown>;
      expect(payload.credentials).toBe('password=[REDACTED]');
    });

    it('should redact API keys from strings', () => {
      const event = createTestEvent();
      event.proposedAction = {
        actionId: uuidv4(),
        actionType: 'keyboard_insert_text',
        payload: {
          apiKey: 'api_key=sk-1234567890abcdef',
        },
        observationId: 'obs-123',
      };

      const { redactedEvent } = privacyManager.redactEvent(event);
      const payload = redactedEvent.proposedAction?.payload as Record<string, unknown>;
      expect(payload.apiKey).toBe('api_key=[REDACTED]');
    });

    it('should redact tokens from URLs', () => {
      const event = createTestEvent();
      event.proposedAction = {
        actionId: uuidv4(),
        actionType: 'visit_url',
        targetUrl: 'https://example.com/dashboard?token=abc123',
        observationId: 'obs-123',
      };

      const { redactedEvent } = privacyManager.redactEvent(event);
      expect(redactedEvent.proposedAction?.targetUrl).toContain('[REDACTED]');
      expect(redactedEvent.proposedAction?.targetUrl).not.toContain('abc123');
    });

    it('should redact credit card patterns', () => {
      const event = createTestEvent();
      event.proposedAction = {
        actionId: uuidv4(),
        actionType: 'keyboard_insert_text',
        payload: {
          cardNumber: '4111111111111111',
        },
        observationId: 'obs-123',
      };

      const { redactedEvent } = privacyManager.redactEvent(event);
      const payload = redactedEvent.proposedAction?.payload as Record<string, unknown>;
      expect(payload.cardNumber).toBe('[CREDIT_CARD_REDACTED]');
    });

    it('should redact SSN patterns', () => {
      const event = createTestEvent();
      event.proposedAction = {
        actionId: uuidv4(),
        actionType: 'keyboard_insert_text',
        payload: {
          ssn: '123456789',
        },
        observationId: 'obs-123',
      };

      const { redactedEvent } = privacyManager.redactEvent(event);
      const payload = redactedEvent.proposedAction?.payload as Record<string, unknown>;
      expect(payload.ssn).toBe('[SSN_REDACTED]');
    });

    it('should not modify event when no sensitive data present', () => {
      const event = createTestEvent();
      event.proposedAction = {
        actionId: uuidv4(),
        actionType: 'left_click',
        coordinates: { x: 100, y: 200 },
        observationId: 'obs-123',
      };

      const { redactedEvent, redactionCount } = privacyManager.redactEvent(event);
      expect(redactionCount).toBe(0);
      expect(redactedEvent).toEqual(event);
    });

    it('should return zero redaction count for clean event', () => {
      const event = createTestEvent();
      event.sessionState = 'OBSERVING';
      event.currentDomain = 'github.com';

      const { redactionCount } = privacyManager.redactEvent(event);
      expect(redactionCount).toBe(0);
    });
  });

  describe('screenshot hash operations', () => {
    it('should calculate consistent hash for same data', () => {
      const data = Buffer.from('test screenshot data');
      const hash1 = privacyManager.calculateScreenshotHash(data);
      const hash2 = privacyManager.calculateScreenshotHash(data);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 produces 64 hex chars
    });

    it('should produce different hashes for different data', () => {
      const data1 = Buffer.from('screenshot 1');
      const data2 = Buffer.from('screenshot 2');

      const hash1 = privacyManager.calculateScreenshotHash(data1);
      const hash2 = privacyManager.calculateScreenshotHash(data2);

      expect(hash1).not.toBe(hash2);
    });

    it('should verify correct hash', () => {
      const data = Buffer.from('test screenshot');
      const hash = privacyManager.calculateScreenshotHash(data);

      expect(privacyManager.verifyScreenshotHash(data, hash)).toBe(true);
    });

    it('should reject incorrect hash', () => {
      const data = Buffer.from('test screenshot');
      const wrongHash = 'a'.repeat(64);

      expect(privacyManager.verifyScreenshotHash(data, wrongHash)).toBe(false);
    });

    it('should generate short hash', () => {
      const data = Buffer.from('test data');
      const shortHash = privacyManager.generateShortHash(data);

      expect(shortHash).toHaveLength(32);
      expect(shortHash).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe('retention decision', () => {
    it('should retain screenshot within retention period', () => {
      const policy: Partial<RetentionPolicy> = {
        screenshotRetentionDays: 7,
      };
      privacyManager.setRetentionPolicy(testOrgId, policy);

      const eventTime = new Date();
      eventTime.setDate(eventTime.getDate() - 3); // 3 days ago

      expect(
        privacyManager.shouldRetainEvent(eventTime, testOrgId, 'screenshot')
      ).toBe(true);
    });

    it('should not retain screenshot outside retention period', () => {
      const policy: Partial<RetentionPolicy> = {
        screenshotRetentionDays: 7,
      };
      privacyManager.setRetentionPolicy(testOrgId, policy);

      const eventTime = new Date();
      eventTime.setDate(eventTime.getDate() - 10); // 10 days ago

      expect(
        privacyManager.shouldRetainEvent(eventTime, testOrgId, 'screenshot')
      ).toBe(false);
    });

    it('should not retain screenshots when disabled (0 days)', () => {
      const policy: Partial<RetentionPolicy> = {
        screenshotRetentionDays: 0,
      };
      privacyManager.setRetentionPolicy(testOrgId, policy);

      const eventTime = new Date();
      eventTime.setDate(eventTime.getDate() - 1); // 1 day ago

      expect(
        privacyManager.shouldRetainEvent(eventTime, testOrgId, 'screenshot')
      ).toBe(false);
    });

    it('should always retain audit events within audit retention period', () => {
      const policy: Partial<RetentionPolicy> = {
        auditRetentionDays: 90,
      };
      privacyManager.setRetentionPolicy(testOrgId, policy);

      const eventTime = new Date();
      eventTime.setDate(eventTime.getDate() - 30); // 30 days ago

      expect(
        privacyManager.shouldRetainEvent(eventTime, testOrgId, 'action')
      ).toBe(true);
    });
  });

  describe('redacted display', () => {
    it('should create redacted display with visible prefix', () => {
      const result = privacyManager.createRedactedDisplay('secretpassword', 4);
      // 14 chars total, 4 visible = 10 asterisks
      expect(result).toBe('secr**********');
    });

    it('should redact short values completely', () => {
      const result = privacyManager.createRedactedDisplay('pass', 4);
      expect(result).toBe('****');
    });

    it('should handle empty string', () => {
      const result = privacyManager.createRedactedDisplay('', 4);
      expect(result).toBe('');
    });
  });
});

describe('PrivacyManager singleton', () => {
  it('should return the same instance', () => {
    const instance1 = getPrivacyManager();
    const instance2 = getPrivacyManager();
    expect(instance1).toBe(instance2);
  });
});
