/**
 * Artifact Service Types
 *
 * Defines the core types for the artifact service handling file transfers
 * between client browsers and the server.
 */

import { z } from 'zod';

// ============================================================================
// Enums
// ============================================================================

/**
 * Artifact status in the system
 */
export const ArtifactStatusSchema = z.enum([
  'pending_upload',
  'pending_approval',
  'approved',
  'rejected',
  'encrypted',
  'stored',
  'deleted',
  'expired',
]);

export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>;

/**
 * Transfer direction
 */
export const TransferDirectionSchema = z.enum(['download', 'upload']);
export type TransferDirection = z.infer<typeof TransferDirectionSchema>;

/**
 * Approval status for artifacts
 */
export const ArtifactApprovalStatusSchema = z.enum([
  'pending',
  'approved',
  'denied',
  'expired',
]);
export type ArtifactApprovalStatus = z.infer<typeof ArtifactApprovalStatusSchema>;

// ============================================================================
// Core Schemas
// ============================================================================

/**
 * Artifact metadata schema
 */
export const ArtifactMetadataSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().positive(),
  checksum: z.string(),
  checksumAlgorithm: z.enum(['sha256', 'sha512', 'md5']).default('sha256'),
  tenantId: z.string(),
  sessionId: z.string(),
  direction: TransferDirectionSchema,
  status: ArtifactStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  expiresAt: z.date().optional(),
  approvedAt: z.date().optional(),
  approvedBy: z.string().optional(),
  encryptedAt: z.date().optional(),
  storedAt: z.date().optional(),
  deletedAt: z.date().optional(),
  originalPath: z.string().optional(), // Path before encryption
  storagePath: z.string().optional(), // Path in encrypted storage
  retentionUntil: z.date().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>;

/**
 * Upload approval request
 */
export const ArtifactApprovalRequestSchema = z.object({
  id: z.string(),
  artifactId: z.string(),
  sessionId: z.string(),
  tenantId: z.string(),
  requestedBy: z.string(),
  status: ArtifactApprovalStatusSchema.default('pending'),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  checksum: z.string(),
  reason: z.string().optional(),
  createdAt: z.date(),
  expiresAt: z.date(),
  respondedAt: z.date().optional(),
  responderId: z.string().optional(),
});

export type ArtifactApprovalRequest = z.infer<typeof ArtifactApprovalRequestSchema>;

/**
 * Artifact approval decision
 */
export const ArtifactApprovalDecisionSchema = z.enum(['approved', 'denied']);
export type ArtifactApprovalDecision = z.infer<typeof ArtifactApprovalDecisionSchema>;

// ============================================================================
// Validation Schemas
// ============================================================================

/**
 * Allowed MIME types configuration
 */
export const AllowedMimeTypesSchema = z.object({
  extensions: z.record(z.array(z.string())), // extension -> mime types
  maxSize: z.number().positive(), // Maximum file size in bytes
  checkContent: z.boolean().default(true), // Verify file content matches MIME type
});

export type AllowedMimeTypes = z.infer<typeof AllowedMimeTypesSchema>;

/**
 * Retention policy configuration
 */
export const RetentionPolicySchema = z.object({
  temporaryFileMaxAgeMs: z.number().positive().default(3600000), // 1 hour default
  approvedArtifactMaxAgeMs: z.number().positive().default(604800000), // 7 days default
  cleanupIntervalMs: z.number().positive().default(300000), // 5 minutes default
  enableAutomaticCleanup: z.boolean().default(true),
});

export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>;

// ============================================================================
// Request/Response Types
// ============================================================================

/**
 * Register artifact request (from connector)
 */
export const RegisterArtifactRequestSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().positive(),
  checksum: z.string(),
  checksumAlgorithm: z.enum(['sha256', 'sha512', 'md5']).default('sha256'),
  sessionId: z.string(),
  tenantId: z.string(),
  direction: TransferDirectionSchema,
  requiresApproval: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional(),
});

export type RegisterArtifactRequest = z.infer<typeof RegisterArtifactRequestSchema>;

/**
 * Artifact approval response
 */
export const ArtifactApprovalResponseSchema = z.object({
  artifactId: z.string(),
  decision: ArtifactApprovalDecisionSchema,
  responderId: z.string(),
  reason: z.string().optional(),
});

export type ArtifactApprovalResponse = z.infer<typeof ArtifactApprovalResponseSchema>;

/**
 * Encrypted artifact storage result
 */
export const EncryptedArtifactSchema = z.object({
  artifactId: z.string(),
  encryptedPath: z.string(),
  encryptionKeyId: z.string(),
  iv: z.string(),
  authTag: z.string(),
  originalSize: z.number(),
  encryptedSize: z.number(),
});

export type EncryptedArtifact = z.infer<typeof EncryptedArtifactSchema>;

// ============================================================================
// Session and Security Types
// ============================================================================

/**
 * Session-scoped temporary directory
 */
export const SessionTempDirectorySchema = z.object({
  sessionId: z.string(),
  tenantId: z.string(),
  path: z.string(),
  createdAt: z.date(),
  lastAccessedAt: z.date(),
  maxAgeMs: z.number(),
  files: z.array(z.string()),
});

export type SessionTempDirectory = z.infer<typeof SessionTempDirectorySchema>;

/**
 * Cross-tenant reference rejection details
 */
export const CrossTenantRejectionSchema = z.object({
  artifactId: z.string(),
  requestedTenantId: z.string(),
  artifactTenantId: z.string(),
  attemptedAt: z.date(),
  reason: z.string(),
});

export type CrossTenantRejection = z.infer<typeof CrossTenantRejectionSchema>;
