// Organization types
export interface Organization {
  id: string
  name: string
  createdAt: string
  status: 'active' | 'suspended' | 'pending'
  userCount: number
  sessionCount: number
  plan: 'free' | 'pro' | 'enterprise'
}

// User types
export interface User {
  id: string
  email: string
  name: string
  organizationId: string
  role: 'admin' | 'operator' | 'user'
  status: 'active' | 'inactive' | 'suspended'
  createdAt: string
  lastActiveAt: string | null
}

// Model deployment types
export interface ModelDeployment {
  id: string
  name: string
  model: 'fara-4b' | 'fara-9b' | 'fara-27b'
  status: 'running' | 'stopped' | 'deploying' | 'failed'
  replicas: number
  gpuType: string
  endpoint: string
  createdAt: string
}

// Policy template types
export interface PolicyTemplate {
  id: string
  name: string
  description: string
  rules: PolicyRule[]
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface PolicyRule {
  id: string
  action: 'allow' | 'deny' | 'require_approval'
  resource: string
  conditions?: Record<string, string>
}

// System health types
export interface HealthMetrics {
  timestamp: string
  cpuUsage: number
  memoryUsage: number
  gpuUsage: number
  activeSessions: number
  queuedSessions: number
  totalRequests: number
  failedRequests: number
  averageLatencyMs: number
}

export interface ServiceHealth {
  name: string
  status: 'healthy' | 'degraded' | 'down'
  uptime: number
  lastCheck: string
}

// Session types
export interface Session {
  id: string
  userId: string
  organizationId: string
  status: 'created' | 'waiting' | 'connected' | 'observing' | 'planning' | 'executing' | 'completed' | 'failed' | 'cancelled' | 'terminated'
  currentUrl: string | null
  currentDomain: string | null
  startedAt: string
  lastActivityAt: string
  terminationReason?: string
  agentSteps: number
  screenshotsCount: number
}

// Audit log types
export interface AuditLog {
  id: string
  timestamp: string
  eventType: string
  userId: string | null
  organizationId: string | null
  sessionId: string | null
  resource: string
  action: string
  result: 'success' | 'failure' | 'pending'
  details: Record<string, unknown>
  ipAddress: string
}
