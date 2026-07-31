-- Migration: 001_initial_schema
-- Description: Initial audit events schema
-- Created: 2026-07-31

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Main audit events table
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
  tab_ids TEXT[], -- PostgreSQL array for tab IDs
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
  screenshot_hash TEXT, -- SHA-256 hash of screenshot
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
CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_session_state ON audit_events(session_state);
CREATE INDEX IF NOT EXISTS idx_audit_events_action_type ON audit_events(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_current_domain ON audit_events(current_domain);
CREATE INDEX IF NOT EXISTS idx_audit_events_error_severity ON audit_events(error_severity);

-- Composite indexes for common filter combinations
CREATE INDEX IF NOT EXISTS idx_audit_events_org_session ON audit_events(organization_id, session_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_org_timestamp ON audit_events(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_user_session ON audit_events(user_id, session_id);

-- Retention policy table
CREATE TABLE IF NOT EXISTS retention_policies (
  organization_id UUID PRIMARY KEY,
  screenshot_retention_days INTEGER NOT NULL DEFAULT 0, -- 0 = disabled by default
  audit_retention_days INTEGER NOT NULL DEFAULT 90, -- 90 days default
  enable_full_screenshot_consent BOOLEAN DEFAULT false, -- Requires explicit consent for full screenshots
  redact_screenshots BOOLEAN DEFAULT true, -- Automatic redaction enabled by default
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Schema version tracking table
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  description TEXT
);

-- Record this migration
INSERT INTO schema_version (version, applied_at, description)
VALUES (1, NOW(), 'Initial audit events schema')
ON CONFLICT DO NOTHING;

-- Comments for documentation
COMMENT ON TABLE audit_events IS 'Stores all security-relevant audit events for the Fara1.5 platform';
COMMENT ON TABLE retention_policies IS 'Configurable retention policies per organization';
COMMENT ON COLUMN audit_events.screenshot_hash IS 'SHA-256 hash of screenshot, not the actual screenshot data';
COMMENT ON COLUMN audit_events.screenshot_truncated IS 'Whether full screenshot was retained vs only hash';
COMMENT ON COLUMN retention_policies.screenshot_retention_days IS '0 = screenshots disabled, >0 = retention in days';
