/**
 * Critical Action Classifier
 *
 * Determines which actions require user approval based on the action type,
 * context, and target. Maps to ARCHITECTURE.md section 8.3 critical actions.
 */

import { z } from 'zod';

/**
 * All critical action types that require approval
 */
export const CriticalActionType = z.enum([
  'sign_in',
  'enter_personal_info',
  'enter_password',
  'enter_otp',
  'send_email',
  'send_message',
  'publish_content',
  'submit_form_external',
  'make_purchase',
  'accept_terms',
  'change_account_permissions',
  'delete_data',
  'upload_file',
  'download_sensitive',
  'invite_users',
  'create_api_key',
  'change_payment_details',
  'complete_captcha',
  'fill_credential',
  'submit_form',
  'navigate_to_domain',
  'execute_script',
]);

export type CriticalActionType = z.infer<typeof CriticalActionType>;

/**
 * Context about the action being evaluated
 */
export const ActionContextSchema = z.object({
  domain: z.string(),
  url: z.string().optional(),
  formFields: z
    .record(z.string())
    .optional()
    .describe('Map of field names to values being submitted'),
  hasUserConsent: z.boolean().optional(),
  isAuthenticatedSession: z.boolean().optional(),
  actionDescription: z.string().optional(),
});

export type ActionContext = z.infer<typeof ActionContextSchema>;

/**
 * Classification result indicating if approval is required
 */
export const ClassificationResultSchema = z.object({
  requiresApproval: z.boolean(),
  actionType: CriticalActionType,
  reason: z.string(),
  suggestedReviewTime: z.enum(['immediate', 'quick', 'thorough']).optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
});

export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

/**
 * Maps action patterns to critical action types
 */
const ACTION_PATTERN_MAP: Record<string, CriticalActionType[]> = {
  // Authentication actions
  sign_in: ['sign_in', 'fill_credential', 'submit_form'],
  login: ['sign_in', 'fill_credential'],
  authenticate: ['sign_in', 'enter_password'],

  // Personal information
  personal_info: ['enter_personal_info'],
  first_name: ['enter_personal_info'],
  last_name: ['enter_personal_info'],
  address: ['enter_personal_info'],
  phone: ['enter_personal_info'],
  ssn: ['enter_personal_info'],
  dob: ['enter_personal_info'],

  // Password/OTP
  password: ['enter_password'],
  passcode: ['enter_otp'],
  otp: ['enter_otp'],
  two_factor: ['enter_otp'],
  verification_code: ['enter_otp'],

  // Communication
  email: ['send_email'],
  message: ['send_message'],
  send: ['send_email', 'send_message'],
  compose: ['send_email', 'send_message'],

  // Content actions
  publish: ['publish_content'],
  post: ['publish_content'],
  submit: ['submit_form', 'submit_form_external'],
  comment: ['publish_content'],
  review: ['publish_content'],

  // Financial
  purchase: ['make_purchase'],
  buy: ['make_purchase'],
  checkout: ['make_purchase'],
  payment: ['make_purchase', 'change_payment_details'],
  credit_card: ['change_payment_details'],
  billing: ['change_payment_details'],

  // Legal
  terms: ['accept_terms'],
  agreement: ['accept_terms'],
  accept: ['accept_terms'],
  legal: ['accept_terms'],

  // Permissions
  permission: ['change_account_permissions'],
  role: ['change_account_permissions'],
  access: ['change_account_permissions'],
  admin: ['change_account_permissions'],

  // Data operations
  delete: ['delete_data'],
  remove: ['delete_data'],
  erase: ['delete_data'],

  // File operations
  upload: ['upload_file'],
  attach: ['upload_file'],
  file_upload: ['upload_file'],

  download: ['download_sensitive'],
  export: ['download_sensitive'],

  // User management
  invite: ['invite_users'],
  add_user: ['invite_users'],
  collaborator: ['invite_users'],

  // API/Keys
  api_key: ['create_api_key'],
  token: ['create_api_key'],
  secret: ['create_api_key'],

  // CAPTCHA
  captcha: ['complete_captcha'],
  recaptcha: ['complete_captcha'],
  verify_human: ['complete_captcha'],
};

/**
 * High-risk domains that always require approval for certain actions
 */
const HIGH_RISK_DOMAIN_PATTERNS = [
  /^(www\.)?google\.com$/i,
  /^(www\.)?facebook\.com$/i,
  /^(www\.)?amazon\.com$/i,
  /^(www\.)?paypal\.com$/i,
  /^(www\.)?apple\.com$/i,
  /^(www\.)?microsoft\.com$/i,
  /^(www\.)?twitter\.com$/i,
  /^(www\.)?linkedin\.com$/i,
  /^(www\.)?github\.com$/i,
  /^(www\.)?bank/i,
  /^(www\.)?finance/i,
  /^(www\.)?invest/i,
];

/**
 * Default risk levels for action types
 */
const DEFAULT_RISK_LEVELS: Record<CriticalActionType, 'low' | 'medium' | 'high' | 'critical'> = {
  sign_in: 'high',
  enter_personal_info: 'medium',
  enter_password: 'critical',
  enter_otp: 'critical',
  send_email: 'high',
  send_message: 'high',
  publish_content: 'medium',
  submit_form_external: 'high',
  make_purchase: 'critical',
  accept_terms: 'high',
  change_account_permissions: 'critical',
  delete_data: 'critical',
  upload_file: 'medium',
  download_sensitive: 'high',
  invite_users: 'medium',
  create_api_key: 'critical',
  change_payment_details: 'critical',
  complete_captcha: 'low',
  fill_credential: 'high',
  submit_form: 'medium',
  navigate_to_domain: 'low',
  execute_script: 'critical',
};

/**
 * Classifier for determining if an action requires approval
 */
export class CriticalActionClassifier {
  private customRules: Map<string, CriticalActionType[]>;

  constructor(customRules?: Record<string, CriticalActionType[]>) {
    this.customRules = new Map(Object.entries(customRules || {}));
  }

  /**
   * Classify an action based on its name and context
   */
  classify(
    actionName: string,
    context: ActionContext
  ): ClassificationResult {
    const actionLower = actionName.toLowerCase();
    const matchedTypes = this.findMatchingActionTypes(actionLower);

    if (matchedTypes.length === 0) {
      return {
        requiresApproval: false,
        actionType: 'navigate_to_domain',
        reason: 'Action does not match any critical action patterns',
        riskLevel: 'low',
      };
    }

    // Get the highest risk level among matched types
    const riskLevel = this.getHighestRiskLevel(matchedTypes);

    // Check if this is a high-risk domain
    const isHighRiskDomain = this.isHighRiskDomain(context.domain);

    // Determine if approval is required
    const requiresApproval = this.determineApprovalRequirement(
      matchedTypes,
      context,
      isHighRiskDomain
    );

    // Determine suggested review time based on risk
    const suggestedReviewTime = this.getSuggestedReviewTime(riskLevel, matchedTypes);

    return {
      requiresApproval,
      actionType: matchedTypes[0],
      reason: this.generateReason(matchedTypes, context),
      suggestedReviewTime,
      riskLevel,
    };
  }

  /**
   * Find all critical action types that match the action name
   */
  private findMatchingActionTypes(actionName: string): CriticalActionType[] {
    const matchedTypes: Set<CriticalActionType> = new Set();

    // Check custom rules first
    for (const [pattern, types] of this.customRules) {
      if (actionName.includes(pattern.toLowerCase())) {
        types.forEach((t) => matchedTypes.add(t));
      }
    }

    // Check default pattern map
    for (const [pattern, types] of Object.entries(ACTION_PATTERN_MAP)) {
      if (actionName.includes(pattern.toLowerCase())) {
        types.forEach((t) => matchedTypes.add(t));
      }
    }

    return Array.from(matchedTypes);
  }

  /**
   * Check if domain is considered high risk
   */
  private isHighRiskDomain(domain: string): boolean {
    const domainLower = domain.toLowerCase();
    return HIGH_RISK_DOMAIN_PATTERNS.some((pattern) => pattern.test(domainLower));
  }

  /**
   * Get the highest risk level among action types
   */
  private getHighestRiskLevel(
    types: CriticalActionType[]
  ): 'low' | 'medium' | 'high' | 'critical' {
    const riskOrder = ['low', 'medium', 'high', 'critical'];
    let highest = 'low';

    for (const type of types) {
      const level = DEFAULT_RISK_LEVELS[type];
      if (riskOrder.indexOf(level) > riskOrder.indexOf(highest)) {
        highest = level;
      }
    }

    return highest as 'low' | 'medium' | 'high' | 'critical';
  }

  /**
   * Determine if approval is required based on context
   */
  private determineApprovalRequirement(
    types: CriticalActionType[],
    context: ActionContext,
    isHighRiskDomain: boolean
  ): boolean {
    // Critical risk always requires approval
    if (types.some((t) => DEFAULT_RISK_LEVELS[t] === 'critical')) {
      return true;
    }

    // High risk requires approval unless user consent is given
    if (types.some((t) => DEFAULT_RISK_LEVELS[t] === 'high')) {
      // For some actions, user consent is sufficient
      const consentSufficientTypes: CriticalActionType[] = [
        'publish_content',
        'submit_form',
        'send_message',
      ];
      if (context.hasUserConsent && consentSufficientTypes.some((t) => types.includes(t))) {
        return false;
      }
      return true;
    }

    // Medium risk requires approval on high-risk domains
    if (types.some((t) => DEFAULT_RISK_LEVELS[t] === 'medium')) {
      if (isHighRiskDomain) {
        return true;
      }
      // Forms on any domain require approval
      if (types.includes('submit_form') || types.includes('submit_form_external')) {
        return true;
      }
    }

    // Low risk typically doesn't require approval
    return false;
  }

  /**
   * Get suggested review time based on risk and action types
   */
  private getSuggestedReviewTime(
    riskLevel: 'low' | 'medium' | 'high' | 'critical',
    types: CriticalActionType[]
  ): 'immediate' | 'quick' | 'thorough' {
    if (riskLevel === 'critical') {
      return 'immediate';
    }

    if (types.includes('delete_data') || types.includes('make_purchase')) {
      return 'thorough';
    }

    if (riskLevel === 'high') {
      return 'quick';
    }

    return 'thorough';
  }

  /**
   * Generate human-readable reason for classification
   */
  private generateReason(types: CriticalActionType[], context: ActionContext): string {
    const typeLabels: Record<CriticalActionType, string> = {
      sign_in: 'Signing in',
      enter_personal_info: 'Entering personal information',
      enter_password: 'Entering password',
      enter_otp: 'Entering verification code',
      send_email: 'Sending email',
      send_message: 'Sending message',
      publish_content: 'Publishing content',
      submit_form_external: 'Submitting form with external impact',
      make_purchase: 'Making a purchase',
      accept_terms: 'Accepting terms',
      change_account_permissions: 'Changing account permissions',
      delete_data: 'Deleting data',
      upload_file: 'Uploading file',
      download_sensitive: 'Downloading sensitive information',
      invite_users: 'Inviting users',
      create_api_key: 'Creating API key',
      change_payment_details: 'Changing payment details',
      complete_captcha: 'Completing CAPTCHA',
      fill_credential: 'Filling credential',
      submit_form: 'Submitting form',
      navigate_to_domain: 'Navigating to domain',
      execute_script: 'Executing script',
    };

    const labels = types.map((t) => typeLabels[t]);
    const uniqueLabels = [...new Set(labels)];

    if (uniqueLabels.length === 1) {
      return `${uniqueLabels[0]} on ${context.domain || 'unknown domain'}`;
    }

    return `${uniqueLabels.slice(0, -1).join(', ')} or ${uniqueLabels[uniqueLabels.length - 1]} on ${context.domain || 'unknown domain'}`;
  }

  /**
   * Register custom classification rules
   */
  registerRule(pattern: string, actionTypes: CriticalActionType[]): void {
    this.customRules.set(pattern.toLowerCase(), actionTypes);
  }

  /**
   * Check if a specific action type requires approval
   */
  requiresApprovalForType(actionType: CriticalActionType): boolean {
    return DEFAULT_RISK_LEVELS[actionType] !== 'low';
  }
}

// Default singleton instance for convenience
let defaultClassifier: CriticalActionClassifier | null = null;

export function getDefaultClassifier(): CriticalActionClassifier {
  if (!defaultClassifier) {
    defaultClassifier = new CriticalActionClassifier();
  }
  return defaultClassifier;
}

export function classifyAction(
  actionName: string,
  context: ActionContext
): ClassificationResult {
  return getDefaultClassifier().classify(actionName, context);
}
