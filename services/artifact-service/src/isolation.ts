/**
 * Isolation Module - Temporary File Isolation
 *
 * Implements session-scoped temporary directory management.
 * Ensures files are isolated per session and tenant.
 * Part of the security architecture to prevent cross-session access.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { SessionTempDirectory } from './types.js';
import { sanitizeFilename, validateStoragePath } from './security.js';

export interface IsolationConfig {
  baseTempDir: string;
  maxAgeMs: number;
  maxFilesPerSession: number;
  enableAutoCleanup: boolean;
}

const DEFAULT_CONFIG: IsolationConfig = {
  baseTempDir: '/tmp/artifact-service',
  maxAgeMs: 3600000, // 1 hour
  maxFilesPerSession: 100,
  enableAutoCleanup: true,
};

/**
 * Session-scoped temporary directory manager
 */
export class SessionIsolationManager {
  private config: IsolationConfig;
  private sessions: Map<string, SessionTempDirectory> = new Map();

  constructor(config: Partial<IsolationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureBaseDir();
  }

  /**
   * Ensure base temp directory exists
   */
  private async ensureBaseDir(): Promise<void> {
    try {
      await fs.mkdir(this.config.baseTempDir, { recursive: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err;
      }
    }
  }

  /**
   * Create a session-scoped temp directory
   */
  async createSessionDirectory(
    sessionId: string,
    tenantId: string
  ): Promise<SessionTempDirectory> {
    // Validate inputs
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
      throw new Error(`Invalid session ID format: ${sessionId}`);
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
      throw new Error(`Invalid tenant ID format: ${tenantId}`);
    }

    // Create session-specific directory path
    const sessionDir = path.join(
      this.config.baseTempDir,
      sanitizeFilename(tenantId),
      sanitizeFilename(sessionId)
    );

    // Ensure directory exists
    await fs.mkdir(sessionDir, { recursive: true });

    const sessionTempDir: SessionTempDirectory = {
      sessionId,
      tenantId,
      path: sessionDir,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      maxAgeMs: this.config.maxAgeMs,
      files: [],
    };

    this.sessions.set(sessionId, sessionTempDir);
    return sessionTempDir;
  }

  /**
   * Get or create session directory
   */
  async getSessionDirectory(
    sessionId: string,
    tenantId: string
  ): Promise<SessionTempDirectory> {
    const existing = this.sessions.get(sessionId);
    if (existing && existing.tenantId === tenantId) {
      existing.lastAccessedAt = new Date();
      return existing;
    }
    return this.createSessionDirectory(sessionId, tenantId);
  }

  /**
   * Create a temporary file path within session directory
   */
  async createTempFile(
    sessionId: string,
    tenantId: string,
    filename: string
  ): Promise<string> {
    const sessionDir = await this.getSessionDirectory(sessionId, tenantId);

    // Check file limit
    if (sessionDir.files.length >= this.config.maxFilesPerSession) {
      throw new Error(
        `Session ${sessionId} has reached maximum file limit of ${this.config.maxFilesPerSession}`
      );
    }

    // Sanitize filename and make it unique
    const sanitized = sanitizeFilename(filename);
    const uniqueSuffix = crypto.randomBytes(8).toString('hex');
    const uniqueFilename = `${Date.now()}_${uniqueSuffix}_${sanitized}`;
    const filePath = path.join(sessionDir.path, uniqueFilename);

    // Validate the path is within the session directory
    if (!validateStoragePath(filePath, sessionDir.path)) {
      throw new Error('Invalid file path - path traversal detected');
    }

    sessionDir.files.push(filePath);
    sessionDir.lastAccessedAt = new Date();

    return filePath;
  }

  /**
   * Register an existing file in session tracking
   */
  async registerFile(
    sessionId: string,
    tenantId: string,
    filePath: string
  ): Promise<void> {
    const sessionDir = await this.getSessionDirectory(sessionId, tenantId);

    if (sessionDir.files.length >= this.config.maxFilesPerSession) {
      throw new Error(
        `Session ${sessionId} has reached maximum file limit of ${this.config.maxFilesPerSession}`
      );
    }

    // Validate path is within session directory
    if (!validateStoragePath(filePath, sessionDir.path)) {
      throw new Error('Invalid file path - path traversal detected');
    }

    sessionDir.files.push(filePath);
    sessionDir.lastAccessedAt = new Date();
  }

  /**
   * Remove a file from session tracking (doesn't delete the file)
   */
  unregisterFile(sessionId: string, filePath: string): void {
    const sessionDir = this.sessions.get(sessionId);
    if (sessionDir) {
      sessionDir.files = sessionDir.files.filter(f => f !== filePath);
    }
  }

  /**
   * Delete a specific file in a session
   */
  async deleteFile(sessionId: string, filePath: string): Promise<void> {
    const sessionDir = this.sessions.get(sessionId);
    if (!sessionDir) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!validateStoragePath(filePath, sessionDir.path)) {
      throw new Error('Invalid file path - path traversal detected');
    }

    try {
      await fs.unlink(filePath);
      this.unregisterFile(sessionId, filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
      // File already gone, just unregister
      this.unregisterFile(sessionId, filePath);
    }
  }

  /**
   * Delete all files in a session
   */
  async deleteSessionFiles(sessionId: string): Promise<void> {
    const sessionDir = this.sessions.get(sessionId);
    if (!sessionDir) {
      return;
    }

    for (const filePath of sessionDir.files) {
      try {
        await fs.unlink(filePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error(`Failed to delete file ${filePath}:`, err);
        }
      }
    }

    sessionDir.files = [];
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<string[]> {
    const now = new Date();
    const expiredSessions: string[] = [];

    for (const [sessionId, sessionDir] of this.sessions) {
      const age = now.getTime() - sessionDir.lastAccessedAt.getTime();
      if (age > sessionDir.maxAgeMs) {
        await this.deleteSessionFiles(sessionId);
        try {
          await fs.rmdir(sessionDir.path);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error(`Failed to remove session dir ${sessionDir.path}:`, err);
          }
        }
        expiredSessions.push(sessionId);
        this.sessions.delete(sessionId);
      }
    }

    return expiredSessions;
  }

  /**
   * Get session info
   */
  getSession(sessionId: string): SessionTempDirectory | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): SessionTempDirectory[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session statistics
   */
  getStats(): {
    totalSessions: number;
    totalFiles: number;
    sessionsByTenant: Record<string, number>;
  } {
    const sessionsByTenant: Record<string, number> = {};
    let totalFiles = 0;

    for (const session of this.sessions.values()) {
      sessionsByTenant[session.tenantId] = (sessionsByTenant[session.tenantId] || 0) + 1;
      totalFiles += session.files.length;
    }

    return {
      totalSessions: this.sessions.size,
      totalFiles,
      sessionsByTenant,
    };
  }

  /**
   * Force delete a session (for emergency use)
   */
  async forceDeleteSession(sessionId: string): Promise<void> {
    const sessionDir = this.sessions.get(sessionId);
    if (sessionDir) {
      await this.deleteSessionFiles(sessionId);
      try {
        await fs.rmdir(sessionDir.path);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error(`Failed to remove session dir ${sessionDir.path}:`, err);
        }
      }
    }
    this.sessions.delete(sessionId);
  }

  /**
   * Clear all sessions (for testing or shutdown)
   */
  async clearAll(): Promise<void> {
    for (const sessionId of this.sessions.keys()) {
      await this.forceDeleteSession(sessionId);
    }
  }
}

// Default singleton instance
let defaultIsolationManager: SessionIsolationManager | null = null;

export function getIsolationManager(): SessionIsolationManager {
  if (!defaultIsolationManager) {
    defaultIsolationManager = new SessionIsolationManager();
  }
  return defaultIsolationManager;
}
