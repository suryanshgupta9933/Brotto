/**
 * Security Module - Cross-tenant Reference Rejection
 *
 * Ensures artifacts cannot be accessed across tenant boundaries.
 * Implements the security requirements from ARCHITECTURE.md section 8.5.
 */

import type {
  CrossTenantRejection,
} from './types.js';

/**
 * Minimal artifact reference for security validation
 */
export interface ArtifactReference {
  id: string;
  tenantId: string;
}

export class CrossTenantSecurityError extends Error {
  public readonly artifactId: string;
  public readonly requestedTenantId: string;
  public readonly artifactTenantId: string;
  public readonly attemptedAt: Date;

  constructor(
    artifactId: string,
    requestedTenantId: string,
    artifactTenantId: string,
    reason: string = 'Cross-tenant artifact access denied'
  ) {
    super(reason);
    this.name = 'CrossTenantSecurityError';
    this.artifactId = artifactId;
    this.requestedTenantId = requestedTenantId;
    this.artifactTenantId = artifactTenantId;
    this.attemptedAt = new Date();
  }
}

/**
 * Validates that a tenant has access to an artifact
 */
export function validateTenantAccess(
  artifact: ArtifactReference,
  requestingTenantId: string
): void {
  if (artifact.tenantId !== requestingTenantId) {
    throw new CrossTenantSecurityError(
      artifact.id,
      requestingTenantId,
      artifact.tenantId,
      `Tenant ${requestingTenantId} attempted to access artifact ${artifact.id} belonging to tenant ${artifact.tenantId}`
    );
  }
}

/**
 * Validates that a session belongs to the correct tenant
 */
export function validateSessionTenant(
  artifact: ArtifactReference,
  sessionTenantId: string
): void {
  if (artifact.tenantId !== sessionTenantId) {
    throw new CrossTenantSecurityError(
      artifact.id,
      sessionTenantId,
      artifact.tenantId,
      `Session tenant ${sessionTenantId} attempted to access artifact ${artifact.id} belonging to tenant ${artifact.tenantId}`
    );
  }
}

/**
 * Creates a cross-tenant rejection record for audit logging
 */
export function createCrossTenantRejection(
  artifactId: string,
  requestedTenantId: string,
  artifactTenantId: string,
  reason: string
): CrossTenantRejection {
  return {
    artifactId,
    requestedTenantId,
    artifactTenantId,
    attemptedAt: new Date(),
    reason,
  };
}

/**
 * Validates artifact ID format to prevent injection attacks
 */
export function validateArtifactIdFormat(artifactId: string): boolean {
  // Artifact IDs should be alphanumeric with underscores and hyphens
  const validFormat = /^[a-zA-Z0-9_-]+$/;
  return validFormat.test(artifactId);
}

/**
 * Validates session ID format
 */
export function validateSessionIdFormat(sessionId: string): boolean {
  const validFormat = /^[a-zA-Z0-9_-]+$/;
  return validFormat.test(sessionId);
}

/**
 * Validates tenant ID format
 */
export function validateTenantIdFormat(tenantId: string): boolean {
  const validFormat = /^[a-zA-Z0-9_-]+$/;
  return validFormat.test(tenantId);
}

/**
 * Sanitizes filename to prevent path traversal attacks
 */
export function sanitizeFilename(filename: string): string {
  // Remove any path components and keep only the base filename
  const baseName = filename.split(/[/\\]/).pop() || '';
  // Remove any characters that could be used for path traversal or injection
  return baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Validates storage path to prevent directory traversal
 */
export function validateStoragePath(path: string, baseDir: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/');
  const normalizedBase = baseDir.replace(/\\/g, '/');

  // Ensure path doesn't escape the base directory
  return !normalizedPath.includes('..') &&
         normalizedPath.startsWith(normalizedBase);
}

/**
 * Cross-tenant security manager
 */
export class CrossTenantSecurityManager {
  private rejections: CrossTenantRejection[] = [];
  private readonly maxRejections: number = 10000;

  /**
   * Record a cross-tenant rejection attempt
   */
  recordRejection(rejection: CrossTenantRejection): void {
    this.rejections.push(rejection);

    // Limit memory usage by trimming old rejections
    if (this.rejections.length > this.maxRejections) {
      this.rejections = this.rejections.slice(-this.maxRejections / 2);
    }
  }

  /**
   * Get recent rejection attempts
   */
  getRecentRejections(limit: number = 100): CrossTenantRejection[] {
    return this.rejections.slice(-limit);
  }

  /**
   * Get rejection statistics
   */
  getStats(): {
    totalRejections: number;
    uniqueArtifactIds: number;
    uniqueRequestingTenants: number;
  } {
    const uniqueArtifacts = new Set(this.rejections.map(r => r.artifactId));
    const uniqueTenants = new Set(this.rejections.map(r => r.requestedTenantId));

    return {
      totalRejections: this.rejections.length,
      uniqueArtifactIds: uniqueArtifacts.size,
      uniqueRequestingTenants: uniqueTenants.size,
    };
  }

  /**
   * Clear rejection history
   */
  clear(): void {
    this.rejections = [];
  }
}

// Default singleton instance
let defaultSecurityManager: CrossTenantSecurityManager | null = null;

export function getSecurityManager(): CrossTenantSecurityManager {
  if (!defaultSecurityManager) {
    defaultSecurityManager = new CrossTenantSecurityManager();
  }
  return defaultSecurityManager;
}
