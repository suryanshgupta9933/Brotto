/**
 * Artifact Service Server
 *
 * Main entry point for the artifact service that handles file transfers
 * between client browsers and the server according to ARCHITECTURE.md section 4.5.
 */

import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import * as path from 'path';
import type {
  ArtifactMetadata,
} from './types.js';
import { EncryptedStorageManager, getStorageManager } from './storage.js';
import { ApprovalWorkflowManager, getApprovalManager, canProceedWithTransfer } from './approval.js';
import { SessionIsolationManager, getIsolationManager } from './isolation.js';
import { RetentionCleanupManager, createCleanupManager } from './cleanup.js';
import { FileValidationService } from './validation.js';
import {
  CrossTenantSecurityError,
  getSecurityManager,
  validateTenantAccess,
} from './security.js';
import * as crypto from 'crypto';

// ============================================================================
// Configuration
// ============================================================================

interface ServerConfig {
  port: number;
  host: string;
  storageDir: string;
  tempDir: string;
  maxFileSize: number;
}

const DEFAULT_CONFIG: ServerConfig = {
  port: 3001,
  host: '0.0.0.0',
  storageDir: '/var/artifact-service/storage',
  tempDir: '/tmp/artifact-service',
  maxFileSize: 100 * 1024 * 1024, // 100MB
};

// ============================================================================
// Artifact Service
// ============================================================================

export class ArtifactService {
  private app: express.Application;
  private server: ReturnType<express.Application['listen']> | null = null;
  private config: ServerConfig;

  // Core managers
  private storageManager: EncryptedStorageManager;
  private approvalManager: ApprovalWorkflowManager;
  private isolationManager: SessionIsolationManager;
  private cleanupManager: RetentionCleanupManager;
  private validationService: FileValidationService;
  private securityManager = getSecurityManager();

  // Artifact registry
  private artifacts: Map<string, ArtifactMetadata> = new Map();

  // Multer for file uploads
  private upload: multer.Multer;

  constructor(config: Partial<ServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize managers
    this.storageManager = getStorageManager();
    this.approvalManager = getApprovalManager();
    this.isolationManager = getIsolationManager();
    this.cleanupManager = createCleanupManager(this.isolationManager, this.storageManager);
    this.validationService = new FileValidationService();

    // Initialize Express app
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();

    // Configure multer
    this.upload = multer({
      dest: this.config.tempDir,
      limits: { fileSize: this.config.maxFileSize },
    });
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Request logging
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
      next();
    });

    // Error handling
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      console.error('Error:', err);
      res.status(500).json({ error: err.message });
    });
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'healthy', service: 'artifact-service' });
    });

    // Stats endpoint
    this.app.get('/stats', (_req: Request, res: Response) => {
      res.json({
        artifacts: this.artifacts.size,
        pendingApprovals: this.approvalManager.getStats().pending,
        cleanupStats: this.cleanupManager.getStats(),
        isolationStats: this.isolationManager.getStats(),
        securityStats: this.securityManager.getStats(),
      });
    });

    // ===== Artifact Registration (from connector) =====

    /**
     * Register a new artifact (download from browser)
     * POST /artifacts/register
     */
    this.app.post('/artifacts/register', async (req: Request, res: Response) => {
      try {
        const body = RegisterArtifactRequestSchema.parse(req.body);

        const artifact: ArtifactMetadata = {
          id: this.generateArtifactId(),
          filename: body.filename,
          mimeType: body.mimeType,
          size: body.size,
          checksum: body.checksum,
          checksumAlgorithm: body.checksumAlgorithm,
          tenantId: body.tenantId,
          sessionId: body.sessionId,
          direction: body.direction,
          status: body.requiresApproval ? 'pending_approval' : 'approved',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // Register with cleanup manager
        this.cleanupManager.registerArtifact(artifact);
        this.artifacts.set(artifact.id, artifact);

        // Create temp file path
        const tempPath = await this.isolationManager.createTempFile(
          body.sessionId,
          body.tenantId,
          body.filename
        );
        artifact.originalPath = tempPath;

        res.status(201).json({
          artifactId: artifact.id,
          tempPath,
          status: artifact.status,
        });
      } catch (err) {
        if (err instanceof z.ZodError) {
          res.status(400).json({ error: 'Invalid request', details: err.errors });
        } else {
          console.error('Failed to register artifact:', err);
          res.status(500).json({ error: 'Failed to register artifact' });
        }
      }
    });

    // ===== Approval Endpoints =====

    /**
     * Request approval for an artifact
     * POST /artifacts/:artifactId/approve
     */
    this.app.post('/artifacts/:artifactId/request-approval', async (req: Request, res: Response) => {
      try {
        const { artifactId } = req.params;
        const { requestedBy, reason } = req.body;

        const artifact = this.artifacts.get(artifactId);
        if (!artifact) {
          res.status(404).json({ error: 'Artifact not found' });
          return;
        }

        const approval = this.approvalManager.createDownloadApproval(
          artifactId,
          artifact.sessionId,
          artifact.tenantId,
          requestedBy,
          artifact.filename,
          artifact.mimeType,
          artifact.size,
          artifact.checksum,
          reason
        );

        artifact.status = 'pending_approval';
        artifact.updatedAt = new Date();

        res.status(200).json({
          approvalId: approval.id,
          expiresAt: approval.expiresAt,
        });
      } catch (err) {
        console.error('Failed to request approval:', err);
        res.status(500).json({ error: 'Failed to request approval' });
      }
    });

    /**
     * Respond to approval request
     * POST /approvals/:artifactId/respond
     */
    this.app.post('/approvals/:artifactId/respond', async (req: Request, res: Response) => {
      try {
        const { artifactId } = req.params;
        const { decision, responderId, reason } = req.body;

        const result = this.approvalManager.respondToApproval({
          artifactId,
          decision,
          responderId,
          reason,
        });

        if (!result) {
          res.status(404).json({ error: 'Approval request not found' });
          return;
        }

        const artifact = this.artifacts.get(artifactId);
        if (artifact) {
          artifact.status = result.status === 'approved' ? 'approved' : 'rejected';
          artifact.approvedAt = result.respondedAt;
          artifact.approvedBy = result.responderId;
          artifact.updatedAt = new Date();
        }

        res.status(200).json({
          artifactId,
          decision: result.status,
          respondedAt: result.respondedAt,
        });
      } catch (err) {
        console.error('Failed to respond to approval:', err);
        res.status(500).json({ error: 'Failed to respond to approval' });
      }
    });

    /**
     * Get pending approvals for a tenant
     * GET /approvals/pending?tenantId=xxx
     */
    this.app.get('/approvals/pending', (req: Request, res: Response) => {
      const { tenantId } = req.query;
      if (!tenantId || typeof tenantId !== 'string') {
        res.status(400).json({ error: 'tenantId required' });
        return;
      }

      const approvals = this.approvalManager.getPendingForTenant(tenantId);
      res.json({ approvals });
    });

    // ===== Upload/Download Endpoints =====

    /**
     * Upload a file (from connector after browser download)
     * POST /artifacts/:artifactId/upload
     */
    this.app.post(
      '/artifacts/:artifactId/upload',
      this.upload.single('file'),
      async (req: Request, res: Response) => {
        try {
          const { artifactId } = req.params;
          const tenantId = req.headers['x-tenant-id'] as string;

          const artifact = this.artifacts.get(artifactId);
          if (!artifact) {
            res.status(404).json({ error: 'Artifact not found' });
            return;
          }

          // Validate tenant access
          try {
            validateTenantAccess(artifact, tenantId);
          } catch (err) {
            if (err instanceof CrossTenantSecurityError) {
              this.securityManager.recordRejection({
                artifactId,
                requestedTenantId: tenantId,
                artifactTenantId: artifact.tenantId,
                attemptedAt: new Date(),
                reason: err.message,
              });
              res.status(403).json({ error: 'Cross-tenant access denied' });
              return;
            }
            throw err;
          }

          // Check approval status
          const canProceed = canProceedWithTransfer(artifact, this.approvalManager);
          if (!canProceed.approved) {
            res.status(403).json({ error: canProceed.reason });
            return;
          }

          if (!req.file) {
            res.status(400).json({ error: 'No file uploaded' });
            return;
          }

          // Validate file
          const validation = await this.validationService.validateUpload(
            req.file.path,
            artifact.filename,
            artifact.mimeType,
            artifact.checksum,
            artifact.size
          );

          if (!validation.valid) {
            res.status(400).json({
              error: 'File validation failed',
              details: validation.errors,
              warnings: validation.warnings,
            });
            return;
          }

          // Encrypt and store
          const encrypted = await this.storageManager.encryptAndStore(
            req.file.path,
            artifactId,
            tenantId
          );

          artifact.status = 'stored';
          artifact.encryptedAt = new Date();
          artifact.storedAt = new Date();
          artifact.storagePath = encrypted.encryptedPath;
          artifact.updatedAt = new Date();

          res.status(200).json({
            artifactId,
            encryptedSize: encrypted.encryptedSize,
            status: artifact.status,
          });
        } catch (err) {
          console.error('Failed to upload artifact:', err);
          res.status(500).json({ error: 'Failed to upload artifact' });
        }
      }
    );

    /**
     * Download an artifact (to connector for browser upload)
     * GET /artifacts/:artifactId/download
     */
    this.app.get('/artifacts/:artifactId/download', async (req: Request, res: Response) => {
      try {
        const { artifactId } = req.params;
        const tenantId = req.headers['x-tenant-id'] as string;

        const artifact = this.artifacts.get(artifactId);
        if (!artifact) {
          res.status(404).json({ error: 'Artifact not found' });
          return;
        }

        // Validate tenant access
        try {
          validateTenantAccess(artifact, tenantId);
        } catch (err) {
          if (err instanceof CrossTenantSecurityError) {
            this.securityManager.recordRejection({
              artifactId,
              requestedTenantId: tenantId,
              artifactTenantId: artifact.tenantId,
              attemptedAt: new Date(),
              reason: err.message,
            });
            res.status(403).json({ error: 'Cross-tenant access denied' });
            return;
          }
          throw err;
        }

        // Check approval status
        const canProceed = canProceedWithTransfer(artifact, this.approvalManager);
        if (!canProceed.approved) {
          res.status(403).json({ error: canProceed.reason });
          return;
        }

        // Create session temp directory for download
        const sessionDir = await this.isolationManager.getSessionDirectory(
          artifact.sessionId,
          tenantId
        );

        const downloadPath = path.join(
          sessionDir.path,
          `download_${Date.now()}_${artifact.filename}`
        );

        // Decrypt and write to temp file
        await this.storageManager.decryptAndRetrieve(artifactId, tenantId, downloadPath);

        res.status(200).json({
          artifactId,
          downloadPath,
          filename: artifact.filename,
          mimeType: artifact.mimeType,
          size: artifact.size,
        });
      } catch (err) {
        console.error('Failed to download artifact:', err);
        res.status(500).json({ error: 'Failed to download artifact' });
      }
    });

    // ===== Artifact Management =====

    /**
     * Get artifact metadata
     * GET /artifacts/:artifactId
     */
    this.app.get('/artifacts/:artifactId', (req: Request, res: Response) => {
      const { artifactId } = req.params;
      const tenantId = req.headers['x-tenant-id'] as string;

      const artifact = this.artifacts.get(artifactId);
      if (!artifact) {
        res.status(404).json({ error: 'Artifact not found' });
        return;
      }

      // Validate tenant access
      try {
        validateTenantAccess(artifact, tenantId);
      } catch (err) {
        if (err instanceof CrossTenantSecurityError) {
          res.status(403).json({ error: 'Cross-tenant access denied' });
          return;
        }
        throw err;
      }

      res.json({ artifact });
    });

    /**
     * Delete an artifact
     * DELETE /artifacts/:artifactId
     */
    this.app.delete('/artifacts/:artifactId', async (req: Request, res: Response) => {
      try {
        const { artifactId } = req.params;
        const tenantId = req.headers['x-tenant-id'] as string;

        const artifact = this.artifacts.get(artifactId);
        if (!artifact) {
          res.status(404).json({ error: 'Artifact not found' });
          return;
        }

        // Validate tenant access
        try {
          validateTenantAccess(artifact, tenantId);
        } catch (err) {
          if (err instanceof CrossTenantSecurityError) {
            res.status(403).json({ error: 'Cross-tenant access denied' });
            return;
          }
          throw err;
        }

        // Delete from storage
        await this.cleanupManager.forceDelete(artifactId);

        artifact.status = 'deleted';
        artifact.deletedAt = new Date();
        artifact.updatedAt = new Date();

        res.status(200).json({ artifactId, status: 'deleted' });
      } catch (err) {
        console.error('Failed to delete artifact:', err);
        res.status(500).json({ error: 'Failed to delete artifact' });
      }
    });

    // ===== Cleanup Control =====

    /**
     * Trigger manual cleanup
     * POST /cleanup/run
     */
    this.app.post('/cleanup/run', async (_req: Request, res: Response) => {
      try {
        const stats = await this.cleanupManager.runCleanup();
        res.json(stats);
      } catch (err) {
        console.error('Cleanup failed:', err);
        res.status(500).json({ error: 'Cleanup failed' });
      }
    });

    /**
     * Get cleanup status
     * GET /cleanup/status
     */
    this.app.get('/cleanup/status', (_req: Request, res: Response) => {
      res.json({
        stats: this.cleanupManager.getStats(),
        policy: this.cleanupManager.getRetentionPolicy(),
        artifactsReadyForCleanup: this.cleanupManager.getArtifactsReadyForCleanup().length,
      });
    });
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, this.config.host, () => {
        console.log(`Artifact service listening on ${this.config.host}:${this.config.port}`);
        // Start cleanup scheduler
        this.cleanupManager.start();
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    // Stop cleanup scheduler
    this.cleanupManager.stop();

    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          console.log('Artifact service stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Generate unique artifact ID
   */
  private generateArtifactId(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = crypto.randomBytes(8).toString('hex');
    return `art_${timestamp}_${randomPart}`;
  }

  /**
   * Get artifact by ID
   */
  getArtifact(artifactId: string): ArtifactMetadata | undefined {
    return this.artifacts.get(artifactId);
  }

  /**
   * Get all artifacts
   */
  getAllArtifacts(): ArtifactMetadata[] {
    return Array.from(this.artifacts.values());
  }
}

// Import Zod for schema validation
import { z } from 'zod';

// Recreate the schema here since we can't import it at the top due to circular dependency
const RegisterArtifactRequestSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().positive(),
  checksum: z.string(),
  checksumAlgorithm: z.enum(['sha256', 'sha512', 'md5']).default('sha256'),
  sessionId: z.string(),
  tenantId: z.string(),
  direction: z.enum(['download', 'upload']),
  requiresApproval: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional(),
});

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  const port = parseInt(process.env.ARTIFACT_SERVICE_PORT || '3001', 10);
  const host = process.env.ARTIFACT_SERVICE_HOST || '0.0.0.0';

  const service = new ArtifactService({ port, host });
  await service.start();
}

// Run if executed directly
main().catch(console.error);
