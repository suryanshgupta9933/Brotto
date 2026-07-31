/**
 * Approval Module - Download and Upload Approval Workflows
 *
 * Implements the approval workflow for artifacts according to
 * ARCHITECTURE.md sections 4.5 for downloads and uploads.
 */

import {
  ArtifactApprovalRequest,
  ArtifactApprovalResponse,
  ArtifactMetadata,
} from './types.js';

export interface ApprovalConfig {
  defaultTimeoutMs: number;
  maxPendingApprovals: number;
  enableAutomaticDenial: boolean;
  automaticDenialDelayMs: number;
}

const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  defaultTimeoutMs: 300000, // 5 minutes
  maxPendingApprovals: 1000,
  enableAutomaticDenial: false,
  automaticDenialDelayMs: 60000, // 1 minute
};

/**
 * Pending approval request
 */
export interface PendingApproval {
  request: ArtifactApprovalRequest;
  timeoutHandle?: NodeJS.Timeout;
}

/**
 * Approval workflow manager
 */
export class ApprovalWorkflowManager {
  private config: ApprovalConfig;
  private pendingApprovals: Map<string, PendingApproval> = new Map();
  private completedApprovals: Map<string, ArtifactApprovalRequest> = new Map();
  private approvalHistory: ArtifactApprovalRequest[] = [];
  private readonly maxHistory = 10000;

  constructor(config: Partial<ApprovalConfig> = {}) {
    this.config = { ...DEFAULT_APPROVAL_CONFIG, ...config };
  }

  /**
   * Create an approval request for a download
   */
  createDownloadApproval(
    artifactId: string,
    sessionId: string,
    tenantId: string,
    requestedBy: string,
    filename: string,
    mimeType: string,
    size: number,
    checksum: string,
    reason?: string,
    timeoutMs?: number
  ): ArtifactApprovalRequest {
    // Check pending limit
    if (this.pendingApprovals.size >= this.config.maxPendingApprovals) {
      throw new Error('Maximum pending approvals reached');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + (timeoutMs || this.config.defaultTimeoutMs));

    const request: ArtifactApprovalRequest = {
      id: this.generateApprovalId(),
      artifactId,
      sessionId,
      tenantId,
      requestedBy,
      status: 'pending',
      filename,
      mimeType,
      size,
      checksum,
      reason,
      createdAt: now,
      expiresAt,
    };

    // Set up automatic expiration
    const timeoutHandle = setTimeout(() => {
      this.expireApproval(request.id);
    }, timeoutMs || this.config.defaultTimeoutMs);

    this.pendingApprovals.set(request.id, { request, timeoutHandle });
    this.approvalHistory.push(request);

    // Trim history if needed
    if (this.approvalHistory.length > this.maxHistory) {
      this.approvalHistory = this.approvalHistory.slice(-this.maxHistory);
    }

    return request;
  }

  /**
   * Create an approval request for an upload
   */
  createUploadApproval(
    artifactId: string,
    sessionId: string,
    tenantId: string,
    requestedBy: string,
    filename: string,
    mimeType: string,
    size: number,
    checksum: string,
    reason?: string,
    timeoutMs?: number
  ): ArtifactApprovalRequest {
    return this.createDownloadApproval(
      artifactId,
      sessionId,
      tenantId,
      requestedBy,
      filename,
      mimeType,
      size,
      checksum,
      reason,
      timeoutMs
    );
  }

  /**
   * Respond to an approval request
   */
  respondToApproval(response: ArtifactApprovalResponse): ArtifactApprovalRequest | null {
    const pending = this.pendingApprovals.get(response.artifactId);
    if (!pending) {
      // Check if already processed
      const completed = this.completedApprovals.get(response.artifactId);
      if (completed) {
        return completed;
      }
      return null;
    }

    const { request, timeoutHandle } = pending;

    // Clear timeout
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    // Update request
    request.status = response.decision === 'approved' ? 'approved' : 'denied';
    request.respondedAt = new Date();
    request.responderId = response.responderId;

    // Move to completed
    this.pendingApprovals.delete(response.artifactId);
    this.completedApprovals.set(response.artifactId, request);

    return request;
  }

  /**
   * Approve an artifact
   */
  approve(
    artifactId: string,
    responderId: string,
    reason?: string
  ): ArtifactApprovalRequest | null {
    return this.respondToApproval({
      artifactId,
      decision: 'approved',
      responderId,
      reason,
    });
  }

  /**
   * Deny an artifact
   */
  deny(
    artifactId: string,
    responderId: string,
    reason?: string
  ): ArtifactApprovalRequest | null {
    return this.respondToApproval({
      artifactId,
      decision: 'denied',
      responderId,
      reason,
    });
  }

  /**
   * Cancel a pending approval
   */
  cancelApproval(artifactId: string, cancelledBy: string): boolean {
    const pending = this.pendingApprovals.get(artifactId);
    if (!pending) {
      return false;
    }

    if (pending.timeoutHandle) {
      clearTimeout(pending.timeoutHandle);
    }

    pending.request.status = 'expired';
    pending.request.respondedAt = new Date();
    pending.request.responderId = cancelledBy;

    this.pendingApprovals.delete(artifactId);
    this.completedApprovals.set(artifactId, pending.request);

    return true;
  }

  /**
   * Expire an approval (called by timeout)
   */
  private expireApproval(approvalId: string): void {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) {
      return;
    }

    pending.request.status = 'expired';
    pending.request.respondedAt = new Date();

    this.pendingApprovals.delete(approvalId);
    this.completedApprovals.set(approvalId, pending.request);

    // Emit event for cleanup (in production, this would be an event emitter)
    this.onApprovalExpired(pending.request);
  }

  /**
   * Callback for expired approvals (can be overridden)
   */
  protected onApprovalExpired(request: ArtifactApprovalRequest): void {
    console.log(`Approval ${request.id} expired for artifact ${request.artifactId}`);
  }

  /**
   * Get pending approval by artifact ID
   */
  getPendingApproval(artifactId: string): ArtifactApprovalRequest | undefined {
    return this.pendingApprovals.get(artifactId)?.request;
  }

  /**
   * Get pending approvals for a session
   */
  getPendingForSession(sessionId: string): ArtifactApprovalRequest[] {
    return Array.from(this.pendingApprovals.values())
      .filter(p => p.request.sessionId === sessionId)
      .map(p => p.request);
  }

  /**
   * Get pending approvals for a tenant
   */
  getPendingForTenant(tenantId: string): ArtifactApprovalRequest[] {
    return Array.from(this.pendingApprovals.values())
      .filter(p => p.request.tenantId === tenantId)
      .map(p => p.request);
  }

  /**
   * Get all pending approvals
   */
  getAllPending(): ArtifactApprovalRequest[] {
    return Array.from(this.pendingApprovals.values()).map(p => p.request);
  }

  /**
   * Get completed approval
   */
  getCompletedApproval(artifactId: string): ArtifactApprovalRequest | undefined {
    return this.completedApprovals.get(artifactId);
  }

  /**
   * Check if artifact is approved
   */
  isApproved(artifactId: string): boolean {
    const pending = this.pendingApprovals.get(artifactId);
    if (pending) {
      return pending.request.status === 'approved';
    }
    const completed = this.completedApprovals.get(artifactId);
    return completed?.status === 'approved';
  }

  /**
   * Check if artifact has pending approval
   */
  isPending(artifactId: string): boolean {
    return this.pendingApprovals.has(artifactId);
  }

  /**
   * Get approval statistics
   */
  getStats(): {
    pending: number;
    approved: number;
    denied: number;
    expired: number;
    total: number;
  } {
    const completed = Array.from(this.completedApprovals.values());
    return {
      pending: this.pendingApprovals.size,
      approved: completed.filter(c => c.status === 'approved').length,
      denied: completed.filter(c => c.status === 'denied').length,
      expired: completed.filter(c => c.status === 'expired').length,
      total: completed.length + this.pendingApprovals.size,
    };
  }

  /**
   * Get approval history
   */
  getHistory(limit: number = 100): ArtifactApprovalRequest[] {
    return this.approvalHistory.slice(-limit);
  }

  /**
   * Clean up old completed approvals
   */
  cleanupCompleted(maxAgeMs: number = 86400000): number {
    const cutoff = Date.now() - maxAgeMs;
    let cleaned = 0;

    for (const [id, request] of this.completedApprovals) {
      if (request.createdAt.getTime() < cutoff) {
        this.completedApprovals.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Generate unique approval ID
   */
  private generateApprovalId(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 10);
    return `apr_${timestamp}_${randomPart}`;
  }
}

// Default singleton instance
let defaultApprovalManager: ApprovalWorkflowManager | null = null;

export function getApprovalManager(): ApprovalWorkflowManager {
  if (!defaultApprovalManager) {
    defaultApprovalManager = new ApprovalWorkflowManager();
  }
  return defaultApprovalManager;
}

/**
 * Approval result for artifacts
 */
export interface ApprovalResult {
  approved: boolean;
  reason?: string;
  expiresAt?: Date;
}

/**
 * Check if an artifact transfer can proceed based on approval status
 */
export function canProceedWithTransfer(
  artifact: ArtifactMetadata,
  approvalManager: ApprovalWorkflowManager
): ApprovalResult {
  // Check if approval is required
  if (artifact.status === 'pending_approval') {
    const pending = approvalManager.getPendingApproval(artifact.id);
    if (!pending) {
      return { approved: false, reason: 'No pending approval found' };
    }
    return {
      approved: pending.status === 'approved',
      reason: pending.status === 'approved' ? 'Approved' : 'Pending approval',
      expiresAt: pending.expiresAt,
    };
  }

  // If already approved, check if still valid
  if (artifact.status === 'approved') {
    return { approved: true, reason: 'Previously approved' };
  }

  // Check completed approvals
  const completed = approvalManager.getCompletedApproval(artifact.id);
  if (completed) {
    return {
      approved: completed.status === 'approved',
      reason: completed.status === 'approved' ? 'Approved' : `Denied: ${completed.status}`,
    };
  }

  return { approved: false, reason: `Artifact status: ${artifact.status}` };
}
