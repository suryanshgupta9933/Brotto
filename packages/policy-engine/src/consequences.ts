/**
 * Action Consequence Description Generator
 *
 * Generates human-readable descriptions of what an action will do,
 * including potential risks and expected outcomes.
 */

import { z } from 'zod';
import { CriticalActionType, ActionContext } from './classifier.js';
import { DataField, Consequence } from './approval.js';

/**
 * Template for consequence descriptions
 */
export const ConsequenceTemplateSchema = z.object({
  actionType: CriticalActionType,
  summaryTemplate: z.string(),
  detailsTemplates: z.array(z.string()).optional(),
  risksTemplates: z.array(z.string()).optional(),
  expectedOutcomeTemplate: z.string().optional(),
});

export type ConsequenceTemplate = z.infer<typeof ConsequenceTemplateSchema>;

/**
 * Default consequence templates for each action type
 */
const DEFAULT_TEMPLATES: Record<CriticalActionType, ConsequenceTemplate> = {
  sign_in: {
    actionType: 'sign_in',
    summaryTemplate: 'Sign in to {domain}',
    detailsTemplates: [
      'You will be signed into your account on {domain}',
      'Your authentication state will be saved for this session',
    ],
    risksTemplates: [
      'Your credentials will be transmitted to {domain}',
      'Session cookies may be stored',
    ],
    expectedOutcomeTemplate: 'Successfully authenticated access to {domain}',
  },

  enter_personal_info: {
    actionType: 'enter_personal_info',
    summaryTemplate: 'Enter personal information on {domain}',
    detailsTemplates: [
      'Personal information will be submitted to {domain}',
      'The following fields will be filled: {fieldNames}',
    ],
    risksTemplates: [
      'Your personal information will be stored by {domain}',
      'This data may be used according to {domain}\'s privacy policy',
    ],
    expectedOutcomeTemplate: 'Personal information submitted to the form',
  },

  enter_password: {
    actionType: 'enter_password',
    summaryTemplate: 'Enter password on {domain}',
    detailsTemplates: [
      'Your password will be transmitted to {domain}',
      'This action cannot be undone or reversed',
    ],
    risksTemplates: [
      'Your password will be sent over the network to {domain}',
      'Consider using a password manager instead of direct entry',
    ],
    expectedOutcomeTemplate: 'Authentication successful',
  },

  enter_otp: {
    actionType: 'enter_otp',
    summaryTemplate: 'Enter verification code on {domain}',
    detailsTemplates: [
      'A one-time verification code will be submitted',
      'This code expires shortly after generation',
    ],
    risksTemplates: [
      'The code could be intercepted if your connection is compromised',
      'Entering the wrong code may lock your account',
    ],
    expectedOutcomeTemplate: 'Verification successful, access granted',
  },

  send_email: {
    actionType: 'send_email',
    summaryTemplate: 'Send email via {domain}',
    detailsTemplates: [
      'An email will be composed and sent through {domain}',
      'Recipient: {recipient}',
      'Subject: {subject}',
    ],
    risksTemplates: [
      'Email cannot be recalled once sent',
      'Recipient address will be visible in the email headers',
    ],
    expectedOutcomeTemplate: 'Email delivered to recipient',
  },

  send_message: {
    actionType: 'send_message',
    summaryTemplate: 'Send message on {domain}',
    detailsTemplates: [
      'A message will be sent through {domain}',
      'Recipient: {recipient}',
    ],
    risksTemplates: [
      'Messages cannot be recalled once sent',
      'The recipient may share the message',
    ],
    expectedOutcomeTemplate: 'Message delivered to recipient',
  },

  publish_content: {
    actionType: 'publish_content',
    summaryTemplate: 'Publish content on {domain}',
    detailsTemplates: [
      'Content will be made publicly visible on {domain}',
      'The following will be published: {contentDescription}',
    ],
    risksTemplates: [
      'Published content cannot be easily unpublished',
      'Content may be indexed by search engines',
      'Content reflects on your public profile',
    ],
    expectedOutcomeTemplate: 'Content published and visible',
  },

  submit_form_external: {
    actionType: 'submit_form_external',
    summaryTemplate: 'Submit form with external impact on {domain}',
    detailsTemplates: [
      'Form data will be submitted to an external service',
      'Fields: {fieldNames}',
      'Data may be shared with third parties',
    ],
    risksTemplates: [
      'Form submission may have irreversible consequences',
      'Data may be shared with parties beyond {domain}',
      'Review submitted data carefully before confirming',
    ],
    expectedOutcomeTemplate: 'Form submitted successfully',
  },

  make_purchase: {
    actionType: 'make_purchase',
    summaryTemplate: 'Make a purchase on {domain}',
    detailsTemplates: [
      'A financial transaction will be initiated',
      'Product/Service: {itemName}',
      'Amount: {amount}',
    ],
    risksTemplates: [
      'This will charge your payment method',
      'Purchases are typically non-refundable',
      'Review the total amount before confirming',
    ],
    expectedOutcomeTemplate: 'Purchase completed, order placed',
  },

  accept_terms: {
    actionType: 'accept_terms',
    summaryTemplate: 'Accept terms and conditions on {domain}',
    detailsTemplates: [
      'You will be legally bound by terms of service',
      'Documents: {documentNames}',
    ],
    risksTemplates: [
      'Accepting terms may affect your legal rights',
      'Review terms carefully before accepting',
      'Some terms may include arbitration or liability clauses',
    ],
    expectedOutcomeTemplate: 'Terms accepted, account created or updated',
  },

  change_account_permissions: {
    actionType: 'change_account_permissions',
    summaryTemplate: 'Change account permissions on {domain}',
    detailsTemplates: [
      'Account role or permission level will be modified',
      'Changes affect what you can do on {domain}',
    ],
    risksTemplates: [
      'May affect your access to certain features',
      'May grant or revoke access to other users',
      'Permission changes may have security implications',
    ],
    expectedOutcomeTemplate: 'Permissions updated successfully',
  },

  delete_data: {
    actionType: 'delete_data',
    summaryTemplate: 'Delete data on {domain}',
    detailsTemplates: [
      'Data will be permanently removed from {domain}',
      'Items to delete: {itemNames}',
    ],
    risksTemplates: [
      'DELETION IS PERMANENT AND CANNOT BE UNDONE',
      'Deleted data cannot be recovered',
      'This action may affect other connected services',
    ],
    expectedOutcomeTemplate: 'Data permanently deleted',
  },

  upload_file: {
    actionType: 'upload_file',
    summaryTemplate: 'Upload file to {domain}',
    detailsTemplates: [
      'A file will be uploaded to {domain}',
      'File: {fileName}',
      'Size: {fileSize}',
    ],
    risksTemplates: [
      'Uploaded files may be scanned for security',
      'Files may be shared according to {domain}\'s policy',
      'Sensitive data in files may be exposed',
    ],
    expectedOutcomeTemplate: 'File uploaded successfully',
  },

  download_sensitive: {
    actionType: 'download_sensitive',
    summaryTemplate: 'Download sensitive information from {domain}',
    detailsTemplates: [
      'Sensitive data will be downloaded to your device',
      'Content: {contentDescription}',
    ],
    risksTemplates: [
      'Downloaded files may contain sensitive information',
      'Files are stored locally and may be accessible to others',
      'Handle downloaded content with care',
    ],
    expectedOutcomeTemplate: 'Download completed',
  },

  invite_users: {
    actionType: 'invite_users',
    summaryTemplate: 'Invite users to {domain}',
    detailsTemplates: [
      'Invitations will be sent to the specified email addresses',
      'Recipients: {emails}',
    ],
    risksTemplates: [
      'Invited users may gain access to your content or workspace',
      'Review recipient addresses carefully',
    ],
    expectedOutcomeTemplate: 'Invitations sent',
  },

  create_api_key: {
    actionType: 'create_api_key',
    summaryTemplate: 'Create API key on {domain}',
    detailsTemplates: [
      'A new API key will be generated for programmatic access',
      'This key provides access to your account via API',
    ],
    risksTemplates: [
      'API keys provide long-term access to your account',
      'Treat API keys like passwords',
      'Do not share keys or commit them to version control',
    ],
    expectedOutcomeTemplate: 'API key created successfully',
  },

  change_payment_details: {
    actionType: 'change_payment_details',
    summaryTemplate: 'Change payment details on {domain}',
    detailsTemplates: [
      'Your payment method will be updated',
      'This affects future transactions',
    ],
    risksTemplates: [
      'Incorrect payment details may cause transaction failures',
      'Old payment method may still be charged for subscriptions',
    ],
    expectedOutcomeTemplate: 'Payment details updated',
  },

  complete_captcha: {
    actionType: 'complete_captcha',
    summaryTemplate: 'Complete CAPTCHA verification on {domain}',
    detailsTemplates: [
      'A CAPTCHA challenge will be solved',
      'This verifies you are human',
    ],
    risksTemplates: [
      'CAPTCHA solutions may be logged',
    ],
    expectedOutcomeTemplate: 'Verification completed',
  },

  fill_credential: {
    actionType: 'fill_credential',
    summaryTemplate: 'Fill credential on {domain}',
    detailsTemplates: [
      'A stored credential will be auto-filled',
      'Credential name: {credentialName}',
    ],
    risksTemplates: [
      'Credential will be inserted into the page',
      'Ensure you are on the correct website before proceeding',
    ],
    expectedOutcomeTemplate: 'Credential filled successfully',
  },

  submit_form: {
    actionType: 'submit_form',
    summaryTemplate: 'Submit form on {domain}',
    detailsTemplates: [
      'Form data will be submitted',
      'Fields: {fieldNames}',
    ],
    risksTemplates: [
      'Review submitted data before confirming',
    ],
    expectedOutcomeTemplate: 'Form submitted successfully',
  },

  navigate_to_domain: {
    actionType: 'navigate_to_domain',
    summaryTemplate: 'Navigate to {domain}',
    detailsTemplates: [
      'The browser will navigate to a new website',
    ],
    risksTemplates: [
      'New websites may have different security policies',
      'Be cautious of phishing attempts',
    ],
    expectedOutcomeTemplate: 'Navigation completed',
  },

  execute_script: {
    actionType: 'execute_script',
    summaryTemplate: 'Execute script',
    detailsTemplates: [
      'Arbitrary code will be executed in the browser',
    ],
    risksTemplates: [
      'DANGER: Arbitrary script execution is blocked for security',
      'This action could compromise your system or data',
    ],
    expectedOutcomeTemplate: 'Script execution blocked',
  },
};

/**
 * Generate a consequence description for an action
 */
export function generateConsequence(
  actionType: CriticalActionType,
  context: ActionContext,
  dataFields?: DataField[]
): Consequence {
  const template = DEFAULT_TEMPLATES[actionType];
  const domain = context.domain || 'unknown';

  // Build field names string
  const fieldNames = dataFields?.map((f) => f.name).join(', ') || 'unknown fields';

  // Build substitutions object
  const substitutions: Record<string, string> = {
    domain,
    fieldNames,
    url: context.url || '',
    ...context.formFields,
  };

  // Add data field values if provided
  if (dataFields) {
    for (const field of dataFields) {
      substitutions[field.name] = field.masked ? '********' : (field.value || '');
    }
  }

  // Generate summary
  const summary = substituteTemplate(template.summaryTemplate, substitutions);

  // Generate details
  const details = template.detailsTemplates?.map((t) => substituteTemplate(t, substitutions));

  // Generate risks
  const risks = template.risksTemplates?.map((t) => substituteTemplate(t, substitutions));

  // Generate expected outcome
  const expectedOutcome = template.expectedOutcomeTemplate
    ? substituteTemplate(template.expectedOutcomeTemplate, substitutions)
    : undefined;

  // Determine reversibility
  const irreversibleTypes: CriticalActionType[] = [
    'delete_data',
    'publish_content',
    'make_purchase',
    'send_email',
    'send_message',
  ];
  const reversible = !irreversibleTypes.includes(actionType);

  return {
    summary,
    details,
    risks,
    expectedOutcome,
    reversible,
  };
}

/**
 * Substitute template variables with actual values
 */
function substituteTemplate(template: string, substitutions: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(substitutions)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
  }
  return result;
}

/**
 * Generate consequences for multiple action types
 */
export function generateMultipleConsequences(
  actionTypes: CriticalActionType[],
  context: ActionContext,
  dataFields?: DataField[]
): Consequence[] {
  return actionTypes.map((type) => generateConsequence(type, context, dataFields));
}

/**
 * Generate a risk assessment summary
 */
export function generateRiskAssessment(consequences: Consequence[]): {
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  reversible: boolean;
  riskFactors: string[];
} {
  const riskFactors: string[] = [];
  let hasHighRisk = false;
  let hasCriticalRisk = false;
  let allReversible = true;

  for (const consequence of consequences) {
    if (consequence.risks) {
      for (const risk of consequence.risks) {
        const lowerRisk = risk.toLowerCase();
        if (
          lowerRisk.includes('cannot be undone') ||
          lowerRisk.includes('permanent') ||
          lowerRisk.includes('non-refundable')
        ) {
          riskFactors.push('Contains irreversible actions');
          hasCriticalRisk = true;
          allReversible = false;
        }
        if (
          lowerRisk.includes('password') ||
          lowerRisk.includes('payment') ||
          lowerRisk.includes('financial')
        ) {
          riskFactors.push('Involves sensitive credentials or payments');
          hasHighRisk = true;
        }
        if (lowerRisk.includes('personal information')) {
          riskFactors.push('Involves personal data');
        }
      }
    }

    if (consequence.reversible === false) {
      allReversible = false;
    }
  }

  let overallRisk: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (hasCriticalRisk) {
    overallRisk = 'critical';
  } else if (hasHighRisk) {
    overallRisk = 'high';
  }

  return {
    overallRisk,
    reversible: allReversible,
    riskFactors: [...new Set(riskFactors)],
  };
}

/**
 * Consequence generator class for custom templates
 */
export class ConsequenceGenerator {
  private customTemplates: Map<CriticalActionType, ConsequenceTemplate>;

  constructor(customTemplates?: Partial<Record<CriticalActionType, ConsequenceTemplate>>) {
    this.customTemplates = new Map();
    if (customTemplates) {
      for (const [key, value] of Object.entries(customTemplates)) {
        if (value) {
          this.customTemplates.set(key as CriticalActionType, value);
        }
      }
    }
  }

  /**
   * Add or override a template for an action type
   */
  addTemplate(template: ConsequenceTemplate): void {
    this.customTemplates.set(template.actionType, template);
  }

  /**
   * Remove a template
   */
  removeTemplate(actionType: CriticalActionType): boolean {
    return this.customTemplates.delete(actionType);
  }

  /**
   * Generate consequence using custom or default templates
   */
  generate(
    actionType: CriticalActionType,
    context: ActionContext,
    dataFields?: DataField[]
  ): Consequence {
    const template = this.customTemplates.get(actionType) || DEFAULT_TEMPLATES[actionType];
    return generateConsequenceFromTemplate(template, context, dataFields);
  }

  /**
   * Get all available action types
   */
  getAvailableActionTypes(): CriticalActionType[] {
    return [
      ...new Set([
        ...Array.from(this.customTemplates.keys()),
        ...Object.keys(DEFAULT_TEMPLATES) as CriticalActionType[],
      ]),
    ];
  }
}

/**
 * Generate consequence from a specific template
 */
function generateConsequenceFromTemplate(
  template: ConsequenceTemplate,
  context: ActionContext,
  dataFields?: DataField[]
): Consequence {
  const domain = context.domain || 'unknown';
  const fieldNames = dataFields?.map((f) => f.name).join(', ') || 'unknown fields';

  const substitutions: Record<string, string> = {
    domain,
    fieldNames,
    url: context.url || '',
    ...context.formFields,
  };

  if (dataFields) {
    for (const field of dataFields) {
      substitutions[field.name] = field.masked ? '********' : (field.value || '');
    }
  }

  const summary = substituteTemplate(template.summaryTemplate, substitutions);
  const details = template.detailsTemplates?.map((t) => substituteTemplate(t, substitutions));
  const risks = template.risksTemplates?.map((t) => substituteTemplate(t, substitutions));
  const expectedOutcome = template.expectedOutcomeTemplate
    ? substituteTemplate(template.expectedOutcomeTemplate, substitutions)
    : undefined;

  const irreversibleTypes: CriticalActionType[] = [
    'delete_data',
    'publish_content',
    'make_purchase',
    'send_email',
    'send_message',
  ];

  return {
    summary,
    details,
    risks,
    expectedOutcome,
    reversible: !irreversibleTypes.includes(template.actionType),
  };
}
