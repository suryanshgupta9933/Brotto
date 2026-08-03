import {
  CriticalActionClassifier,
  DomainAllowlistEvaluator,
  PolicyEngine,
  createDefaultStrictPolicySet,
  type ClassificationResult,
} from 'policy-engine';
import type { ExecutableActionV1, PolicyDecisionV1, SemanticTarget } from '@fara-platform/fara-action-schema';
import type { PolicyInput, PolicyPort } from '../engine/types.js';

export type PolicyCategory =
  | 'navigation'
  | 'interaction'
  | 'purchase'
  | 'booking'
  | 'external_message'
  | 'consequential_submission'
  | 'account_change'
  | 'upload'
  | 'download'
  | 'credential_entry'
  | 'sensitive_disclosure';

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
}

export interface PolicyAdapterConfig {
  now?: () => string;
  classifier?: CriticalActionClassifier;
  policyEngine?: PolicyEngine;
  administratorOverrides?: PolicyAdministratorOverrides;
}

const approvalCategories = new Set<PolicyCategory>([
  'purchase',
  'booking',
  'external_message',
  'consequential_submission',
  'account_change',
  'upload',
  'download',
  'credential_entry',
  'sensitive_disclosure',
]);

export class PolicyAdapter implements PolicyPort {
  private readonly now: () => string;
  private readonly classifier: CriticalActionClassifier;
  private readonly policyEngine: PolicyEngine;
  private readonly domainEvaluator: DomainAllowlistEvaluator;
  private readonly evaluations = new Map<string, PolicyEvaluationDiagnostic>();
  private readonly allowedSchemes: Set<string>;
  private readonly allowedPrivateHosts: Set<string>;

  constructor(config: PolicyAdapterConfig = {}) {
    this.now = config.now ?? (() => new Date().toISOString());
    this.classifier = config.classifier ?? new CriticalActionClassifier();
    this.policyEngine = config.policyEngine ?? new PolicyEngine();
    if (this.policyEngine.getAllPolicySets().length === 0) {
      this.policyEngine.addPolicySet(createDefaultStrictPolicySet());
    }
    this.domainEvaluator = new DomainAllowlistEvaluator({ defaultAllow: true });
    this.allowedSchemes = new Set(
      (config.administratorOverrides?.allowedSchemes ?? ['http', 'https'])
        .map((scheme) => scheme.toLowerCase().replace(/:$/, '')),
    );
    this.allowedPrivateHosts = new Set(
      (config.administratorOverrides?.allowedPrivateHosts ?? []).map((host) => this.normalizeHost(host)),
    );
  }

  async evaluate(input: PolicyInput, signal: AbortSignal): Promise<PolicyDecisionV1> {
    signal.throwIfAborted();
    const description = this.describe(input.proposal.action, input.observation.semanticTargets, input.observation.title);
    const category = this.category(input.proposal.action, description);
    const navigationDenial = this.navigationDenial(input.proposal.action);
    const domain = this.domainFor(input.proposal.action, input.observation.url);
    const classification = this.classifier.classify(
      input.proposal.action.type === 'visit_url' ? 'navigate_to_domain' : description,
      {
      domain,
      url: input.proposal.action.type === 'visit_url' ? input.proposal.action.url : input.observation.url,
      actionDescription: description,
      },
    );
    const policyResult = this.policyEngine.evaluate({
      actionName: description,
      actionType: classification.actionType,
      domain,
      url: input.proposal.action.type === 'visit_url' ? input.proposal.action.url : input.observation.url,
      context: { domain, actionDescription: description },
    });

    let decision: PolicyDecisionV1['decision'];
    let reason: string;
    if (navigationDenial !== undefined) {
      decision = 'denied';
      reason = navigationDenial;
    } else if (approvalCategories.has(category) || classification.requiresApproval || policyResult.requiresApproval) {
      decision = 'approval_required';
      reason = `Action category ${category} requires explicit approval`;
    } else if (policyResult.decision === 'deny' || policyResult.decision === 'block') {
      decision = 'denied';
      reason = policyResult.reason;
    } else {
      decision = 'allowed';
      reason = policyResult.reason || 'Action allowed by policy';
    }
    signal.throwIfAborted();

    this.evaluations.set(input.workId, {
      workId: input.workId,
      category,
      decision,
      reason,
      classification,
    });
    return {
      policyDecisionId: input.policyDecisionId,
      actionId: input.actionId,
      observationId: input.proposal.observationId,
      decision,
      decidedAt: this.now(),
    };
  }

  getEvaluation(workId: string): PolicyEvaluationDiagnostic | undefined {
    const evaluation = this.evaluations.get(workId);
    return evaluation === undefined ? undefined : structuredClone(evaluation);
  }

  private describe(action: ExecutableActionV1, targets: SemanticTarget[], title: string): string {
    if (action.type === 'visit_url') return action.url;
    const targetId = 'targetId' in action ? action.targetId : undefined;
    const target = targetId === undefined ? undefined : targets.find((candidate) => candidate.targetId === targetId);
    const targetText = target?.accessibleName?.text ?? target?.attributes?.['aria-label'] ?? '';
    const actionText = action.type === 'insert_text' ? action.text :
      action.type === 'key' ? action.key : action.type;
    return `${title} ${targetText} ${actionText}`.trim();
  }

  private category(action: ExecutableActionV1, description: string): PolicyCategory {
    const normalized = description.toLowerCase();
    if (/\b(?:password|passcode|otp|one[- ]time|verification code|credential|sign[ -]?in|log[ -]?in)\b/.test(normalized)) {
      return 'credential_entry';
    }
    if (
      /\b(?:social security|ssn|credit card|card number|personal info|date of birth|dob|street address|phone number|email address|secret|private key|access token)\b/.test(normalized) ||
      /\b\d{3}-\d{2}-\d{4}\b/.test(normalized) ||
      /\b(?:\d[ -]?){13,19}\b/.test(normalized) ||
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(description)
    ) {
      return 'sensitive_disclosure';
    }
    if (/\b(?:buy|purchase|checkout|pay now|place order|payment)\b/.test(normalized)) return 'purchase';
    if (/\b(?:book|booking|reserve|reservation|appointment|flight|hotel)\b/.test(normalized)) return 'booking';
    if (/\b(?:compose|send|message|email|publish|post|comment|invite)\b/.test(normalized)) return 'external_message';
    if (/\b(?:account|permission|role|api key|payment details|billing details)\b/.test(normalized)) return 'account_change';
    if (/\b(?:upload|attach|choose file)\b/.test(normalized)) return 'upload';
    if (/\b(?:download|export|save file)\b/.test(normalized)) return 'download';
    if (action.type === 'key' && action.key.toLowerCase() === 'enter') return 'consequential_submission';
    if (/\b(?:submit|confirm|accept|agree|delete|remove|erase)\b/.test(normalized)) return 'consequential_submission';
    if (action.type === 'visit_url') return 'navigation';
    return 'interaction';
  }

  private navigationDenial(action: ExecutableActionV1): string | undefined {
    if (action.type !== 'visit_url') return undefined;
    let url: URL;
    try {
      url = new URL(action.url);
    } catch {
      return 'Malformed navigation target';
    }
    const scheme = url.protocol.toLowerCase().replace(/:$/, '');
    if (!this.allowedSchemes.has(scheme)) return `Navigation scheme ${scheme} is not allowed`;
    if (scheme !== 'http' && scheme !== 'https') return undefined;
    const host = this.normalizeHost(url.hostname);
    if (this.allowedPrivateHosts.has(host)) return undefined;
    if (this.isPrivateNetworkHost(host)) return 'Private-network navigation targets are blocked';
    const domainDecision = this.domainEvaluator.evaluate(action.url);
    return domainDecision.allowed ? undefined : domainDecision.reason;
  }

  private normalizeHost(host: string): string {
    return host.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  }

  private isPrivateNetworkHost(host: string): boolean {
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host === 'metadata.google.internal' || host === '100.100.100.200') return true;
    if (host === '::' || host === '::1' || /^(?:fc|fd)/.test(host) || /^fe[89ab]/.test(host)) {
      return true;
    }
    if (host.startsWith('::ffff:')) return this.isPrivateNetworkHost(host.slice('::ffff:'.length));
    const octets = host.split('.').map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      return false;
    }
    const [first, second] = octets as [number, number, number, number];
    return first === 0 || first === 10 || first === 127 || first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168);
  }

  private domainFor(action: ExecutableActionV1, currentUrl: string): string {
    const raw = action.type === 'visit_url' ? action.url : currentUrl;
    try {
      return new URL(raw).hostname;
    } catch {
      return raw;
    }
  }
}
