import { describe, it, expect } from 'vitest';
import type {
  Task,
  Session,
  SessionState,
  ApprovalRequest,
  Policy,
  DomainAllowlist,
  Device,
  AuditLogEntry,
  DownloadItem,
} from '../types';

describe('Types', () => {
  describe('SessionState', () => {
    it('includes all expected states', () => {
      const states: SessionState[] = [
        'CREATED',
        'WAITING_FOR_CLIENT',
        'CONNECTED',
        'OBSERVING',
        'PLANNING',
        'POLICY_CHECK',
        'WAITING_FOR_APPROVAL',
        'EXECUTING',
        'VERIFYING',
        'COMPLETED',
        'FAILED',
        'CANCELLED',
      ];

      expect(states).toHaveLength(12);
    });
  });

  describe('Task', () => {
    it('has correct structure', () => {
      const task: Task = {
        id: '1',
        name: 'Test Task',
        goal: 'Do something',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'user-1',
      };

      expect(task.id).toBe('1');
      expect(task.status).toBe('pending');
    });
  });

  describe('Session', () => {
    it('has correct structure', () => {
      const session: Session = {
        id: '1',
        taskId: 't1',
        taskName: 'Test',
        state: 'EXECUTING',
        currentUrl: 'https://example.com',
        currentDomain: 'example.com',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(session.state).toBe('EXECUTING');
      expect(session.currentDomain).toBe('example.com');
    });
  });

  describe('ApprovalRequest', () => {
    it('has correct structure', () => {
      const approval: ApprovalRequest = {
        id: '1',
        sessionId: 's1',
        taskId: 't1',
        taskName: 'Test Task',
        proposedAction: 'Click Submit',
        targetWebsite: 'example.com',
        fieldNames: ['email', 'password'],
        dataToSubmit: { email: 'test@example.com', password: '***' },
        expectedConsequence: 'Login successful',
        screenshotUrl: 'https://example.com/screenshot.png',
        createdAt: new Date().toISOString(),
        status: 'pending',
      };

      expect(approval.fieldNames).toHaveLength(2);
      expect(approval.dataToSubmit).toHaveProperty('email');
    });
  });

  describe('Policy', () => {
    it('has correct structure', () => {
      const policy: Policy = {
        id: '1',
        name: 'Block Social Media',
        description: 'Blocks access to social media sites',
        type: 'domain',
        enabled: true,
        conditions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(policy.type).toBe('domain');
      expect(policy.enabled).toBe(true);
    });
  });

  describe('DomainAllowlist', () => {
    it('has correct structure', () => {
      const domain: DomainAllowlist = {
        id: '1',
        domain: 'example.com',
        pattern: '*.example.com',
        action: 'allow',
        createdAt: new Date().toISOString(),
      };

      expect(domain.action).toBe('allow');
    });
  });

  describe('Device', () => {
    it('has correct structure', () => {
      const device: Device = {
        id: '1',
        name: 'My MacBook',
        type: 'desktop_connector',
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        registeredAt: new Date().toISOString(),
        version: '1.0.0',
      };

      expect(device.type).toBe('desktop_connector');
      expect(device.status).toBe('online');
    });
  });

  describe('AuditLogEntry', () => {
    it('has correct structure', () => {
      const entry: AuditLogEntry = {
        id: '1',
        timestamp: new Date().toISOString(),
        eventType: 'session.started',
        sessionId: 's1',
        taskId: 't1',
        userId: 'user-1',
        action: 'Session started',
        ipAddress: '192.168.1.1',
      };

      expect(entry.eventType).toBe('session.started');
      expect(entry.ipAddress).toBe('192.168.1.1');
    });
  });

  describe('DownloadItem', () => {
    it('has correct structure', () => {
      const item: DownloadItem = {
        id: '1',
        name: 'Connector Windows',
        type: 'connector',
        platform: 'windows-x64',
        version: '1.0.0',
        url: 'https://downloads.example.com/connector.exe',
        size: '45.2 MB',
        checksum: 'abc123',
        releaseDate: new Date().toISOString(),
      };

      expect(item.type).toBe('connector');
      expect(item.platform).toBe('windows-x64');
    });
  });
});
