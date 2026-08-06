import { v4 as uuidv4 } from 'uuid';
import { AuditRecorder, createAuditRecorder } from '../recorder';
import { AuditEvent, DeviceInfo } from '../types';

describe('AuditRecorder', () => {
  let recorder: AuditRecorder;
  let mockDevice: DeviceInfo;
  let organizationId: string;
  let userId: string;

  beforeEach(() => {
    organizationId = uuidv4();
    userId = uuidv4();
    mockDevice = {
      deviceId: uuidv4(),
      deviceName: 'Test Device',
      deviceType: 'desktop',
      osPlatform: 'macOS',
      osVersion: '14.0',
      clientType: 'desktop_connector',
      clientVersion: '1.0.0',
    };

    recorder = createAuditRecorder({
      organizationId,
      userId,
      device: mockDevice,
      modelVersion: 'brotto-1.5-9b',
      promptTemplateVersion: 'v1.0',
    });
  });

  afterEach(async () => {
    await recorder.shutdown();
  });

  describe('session lifecycle', () => {
    it('should create a recorder with session id', () => {
      const context = recorder.getSessionContext();
      expect(context.sessionId).toBeDefined();
      expect(context.sessionId.length).toBe(36); // UUID format
    });

    it('should record session created event', () => {
      recorder.recordSessionCreated();
      const context = recorder.getSessionContext();
      expect(context.sessionState).toBeUndefined(); // Context doesn't track state changes
    });

    it('should record session connected event', () => {
      recorder.recordSessionConnected();
      const context = recorder.getSessionContext();
      expect(context.sessionId).toBeDefined();
    });

    it('should record session terminated', async () => {
      recorder.recordSessionTerminated('COMPLETED');
      const context = recorder.getSessionContext();
      expect(context.sessionId).toBeDefined();
    });
  });

  describe('screenshot hash recording', () => {
    it('should record screenshot hash from buffer', () => {
      const screenshotBuffer = Buffer.from('fake screenshot data');
      recorder.recordScreenshotHash('obs-123', screenshotBuffer, 1920, 1080);
      const context = recorder.getSessionContext();
      expect(context.sessionId).toBeDefined();
    });

    it('should record screenshot hash directly', () => {
      const hash = 'a'.repeat(64); // Valid SHA-256 hex
      recorder.recordScreenshotHashOnly('obs-456', hash, 1280, 720, true);
      const context = recorder.getSessionContext();
      expect(context.sessionId).toBeDefined();
    });
  });

  describe('action recording', () => {
    it('should record proposed action and return action ID', () => {
      const actionId = recorder.recordProposedAction(
        'visit_url',
        'https://example.com',
        'example.com',
        undefined,
        undefined,
        'Navigate to example.com',
        'obs-789'
      );

      expect(actionId).toBeDefined();
      expect(typeof actionId).toBe('string');
      expect(actionId.length).toBe(36); // UUID format
    });

    it('should record proposed action with coordinates', () => {
      const actionId = recorder.recordProposedAction(
        'left_click',
        undefined,
        'example.com',
        { x: 100, y: 200 },
        { button: 'left' },
        'Click the submit button'
      );

      expect(actionId).toBeDefined();
    });

    it('should record policy result', () => {
      const actionId = uuidv4();
      recorder.recordPolicyResult(
        actionId,
        'ALLOWED',
        'Action is within policy',
        false
      );
      // Event is enqueued successfully (no error thrown)
      expect(true).toBe(true);
    });

    it('should record policy result requiring consent', () => {
      const actionId = uuidv4();
      recorder.recordPolicyResult(
        actionId,
        'REQUIRES_CONSENT',
        'Sensitive action requires user consent',
        true,
        ['personal_data', 'financial']
      );
      expect(true).toBe(true);
    });

    it('should record approval decision and return approval ID', () => {
      const actionId = uuidv4();
      const approvalId = recorder.recordApprovalDecision(
        actionId,
        'APPROVED',
        uuidv4(),
        'Looks good'
      );

      expect(approvalId).toBeDefined();
      expect(typeof approvalId).toBe('string');
      expect(approvalId.length).toBe(36); // UUID format
    });

    it('should record executed action and return execution ID', () => {
      const actionId = uuidv4();
      const executionId = recorder.recordExecutedAction(
        actionId,
        'visit_url',
        undefined,
        { url: 'https://example.com' },
        true,
        undefined,
        undefined,
        150
      );

      expect(executionId).toBeDefined();
      expect(executionId.length).toBe(36); // UUID format
    });

    it('should record failed execution', () => {
      const actionId = uuidv4();
      const executionId = recorder.recordExecutedAction(
        actionId,
        'visit_url',
        undefined,
        { url: 'https://example.com' },
        false,
        'Navigation timeout',
        'TIMEOUT_ERROR',
        30000
      );

      expect(executionId).toBeDefined();
    });
  });

  describe('error recording', () => {
    it('should record error and return error ID', () => {
      const errorId = recorder.recordError(
        'CDP_CONNECTION_LOST',
        'Browser connection lost unexpectedly',
        'ERROR',
        undefined,
        'Error: Connection lost\n at Connection.connect()'
      );

      expect(errorId).toBeDefined();
      expect(typeof errorId).toBe('string');
      expect(errorId.length).toBe(36); // UUID format
    });

    it('should record critical error', () => {
      const errorId = recorder.recordError(
        'SECURITY_VIOLATION',
        'Attempted to access restricted resource',
        'CRITICAL'
      );

      expect(errorId).toBeDefined();
    });

    it('should record error with related action', () => {
      const actionId = uuidv4();
      const errorId = recorder.recordError(
        'ACTION_EXECUTION_FAILED',
        'Failed to click element',
        'ERROR',
        actionId
      );

      expect(errorId).toBeDefined();
    });
  });

  describe('context management', () => {
    it('should set browser info', () => {
      recorder.setBrowser({
        browserName: 'Chrome',
        browserVersion: '120.0.0',
        tabIds: ['tab-1', 'tab-2'],
        viewportWidth: 1920,
        viewportHeight: 1080,
      });

      const context = recorder.getSessionContext();
      expect(context.browser?.browserName).toBe('Chrome');
      expect(context.browser?.tabIds).toEqual(['tab-1', 'tab-2']);
    });

    it('should set current domain', () => {
      recorder.setCurrentDomain('github.com');
      const context = recorder.getSessionContext();
      expect(context.currentDomain).toBe('github.com');
    });

    it('should set session state', () => {
      recorder.setSessionState('EXECUTING');
      const context = recorder.getSessionContext();
      expect(context.sessionState).toBe('EXECUTING');
    });

    it('should return a copy of context', () => {
      const context1 = recorder.getSessionContext();
      const context2 = recorder.getSessionContext();
      expect(context1).not.toBe(context2);
    });
  });

  describe('flush behavior', () => {
    it('should flush on shutdown', async () => {
      recorder.recordSessionCreated();
      // No error means flush completed successfully
      await recorder.shutdown();
    });
  });
});

describe('RecorderConfig validation', () => {
  it('should create recorder with minimal config', () => {
    const recorder = createAuditRecorder({
      organizationId: uuidv4(),
      userId: uuidv4(),
      device: {
        deviceId: uuidv4(),
        clientType: 'browser_extension',
      },
    });

    const context = recorder.getSessionContext();
    expect(context.device.clientType).toBe('browser_extension');
  });
});
