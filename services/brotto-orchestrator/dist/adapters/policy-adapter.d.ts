import { CriticalActionClassifier, PolicyEngine, type ClassificationResult } from 'policy-engine';
import type { PolicyDecisionV1 } from '@brotto/brotto-action-schema';
import type { PolicyInput, PolicyPort } from '../engine/types.js';
export type PolicyCategory = 'navigation' | 'interaction' | 'purchase' | 'booking' | 'external_message' | 'consequential_submission' | 'account_change' | 'upload' | 'download' | 'credential_entry' | 'sensitive_disclosure';
export interface PolicyEvaluationDiagnostic {
    workId: string;
    category: PolicyCategory;
    decision: PolicyDecisionV1['decision'];
    reason: string;
    classification?: ClassificationResult;
}
export interface PolicyAdministratorOverrides {
    allowedSchemes?: string[];
    allowedPrivateHosts?: string[];
    allowUnresolvedHosts?: boolean;
}
export interface HostResolver {
    resolve(hostname: string, signal: AbortSignal): Promise<string[]>;
}
export interface PolicyAdapterConfig {
    now?: () => string;
    classifier?: CriticalActionClassifier;
    policyEngine?: PolicyEngine;
    hostResolver?: HostResolver;
    administratorOverrides?: PolicyAdministratorOverrides;
}
export declare class PolicyAdapter implements PolicyPort {
    private readonly now;
    private readonly classifier;
    private readonly policyEngine;
    private readonly hostResolver;
    private readonly domainEvaluator;
    private readonly evaluations;
    private readonly allowedSchemes;
    private readonly allowedPrivateHosts;
    private readonly allowUnresolvedHosts;
    constructor(config?: PolicyAdapterConfig);
    evaluate(input: PolicyInput, signal: AbortSignal): Promise<PolicyDecisionV1>;
    getEvaluation(workId: string): PolicyEvaluationDiagnostic | undefined;
    private describe;
    private category;
    private navigationDenial;
    private normalizeHost;
    private isPublicAddress;
    private resolveSemanticTarget;
    private requiresFailClosedApproval;
    private domainFor;
}
//# sourceMappingURL=policy-adapter.d.ts.map