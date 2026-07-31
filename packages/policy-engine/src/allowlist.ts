/**
 * Domain Allowlist Evaluation
 *
 * Checks if a domain is permitted for browser actions based on
 * configurable allowlists and blocklists.
 */

import { z } from 'zod';

/**
 * Result of domain evaluation
 */
export const DomainEvaluationResultSchema = z.object({
  allowed: z.boolean(),
  reason: z.string(),
  matchType: z.enum(['exact', 'subdomain', 'pattern', 'none']),
  source: z.enum(['allowlist', 'blocklist', 'default', 'high_risk']),
});

export type DomainEvaluationResult = z.infer<typeof DomainEvaluationResultSchema>;

/**
 * Domain entry in allowlist or blocklist
 */
export const DomainEntrySchema = z.object({
  pattern: z.string(),
  description: z.string().optional(),
  createdAt: z.date().optional(),
  expiresAt: z.date().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type DomainEntry = z.infer<typeof DomainEntrySchema>;

/**
 * Domain pattern types
 */
export type DomainPatternType = 'exact' | 'domain' | 'subdomain' | 'wildcard' | 'regex';

/**
 * Configuration for domain evaluation
 */
export const DomainAllowlistConfigSchema = z.object({
  allowlist: z.array(DomainEntrySchema).default([]),
  blocklist: z.array(DomainEntrySchema).default([]),
  defaultAllow: z.boolean().default(false),
  blockPrivateIPs: z.boolean().default(true),
  blockLocalhost: z.boolean().default(true),
  blockCloudMetadata: z.boolean().default(true),
  allowedSchemes: z.array(z.string()).default(['https', 'http']),
});

export type DomainAllowlistConfig = z.infer<typeof DomainAllowlistConfigSchema>;

/**
 * Private IP address patterns to block
 */
const PRIVATE_IP_PATTERNS = [
  /^127\.\d+\.\d+\.\d+$/, // Loopback
  /^10\.\d+\.\d+\.\d+$/, // Private Class A
  /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/, // Private Class B
  /^192\.168\.\d+\.\d+$/, // Private Class C
  /^169\.254\.\d+\.\d+$/, // Link-local
  /^0\.\d+\.\d+\.\d+$/, // Current network
  /^224\.\d+\.\d+\.\d+$/, // Multicast
  /^240\.\d+\.\d+\.\d+$/, // Reserved
];

/**
 * Cloud metadata endpoints to block
 */
const CLOUD_METADATA_ENDPOINTS = [
  '169.254.169.254',
  'metadata.google.internal',
  '100.100.100.200',
];

/**
 * Dangerous URL schemes to block
 */
const DANGEROUS_SCHEMES = [
  'javascript:',
  'data:',
  'file:',
  'vbscript:',
  'mailto:',
  'tel:',
  'ssh:',
  'ftp:',
];

/**
 * Parse domain pattern and determine its type
 */
function parseDomainPattern(pattern: string): {
  type: DomainPatternType;
  normalizedPattern: string;
  regex?: RegExp;
} {
  if (pattern.startsWith('*.') || pattern.startsWith('.')) {
    // Wildcard subdomain pattern
    const baseDomain = pattern.startsWith('*.')
      ? pattern.slice(2)
      : pattern.slice(1);
    return {
      type: 'wildcard',
      normalizedPattern: baseDomain,
    };
  }

  if (pattern.startsWith('/') && pattern.endsWith('/')) {
    // Regex pattern
    try {
      const regex = new RegExp(pattern.slice(1, -1));
      return {
        type: 'regex',
        normalizedPattern: pattern,
        regex,
      };
    } catch {
      // Invalid regex, treat as literal
      return {
        type: 'exact',
        normalizedPattern: pattern,
      };
    }
  }

  if (pattern.includes('*')) {
    // Wildcard pattern with multiple parts
    try {
      const regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      return {
        type: 'wildcard',
        normalizedPattern: pattern,
        regex: new RegExp(`^${regexPattern}$`, 'i'),
      };
    } catch {
      return {
        type: 'exact',
        normalizedPattern: pattern,
      };
    }
  }

  // Check if it's a domain (has dots) or exact match
  if (pattern.includes('.')) {
    return {
      type: 'domain',
      normalizedPattern: pattern.toLowerCase(),
    };
  }

  return {
    type: 'exact',
    normalizedPattern: pattern.toLowerCase(),
  };
}

/**
 * Check if a domain/IP is private
 */
function isPrivateIP(value: string): boolean {
  const trimmed = value.trim();

  // Check for private IP patterns
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  // Check for cloud metadata endpoints
  if (CLOUD_METADATA_ENDPOINTS.includes(trimmed)) {
    return true;
  }

  // Check for IPv6 equivalents
  if (
    trimmed === '::1' ||
    trimmed === 'fe80:' ||
    trimmed.startsWith('fc') ||
    trimmed.startsWith('fd') ||
    trimmed.startsWith('::ffff:')
  ) {
    return true;
  }

  return false;
}

/**
 * Extract host from URL or return as-is if just a host
 */
function extractHost(value: string): string {
  try {
    // If it contains a scheme, use URL to parse
    if (value.includes('://') || value.startsWith('//')) {
      const protocol = value.startsWith('//') ? 'https:' : '';
      const url = new URL(protocol + value);
      return url.hostname;
    }
    // If it contains a path but no scheme
    if (value.includes('/')) {
      return value.split('/')[0];
    }
  } catch {
    // Fall through to return as-is
  }

  return value;
}

/**
 * Check if a URL scheme is dangerous
 */
function isDangerousScheme(urlOrHost: string): boolean {
  const lower = urlOrHost.toLowerCase();
  for (const scheme of DANGEROUS_SCHEMES) {
    if (lower.startsWith(scheme)) {
      return true;
    }
  }
  return false;
}

/**
 * Domain allowlist evaluator
 */
export class DomainAllowlistEvaluator {
  private config: DomainAllowlistConfig;

  constructor(config: Partial<DomainAllowlistConfig> = {}) {
    this.config = DomainAllowlistConfigSchema.parse({
      allowlist: [],
      blocklist: [],
      defaultAllow: false,
      blockPrivateIPs: true,
      blockLocalhost: true,
      blockCloudMetadata: true,
      allowedSchemes: ['https', 'http'],
      ...config,
    });
  }

  /**
   * Update the configuration
   */
  updateConfig(config: Partial<DomainAllowlistConfig>): void {
    this.config = DomainAllowlistConfigSchema.parse({
      ...this.config,
      ...config,
    });
  }

  /**
   * Add a domain to the allowlist
   */
  addToAllowlist(pattern: string, description?: string, metadata?: Record<string, unknown>): void {
    this.config.allowlist.push({
      pattern,
      description,
      metadata,
      createdAt: new Date(),
    });
  }

  /**
   * Add a domain to the blocklist
   */
  addToBlocklist(pattern: string, description?: string, metadata?: Record<string, unknown>): void {
    this.config.blocklist.push({
      pattern,
      description,
      metadata,
      createdAt: new Date(),
    });
  }

  /**
   * Remove a domain from the allowlist
   */
  removeFromAllowlist(pattern: string): boolean {
    const index = this.config.allowlist.findIndex((e) => e.pattern === pattern);
    if (index !== -1) {
      this.config.allowlist.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Remove a domain from the blocklist
   */
  removeFromBlocklist(pattern: string): boolean {
    const index = this.config.blocklist.findIndex((e) => e.pattern === pattern);
    if (index !== -1) {
      this.config.blocklist.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Check if a URL or domain is allowed
   */
  evaluate(input: string): DomainEvaluationResult {
    // First check for dangerous schemes
    if (isDangerousScheme(input)) {
      return {
        allowed: false,
        reason: `Dangerous URL scheme detected: ${input.split(':')[0]}`,
        matchType: 'none',
        source: 'blocklist',
      };
    }

    const host = extractHost(input);

    // Check for private IPs if configured
    if (this.config.blockPrivateIPs && isPrivateIP(host)) {
      return {
        allowed: false,
        reason: 'Private IP addresses are blocked',
        matchType: 'none',
        source: 'blocklist',
      };
    }

    // Check for localhost if configured
    if (this.config.blockLocalhost && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) {
      return {
        allowed: false,
        reason: 'Localhost is blocked',
        matchType: 'none',
        source: 'blocklist',
      };
    }

    // Check cloud metadata endpoints if configured
    if (this.config.blockCloudMetadata && CLOUD_METADATA_ENDPOINTS.includes(host)) {
      return {
        allowed: false,
        reason: 'Cloud metadata endpoints are blocked',
        matchType: 'none',
        source: 'blocklist',
      };
    }

    // Check blocklist first (deny takes precedence)
    const blocklistResult = this.checkAgainstList(host, this.config.blocklist);
    if (blocklistResult.matchType !== 'none') {
      return {
        allowed: false,
        reason: blocklistResult.reason || `Domain matches blocklist: ${host}`,
        matchType: blocklistResult.matchType,
        source: 'blocklist',
      };
    }

    // Check allowlist
    const allowlistResult = this.checkAgainstList(host, this.config.allowlist);
    if (allowlistResult.matchType !== 'none') {
      return {
        allowed: true,
        reason: allowlistResult.reason || `Domain matches allowlist: ${host}`,
        matchType: allowlistResult.matchType,
        source: 'allowlist',
      };
    }

    // Return default based on configuration
    return {
      allowed: this.config.defaultAllow,
      reason: this.config.defaultAllow
        ? `Domain not in allowlist, using default allow: ${host}`
        : `Domain not in allowlist, using default deny: ${host}`,
      matchType: 'none',
      source: 'default',
    };
  }

  /**
   * Check a host against a list of domain entries
   */
  private checkAgainstList(
    host: string,
    list: DomainEntry[]
  ): { matchType: DomainEvaluationResult['matchType']; reason?: string } {
    const hostLower = host.toLowerCase();

    for (const entry of list) {
      // Check if entry is expired
      if (entry.expiresAt && entry.expiresAt < new Date()) {
        continue;
      }

      const { type, normalizedPattern, regex } = parseDomainPattern(entry.pattern);

      switch (type) {
        case 'exact':
          if (hostLower === normalizedPattern) {
            return { matchType: 'exact', reason: entry.description };
          }
          break;

        case 'domain':
          // Check exact domain match or subdomain match
          if (hostLower === normalizedPattern) {
            return { matchType: 'exact', reason: entry.description };
          }
          if (hostLower.endsWith('.' + normalizedPattern)) {
            return { matchType: 'subdomain', reason: entry.description };
          }
          break;

        case 'subdomain':
          // Allow any subdomain of the pattern
          if (hostLower === normalizedPattern || hostLower.endsWith('.' + normalizedPattern)) {
            return { matchType: 'subdomain', reason: entry.description };
          }
          break;

        case 'wildcard':
          // *.example.com matches sub.example.com but not example.com
          if (
            hostLower === normalizedPattern ||
            hostLower.endsWith('.' + normalizedPattern)
          ) {
            return { matchType: 'pattern', reason: entry.description };
          }
          break;

        case 'regex':
          if (regex && regex.test(hostLower)) {
            return { matchType: 'pattern', reason: entry.description };
          }
          break;
      }
    }

    return { matchType: 'none' };
  }

  /**
   * Batch evaluate multiple domains
   */
  evaluateMany(inputs: string[]): Map<string, DomainEvaluationResult> {
    const results = new Map<string, DomainEvaluationResult>();
    for (const input of inputs) {
      results.set(input, this.evaluate(input));
    }
    return results;
  }

  /**
   * Get current configuration
   */
  getConfig(): DomainAllowlistConfig {
    return { ...this.config };
  }

  /**
   * Get all domains in the allowlist
   */
  getAllowlist(): DomainEntry[] {
    return [...this.config.allowlist];
  }

  /**
   * Get all domains in the blocklist
   */
  getBlocklist(): DomainEntry[] {
    return [...this.config.blocklist];
  }
}

// Default singleton instance
let defaultEvaluator: DomainAllowlistEvaluator | null = null;

export function getDefaultEvaluator(): DomainAllowlistEvaluator {
  if (!defaultEvaluator) {
    defaultEvaluator = new DomainAllowlistEvaluator({});
  }
  return defaultEvaluator;
}

export function evaluateDomain(domain: string): DomainEvaluationResult {
  return getDefaultEvaluator().evaluate(domain);
}
