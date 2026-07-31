/**
 * Security Module Tests
 */

import {
  CrossTenantSecurityError,
  validateTenantAccess,
  validateSessionTenant,
  validateArtifactIdFormat,
  validateSessionIdFormat,
  validateTenantIdFormat,
  sanitizeFilename,
  validateStoragePath,
  CrossTenantSecurityManager,
  getSecurityManager,
} from '../security.js';

describe('Security Module', () => {
  describe('CrossTenantSecurityError', () => {
    it('should create error with correct properties', () => {
      const error = new CrossTenantSecurityError(
        'artifact-123',
        'tenant-a',
        'tenant-b',
        'Test rejection'
      );

      expect(error.artifactId).toBe('artifact-123');
      expect(error.requestedTenantId).toBe('tenant-a');
      expect(error.artifactTenantId).toBe('tenant-b');
      expect(error.attemptedAt).toBeInstanceOf(Date);
      expect(error.message).toBe('Test rejection');
      expect(error.name).toBe('CrossTenantSecurityError');
    });
  });

  describe('validateTenantAccess', () => {
    it('should pass when tenant matches', () => {
      const artifact = {
        id: 'artifact-123',
        tenantId: 'tenant-a',
        sessionId: 'session-1',
      } as const;

      expect(() => validateTenantAccess(artifact, 'tenant-a')).not.toThrow();
    });

    it('should throw when tenant does not match', () => {
      const artifact = {
        id: 'artifact-123',
        tenantId: 'tenant-a',
        sessionId: 'session-1',
      } as const;

      expect(() => validateTenantAccess(artifact, 'tenant-b')).toThrow(
        CrossTenantSecurityError
      );
    });
  });

  describe('validateSessionTenant', () => {
    it('should pass when session tenant matches artifact tenant', () => {
      const artifact = {
        id: 'artifact-123',
        tenantId: 'tenant-a',
        sessionId: 'session-1',
      } as const;

      expect(() => validateSessionTenant(artifact, 'tenant-a')).not.toThrow();
    });

    it('should throw when session tenant does not match', () => {
      const artifact = {
        id: 'artifact-123',
        tenantId: 'tenant-a',
        sessionId: 'session-1',
      } as const;

      expect(() => validateSessionTenant(artifact, 'tenant-b')).toThrow(
        CrossTenantSecurityError
      );
    });
  });

  describe('validateArtifactIdFormat', () => {
    it('should return true for valid artifact IDs', () => {
      expect(validateArtifactIdFormat('artifact-123')).toBe(true);
      expect(validateArtifactIdFormat('art_abc_123')).toBe(true);
      expect(validateArtifactIdFormat('ART123')).toBe(true);
    });

    it('should return false for invalid artifact IDs', () => {
      expect(validateArtifactIdFormat('artifact/../../../etc')).toBe(false);
      expect(validateArtifactIdFormat('artifact with spaces')).toBe(false);
      expect(validateArtifactIdFormat('artifact;drop')).toBe(false);
    });
  });

  describe('validateSessionIdFormat', () => {
    it('should return true for valid session IDs', () => {
      expect(validateSessionIdFormat('session-123')).toBe(true);
      expect(validateSessionIdFormat('sess_abc')).toBe(true);
    });

    it('should return false for invalid session IDs', () => {
      expect(validateSessionIdFormat('session with spaces')).toBe(false);
      expect(validateSessionIdFormat('../../../etc')).toBe(false);
    });
  });

  describe('validateTenantIdFormat', () => {
    it('should return true for valid tenant IDs', () => {
      expect(validateTenantIdFormat('tenant-123')).toBe(true);
      expect(validateTenantIdFormat('org_abc')).toBe(true);
    });

    it('should return false for invalid tenant IDs', () => {
      expect(validateTenantIdFormat('tenant with spaces')).toBe(false);
    });
  });

  describe('sanitizeFilename', () => {
    it('should remove path components', () => {
      expect(sanitizeFilename('/path/to/file.txt')).toBe('file.txt');
      expect(sanitizeFilename('C:\\path\\file.txt')).toBe('file.txt');
    });

    it('should replace dangerous characters', () => {
      expect(sanitizeFilename('file with spaces.txt')).toBe('file_with_spaces.txt');
      expect(sanitizeFilename('file;rm*.txt')).toBe('file_rm_.txt');
    });

    it('should keep safe characters', () => {
      expect(sanitizeFilename('file-name_123.txt')).toBe('file-name_123.txt');
    });
  });

  describe('validateStoragePath', () => {
    const baseDir = '/tmp/storage';

    it('should return true for paths within base directory', () => {
      expect(validateStoragePath('/tmp/storage/file.txt', baseDir)).toBe(true);
      expect(validateStoragePath('/tmp/storage/dir/file.txt', baseDir)).toBe(true);
    });

    it('should return false for paths outside base directory', () => {
      expect(validateStoragePath('/tmp/other/file.txt', baseDir)).toBe(false);
      expect(validateStoragePath('/tmp/storage/../etc/passwd', baseDir)).toBe(false);
    });
  });

  describe('CrossTenantSecurityManager', () => {
    let manager: CrossTenantSecurityManager;

    beforeEach(() => {
      manager = new CrossTenantSecurityManager();
    });

    it('should record rejections', () => {
      manager.recordRejection({
        artifactId: 'art-1',
        requestedTenantId: 'tenant-a',
        artifactTenantId: 'tenant-b',
        attemptedAt: new Date(),
        reason: 'Unauthorized access',
      });

      const stats = manager.getStats();
      expect(stats.totalRejections).toBe(1);
      expect(stats.uniqueArtifactIds).toBe(1);
    });

    it('should limit rejection history', () => {
      const manager = new CrossTenantSecurityManager();
      // Record more than maxRejections
      for (let i = 0; i < 15000; i++) {
        manager.recordRejection({
          artifactId: `art-${i}`,
          requestedTenantId: 'tenant-a',
          artifactTenantId: 'tenant-b',
          attemptedAt: new Date(),
          reason: 'Test',
        });
      }

      const stats = manager.getStats();
      expect(stats.totalRejections).toBeLessThan(15000);
    });

    it('should clear history', () => {
      manager.recordRejection({
        artifactId: 'art-1',
        requestedTenantId: 'tenant-a',
        artifactTenantId: 'tenant-b',
        attemptedAt: new Date(),
        reason: 'Test',
      });

      manager.clear();

      const stats = manager.getStats();
      expect(stats.totalRejections).toBe(0);
    });
  });

  describe('getSecurityManager', () => {
    it('should return singleton instance', () => {
      const instance1 = getSecurityManager();
      const instance2 = getSecurityManager();
      expect(instance1).toBe(instance2);
    });
  });
});
