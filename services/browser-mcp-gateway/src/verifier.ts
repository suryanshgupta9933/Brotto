/**
 * Accessibility Snapshot Verifier
 * Per ARCHITECTURE.md section 3.6 - out-of-band verification
 */

import type { MCPClient } from './adapter.js';
import { MCP_TOOLS } from './adapter.js';
import type { AccessibilityVerification, VerificationCheck } from './types.js';

export interface VerificationCondition {
  type: 'text_present' | 'domain_match' | 'dialog_open' | 'form_value';
  expected?: string;
  expected_domains?: string[];
  selector?: string;
}

/**
 * Accessibility Snapshot Verifier
 * Uses Playwright's accessibility snapshot as an out-of-band verifier
 */
export class AccessibilityVerifier {
  private client: MCPClient;

  constructor(client: MCPClient) {
    this.client = client;
  }

  /**
   * Take an accessibility snapshot of the current page
   */
  async takeSnapshot(): Promise<unknown> {
    const result = await this.client.callTool({
      name: MCP_TOOLS.TAKE_ACCESSIBILITY_SNAPSHOT,
      arguments: {},
    });

    return result;
  }

  /**
   * Verify that a button click opened the expected dialog
   */
  async verifyDialogOpened(expectedDialogText?: string): Promise<AccessibilityVerification> {
    const checks: VerificationCheck[] = [];

    try {
      const snapshot = await this.takeSnapshot();
      const snapshotStr = JSON.stringify(snapshot);

      // Look for dialog-like elements
      const hasDialog = /dialog|modal|alert|confirmation/i.test(snapshotStr);

      if (!hasDialog) {
        checks.push({
          type: 'dialog_open',
          passed: false,
          message: 'No dialog or modal detected in accessibility snapshot',
        });
      } else if (expectedDialogText) {
        const hasExpectedText = snapshotStr.includes(expectedDialogText);
        checks.push({
          type: 'dialog_open',
          expected: expectedDialogText,
          passed: hasExpectedText,
          message: hasExpectedText
            ? `Dialog with text "${expectedDialogText}" verified`
            : `Expected text "${expectedDialogText}" not found in dialog`,
        });
      } else {
        checks.push({
          type: 'dialog_open',
          passed: true,
          message: 'Dialog opened (text not specified for verification)',
        });
      }

      return {
        verified: checks.every((c) => c.passed),
        checks,
      };
    } catch (error) {
      return {
        verified: false,
        checks,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Verify that text appeared on the page
   */
  async verifyTextPresent(expectedText: string): Promise<AccessibilityVerification> {
    const checks: VerificationCheck[] = [];

    try {
      const snapshot = await this.takeSnapshot();
      const snapshotStr = JSON.stringify(snapshot);
      const hasText = snapshotStr.includes(expectedText);

      checks.push({
        type: 'text_present',
        expected: expectedText,
        actual: hasText ? expectedText : undefined,
        passed: hasText,
        message: hasText ? `Text "${expectedText}" found` : `Text "${expectedText}" not found`,
      });

      return {
        verified: hasText,
        checks,
      };
    } catch (error) {
      return {
        verified: false,
        checks,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if a form field contains the expected value
   */
  async verifyFormValue(selector: string, expectedValue: string): Promise<AccessibilityVerification> {
    const checks: VerificationCheck[] = [];

    try {
      const snapshot = await this.takeSnapshot();
      const snapshotStr = JSON.stringify(snapshot);

      // Look for input elements with the expected value
      // This is a simplified check - real implementation would parse the accessibility tree
      const hasValue = new RegExp(`"value"\\s*:\\s*".*${expectedValue}.*"`).test(snapshotStr);
      const hasSelector = selector.includes('input') || selector.includes('textbox') || selector.includes('textarea');

      checks.push({
        type: 'form_value',
        selector,
        expected: expectedValue,
        passed: hasValue && hasSelector,
        message: hasValue ? `Form field contains "${expectedValue}"` : `Form field does not contain "${expectedValue}"`,
      });

      return {
        verified: hasValue,
        checks,
      };
    } catch (error) {
      return {
        verified: false,
        checks,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Detect navigation to an unexpected domain
   */
  async verifyDomain(expectedDomains: string[]): Promise<AccessibilityVerification> {
    const checks: VerificationCheck[] = [];

    try {
      const result = await this.client.callTool({
        name: MCP_TOOLS.GET_CURRENT_URL,
        arguments: {},
      });

      let currentUrl = '';
      if (result.content && result.content.length > 0) {
        const text = result.content[0]?.text || '';
        const match = text.match(/https?:\/\/[^\s"]+/);
        currentUrl = match ? match[0] : '';
      }

      if (!currentUrl) {
        checks.push({
          type: 'domain_match',
          passed: false,
          message: 'Could not determine current URL',
        });
        return { verified: false, checks };
      }

      let currentDomain = '';
      try {
        currentDomain = new URL(currentUrl).hostname;
      } catch {
        checks.push({
          type: 'domain_match',
          expected: expectedDomains.join(', '),
          actual: currentUrl,
          passed: false,
          message: `Invalid URL: ${currentUrl}`,
        });
        return { verified: false, checks };
      }

      const isAllowed = expectedDomains.some((d) => currentDomain === d || currentDomain.endsWith(`.${d}`));

      checks.push({
        type: 'domain_match',
        expected: expectedDomains.join(', '),
        actual: currentDomain,
        passed: isAllowed,
        message: isAllowed
          ? `Navigation to ${currentDomain} is allowed`
          : `Navigation to ${currentDomain} is NOT allowed (expected: ${expectedDomains.join(', ')})`,
      });

      return {
        verified: isAllowed,
        checks,
      };
    } catch (error) {
      return {
        verified: false,
        checks,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Verify success condition before declaring task complete
   */
  async verifySuccess(conditions: VerificationCondition[]): Promise<AccessibilityVerification> {
    const allChecks: VerificationCheck[] = [];

    for (const condition of conditions) {
      switch (condition.type) {
        case 'text_present':
          const textResult = await this.verifyTextPresent(condition.expected!);
          allChecks.push(...textResult.checks);
          break;
        case 'domain_match':
          const domainResult = await this.verifyDomain(condition.expected_domains!);
          allChecks.push(...domainResult.checks);
          break;
        case 'dialog_open':
          const dialogResult = await this.verifyDialogOpened(condition.expected);
          allChecks.push(...dialogResult.checks);
          break;
        case 'form_value':
          const formResult = await this.verifyFormValue(condition.selector!, condition.expected!);
          allChecks.push(...formResult.checks);
          break;
      }
    }

    return {
      verified: allChecks.every((c) => c.passed),
      checks: allChecks,
    };
  }
}

/**
 * Factory function to create an accessibility verifier
 */
export function createAccessibilityVerifier(client: MCPClient): AccessibilityVerifier {
  return new AccessibilityVerifier(client);
}
