import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import {
  CriticalActionClassifier,
  DomainAllowlistEvaluator,
  PolicyEngine,
  createDefaultStrictPolicySet,
  type ClassificationResult,
} from 'policy-engine';
import type { ExecutableActionV1, PolicyDecisionV1, SemanticTarget } from '@brotto/brotto-action-schema';
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

interface SemanticTargetResolution {
  target?: SemanticTarget;
  trustworthy: boolean;
}

class NodeHostResolver implements HostResolver {
  async resolve(hostname: string, signal: AbortSignal): Promise<string[]> {
    signal.throwIfAborted();
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    signal.throwIfAborted();
    return addresses.map((entry) => entry.address);
  }
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
  private readonly hostResolver: HostResolver;
  private readonly domainEvaluator: DomainAllowlistEvaluator;
  private readonly evaluations = new Map<string, PolicyEvaluationDiagnostic>();
  private readonly allowedSchemes: Set<string>;
  private readonly allowedPrivateHosts: Set<string>;
  private readonly allowUnresolvedHosts: boolean;

  constructor(config: PolicyAdapterConfig = {}) {
    this.now = config.now ?? (() => new Date().toISOString());
    this.classifier = config.classifier ?? new CriticalActionClassifier();
    this.policyEngine = config.policyEngine ?? new PolicyEngine();
    this.hostResolver = config.hostResolver ?? new NodeHostResolver();
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
    this.allowUnresolvedHosts = config.administratorOverrides?.allowUnresolvedHosts === true;
  }

  async evaluate(input: PolicyInput, signal: AbortSignal): Promise<PolicyDecisionV1> {
    signal.throwIfAborted();
    const targetResolution = this.resolveSemanticTarget(
      input.proposal.action,
      input.observation.semanticTargets,
    );
    const target = targetResolution.target;
    const description = this.describe(input.proposal.action, target, input.observation.title);
    const category = this.category(input.proposal.action, description, target);
    const navigationDenial = await this.navigationDenial(input.proposal.action, signal);
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
    } else if (policyResult.decision === 'deny' || policyResult.decision === 'block') {
      decision = 'denied';
      reason = policyResult.reason;
    } else if (
      approvalCategories.has(category) ||
      classification.requiresApproval ||
      policyResult.requiresApproval ||
      this.requiresFailClosedApproval(
        input.proposal.action,
        target,
        targetResolution.trustworthy,
        category,
      )
    ) {
      decision = 'approval_required';
      reason = `Action category ${category} requires explicit approval`;
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

  private describe(action: ExecutableActionV1, target: SemanticTarget | undefined, title: string): string {
    if (action.type === 'visit_url') return action.url;
    const targetText = target?.accessibleName?.text ?? target?.attributes?.['aria-label'] ?? '';
    const targetMetadata = target === undefined ? '' : [
      target.tag,
      target.role ?? '',
      target.control.kind === 'input' ? target.control.inputType : '',
    ].join(' ');
    const actionText = action.type === 'insert_text' ? action.text :
      action.type === 'key' ? action.key : action.type;
    return `${title} ${targetText} ${targetMetadata} ${actionText}`.trim();
  }

  private category(
    action: ExecutableActionV1,
    description: string,
    target: SemanticTarget | undefined,
  ): PolicyCategory {
    const normalized = description.toLowerCase();
    if (
      action.type === 'insert_text' &&
      target?.control.kind === 'input' &&
      (target.control.inputType === 'email' || target.control.inputType === 'tel')
    ) {
      return 'sensitive_disclosure';
    }
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

  private async navigationDenial(
    action: ExecutableActionV1,
    signal: AbortSignal,
  ): Promise<string | undefined> {
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
    const domainDecision = this.domainEvaluator.evaluate(action.url);
    if (!domainDecision.allowed) return domainDecision.reason;
    if (ipaddr.isValid(host)) {
      return this.isPublicAddress(host) ? undefined : 'Private-network navigation targets are blocked';
    }
    try {
      const addresses = await this.hostResolver.resolve(host, signal);
      if (addresses.length === 0) throw new Error('Hostname resolved without addresses');
      if (addresses.some((address) => !this.isPublicAddress(address))) {
        return 'Hostname resolves to a private, loopback, link-local, or reserved address';
      }
      return undefined;
    } catch (error) {
      signal.throwIfAborted();
      return this.allowUnresolvedHosts
        ? undefined
        : `Hostname resolution failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private normalizeHost(host: string): string {
    return host.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  }

  private isPublicAddress(rawAddress: string): boolean {
    try {
      return ipaddr.process(this.normalizeHost(rawAddress)).range() === 'unicast';
    } catch {
      return false;
    }
  }

  private resolveSemanticTarget(
    action: ExecutableActionV1,
    targets: SemanticTarget[],
  ): SemanticTargetResolution {
    const targetId = 'targetId' in action ? action.targetId : undefined;
    if ('x' in action && 'y' in action) {
      const matches = targets.filter((candidate) => {
        const bounds = candidate.boundingBox;
        return candidate.visible && action.x >= bounds.x && action.x <= bounds.x + bounds.width &&
          action.y >= bounds.y && action.y <= bounds.y + bounds.height;
      });
      if (matches.length !== 1) return { trustworthy: false };
      const hit = matches[0]!;
      return {
        target: hit,
        trustworthy: targetId === undefined || hit.targetId === targetId,
      };
    }
    if (targetId === undefined) return { trustworthy: false };
    const target = targets.find((candidate) => candidate.visible && candidate.targetId === targetId);
    return target === undefined ? { trustworthy: false } : { target, trustworthy: true };
  }

  private requiresFailClosedApproval(
    action: ExecutableActionV1,
    target: SemanticTarget | undefined,
    targetIsTrustworthy: boolean,
    category: PolicyCategory,
  ): boolean {
    if (category !== 'interaction') return false;
    if (action.type === 'insert_text') {
      return !targetIsTrustworthy || target?.control.kind !== 'input' || target.control.inputType !== 'search';
    }
    if (action.type === 'key') return action.key !== 'Escape';
    if (['left_click', 'double_click', 'right_click'].includes(action.type)) {
      return !targetIsTrustworthy || target === undefined || target.role !== 'tab';
    }
    return false;
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
