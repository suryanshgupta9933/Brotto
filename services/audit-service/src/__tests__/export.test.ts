import { v4 as uuidv4 } from 'uuid';
import {
  AuditExporter,
  getAuditExporter,
  rowToAuditEvent,
  flattenEventForCSV,
} from '../export';
import { AuditEvent, AuditEventRow, ExportFilters } from '../types';

describe('AuditExporter', () => {
  let exporter: AuditExporter;
  let testOrgId: string;
  let testUserId: string;

  beforeEach(() => {
    exporter = new AuditExporter();
    testOrgId = uuidv4();
    testUserId = uuidv4();
  });

  function createTestEvent(overrides?: Partial<AuditEvent>): AuditEvent {
    return {
      sessionId: uuidv4(),
      organizationId: testOrgId,
      userId: testUserId,
      creator: {
        userId: testUserId,
        email: 'test@example.com',
        name: 'Test User',
      },
      device: {
        deviceId: uuidv4(),
        deviceName: 'Test Device',
        clientType: 'desktop_connector',
      },
      browser: {
        browserName: 'Chrome',
        browserVersion: '120.0',
        tabIds: ['tab-1'],
        viewportWidth: 1920,
        viewportHeight: 1080,
      },
      modelVersion: 'brotto-1.5-9b',
      promptTemplateVersion: 'v1.0',
      sessionState: 'PLANNING',
      currentDomain: 'example.com',
      timestamp: new Date().toISOString(),
      ...overrides,
    };
  }

  function createTestFilters(): ExportFilters {
    return {
      organizationId: testOrgId,
      startDate: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
      endDate: new Date().toISOString(),
      includeErrors: true,
      includeActions: true,
      includeScreenshots: false,
    };
  }

  describe('JSON export', () => {
    it('should export events as JSON', () => {
      const events = [createTestEvent()];
      const filters = createTestFilters();

      const result = exporter.exportAsJSON(events, filters);

      expect(typeof result).toBe('string');
      const parsed = JSON.parse(result);
      expect(parsed.format).toBe('json');
      expect(parsed.eventCount).toBe(1);
      expect(parsed.events).toHaveLength(1);
    });

    it('should include metadata in export', () => {
      const events = [createTestEvent(), createTestEvent()];
      const filters = createTestFilters();

      const result = exporter.exportAsJSON(events, filters);
      const parsed = JSON.parse(result);

      expect(parsed.metadata).toBeDefined();
      expect(parsed.metadata.organizationId).toBe(testOrgId);
      expect(parsed.metadata.sessionCount).toBe(2);
    });

    it('should include date range in metadata when filters specify dates', () => {
      const events = [createTestEvent()];
      const filters = createTestFilters();

      const result = exporter.exportAsJSON(events, filters);
      const parsed = JSON.parse(result);

      expect(parsed.metadata.dateRange).toBeDefined();
      expect(parsed.metadata.dateRange.start).toBeDefined();
      expect(parsed.metadata.dateRange.end).toBeDefined();
    });
  });

  describe('CSV export', () => {
    it('should export events as CSV', () => {
      const events = [createTestEvent()];
      const filters = createTestFilters();

      const result = exporter.exportAsCSV(events, filters);

      expect(typeof result).toBe('string');
      // CSV should have header row
      const lines = result.split('\n');
      expect(lines.length).toBeGreaterThan(1);
    });

    it('should include all event fields as columns', () => {
      const events = [createTestEvent()];
      const filters = createTestFilters();

      const result = exporter.exportAsCSV(events, filters);
      const headers = result.split('\n')[0];

      expect(headers).toContain('session_id');
      expect(headers).toContain('organization_id');
      expect(headers).toContain('user_id');
      expect(headers).toContain('session_state');
      expect(headers).toContain('action_type');
    });

    it('should flatten nested objects for CSV', () => {
      const event = createTestEvent({
        proposedAction: {
          actionId: uuidv4(),
          actionType: 'left_click',
          coordinates: { x: 100, y: 200 },
          observationId: 'obs-123',
        },
      });

      const result = exporter.exportAsCSV([event], createTestFilters());
      const rows = result.split('\n');

      expect(rows[1]).toContain('left_click');
      expect(rows[1]).toContain('100');
      expect(rows[1]).toContain('200');
    });

    it('should stringify JSON payloads in CSV', () => {
      const event = createTestEvent({
        proposedAction: {
          actionId: uuidv4(),
          actionType: 'visit_url',
          payload: { key: 'value', nested: { a: 1 } },
          observationId: 'obs-123',
        },
      });

      const result = exporter.exportAsCSV([event], createTestFilters());

      // Should contain JSON stringified payload (CSV library escapes quotes by doubling)
      expect(result).toContain('""key"":""value""');
    });
  });

  describe('metadata generation', () => {
    it('should count unique sessions', () => {
      const sameSessionId = uuidv4();
      const events = [
        createTestEvent({ sessionId: sameSessionId }),
        createTestEvent({ sessionId: sameSessionId }), // Same session
        createTestEvent({ sessionId: uuidv4() }), // Different session
      ];
      const filters = createTestFilters();

      const metadata = exporter.generateMetadata(events, filters);

      expect(metadata?.sessionCount).toBe(2);
    });

    it('should count actions', () => {
      const events = [
        createTestEvent({ proposedAction: { actionId: uuidv4(), actionType: 'left_click', observationId: '1' } }),
        createTestEvent({ executedAction: { executionId: uuidv4(), actionId: uuidv4(), actionType: 'left_click', executedAt: '', success: true } }),
        createTestEvent(), // No action
      ];
      const filters = createTestFilters();

      const metadata = exporter.generateMetadata(events, filters);

      expect(metadata?.actionCount).toBe(2);
    });

    it('should count errors', () => {
      const events = [
        createTestEvent({ error: { errorId: uuidv4(), errorCode: 'ERR1', errorMessage: '', severity: 'ERROR', occurredAt: '', sessionId: '' } }),
        createTestEvent(),
        createTestEvent({ error: { errorId: uuidv4(), errorCode: 'ERR2', errorMessage: '', severity: 'ERROR', occurredAt: '', sessionId: '' } }),
      ];
      const filters = createTestFilters();

      const metadata = exporter.generateMetadata(events, filters);

      expect(metadata?.errorCount).toBe(2);
    });
  });

  describe('row to event conversion', () => {
    it('should convert database row to AuditEvent', () => {
      const row: AuditEventRow = {
        id: uuidv4(),
        session_id: uuidv4(),
        organization_id: testOrgId,
        user_id: testUserId,
        creator_email: 'user@test.com',
        creator_name: 'Test User',
        device_id: uuidv4(),
        device_name: 'Test Device',
        device_type: 'desktop',
        os_platform: 'macOS',
        os_version: '14.0',
        client_type: 'desktop_connector',
        client_version: '1.0',
        browser_name: 'Chrome',
        browser_version: '120.0',
        tab_ids: ['tab-1', 'tab-2'],
        viewport_width: 1920,
        viewport_height: 1080,
        device_pixel_ratio: 2,
        model_version: 'brotto-1.5-9b',
        prompt_template_version: 'v1.0',
        session_state: 'PLANNING',
        current_domain: 'example.com',
        observation_id: 'obs-123',
        screenshot_hash: 'abc123',
        screenshot_timestamp: new Date(),
        screenshot_width: 1920,
        screenshot_height: 1080,
        screenshot_truncated: false,
        action_id: uuidv4(),
        action_type: 'visit_url',
        target_url: 'https://example.com',
        target_domain: 'example.com',
        action_coordinates_x: null,
        action_coordinates_y: null,
        action_payload: { key: 'value' },
        action_reasoning: 'Navigate to example',
        action_observation_id: 'obs-123',
        policy_id: uuidv4(),
        policy_decision: 'ALLOWED',
        policy_reason: 'Allowed by policy',
        requires_consent: false,
        consent_categories: null,
        approval_id: null,
        approval_decision: null,
        approver_id: null,
        approver_reason: null,
        approved_at: null,
        execution_id: null,
        execution_action_id: null,
        execution_action_type: null,
        execution_coordinates_x: null,
        execution_coordinates_y: null,
        execution_payload: null,
        executed_at: null,
        execution_duration_ms: null,
        execution_success: null,
        execution_error_message: null,
        execution_error_code: null,
        error_id: null,
        error_code: null,
        error_message: null,
        error_stack: null,
        error_severity: null,
        error_occurred_at: null,
        error_session_id: null,
        error_related_action_id: null,
        termination_reason: null,
        timestamp: new Date(),
        trace_id: null,
        span_id: null,
      };

      const event = rowToAuditEvent(row);

      expect(event.sessionId).toBe(row.session_id);
      expect(event.organizationId).toBe(row.organization_id);
      expect(event.creator.email).toBe(row.creator_email);
      expect(event.device.deviceName).toBe(row.device_name);
      expect(event.browser?.tabIds).toEqual(['tab-1', 'tab-2']);
      expect(event.screenshotHash?.screenshotHash).toBe('abc123');
      expect(event.proposedAction?.actionType).toBe('visit_url');
      expect(event.policyResult?.decision).toBe('ALLOWED');
    });

    it('should handle null optional fields', () => {
      const row: AuditEventRow = {
        id: uuidv4(),
        session_id: uuidv4(),
        organization_id: testOrgId,
        user_id: testUserId,
        creator_email: null,
        creator_name: null,
        device_id: uuidv4(),
        device_name: null,
        device_type: null,
        os_platform: null,
        os_version: null,
        client_type: 'browser_extension',
        client_version: null,
        browser_name: null,
        browser_version: null,
        tab_ids: null,
        viewport_width: null,
        viewport_height: null,
        device_pixel_ratio: null,
        model_version: null,
        prompt_template_version: null,
        session_state: null,
        current_domain: null,
        observation_id: null,
        screenshot_hash: null,
        screenshot_timestamp: null,
        screenshot_width: null,
        screenshot_height: null,
        screenshot_truncated: false,
        action_id: null,
        action_type: null,
        target_url: null,
        target_domain: null,
        action_coordinates_x: null,
        action_coordinates_y: null,
        action_payload: null,
        action_reasoning: null,
        action_observation_id: null,
        policy_id: null,
        policy_decision: null,
        policy_reason: null,
        requires_consent: false,
        consent_categories: null,
        approval_id: null,
        approval_decision: null,
        approver_id: null,
        approver_reason: null,
        approved_at: null,
        execution_id: null,
        execution_action_id: null,
        execution_action_type: null,
        execution_coordinates_x: null,
        execution_coordinates_y: null,
        execution_payload: null,
        executed_at: null,
        execution_duration_ms: null,
        execution_success: null,
        execution_error_message: null,
        execution_error_code: null,
        error_id: null,
        error_code: null,
        error_message: null,
        error_stack: null,
        error_severity: null,
        error_occurred_at: null,
        error_session_id: null,
        error_related_action_id: null,
        termination_reason: null,
        timestamp: new Date(),
        trace_id: null,
        span_id: null,
      };

      const event = rowToAuditEvent(row);

      expect(event.creator.email).toBeUndefined();
      expect(event.device.deviceType).toBeUndefined();
      expect(event.browser).toBeUndefined();
      expect(event.screenshotHash).toBeUndefined();
      expect(event.proposedAction).toBeUndefined();
    });
  });

  describe('flattenEventForCSV', () => {
    it('should flatten nested event for CSV export', () => {
      const event = createTestEvent({
        creator: {
          userId: testUserId,
          email: 'flatten@test.com',
          name: 'Flatten Test',
        },
        proposedAction: {
          actionId: uuidv4(),
          actionType: 'scroll',
          coordinates: { x: 0, y: 100 },
          observationId: 'obs-flatten',
        },
      });

      const flattened = flattenEventForCSV(event);

      expect(flattened.session_id).toBe(event.sessionId);
      expect(flattened.creator_email).toBe(event.creator.email);
      expect(flattened.action_type).toBe('scroll');
      expect(flattened.action_coordinates_x).toBe(0);
      expect(flattened.action_coordinates_y).toBe(100);
    });

    it('should stringify arrays as comma-separated', () => {
      const event = createTestEvent();

      const flattened = flattenEventForCSV(event);

      expect(flattened.tab_ids).toBe('tab-1');
    });
  });
});

describe('AuditExporter singleton', () => {
  it('should return the same instance', () => {
    const instance1 = getAuditExporter();
    const instance2 = getAuditExporter();
    expect(instance1).toBe(instance2);
  });
});
