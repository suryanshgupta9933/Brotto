/**
 * Isolation Module Tests
 */

import { SessionIsolationManager } from '../isolation.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('SessionIsolationManager', () => {
  let manager: SessionIsolationManager;
  let tempBaseDir: string;

  beforeEach(async () => {
    tempBaseDir = path.join(os.tmpdir(), `artifact-test-${Date.now()}`);
    manager = new SessionIsolationManager({
      baseTempDir: tempBaseDir,
      maxAgeMs: 3600000, // 1 hour
      maxFilesPerSession: 10,
      enableAutoCleanup: true,
    });
  });

  afterEach(async () => {
    // Cleanup
    try {
      await manager.clearAll();
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createSessionDirectory', () => {
    it('should create a session directory', async () => {
      const sessionDir = await manager.createSessionDirectory('session-1', 'tenant-a');

      expect(sessionDir.sessionId).toBe('session-1');
      expect(sessionDir.tenantId).toBe('tenant-a');
      expect(sessionDir.path).toContain('tenant-a');
      expect(sessionDir.path).toContain('session-1');
      expect(sessionDir.files).toHaveLength(0);
    });

    it('should throw for invalid session ID', async () => {
      await expect(
        manager.createSessionDirectory('session/../../../etc', 'tenant-a')
      ).rejects.toThrow('Invalid session ID format');
    });

    it('should throw for invalid tenant ID', async () => {
      await expect(
        manager.createSessionDirectory('session-1', 'tenant with spaces')
      ).rejects.toThrow('Invalid tenant ID format');
    });
  });

  describe('getSessionDirectory', () => {
    it('should return existing session directory', async () => {
      const created = await manager.createSessionDirectory('session-1', 'tenant-a');
      const retrieved = await manager.getSessionDirectory('session-1', 'tenant-a');

      expect(retrieved.sessionId).toBe(created.sessionId);
      expect(retrieved.path).toBe(created.path);
    });

    it('should create directory if not exists', async () => {
      const sessionDir = await manager.getSessionDirectory('new-session', 'tenant-a');

      expect(sessionDir.sessionId).toBe('new-session');
      expect(sessionDir.tenantId).toBe('tenant-a');
    });
  });

  describe('createTempFile', () => {
    it('should create a temporary file path', async () => {
      const filePath = await manager.createTempFile(
        'session-1',
        'tenant-a',
        'document.pdf'
      );

      expect(filePath).toContain('tenant-a');
      expect(filePath).toContain('session-1');
      expect(filePath).toContain('document.pdf');
      expect(filePath).not.toBe('document.pdf');
    });

    it('should increment file count', async () => {
      await manager.createTempFile('session-1', 'tenant-a', 'file1.pdf');
      await manager.createTempFile('session-1', 'tenant-a', 'file2.pdf');

      const session = manager.getSession('session-1');
      expect(session?.files).toHaveLength(2);
    });

    it('should reject when max files reached', async () => {
      const limitedManager = new SessionIsolationManager({
        baseTempDir: tempBaseDir,
        maxFilesPerSession: 2,
      });

      await limitedManager.createTempFile('session-1', 'tenant-a', 'file1.pdf');
      await limitedManager.createTempFile('session-1', 'tenant-a', 'file2.pdf');

      await expect(
        limitedManager.createTempFile('session-1', 'tenant-a', 'file3.pdf')
      ).rejects.toThrow('reached maximum file limit');
    });
  });

  describe('deleteFile', () => {
    it('should delete a file and unregister it', async () => {
      // First create a real file
      const sessionDir = await manager.createSessionDirectory('session-1', 'tenant-a');
      const filePath = path.join(sessionDir.path, 'test-file.txt');
      await fs.writeFile(filePath, 'test content');

      await manager.registerFile('session-1', 'tenant-a', filePath);
      await manager.deleteFile('session-1', filePath);

      const session = manager.getSession('session-1');
      expect(session?.files).toHaveLength(0);
    });

    it('should throw for unknown session', async () => {
      await expect(
        manager.deleteFile('unknown-session', '/some/path')
      ).rejects.toThrow('Session unknown-session not found');
    });
  });

  describe('deleteSessionFiles', () => {
    it('should delete all files in session', async () => {
      const sessionDir = await manager.createSessionDirectory('session-1', 'tenant-a');

      // Create some files
      const file1 = path.join(sessionDir.path, 'file1.txt');
      const file2 = path.join(sessionDir.path, 'file2.txt');
      await fs.writeFile(file1, 'content1');
      await fs.writeFile(file2, 'content2');

      await manager.registerFile('session-1', 'tenant-a', file1);
      await manager.registerFile('session-1', 'tenant-a', file2);

      await manager.deleteSessionFiles('session-1');

      const session = manager.getSession('session-1');
      expect(session?.files).toHaveLength(0);
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('should not clean up active sessions', async () => {
      await manager.createSessionDirectory('session-1', 'tenant-a');

      const expired = await manager.cleanupExpiredSessions();

      expect(expired).toHaveLength(0);
    });
  });

  describe('getAllSessions', () => {
    it('should return all sessions', async () => {
      await manager.createSessionDirectory('session-1', 'tenant-a');
      await manager.createSessionDirectory('session-2', 'tenant-a');
      await manager.createSessionDirectory('session-3', 'tenant-b');

      const sessions = manager.getAllSessions();

      expect(sessions).toHaveLength(3);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', async () => {
      const session1 = await manager.createSessionDirectory('session-1', 'tenant-a');
      await manager.createSessionDirectory('session-2', 'tenant-b');

      // Create files
      const file1 = path.join(session1.path, 'file1.txt');
      const file2 = path.join(session1.path, 'file2.txt');
      await fs.writeFile(file1, 'content');
      await fs.writeFile(file2, 'content');
      await manager.registerFile('session-1', 'tenant-a', file1);
      await manager.registerFile('session-1', 'tenant-a', file2);

      const stats = manager.getStats();

      expect(stats.totalSessions).toBe(2);
      expect(stats.totalFiles).toBe(2);
      expect(stats.sessionsByTenant['tenant-a']).toBe(1);
      expect(stats.sessionsByTenant['tenant-b']).toBe(1);
    });
  });

  describe('forceDeleteSession', () => {
    it('should delete session and its files', async () => {
      const sessionDir = await manager.createSessionDirectory('session-1', 'tenant-a');
      const filePath = path.join(sessionDir.path, 'test.txt');
      await fs.writeFile(filePath, 'content');
      await manager.registerFile('session-1', 'tenant-a', filePath);

      await manager.forceDeleteSession('session-1');

      const session = manager.getSession('session-1');
      expect(session).toBeUndefined();
    });
  });
});
