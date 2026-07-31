import { describe, it, expect, vi, beforeEach } from 'vitest';
import { taskApi, sessionApi, approvalApi, policyApi, auditApi } from '../api/client';

// Mock fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('API Client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('taskApi', () => {
    it('list returns tasks', async () => {
      const mockTasks = [
        { id: '1', name: 'Test Task', goal: 'Do something', status: 'pending', createdAt: '', updatedAt: '', createdBy: '' },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTasks),
      });

      const tasks = await taskApi.list();
      expect(tasks).toEqual(mockTasks);
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/tasks', expect.any(Object));
    });

    it('create sends POST request with task data', async () => {
      const mockTask = { id: '1', name: 'New Task', goal: 'New goal', status: 'pending', createdAt: '', updatedAt: '', createdBy: '' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTask),
      });

      const result = await taskApi.create({ name: 'New Task', goal: 'New goal' });
      expect(result).toEqual(mockTask);
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/tasks', expect.objectContaining({
        method: 'POST',
      }));
    });
  });

  describe('sessionApi', () => {
    it('list with taskId filter', async () => {
      const mockSessions: unknown[] = [];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSessions),
      });

      await sessionApi.list('task-123');
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/sessions?taskId=task-123', expect.any(Object));
    });

    it('pause sends POST request', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve() });

      await sessionApi.pause('session-1');
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/sessions/session-1/pause', expect.objectContaining({
        method: 'POST',
      }));
    });

    it('terminate sends POST request', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve() });

      await sessionApi.terminate('session-1');
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/sessions/session-1/terminate', expect.objectContaining({
        method: 'POST',
      }));
    });
  });

  describe('approvalApi', () => {
    it('respond sends correct action', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve() });

      await approvalApi.respond({ requestId: 'req-1', action: 'approve_once' });
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/approvals/req-1/respond', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ requestId: 'req-1', action: 'approve_once' }),
      }));
    });
  });

  describe('policyApi', () => {
    it('create sends POST with policy data', async () => {
      const mockPolicy = {
        id: '1',
        name: 'Test Policy',
        description: 'A test policy',
        type: 'domain' as const,
        enabled: true,
        conditions: [],
        createdAt: '',
        updatedAt: '',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPolicy),
      });

      const result = await policyApi.create({
        name: 'Test Policy',
        description: 'A test policy',
        type: 'domain',
        enabled: true,
        conditions: [],
      });
      expect(result).toEqual(mockPolicy);
    });
  });

  describe('auditApi', () => {
    it('list with filters', async () => {
      const mockResponse = { entries: [], total: 0 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await auditApi.list({ startDate: '2024-01-01', eventType: 'session.started' });
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('startDate=2024-01-01'), expect.any(Object));
    });
  });
});
