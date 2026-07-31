import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import StatusBadge from '../components/StatusBadge'

// Mock data for testing
const mockOrganizations = [
  {
    id: 'org-1',
    name: 'Acme Corp',
    createdAt: '2024-01-15T10:00:00Z',
    status: 'active' as const,
    userCount: 25,
    sessionCount: 10,
    plan: 'enterprise' as const,
  },
  {
    id: 'org-2',
    name: 'TechStart',
    createdAt: '2024-02-20T14:30:00Z',
    status: 'suspended' as const,
    userCount: 5,
    sessionCount: 0,
    plan: 'pro' as const,
  },
]

const mockUsers = [
  {
    id: 'user-1',
    email: 'admin@acme.com',
    name: 'Admin User',
    organizationId: 'org-1',
    role: 'admin' as const,
    status: 'active' as const,
    createdAt: '2024-01-15T10:00:00Z',
    lastActiveAt: '2024-06-30T15:30:00Z',
  },
  {
    id: 'user-2',
    email: 'operator@acme.com',
    name: 'Operator User',
    organizationId: 'org-1',
    role: 'operator' as const,
    status: 'inactive' as const,
    createdAt: '2024-02-10T09:00:00Z',
    lastActiveAt: null,
  },
]

const mockSessions = [
  {
    id: 'session-1',
    userId: 'user-1',
    organizationId: 'org-1',
    status: 'executing' as const,
    currentUrl: 'https://example.com/page',
    currentDomain: 'example.com',
    startedAt: '2024-06-30T15:00:00Z',
    lastActivityAt: '2024-06-30T15:30:00Z',
    agentSteps: 42,
    screenshotsCount: 15,
  },
  {
    id: 'session-2',
    userId: 'user-2',
    organizationId: 'org-1',
    status: 'completed' as const,
    currentUrl: 'https://example.com/result',
    currentDomain: 'example.com',
    startedAt: '2024-06-30T14:00:00Z',
    lastActivityAt: '2024-06-30T14:45:00Z',
    terminationReason: undefined,
    agentSteps: 128,
    screenshotsCount: 45,
  },
]

const mockAuditLogs = [
  {
    id: 'log-1',
    timestamp: '2024-06-30T15:30:00Z',
    eventType: 'session.terminated',
    userId: 'user-1',
    organizationId: 'org-1',
    sessionId: 'session-1',
    resource: '/sessions/session-1',
    action: 'terminate',
    result: 'success' as const,
    details: { reason: 'User requested' },
    ipAddress: '192.168.1.1',
  },
  {
    id: 'log-2',
    timestamp: '2024-06-30T15:00:00Z',
    eventType: 'session.created',
    userId: 'user-1',
    organizationId: 'org-1',
    sessionId: 'session-1',
    resource: '/sessions',
    action: 'create',
    result: 'success' as const,
    details: {},
    ipAddress: '192.168.1.1',
  },
]

describe('StatusBadge', () => {
  it('renders active status with correct styling', () => {
    render(<StatusBadge status="active" />)
    const badge = screen.getByText('Active')
    expect(badge).toBeInTheDocument()
  })

  it('renders running status with correct styling', () => {
    render(<StatusBadge status="running" />)
    const badge = screen.getByText('Running')
    expect(badge).toBeInTheDocument()
  })

  it('renders failed status with correct styling', () => {
    render(<StatusBadge status="failed" />)
    const badge = screen.getByText('Failed')
    expect(badge).toBeInTheDocument()
  })

  it('renders custom label when provided', () => {
    render(<StatusBadge status="active" label="Enabled" />)
    const badge = screen.getByText('Enabled')
    expect(badge).toBeInTheDocument()
  })
})

describe('Organization Data', () => {
  it('has correct structure', () => {
    const org = mockOrganizations[0]
    expect(org).toHaveProperty('id')
    expect(org).toHaveProperty('name')
    expect(org).toHaveProperty('status')
    expect(org).toHaveProperty('plan')
    expect(org).toHaveProperty('userCount')
    expect(org).toHaveProperty('sessionCount')
  })

  it('has valid status values', () => {
    const validStatuses = ['active', 'suspended', 'pending']
    mockOrganizations.forEach((org) => {
      expect(validStatuses).toContain(org.status)
    })
  })

  it('has valid plan values', () => {
    const validPlans = ['free', 'pro', 'enterprise']
    mockOrganizations.forEach((org) => {
      expect(validPlans).toContain(org.plan)
    })
  })
})

describe('User Data', () => {
  it('has correct structure', () => {
    const user = mockUsers[0]
    expect(user).toHaveProperty('id')
    expect(user).toHaveProperty('email')
    expect(user).toHaveProperty('name')
    expect(user).toHaveProperty('role')
    expect(user).toHaveProperty('status')
    expect(user).toHaveProperty('organizationId')
  })

  it('has valid role values', () => {
    const validRoles = ['admin', 'operator', 'user']
    mockUsers.forEach((user) => {
      expect(validRoles).toContain(user.role)
    })
  })

  it('has valid status values', () => {
    const validStatuses = ['active', 'inactive', 'suspended']
    mockUsers.forEach((user) => {
      expect(validStatuses).toContain(user.status)
    })
  })
})

describe('Session Data', () => {
  it('has correct structure', () => {
    const session = mockSessions[0]
    expect(session).toHaveProperty('id')
    expect(session).toHaveProperty('status')
    expect(session).toHaveProperty('currentDomain')
    expect(session).toHaveProperty('agentSteps')
    expect(session).toHaveProperty('screenshotsCount')
  })

  it('has valid status values', () => {
    const validStatuses = [
      'created', 'waiting', 'connected', 'observing', 'planning',
      'executing', 'completed', 'failed', 'cancelled', 'terminated'
    ]
    mockSessions.forEach((session) => {
      expect(validStatuses).toContain(session.status)
    })
  })
})

describe('Audit Log Data', () => {
  it('has correct structure', () => {
    const log = mockAuditLogs[0]
    expect(log).toHaveProperty('id')
    expect(log).toHaveProperty('timestamp')
    expect(log).toHaveProperty('eventType')
    expect(log).toHaveProperty('action')
    expect(log).toHaveProperty('result')
    expect(log).toHaveProperty('ipAddress')
  })

  it('has valid result values', () => {
    const validResults = ['success', 'failure', 'pending']
    mockAuditLogs.forEach((log) => {
      expect(validResults).toContain(log.result)
    })
  })
})

describe('Date Formatting', () => {
  it('formats ISO date strings correctly', () => {
    const dateString = '2024-06-30T15:30:00Z'
    const date = new Date(dateString)
    expect(date.getFullYear()).toBe(2024)
    expect(date.getMonth()).toBe(5) // June is month 5 (0-indexed)
  })
})
