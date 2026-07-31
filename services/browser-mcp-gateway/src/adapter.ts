/**
 * Fara Action Adapter
 * Maps Fara actions to Playwright MCP tools per ARCHITECTURE.md section 3.5
 */

import {
  FaraAction,
  FaraActionType,
  ClickAction,
  DragAction,
  MouseMoveAction,
  ScrollAction,
  KeyAction,
  VisitUrlAction,
  HistoryBackAction,
  ScreenshotAction,
  ToolCallResult,
  AccessibilityVerification,
  VerificationCheck,
} from './types.js';

/**
 * Playwright MCP tool names
 */
export const MCP_TOOLS = {
  MOUSE_CLICK_XY: 'browser_mouse_click_xy',
  MOUSE_DRAG_XY: 'browser_mouse_drag_xy',
  MOUSE_MOVE_XY: 'browser_mouse_move_xy',
  MOUSE_WHEEL: 'browser_mouse_wheel',
  PRESS_KEY: 'browser_press_key',
  NAVIGATE: 'browser_navigate',
  NAVIGATE_BACK: 'browser_navigate_back',
  TAKE_SCREENSHOT: 'browser_take_screenshot',
  KEYBOARD_INSERT_TEXT: 'browser_keyboard_insert_text',
  TAKE_ACCESSIBILITY_SNAPSHOT: 'browser_take_accessibility_snapshot',
  GET_CURRENT_URL: 'browser_get_current_url',
  LIST_TABS: 'browser_list_tabs',
} as const;

export type MCPToolName = (typeof MCP_TOOLS)[keyof typeof MCP_TOOLS];

/**
 * MCP tool call input
 */
export interface MCPToolInput {
  tool: MCPToolName;
  params: Record<string, unknown>;
}

/**
 * Interface for MCP client that executes tools
 */
export interface MCPClient {
  callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<{ content: Array<{ type: string; text: string }> }>;
  listTools(): Promise<Array<{ name: string; description?: string }>>;
}

/**
 * Result from executing an MCP tool
 */
export interface MCPExecutionResult {
  success: boolean;
  error?: string;
  content?: unknown;
}

/**
 * Disabled tools that should never be exposed to the model
 */
export const DISABLED_TOOLS = new Set<string>([
  'browser_run_code_unsafe',
  'browser_run_code',
  'shell',
  'exec',
  'evaluate',
  'evaluate_expression',
]);

/**
 * Adapter that translates Fara actions to MCP tool calls
 */
export class FaraActionAdapter {
  private client: MCPClient;
  private sessionId: string;

  constructor(client: MCPClient, sessionId: string) {
    this.client = client;
    this.sessionId = sessionId;
  }

  /**
   * Check if a tool is allowed
   */
  isToolAllowed(toolName: string): boolean {
    return !DISABLED_TOOLS.has(toolName);
  }

  /**
   * Get the list of allowed tools
   */
  async getAllowedTools(): Promise<string[]> {
    const tools = await this.client.listTools();
    return tools.map((t) => t.name).filter((name) => this.isToolAllowed(name));
  }

  /**
   * Execute a Fara action and return the result
   */
  async executeAction(action: FaraAction): Promise<ToolCallResult> {
    try {
      switch (action.type) {
        case 'left_click':
        case 'double_click':
        case 'right_click':
          return this.executeClick(action as ClickAction);

        case 'drag':
          return this.executeDrag(action as DragAction);

        case 'mouse_move':
          return this.executeMouseMove(action as MouseMoveAction);

        case 'scroll':
          return this.executeScroll(action as ScrollAction);

        case 'key':
          return this.executeKey(action as KeyAction);

        case 'visit_url':
          return this.executeVisitUrl(action as VisitUrlAction);

        case 'history_back':
          return this.executeHistoryBack();

        case 'screenshot':
          return this.executeScreenshot();

        case 'wait':
          // Wait is handled by the orchestrator, not MCP
          return { success: true, data: { message: 'Wait action handled by orchestrator' } };

        case 'ask_user_question':
          // Ask user question is handled by control-plane
          return { success: true, data: { message: 'Approval request sent to control-plane' } };

        case 'terminate':
          // Terminate is handled by orchestrator
          return { success: true, data: { message: 'Termination request acknowledged' } };

        case 'pause_and_memorize_fact':
          // Memory is handled server-side
          return { success: true, data: { message: 'Fact memorization acknowledged' } };

        default:
          return { success: false, error: `Unknown action type: ${(action as FaraAction).type}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute a click action
   */
  private async executeClick(action: ClickAction): Promise<ToolCallResult> {
    const clickCount = action.type === 'double_click' ? 2 : 1;
    const button = action.type === 'right_click' ? 'right' : 'left';

    const result = await this.client.callTool({
      name: MCP_TOOLS.MOUSE_CLICK_XY,
      arguments: {
        x: action.x,
        y: action.y,
        clickCount,
        button,
      },
    });

    return {
      success: true,
      data: result,
      observation_id: action.observation_id,
    };
  }

  /**
   * Execute a drag action
   */
  private async executeDrag(action: DragAction): Promise<ToolCallResult> {
    const result = await this.client.callTool({
      name: MCP_TOOLS.MOUSE_DRAG_XY,
      arguments: {
        start_x: action.start_x,
        start_y: action.start_y,
        end_x: action.end_x,
        end_y: action.end_y,
      },
    });

    return {
      success: true,
      data: result,
      observation_id: action.observation_id,
    };
  }

  /**
   * Execute a mouse move action
   */
  private async executeMouseMove(action: MouseMoveAction): Promise<ToolCallResult> {
    const result = await this.client.callTool({
      name: MCP_TOOLS.MOUSE_MOVE_XY,
      arguments: {
        x: action.x,
        y: action.y,
      },
    });

    return {
      success: true,
      data: result,
      observation_id: action.observation_id,
    };
  }

  /**
   * Execute a scroll action
   */
  private async executeScroll(action: ScrollAction): Promise<ToolCallResult> {
    const result = await this.client.callTool({
      name: MCP_TOOLS.MOUSE_WHEEL,
      arguments: {
        x: action.x,
        y: action.y,
        delta_x: action.delta_x ?? 0,
        delta_y: action.delta_y ?? 0,
      },
    });

    return {
      success: true,
      data: result,
      observation_id: action.observation_id,
    };
  }

  /**
   * Execute a key press action
   */
  private async executeKey(action: KeyAction): Promise<ToolCallResult> {
    const result = await this.client.callTool({
      name: MCP_TOOLS.PRESS_KEY,
      arguments: {
        key: action.key,
      },
    });

    return {
      success: true,
      data: result,
      observation_id: action.observation_id,
    };
  }

  /**
   * Execute a URL visit action
   */
  private async executeVisitUrl(action: VisitUrlAction): Promise<ToolCallResult> {
    // Validate URL scheme - only allow HTTP and HTTPS
    try {
      const url = new URL(action.url);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return {
          success: false,
          error: `Invalid URL scheme: ${url.protocol}. Only http and https are allowed.`,
        };
      }
    } catch {
      return {
        success: false,
        error: `Invalid URL: ${action.url}`,
      };
    }

    const result = await this.client.callTool({
      name: MCP_TOOLS.NAVIGATE,
      arguments: {
        url: action.url,
      },
    });

    return {
      success: true,
      data: result,
      observation_id: action.observation_id,
    };
  }

  /**
   * Execute history back action
   */
  private async executeHistoryBack(): Promise<ToolCallResult> {
    const result = await this.client.callTool({
      name: MCP_TOOLS.NAVIGATE_BACK,
      arguments: {},
    });

    return {
      success: true,
      data: result,
    };
  }

  /**
   * Execute screenshot action
   */
  private async executeScreenshot(): Promise<ToolCallResult> {
    const result = await this.client.callTool({
      name: MCP_TOOLS.TAKE_SCREENSHOT,
      arguments: {},
    });

    return {
      success: true,
      data: result,
    };
  }

  /**
   * Insert text at focused element
   * This is safer than arbitrary code execution
   */
  async insertText(text: string): Promise<ToolCallResult> {
    if (!this.isToolAllowed(MCP_TOOLS.KEYBOARD_INSERT_TEXT)) {
      return {
        success: false,
        error: 'browser_keyboard_insert_text is not available',
      };
    }

    try {
      const result = await this.client.callTool({
        name: MCP_TOOLS.KEYBOARD_INSERT_TEXT,
        arguments: { text },
      });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get current page URL for verification
   */
  async getCurrentUrl(): Promise<string | null> {
    try {
      const result = await this.client.callTool({
        name: MCP_TOOLS.GET_CURRENT_URL,
        arguments: {},
      });

      if (result.content && result.content.length > 0) {
        const text = result.content[0]?.text || '';
        // Parse URL from response
        const match = text.match(/https?:\/\/[^\s"]+/);
        return match ? match[0] : null;
      }
      return null;
    } catch {
      return null;
    }
  }
}

/**
 * Accessibility Snapshot Verifier
 * Per ARCHITECTURE.md section 3.6 - out-of-band verification
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

export interface VerificationCondition {
  type: 'text_present' | 'domain_match' | 'dialog_open' | 'form_value';
  expected?: string;
  expected_domains?: string[];
  selector?: string;
}

/**
 * Factory function to create an action adapter
 */
export function createFaraActionAdapter(client: MCPClient, sessionId: string): FaraActionAdapter {
  return new FaraActionAdapter(client, sessionId);
}

/**
 * Factory function to create an accessibility verifier
 */
export function createAccessibilityVerifier(client: MCPClient): AccessibilityVerifier {
  return new AccessibilityVerifier(client);
}
