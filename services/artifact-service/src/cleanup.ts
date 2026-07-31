/**
 * Cleanup Module - Retention Policy and Temporary Artifact Cleanup
 *
 * Implements background cleanup jobs for temporary files and
 * enforces retention policies according to ARCHITECTURE.md section 4.5.
 */

import * as cron from 'node-cron';
import type { RetentionPolicy, ArtifactMetadata, ArtifactStatus } from './types.js';
import { SessionIsolationManager } from './isolation.js';
import { EncryptedStorageManager } from './storage.js';

export interface CleanupConfig extends RetentionPolicy {
  cleanupSchedule: string; // cron expression
}

const DEFAULT_CLEANUP_CONFIG: CleanupConfig = {
  temporaryFileMaxAgeMs: 3600000, // 1 hour
  approvedArtifactMaxAgeMs: 604800000, // 7 days
  cleanupIntervalMs: 300000, // 5 minutes
  enableAutomaticCleanup: true,
  cleanupSchedule: '*/5 * * * *', // Every 5 minutes
};

/**
 * Cleanup statistics
 */
export interface CleanupStats {
  lastCleanupAt: Date | null;
  filesDeleted: number;
  artifactsDeleted: number;
  bytesFreed: number;
  errors: string[];
}

/**
 * Cleanup result for a single item
 */
export interface CleanupResult {
  artifactId: string;
  deleted: boolean;
  error?: string;
  bytesFreed?: number;
}

/**
 * Retention policy manager with background cleanup
 */
export class RetentionCleanupManager {
  private config: CleanupConfig;
  private isolationManager: SessionIsolationManager;
  private storageManager: EncryptedStorageManager;
  private cronJob: cron.ScheduledTask | null = null;
  private stats: CleanupStats = {
    lastCleanupAt: null,
    filesDeleted: 0,
    artifactsDeleted: 0,
    bytesFreed: 0,
    errors: [],
  };

  // Artifact registry (in production, this would be a database)
  private artifactRegistry: Map<string, ArtifactMetadata> = new Map();

  constructor(
    isolationManager: SessionIsolationManager,
    storageManager: EncryptedStorageManager,
    config: Partial<CleanupConfig> = {}
  ) {
    this.isolationManager = isolationManager;
    this.storageManager = storageManager;
    this.config = { ...DEFAULT_CLEANUP_CONFIG, ...config };
  }

  /**
   * Register an artifact for tracking
   */
  registerArtifact(artifact: ArtifactMetadata): void {
    this.artifactRegistry.set(artifact.id, artifact);
  }

  /**
   * Update artifact status
   */
  updateArtifactStatus(artifactId: string, status: ArtifactStatus): void {
    const artifact = this.artifactRegistry.get(artifactId);
    if (artifact) {
      artifact.status = status;
      artifact.updatedAt = new Date();
      if (status === 'deleted') {
        artifact.deletedAt = new Date();
      }
    }
  }

  /**
   * Get artifact metadata
   */
  getArtifact(artifactId: string): ArtifactMetadata | undefined {
    return this.artifactRegistry.get(artifactId);
  }

  /**
   * Check if artifact is eligible for cleanup
   */
  isEligibleForCleanup(artifactId: string): { eligible: boolean; reason?: string } {
    const artifact = this.artifactRegistry.get(artifactId);
    if (!artifact) {
      return { eligible: false, reason: 'Artifact not found' };
    }

    // Don't delete already deleted artifacts
    if (artifact.status === 'deleted') {
      return { eligible: false, reason: 'Already deleted' };
    }

    // Check retention policy
    if (artifact.retentionUntil) {
      if (new Date() < artifact.retentionUntil) {
        return { eligible: false, reason: 'Within retention period' };
      }
    }

    // Check if approved artifact has exceeded max age
    if (artifact.status === 'stored' || artifact.status === 'approved') {
      const age = Date.now() - artifact.storedAt!.getTime();
      if (age < this.config.approvedArtifactMaxAgeMs) {
        return { eligible: false, reason: 'Within approved artifact retention period' };
      }
    }

    return { eligible: true };
  }

  /**
   * Delete temporary files that have exceeded max age
   */
  async cleanupTempFiles(): Promise<CleanupResult[]> {
    const results: CleanupResult[] = [];

    // Clean up expired sessions
    const expiredSessions = await this.isolationManager.cleanupExpiredSessions();

    for (const sessionId of expiredSessions) {
      results.push({
        artifactId: `session_${sessionId}`,
        deleted: true,
        bytesFreed: 0, // We don't track bytes for session cleanup
      });
      this.stats.filesDeleted += 1;
    }

    return results;
  }

  /**
   * Delete artifacts that have exceeded retention period
   */
  async cleanupArtifacts(): Promise<CleanupResult[]> {
    const results: CleanupResult[] = [];

    for (const [artifactId, artifact] of this.artifactRegistry) {
      const eligible = this.isEligibleForCleanup(artifactId);
      if (!eligible.eligible) {
        continue;
      }

      try {
        // Delete from encrypted storage
        await this.storageManager.delete(artifactId);

        // Update registry
        this.updateArtifactStatus(artifactId, 'deleted');

        results.push({
          artifactId,
          deleted: true,
        });
        this.stats.artifactsDeleted += 1;

        // Estimate bytes freed (in production, get actual size)
        this.stats.bytesFreed += artifact.size;
      } catch (err) {
        results.push({
          artifactId,
          deleted: false,
          error: (err as Error).message,
        });
        this.stats.errors.push(`Failed to delete ${artifactId}: ${(err as Error).message}`);
      }
    }

    return results;
  }

  /**
   * Run cleanup cycle
   */
  async runCleanup(): Promise<CleanupStats> {
    this.stats.lastCleanupAt = new Date();
    this.stats.errors = [];

    // Clean up temporary files
    await this.cleanupTempFiles();

    // Clean up expired artifacts
    await this.cleanupArtifacts();

    return this.stats;
  }

  /**
   * Start automatic cleanup scheduler
   */
  start(): void {
    if (!this.config.enableAutomaticCleanup) {
      console.log('Automatic cleanup is disabled');
      return;
    }

    if (this.cronJob) {
      console.log('Cleanup scheduler already running');
      return;
    }

    console.log(`Starting cleanup scheduler with schedule: ${this.config.cleanupSchedule}`);

    this.cronJob = cron.schedule(this.config.cleanupSchedule, async () => {
      console.log('Running scheduled cleanup...');
      try {
        const stats = await this.runCleanup();
        console.log(`Cleanup complete: ${stats.filesDeleted} files, ${stats.artifactsDeleted} artifacts deleted`);
      } catch (err) {
        console.error('Cleanup failed:', err);
        this.stats.errors.push((err as Error).message);
      }
    });
  }

  /**
   * Stop automatic cleanup scheduler
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.log('Cleanup scheduler stopped');
    }
  }

  /**
   * Get cleanup statistics
   */
  getStats(): CleanupStats {
    return { ...this.stats };
  }

  /**
   * Get artifacts by status
   */
  getArtifactsByStatus(status: ArtifactStatus): ArtifactMetadata[] {
    return Array.from(this.artifactRegistry.values()).filter(a => a.status === status);
  }

  /**
   * Get artifacts ready for cleanup
   */
  getArtifactsReadyForCleanup(): ArtifactMetadata[] {
    return Array.from(this.artifactRegistry.values()).filter(
      a => this.isEligibleForCleanup(a.id).eligible
    );
  }

  /**
   * Force delete an artifact
   */
  async forceDelete(artifactId: string): Promise<void> {
    const artifact = this.artifactRegistry.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    await this.storageManager.delete(artifactId);
    this.updateArtifactStatus(artifactId, 'deleted');
  }

  /**
   * Set retention policy
   */
  setRetentionPolicy(policy: Partial<RetentionPolicy>): void {
    this.config = { ...this.config, ...policy };
  }

  /**
   * Get current retention policy
   */
  getRetentionPolicy(): RetentionPolicy {
    return {
      temporaryFileMaxAgeMs: this.config.temporaryFileMaxAgeMs,
      approvedArtifactMaxAgeMs: this.config.approvedArtifactMaxAgeMs,
      cleanupIntervalMs: this.config.cleanupIntervalMs,
      enableAutomaticCleanup: this.config.enableAutomaticCleanup,
    };
  }

  /**
   * Clear all artifacts (for testing)
   */
  async clearAll(): Promise<void> {
    for (const artifactId of this.artifactRegistry.keys()) {
      try {
        await this.storageManager.delete(artifactId);
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.artifactRegistry.clear();
  }
}

/**
 * Create a cleanup manager with defaults
 */
export function createCleanupManager(
  isolationManager: SessionIsolationManager,
  storageManager: EncryptedStorageManager
): RetentionCleanupManager {
  return new RetentionCleanupManager(isolationManager, storageManager);
}
