import type {
  Task,
  CreateTaskRequest,
  Session,
  SessionUpdate,
  ApprovalRequest,
  ApprovalResponse,
  Policy,
  DomainAllowlist,
  Device,
  AuditLogEntry,
  DownloadItem,
} from '../types';

const API_BASE = '/api/v1';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }

  return response.json();
}

// Task API
export const taskApi = {
  list: (): Promise<Task[]> => fetchJson('/tasks'),

  get: (id: string): Promise<Task> => fetchJson(`/tasks/${id}`),

  create: (data: CreateTaskRequest): Promise<Task> =>
    fetchJson('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  cancel: (id: string): Promise<void> =>
    fetchJson(`/tasks/${id}/cancel`, { method: 'POST' }),

  delete: (id: string): Promise<void> =>
    fetchJson(`/tasks/${id}`, { method: 'DELETE' }),
};

// Session API
export const sessionApi = {
  list: (taskId?: string): Promise<Session[]> =>
    fetchJson(taskId ? `/sessions?taskId=${taskId}` : '/sessions'),

  get: (id: string): Promise<Session> => fetchJson(`/sessions/${id}`),

  pause: (id: string): Promise<void> =>
    fetchJson(`/sessions/${id}/pause`, { method: 'POST' }),

  resume: (id: string): Promise<void> =>
    fetchJson(`/sessions/${id}/resume`, { method: 'POST' }),

  terminate: (id: string): Promise<void> =>
    fetchJson(`/sessions/${id}/terminate`, { method: 'POST' }),

  getUpdates: (sessionId: string): Promise<SessionUpdate> =>
    fetchJson(`/sessions/${sessionId}/updates`),
};

// Approval API
export const approvalApi = {
  list: (status?: 'pending' | 'approved' | 'denied'): Promise<ApprovalRequest[]> =>
    fetchJson(status ? `/approvals?status=${status}` : '/approvals'),

  get: (id: string): Promise<ApprovalRequest> => fetchJson(`/approvals/${id}`),

  respond: (data: ApprovalResponse): Promise<void> =>
    fetchJson(`/approvals/${data.requestId}/respond`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// Policy API
export const policyApi = {
  list: (): Promise<Policy[]> => fetchJson('/policies'),

  get: (id: string): Promise<Policy> => fetchJson(`/policies/${id}`),

  create: (data: Omit<Policy, 'id' | 'createdAt' | 'updatedAt'>): Promise<Policy> =>
    fetchJson('/policies', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<Policy>): Promise<Policy> =>
    fetchJson(`/policies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string): Promise<void> =>
    fetchJson(`/policies/${id}`, { method: 'DELETE' }),
};

// Domain Allowlist API
export const domainApi = {
  list: (): Promise<DomainAllowlist[]> => fetchJson('/domains'),

  create: (data: Omit<DomainAllowlist, 'id' | 'createdAt'>): Promise<DomainAllowlist> =>
    fetchJson('/domains', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<DomainAllowlist>): Promise<DomainAllowlist> =>
    fetchJson(`/domains/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string): Promise<void> =>
    fetchJson(`/domains/${id}`, { method: 'DELETE' }),
};

// Device API
export const deviceApi = {
  list: (): Promise<Device[]> => fetchJson('/devices'),

  get: (id: string): Promise<Device> => fetchJson(`/devices/${id}`),

  register: (data: { name: string; type: Device['type']; publicKey: string }): Promise<Device> =>
    fetchJson('/devices/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  unregister: (id: string): Promise<void> =>
    fetchJson(`/devices/${id}`, { method: 'DELETE' }),
};

// Audit Log API
export const auditApi = {
  list: (params?: {
    startDate?: string;
    endDate?: string;
    eventType?: string;
    userId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: AuditLogEntry[]; total: number }> => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set('startDate', params.startDate);
    if (params?.endDate) searchParams.set('endDate', params.endDate);
    if (params?.eventType) searchParams.set('eventType', params.eventType);
    if (params?.userId) searchParams.set('userId', params.userId);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const query = searchParams.toString();
    return fetchJson(`/audit${query ? `?${query}` : ''}`);
  },

  get: (id: string): Promise<AuditLogEntry> => fetchJson(`/audit/${id}`),

  export: (params?: { format: 'json' | 'csv'; startDate?: string; endDate?: string }): Promise<string> =>
    fetchJson('/audit/export', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
};

// Downloads API
export const downloadsApi = {
  list: (): Promise<DownloadItem[]> => fetchJson('/downloads'),

  getLatest: (): Promise<DownloadItem[]> => fetchJson('/downloads/latest'),
};

export { ApiError };
