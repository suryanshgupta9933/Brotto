/**
 * Tests for Critical Action Classifier
 */

import {
  CriticalActionClassifier,
  classifyAction,
  CriticalActionType,
} from '../classifier.js';

describe('CriticalActionClassifier', () => {
  let classifier: CriticalActionClassifier;

  beforeEach(() => {
    classifier = new CriticalActionClassifier();
  });

  describe('classify', () => {
    describe('authentication actions', () => {
      it('should classify sign_in action as high risk', () => {
        const result = classifier.classify('sign_in', { domain: 'example.com' });
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe('high');
        expect(result.actionType).toBe('sign_in');
      });

      it('should classify login action as requiring approval', () => {
        const result = classifier.classify('login', { domain: 'example.com' });
        expect(result.requiresApproval).toBe(true);
        expect(['sign_in', 'fill_credential']).toContain(result.actionType);
      });

      it('should classify authenticate action', () => {
        const result = classifier.classify('authenticate', { domain: 'example.com' });
        expect(result.requiresApproval).toBe(true);
      });
    });

    describe('password and OTP actions', () => {
      it('should classify password entry as critical risk', () => {
        const result = classifier.classify('password', { domain: 'example.com' });
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe('critical');
        expect(result.actionType).toBe('enter_password');
      });

      it('should classify OTP entry as critical risk', () => {
        const result = classifier.classify('enter_otp', { domain: 'example.com' });
        expect(result.riskLevel).toBe('critical');
      });

      it('should classify verification code as requiring approval', () => {
        const result = classifier.classify('verification_code', { domain: 'example.com' });
        expect(result.requiresApproval).toBe(true);
      });
    });

    describe('communication actions', () => {
      it('should classify email sending as high risk', () => {
        const result = classifier.classify('send_email', { domain: 'example.com' });
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe('high');
      });

      it('should classify message sending as high risk', () => {
        const result = classifier.classify('send_message', { domain: 'example.com' });
        expect(result.requiresApproval).toBe(true);
      });

      it('should classify compose action', () => {
        const result = classifier.classify('compose', { domain: 'example.com' });
        expect(result.requiresApproval).toBe(true);
      });
    });

    describe('financial actions', () => {
      it('should classify purchase as critical risk', () => {
        const result = classifier.classify('purchase', { domain: 'shop.com' });
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe('critical');
        expect(result.actionType).toBe('make_purchase');
      });

      it('should classify checkout as critical risk', () => {
        const result = classifier.classify('checkout', { domain: 'shop.com' });
        expect(result.riskLevel).toBe('critical');
      });

      it('should classify payment as critical risk', () => {
        const result = classifier.classify('payment', { domain: 'pay.com' });
        expect(result.riskLevel).toBe('critical');
      });
    });

    describe('destructive actions', () => {
      it('should classify delete as critical risk', () => {
        const result = classifier.classify('delete', { domain: 'example.com' });
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe('critical');
        expect(result.actionType).toBe('delete_data');
      });

      it('should classify remove action', () => {
        const result = classifier.classify('remove', { domain: 'example.com' });
        expect(result.riskLevel).toBe('critical');
      });
    });

    describe('permission changes', () => {
      it('should classify permission change as critical', () => {
        const result = classifier.classify('permission', { domain: 'example.com' });
        expect(result.riskLevel).toBe('critical');
        expect(result.actionType).toBe('change_account_permissions');
      });

      it('should classify admin action as critical', () => {
        const result = classifier.classify('admin', { domain: 'example.com' });
        expect(result.riskLevel).toBe('critical');
      });
    });

    describe('low risk actions', () => {
      it('should not require approval for navigate action', () => {
        const result = classifier.classify('navigate', { domain: 'example.com' });
        expect(result.requiresApproval).toBe(false);
        expect(result.riskLevel).toBe('low');
      });

      it('should not require approval for screenshot action', () => {
        const result = classifier.classify('screenshot', { domain: 'example.com' });
        expect(result.requiresApproval).toBe(false);
      });

      it('should not require approval for scroll action', () => {
        const result = classifier.classify('scroll', { domain: 'example.com' });
        expect(result.requiresApproval).toBe(false);
      });
    });

    describe('high-risk domains', () => {
      it('should flag high-risk domains like banks', () => {
        const result = classifier.classify('submit_form', { domain: 'bankofamerica.com' });
        // High risk domain + form submission = requires approval
        expect(result.requiresApproval).toBe(true);
        expect(result.reason).toContain('bankofamerica.com');
      });

      it('should flag google as high-risk domain', () => {
        const result = classifier.classify('submit_form', { domain: 'google.com' });
        // High risk domain + form submission = requires approval
        expect(result.requiresApproval).toBe(true);
      });
    });

    describe('user consent', () => {
      it('should allow certain actions with user consent', () => {
        const result = classifier.classify('publish_content', {
          domain: 'example.com',
          hasUserConsent: true,
        });
        expect(result.requiresApproval).toBe(false);
      });

      it('should still require approval for critical actions even with consent', () => {
        const result = classifier.classify('delete', {
          domain: 'example.com',
          hasUserConsent: true,
        });
        expect(result.requiresApproval).toBe(true);
      });
    });
  });

  describe('custom rules', () => {
    it('should allow registering custom classification rules', () => {
      classifier.registerRule('custom_action', ['fill_credential']);
      const result = classifier.classify('custom_action', { domain: 'example.com' });
      expect(result.actionType).toBe('fill_credential');
    });

    it('should prioritize custom rules over defaults', () => {
      classifier.registerRule('my_action', ['navigate_to_domain']);
      const result = classifier.classify('my_action', { domain: 'example.com' });
      expect(result.actionType).toBe('navigate_to_domain');
    });
  });

  describe('requiresApprovalForType', () => {
    it('should return true for critical risk types', () => {
      expect(classifier.requiresApprovalForType('enter_password')).toBe(true);
      expect(classifier.requiresApprovalForType('delete_data')).toBe(true);
      expect(classifier.requiresApprovalForType('make_purchase')).toBe(true);
    });

    it('should return false for low risk types', () => {
      expect(classifier.requiresApprovalForType('navigate_to_domain')).toBe(false);
      expect(classifier.requiresApprovalForType('complete_captcha')).toBe(false);
    });
  });
});

describe('classifyAction convenience function', () => {
  it('should use default classifier', () => {
    const result = classifyAction('login', { domain: 'example.com' });
    expect(result.requiresApproval).toBe(true);
  });
});
