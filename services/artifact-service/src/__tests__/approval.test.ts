/**
 * Approval Module Tests
 */

import {
  ApprovalWorkflowManager,
  getApprovalManager,
  canProceedWithTransfer,
} from '../approval.js';
import type { ArtifactMetadata } from '../types.js';

describe('Approval Module', () => {
  let manager: ApprovalWorkflowManager;

  beforeEach(() => {
    manager = new ApprovalWorkflowManager();
  });

  describe('createDownloadApproval', () => {
    it('should create an approval request', () => {
      const approval = manager.createDownloadApproval(
        'artifact-123',
        'session-1',
        'tenant-a',
        'user-1',
        'document.pdf',
        'application/pdf',
        1024,
        'checksum-abc',
        'Need this file for processing'
      );

      expect(approval.id).toMatch(/^apr_/);
      expect(approval.artifactId).toBe('artifact-123');
      expect(approval.sessionId).toBe('session-1');
      expect(approval.tenantId).toBe('tenant-a');
      expect(approval.status).toBe('pending');
      expect(approval.filename).toBe('document.pdf');
      expect(approval.mimeType).toBe('application/pdf');
      expect(approval.size).toBe(1024);
      expect(approval.checksum).toBe('checksum-abc');
      expect(approval.expiresAt).toBeInstanceOf(Date);
    });

    it('should throw when max pending approvals reached', () => {
      const limitedManager = new ApprovalWorkflowManager({
        maxPendingApprovals: 2,
      });

      limitedManager.createDownloadApproval(
        'art-1',
        'session-1',
        'tenant-a',
        'user-1',
        'file1.pdf',
        'application/pdf',
        100,
        'checksum'
      );
      limitedManager.createDownloadApproval(
        'art-2',
        'session-1',
        'tenant-a',
        'user-1',
        'file2.pdf',
        'application/pdf',
        100,
        'checksum'
      );

      expect(() =>
        limitedManager.createDownloadApproval(
          'art-3',
          'session-1',
          'tenant-a',
          'user-1',
          'file3.pdf',
          'application/pdf',
          100,
          'checksum'
        )
      ).toThrow('Maximum pending approvals reached');
    });
  });

  describe('respondToApproval', () => {
    it('should approve an artifact', () => {
      const approval = manager.createDownloadApproval(
        'artifact-123',
        'session-1',
        'tenant-a',
        'user-1',
        'document.pdf',
        'application/pdf',
        1024,
        'checksum-abc'
      );

      const result = manager.respondToApproval({
        artifactId: approval.id,
        decision: 'approved',
        responderId: 'admin-1',
        reason: 'Approved for processing',
      });

      expect(result).not.toBeNull();
      expect(result!.status).toBe('approved');
      expect(result!.responderId).toBe('admin-1');
      expect(result!.respondedAt).toBeInstanceOf(Date);
    });

    it('should deny an artifact', () => {
      const approval = manager.createDownloadApproval(
        'artifact-123',
        'session-1',
        'tenant-a',
        'user-1',
        'document.pdf',
        'application/pdf',
        1024,
        'checksum-abc'
      );

      const result = manager.respondToApproval({
        artifactId: approval.id,
        decision: 'denied',
        responderId: 'admin-1',
        reason: 'File type not allowed',
      });

      expect(result).not.toBeNull();
      expect(result!.status).toBe('denied');
    });

    it('should return null for unknown approval', () => {
      const result = manager.respondToApproval({
        artifactId: 'unknown-id',
        decision: 'approved',
        responderId: 'admin-1',
      });

      expect(result).toBeNull();
    });
  });

  describe('approve and deny shortcuts', () => {
    it('should approve using shortcut method', () => {
      const approval = manager.createDownloadApproval(
        'artifact-123',
        'session-1',
        'tenant-a',
        'user-1',
        'document.pdf',
        'application/pdf',
        1024,
        'checksum-abc'
      );

      const result = manager.approve(approval.id, 'admin-1', 'Looks good');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('approved');
    });

    it('should deny using shortcut method', () => {
      const approval = manager.createDownloadApproval(
        'artifact-123',
        'session-1',
        'tenant-a',
        'user-1',
        'document.pdf',
        'application/pdf',
        1024,
        'checksum-abc'
      );

      const result = manager.deny(approval.id, 'admin-1', 'Not allowed');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('denied');
    });
  });

  describe('getPendingForSession', () => {
    it('should return pending approvals for a session', () => {
      manager.createDownloadApproval(
        'art-1',
        'session-1',
        'tenant-a',
        'user-1',
        'file1.pdf',
        'application/pdf',
        100,
        'checksum'
      );
      manager.createDownloadApproval(
        'art-2',
        'session-1',
        'tenant-a',
        'user-1',
        'file2.pdf',
        'application/pdf',
        100,
        'checksum'
      );
      manager.createDownloadApproval(
        'art-3',
        'session-2',
        'tenant-a',
        'user-1',
        'file3.pdf',
        'application/pdf',
        100,
        'checksum'
      );

      const pending = manager.getPendingForSession('session-1');
      expect(pending).toHaveLength(2);
    });
  });

  describe('getPendingForTenant', () => {
    it('should return pending approvals for a tenant', () => {
      manager.createDownloadApproval(
        'art-1',
        'session-1',
        'tenant-a',
        'user-1',
        'file1.pdf',
        'application/pdf',
        100,
        'checksum'
      );
      manager.createDownloadApproval(
        'art-2',
        'session-1',
        'tenant-b',
        'user-1',
        'file2.pdf',
        'application/pdf',
        100,
        'checksum'
      );

      const pending = manager.getPendingForTenant('tenant-a');
      expect(pending).toHaveLength(1);
      expect(pending[0].artifactId).toBe('art-1');
    });
  });

  describe('isApproved and isPending', () => {
    it('should correctly report approval status', () => {
      const approval = manager.createDownloadApproval(
        'artifact-123',
        'session-1',
        'tenant-a',
        'user-1',
        'document.pdf',
        'application/pdf',
        1024,
        'checksum-abc'
      );

      expect(manager.isPending(approval.id)).toBe(true);
      expect(manager.isApproved(approval.id)).toBe(false);

      manager.approve(approval.id, 'admin-1');

      expect(manager.isPending(approval.id)).toBe(false);
      expect(manager.isApproved(approval.id)).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', () => {
      const approval1 = manager.createDownloadApproval(
        'art-1',
        'session-1',
        'tenant-a',
        'user-1',
        'file1.pdf',
        'application/pdf',
        100,
        'checksum'
      );
      const approval2 = manager.createDownloadApproval(
        'art-2',
        'session-1',
        'tenant-a',
        'user-1',
        'file2.pdf',
        'application/pdf',
        100,
        'checksum'
      );

      manager.approve(approval1.id, 'admin-1');
      manager.deny(approval2.id, 'admin-1');

      const stats = manager.getStats();
      expect(stats.pending).toBe(0);
      expect(stats.approved).toBe(1);
      expect(stats.denied).toBe(1);
      expect(stats.total).toBe(2);
    });
  });

  describe('cleanupCompleted', () => {
    it('should clean up old completed approvals', async () => {
      // Create an approval and immediately complete it
      const approval = manager.createDownloadApproval(
        'art-1',
        'session-1',
        'tenant-a',
        'user-1',
        'file1.pdf',
        'application/pdf',
        100,
        'checksum'
      );

      manager.approve(approval.id, 'admin-1');

      // Should not clean up recent approval
      let cleaned = manager.cleanupCompleted(86400000); // 24 hours
      expect(cleaned).toBe(0);

      // Manually manipulate createdAt to simulate old approval
      const oldApproval = manager.createDownloadApproval(
        'art-2',
        'session-1',
        'tenant-a',
        'user-1',
        'file2.pdf',
        'application/pdf',
        100,
        'checksum'
      );
      manager.approve(oldApproval.id, 'admin-1');

      // Manually set createdAt to old date
      (oldApproval as any).createdAt = new Date(Date.now() - 172800000); // 2 days ago

      cleaned = manager.cleanupCompleted(86400000); // 1 day
      expect(cleaned).toBe(1);
    });
  });

  describe('canProceedWithTransfer', () => {
    it('should return not approved for pending artifact', () => {
      const artifact: ArtifactMetadata = {
        id: 'art-1',
        filename: 'test.pdf',
        mimeType: 'application/pdf',
        size: 100,
        checksum: 'abc',
        checksumAlgorithm: 'sha256',
        tenantId: 'tenant-a',
        sessionId: 'session-1',
        direction: 'download',
        status: 'pending_approval',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = canProceedWithTransfer(artifact, manager);
      expect(result.approved).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should return approved for approved artifact', () => {
      const artifact: ArtifactMetadata = {
        id: 'art-1',
        filename: 'test.pdf',
        mimeType: 'application/pdf',
        size: 100,
        checksum: 'abc',
        checksumAlgorithm: 'sha256',
        tenantId: 'tenant-a',
        sessionId: 'session-1',
        direction: 'download',
        status: 'approved',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = canProceedWithTransfer(artifact, manager);
      expect(result.approved).toBe(true);
    });
  });

  describe('getApprovalManager singleton', () => {
    it('should return same instance', () => {
      const instance1 = getApprovalManager();
      const instance2 = getApprovalManager();
      expect(instance1).toBe(instance2);
    });
  });
});
