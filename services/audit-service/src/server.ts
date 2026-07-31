import { Pool, PoolClient } from 'pg';
import {
  AuditEvent,
  AuditEventRow,
  AuditEventSchema,
  RetentionPolicy,
  ExportFilters,
  ExportFormat,
  SCHEMA_VERSION,
} from './types.js';
import {
  AuditRecorder,
  RecorderConfig,
  PersistenceAdapter,
  QueryFilters,
  createAuditRecorder,
} from './recorder.js';
import { getPrivacyManager, PrivacyManager } from './privacy.js';
import { AuditExporter, getAuditExporter } from './export.js';

// Server configuration
export interface AuditServerConfig {
  databaseUrl: string;
  port?: number;
  host?: string;
  flushIntervalMs?: number;
  maxQueueSize?: number;
}

// Audit server class
export class AuditServer {
  private pool: Pool;
  private recorders: Map<string, AuditRecorder> = new Map(); // sessionId -> recorder
  private privacyManager: PrivacyManager;
  private exporter: AuditExporter;
  private config: Required<AuditServerConfig>;

  constructor(config: AuditServerConfig) {
    this.config = {
      databaseUrl: config.databaseUrl,
      port: config.port || 3001,
      host: config.host || '0.0.0.0',
      flushIntervalMs: config.flushIntervalMs || 5000,
      maxQueueSize: config.maxQueueSize || 100,
    };

    this.pool = new Pool({ connectionString: this.config.databaseUrl });
    this.privacyManager = getPrivacyManager();
    this.exporter = getAuditExporter();
  }

  // Initialize database schema
  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS audit_events (
          -- Primary key
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

          -- Session context
          session_id UUID NOT NULL,
          organization_id UUID NOT NULL,
          user_id UUID NOT NULL,

          -- Creator info
          creator_email TEXT,
          creator_name TEXT,

          -- Device info
          device_id UUID NOT NULL,
          device_name TEXT,
          device_type TEXT,
          os_platform TEXT,
          os_version TEXT,
          client_type TEXT CHECK (client_type IN ('desktop_connector', 'browser_extension')),
          client_version TEXT,

          -- Browser info
          browser_name TEXT,
          browser_version TEXT,
          tab_ids TEXT[], -- PostgreSQL array
          viewport_width INTEGER,
          viewport_height INTEGER,
          device_pixel_ratio NUMERIC,

          -- Model context
          model_version TEXT,
          prompt_template_version TEXT,

          -- Session state
          session_state TEXT CHECK (session_state IN (
            'CREATED', 'WAITING_FOR_CLIENT', 'CONNECTED', 'OBSERVING',
            'PLANNING', 'POLICY_CHECK', 'WAITING_FOR_APPROVAL', 'EXECUTING',
            'VERIFYING', 'COMPLETED', 'FAILED', 'CANCELLED'
          )),
          current_domain TEXT,

          -- Screenshot hash fields (not the actual screenshot)
          observation_id TEXT,
          screenshot_hash TEXT,
          screenshot_timestamp TIMESTAMPTZ,
          screenshot_width INTEGER,
          screenshot_height INTEGER,
          screenshot_truncated BOOLEAN DEFAULT false,

          -- Proposed action fields
          action_id UUID,
          action_type TEXT CHECK (action_type IN (
            'left_click', 'double_click', 'right_click', 'drag', 'mouse_move',
            'scroll', 'key', 'visit_url', 'history_back', 'screenshot',
            'wait', 'ask_user_question', 'terminate', 'pause_and_memorize_fact',
            'keyboard_insert_text'
          )),
          target_url TEXT,
          target_domain TEXT,
          action_coordinates_x NUMERIC,
          action_coordinates_y NUMERIC,
          action_payload JSONB,
          action_reasoning TEXT,
          action_observation_id TEXT,

          -- Policy result fields
          policy_id UUID,
          policy_decision TEXT CHECK (policy_decision IN ('ALLOWED', 'DENIED', 'REQUIRES_APPROVAL', 'REQUIRES_CONSENT')),
          policy_reason TEXT,
          requires_consent BOOLEAN DEFAULT false,
          consent_categories TEXT[],

          -- Approval decision fields
          approval_id UUID,
          approval_decision TEXT CHECK (approval_decision IN ('APPROVED', 'DENIED', 'SKIPPED', 'TIMEOUT')),
          approver_id UUID,
          approver_reason TEXT,
          approved_at TIMESTAMPTZ,

          -- Executed action fields
          execution_id UUID,
          execution_action_id UUID,
          execution_action_type TEXT,
          execution_coordinates_x NUMERIC,
          execution_coordinates_y NUMERIC,
          execution_payload JSONB,
          executed_at TIMESTAMPTZ,
          execution_duration_ms INTEGER,
          execution_success BOOLEAN,
          execution_error_message TEXT,
          execution_error_code TEXT,

          -- Error fields
          error_id UUID,
          error_code TEXT,
          error_message TEXT,
          error_stack TEXT,
          error_severity TEXT CHECK (error_severity IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
          error_occurred_at TIMESTAMPTZ,
          error_session_id UUID,
          error_related_action_id UUID,

          -- Termination
          termination_reason TEXT CHECK (termination_reason IN (
            'COMPLETED', 'USER_CANCELLED', 'TIMEOUT', 'ERROR',
            'POLICY_VIOLATION', 'BUDGET_EXCEEDED', 'CLIENT_DISCONNECTED', 'FORCED_TERMINATION'
          )),

          -- Metadata
          timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          trace_id TEXT,
          span_id TEXT
        );

        -- Indexes for common queries
        CREATE INDEX IF NOT EXISTS idx_audit_events_session_id ON audit_events(session_id);
        CREATE INDEX IF NOT EXISTS idx_audit_events_organization_id ON audit_events(organization_id);
        CREATE INDEX IF NOT EXISTS idx_audit_events_user_id ON audit_events(user_id);
        CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp);
        CREATE INDEX IF NOT EXISTS idx_audit_events_session_state ON audit_events(session_state);
        CREATE INDEX IF NOT EXISTS idx_audit_events_action_type ON audit_events(action_type);
        CREATE INDEX IF NOT EXISTS idx_audit_events_current_domain ON audit_events(current_domain);

        -- Retention policy table
        CREATE TABLE IF NOT EXISTS retention_policies (
          organization_id UUID PRIMARY KEY,
          screenshot_retention_days INTEGER NOT NULL DEFAULT 0,
          audit_retention_days INTEGER NOT NULL DEFAULT 90,
          enable_full_screenshot_consent BOOLEAN DEFAULT false,
          redact_screenshots BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- Schema version tracking
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // Record schema version
      await client.query(
        `INSERT INTO schema_version (version) VALUES ($1) ON CONFLICT DO NOTHING`,
        [SCHEMA_VERSION]
      );

      console.log('Audit service database initialized');
    } finally {
      client.release();
    }
  }

  // Create a persistence adapter for a session
  private createPersistenceAdapter(): PersistenceAdapter {
    const pool = this.pool;

    const insertEvent = async (event: AuditEvent): Promise<void> => {
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO audit_events (
              session_id, organization_id, user_id,
              creator_email, creator_name,
              device_id, device_name, device_type, os_platform, os_version,
              client_type, client_version,
              browser_name, browser_version, tab_ids, viewport_width, viewport_height, device_pixel_ratio,
              model_version, prompt_template_version,
              session_state, current_domain,
              observation_id, screenshot_hash, screenshot_timestamp,
              screenshot_width, screenshot_height, screenshot_truncated,
              action_id, action_type, target_url, target_domain,
              action_coordinates_x, action_coordinates_y, action_payload,
              action_reasoning, action_observation_id,
              policy_id, policy_decision, policy_reason, requires_consent, consent_categories,
              approval_id, approval_decision, approver_id, approver_reason, approved_at,
              execution_id, execution_action_id, execution_action_type,
              execution_coordinates_x, execution_coordinates_y, execution_payload,
              executed_at, execution_duration_ms, execution_success,
              execution_error_message, execution_error_code,
              error_id, error_code, error_message, error_stack,
              error_severity, error_occurred_at, error_session_id, error_related_action_id,
              termination_reason, timestamp, trace_id, span_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                      $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34,
                      $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50,
                      $51, $52, $53, $54, $55, $56, $57, $58, $59, $60, $61, $62, $63, $64, $65, $66,
                      $67, $68, $69, $70, $71, $72)`,
          [
            event.sessionId,
            event.organizationId,
            event.userId,
            event.creator.email,
            event.creator.name,
            event.device.deviceId,
            event.device.deviceName,
            event.device.deviceType,
            event.device.osPlatform,
            event.device.osVersion,
            event.device.clientType,
            event.device.clientVersion,
            event.browser?.browserName,
            event.browser?.browserVersion,
            event.browser?.tabIds,
            event.browser?.viewportWidth,
            event.browser?.viewportHeight,
            event.browser?.devicePixelRatio,
            event.modelVersion,
            event.promptTemplateVersion,
            event.sessionState,
            event.currentDomain,
            event.screenshotHash?.observationId,
            event.screenshotHash?.screenshotHash,
            event.screenshotHash?.screenshotTimestamp,
            event.screenshotHash?.width,
            event.screenshotHash?.height,
            event.screenshotHash?.truncated,
            event.proposedAction?.actionId,
            event.proposedAction?.actionType,
            event.proposedAction?.targetUrl,
            event.proposedAction?.targetDomain,
            event.proposedAction?.coordinates?.x,
            event.proposedAction?.coordinates?.y,
            JSON.stringify(event.proposedAction?.payload),
            event.proposedAction?.reasoning,
            event.proposedAction?.observationId,
            event.policyResult?.policyId,
            event.policyResult?.decision,
            event.policyResult?.reason,
            event.policyResult?.requiresConsent,
            event.policyResult?.consentCategories,
            event.approvalDecision?.approvalId,
            event.approvalDecision?.decision,
            event.approvalDecision?.approverId,
            event.approvalDecision?.approverReason,
            event.approvalDecision?.approvedAt,
            event.executedAction?.executionId,
            event.executedAction?.actionId,
            event.executedAction?.actionType,
            event.executedAction?.coordinates?.x,
            event.executedAction?.coordinates?.y,
            JSON.stringify(event.executedAction?.payload),
            event.executedAction?.executedAt,
            event.executedAction?.executionDurationMs,
            event.executedAction?.success,
            event.executedAction?.errorMessage,
            event.executedAction?.errorCode,
            event.error?.errorId,
            event.error?.errorCode,
            event.error?.errorMessage,
            event.error?.errorStack,
            event.error?.severity,
            event.error?.occurredAt,
            event.error?.sessionId,
            event.error?.relatedActionId,
            event.terminationReason,
            event.timestamp,
            event.traceId,
            event.spanId,
          ]
        );
      } finally {
        client.release();
      }
    };

    return {
      async persistEvents(events: AuditEvent[]): Promise<void> {
        for (const event of events) {
          await insertEvent(event);
        }
      },

      async queryEvents(filters: QueryFilters): Promise<AuditEventRow[]> {
        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (filters.organizationId) {
          conditions.push(`organization_id = $${paramIndex++}`);
          params.push(filters.organizationId);
        }
        if (filters.userId) {
          conditions.push(`user_id = $${paramIndex++}`);
          params.push(filters.userId);
        }
        if (filters.sessionId) {
          conditions.push(`session_id = $${paramIndex++}`);
          params.push(filters.sessionId);
        }
        if (filters.startDate) {
          conditions.push(`timestamp >= $${paramIndex++}`);
          params.push(filters.startDate);
        }
        if (filters.endDate) {
          conditions.push(`timestamp <= $${paramIndex++}`);
          params.push(filters.endDate);
        }
        if (filters.eventTypes && filters.eventTypes.length > 0) {
          conditions.push(`action_type = ANY($${paramIndex++})`);
          params.push(filters.eventTypes);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = filters.limit || 1000;
        const offset = filters.offset || 0;

        const result = await pool.query<AuditEventRow>(
          `SELECT * FROM audit_events ${whereClause} ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`,
          params
        );

        return result.rows;
      },
    };
  }

  // Create or get a recorder for a session
  getRecorder(config: RecorderConfig): AuditRecorder {
    const existingRecorder = this.recorders.get(config.organizationId + config.userId);
    if (existingRecorder) {
      return existingRecorder;
    }

    const recorder = createAuditRecorder(config);
    const adapter = this.createPersistenceAdapter();
    recorder.setPersistenceAdapter(adapter);

    this.recorders.set(config.organizationId + config.userId, recorder);
    return recorder;
  }

  // Set retention policy for an organization
  async setRetentionPolicy(policy: RetentionPolicy): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO retention_policies (
          organization_id, screenshot_retention_days, audit_retention_days,
          enable_full_screenshot_consent, redact_screenshots, updated_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (organization_id) DO UPDATE SET
          screenshot_retention_days = EXCLUDED.screenshot_retention_days,
          audit_retention_days = EXCLUDED.audit_retention_days,
          enable_full_screenshot_consent = EXCLUDED.enable_full_screenshot_consent,
          redact_screenshots = EXCLUDED.redact_screenshots,
          updated_at = NOW()`,
        [
          policy.organizationId,
          policy.screenshotRetentionDays,
          policy.auditRetentionDays,
          policy.enableFullScreenshotConsent,
          policy.redactScreenshots,
        ]
      );

      this.privacyManager.setRetentionPolicy(policy.organizationId, policy);
    } finally {
      client.release();
    }
  }

  // Get retention policy for an organization
  async getRetentionPolicy(organizationId: string): Promise<RetentionPolicy | null> {
    const result = await this.pool.query(
      'SELECT * FROM retention_policies WHERE organization_id = $1',
      [organizationId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      organizationId: row.organization_id,
      screenshotRetentionDays: row.screenshot_retention_days,
      auditRetentionDays: row.audit_retention_days,
      enableFullScreenshotConsent: row.enable_full_screenshot_consent,
      redactScreenshots: row.redact_screenshots,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  // Query audit events
  async queryEvents(filters: QueryFilters): Promise<AuditEventRow[]> {
    const adapter = this.createPersistenceAdapter();
    return adapter.queryEvents(filters);
  }

  // Export audit trail
  async exportAuditTrail(
    filters: ExportFilters,
    format: ExportFormat = 'json'
  ): Promise<string> {
    const rows = await this.queryEvents({
      organizationId: filters.organizationId,
      userId: filters.userId,
      sessionId: filters.sessionId,
      startDate: filters.startDate ? new Date(filters.startDate) : undefined,
      endDate: filters.endDate ? new Date(filters.endDate) : undefined,
      eventTypes: filters.eventTypes,
      limit: 100000, // Large limit for exports
    });

    if (format === 'csv') {
      return this.exporter.exportRowsAsCSV(rows, filters);
    }
    return this.exporter.exportRowsAsJSON(rows, filters);
  }

  // Delete audit events for a session (GDPR compliance)
  async deleteSessionEvents(sessionId: string): Promise<number> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'DELETE FROM audit_events WHERE session_id = $1',
        [sessionId]
      );
      return result.rowCount || 0;
    } finally {
      client.release();
    }
  }

  // Delete all events for a user (GDPR compliance)
  async deleteUserEvents(userId: string): Promise<number> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'DELETE FROM audit_events WHERE user_id = $1',
        [userId]
      );
      return result.rowCount || 0;
    } finally {
      client.release();
    }
  }

  // Delete events older than retention period
  async cleanupOldEvents(): Promise<number> {
    const client = await this.pool.connect();
    try {
      // Get all organization retention policies
      const policies = await client.query('SELECT organization_id, audit_retention_days FROM retention_policies');

      let totalDeleted = 0;
      for (const policy of policies.rows) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - policy.audit_retention_days);

        const result = await client.query(
          'DELETE FROM audit_events WHERE organization_id = $1 AND timestamp < $2',
          [policy.organization_id, cutoffDate]
        );
        totalDeleted += result.rowCount || 0;
      }

      // Also clean up screenshots that exceeded retention
      await client.query(`
        UPDATE audit_events
        SET screenshot_hash = NULL,
            observation_id = NULL,
            screenshot_timestamp = NULL,
            screenshot_width = NULL,
            screenshot_height = NULL
        WHERE screenshot_timestamp IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM retention_policies rp
          WHERE rp.organization_id = audit_events.organization_id
          AND rp.screenshot_retention_days = 0
        )
      `);

      return totalDeleted;
    } finally {
      client.release();
    }
  }

  // Shutdown the server
  async shutdown(): Promise<void> {
    // Flush all recorders
    await Promise.all(
      Array.from(this.recorders.values()).map((recorder) => recorder.shutdown())
    );
    this.recorders.clear();

    // Close database pool
    await this.pool.end();
  }

  // Start the server
  async start(): Promise<void> {
    await this.initialize();
    console.log(`Audit service listening on ${this.config.host}:${this.config.port}`);
  }
}

// Factory function to create an audit server
export function createAuditServer(config: AuditServerConfig): AuditServer {
  return new AuditServer(config);
}

// Default persistence adapter implementation
const persistenceAdapter: PersistenceAdapter = {
  async persistEvents(events: AuditEvent[]): Promise<void> {
    console.warn('No persistence adapter configured, events will not be stored');
  },
  async queryEvents(): Promise<AuditEventRow[]> {
    return [];
  },
};
