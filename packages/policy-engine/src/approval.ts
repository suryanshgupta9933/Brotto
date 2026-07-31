/**
 * Approval Request Types
 *
 * Defines the structure for approval requests that are presented to users
 * when critical actions require confirmation.
 */

import { z } from 'zod';
import { CriticalActionType, ClassificationResultSchema, ClassificationResult } from './classifier.js';
import { PolicyDecision, PolicyDecisionSchema } from './rules.js';

/**
 * Approval status
 */
export const ApprovalStatusSchema = z.enum([
  'pending',
  'approved',
  'denied',
  'expired',
  'cancelled',
]);

export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

/**
 * Urgency level for approval requests
 */
export const ApprovalUrgencySchema = z.enum(['immediate', 'quick', 'thorough']);
export type ApprovalUrgency = z.infer<typeof ApprovalUrgencySchema>;

/**
 * Data field that will be submitted
 */
export const DataFieldSchema = z.object({
  name: z.string(),
  label: z.string().optional(),
  value: z.string().optional(),
  masked: z.boolean().default(false),
  sensitive: z.boolean().default(false),
});

export type DataField = z.infer<typeof DataFieldSchema>;

/**
 * Consequence description for the approval request
 */
export const ConsequenceSchema = z.object({
  summary: z.string(),
  details: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  expectedOutcome: z.string().optional(),
  reversible: z.boolean().optional(),
});

export type Consequence = z.infer<typeof ConsequenceSchema>;

/**
 * Target of the action being approved
 */
export const ActionTargetSchema = z.object({
  domain: z.string(),
  url: z.string().optional(),
  pageTitle: z.string().optional(),
  fieldNames: z.array(z.string()).optional(),
  submitUrl: z.string().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
});

export type ActionTarget = z.infer<typeof ActionTargetSchema>;

/**
 * Approval request
 */
export const ApprovalRequestSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  actionName: z.string(),
  actionType: CriticalActionType,
  status: ApprovalStatusSchema.default('pending'),
  target: ActionTargetSchema,
  data: z.array(DataFieldSchema).optional(),
  consequence: ConsequenceSchema,
  classification: z.object({
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
    suggestedReviewTime: ApprovalUrgencySchema.optional(),
  }),
  createdAt: z.date(),
  expiresAt: z.date().optional(),
  respondedAt: z.date().optional(),
  responderId: z.string().optional(),
  policyDecision: PolicyDecisionSchema.optional(),
  matchedRules: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

/**
 * Approval decision options
 */
export const ApprovalDecisionSchema = z.enum(['approve', 'deny', 'stop']);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

/**
 * Approval response
 */
export const ApprovalResponseSchema = z.object({
  requestId: z.string(),
  decision: ApprovalDecisionSchema,
  reason: z.string().optional(),
  responderId: z.string(),
  respondedAt: z.date(),
  conditions: z
    .object({
      oneTime: z.boolean().default(false),
      validUntil: z.date().optional(),
      countLimit: z.number().optional(),
    })
    .optional(),
});

export type ApprovalResponse = z.infer<typeof ApprovalResponseSchema>;

/**
 * Approval request options for creating a new request
 */
export const CreateApprovalRequestOptionsSchema = z.object({
  sessionId: z.string(),
  actionName: z.string(),
  actionType: CriticalActionType,
  target: ActionTargetSchema,
  data: z.array(DataFieldSchema).optional(),
  consequence: ConsequenceSchema,
  classification: ClassificationResultSchema,
  policyDecision: PolicyDecisionSchema.optional(),
  matchedRules: z.array(z.string()).optional(),
  timeoutMs: z.number().default(300000), // 5 minutes default
  metadata: z.record(z.unknown()).optional(),
});

export type CreateApprovalRequestOptions = z.infer<typeof CreateApprovalRequestOptionsSchema>;

/**
 * Batch approval options
 */
export const BatchApprovalOptionsSchema = z.object({
  requestIds: z.array(z.string()),
  decision: ApprovalDecisionSchema,
  reason: z.string().optional(),
  responderId: z.string(),
});

export type BatchApprovalOptions = z.infer<typeof BatchApprovalOptionsSchema>;

/**
 * Approval request factory
 */
export class ApprovalRequestFactory {
  /**
   * Create an approval request from evaluation results
   */
  static create(options: CreateApprovalRequestOptions): ApprovalRequest {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + options.timeoutMs);

    return {
      id: generateApprovalId(),
      sessionId: options.sessionId,
      actionName: options.actionName,
      actionType: options.actionType,
      status: 'pending',
      target: options.target,
      data: options.data,
      consequence: options.consequence,
      classification: {
        riskLevel: options.classification.riskLevel,
        suggestedReviewTime: options.classification.suggestedReviewTime,
      },
      createdAt: now,
      expiresAt,
      policyDecision: options.policyDecision,
      matchedRules: options.matchedRules,
      metadata: options.metadata,
    };
  }

  /**
   * Create an approval request from a classification result
   */
  static fromClassification(
    sessionId: string,
    actionName: string,
    actionType: CriticalActionType,
    classification: ClassificationResult,
    target: ActionTarget,
    consequence: Consequence
  ): ApprovalRequest {
    return this.create({
      sessionId,
      actionName,
      actionType,
      target,
      classification,
      consequence,
      timeoutMs: 300000,
    });
  }
}

/**
 * Generate a unique approval ID
 */
function generateApprovalId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `apr_${timestamp}_${randomPart}`;
}

/**
 * Approval request manager for tracking and updating requests
 */
export class ApprovalRequestManager {
  private requests: Map<string, ApprovalRequest> = new Map();

  /**
   * Add a new approval request
   */
  add(request: ApprovalRequest): void {
    this.requests.set(request.id, request);
  }

  /**
   * Get an approval request by ID
   */
  get(id: string): ApprovalRequest | undefined {
    return this.requests.get(id);
  }

  /**
   * Get all pending requests for a session
   */
  getPendingForSession(sessionId: string): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter(
      (r) => r.sessionId === sessionId && r.status === 'pending'
    );
  }

  /**
   * Get all pending requests
   */
  getAllPending(): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter((r) => r.status === 'pending');
  }

  /**
   * Update request status
   */
  updateStatus(id: string, status: ApprovalStatus, responderId?: string): boolean {
    const request = this.requests.get(id);
    if (!request) {
      return false;
    }

    request.status = status;
    request.respondedAt = new Date();
    if (responderId) {
      request.responderId = responderId;
    }

    return true;
  }

  /**
   * Respond to an approval request
   */
  respond(response: ApprovalResponse): ApprovalRequest | undefined {
    const request = this.requests.get(response.requestId);
    if (!request) {
      return undefined;
    }

    switch (response.decision) {
      case 'approve':
        request.status = 'approved';
        break;
      case 'deny':
        request.status = 'denied';
        break;
      case 'stop':
        request.status = 'cancelled';
        break;
    }

    request.respondedAt = response.respondedAt;
    request.responderId = response.responderId;

    return request;
  }

  /**
   * Expire old pending requests
   */
  expireOldRequests(maxAgeMs: number = 300000): string[] {
    const now = new Date();
    const expiredIds: string[] = [];

    for (const [id, request] of this.requests) {
      if (
        request.status === 'pending' &&
        request.expiresAt &&
        request.expiresAt < now
      ) {
        request.status = 'expired';
        expiredIds.push(id);
      }
    }

    return expiredIds;
  }

  /**
   * Clear all requests for a session
   */
  clearSession(sessionId: string): void {
    for (const [id, request] of this.requests) {
      if (request.sessionId === sessionId) {
        this.requests.delete(id);
      }
    }
  }

  /**
   * Clear all requests
   */
  clear(): void {
    this.requests.clear();
  }

  /**
   * Get request statistics
   */
  getStats(): {
    total: number;
    pending: number;
    approved: number;
    denied: number;
    expired: number;
    cancelled: number;
  } {
    const requests = Array.from(this.requests.values());
    return {
      total: requests.length,
      pending: requests.filter((r) => r.status === 'pending').length,
      approved: requests.filter((r) => r.status === 'approved').length,
      denied: requests.filter((r) => r.status === 'denied').length,
      expired: requests.filter((r) => r.status === 'expired').length,
      cancelled: requests.filter((r) => r.status === 'cancelled').length,
    };
  }
}

// Default singleton instance
let defaultManager: ApprovalRequestManager | null = null;

export function getDefaultApprovalManager(): ApprovalRequestManager {
  if (!defaultManager) {
    defaultManager = new ApprovalRequestManager();
  }
  return defaultManager;
}
