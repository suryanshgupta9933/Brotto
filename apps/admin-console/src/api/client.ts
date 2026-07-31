import type {
  Organization,
  User,
  ModelDeployment,
  PolicyTemplate,
  HealthMetrics,
  ServiceHealth,
  Session,
  AuditLog,
} from './types'

const API_BASE = '/api/v1'

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

// Organization API
export const organizationApi = {
  list: () => fetchApi<Organization[]>('/organizations'),

  get: (id: string) => fetchApi<Organization>(`/organizations/${id}`),

  create: (data: Omit<Organization, 'id' | 'createdAt'>) =>
    fetchApi<Organization>('/organizations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<Organization>) =>
    fetchApi<Organization>(`/organizations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  suspend: (id: string) =>
    fetchApi<Organization>(`/organizations/${id}/suspend`, { method: 'POST' }),

  activate: (id: string) =>
    fetchApi<Organization>(`/organizations/${id}/activate`, { method: 'POST' }),
}

// User API
export const userApi = {
  list: (params?: { organizationId?: string; status?: string }) => {
    const searchParams = new URLSearchParams(params as Record<string, string>)
    return fetchApi<User[]>(`/users?${searchParams}`)
  },

  get: (id: string) => fetchApi<User>(`/users/${id}`),

  create: (data: Omit<User, 'id' | 'createdAt' | 'lastActiveAt'>) =>
    fetchApi<User>('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<User>) =>
    fetchApi<User>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  suspend: (id: string) =>
    fetchApi<User>(`/users/${id}/suspend`, { method: 'POST' }),

  deactivate: (id: string) =>
    fetchApi<User>(`/users/${id}/deactivate`, { method: 'POST' }),
}

// Model deployment API
export const modelDeploymentApi = {
  list: () => fetchApi<ModelDeployment[]>('/model-deployments'),

  get: (id: string) => fetchApi<ModelDeployment>(`/model-deployments/${id}`),

  create: (data: Omit<ModelDeployment, 'id' | 'createdAt'>) =>
    fetchApi<ModelDeployment>('/model-deployments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<ModelDeployment>) =>
    fetchApi<ModelDeployment>(`/model-deployments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  scale: (id: string, replicas: number) =>
    fetchApi<ModelDeployment>(`/model-deployments/${id}/scale`, {
      method: 'POST',
      body: JSON.stringify({ replicas }),
    }),

  start: (id: string) =>
    fetchApi<ModelDeployment>(`/model-deployments/${id}/start`, { method: 'POST' }),

  stop: (id: string) =>
    fetchApi<ModelDeployment>(`/model-deployments/${id}/stop`, { method: 'POST' }),
}

// Policy template API
export const policyTemplateApi = {
  list: () => fetchApi<PolicyTemplate[]>('/policy-templates'),

  get: (id: string) => fetchApi<PolicyTemplate>(`/policy-templates/${id}`),

  create: (data: Omit<PolicyTemplate, 'id' | 'createdAt' | 'updatedAt'>) =>
    fetchApi<PolicyTemplate>('/policy-templates', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<PolicyTemplate>) =>
    fetchApi<PolicyTemplate>(`/policy-templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    fetchApi<void>(`/policy-templates/${id}`, { method: 'DELETE' }),
}

// Health API
export const healthApi = {
  getMetrics: () => fetchApi<HealthMetrics>('/health/metrics'),

  getServiceHealth: () => fetchApi<ServiceHealth[]>('/health/services'),

  getHistory: (duration: string) =>
    fetchApi<HealthMetrics[]>(`/health/metrics/history?duration=${duration}`),
}

// Session API
export const sessionApi = {
  list: (params?: { organizationId?: string; status?: string }) => {
    const searchParams = new URLSearchParams(params as Record<string, string>)
    return fetchApi<Session[]>(`/sessions?${searchParams}`)
  },

  get: (id: string) => fetchApi<Session>(`/sessions/${id}`),

  terminate: (id: string, reason: string) =>
    fetchApi<Session>(`/sessions/${id}/terminate`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
}

// Audit log API
export const auditLogApi = {
  list: (params?: {
    startDate?: string
    endDate?: string
    eventType?: string
    userId?: string
    organizationId?: string
    limit?: number
    offset?: number
  }) => {
    const searchParams = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params || {}).filter(([, v]) => v !== undefined)
      ) as Record<string, string>
    )
    return fetchApi<AuditLog[]>(`/audit-logs?${searchParams}`)
  },

  get: (id: string) => fetchApi<AuditLog>(`/audit-logs/${id}`),

  export: (params: { startDate: string; endDate: string; format: 'json' | 'csv' }) => {
    const searchParams = new URLSearchParams(params as Record<string, string>)
    return `${API_BASE}/audit-logs/export?${searchParams}`
  },
}
