import { stringify } from 'csv-stringify/sync';
import {
  AuditEvent,
  ExportFilters,
  AuditEventRow,
  ExportFormat,
  SessionState,
  ActionType,
  PolicyDecision,
  ApprovalDecision,
  TerminationReason,
} from './types.js';
import { getPrivacyManager } from './privacy.js';

export interface ExportedAuditTrail {
  format: ExportFormat;
  generatedAt: string;
  filters: ExportFilters;
  eventCount: number;
  events: AuditEvent[] | string; // Array of AuditEvent for JSON, CSV string
  metadata?: {
    organizationId: string;
    dateRange?: {
      start: string;
      end: string;
    };
    sessionCount?: number;
    actionCount?: number;
    errorCount?: number;
  };
}

// Convert database row to AuditEvent format
export function rowToAuditEvent(row: AuditEventRow): AuditEvent {
  const event: AuditEvent = {
    sessionId: row.session_id,
    organizationId: row.organization_id,
    userId: row.user_id,
    creator: {
      userId: row.user_id,
      email: row.creator_email || undefined,
      name: row.creator_name || undefined,
    },
    device: {
      deviceId: row.device_id,
      deviceName: row.device_name || undefined,
      deviceType: row.device_type || undefined,
      osPlatform: row.os_platform || undefined,
      osVersion: row.os_version || undefined,
      clientType: row.client_type || 'desktop_connector',
      clientVersion: row.client_version || undefined,
    },
    modelVersion: row.model_version || undefined,
    promptTemplateVersion: row.prompt_template_version || undefined,
    sessionState: row.session_state || undefined,
    currentDomain: row.current_domain || undefined,
    timestamp: row.timestamp.toISOString(),
    traceId: row.trace_id || undefined,
    spanId: row.span_id || undefined,
  };

  // Add browser info if present
  if (row.browser_name || row.browser_version || row.tab_ids) {
    event.browser = {
      browserName: row.browser_name || undefined,
      browserVersion: row.browser_version || undefined,
      tabIds: row.tab_ids || undefined,
      viewportWidth: row.viewport_width || undefined,
      viewportHeight: row.viewport_height || undefined,
      devicePixelRatio: row.device_pixel_ratio || undefined,
    };
  }

  // Add screenshot hash if present
  if (row.screenshot_hash) {
    event.screenshotHash = {
      observationId: row.observation_id || '',
      screenshotHash: row.screenshot_hash,
      screenshotTimestamp: row.screenshot_timestamp?.toISOString() || '',
      width: row.screenshot_width || undefined,
      height: row.screenshot_height || undefined,
      truncated: row.screenshot_truncated,
    };
  }

  // Add proposed action if present
  if (row.action_id) {
    event.proposedAction = {
      actionId: row.action_id,
      actionType: row.action_type as ActionType,
      targetUrl: row.target_url || undefined,
      targetDomain: row.target_domain || undefined,
      coordinates:
        row.action_coordinates_x !== null && row.action_coordinates_y !== null
          ? { x: row.action_coordinates_x, y: row.action_coordinates_y }
          : undefined,
      payload: row.action_payload || undefined,
      reasoning: row.action_reasoning || undefined,
      observationId: row.action_observation_id || '',
    };
  }

  // Add policy result if present
  if (row.policy_id) {
    event.policyResult = {
      policyId: row.policy_id,
      decision: row.policy_decision as PolicyDecision,
      reason: row.policy_reason || undefined,
      requiresConsent: row.requires_consent,
      consentCategories: row.consent_categories || undefined,
    };
  }

  // Add approval decision if present
  if (row.approval_id) {
    event.approvalDecision = {
      approvalId: row.approval_id,
      decision: row.approval_decision as ApprovalDecision,
      approverId: row.approver_id || undefined,
      approverReason: row.approver_reason || undefined,
      approvedAt: row.approved_at?.toISOString(),
    };
  }

  // Add executed action if present
  if (row.execution_id) {
    event.executedAction = {
      executionId: row.execution_id,
      actionId: row.execution_action_id || '',
      actionType: row.execution_action_type as ActionType,
      coordinates:
        row.execution_coordinates_x !== null && row.execution_coordinates_y !== null
          ? { x: row.execution_coordinates_x, y: row.execution_coordinates_y }
          : undefined,
      payload: row.execution_payload || undefined,
      executedAt: row.executed_at?.toISOString() || '',
      executionDurationMs: row.execution_duration_ms || undefined,
      success: row.execution_success || false,
      errorMessage: row.execution_error_message || undefined,
      errorCode: row.execution_error_code || undefined,
    };
  }

  // Add error if present
  if (row.error_id) {
    event.error = {
      errorId: row.error_id,
      errorCode: row.error_code || '',
      errorMessage: row.error_message || '',
      errorStack: row.error_stack || undefined,
      severity: row.error_severity || 'ERROR',
      occurredAt: row.error_occurred_at?.toISOString() || '',
      sessionId: row.error_session_id || row.session_id,
      relatedActionId: row.error_related_action_id || undefined,
    };
  }

  // Add termination reason if present
  if (row.termination_reason) {
    event.terminationReason = row.termination_reason as TerminationReason;
  }

  return event;
}

// Flatten audit event for CSV export
export function flattenEventForCSV(event: AuditEvent): Record<string, unknown> {
  return {
    // Session context
    session_id: event.sessionId,
    organization_id: event.organizationId,
    user_id: event.userId,
    creator_email: event.creator.email,
    creator_name: event.creator.name,

    // Device info
    device_id: event.device.deviceId,
    device_name: event.device.deviceName,
    device_type: event.device.deviceType,
    os_platform: event.device.osPlatform,
    os_version: event.device.osVersion,
    client_type: event.device.clientType,
    client_version: event.device.clientVersion,

    // Browser info
    browser_name: event.browser?.browserName,
    browser_version: event.browser?.browserVersion,
    tab_ids: event.browser?.tabIds?.join(','),
    viewport_width: event.browser?.viewportWidth,
    viewport_height: event.browser?.viewportHeight,
    device_pixel_ratio: event.browser?.devicePixelRatio,

    // Model context
    model_version: event.modelVersion,
    prompt_template_version: event.promptTemplateVersion,

    // Session state
    session_state: event.sessionState,
    current_domain: event.currentDomain,

    // Screenshot hash
    observation_id: event.screenshotHash?.observationId,
    screenshot_hash: event.screenshotHash?.screenshotHash,
    screenshot_timestamp: event.screenshotHash?.screenshotTimestamp,
    screenshot_width: event.screenshotHash?.width,
    screenshot_height: event.screenshotHash?.height,
    screenshot_truncated: event.screenshotHash?.truncated,

    // Proposed action
    action_id: event.proposedAction?.actionId,
    action_type: event.proposedAction?.actionType,
    target_url: event.proposedAction?.targetUrl,
    target_domain: event.proposedAction?.targetDomain,
    action_coordinates_x: event.proposedAction?.coordinates?.x,
    action_coordinates_y: event.proposedAction?.coordinates?.y,
    action_payload: JSON.stringify(event.proposedAction?.payload),
    action_reasoning: event.proposedAction?.reasoning,
    action_observation_id: event.proposedAction?.observationId,

    // Policy result
    policy_id: event.policyResult?.policyId,
    policy_decision: event.policyResult?.decision,
    policy_reason: event.policyResult?.reason,
    requires_consent: event.policyResult?.requiresConsent,
    consent_categories: event.policyResult?.consentCategories?.join(','),

    // Approval decision
    approval_id: event.approvalDecision?.approvalId,
    approval_decision: event.approvalDecision?.decision,
    approver_id: event.approvalDecision?.approverId,
    approver_reason: event.approvalDecision?.approverReason,
    approved_at: event.approvalDecision?.approvedAt,

    // Executed action
    execution_id: event.executedAction?.executionId,
    execution_action_id: event.executedAction?.actionId,
    execution_action_type: event.executedAction?.actionType,
    execution_coordinates_x: event.executedAction?.coordinates?.x,
    execution_coordinates_y: event.executedAction?.coordinates?.y,
    execution_payload: JSON.stringify(event.executedAction?.payload),
    executed_at: event.executedAction?.executedAt,
    execution_duration_ms: event.executedAction?.executionDurationMs,
    execution_success: event.executedAction?.success,
    execution_error_message: event.executedAction?.errorMessage,
    execution_error_code: event.executedAction?.errorCode,

    // Error
    error_id: event.error?.errorId,
    error_code: event.error?.errorCode,
    error_message: event.error?.errorMessage,
    error_stack: event.error?.errorStack,
    error_severity: event.error?.severity,
    error_occurred_at: event.error?.occurredAt,
    error_session_id: event.error?.sessionId,
    error_related_action_id: event.error?.relatedActionId,

    // Termination
    termination_reason: event.terminationReason,

    // Metadata
    timestamp: event.timestamp,
    trace_id: event.traceId,
    span_id: event.spanId,
  };
}

// Audit trail exporter
export class AuditExporter {
  private privacyManager = getPrivacyManager();

  // Export events in JSON format
  exportAsJSON(events: AuditEvent[], filters: ExportFilters): string {
    // Apply redaction based on privacy settings
    const redactedEvents = events.map((event) => {
      const policy = this.privacyManager.getRetentionPolicy(event.organizationId);
      if (policy.redactScreenshots) {
        return this.privacyManager.redactEvent(event).redactedEvent;
      }
      return event;
    });

    const metadata = this.generateMetadata(redactedEvents, filters);

    return JSON.stringify(
      {
        format: 'json',
        generatedAt: new Date().toISOString(),
        filters,
        eventCount: redactedEvents.length,
        events: redactedEvents,
        metadata,
      },
      null,
      2
    );
  }

  // Export events in CSV format
  exportAsCSV(events: AuditEvent[], filters: ExportFilters): string {
    // Apply redaction
    const redactedEvents = events.map((event) => {
      const policy = this.privacyManager.getRetentionPolicy(event.organizationId);
      if (policy.redactScreenshots) {
        return this.privacyManager.redactEvent(event).redactedEvent;
      }
      return event;
    });

    // Flatten events for CSV
    const flattenedEvents = redactedEvents.map(flattenEventForCSV);

    // Generate CSV
    return stringify(flattenedEvents, {
      header: true,
      columns: Object.keys(flattenedEvents[0] || {}),
    });
  }

  // Export from database rows
  exportRowsAsJSON(rows: AuditEventRow[], filters: ExportFilters): string {
    const events = rows.map(rowToAuditEvent);
    return this.exportAsJSON(events, filters);
  }

  exportRowsAsCSV(rows: AuditEventRow[], filters: ExportFilters): string {
    const events = rows.map(rowToAuditEvent);
    return this.exportAsCSV(events, filters);
  }

  // Generate export metadata
  generateMetadata(
    events: AuditEvent[],
    filters: ExportFilters
  ): ExportedAuditTrail['metadata'] {
    const sessions = new Set(events.map((e) => e.sessionId));
    const actions = events.filter((e) => e.proposedAction || e.executedAction);
    const errors = events.filter((e) => e.error);

    const metadata: ExportedAuditTrail['metadata'] = {
      organizationId: filters.organizationId || events[0]?.organizationId || '',
    };

    if (filters.startDate || filters.endDate) {
      metadata.dateRange = {
        start: filters.startDate || events[events.length - 1]?.timestamp || '',
        end: filters.endDate || events[0]?.timestamp || '',
      };
    }

    if (sessions.size > 0) {
      metadata.sessionCount = sessions.size;
    }
    if (actions.length > 0) {
      metadata.actionCount = actions.length;
    }
    if (errors.length > 0) {
      metadata.errorCount = errors.length;
    }

    return metadata;
  }
}

// Singleton exporter instance
let exporterInstance: AuditExporter | null = null;

export function getAuditExporter(): AuditExporter {
  if (!exporterInstance) {
    exporterInstance = new AuditExporter();
  }
  return exporterInstance;
}
