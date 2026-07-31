// Session state machine states
export type SessionState =
  | 'CREATED'
  | 'WAITING_FOR_CLIENT'
  | 'CONNECTED'
  | 'OBSERVING'
  | 'PLANNING'
  | 'POLICY_CHECK'
  | 'WAITING_FOR_APPROVAL'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

// Task types
export interface Task {
  id: string;
  name: string;
  goal: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface CreateTaskRequest {
  name: string;
  goal: string;
  domain?: string;
  budget?: TaskBudget;
}

export interface TaskBudget {
  maxSteps?: number;
  maxDurationSeconds?: number;
  maxTokens?: number;
}

// Session types
export interface Session {
  id: string;
  taskId: string;
  taskName: string;
  state: SessionState;
  currentUrl?: string;
  currentDomain?: string;
  startedAt: string;
  updatedAt: string;
  deviceId?: string;
  deviceName?: string;
  screenshotUrl?: string;
}

export interface SessionUpdate {
  sessionId: string;
  state: SessionState;
  currentUrl?: string;
  currentDomain?: string;
  screenshotUrl?: string;
  message?: string;
}

// Approval types
export interface ApprovalRequest {
  id: string;
  sessionId: string;
  taskId: string;
  taskName: string;
  proposedAction: string;
  targetWebsite: string;
  fieldNames: string[];
  dataToSubmit: Record<string, string>;
  expectedConsequence: string;
  screenshotUrl?: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'denied';
}

export interface ApprovalResponse {
  requestId: string;
  action: 'approve_once' | 'approve_continue' | 'deny' | 'stop_session';
}

// Policy types
export interface Policy {
  id: string;
  name: string;
  description: string;
  type: 'domain' | 'action' | 'approval';
  enabled: boolean;
  conditions: PolicyCondition[];
  createdAt: string;
  updatedAt: string;
}

export interface PolicyCondition {
  field: string;
  operator: 'equals' | 'contains' | 'matches' | 'in';
  value: string | string[];
}

export interface DomainAllowlist {
  id: string;
  domain: string;
  pattern: string;
  action: 'allow' | 'block' | 'require_approval';
  description?: string;
  createdAt: string;
}

// Device types
export interface Device {
  id: string;
  name: string;
  type: 'desktop_connector' | 'browser_extension';
  status: 'online' | 'offline' | 'registered';
  lastSeenAt: string;
  registeredAt: string;
  version?: string;
}

// Audit log types
export interface AuditLogEntry {
  id: string;
  timestamp: string;
  eventType: string;
  sessionId?: string;
  taskId?: string;
  userId: string;
  action: string;
  resource?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

// Download types
export interface DownloadItem {
  id: string;
  name: string;
  type: 'connector' | 'extension';
  platform: 'windows-x64' | 'windows-arm64' | 'macos-x64' | 'macos-arm64' | 'linux-x64' | 'linux-arm64' | 'browser-extension';
  version: string;
  url: string;
  size: string;
  checksum: string;
  releaseDate: string;
}
